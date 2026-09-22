/**
 * Translation between wire DTOs and domain types.
 *
 * The one place that knows both vocabularies. Keeping it here means a protocol
 * change surfaces as a compile error in a single file rather than leaking
 * transport shapes through the adapters.
 */

import type { Rect } from "../../core/types/geometry.js";
import {
  elementHandle,
  type FocusedField,
  type ForegroundWindow,
  type ScreenImage,
  type UiRole,
} from "../../core/types/observation.js";
import { confidence, milliseconds, type Confidence } from "../../core/types/scalars.js";
import type { AccessibilityElement, AccessibilitySnapshot, OcrLine } from "../../core/ports/perception.js";
import type {
  CaptureDto,
  FocusedFieldDto,
  ForegroundWindowDto,
  OcrLineDto,
  RectDto,
  UiaElementDto,
  UiaTreeDto,
} from "./protocol.js";

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
    origin: { x: dto.originX, y: dto.originY },
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

/**
 * Roles the sidecar is allowed to report.
 *
 * The wire carries a plain string, so it is validated here rather than
 * asserted: a sidecar built from newer sources must not be able to smuggle an
 * unknown role into a typed union the rest of the code switches over.
 */
const KNOWN_ROLES: ReadonlySet<string> = new Set<UiRole>([
  "button",
  "link",
  "field",
  "checkbox",
  "radio",
  "tab",
  "menu",
  "list item",
  "cell",
  "image",
  "slider",
  "combo",
  "other",
]);

export function toUiRole(value: string): UiRole {
  return KNOWN_ROLES.has(value) ? (value as UiRole) : "other";
}

export function toAccessibilityElement(dto: UiaElementDto): AccessibilityElement {
  return {
    role: toUiRole(dto.role),
    label: dto.label,
    bounds: toRect(dto.bounds),
    invokable: dto.invokable,
    handle: elementHandle(dto.handle),
  };
}

export function toFocusedField(dto: FocusedFieldDto): FocusedField {
  return {
    role: toUiRole(dto.role),
    label: dto.label,
    placeholder: dto.placeholder,
    value: dto.value,
    bounds: toRect(dto.bounds),
    element: dto.handle === null ? null : elementHandle(dto.handle),
    isEditable: dto.isEditable,
  };
}

export function toAccessibilitySnapshot(dto: UiaTreeDto): AccessibilitySnapshot {
  return {
    onscreen: dto.onscreen.map(toAccessibilityElement),
    offscreen: dto.offscreen.map(toAccessibilityElement),
    focusedField: dto.focusedField === null ? null : toFocusedField(dto.focusedField),
    truncated: dto.truncated,
    examined: dto.examined,
    elapsed: milliseconds(Math.max(0, dto.elapsedMs)),
  };
}
