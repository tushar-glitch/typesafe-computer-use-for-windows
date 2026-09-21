/**
 * The sidecar wire protocol.
 *
 * Newline-delimited JSON over stdin/stdout. Every request carries an id and is
 * answered by exactly one response bearing the same id; the sidecar may answer
 * out of order, so the client correlates rather than assuming a queue.
 *
 * These are transport shapes, not domain types. They use primitives that
 * survive JSON (base64 for pixels, plain numbers for rectangles) and are
 * translated into `core` types by the adapters. Keeping the two apart means a
 * protocol change cannot silently alter the domain.
 */

import type { CaptureTarget } from "../../core/ports/perception.js";

export const PROTOCOL_VERSION = 1;

export interface RectDto {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ForegroundWindowDto {
  readonly processId: number;
  readonly processName: string;
  readonly title: string;
  readonly bounds: RectDto;
}

export interface CaptureDto {
  /** PNG bytes, base64 encoded. */
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  /** Captured pixels per logical screen point. */
  readonly displayScale: number;
  readonly foreground: ForegroundWindowDto;
}

export interface OcrLineDto {
  readonly text: string;
  /**
   * Always 1.0 from Windows OCR, which reports no per-word confidence.
   * Preserved so another engine can supply a real value.
   */
  readonly confidence: number;
  readonly bounds: RectDto;
}

export interface OcrResultDto {
  readonly lines: readonly OcrLineDto[];
  /** BCP-47 tag of the recogniser that ran, e.g. "en-US". */
  readonly language: string;
}

export interface OcrParams {
  readonly imageBase64: string;
  /** Restricts recognition to one rectangle of the image. */
  readonly region?: RectDto;
}

export interface UiaElementDto {
  /** Already normalised to one word by the sidecar; unknown values map to "other". */
  readonly role: string;
  readonly label: string;
  readonly bounds: RectDto;
  readonly invokable: boolean;
  /** Opaque handle to the live element, resolvable by the sidecar for a later action. */
  readonly handle: string;
}

export interface FocusedFieldDto {
  readonly role: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly bounds: RectDto;
  readonly handle: string | null;
  readonly isEditable: boolean;
}

export interface UiaTreeDto {
  readonly onscreen: readonly UiaElementDto[];
  readonly offscreen: readonly UiaElementDto[];
  readonly focusedField: FocusedFieldDto | null;
  readonly truncated: boolean;
  readonly examined: number;
  readonly skipped: number;
  readonly fetchMs: number;
  readonly classifyMs: number;
  readonly elapsedMs: number;
}

export interface UiaTreeParams {
  /** Wall-clock ceiling for the walk, in milliseconds. */
  readonly budgetMs?: number;
}

/** Acknowledgement for an action with nothing to report but success. */
export interface ActionAckDto {
  readonly ok: boolean;
}

/**
 * Whether a control accepted an accessibility action.
 *
 * False is an ordinary outcome, not a failure: controls advertise patterns and
 * then decline them, and the caller falls back to a synthetic click.
 */
export interface ElementActionDto {
  readonly accepted: boolean;
}

export interface ElementValueDto {
  readonly value: string | null;
}

export interface LaunchDto {
  readonly started: boolean;
}

export interface ActivateDto {
  readonly activated: boolean;
}

export interface PointParams {
  readonly x: number;
  readonly y: number;
}

export interface PingDto {
  readonly protocolVersion: number;
  readonly sidecarVersion: string;
  readonly processId: number;
}

export type EmptyParams = Readonly<Record<string, never>>;

/**
 * Every command the sidecar serves, with its parameter and result shape.
 *
 * Adding a command here is what makes it callable and type-checked; the client
 * has no untyped escape hatch.
 */
export interface SidecarCommands {
  readonly ping: { readonly params: EmptyParams; readonly result: PingDto };
  readonly foreground: { readonly params: EmptyParams; readonly result: ForegroundWindowDto };
  readonly capture: { readonly params: { readonly target: CaptureTarget }; readonly result: CaptureDto };
  readonly ocr: { readonly params: OcrParams; readonly result: OcrResultDto };
  readonly uia_tree: { readonly params: UiaTreeParams; readonly result: UiaTreeDto };

  readonly input_click: { readonly params: PointParams; readonly result: ActionAckDto };
  readonly input_move: { readonly params: PointParams; readonly result: ActionAckDto };
  readonly input_type: { readonly params: { readonly text: string }; readonly result: ActionAckDto };
  readonly input_key: { readonly params: { readonly key: string }; readonly result: ActionAckDto };
  readonly input_scroll: { readonly params: { readonly notches: number }; readonly result: ActionAckDto };
  readonly input_clear_field: { readonly params: EmptyParams; readonly result: ActionAckDto };

  readonly element_invoke: { readonly params: { readonly handle: string }; readonly result: ElementActionDto };
  readonly element_set_value: {
    readonly params: { readonly handle: string; readonly text: string };
    readonly result: ElementActionDto;
  };
  readonly element_focus: { readonly params: { readonly handle: string }; readonly result: ElementActionDto };
  readonly element_read_value: { readonly params: { readonly handle: string }; readonly result: ElementValueDto };

  readonly launch_app: { readonly params: { readonly appId: string }; readonly result: LaunchDto };
  readonly open_url: { readonly params: { readonly url: string }; readonly result: LaunchDto };
  readonly activate_app: { readonly params: { readonly processName: string }; readonly result: ActivateDto };
}

export type SidecarCommandName = keyof SidecarCommands & string;

export type ParamsOf<C extends SidecarCommandName> = SidecarCommands[C]["params"];

export type ResultOf<C extends SidecarCommandName> = SidecarCommands[C]["result"];

export interface SidecarRequestEnvelope {
  readonly id: string;
  readonly command: string;
  readonly params: unknown;
}

export interface SidecarErrorBody {
  readonly code: string;
  readonly message: string;
}

export type SidecarResponseEnvelope =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: SidecarErrorBody };

/** Narrows a parsed line to a response envelope without trusting the sidecar. */
export function isResponseEnvelope(value: unknown): value is SidecarResponseEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["id"] !== "string") return false;
  if (candidate["ok"] === true) return "result" in candidate;
  if (candidate["ok"] === false) {
    const error = candidate["error"];
    if (typeof error !== "object" || error === null) return false;
    const body = error as Record<string, unknown>;
    return typeof body["code"] === "string" && typeof body["message"] === "string";
  }
  return false;
}
