/**
 * Branded scalars.
 *
 * A probability, a pixel count and a duration are all `number` to the compiler,
 * and confidence gating is load-bearing in this system: passing a step count
 * where a probability belongs must not typecheck.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A probability in [0, 1]. */
export type Confidence = Brand<number, "Confidence">;

/** A duration or timestamp in milliseconds. */
export type Milliseconds = Brand<number, "Milliseconds">;

/** A device-independent pixel on the captured image. */
export type Pixels = Brand<number, "Pixels">;

export class ScalarRangeError extends Error {}

export function confidence(value: number): Confidence {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ScalarRangeError(`confidence must be within [0, 1], received ${value}`);
  }
  return value as Confidence;
}

export function milliseconds(value: number): Milliseconds {
  if (!Number.isFinite(value) || value < 0) {
    throw new ScalarRangeError(`milliseconds must be finite and non-negative, received ${value}`);
  }
  return value as Milliseconds;
}

export function pixels(value: number): Pixels {
  if (!Number.isFinite(value)) {
    throw new ScalarRangeError(`pixels must be finite, received ${value}`);
  }
  return value as Pixels;
}

export const CERTAIN: Confidence = 1 as Confidence;
export const IMPOSSIBLE: Confidence = 0 as Confidence;

/** The lower of two confidences: how a compound decision is scored. */
export function weakest(a: Confidence, b: Confidence): Confidence {
  return (a < b ? a : b) as Confidence;
}
