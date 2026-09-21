import { describe, expect, it } from "vitest";
import { choiceQuestion, rankedOptions } from "../../src/core/ports/decision.js";
import { confidence } from "../../src/core/types/scalars.js";

describe("choiceQuestion", () => {
  it("preserves option keys as literal types", () => {
    const question = choiceQuestion("which action?", {
      click_item: "click something",
      wait: "do nothing yet",
    });
    // Compile-time: `choice` below is "click_item" | "wait", not string.
    const answer = { choice: "wait", confidence: confidence(0.8), probabilities: { click_item: 0.2, wait: 0.8 } } as const;
    expect(question.criteria.wait).toBe("do nothing yet");
    expect(answer.choice).toBe("wait");
  });
});

describe("rankedOptions", () => {
  it("returns the most probable options first, capped", () => {
    const answer = {
      choice: "b" as const,
      confidence: confidence(0.6),
      probabilities: { a: 0.1, b: 0.6, c: 0.3 },
    };
    expect(rankedOptions(answer, 2)).toEqual([
      ["b", 0.6],
      ["c", 0.3],
    ]);
  });
});
