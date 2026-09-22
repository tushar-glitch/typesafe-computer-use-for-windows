/**
 * Types exactly what was said after the verb.
 *
 * "type hello world" puts `hello world` in the field. No model, no network, no
 * latency worth measuring, and the result is exactly predictable, which for
 * text going into somebody's document is worth more than cleverness.
 *
 * It does not pretend to handle a request for prose. "Type a paragraph about
 * India" would come out as the literal words "a paragraph about India", which
 * is not what anyone means, so requests that ask for something to be composed
 * are declined rather than answered badly. Generating prose needs a writing
 * model behind the same port.
 */

import type { ITextComposer, TextRequest } from "../../core/ports/writing.js";
import { afterPrefix, stripFiller } from "../parsing/utterance.js";

/** Verbs that introduce text to enter. */
const TYPE_VERBS = [
  "type out",
  "type in",
  "type",
  "write out",
  "write down",
  "write",
  "enter",
  "put",
  "say",
  "fill in with",
  "fill in",
  "fill",
] as const;

/**
 * Openers that mark a request to invent text rather than transcribe it.
 *
 * Matched at the start of what follows the verb. Deliberately conservative:
 * declining a request this composer could have handled costs a retry, while
 * typing "a poem about the sea" into a document as literal text is the kind of
 * wrong that looks like the system is broken.
 */
const GENERATIVE_OPENERS = [
  "something",
  "anything",
  "a poem",
  "a story",
  "a paragraph",
  "an essay",
  "a sentence",
  "a few lines",
  "a note about",
  "some text about",
  "a summary",
  "a joke",
  "a message to",
  "a reply",
] as const;

export class VerbatimTextComposer implements ITextComposer {
  readonly name = "verbatim";

  // eslint-disable-next-line @typescript-eslint/require-await
  async compose(request: TextRequest): Promise<string | null> {
    return this.text(request.instruction);
  }

  /**
   * Whether this is a request to put text somewhere at all.
   *
   * Separate from whether THIS composer can answer it. The handler claims on
   * shape, so that a request it cannot serve is explained rather than falling
   * through to the screen loop, which would flail at a window that has nothing
   * to do with the problem.
   */
  looksLikeTyping(instruction: string): boolean {
    return afterPrefix(stripFiller(instruction), [...TYPE_VERBS]) !== null;
  }

  /** The literal text to type, or null when the request asks for composition. */
  text(instruction: string): string | null {
    const remainder = afterPrefix(stripFiller(instruction), [...TYPE_VERBS]);
    if (remainder === null) return null;

    if (this.#asksForComposition(remainder)) return null;

    return remainder;
  }

  #asksForComposition(remainder: string): boolean {
    return GENERATIVE_OPENERS.some(
      (opener) => remainder === opener || remainder.startsWith(`${opener} `),
    );
  }
}
