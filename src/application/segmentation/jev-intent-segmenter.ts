/**
 * Deciding when a half-spoken sentence is already worth acting on.
 *
 * This is what buys the real-time feel, and it is the one place the system
 * deliberately acts on incomplete information. Two mechanisms share the work,
 * and the split is the whole design:
 *
 * - Connectors settle clause boundaries for free. When the speaker says "open
 *   chrome and then...", the first clause is finished by construction, so it
 *   is dispatched immediately with no model call at all.
 * - The trailing clause is the only thing in doubt, so it is the only thing
 *   the model is asked about: is this a complete instruction yet, or is the
 *   speaker mid-sentence? Cheap enough to ask several times a second.
 *
 * Acting early means sometimes acting on something the speaker is about to
 * change. The bar for a speculative dispatch is therefore higher than for a
 * confirmed one, and anything dispatched early is re-checked when the
 * utterance finishes, so a revision can supersede it.
 */

import { choiceQuestion, type IDecisionProvider } from "../../core/ports/decision.js";
import type { IIntentSegmenter } from "../../core/ports/speech.js";
import type { IClock, ILogger } from "../../core/ports/platform.js";
import { commandId, type CommandId, type SpokenCommand } from "../../core/types/command.js";
import type { TranscriptUpdate } from "../../core/types/transcript.js";
import { confidence, milliseconds } from "../../core/types/scalars.js";
import { splitClauses, type Clause } from "./clause-splitter.js";
import { stripFiller } from "../parsing/utterance.js";

const READINESS_INSTRUCTIONS =
  "Someone is speaking a command to their computer, and this is what they have said so far in the current clause. "
  + "The words may stop mid-sentence because they are still talking. Is this already a complete instruction that "
  + "can be carried out now, or would acting on it mean acting on half a thought?";

const READINESS_CRITERIA = {
  ready:
    "A complete instruction. Carrying it out now would do what the speaker is asking, even if they keep talking "
    + "afterwards about something else.",
  incomplete:
    "The speaker is part way through. Acting now would act on a fragment, or on an instruction whose target has "
    + "not been named yet.",
  chatter: "Not an instruction to the computer: thinking aloud, a false start, or conversation.",
} as const;

export interface JevIntentSegmenterOptions {
  readonly logger?: ILogger;
  /**
   * Confidence required before acting on a sentence the speaker has not
   * finished. Higher than for a settled clause, because the cost of being
   * wrong is an action nobody asked for.
   */
  readonly speculativeThreshold?: number;
  /** Shortest gap between two readiness questions about the same clause. */
  readonly minAskIntervalMs?: number;
  /** Fragments shorter than this are never worth asking about. */
  readonly minFragmentChars?: number;
}

const DEFAULTS = {
  speculativeThreshold: 0.7,
  minAskIntervalMs: 250,
  minFragmentChars: 8,
} as const;

export class JevIntentSegmenter implements IIntentSegmenter {
  readonly #decisions: IDecisionProvider;
  readonly #clock: IClock;
  readonly #logger: ILogger | undefined;
  readonly #threshold: number;
  readonly #minInterval: number;
  readonly #minChars: number;

  #sequence = 0;

  constructor(decisions: IDecisionProvider, clock: IClock, options: JevIntentSegmenterOptions = {}) {
    this.#decisions = decisions;
    this.#clock = clock;
    this.#logger = options.logger;
    this.#threshold = options.speculativeThreshold ?? DEFAULTS.speculativeThreshold;
    this.#minInterval = options.minAskIntervalMs ?? DEFAULTS.minAskIntervalMs;
    this.#minChars = options.minFragmentChars ?? DEFAULTS.minFragmentChars;
  }

