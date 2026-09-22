/**
 * "type hello world", "write this down", "enter my address".
 *
 * Typing belongs on the fast path. The characters are already in the sentence,
 * so there is nothing to look at and nothing to decide: reading the screen to
 * work out what to type would cost a second per step to learn something the
 * speaker already said.
 *
 * The one thing it does check is that there is somewhere to type. Sending
 * keystrokes with no field focused scatters them into whatever has focus,
 * which in an editor means corrupting a document and in a browser can mean
 * triggering shortcuts.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { IInputDevice } from "../../core/ports/execution.js";
import type { IFocusedFieldReader } from "../../core/ports/perception.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { ITextComposer } from "../../core/ports/writing.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { completed, failed, unhandled } from "../../core/types/command.js";
import { VerbatimTextComposer } from "../text/verbatim-text-composer.js";

export interface TypeTextHandlerOptions {
  readonly logger?: ILogger;
  /**
   * Type even when no editable field reports focus.
   *
   * Off by default. Some applications expose no focused element at all while
   * still accepting keystrokes, so this exists, but it trades a real safeguard
   * for reach.
   */
  readonly allowUnfocused?: boolean;
}

export class TypeTextHandler implements ICommandHandler {
  readonly name = "type-text";

  readonly #input: IInputDevice;
  readonly #focus: IFocusedFieldReader;
  readonly #composer: ITextComposer;
  readonly #verbatim = new VerbatimTextComposer();
  readonly #logger: ILogger | undefined;
  readonly #allowUnfocused: boolean;

  constructor(
    input: IInputDevice,
    focus: IFocusedFieldReader,
    composer: ITextComposer = new VerbatimTextComposer(),
    options: TypeTextHandlerOptions = {},
  ) {
    this.#input = input;
    this.#focus = focus;
    this.#composer = composer;
    this.#logger = options.logger;
    this.#allowUnfocused = options.allowUnfocused ?? false;
  }

  /**
   * Claimed on the shape of the sentence alone.
   *
   * Deliberately does not read the screen: `canHandle` may be asked of several
   * handlers before one accepts, and none of them should be doing work.
   */
  canHandle(command: SpokenCommand): boolean {
    // On shape, not on whether the configured composer can serve it. A request
    // to compose prose is still a typing request, and saying so beats letting
    // it fall through to the screen loop to fail slowly and obscurely.
    return this.#verbatim.looksLikeTyping(command.text);
  }

  async execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const field = await this.#focus.focusedField(signal);

    if (!this.#allowUnfocused && (field === null || !field.isEditable)) {
      // Handing back to the chain rather than failing: the screen loop can
      // click into a field first, which is exactly the case it exists for.
      return unhandled("nothing editable has focus, so there is nowhere to type");
    }

    const text = await this.#composer.compose(
      {
        instruction: command.text,
        fieldLabel: field?.label ?? "",
        fieldPlaceholder: field?.placeholder ?? "",
        currentValue: field?.value ?? "",
      },
      signal,
    );

    if (text === null) {
      return failed(
        `${this.#composer.name} could not work out what to type from ${JSON.stringify(command.text)}. `
          + "Composing text that was not dictated needs a writing model.",
      );
    }

    if (text.length === 0) {
      return failed("there was nothing to type");
    }

    this.#logger?.debug("typing", { characters: text.length, field: field?.label ?? "" });
    await this.#input.typeText(text, signal);

    return completed(`typed ${JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}...` : text)}`);
  }
}
