/**
 * `IDecisionProvider` backed by TypeSafe Jev.
 *
 * All questions in a request are answered in one round trip, in parallel on
 * the far side. Measured from this machine: about 400ms warm for a request
 * carrying 60 options and 3,300 input tokens, and roughly 1,500ms for the very
 * first call while the connection is established. That cold cost lands on the
 * first thing the user says, so `warm()` exists to pay it at startup instead.
 *
 * Output tokens are free and input is $0.042 per million, which is why the
 * design asks several questions per step rather than economising on them.
 */

import { choice, noul, score, TypeSafeClient, type Questions, type SystemOneRequest } from "@typesafe-ai/sdk";
import type {
  AnyQuestion,
  DecisionAnswers,
  DecisionRequest,
  IDecisionProvider,
  QuestionSet,
} from "../../core/ports/decision.js";
import type { ILogger } from "../../core/ports/platform.js";
import { confidence } from "../../core/types/scalars.js";

/**
 * Per-request deadline.
 *
 * Well above the measured median so an occasional slow call still lands, but
 * low enough that a wedged request cannot hold a spoken command open.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

export interface TypeSafeDecisionProviderOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly logger?: ILogger;
  /** Injectable so tests can drive the mapping without a network. */
  readonly client?: TypeSafeClient;
}

export class TypeSafeDecisionProvider implements IDecisionProvider {
  readonly name = "typesafe-jev";

  readonly #client: TypeSafeClient;
  readonly #timeoutMs: number;
  readonly #logger: ILogger | undefined;

  constructor(options: TypeSafeDecisionProviderOptions = {}) {
    this.#client =
      options.client ??
      new TypeSafeClient(options.apiKey === undefined ? {} : { apiKey: options.apiKey });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger;
  }

  async decide<Q extends QuestionSet>(
    request: DecisionRequest<Q>,
    signal?: AbortSignal,
  ): Promise<DecisionAnswers<Q>> {
    const questions: Questions = {};
    for (const [key, question] of Object.entries(request.questions)) {
      questions[key] = toSdkQuestion(question);
    }

    // The SDK types state with mutable arrays where the domain uses readonly
    // ones. The two serialise identically; the difference is that ours is the
    // stricter shape, so the widening is confined to this boundary.
    const state = request.state as SystemOneRequest<Questions>["state"];

    const result = await this.#client.systemOne(
      { state, questions },
      { timeout: this.#timeoutMs, ...(signal === undefined ? {} : { signal }) },
    );

    this.#logger?.debug("decision returned", {
      model: result.model,
      inputTokens: result.usage.input_tokens,
    });

    const answers: Record<string, unknown> = {};
    for (const [key, answer] of Object.entries(result.answers)) {
      answers[key] = fromSdkAnswer(answer);
    }

    return answers as DecisionAnswers<Q>;
  }

  /**
   * Establish the connection before it is needed.
   *
   * The first call costs roughly a second more than the rest. Paid lazily it
   * lands on the user's first command, which is the one moment the system must
   * feel immediate. Failure is deliberately swallowed: a warm-up that did not
   * work must never stop the agent starting.
   */
  async warm(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.decide(
        {
          state: { warmup: true },
          questions: { ready: { type: "boolean", instructions: "Is this a warm-up request?" } },
        },
        signal,
      );
      return true;
    } catch (error: unknown) {
      this.#logger?.warn("decision provider warm-up failed; the first request will pay for it", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/** Domain question to the shape the SDK builders produce. */
function toSdkQuestion(question: AnyQuestion): Questions[string] {
  switch (question.type) {
    case "choice":
      return choice(question.instructions, question.criteria);
    case "boolean":
      return noul(question.instructions);
    case "score":
      // The SDK requires at least two rubric levels; a shorter one is a
      // programming error rather than something to paper over at runtime.
      if (question.rubric.length < 2) {
        throw new Error(`score question ${JSON.stringify(question.instructions)} needs at least two rubric levels`);
      }
      return score(question.instructions, [...question.rubric] as [string, string, ...string[]]);
  }
}

/**
 * SDK answer to the domain shape.
 *
 * A noul arrives as a bare probability with no verdict attached, which is the
 * honest form. The boolean is derived here at one half purely for convenience;
 * callers that care choose their own threshold from the probability.
 */
function fromSdkAnswer(answer: unknown): unknown {
  const typed = answer as { type: string };

  switch (typed.type) {
    case "choice": {
      const value = answer as { choice: string; confidence: number; probabilities: Record<string, number> };
      return {
        choice: value.choice,
        confidence: clamp(value.confidence),
        probabilities: value.probabilities,
      };
    }
    case "noul": {
      const value = answer as { noul: number };
      return { value: value.noul >= 0.5, probability: clamp(value.noul) };
    }
    case "score": {
      const value = answer as { score: number; confidence: number; probabilities: Record<string, number> };
      return { value: value.score, confidence: clamp(value.confidence), probabilities: value.probabilities };
    }
    default:
      throw new Error(`decision provider returned an unrecognised answer type ${JSON.stringify(typed.type)}`);
  }
}

/** Providers occasionally report just outside the unit interval; survive it. */
function clamp(value: number): ReturnType<typeof confidence> {
  if (!Number.isFinite(value)) return confidence(0);
  return confidence(Math.min(1, Math.max(0, value)));
}