  async *segment(updates: AsyncIterable<TranscriptUpdate>, signal: AbortSignal): AsyncIterable<SpokenCommand> {
    /**
     * What has already been sent for this utterance, by clause position.
     *
     * Both halves are needed: the text to notice that the recogniser revised
     * the words, and the id so a correction can name the command it replaces.
     * Sending the text as the supersedes value looks plausible and does
     * nothing, because the queue cancels by id.
     */
    let dispatched: { readonly text: string; readonly id: CommandId }[] = [];
    let utterance = "";
    let lastAsked = "";
    // Not zero: a clock that starts at zero would debounce away the very
    // first question, which is the one that matters most.
    let lastAskAt = Number.NEGATIVE_INFINITY;

    for await (const update of updates) {
      if (signal.aborted) return;

      if (update.utteranceId !== utterance) {
        // A new utterance: nothing from the previous one is still pending.
        dispatched = [];
        utterance = update.utteranceId;
        lastAsked = "";
      }

      const clauses = splitClauses(update.text, update.isFinal);

      for (let index = 0; index < clauses.length; index++) {
        const clause = clauses[index];
        if (clause === undefined) continue;

        // A clause that is nothing but filler is not an instruction. Real
        // speech produces these constantly: a trailing "then", an "okay", a
        // false start. Dispatching one sends a meaningless command down the
        // chain, where it reaches the screen loop and flails against a screen
        // that has nothing to do with it.
        if (stripFiller(clause.text).length === 0) continue;

        const previous = dispatched[index];

        if (previous !== undefined) {
          // Already sent. Only worth revisiting if the engine revised the
          // words, which happens as later audio clarifies earlier sounds.
          if (update.isFinal && previous.text !== clause.text) {
            const correction = this.#command(clause.text, update, "confirmed", previous.id);
            dispatched[index] = { text: clause.text, id: correction.id };
            yield correction;
            this.#logger?.info("clause revised after it was acted on", { was: previous.text, now: clause.text });
          }
          continue;
        }

        if (clause.settled) {
          // Finished by construction: the speaker moved on, or the utterance
          // ended. No judgement required and none is paid for.
          const command = this.#command(clause.text, update, update.isFinal ? "confirmed" : "speculative", null);
          dispatched[index] = { text: clause.text, id: command.id };
          yield command;
          continue;
        }

        // The trailing, still-growing clause. The only thing worth asking about.
        const ready = await this.#isReady(clause, update, lastAsked, lastAskAt, signal);
        lastAsked = ready.asked ? clause.text : lastAsked;
        lastAskAt = ready.asked ? this.#clock.now() : lastAskAt;

        if (ready.dispatch) {
          const command = this.#command(clause.text, update, "speculative", null);
          dispatched[index] = { text: clause.text, id: command.id };
          yield command;
        }
      }
    }
  }

  /**
   * Whether the trailing fragment is worth acting on yet.
   *
   * Skipped entirely when the fragment is too short to be an instruction, or
   * when the same words were judged moments ago. Transcripts arrive several
   * times a second and most updates add a syllable; asking about every one
   * would spend latency for nothing.
   */
  async #isReady(
    clause: Clause,
    update: TranscriptUpdate,
    lastAsked: string,
    lastAskAt: number,
    signal: AbortSignal,
  ): Promise<{ readonly dispatch: boolean; readonly asked: boolean }> {
    if (clause.text.length < this.#minChars) return { dispatch: false, asked: false };
    if (clause.text === lastAsked) return { dispatch: false, asked: false };
    if (this.#clock.now() - lastAskAt < this.#minInterval) return { dispatch: false, asked: false };

    const answers = await this.#decisions.decide(
      {
        state: {
          fragment: clause.text,
          full_utterance_so_far: update.text,
          transcription_confidence: update.confidence,
        },
        questions: { status: choiceQuestion(READINESS_INSTRUCTIONS, READINESS_CRITERIA) },
      },
      signal,
    );

    const status = answers.status;
    const dispatch = status.choice === "ready" && status.confidence >= this.#threshold;

    this.#logger?.debug("readiness", {
      fragment: clause.text,
      status: status.choice,
      confidence: status.confidence,
      dispatch,
    });

    return { dispatch, asked: true };
  }

  #command(
    text: string,
    update: TranscriptUpdate,
    timing: SpokenCommand["timing"],
    supersedes: CommandId | null,
  ): SpokenCommand {
    return {
      id: commandId(`${update.utteranceId}-${++this.#sequence}`),
      text,
      timing,
      confidence: confidence(update.confidence),
      receivedAt: milliseconds(update.at),
      utteranceId: update.utteranceId,
      supersedes,
    };
  }
}
