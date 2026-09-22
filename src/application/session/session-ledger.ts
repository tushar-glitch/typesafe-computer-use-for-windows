/**
 * The session's memory, kept bounded.
 *
 * An agent that listens for hours accumulates history without limit, so the
 * only interesting design question here is what to throw away. Two rules:
 * keep a fixed number of recent tasks, and let referents expire, because a
 * website opened forty minutes ago is not what "it" means now.
 *
 * Everything is derived from things that actually happened. Nothing is
 * inferred, summarised or generated, so the ledger cannot drift away from
 * reality the way a running text summary would.
 */

import type { CommandId, CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import type { IClock } from "../../core/ports/platform.js";
import type { Observation } from "../../core/types/observation.js";
import type {
  Referent,
  ReferentKind,
  SessionSnapshot,
  TaskRecord,
  TaskResult,
  WorldState,
} from "../../core/types/session.js";
import { milliseconds, type Milliseconds } from "../../core/types/scalars.js";

export interface SessionLedgerOptions {
  /** Tasks kept. Older ones fall off the end. */
  readonly maxTasks?: number;
  /** Referents offered as candidates for a later reference. */
  readonly maxReferents?: number;
  /**
   * How long a referent stays plausible.
   *
   * "Open it again" twenty seconds later is obvious; the same words an hour on
   * almost certainly mean something else. Offering a stale candidate is worse
   * than offering none, because the model will pick from whatever it is given.
   */
  readonly referentTtlMs?: number;
}

const DEFAULTS = {
  maxTasks: 20,
  maxReferents: 12,
  referentTtlMs: 15 * 60 * 1000,
} as const;

export class SessionLedger {
  readonly #clock: IClock;
  readonly #maxTasks: number;
  readonly #maxReferents: number;
  readonly #ttl: number;
  readonly #startedAt: Milliseconds;

  #tasks: TaskRecord[] = [];
  #referents: Referent[] = [];
  #world: WorldState | null = null;
  #sequence = 0;

  constructor(clock: IClock, options: SessionLedgerOptions = {}) {
    this.#clock = clock;
    this.#maxTasks = options.maxTasks ?? DEFAULTS.maxTasks;
    this.#maxReferents = options.maxReferents ?? DEFAULTS.maxReferents;
    this.#ttl = options.referentTtlMs ?? DEFAULTS.referentTtlMs;
    this.#startedAt = clock.now();
  }

  /** Everything a decision might need, with stale referents already dropped. */
  snapshot(): SessionSnapshot {
    return {
      recentTasks: [...this.#tasks],
      referents: this.#liveReferents(),
      world: this.#world,
      startedAt: this.#startedAt,
    };
  }

  /** Record how a task ended. Called once per command, whatever the outcome. */
  recordTask(command: SpokenCommand, outcome: CommandOutcome, actions: readonly string[] = []): void {
    const record: TaskRecord = {
      id: command.id,
      said: command.text,
      result: outcome.status satisfies TaskResult,
      summary: outcome.status === "completed" ? outcome.summary : outcome.reason,
      at: this.#clock.now(),
      actions: [...actions],
    };

    this.#tasks.push(record);
    if (this.#tasks.length > this.#maxTasks) {
      this.#tasks = this.#tasks.slice(-this.#maxTasks);
    }
  }

  /**
   * Note something a later sentence could point back to.
   *
   * Re-noting the same target refreshes it rather than duplicating it: opening
   * a site twice should make it more recent, not offer it twice.
   */
  remember(kind: ReferentKind, target: string, description: string): void {
    const at = this.#clock.now();
    const key = `${kind}:${target}`;

    this.#referents = this.#referents.filter((referent) => referent.key !== key);
    this.#referents.unshift({ key, label: description, kind, target, at });

    if (this.#referents.length > this.#maxReferents) {
      this.#referents = this.#referents.slice(0, this.#maxReferents);
    }
  }

  /** Update where things stand. Cheap, and safe to call every observation. */
  observeWorld(observation: Observation): void {
    this.#world = {
      foregroundApp: observation.foreground.processName,
      windowTitle: observation.foreground.title,
      browserUrl: observation.browserUrl,
    };
  }

  setWorld(world: WorldState): void {
    this.#world = world;
  }

  /** Whether this command has already been recorded, so a retry is not double counted. */
  hasTask(id: CommandId): boolean {
    return this.#tasks.some((task) => task.id === id);
  }

  /** Monotonic counter for anything that needs a unique label within the session. */
  nextSequence(): number {
    return ++this.#sequence;
  }

  #liveReferents(): readonly Referent[] {
    const now = this.#clock.now();
    const cutoff = now - this.#ttl;

    // Expiry is applied on read rather than on a timer: the ledger has no
    // lifecycle of its own, and a session that goes quiet should not be doing
    // work in the background.
    this.#referents = this.#referents.filter((referent) => referent.at >= cutoff);
    return [...this.#referents];
  }
}

/** How long ago, in words a person would use. Referent labels read better for it. */
export function describeAge(at: Milliseconds, now: Milliseconds): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  return `${Math.round(minutes / 60)}h ago`;
}

export function referentLabel(
  kind: ReferentKind,
  target: string,
  at: Milliseconds,
  now: Milliseconds,
): string {
  const noun = kind === "website" ? "a website" : kind === "app" ? "an application" : `a ${kind}`;
  return `${target} (${noun}, ${describeAge(at, now)})`;
}

export const nowFrom = (clock: IClock): Milliseconds => milliseconds(clock.now());
