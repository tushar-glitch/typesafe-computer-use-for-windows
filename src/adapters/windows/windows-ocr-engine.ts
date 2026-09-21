/**
 * `IOcrEngine` backed by Windows.Media.Ocr, through the sidecar.
 *
 * The engine is part of the operating system: no model files, no licence, and
 * measurably faster here than the Vision framework the macOS original uses.
 * Its one gap is that it reports no per-word confidence, so every line arrives
 * at 1.0 and confidence-based filtering of OCR text is not available.
 */

import type { IOcrEngine, OcrLine } from "../../core/ports/perception.js";
import type { Rect } from "../../core/types/geometry.js";
import type { ScreenImage } from "../../core/types/observation.js";
import { toBase64, toOcrLine, toRectDto } from "./mapping.js";
import type { OcrParams } from "./protocol.js";
import type { SidecarClient } from "./sidecar-client.js";

/** OCR of a dense screen has been measured near 600ms; the default deadline allows for it. */
const DEFAULT_OCR_TIMEOUT_MS = 10_000;

export interface WindowsOcrEngineOptions {
  readonly timeoutMs?: number;
}

export class WindowsOcrEngine implements IOcrEngine {
  readonly name = "windows.media.ocr";

  readonly #client: SidecarClient;
  readonly #timeoutMs: number;

  constructor(client: SidecarClient, options: WindowsOcrEngineOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS;
  }

  async recognize(image: ScreenImage, region?: Rect, signal?: AbortSignal): Promise<readonly OcrLine[]> {
    const params: OcrParams =
      region === undefined
        ? { imageBase64: toBase64(image.data) }
        : { imageBase64: toBase64(image.data), region: toRectDto(region) };

    const result = await this.#client.request("ocr", params, {
      timeoutMs: this.#timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });

    return result.lines.map(toOcrLine);
  }
}
