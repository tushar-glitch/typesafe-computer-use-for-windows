/**
 * Chain of responsibility over command handlers.
 *
 * Ordered cheapest first. Every fast-path handler is an operating system call
 * measured in milliseconds; the screen loop at the end costs roughly a second
 * per step. The chain exists so the expensive one runs only when nothing
 * cheaper applies, which is what keeps a spoken request feeling immediate.
 *
 * Handlers are asked in order and the first to claim the command runs it. A
 * handler that claims and then returns `unhandled` hands the command back to
 * the chain, so a claim is a hypothesis rather than a commitment.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { cancelled, unhandled } from "../../core/types/command.js";

export interface HandlerChainOptions {
  readonly logger?: ILogger;
}

export class HandlerChain {
  readonly #handlers: readonly ICommandHandler[];
  readonly #logger: ILogger | undefined;

  constructor(handlers: readonly ICommandHandler[], options: HandlerChainOptions = {}) {
    this.#handlers = handlers;
    this.#logger = options.logger;
  }

  /** The handlers in the order they are consulted. Diagnostic. */
  get order(): readonly string[] {
    return this.#handlers.map((handler) => handler.name);
  }

  async dispatch(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    for (const handler of this.#handlers) {
      if (signal.aborted) {
        // The speaker revised themselves; nothing further should run.
        return cancelled("superseded before dispatch");
      }

      let claims: boolean;
      try {
        claims = await handler.canHandle(command, signal);
      } catch (error: unknown) {
        // A handler that cannot even decide must not block the ones behind it.
        this.#logger?.warn("handler failed while deciding", {
          handler: handler.name,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (!claims) continue;

      this.#logger?.debug("handler claimed the command", { handler: handler.name, text: command.text });
      const outcome = await handler.execute(command, signal);

      if (outcome.status === "unhandled") {
        // Claimed, then found it could not proceed. Keep looking.
        this.#logger?.debug("handler declined after claiming", { handler: handler.name, reason: outcome.reason });
        continue;
      }

      return outcome;
    }

    return unhandled(`nothing could handle ${JSON.stringify(command.text)}`);
  }
}
