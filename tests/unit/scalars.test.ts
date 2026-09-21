import { describe, expect, it } from "vitest";
import { ScalarRangeError, confidence, milliseconds, weakest } from "../../src/core/types/scalars.js";

describe("confidence", () => {
  it("accepts the closed unit interval", () => {
    expect(confidence(0)).toBe(0);
    expect(confidence(1)).toBe(1);
    expect(confidence(0.42)).toBeCloseTo(0.42);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (value) => {
    expect(() => confidence(value)).toThrow(ScalarRangeError);
  });

  it("takes the weaker of a compound decision", () => {
    expect(weakest(confidence(0.9), confidence(0.3))).toBe(0.3);
  });
});

describe("milliseconds", () => {
  it("rejects negative durations", () => {
    expect(() => milliseconds(-1)).toThrow(ScalarRangeError);
  });
});
