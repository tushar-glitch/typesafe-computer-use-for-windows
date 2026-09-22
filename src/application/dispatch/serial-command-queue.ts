/**
 * Running spoken commands one at a time, and abandoning them when the speaker
 * changes their mind.
 *
 * Serial because the actions contend for one desktop: two commands typing into
 * whatever has focus would interleave into nonsense. Speech, meanwhile, does
 * not wait, so commands can arrive faster than they run and something has to
 * hold them in order.
 *
 * Barge-in is the other half. A command dispatched from a half-finished
 * sentence can be contradicted by the rest of it, so a command that supersedes
 * another aborts it mid-flight and takes its place. Everything queued behind
 * the superseded one goes too: it was queued on an understanding that has
 * since changed.
 */

import type { ICommandQueue } from "../../core/ports/handling.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { CommandId, CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { cancelled } from "../../core/types/command.js";
import type { HandlerChain } from "../handlers/handler-chain.js";

export type OutcomeListener = (command: SpokenCommand, outcome: CommandOutcome) => void;

export interface SerialCommandQueueOptions {
  readonly logger?: ILogger;
  readonly onOutcome?: OutcomeListener;
}

interface Entry {
  readonly command: SpokenCommand;
}

export class SerialCommandQueue implements ICommandQueue {
  readonly #chain: HandlerChain;
  readonly #logger: ILogger | undefined;
  readonly #onOutcome: OutcomeListener | undefined;

  readonly #queued: Entry[] = [];
  #running: { readonly command: SpokenCommand; readonly controller: AbortController } | null = null;
  #pump: Promise<void> = Promise.resolve();

  constructor(chain: HandlerChain, options: SerialCommandQueueOptions = {}) {
    this.#chain = chain;
    this.#logger = options.logger;
    this.#onOutcome = options.onOutcome;
  }

  get pending(): number {
    return this.#queued.length + (this.#running === null ? 0 : 1);
  }

  /** The command currently executing, if any. Diagnostic. */
  get running(): SpokenCommand | null {
    return this.#running?.command ?? null;
  }

  submit(command: SpokenCommand): void {
    if (command.supersedes !== null) {
      this.#supersede(command.supersedes);
    }

    this.#queued.push({ command });
    this.#pump = this.#pump.then(() => this.#drainOnce());
  }

  cancelAll(reason: string): void {
    for (const entry of this.#queued.splice(0)) {
      this.#report(entry.command, cancelled(reason));
    }

    if (this.#running !== null) {
      this.#logger?.debug("aborting the running command", { reason, id: this.#running.command.id });
      this.#running.controller.abort();
    }
  }

  /** Resolves once everything submitted so far has finished or been abandoned. */
  async drain(): Promise<void> {
    await this.#pump;
  }

  /**
   * Abandon a command the speaker has revised, and anything queued behind it.
   *
   * Work already queued after the superseded command was queued on the old
   * understanding of the sentence, so it is dropped rather than run.
   */
  #supersede(superseded: CommandId): void {
    const stillQueued = this.#queued.findIndex((entry) => entry.command.id === superseded);
    if (stillQueued >= 0) {
      for (const entry of this.#queued.splice(stillQueued)) {
        this.#report(entry.command, cancelled("superseded before it ran"));
      }
      return;
    }

    if (this.#running?.command.id === superseded) {
      this.#logger?.info("speaker revised a command already running", { id: superseded });
      this.#running.controller.abort();
      for (const entry of this.#queued.splice(0)) {
        this.#report(entry.command, cancelled("queued behind a superseded command"));
      }
    }
  }

  async #drainOnce(): Promise<void> {
    const entry = this.#queued.shift();
    if (entry === undefined) return;

    const controller = new AbortController();
    this.#running = { command: entry.command, controller };

    try {
      const outcome = await this.#chain.dispatch(entry.command, controller.signal);
      this.#report(entry.command, outcome);
    } catch (error: unknown) {
      // A handler threw rather than returning an outcome. One command failing
      // must not stop the queue serving the next thing the speaker says.
      const message = error instanceof Error ? error.message : String(error);
      this.#logger?.error("command threw", { id: entry.command.id, error: message });
      this.#report(entry.command, { status: "failed", reason: message });
    } finally {
      this.#running = null;
    }
  }

  #report(command: SpokenCommand, outcome: CommandOutcome): void {
    this.#logger?.debug("command finished", { id: command.id, status: outcome.status });
    this.#onOutcome?.(command, outcome);
  }
}
