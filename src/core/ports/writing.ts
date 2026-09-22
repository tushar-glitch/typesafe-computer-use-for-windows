/**
 * Deciding what text to put in a field.
 *
 * The decision model cannot help here. Jev answers typed questions from a
 * fixed set of options and generates nothing, which is the whole point of it,
 * so producing a sentence needs something else entirely.
 *
 * There are two genuinely different requests hiding under one verb. "Type
 * hello world" names the exact characters and needs no intelligence at all.
 * "Type a paragraph about India" asks for prose that does not exist yet. The
 * first is free and instant; the second needs a writing model. Behind this
 * port, a caller does not have to care which it got.
 */

export interface TextRequest {
  /** What the speaker said, in full, including the verb: "type hello world". */
  readonly instruction: string;
  /** Label of the field being filled, when the application exposes one. */
  readonly fieldLabel: string;
  readonly fieldPlaceholder: string;
  /** What the field already contains, so a composer can avoid repeating it. */
  readonly currentValue: string;
}

export interface ITextComposer {
  readonly name: string;
  /**
   * The exact string to type, or null to decline.
   *
   * Declining is a real answer and must be respected. A composer returns null
   * when it cannot honour the request, and typing a guess into a live form is
   * worse than doing nothing.
   */
  compose(request: TextRequest, signal?: AbortSignal): Promise<string | null>;
}
