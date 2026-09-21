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
  IElementInvoker,
  IInputDevice,
} from "../../core/ports/execution.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { AgentAction } from "../../core/types/action.js";
import { assertNever } from "../../core/types/action.js";
import { center } from "../../core/types/geometry.js";

export interface ActionRunnerOptions {
  readonly logger?: ILogger;
}

export class ActionRunner {
  readonly #input: IInputDevice;
  readonly #invoker: IElementInvoker;
  readonly #logger: ILogger | undefined;

  constructor(input: IInputDevice, invoker: IElementInvoker, options: ActionRunnerOptions = {}) {
    this.#input = input;
    this.#invoker = invoker;
    this.#logger = options.logger;
  }

  async run(action: AgentAction, context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport> {
    switch (action.kind) {
      case "click_item":
        return await this.#clickItem(action.itemIndex, context, signal);

      case "press_offscreen":
        return await this.#pressOffscreen(action.controlIndex, context, signal);

      case "type_text":
        // The text itself has to be composed by a writing model, which is not
        // wired in yet. Refusing is correct: typing a guess into a live form is
        // worse than doing nothing.
        return ineffective("type_text refused: no writer is configured");

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

      case "launch_app":
      case "open_url":
        // Reachable only if these are ever added to the loop action set. They
        // belong to the fast path, which runs before the loop is entered.
        return ineffective(`${action.kind} is handled by the fast path, not the screen loop`);

      case "done":
        return effective("the goal was judged already achieved");

      case "none":
        return effective("nothing on screen was judged to help");

      default:
        return assertNever(action);
    }
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
