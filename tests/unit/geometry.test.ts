import { describe, expect, it } from "vitest";
import { area, center, intersection, intersects, overlapRatio, rect, union } from "../../src/core/types/geometry.js";

describe("geometry", () => {
  it("finds the centre of a rectangle", () => {
    expect(center(rect(10, 20, 100, 40))).toEqual({ x: 60, y: 40 });
  });

  it("reports no intersection for disjoint rectangles", () => {
    expect(intersects(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toBe(false);
    expect(intersection(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toBeNull();
  });

  it("treats edge-only contact as non-intersecting", () => {
    expect(intersects(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
  });

  it("computes the overlapping region", () => {
    expect(intersection(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual(rect(5, 5, 5, 5));
  });

  it("unions to the bounding box of both", () => {
    expect(union(rect(0, 0, 10, 10), rect(20, 5, 10, 10))).toEqual(rect(0, 0, 30, 15));
  });

  it("scores a small control inside a wide text line as fully overlapping", () => {
    const textLine = rect(0, 0, 400, 20);
    const button = rect(10, 4, 40, 12);
    expect(overlapRatio(textLine, button)).toBe(1);
  });

  it("scores partial overlap against the smaller rectangle", () => {
    expect(overlapRatio(rect(0, 0, 10, 10), rect(5, 0, 10, 10))).toBeCloseTo(0.5);
  });

  it("treats negative extents as empty", () => {
    expect(area(rect(0, 0, -5, 10))).toBe(0);
  });
});
