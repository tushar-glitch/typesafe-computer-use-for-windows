/**
 * What the agent remembers across everything you say.
 *
 * A session runs for hours and a task lasts seconds, so these are different
 * things. A task has a goal and ends; the session has no goal and does not.
 * Without a layer that outlives the task, every sentence arrives with no idea
 * what came before it, and "ask him about that" cannot mean anything.
 *
 * Deliberately a ledger of structured facts rather than a transcript. Jev
 * produces no text, so it cannot summarise a growing history, and an
 * hours-long log is unbounded anyway. Facts stay small, stay precise, and can
 * be offered to the model as options to choose between, which is the one thing
 * it is very good at.
 */

import type { CommandId } from "./command.js";
import type { Milliseconds } from "./scalars.js";

/** How a task ended. Mirrors CommandOutcome, flattened for the record. */
export type TaskResult = "completed" | "failed" | "cancelled" | "unhandled";

/** One thing the speaker asked for, and what became of it. */
export interface TaskRecord {
  readonly id: CommandId;
  /** What was said, as the segmenter delivered it. */
  readonly said: string;
  readonly result: TaskResult;
  /** One line on what happened, from the handler that ran it. */
  readonly summary: string;
  readonly at: Milliseconds;
  /** Actions taken inside the task, most recent last. */
  readonly actions: readonly string[];
}

/**
 * Something a later sentence might point back to.
 *
 * "Ask him about that" only means anything if "him" can be resolved, and it
 * can only be resolved against things that actually happened. These are the
 * candidates: bounded, labelled for a human to recognise, and keyed so a
 * typed choice can name one.
 */
export type ReferentKind = "app" | "website" | "field" | "document";

export interface Referent {
  /** Stable key, used as the option label when the model is asked to choose. */
  readonly key: string;
  /** How it would be described to someone: "chatgpt.com, a website opened 20s ago". */
  readonly label: string;
  readonly kind: ReferentKind;
  /** What acting on it means: an appId, a URL, an element handle. */
  readonly target: string;
  readonly at: Milliseconds;
}

/** Where things stand right now, as opposed to what has happened. */
export interface WorldState {
  readonly foregroundApp: string;
  readonly windowTitle: string;
  readonly browserUrl: string | null;
}

/**
 * The session as the rest of the system sees it.
 *
 * Read-only and cheap to pass around; the ledger that maintains it is the only
 * thing that mutates.
 */
export interface SessionSnapshot {
  /** Most recent last, so it reads in the order things happened. */
  readonly recentTasks: readonly TaskRecord[];
  /** Most recent first, because recency is how people disambiguate. */
  readonly referents: readonly Referent[];
  readonly world: WorldState | null;
  /** How long the session has been listening. */
  readonly startedAt: Milliseconds;
}
