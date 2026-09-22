/**
 * `ITextComposer` backed by a small model on Groq.
 *
 * The one job the decision model structurally cannot do. Jev returns typed
 * choices and produces no text at all, so turning "play any song on youtube"
 * into a search query, or a request for a paragraph into a paragraph, needs a
 * model that writes.
 *
 * Deliberately a small one. The task is a sentence at most, given a goal and a
 * field label, and a 20B open-weight model does it as well as anything larger
 * while staying inside a free tier and returning in a few hundred milliseconds.
 * This call sits inside the step loop, so latency is part of the product.
 *
 * Plain fetch rather than an SDK: it is one OpenAI-shaped endpoint, and a
 * dependency for a single POST is not worth its weight.
 */

import type { ILogger } from "../../core/ports/platform.js";
import type { ITextComposer, TextRequest } from "../../core/ports/writing.js";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Small and fast. The task is short; a larger model buys nothing here. */
const DEFAULT_MODEL = "openai/gpt-oss-20b";

/** Sits inside a step, so a slow answer is worse than none. */
const DEFAULT_TIMEOUT_MS = 6_000;

/** The reply that means "do not fill this field". */
const DECLINE = "SKIP";

const SYSTEM_PROMPT = [
  "You decide the exact text to type into one field on a user's screen.",
  "",
  "You are given the user's spoken goal and a description of the focused field.",
  "Reply with ONLY the literal characters to type. No quotes, no explanation,",
  "no preamble, no trailing punctuation unless it belongs in the text itself.",
  "",
  "When the goal names the text, reproduce it exactly.",
  "When the goal asks for something to be composed, write it, and keep it short",
  "unless the goal asks for length.",
  "When the field is a search box, write terms that would actually be searched,",
  "not a sentence describing the search.",
  "",
  `Reply with exactly ${DECLINE}, and nothing else, when the field should not be`,
  "filled: passwords, one-time codes, payment details, or anything where",
  "guessing would be worse than doing nothing.",
].join("\n");

/**
 * Field labels that must never be filled by a model.
 *
 * Checked before the request, not left to the prompt. A refusal that depends
 * on a model behaving is not a safeguard, and this is the one case where being
 * wrong means typing a guess into a credential field.
 */
const FORBIDDEN = /pass(word|code)|passphrase|\bpin\b|\botp\b|one[- ]time|secret|credit|card number|cvv|security code/i;

export interface GroqTextComposerOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly logger?: ILogger;
  /** Injectable so tests can drive the mapping without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

interface ChatCompletion {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

export class GroqTextComposer implements ITextComposer {
  readonly name = "groq";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #logger: ILogger | undefined;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: GroqTextComposerOptions = {}) {
    const key = options.apiKey ?? process.env["GROQ_API_KEY"] ?? "";
    if (key.length === 0) {
      throw new Error("GROQ_API_KEY is not set; composing text needs a writing model");
    }

    this.#apiKey = key;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async compose(request: TextRequest, signal?: AbortSignal): Promise<string | null> {
    const field = `${request.fieldLabel} ${request.fieldPlaceholder}`.trim();
    if (FORBIDDEN.test(field)) {
      this.#logger?.info("declined to fill a credential field", { field: request.fieldLabel });
      return null;
    }

    const body = {
      model: this.#model,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Goal: ${request.instruction}`,
            `Field label: ${request.fieldLabel || "(none)"}`,
            `Field placeholder: ${request.fieldPlaceholder || "(none)"}`,
            `Field currently contains: ${request.currentValue || "(empty)"}`,
          ].join("\n"),
        },
      ],
    };

    // The caller's signal aborts the whole task; the timeout only this request.
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const abort = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

    let response: Response;
    try {
      response = await this.#fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(body),
        signal: abort,
      });
    } catch (error: unknown) {
      // A writer that cannot be reached must not fail the step: returning null
      // makes the action a refusal, which the loop already knows how to handle.
      this.#logger?.warn("writer unreachable", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!response.ok) {
      this.#logger?.warn("writer refused the request", { status: response.status });
      return null;
    }

    const completion = (await response.json()) as ChatCompletion;
    const text = (completion.choices?.[0]?.message?.content ?? "").trim();

    if (text.length === 0 || text === DECLINE) {
      this.#logger?.info("writer declined to fill the field", { goal: request.instruction });
      return null;
    }

    // Small models sometimes wrap the answer in quotes despite being told not to.
    return stripWrappingQuotes(text);
  }
}

function stripWrappingQuotes(text: string): string {
  const match = /^(["'`])([\s\S]*)\1$/.exec(text);
  return match?.[2] ?? text;
}
