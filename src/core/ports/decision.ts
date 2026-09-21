/**
 * The decision model port (Jev, or anything shaped like it).
 *
 * Deliberately not tied to one vendor: the same interface is served by a native
 * TypeSafe key, an OpenRouter key, and an in-memory fake used by the tests.
 *
 * Questions are declared up front and answered in a single round trip. The
 * option keys flow through to the answer type, so `answers.kind.choice` is a
 * union of the criteria keys rather than `string`, and a typo in a comparison
 * fails to compile.
 */

import type { JsonObject } from "../types/json.js";
import type { Confidence } from "../types/scalars.js";

/** The provider's ceiling on options in a single choice. */
export const MAX_CHOICE_OPTIONS = 255;

export interface ChoiceQuestion<K extends string = string> {
  readonly type: "choice";
  readonly instructions: string;
  /** Option key to the description the model judges it by. */
  readonly criteria: Readonly<Record<K, string>>;
}

/** A calibrated yes/no. TypeSafe calls this a Noul. */
export interface BooleanQuestion {
  readonly type: "boolean";
  readonly instructions: string;
}

/**
 * A graded judgement against an ordered rubric.
 *
 * Levels rather than a numeric range: the model is told what each grade means
 * and answers with an expected value across them, which may land between two
 * levels. A bare minimum and maximum would give it nothing to anchor on.
 */
export interface ScoreQuestion<R extends readonly string[] = readonly string[]> {
  readonly type: "score";
  readonly instructions: string;
  /** Descriptions ordered from lowest grade to highest. At least two. */
  readonly rubric: R;
}

export type AnyQuestion = ChoiceQuestion<string> | BooleanQuestion | ScoreQuestion<readonly string[]>;

export type QuestionSet = Readonly<Record<string, AnyQuestion>>;

export interface ChoiceAnswer<K extends string = string> {
  readonly choice: K;
  /**
   * The model's calibrated confidence in the selected label.
   *
   * Measured against live Jev, it tracks how debatable the judgement is and
   * usually sits at or below the winning probability: 1.0 for an obvious
   * choice, 0.63 for a genuine toss-up between two sensible options, 0.49 when
   * neither option was any good.
   *
   * One thing it is NOT, verified rather than assumed: it does not detect
   * overlapping options. Two options described identically produced 0.92 /
   * 0.08 at confidence 0.85, the tie broken arbitrarily and reported as
   * near-certain. Options must still be kept mutually exclusive, but because
   * duplicates make behaviour erratic between steps, not because confidence
   * gating will catch them.
   *
   * Separately, every choice needs an explicit escape option. Asked which of
   * several irrelevant controls serves a goal, the model must still name one.
   * Offered "nothing helps", it says so.
   */
  readonly confidence: Confidence;
  readonly probabilities: Readonly<Record<K, number>>;
}

/**
 * A calibrated yes/no.
 *
 * The provider answers with a probability, not a verdict. `value` is that
 * probability thresholded at one half, and is a convenience only: anything
 * gating on this answer should read `probability` and pick its own cut-off,
 * because the right threshold depends on what acting wrongly costs.
 */
export interface BooleanAnswer {
  readonly value: boolean;
  readonly probability: Confidence;
}

export interface ScoreAnswer {
  /** Expected grade, which may fall between two rubric levels. */
  readonly value: number;
  readonly confidence: Confidence;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type AnswerFor<Q> =
  Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K>
  : Q extends BooleanQuestion ? BooleanAnswer
  : Q extends ScoreQuestion<readonly string[]> ? ScoreAnswer
  : never;

export type DecisionAnswers<Q extends QuestionSet> = { readonly [K in keyof Q]: AnswerFor<Q[K]> };

export interface DecisionRequest<Q extends QuestionSet> {
  /** The world as the model should see it. Serialised as-is. */
  readonly state: JsonObject;
  readonly questions: Q;
}

export interface IDecisionProvider {
  readonly name: string;
  decide<Q extends QuestionSet>(
    request: DecisionRequest<Q>,
    signal?: AbortSignal,
  ): Promise<DecisionAnswers<Q>>;
}

/** Builds a choice question while preserving its option keys as literal types. */
export function choiceQuestion<K extends string>(
  instructions: string,
  criteria: Readonly<Record<K, string>>,
): ChoiceQuestion<K> {
  return { type: "choice", instructions, criteria };
}

export function booleanQuestion(instructions: string): BooleanQuestion {
  return { type: "boolean", instructions };
}

export function scoreQuestion<const R extends readonly string[]>(instructions: string, rubric: R): ScoreQuestion<R> {
  return { type: "score", instructions, rubric };
}

/** The n most probable options, most probable first. Used for logging and gating. */
export function rankedOptions<K extends string>(
  answer: ChoiceAnswer<K>,
  limit: number,
): readonly (readonly [K, number])[] {
  const probabilities: Readonly<Record<string, number>> = answer.probabilities;
  const entries: (readonly [K, number])[] = [];
  for (const [key, probability] of Object.entries(probabilities)) {
    entries.push([key as K, probability]);
  }
  return entries.sort((a, b) => b[1] - a[1]).slice(0, limit);
}
