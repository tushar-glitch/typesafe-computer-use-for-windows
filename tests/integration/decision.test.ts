/**
 * The decision provider against live Jev.
 *
 * Skipped when TYPESAFE_API_KEY is absent, so a checkout without credentials
 * still runs green. These calls cost money, though very little: input is
 * $0.042 per million tokens and output is free.
 */

import { afterAll, describe, expect, it } from "vitest";
import { TypeSafeDecisionProvider } from "../../src/adapters/decision/typesafe-decision-provider.js";
import { booleanQuestion, choiceQuestion, rankedOptions } from "../../src/core/ports/decision.js";

const hasKey = (process.env["TYPESAFE_API_KEY"] ?? "").length > 0;

describe.skipIf(!hasKey)("TypeSafeDecisionProvider (integration)", () => {
  const provider = new TypeSafeDecisionProvider();
  const timings: number[] = [];

  afterAll(() => {
    if (timings.length > 0) {
      const sorted = [...timings].sort((a, b) => a - b);
      console.log(`\n  jev latency: ${sorted.map((t) => t.toFixed(0)).join(", ")}ms`);
    }
  });

  const timed = async <T>(run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    const value = await run();
    timings.push(performance.now() - started);
    return value;
  };

  it("answers a choice with a calibrated distribution", async () => {
    const answers = await timed(() =>
      provider.decide({
        state: {
          goal: "play the song Ride It on youtube",
          items: [
            { i: 0, text: "Ride It - Regard (Official Video)" },
            { i: 1, text: "Subscribe" },
            { i: 2, text: "Skip Ads" },
          ],
        },
        questions: {
          item: choiceQuestion("Which item should be clicked to play the song?", {
            "0": "'Ride It - Regard (Official Video)'",
            "1": "'Subscribe'",
            "2": "'Skip Ads'",
          }),
        },
      }),
    );

    expect(answers.item.choice).toBe("0");
    expect(answers.item.confidence).toBeGreaterThan(0.5);

    // The distribution must be a distribution, not just a winner.
    const total = Object.values(answers.item.probabilities).reduce((sum, p) => sum + p, 0);
    expect(total).toBeGreaterThan(0.9);
    expect(total).toBeLessThan(1.1);

    expect(rankedOptions(answers.item, 1)[0]?.[0]).toBe("0");
  });

  it("answers several questions in one round trip", async () => {
    const answers = await timed(() =>
      provider.decide({
        state: { screen: "a login form with an email field focused", goal: "log in" },
        questions: {
          kind: choiceQuestion("What should happen next?", {
            type_text: "Type into the focused field.",
            scroll_down: "Scroll to reveal more.",
            done: "The goal is already achieved.",
          }),
          finished: booleanQuestion("Is the user already logged in?"),
        },
      }),
    );

    expect(answers.kind.choice).toBe("type_text");
    expect(answers.finished.value).toBe(false);
    expect(answers.finished.probability).toBeLessThan(0.5);
  });

  it("does NOT report doubt when two options mean the same thing", async () => {
    // Pins a finding that contradicts the assumption this design was built on.
    // The macOS original states that overlapping options read as low
    // confidence. Against live Jev they do not: the tie is broken arbitrarily
    // and reported as near-certain. Mutually exclusive options still matter,
    // but because duplicates make behaviour erratic between steps, not because
    // confidence gating will catch them.
    const answers = await timed(() =>
      provider.decide({
        state: { screen: "a page with two identical Continue buttons", goal: "continue" },
        questions: {
          which: choiceQuestion("Which button should be pressed?", {
            first: "The 'Continue' button.",
            second: "The 'Continue' button.",
          }),
        },
      }),
    );

    expect(answers.which.confidence).toBeGreaterThan(0.6);
  });

  it("takes the escape option when nothing on screen serves the goal", async () => {
    // Why every choice the agent is asked needs a way out. Without one the
    // model must still name something, and it will. Offered an explicit
    // "nothing helps", it says so, which is what lets the loop stop cleanly
    // rather than clicking whatever scored least badly.
    const answers = await timed(() =>
      provider.decide({
        state: { screen: "an empty desktop with only a recycle bin and a clock", goal: "buy milk" },
        questions: {
          which: choiceQuestion("Which item serves the goal?", {
            bin: "The recycle bin icon.",
            clock: "The clock.",
            none: "Nothing on this screen helps with the goal.",
          }),
        },
      }),
    );

    expect(answers.which.choice).toBe("none");
  });

  it("honours an abort signal", async () => {
    const controller = new AbortController();
    const pending = provider.decide(
      {
        state: { goal: "anything" },
        questions: { q: choiceQuestion("pick one", { a: "first", b: "second" }) },
      },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});
