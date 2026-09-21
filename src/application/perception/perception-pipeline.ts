/**
 * One glance at the screen, assembled from three independent sources.
 *
 * Capture is sequential because the other two need its pixels, but OCR and the
 * accessibility walk run against each other rather than in turn. Measured on
 * this machine they cost roughly 150ms and 400ms; run in sequence that is 550ms
 * of a step budget, and in parallel it is whatever the slower one takes.
 *
 * Everything leaves here in one coordinate space: absolute screen pixels. OCR
 * reports positions inside the captured image, which begins at the top-left of
 * the virtual desktop and is therefore negative when a monitor sits above or
 * left of the primary. Those are translated here, once, so nothing downstream
 * has to remember which space it is holding.
 */

import type {
  AccessibilitySnapshot,
  IAccessibilityProvider,
  IOcrEngine,
  IPerceptionPipeline,
  IScreenCapturer,
  OcrLine,
  ScreenCapture,
} from "../../core/ports/perception.js";
import type { ILogger } from "../../core/ports/platform.js";
import { MAX_CHOICE_OPTIONS } from "../../core/ports/decision.js";
import type { Rect } from "../../core/types/geometry.js";
import type { Observation, OffscreenControl, UiItem } from "../../core/types/observation.js";
import { milliseconds } from "../../core/types/scalars.js";
import { mergeSources, mergeTextLines, type ControlInput } from "./merge.js";

/**
 * Slack around the foreground window when restricting where OCR reads.
 *
 * Enough for the shadow and a glyph clipped at the edge.
 */
const WINDOW_MARGIN_PX = 12;

/** Off-screen controls offered to the model. Beyond this the list is noise. */
const MAX_OFFSCREEN = 120;

export interface PerceptionPipelineOptions {
  readonly logger?: ILogger;
  /** Ceiling on items offered as options. Defaults to the provider limit. */
  readonly maxItems?: number;
  /**
   * Read text only within the foreground window.
   *
   * OCR is charged by how much text it is given, so the desktop and background
   * windows are worth skipping: they are noise to the decision either way.
   */
  readonly restrictOcrToWindow?: boolean;
}

export class PerceptionPipeline implements IPerceptionPipeline {
  readonly #capturer: IScreenCapturer;
  readonly #ocr: IOcrEngine;
  readonly #accessibility: IAccessibilityProvider;
  readonly #logger: ILogger | undefined;
  readonly #maxItems: number;
  readonly #restrictOcr: boolean;

  constructor(
    capturer: IScreenCapturer,
    ocr: IOcrEngine,
    accessibility: IAccessibilityProvider,
    options: PerceptionPipelineOptions = {},
  ) {
    this.#capturer = capturer;
    this.#ocr = ocr;
    this.#accessibility = accessibility;
    this.#logger = options.logger;
    this.#maxItems = options.maxItems ?? MAX_CHOICE_OPTIONS;
    this.#restrictOcr = options.restrictOcrToWindow ?? true;
  }

  async observe(signal?: AbortSignal): Promise<Observation> {
    const startedAt = performance.now();

    const capture = await this.#capturer.capture("virtual-screen", signal);
    const captured = performance.now();

    const region = this.#ocrRegion(capture);

    // Independent, and both slow. Racing them costs the slower one, not both.
    const [lines, tree] = await Promise.all([
      this.#ocr.recognize(capture.image, region, signal),
      this.#accessibility.snapshot({}, signal),
    ]);
    const read = performance.now();

    const items = this.#buildItems(capture, lines, tree);

    this.#logger?.debug("observed", {
      captureMs: Math.round(captured - startedAt),
      readMs: Math.round(read - captured),
      items: items.length,
      fromTree: items.filter((item) => item.source !== "ocr").length,
      offscreen: Math.min(tree.offscreen.length, MAX_OFFSCREEN),
      treeTruncated: tree.truncated,
    });

    return {
      capturedAt: milliseconds(Math.round(startedAt)),
      image: capture.image,
      displayScale: capture.displayScale,
      foreground: capture.foreground,
      items,
      offscreen: this.#offscreen(tree, items),
      focusedField: tree.focusedField,
      // Filled by a browser inspector when one is wired in.
      browserUrl: null,
    };
  }

  /**
   * Where OCR should read, in image pixels.
   *
   * Undefined means the whole capture, which is what happens when the window
   * cannot be located or covers everything anyway.
   */
  #ocrRegion(capture: ScreenCapture): Rect | undefined {
    if (!this.#restrictOcr) return undefined;

    const { origin, size } = capture.image;
    const window = capture.foreground.bounds;

    const x = Math.max(0, window.x - origin.x - WINDOW_MARGIN_PX);
    const y = Math.max(0, window.y - origin.y - WINDOW_MARGIN_PX);
    const farRight = Math.min(size.width, window.x - origin.x + window.width + WINDOW_MARGIN_PX);
    const farBottom = Math.min(size.height, window.y - origin.y + window.height + WINDOW_MARGIN_PX);

    const width = farRight - x;
    const height = farBottom - y;

    return width > 0 && height > 0 ? { x, y, width, height } : undefined;
  }

  #buildItems(capture: ScreenCapture, lines: readonly OcrLine[], tree: AccessibilitySnapshot): readonly UiItem[] {
    const { origin } = capture.image;

    // Into screen coordinates, to match what the accessibility tree reports and
    // what the mouse understands.
    const onScreen: OcrLine[] = lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      bounds: { ...line.bounds, x: line.bounds.x + origin.x, y: line.bounds.y + origin.y },
    }));

    const controls: ControlInput[] = tree.onscreen.map((element) => ({
      label: element.label,
      bounds: element.bounds,
      role: element.role,
      handle: element.handle,
    }));

    return mergeSources(mergeTextLines(onScreen), controls, this.#maxItems);
  }

  /**
   * Controls the application exposes but does not draw.
   *
   * Offered as their own list, never mixed into the items: nothing on the
   * captured image points at them, so a click would land somewhere unrelated.
   * Anything already visible is dropped, since the on-screen entry is the
   * better way to reach it.
   */
  #offscreen(tree: AccessibilitySnapshot, items: readonly UiItem[]): readonly OffscreenControl[] {
    const visible = new Set(items.map((item) => item.text));
    const seen = new Set<string>();
    const out: OffscreenControl[] = [];

    for (const element of tree.offscreen) {
      if (out.length >= MAX_OFFSCREEN) break;

      const key = `${element.role}\u0000${element.label}`;
      if (seen.has(key) || visible.has(element.label)) continue;

      seen.add(key);
      out.push({
        index: out.length,
        label: element.label,
        role: element.role,
        element: element.handle,
      });
    }

    return out;
  }
}
