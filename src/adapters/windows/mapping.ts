/**
 * Translation between wire DTOs and domain types.
 *
 * The one place that knows both vocabularies. Keeping it here means a protocol
 * change surfaces as a compile error in a single file rather than leaking
 * transport shapes through the adapters.
 */

import type { Rect } from "../../core/types/geometry.js";
import type { ForegroundWindow, ScreenImage } from "../../core/types/observation.js";
import { confidence, type Confidence } from "../../core/types/scalars.js";
import type { OcrLine } from "../../core/ports/perception.js";
import type { CaptureDto, ForegroundWindowDto, OcrLineDto, RectDto } from "./protocol.js";

export function toRect(dto: RectDto): Rect {
  return { x: dto.x, y: dto.y, width: dto.width, height: dto.height };
}

export function toRectDto(rect: Rect): RectDto {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function toForegroundWindow(dto: ForegroundWindowDto): ForegroundWindow {
  return {
    processId: dto.processId,
    processName: dto.processName,
    title: dto.title,
    bounds: toRect(dto.bounds),
  };
}

export function toScreenImage(dto: CaptureDto): ScreenImage {
  return {
    data: Uint8Array.from(Buffer.from(dto.imageBase64, "base64")),
    format: "png",
    size: { width: dto.width, height: dto.height },
  };
}

/** Clamps rather than throwing: a provider reporting 1.2 is a bug we survive. */
export function toConfidence(value: number): Confidence {
  if (!Number.isFinite(value)) return confidence(0);
  return confidence(Math.min(1, Math.max(0, value)));
}

export function toOcrLine(dto: OcrLineDto): OcrLine {
  return {
    text: dto.text,
    confidence: toConfidence(dto.confidence),
    bounds: toRect(dto.bounds),
  };
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
