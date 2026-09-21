import { describe, expect, it } from "vitest";
import {
  keptByBudget,
  mergeSources,
  mergeTextLines,
  readingOrder,
  textsMatch,
  type ControlInput,
} from "../../src/application/perception/merge.js";
import type { OcrLine } from "../../src/core/ports/perception.js";
import type { ElementHandle, UiItem } from "../../src/core/types/observation.js";
import { confidence } from "../../src/core/types/scalars.js";

const line = (text: string, x: number, y: number, width = 100, height = 16, conf = 1): OcrLine => ({
  text,
  confidence: confidence(conf),
  bounds: { x, y, width, height },
});

const control = (label: string, x: number, y: number, width = 100, height = 16): ControlInput => ({
  label,
  bounds: { x, y, width, height },
  role: "button",
  handle: `e-${label}` as ElementHandle,
});

describe("mergeTextLines", () => {
  it("joins lines that continue a block", () => {
    const merged = mergeTextLines([line("the quick brown", 10, 0), line("fox jumps over", 10, 18)]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("the quick brown fox jumps over");
  });

  it("keeps separate columns apart", () => {
    // Same rows, different left edges: two blocks, not one.
    const merged = mergeTextLines([line("left one", 10, 0), line("right one", 500, 0)]);
    expect(merged).toHaveLength(2);
  });

  it("keeps blocks apart when the vertical gap is too large", () => {
    const merged = mergeTextLines([line("heading", 10, 0), line("far below", 10, 200)]);
    expect(merged).toHaveLength(2);
  });

  it("takes the lowest confidence of the joined lines", () => {
    const merged = mergeTextLines([line("first", 10, 0, 100, 16, 0.9), line("second", 10, 18, 100, 16, 0.4)]);
    expect(merged[0]?.confidence).toBeCloseTo(0.4);
  });
});

describe("textsMatch", () => {
  it("matches when one label contains the other", () => {
    expect(textsMatch("Sign in", "Sign in with Google")).toBe(true);
  });

  it("matches on shared words", () => {
    expect(textsMatch("Add to cart", "Add to the cart")).toBe(true);
  });

  it("rejects unrelated labels", () => {
    expect(textsMatch("Sign in", "Checkout")).toBe(false);
  });

  it("rejects empty labels", () => {
    expect(textsMatch("", "anything")).toBe(false);
  });
});

describe("readingOrder", () => {
  it("orders by row, then left to right", () => {
    const items = [
      { bounds: { x: 300, y: 2, width: 50, height: 16 } },
      { bounds: { x: 10, y: 0, width: 50, height: 16 } },
      { bounds: { x: 10, y: 40, width: 50, height: 16 } },
    ];
    // Items 1 and 0 share a visual row despite different tops.
    expect(readingOrder(items)).toEqual([1, 0, 2]);
  });
});

describe("keptByBudget", () => {
  const item = (source: UiItem["source"], conf: number): UiItem => ({
    index: 0,
    text: "x",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    source,
    role: null,
    textConfidence: confidence(conf),
    element: null,
  });

  it("keeps everything when under the ceiling", () => {
    expect(keptByBudget([item("ocr", 0.1), item("ocr", 0.2)], 10)).toEqual([0, 1]);
  });

  it("drops the faintest OCR text first", () => {
    const items = [item("ocr", 0.9), item("ocr", 0.1), item("ocr", 0.5)];
    expect(keptByBudget(items, 2)).toEqual([0, 2]);
  });

  it("never drops a declared control for a line of text", () => {
    // The control has the lowest confidence but must survive.
    const items = [item("ocr", 0.9), item("uia", 0.0), item("ocr", 0.8)];
    expect(keptByBudget(items, 1)).toEqual([1]);
  });
});

describe("mergeSources", () => {
  it("fuses a control with the text that names it", () => {
    const items = mergeSources([line("Sign in", 10, 10)], [control("Sign in", 12, 11)], 255);

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("uia+ocr");
    expect(items[0]?.element).toBe("e-Sign in");
    expect(items[0]?.role).toBe("button");
  });

  it("keeps an icon-only control that OCR cannot see", () => {
    const items = mergeSources([], [control("Close", 900, 4, 20, 20)], 255);

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("uia");
    expect(items[0]?.text).toBe("Close");
  });

  it("keeps text with no control behind it", () => {
    const items = mergeSources([line("Terms of service", 10, 500)], [], 255);

    expect(items[0]?.source).toBe("ocr");
    expect(items[0]?.element).toBeNull();
    expect(items[0]?.role).toBeNull();
  });

  it("does not fuse a control with unrelated text it merely overlaps", () => {
    // Same pixels, different meaning: two entries, not one.
    const items = mergeSources([line("Advertisement", 10, 10)], [control("Close", 10, 10)], 255);
    expect(items).toHaveLength(2);
  });

  it("does not let one text block claim two controls", () => {
    const items = mergeSources(
      [line("Add to cart", 10, 10)],
      [control("Add to cart", 10, 10), control("Add to cart", 10, 10)],
      255,
    );

    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.source === "uia+ocr")).toHaveLength(1);
    expect(items.filter((item) => item.source === "uia")).toHaveLength(1);
  });

  it("numbers items in reading order, contiguously from zero", () => {
    const items = mergeSources(
      [line("bottom", 10, 200), line("top right", 300, 0), line("top left", 10, 0)],
      [],
      255,
    );

    expect(items.map((item) => item.text)).toEqual(["top left", "top right", "bottom"]);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it("renumbers contiguously after the budget cut", () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(`item ${i}`, 10, i * 40, 100, 16, 0.5 + i / 100));
    const items = mergeSources(lines, [], 4);

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2, 3]);
  });
});
