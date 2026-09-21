/**
 * The action space.
 *
 * A closed, discriminated union rather than a string-keyed table: adding a
 * member makes every exhaustive `switch` over it a compile error until it is
 * handled, which is the property that keeps executors and the decision
 * criteria from drifting apart.
 *
 * Members must stay mutually exclusive. Two options that mean the same thing
 * split the probability mass and read as low confidence, which stalls the loop.
 */

export type NamedKey = "enter" | "escape" | "tab" | "backspace" | "delete";

export type ScrollDirection = "up" | "down";

/** Click a visible item from the current observation. */
export interface ClickItemAction {
  readonly kind: "click_item";
  readonly itemIndex: number;
}

/** Invoke a labelled control the app exposes but does not display. */
export interface PressOffscreenAction {
  readonly kind: "press_offscreen";
  readonly controlIndex: number;
}

/** Start or focus a desktop application. Has no macOS counterpart; Windows needs it. */
export interface LaunchAppAction {
  readonly kind: "launch_app";
  readonly appId: string;
}

/** Bring the browser forward, optionally navigating it. */
export interface OpenUrlAction {
  readonly kind: "open_url";
  readonly url: string;
}

/** Fill the focused field with text composed by the writer model. */
export interface TypeTextAction {
  readonly kind: "type_text";
}

/** Fill the focused field with the configured email address. */
export interface TypeEmailAction {
  readonly kind: "type_email";
}

export interface PressKeyAction {
  readonly kind: "press_key";
  readonly key: NamedKey;
}

export interface ScrollAction {
  readonly kind: "scroll";
  readonly direction: ScrollDirection;
  readonly lines: number;
}

/** The screen is still settling; take no action this step. */
export interface WaitAction {
  readonly kind: "wait";
}

/** The goal is already satisfied. Terminal. */
export interface DoneAction {
  readonly kind: "done";
}

/** Nothing available helps with the goal. Terminal. */
export interface NoneAction {
  readonly kind: "none";
}

export type AgentAction =
  | ClickItemAction
  | PressOffscreenAction
  | LaunchAppAction
  | OpenUrlAction
  | TypeTextAction
  | TypeEmailAction
  | PressKeyAction
  | ScrollAction
  | WaitAction
  | DoneAction
  | NoneAction;

export type ActionKind = AgentAction["kind"];

/** Kinds that end a run rather than changing the screen. */
export const TERMINAL_KINDS = ["done", "none"] as const;

export type TerminalKind = (typeof TERMINAL_KINDS)[number];

export function isTerminal(action: AgentAction): action is DoneAction | NoneAction {
  return (TERMINAL_KINDS as readonly string[]).includes(action.kind);
}

/**
 * Kinds that commit to a specific target, where choosing wrong is not undone by
 * the next step. Only these gate the run on confidence.
 */
export function isTargeted(action: AgentAction): boolean {
  return action.kind === "click_item" || action.kind === "press_offscreen";
}

/** Compile-time exhaustiveness guard for switches over `AgentAction`. */
export function assertNever(value: never, message = "unhandled variant"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
