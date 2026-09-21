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

export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly minimum: number;
  readonly maximum: number;
}

export type AnyQuestion = ChoiceQuestion<string> | BooleanQuestion | ScoreQuestion;

export type QuestionSet = Readonly<Record<string, AnyQuestion>>;

export interface ChoiceAnswer<K extends string = string> {
  readonly choice: K;
  /** How concentrated the distribution is, not the winning probability. */
  readonly confidence: Confidence;
  readonly probabilities: Readonly<Record<K, number>>;
}

export interface BooleanAnswer {
  readonly value: boolean;
  readonly probability: Confidence;
}

export interface ScoreAnswer {
  readonly value: number;
  readonly confidence: Confidence;
}

export type AnswerFor<Q> =
  Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K>
  : Q extends BooleanQuestion ? BooleanAnswer
  : Q extends ScoreQuestion ? ScoreAnswer
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

export function scoreQuestion(instructions: string, minimum: number, maximum: number): ScoreQuestion {
  return { type: "score", instructions, minimum, maximum };
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
