import { describe, expect, it } from "vitest";
import { JevIntentSegmenter } from "../../src/application/segmentation/jev-intent-segmenter.js";
import type { SpokenCommand } from "../../src/core/types/command.js";
import type { TranscriptUpdate } from "../../src/core/types/transcript.js";
import { confidence, milliseconds } from "../../src/core/types/scalars.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { FakeDecisionProvider, type ScriptedAnswer } from "../fixtures/fake-decision-provider.js";

const NEVER_ABORTED = new AbortController().signal;

function update(text: string, options: Partial<TranscriptUpdate> = {}): TranscriptUpdate {
  return {
    text,
    isFinal: false,
    confidence: confidence(0.95),
    at: milliseconds(0),
    utteranceId: "u1",
    ...options,
  };
}

async function* stream(...updates: readonly TranscriptUpdate[]): AsyncIterable<TranscriptUpdate> {
  for (const value of updates) yield value;
}

async function collect(
  updates: readonly TranscriptUpdate[],
  script: Readonly<Record<string, ScriptedAnswer>>,
  options: { clock?: FakeClock; threshold?: number } = {},
): Promise<{ commands: SpokenCommand[]; decisions: FakeDecisionProvider }> {
  const decisions = new FakeDecisionProvider(script);
  const clock = options.clock ?? new FakeClock();
  const segmenter = new JevIntentSegmenter(decisions, clock, {
    ...(options.threshold === undefined ? {} : { speculativeThreshold: options.threshold }),
    minAskIntervalMs: 0,
  });

  const commands: SpokenCommand[] = [];
  for await (const command of segmenter.segment(stream(...updates), NEVER_ABORTED)) {
    commands.push(command);
  }

  return { commands, decisions };
}

