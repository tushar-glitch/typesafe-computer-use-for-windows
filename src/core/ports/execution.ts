/**
 * Changing the world.
 *
 * Split by mechanism, not by convenience: synthetic input lands at a screen
 * coordinate, element invocation goes through the accessibility tree and needs
 * no coordinate at all, and launching is an OS call that touches neither. A
 * caller that only invokes elements should not have to stub a mouse.
 */

import type { AgentAction } from "../types/action.js";
import type { Point } from "../types/geometry.js";
import type { ElementHandle, ForegroundWindow, Observation } from "../types/observation.js";
import type { NamedKey, ScrollDirection } from "../types/action.js";

/** Synthetic mouse and keyboard, in logical screen points. */
export interface IInputDevice {
  moveTo(point: Point, signal?: AbortSignal): Promise<void>;
  click(point: Point, signal?: AbortSignal): Promise<void>;
  typeText(text: string, signal?: AbortSignal): Promise<void>;
  pressKey(key: NamedKey, signal?: AbortSignal): Promise<void>;
  scroll(direction: ScrollDirection, lines: number, signal?: AbortSignal): Promise<void>;
  clearFocusedField(signal?: AbortSignal): Promise<void>;
}

/**
 * Acting on accessibility elements directly.
 *
 * Preferred over a synthetic click where available: the invocation reaches the
 * control even when a banner or tooltip covers it, and it works on elements
 * that are scrolled out of view entirely.
 */
export interface IElementInvoker {
  invoke(handle: ElementHandle, signal?: AbortSignal): Promise<boolean>;
  setValue(handle: ElementHandle, text: string, signal?: AbortSignal): Promise<boolean>;
  focus(handle: ElementHandle, signal?: AbortSignal): Promise<boolean>;
  readValue(handle: ElementHandle, signal?: AbortSignal): Promise<string | null>;
}

export interface IAppLauncher {
  /** Start or focus an application. Resolution of `appId` is the adapter's business. */
  launch(appId: string, signal?: AbortSignal): Promise<boolean>;
  openUrl(url: string, signal?: AbortSignal): Promise<boolean>;
  activate(processName: string, signal?: AbortSignal): Promise<boolean>;
  foreground(signal?: AbortSignal): Promise<ForegroundWindow>;
}

export interface ActionExecutionContext {
  readonly goal: string;
  readonly observation: Observation;
}

/** What one action did, in words the history and the stall detector can use. */
export interface ActionReport {
  readonly description: string;
  /**
   * False when the action provably changed nothing: a refusal, a failure, or a
   * deliberate wait. Consecutive ineffective actions end the run.
   */
  readonly effective: boolean;
}

/** One executor per action kind. Registered by kind; see the action registry. */
export interface IActionExecutor<TAction extends AgentAction = AgentAction> {
  readonly kind: TAction["kind"];
  execute(action: TAction, context: ActionExecutionContext, signal: AbortSignal): Promise<ActionReport>;
}
