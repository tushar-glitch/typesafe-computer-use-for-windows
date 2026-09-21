/**
 * Reading the screen.
 *
 * Three narrow sources rather than one "screen reader" interface: capture, OCR
 * and the accessibility tree fail independently, are mocked independently in
 * tests, and on Windows are served by different native APIs. The pipeline that
 * merges them into a single `Observation` is itself a port, so the decision
 * layer never learns how many sources there were.
 */

import type { Rect } from "../types/geometry.js";
import type {
  ElementHandle,
  ForegroundWindow,
  FocusedField,
  Observation,
  ScreenImage,
  UiRole,
} from "../types/observation.js";
import type { Confidence } from "../types/scalars.js";

export type CaptureTarget = "primary-display" | "foreground-window";

export interface ScreenCapture {
  readonly image: ScreenImage;
  readonly displayScale: number;
  readonly foreground: ForegroundWindow;
}

export interface IScreenCapturer {
  capture(target: CaptureTarget, signal?: AbortSignal): Promise<ScreenCapture>;
}

/** One line of recognised text, in captured-image pixels. */
export interface OcrLine {
  readonly text: string;
  readonly confidence: Confidence;
  readonly bounds: Rect;
}

export interface IOcrEngine {
  readonly name: string;
  /** Recognise text within `region`, or the whole image when omitted. */
  recognize(image: ScreenImage, region?: Rect, signal?: AbortSignal): Promise<readonly OcrLine[]>;
}

/** One element from the UI Automation tree, in logical screen points. */
export interface AccessibilityElement {
  readonly role: UiRole;
  readonly label: string;
  readonly bounds: Rect;
  readonly invokable: boolean;
  readonly handle: ElementHandle;
}

export interface AccessibilitySnapshot {
  readonly onscreen: readonly AccessibilityElement[];
  /** Labelled, invokable elements the app exposes but does not render. */
  readonly offscreen: readonly AccessibilityElement[];
  readonly focusedField: FocusedField | null;
  /** True when the walk hit its node or time budget and stopped early. */
  readonly truncated: boolean;
}

export interface IAccessibilityProvider {
  snapshot(processId: number, signal?: AbortSignal): Promise<AccessibilitySnapshot>;
}

/** Reads the active tab URL from a supported browser. Separate because only browsers have one. */
export interface IBrowserInspector {
  activeTabUrl(foreground: ForegroundWindow, signal?: AbortSignal): Promise<string | null>;
}

/** Composes the sources above into the single view the decision layer consumes. */
export interface IPerceptionPipeline {
  observe(signal?: AbortSignal): Promise<Observation>;
}