describe("JevIntentSegmenter", () => {
  it("dispatches a settled clause without asking the model", async () => {
    // "and then" proves the first clause is finished; no judgement needed.
    const { commands, decisions } = await collect(
      [update("open chrome and then open the calculator")],
      { status: { choice: "incomplete" } },
    );

    expect(commands.map((c) => c.text)).toEqual(["open chrome"]);
    // Exactly one question, about the trailing fragment. The settled clause
    // cost nothing, which is the point of splitting on connectors.
    expect(decisions.requests).toHaveLength(1);
    expect((decisions.requests[0]?.state as { fragment: string }).fragment).toBe("open the calculator");
  });

  it("acts on a trailing clause once the model says it is complete", async () => {
    const { commands } = await collect([update("open notepad")], {
      status: { choice: "ready", confidence: 0.9 },
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.text).toBe("open notepad");
    expect(commands[0]?.timing).toBe("speculative");
  });

  it("waits while the speaker is still forming the instruction", async () => {
    const { commands } = await collect([update("open the")], { status: { choice: "incomplete" } });
    expect(commands).toEqual([]);
  });

  it("ignores chatter", async () => {
    const { commands } = await collect([update("hmm what was it called again")], {
      status: { choice: "chatter", confidence: 1 },
    });
    expect(commands).toEqual([]);
  });

  it("refuses to act early on a shaky judgement", async () => {
    // Ready, but not confidently. Acting on half a sentence needs a high bar.
    const { commands } = await collect([update("open notepad")], {
      status: { choice: "ready", confidence: 0.5 },
    });
    expect(commands).toEqual([]);
  });

  it("never asks about a fragment too short to be an instruction", async () => {
    const { commands, decisions } = await collect([update("open")], { status: { choice: "ready" } });

    expect(commands).toEqual([]);
    expect(decisions.requests).toEqual([]);
  });

  it("does not re-ask about words it has already judged", async () => {
    // Transcripts repeat unchanged while the speaker pauses.
    const { decisions } = await collect(
      [update("open notepad"), update("open notepad"), update("open notepad")],
      { status: { choice: "incomplete" } },
    );

    expect(decisions.requests).toHaveLength(1);
  });

  it("dispatches each clause once as the sentence grows", async () => {
    const { commands } = await collect(
      [
        update("open chrome"),
        update("open chrome and then open youtube"),
        update("open chrome and then open youtube and play ride it", { isFinal: true }),
      ],
      { status: { choice: "incomplete" } },
    );

    // Each becomes settled in turn as the speaker moves past it.
    expect(commands.map((c) => c.text)).toEqual(["open chrome", "open youtube", "play ride it"]);
  });

  it("marks clauses confirmed once the utterance is final", async () => {
    const { commands } = await collect([update("open notepad", { isFinal: true })], {
      status: { choice: "incomplete" },
    });

    expect(commands[0]?.timing).toBe("confirmed");
  });

  it("supersedes a clause the engine revised after it was acted on", async () => {
    // "play right it" heard early, corrected to "play ride it" by the final
    // transcript. The speaker never said the first thing.
    const { commands } = await collect(
      [
        update("play right it"),
        update("play ride it", { isFinal: true }),
      ],
      { status: { choice: "ready", confidence: 0.95 } },
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]?.text).toBe("play right it");
    expect(commands[1]?.text).toBe("play ride it");
    // The id, not the text. Matching by text silently never cancels anything,
    // because the queue looks commands up by id.
    expect(commands[1]?.supersedes).toBe(commands[0]?.id);
    expect(commands[1]?.timing).toBe("confirmed");
  });

  it("does not supersede when the words did not change", async () => {
    const { commands } = await collect(
      [update("open notepad"), update("open notepad", { isFinal: true })],
      { status: { choice: "ready", confidence: 0.95 } },
    );

    expect(commands).toHaveLength(1);
  });

  it("starts clean on a new utterance", async () => {
    const { commands } = await collect(
      [
        update("open notepad", { isFinal: true }),
        update("open notepad", { utteranceId: "u2", isFinal: true }),
      ],
      { status: { choice: "ready", confidence: 0.95 } },
    );

    // The same words spoken twice are two separate requests.
    expect(commands).toHaveLength(2);
    expect(commands[0]?.utteranceId).toBe("u1");
    expect(commands[1]?.utteranceId).toBe("u2");
    expect(commands[1]?.supersedes).toBeNull();
  });

  it("gives every command a distinct id", async () => {
    const { commands } = await collect(
      [update("open chrome and then open youtube and play ride it", { isFinal: true })],
      { status: { choice: "incomplete" } },
    );

    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
  });

  it("stops when the listener is shut down", async () => {
    const controller = new AbortController();
    controller.abort();

    const segmenter = new JevIntentSegmenter(new FakeDecisionProvider(), new FakeClock(), {});
    const commands: SpokenCommand[] = [];
    for await (const command of segmenter.segment(stream(update("open notepad")), controller.signal)) {
      commands.push(command);
    }

    expect(commands).toEqual([]);
  });
});

describe("JevIntentSegmenter debouncing", () => {
  it("does not ask twice within the minimum interval", async () => {
    const decisions = new FakeDecisionProvider({ status: { choice: "incomplete" } });
    const clock = new FakeClock();
    const segmenter = new JevIntentSegmenter(decisions, clock, { minAskIntervalMs: 500 });

    const commands: SpokenCommand[] = [];
    for await (const command of segmenter.segment(
      stream(update("open notepad"), update("open notepad now"), update("open notepad now please")),
      NEVER_ABORTED,
    )) {
      commands.push(command);
    }

    // The clock never advances here, so only the first question is allowed.
    expect(decisions.requests).toHaveLength(1);
  });
});

describe("JevIntentSegmenter filler clauses", () => {
  it("never dispatches a clause that is only filler", async () => {
    // Observed in a real spoken run: "...notepad then type something" left a
    // bare "then" clause, which was dispatched and flailed in the screen loop.
    const { commands } = await collect(
      [update("open notepad and then", { isFinal: true })],
      { status: { choice: "ready", confidence: 0.95 } },
    );

    expect(commands.map((c) => c.text)).toEqual(["open notepad"]);
  });

  it("ignores an utterance made entirely of filler", async () => {
    const { commands } = await collect([update("okay so um", { isFinal: true })], { status: { choice: "ready" } });
    expect(commands).toEqual([]);
  });
});
