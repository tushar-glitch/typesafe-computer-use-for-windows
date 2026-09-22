/**
 * Carrying out one decided action.
 *
 * Every path returns a description rather than throwing, because the loop
 * needs to record what happened and decide whether anything changed. A report
 * marked ineffective is how a refusal reaches the stall detector.
 */

import type {
  ActionExecutionContext,
  ActionReport,
  IAppLauncher,
  IElementInvoker,
  IInputDevice,
} from "../../core/ports/execution.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { ITextComposer } from "../../core/ports/writing.js";
import type { AgentAction } from "../../core/types/action.js";
import { assertNever } from "../../core/types/action.js";
import { center } from "../../core/types/geometry.js";
import { VerbatimTextComposer } from "../text/verbatim-text-composer.js";

export interface ActionRunnerOptions {
  readonly logger?: ILogger;
  /**
   * How the text for a type_text action is produced.
   *
   * Defaults to the verbatim composer, which can only transcribe what was
   * dictated. Requests that ask for text to be composed need a writing model,
   * which is the one thing the decision model structurally cannot supply.
   */
  readonly composer?: ITextComposer;
}

export class ActionRunner {
  readonly #input: IInputDevice;
  readonly #invoker: IElementInvoker;
  readonly #launcher: IAppLauncher;
  readonly #composer: ITextComposer;
  readonly #logger: ILogger | undefined;

  constructor(
    input: IInputDevice,
    invoker: IElementInvoker,
    launcher: IAppLauncher,
    options: ActionRunnerOptions = {},
  ) {
    this.#input = input;
    this.#invoker = invoker;
    this.#launcher = launcher;
    this.#composer = options.composer ?? new VerbatimTextComposer();
    this.#logger = options.logger;
  }

  async run(action: AgentAction, context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport> {
    switch (action.kind) {
      case "click_item":
        return await this.#clickItem(action.itemIndex, context, signal);

      case "press_offscreen":
        return await this.#pressOffscreen(action.controlIndex, context, signal);

      case "type_text":
        return await this.#typeText(context, signal);

      case "type_email":
        return ineffective("type_email refused: no email address is configured");

      case "press_key":
        await this.#input.pressKey(action.key, signal);
        return effective(`pressed ${action.key}`);

      case "scroll":
        await this.#input.scroll(action.direction, action.lines, signal);
        return effective(`scrolled ${action.direction}`);

      case "wait":
        // Deliberately ineffective: two waits in a row mean the screen is
        // stuck, and the loop should stop rather than wait forever.
        return ineffective("waited");

      case "launch_app": {
        // Focus what is already running before starting another copy.
        const entry = await this.#launcher.activate(action.appId, signal);
        if (entry) return effective(`brought ${action.appId} to the front`);

        const started = await this.#launcher.launch(action.appId, signal);
        return started ? effective(`started ${action.appId}`) : ineffective(`could not start ${action.appId}`);
      }

      case "open_url": {
        const opened = await this.#launcher.openUrl(action.url, signal);
        return opened ? effective(`opened ${action.url}`) : ineffective(`could not open ${action.url}`);
      }

      case "done":
        return effective("the goal was judged already achieved");

      case "none":
        return effective("nothing on screen was judged to help");

      default:
        return assertNever(action);
    }
  }

  /**
   * Put text in the focused field.
   *
   * The goal is the instruction, so a phrase the speaker dictated types itself
   * with no model involved at all. A goal that asks for text to be composed
   * cannot be served this way, and refusing is correct: a guess typed into a
   * live form is worse than nothing. The refusal is ineffective, so two of
   * them end the run rather than looping.
   */
  async #typeText(context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport> {
    const field = context.observation.focusedField;
    if (field === null || !field.isEditable) {
      return ineffective("type_text refused: nothing editable has focus");
    }

    const text = await this.#composer.compose(
      {
        instruction: context.goal,
        fieldLabel: field.label,
        fieldPlaceholder: field.placeholder,
        currentValue: field.value,
      },
      signal,
    );

    if (text === null || text.length === 0) {
      return ineffective(
        `type_text refused: ${this.#composer.name} cannot produce text for this goal; that needs a writing model`,
      );
    }

    await this.#input.typeText(text, signal);
    const shown = text.length > 60 ? `${text.slice(0, 60)}...` : text;
    return effective(`typed ${JSON.stringify(shown)}`);
  }

  /**
   * Press the control if the application declared one, click the pixel if not.
   *
   * Invocation is preferred because it reaches the control itself: it lands
   * even when a sticky header, cookie banner or tooltip covers the centre of
   * the box. A control that refuses still has a location, so the click remains
   * as a fallback.
   */
  async #clickItem(index: number, context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport> {
    const item = context.observation.items[index];
    if (item === undefined) {
      return ineffective(`click refused: no item numbered ${index} on this screen`);
    }

    const label = JSON.stringify(item.text.slice(0, 60));

    if (item.element !== null) {
      const accepted = await this.#invoker.invoke(item.element, signal);
      if (accepted) return effective(`pressed ${label} through the accessibility tree`);
      this.#logger?.debug("element refused invocation; falling back to a click", { item: item.text });
    }

    await this.#input.click(center(item.bounds), signal);
    return effective(item.element === null ? `clicked ${label}` : `clicked ${label} after invocation was refused`);
  }

  /**
   * Activate a control the application exposes but does not draw.
   *
   * There is no pixel to fall back on, so a refusal is the end of it and reads
   * as a no-op.
   */
  async #pressOffscreen(index: number, context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport> {
    const control = context.observation.offscreen[index];
    if (control === undefined) {
      return ineffective(`press refused: no off-screen control numbered ${index}`);
    }

    const label = JSON.stringify(control.label.slice(0, 60));
    const accepted = await this.#invoker.invoke(control.element, signal);

    return accepted
      ? effective(`pressed ${label} (off-screen) through the accessibility tree`)
      : ineffective(`press refused: ${label} did not accept it`);
  }
}

function effective(description: string): ActionReport {
  return { description, effective: true };
}

function ineffective(description: string): ActionReport {
  return { description, effective: false };
}
