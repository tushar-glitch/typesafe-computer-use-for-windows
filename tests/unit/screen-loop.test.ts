import { describe, expect, it, vi } from "vitest";
import { ActionRunner } from "../../src/application/loop/action-runner.js";
import { ScreenLoopHandler } from "../../src/application/loop/screen-loop-handler.js";
import type { IElementInvoker, IInputDevice } from "../../src/core/ports/execution.js";
import type { Observation } from "../../src/core/types/observation.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { FakeDecisionProvider, type ScriptedAnswer } from "../fixtures/fake-decision-provider.js";
import { FakePerception, item, observation, offscreenControl } from "../fixtures/fake-perception.js";
import { spoken } from "../fixtures/fake-launcher.js";

const NEVER_ABORTED = new AbortController().signal;

function inputSpy(): IInputDevice {
  return {
    moveTo: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    clearFocusedField: vi.fn(async () => undefined),
  };
}

function invokerSpy(accepted = true): IElementInvoker {
  return {
    invoke: vi.fn(async () => accepted),
    setValue: vi.fn(async () => accepted),
    focus: vi.fn(async () => accepted),
    readValue: vi.fn(async () => null),
  };
}

interface Harness {
  readonly loop: ScreenLoopHandler;
  readonly input: IInputDevice;
  readonly invoker: IElementInvoker;
  readonly decisions: FakeDecisionProvider;
  readonly clock: FakeClock;
}

function harness(
  frames: Observation | readonly Observation[],
  script: Readonly<Record<string, ScriptedAnswer>>,
  options: { maxSteps?: number; minConfidence?: number; invokeAccepted?: boolean } = {},
): Harness {
  const input = inputSpy();
  const invoker = invokerSpy(options.invokeAccepted ?? true);
  const decisions = new FakeDecisionProvider(script);
  const clock = new FakeClock();

  const loop = new ScreenLoopHandler(
    new FakePerception(frames),
    decisions,
    new ActionRunner(input, invoker),
    clock,
    { maxSteps: options.maxSteps ?? 5, minConfidence: options.minConfidence ?? 0.4, settleMs: 10 },
  );

  return { loop, input, invoker, decisions, clock };
}

describe("ScreenLoopHandler stop rules", () => {
  it("completes when the model says the goal is achieved", async () => {
    const { loop } = harness(observation(), { kind: { choice: "done" } });
    const outcome = await loop.execute(spoken("do the thing"), NEVER_ABORTED);

    expect(outcome.status).toBe("completed");
  });

  it("fails when nothing on screen helps", async () => {
    const { loop } = harness(observation(), { kind: { choice: "none" } });
    const outcome = await loop.execute(spoken("buy milk"), NEVER_ABORTED);

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toContain("nothing on screen");
  });

  it("stops rather than click something it is unsure of", async () => {
    const { loop, input, invoker } = harness(
      observation({ items: [item(0, "Maybe this"), item(1, "Or this")] }),
      { kind: { choice: "click_item", confidence: 0.9 }, item: { choice: "0", confidence: 0.3 } },
    );

    const outcome = await loop.execute(spoken("click something"), NEVER_ABORTED);

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toContain("not confident enough");
    // Nothing was touched.
    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(input.click).not.toHaveBeenCalled();
  });

  it("gates on the weaker of the two answers that chose the target", async () => {
    // Certain it should click, unsure what: still too unsure to act.
    const { loop } = harness(
      observation({ items: [item(0, "A")] }),
      { kind: { choice: "click_item", confidence: 1 }, item: { choice: "0", confidence: 0.2 } },
    );

    const outcome = await loop.execute(spoken("click"), NEVER_ABORTED);
    expect(outcome.status).toBe("failed");
  });

  it("does not gate actions the next step could undo", async () => {
    // A low-confidence scroll is harmless, so the loop proceeds and eventually
    // runs out of steps rather than refusing to act.
    const { loop, input } = harness(observation(), { kind: { choice: "scroll_down", confidence: 0.1 } }, { maxSteps: 2 });

    const outcome = await loop.execute(spoken("find something"), NEVER_ABORTED);

    expect(input.scroll).toHaveBeenCalled();
    expect(outcome.status === "failed" && outcome.reason).toContain("gave up after 2 steps");
  });

  it("stops when repeated actions change nothing", async () => {
    // The same action on an unchanging screen, twice, is stuck.
    const { loop } = harness(observation(), { kind: { choice: "wait" } });
    const outcome = await loop.execute(spoken("wait for it"), NEVER_ABORTED);

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toContain("changed nothing");
  });

  it("gives up at the step limit", async () => {
    const frames = [
      observation({ items: [item(0, "One")] }),
      observation({ items: [item(0, "Two")] }),
      observation({ items: [item(0, "Three")] }),
    ];
    const { loop } = harness(frames, { kind: { choice: "click_item" }, item: { choice: "0" } }, { maxSteps: 3 });

    const outcome = await loop.execute(spoken("keep clicking"), NEVER_ABORTED);
    expect(outcome.status === "failed" && outcome.reason).toContain("gave up after 3 steps");
  });

  it("stops immediately when the speaker moves on", async () => {
    const controller = new AbortController();
    controller.abort();

    const { loop } = harness(observation(), { kind: { choice: "done" } });
    const outcome = await loop.execute(spoken("never mind"), controller.signal);

    expect(outcome.status).toBe("cancelled");
  });

  it("fails cleanly when the model names an item that is not there", async () => {
    const { loop } = harness(
      observation({ items: [item(0, "Only one")] }),
      { kind: { choice: "click_item" }, item: { choice: "7" } },
    );

    const outcome = await loop.execute(spoken("click"), NEVER_ABORTED);
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toContain("not an item on this screen");
  });
});

