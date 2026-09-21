/** An instruction recognised from speech, and what became of it. */

import type { Confidence, Milliseconds } from "./scalars.js";

export type CommandId = string & { readonly __command?: never };

/**
 * How the command should be run relative to the speaker.
 *
 * `speculative` commands are dispatched while the user is still talking, on a
 * partial transcript. They must be cheap and reversible, because the rest of
 * the sentence may contradict them. `confirmed` commands were recognised from a
 * final transcript and may do anything.
 */
export type CommandTiming = "speculative" | "confirmed";

export interface SpokenCommand {
  readonly id: CommandId;
  /** The instruction alone, not the whole utterance it was extracted from. */
  readonly text: string;
  readonly timing: CommandTiming;
  readonly confidence: Confidence;
  readonly receivedAt: Milliseconds;
  readonly utteranceId: string;
  /**
   * A previously dispatched command this one revises, when the speaker
   * corrected themselves mid-sentence. The queue cancels it before running this.
   */
  readonly supersedes: CommandId | null;
}

export type CommandOutcome =
  | { readonly status: "completed"; readonly summary: string }
  | { readonly status: "cancelled"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "unhandled"; readonly reason: string };

export function completed(summary: string): CommandOutcome {
  return { status: "completed", summary };
}

export function cancelled(reason: string): CommandOutcome {
  return { status: "cancelled", reason };
}

export function failed(reason: string): CommandOutcome {
  return { status: "failed", reason };
}

export function unhandled(reason: string): CommandOutcome {
  return { status: "unhandled", reason };
}
