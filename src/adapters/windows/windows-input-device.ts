/**
 * `IInputDevice` backed by Win32 SendInput, through the sidecar.
 *
 * Coordinates are physical screen pixels, the same space capture, window
 * rectangles and UI Automation bounds use, because the sidecar declares
 * per-monitor DPI awareness before anything else runs. There is deliberately
 * no conversion step anywhere in this file.
 */

import type { IInputDevice } from "../../core/ports/execution.js";
import type { NamedKey, ScrollDirection } from "../../core/types/action.js";
import type { Point } from "../../core/types/geometry.js";
import type { SidecarRequestOptions } from "./sidecar-client.js";
import type { SidecarClient } from "./sidecar-client.js";

/**
 * Lines per wheel notch.
 *
 * The Windows default for a wheel detent, so a scroll expressed in lines lands
 * roughly where the same gesture from a real mouse would.
 */
const LINES_PER_NOTCH = 3;

/** Input is a local call; a slow one means the sidecar is wedged, not busy. */
const DEFAULT_TIMEOUT_MS = 5_000;

const NO_PARAMS = {} as Readonly<Record<string, never>>;

export interface WindowsInputDeviceOptions {
  readonly timeoutMs?: number;
}

export class WindowsInputDevice implements IInputDevice {
  readonly #client: SidecarClient;
  readonly #timeoutMs: number;

  constructor(client: SidecarClient, options: WindowsInputDeviceOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async moveTo(point: Point, signal?: AbortSignal): Promise<void> {
    await this.#client.request("input_move", { x: point.x, y: point.y }, this.#options(signal));
  }

  async click(point: Point, signal?: AbortSignal): Promise<void> {
    await this.#client.request("input_click", { x: point.x, y: point.y }, this.#options(signal));
  }

  async typeText(text: string, signal?: AbortSignal): Promise<void> {
    // An empty fill is a decision made upstream, not a keystroke to send.
    if (text.length === 0) return;
    await this.#client.request("input_type", { text }, this.#options(signal));
  }

  async pressKey(key: NamedKey, signal?: AbortSignal): Promise<void> {
    await this.#client.request("input_key", { key }, this.#options(signal));
  }

  async scroll(direction: ScrollDirection, lines: number, signal?: AbortSignal): Promise<void> {
    // Win32 counts a positive wheel delta as scrolling up, away from the user.
    const magnitude = Math.max(1, Math.round(Math.abs(lines) / LINES_PER_NOTCH));
    const notches = direction === "up" ? magnitude : -magnitude;
    await this.#client.request("input_scroll", { notches }, this.#options(signal));
  }

  async clearFocusedField(signal?: AbortSignal): Promise<void> {
    await this.#client.request("input_clear_field", NO_PARAMS, this.#options(signal));
  }

  /** `exactOptionalPropertyTypes` forbids passing an explicitly undefined signal. */
  #options(signal: AbortSignal | undefined): SidecarRequestOptions {
    return { timeoutMs: this.#timeoutMs, ...(signal === undefined ? {} : { signal }) };
  }
}
