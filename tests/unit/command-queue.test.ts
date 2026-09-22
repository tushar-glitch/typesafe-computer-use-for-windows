import { describe, expect, it } from "vitest";
import { SerialCommandQueue } from "../../src/application/dispatch/serial-command-queue.js";
import { HandlerChain } from "../../src/application/handlers/handler-chain.js";
import type { ICommandHandler } from "../../src/core/ports/handling.js";
import type { CommandOutcome, SpokenCommand } from "../../src/core/types/command.js";
import { commandId, completed } from "../../src/core/types/command.js";
import { confidence, milliseconds } from "../../src/core/types/scalars.js";

function command(id: string, text: string, supersedes: string | null = null): SpokenCommand {
  return {
    id: commandId(id),
    text,
    timing: supersedes === null ? "speculative" : "confirmed",
    confidence: confidence(0.9),
    receivedAt: milliseconds(0),
    utteranceId: "u1",
    supersedes: supersedes === null ? null : commandId(supersedes),
  };
}

/** A handler that records order and can be held open until released. */
function recordingHandler(): {
  handler: ICommandHandler;
  started: string[];
  finished: string[];
  release(): void;
  hold: boolean;
} {
  const started: string[] = [];
  const finished: string[] = [];
  let unblock: (() => void) | null = null;
  const state = { hold: false };

  const handler: ICommandHandler = {
    name: "recorder",
    canHandle: () => true,
    execute: async (cmd, signal): Promise<CommandOutcome> => {
      started.push(cmd.text);

      if (state.hold) {
        await new Promise<void>((resolve) => {
          unblock = resolve;
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }

      if (signal.aborted) return { status: "cancelled", reason: "aborted" };
      finished.push(cmd.text);
      return completed(`did ${cmd.text}`);
    },
  };

  return {
    handler,
    started,
    finished,
    release: () => unblock?.(),
    get hold() {
      return state.hold;
    },
    set hold(value: boolean) {
      state.hold = value;
    },
  };
}

function queueOf(handler: ICommandHandler, onOutcome?: (c: SpokenCommand, o: CommandOutcome) => void): SerialCommandQueue {
  return new SerialCommandQueue(new HandlerChain([handler]), onOutcome === undefined ? {} : { onOutcome });
}

describe("SerialCommandQueue", () => {
  it("runs commands in the order they were spoken", async () => {
    const recorder = recordingHandler();
    const queue = queueOf(recorder.handler);

    queue.submit(command("c1", "open chrome"));
    queue.submit(command("c2", "open youtube"));
    queue.submit(command("c3", "play ride it"));
    await queue.drain();

    expect(recorder.finished).toEqual(["open chrome", "open youtube", "play ride it"]);
  });

  it("runs one at a time, never overlapping", async () => {
    const recorder = recordingHandler();
    recorder.hold = true;
    const queue = queueOf(recorder.handler);

    queue.submit(command("c1", "first"));
    queue.submit(command("c2", "second"));

    // Let the first reach its hold.
    await Promise.resolve();
    await Promise.resolve();

    // The second must not have started while the first is still running.
    expect(recorder.started).toEqual(["first"]);

    recorder.hold = false;
    recorder.release();
    await queue.drain();

    expect(recorder.started).toEqual(["first", "second"]);
  });

  it("reports an outcome for every command", async () => {
    const seen: string[] = [];
    const queue = queueOf(recordingHandler().handler, (cmd, outcome) => seen.push(`${cmd.text}:${outcome.status}`));

    queue.submit(command("c1", "open chrome"));
    await queue.drain();

    expect(seen).toEqual(["open chrome:completed"]);
  });

  it("drops a queued command the speaker revised, and anything behind it", async () => {
    const recorder = recordingHandler();
    recorder.hold = true;
    const outcomes: string[] = [];
    const queue = queueOf(recorder.handler, (cmd, outcome) => outcomes.push(`${cmd.text}:${outcome.status}`));

    queue.submit(command("c1", "first"));
    await Promise.resolve();
    await Promise.resolve();

    queue.submit(command("c2", "play blinding lights"));
    // A correction to c2, which has not started yet.
    queue.submit(command("c3", "play ride it", "c2"));

    recorder.hold = false;
    recorder.release();
    await queue.drain();

    expect(outcomes).toContain("play blinding lights:cancelled");
    expect(recorder.finished).not.toContain("play blinding lights");
    expect(recorder.finished).toContain("play ride it");
  });

  it("aborts a running command the speaker revised", async () => {
    const recorder = recordingHandler();
    recorder.hold = true;
    const outcomes: string[] = [];
    const queue = queueOf(recorder.handler, (cmd, outcome) => outcomes.push(`${cmd.text}:${outcome.status}`));

    queue.submit(command("c1", "play blinding lights"));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.running?.text).toBe("play blinding lights");

    // The rest of the sentence contradicts what is already running.
    queue.submit(command("c2", "play ride it", "c1"));

    recorder.hold = false;
    await queue.drain();

    expect(outcomes[0]).toBe("play blinding lights:cancelled");
    expect(recorder.finished).toEqual(["play ride it"]);
  });

  it("cancels everything on request", async () => {
    const recorder = recordingHandler();
    recorder.hold = true;
    const outcomes: string[] = [];
    const queue = queueOf(recorder.handler, (cmd, outcome) => outcomes.push(`${cmd.text}:${outcome.status}`));

    queue.submit(command("c1", "first"));
    await Promise.resolve();
    await Promise.resolve();
    queue.submit(command("c2", "second"));

    queue.cancelAll("user stopped listening");
    recorder.hold = false;
    await queue.drain();

    expect(outcomes.every((entry) => entry.endsWith(":cancelled"))).toBe(true);
    expect(recorder.finished).toEqual([]);
  });

  it("keeps serving after a handler throws", async () => {
    let first = true;
    const flaky: ICommandHandler = {
      name: "flaky",
      canHandle: () => true,
      execute: () => {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        return Promise.resolve(completed("fine"));
      },
    };

    const outcomes: string[] = [];
    const queue = new SerialCommandQueue(new HandlerChain([flaky]), {
      onOutcome: (cmd, outcome) => outcomes.push(`${cmd.text}:${outcome.status}`),
    });

    queue.submit(command("c1", "explodes"));
    queue.submit(command("c2", "works"));
    await queue.drain();

    expect(outcomes).toEqual(["explodes:failed", "works:completed"]);
  });

  it("counts what is outstanding", async () => {
    const recorder = recordingHandler();
    recorder.hold = true;
    const queue = queueOf(recorder.handler);

    expect(queue.pending).toBe(0);
    queue.submit(command("c1", "first"));
    queue.submit(command("c2", "second"));
    expect(queue.pending).toBe(2);

    recorder.hold = false;
    recorder.release();
    await queue.drain();
    expect(queue.pending).toBe(0);
  });
});
