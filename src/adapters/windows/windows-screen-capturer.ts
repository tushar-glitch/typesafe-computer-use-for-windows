/**
 * `IScreenCapturer` backed by the Windows desktop, through the sidecar.
 *
 * Prefer the "virtual-screen" target on a multi-display machine: it is the only
 * one that can contain a window on a secondary monitor, and the capture reports
 * the screen coordinate of its top-left pixel so positions found inside the
 * image can be turned back into places the mouse can reach.
 */

import type { CaptureTarget, IScreenCapturer, ScreenCapture } from "../../core/ports/perception.js";
import { toForegroundWindow, toScreenImage } from "./mapping.js";
import type { SidecarClient } from "./sidecar-client.js";

/** A full-desktop PNG is hundreds of kilobytes of base64; allow for the transfer. */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface WindowsScreenCapturerOptions {
  readonly timeoutMs?: number;
}

export class WindowsScreenCapturer implements IScreenCapturer {
  readonly #client: SidecarClient;
  readonly #timeoutMs: number;

  constructor(client: SidecarClient, options: WindowsScreenCapturerOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async capture(target: CaptureTarget, signal?: AbortSignal): Promise<ScreenCapture> {
    const dto = await this.#client.request("capture", { target }, {
      timeoutMs: this.#timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });

    return {
      image: toScreenImage(dto),
      displayScale: dto.displayScale,
      foreground: toForegroundWindow(dto.foreground),
    };
  }
}
