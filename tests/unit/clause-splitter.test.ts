import { describe, expect, it } from "vitest";
import { splitClauses } from "../../src/application/segmentation/clause-splitter.js";

const texts = (transcript: string, isFinal = false): string[] =>
  splitClauses(transcript, isFinal).map((clause) => clause.text);

describe("splitClauses", () => {
  it("splits a chained request into spoken order", () => {
    expect(texts("open chrome and then open youtube and play ride it")).toEqual([
      "open chrome",
      "open youtube",
      "play ride it",
    ]);
  });

  it("marks every clause but the last as settled while speech continues", () => {
    const clauses = splitClauses("open chrome and then open youtube", false);

    expect(clauses[0]?.settled).toBe(true);
    expect(clauses[1]?.settled).toBe(false);
  });

  it("settles the last clause once the utterance is final", () => {
    const clauses = splitClauses("open chrome and then open youtube", true);
    expect(clauses.every((clause) => clause.settled)).toBe(true);
  });

  it("prefers the longer connector at the same position", () => {
    // "and then" must be consumed whole, not leave "then" behind.
    expect(texts("open chrome and then open youtube")).toEqual(["open chrome", "open youtube"]);
  });

  it("ignores connectors inside a word", () => {
    expect(texts("open andover council website")).toEqual(["open andover council website"]);
  });

  it("handles a trailing connector mid-sentence", () => {
    // The speaker has said "and" and not yet what follows.
    expect(texts("open chrome and")).toEqual(["open chrome and"]);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(splitClauses("", false)).toEqual([]);
    expect(splitClauses("   ", false)).toEqual([]);
  });

  it("keeps a single clause single", () => {
    const clauses = splitClauses("play ride it on youtube", false);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.settled).toBe(false);
  });
});
