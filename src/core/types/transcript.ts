/** Streaming speech-to-text output. */

import type { Confidence, Milliseconds } from "./scalars.js";

/**
 * One update from the transcription engine.
 *
 * `text` is the whole utterance recognised so far, not a delta: engines revise
 * earlier words as more audio arrives, so consumers must treat each update as
 * replacing the last rather than appending to it.
 */
export interface TranscriptUpdate {
  readonly text: string;
  /** True once the engine will no longer revise this utterance. */
  readonly isFinal: boolean;
  readonly confidence: Confidence;
  readonly at: Milliseconds;
  /** Groups updates belonging to one continuous utterance. */
  readonly utteranceId: string;
}
