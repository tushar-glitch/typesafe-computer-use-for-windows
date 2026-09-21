/**
 * Listening, and turning speech into dispatchable instructions.
 *
 * Both sides are async iterables rather than callbacks: back-pressure matters
 * here. The segmenter must be able to stop pulling transcript updates while it
 * waits on a decision, without dropping audio on the floor.
 */

import type { SpokenCommand } from "../types/command.js";
import type { TranscriptUpdate } from "../types/transcript.js";

export interface ITranscriptionEngine {
  readonly name: string;
  /**
   * Yields a growing transcript until `signal` aborts.
   *
   * Each update supersedes the previous one for its utterance; engines revise
   * earlier words as more audio arrives.
   */
  transcribe(signal: AbortSignal): AsyncIterable<TranscriptUpdate>;
}

/**
 * Decides when a partial transcript already contains an instruction worth
 * acting on, before the speaker has finished the sentence.
 *
 * This is the component that buys the real-time feel, and the one that can act
 * on something the speaker is about to contradict. Implementations must mark
 * commands issued from a non-final transcript as `speculative`.
 */
export interface IIntentSegmenter {
  segment(updates: AsyncIterable<TranscriptUpdate>, signal: AbortSignal): AsyncIterable<SpokenCommand>;
}
