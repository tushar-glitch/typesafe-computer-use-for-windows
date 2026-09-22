/**
 * Tries composers in order until one produces text.
 *
 * The writing model is a network call, and the network is not always there. A
 * dictated phrase needs no model at all, so when the writer is unreachable the
 * verbatim composer still handles "type hello world" rather than the whole
 * typing action going dark.
 *
 * A null from a composer means "not mine, or not now", which is why it is safe
 * to fall through. A composer that declines on purpose, as the writer does for
 * a password field, is also declining on behalf of the ones behind it, so the
 * order matters: put the most careful first.
 */

import type { ILogger } from "../../core/ports/platform.js";
import type { ITextComposer, TextRequest } from "../../core/ports/writing.js";

export class FirstAvailableComposer implements ITextComposer {
  readonly name: string;

  readonly #composers: readonly ITextComposer[];
  readonly #logger: ILogger | undefined;

  constructor(composers: readonly ITextComposer[], options: { readonly logger?: ILogger } = {}) {
    if (composers.length === 0) throw new Error("at least one composer is required");

    this.#composers = composers;
    this.#logger = options.logger;
    this.name = composers.map((composer) => composer.name).join(" then ");
  }

  async compose(request: TextRequest, signal?: AbortSignal): Promise<string | null> {
    for (const composer of this.#composers) {
      const text = await composer.compose(request, signal);
      if (text !== null && text.length > 0) {
        if (composer !== this.#composers[0]) {
          this.#logger?.debug("fell back to another composer", { composer: composer.name });
        }
        return text;
      }
    }

    return null;
  }
}
