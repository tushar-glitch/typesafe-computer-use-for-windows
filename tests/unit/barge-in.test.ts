/**
 * Barge-in, end to end: segmenter into queue.
 *
 * Both halves passed their own tests while the path between them was broken.
 * The segmenter put a clause of spoken TEXT in the supersedes field, the queue
 * cancelled by ID, and nothing ever matched, so a correction quietly ran in
 * addition to the thing it was meant to replace. The types allowed it because
 * CommandId was branded with an optional marker and was therefore just string.
 *
 * This exercises the seam the unit tests each assumed was someone else's.
 */

import { describe, expect, it } from "vitest";
import { SerialCommandQueue } from "../../src/application/dispatch/serial-command-queue.js";
import { HandlerChain } from "../../src/application/handlers/handler-chain.js";
import { JevIntentSegmenter } from "../../src/application/segmentation/jev-intent-segmenter.js";
import type { ICommandHandler } from "../../src/core/ports/handling.js";
import type { CommandOutcome, SpokenCommand } from "../../src/core/types/command.js";
import { completed } from "../../src/core/types/command.js";
import type { TranscriptUpdate } from "../../src/core/types/transcript.js";
import { confidence, milliseconds } from "../../src/core/types/scalars.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { FakeDecisionProvider } from "../fixtures/fake-decision-provider.js";

function update(text: string, isFinal = false): TranscriptUpdate {
  return {
    text,
    isFinal,
    confidence: confidence(0.95),
    at: milliseconds(0),
    utteranceId: "u1",
  };
}

async function* speaking(...updates: readonly TranscriptUpdate[]): AsyncIterable<TranscriptUpdate> {
  for (const value of updates) yield value;
}

/**
 * Runs commands slowly enough that a correction can catch one in flight.
 *
 * Time-based rather than manually released: a correction arrives while the
 * first command is still inside its delay, which is exactly the situation
 * barge-in exists for, and there is no ordering to get wrong in the test.
 */
function slowHandler(delayMs = 60): { handler: ICommandHandler; ran: string[] } {
  const ran: string[] = [];

  const handler: ICommandHandler = {
    name: "slow",
    canHandle: () => true,
    execute: async (command, signal): Promise<CommandOutcome> => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

      if (signal.aborted) return { status: "cancelled", reason: "superseded" };
      ran.push(command.text);
      return completed(command.text);
    },
  };

  return { handler, ran };
}

describe("barge-in", () => {
  it("cancels the command the speaker corrected, and runs only the correction", async () => {
    const { handler, ran } = slowHandler();
    const outcomes: string[] = [];

    const queue = new SerialCommandQueue(new HandlerChain([handler]), {
      onOutcome: (command, outcome) => outcomes.push(`${command.text}:${outcome.status}`),
    });

    const segmenter = new JevIntentSegmenter(
      new FakeDecisionProvider({ status: { choice: "ready", confidence: 0.95 } }),
      new FakeClock(),
      { minAskIntervalMs: 0 },
    );

    // The recogniser hears "right", acts on it, then corrects to "ride".
    const commands: SpokenCommand[] = [];
    for await (const command of segmenter.segment(
      speaking(update("play right it"), update("play ride it", true)),
      new AbortController().signal,
    )) {
      commands.push(command);
      queue.submit(command);
    }

    await queue.drain();

    expect(commands).toHaveLength(2);
    // The correction must name the command it replaces by id.
    expect(commands[1]?.supersedes).toBe(commands[0]?.id);

    // Only the corrected instruction reached the world.
    expect(ran).toEqual(["play ride it"]);
    expect(outcomes).toContain("play right it:cancelled");
    expect(outcomes).toContain("play ride it:completed");
  });

  it("leaves an uncorrected command alone", async () => {
    const { handler, ran } = slowHandler();
    const queue = new SerialCommandQueue(new HandlerChain([handler]));

    const segmenter = new JevIntentSegmenter(
      new FakeDecisionProvider({ status: { choice: "ready", confidence: 0.95 } }),
      new FakeClock(),
      { minAskIntervalMs: 0 },
    );

    for await (const command of segmenter.segment(
      speaking(update("open notepad"), update("open notepad", true)),
      new AbortController().signal,
    )) {
      queue.submit(command);
    }

    await queue.drain();

    expect(ran).toEqual(["open notepad"]);
  });
});