describe("ScreenLoopHandler actions", () => {
  it("prefers invoking the control over clicking its pixels", async () => {
    const { loop, input, invoker } = harness(
      [observation({ items: [item(0, "Play") ] }), observation()],
      { kind: { choice: "click_item" }, item: { choice: "0" } },
      { maxSteps: 1 },
    );

    await loop.execute(spoken("play it"), NEVER_ABORTED);

    expect(invoker.invoke).toHaveBeenCalledWith("e0", expect.anything());
    expect(input.click).not.toHaveBeenCalled();
  });

  it("falls back to a click when the control refuses", async () => {
    const { loop, input } = harness(
      observation({ items: [item(0, "Play")] }),
      { kind: { choice: "click_item" }, item: { choice: "0" } },
      { maxSteps: 1, invokeAccepted: false },
    );

    await loop.execute(spoken("play it"), NEVER_ABORTED);

    // Centre of the item box, in screen coordinates.
    expect(input.click).toHaveBeenCalledWith({ x: 200, y: 112 }, expect.anything());
  });

  it("clicks OCR-only items, which have no control to invoke", async () => {
    const { loop, input, invoker } = harness(
      observation({ items: [item(0, "Plain text", { source: "ocr", role: null, element: null })] }),
      { kind: { choice: "click_item" }, item: { choice: "0" } },
      { maxSteps: 1 },
    );

    await loop.execute(spoken("click the text"), NEVER_ABORTED);

    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(input.click).toHaveBeenCalled();
  });

  it("activates a control that is not on screen", async () => {
    const { loop, invoker, input } = harness(
      observation({ offscreen: [offscreenControl(0, "Settings")] }),
      { kind: { choice: "press_offscreen" }, offscreen: { choice: "0" } },
      { maxSteps: 1 },
    );

    await loop.execute(spoken("open settings"), NEVER_ABORTED);

    expect(invoker.invoke).toHaveBeenCalledWith("o0", expect.anything());
    // There is no pixel to aim at, so no click may be attempted.
    expect(input.click).not.toHaveBeenCalled();
  });
});

describe("ScreenLoopHandler questions", () => {
  it("offers press_offscreen only when hidden controls exist", async () => {
    const { loop, decisions } = harness(observation(), { kind: { choice: "done" } });
    await loop.execute(spoken("x"), NEVER_ABORTED);

    const criteria = Object.keys(
      (decisions.requests[0]?.questions["kind"] as { criteria: Record<string, string> }).criteria,
    );
    expect(criteria).not.toContain("press_offscreen");
    // The escape hatch is never optional.
    expect(criteria).toContain("none");
    expect(criteria).toContain("done");
  });

  it("omits the item question when the screen has no items", async () => {
    const { loop, decisions } = harness(observation(), { kind: { choice: "done" } });
    await loop.execute(spoken("x"), NEVER_ABORTED);

    expect(decisions.requests[0]?.questions["item"]).toBeUndefined();
  });

  it("shows the model what it has already tried", async () => {
    const frames = [observation({ items: [item(0, "A")] }), observation({ items: [item(0, "B")] })];
    const { loop, decisions } = harness(frames, { kind: { choice: "click_item" }, item: { choice: "0" } }, { maxSteps: 2 });

    await loop.execute(spoken("click twice"), NEVER_ABORTED);

    const second = decisions.requests[1]?.state as { previous_actions: string[] };
    expect(second.previous_actions).toHaveLength(1);
    expect(second.previous_actions[0]).toContain("pressed");
  });
});
