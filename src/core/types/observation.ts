/** What one glance at the screen yields, after OCR and the UIA tree are merged. */

import type { Point, Rect, Size } from "./geometry.js";
import type { Confidence, Milliseconds } from "./scalars.js";

/** Where an item came from. `uia+ocr` means both sources agreed on the same thing. */
export type UiSource = "ocr" | "uia" | "uia+ocr";

/**
 * A normalised, human-readable control role.
 *
 * UI Automation reports dozens of control types; the decision model reads one
 * short word, so unknown types collapse to "other".
 */
export type UiRole =
  | "button"
  | "link"
  | "field"
  | "checkbox"
  | "radio"
  | "tab"
  | "menu"
  | "list item"
  | "cell"
  | "image"
  | "slider"
  | "combo"
  | "other";

/**
 * An opaque handle to a live UI Automation element held by the sidecar.
 *
 * The TypeScript side never dereferences it; it hands it back when it wants
 * that element invoked or filled.
 */
export type ElementHandle = string & { readonly __element?: never };

/** One thing on screen worth acting on. */
export interface UiItem {
  /** Position in reading order. Stable only within a single observation. */
  readonly index: number;
  readonly text: string;
  readonly bounds: Rect;
  readonly source: UiSource;
  /** Empty for OCR-only items, which have no declared role. */
  readonly role: UiRole | null;
  readonly textConfidence: Confidence;
  /** Present when the item came from the UIA tree and can be invoked directly. */
  readonly element: ElementHandle | null;
}

/**
 * A labelled control the application exposes but does not render on screen.
 *
 * Offered separately from `UiItem`, never mixed in: nothing on the captured
 * image points at these, so a synthetic click would land somewhere unrelated.
 * They are reachable only by invoking the element itself.
 */
export interface OffscreenControl {
  readonly index: number;
  readonly label: string;
  readonly role: UiRole;
  readonly element: ElementHandle;
}

/** The text field that currently holds keyboard focus. */
export interface FocusedField {
  readonly role: UiRole;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly bounds: Rect;
  readonly element: ElementHandle | null;
  readonly isEditable: boolean;
}

/** The raw captured image. Kept out of the decision path; used by the writer model. */
export interface ScreenImage {
  readonly data: Uint8Array;
  readonly format: "png";
  readonly size: Size;
  /**
   * Screen coordinate of image pixel (0,0).
   *
   * Not always the origin. A capture spanning every monitor starts at the
   * top-left of the virtual desktop, which is negative when a display sits
   * above or left of the primary one. Anything turning a pixel into a place
   * the mouse can go must account for it.
   */
  readonly origin: Point;
}

/** The foreground window at capture time. */
export interface ForegroundWindow {
  readonly processId: number;
  readonly processName: string;
  readonly title: string;
  readonly bounds: Rect;
}

/** Everything known about the display at one instant. */
export interface Observation {
  readonly capturedAt: Milliseconds;
  readonly image: ScreenImage;
  /** Captured image pixels per logical screen point. */
  readonly displayScale: number;
  readonly foreground: ForegroundWindow;
  readonly items: readonly UiItem[];
  readonly offscreen: readonly OffscreenControl[];
  readonly focusedField: FocusedField | null;
  /** Active tab URL when the foreground window is a supported browser. */
  readonly browserUrl: string | null;
}
