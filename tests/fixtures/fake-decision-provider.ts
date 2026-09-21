import type {
  DecisionAnswers,
  DecisionRequest,
  IDecisionProvider,
  QuestionSet,
} from "../../src/core/ports/decision.js";
import { confidence } from "../../src/core/types/scalars.js";

/** What the fake should answer for one question, keyed by question name. */
export type ScriptedAnswer =
  | { readonly choice: string; readonly confidence?: number }
  | { readonly probability: number }
  | { readonly score: number; readonly confidence?: number };

/**
 * A decision provider that answers from a script.
 *
 * Lets the loop, the gating and the stop rules be tested exhaustively without
 * a network, a key, or the non-determinism of a real model.
 */
export class FakeDecisionProvider implements IDecisionProvider {
  readonly name = "fake";

  readonly requests: DecisionRequest<QuestionSet>[] = [];

  #script: Readonly<Record<string, ScriptedAnswer>>;
  #failWith: Error | null = null;

  constructor(script: Readonly<Record<string, ScriptedAnswer>> = {}) {
    this.#script = script;
  }

  /** Replace the script, for a loop that must behave differently on later steps. */
  setScript(script: Readonly<Record<string, ScriptedAnswer>>): void {
    this.#script = script;
  }

  /** Make the next call reject, to exercise failure handling. */
  failWith(error: Error | null): void {
    this.#failWith = error;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async decide<Q extends QuestionSet>(request: DecisionRequest<Q>): Promise<DecisionAnswers<Q>> {
    this.requests.push(request as DecisionRequest<QuestionSet>);

    if (this.#failWith !== null) {
      const error = this.#failWith;
      this.#failWith = null;
      throw error;
    }

    const answers: Record<string, unknown> = {};

    for (const [key, question] of Object.entries(request.questions)) {
      const scripted = this.#script[key];

      if (question.type === "choice") {
        const labels = Object.keys(question.criteria);
        const chosen =
          scripted !== undefined && "choice" in scripted ? scripted.choice : (labels[0] ?? "");
        const certainty = scripted !== undefined && "confidence" in scripted && scripted.confidence !== undefined
          ? scripted.confidence
          : 1;

        answers[key] = {
          choice: chosen,
          confidence: confidence(certainty),
          probabilities: Object.fromEntries(labels.map((label) => [label, label === chosen ? certainty : 0])),
        };
        continue;
      }

      if (question.type === "boolean") {
        const probability = scripted !== undefined && "probability" in scripted ? scripted.probability : 1;
        answers[key] = { value: probability >= 0.5, probability: confidence(probability) };
        continue;
      }

      const value = scripted !== undefined && "score" in scripted ? scripted.score : 0;
      answers[key] = {
        value,
        confidence: confidence(1),
        probabilities: Object.fromEntries(question.rubric.map((_, index) => [String(index), index === value ? 1 : 0])),
      };
    }

    return answers as DecisionAnswers<Q>;
  }
}
