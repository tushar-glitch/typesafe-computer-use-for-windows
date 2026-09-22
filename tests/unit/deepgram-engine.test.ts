/**
 * How Deepgram's segment events become the growing utterance the segmenter
 * expects.
 *
 * This is the riskiest code in the voice path and the hardest to exercise by
 * hand: reproducing a particular sequence of interim, final and speech-final
 * results by speaking into a microphone is not repeatable. So the socket is
 * injected and the documented message shapes are replayed directly.
 */

import { describe, expect, it } from "vitest";
import { DeepgramTranscriptionEngine } from "../../src/adapters/speech/deepgram-transcription-engine.js";
import type { TranscriptUpdate } from "../../src/core/types/transcript.js";
import { FakeTranscriptionSocket, SilentAudioSource } from "../fixtures/fake-transcription-socket.js";

interface Session {
  readonly socket: FakeTranscriptionSocket;
  readonly updates: TranscriptUpdate[];
  /** Lets queued callbacks run and the generator drain. */
  settle(): Promise<void>;
  finish(): Promise<void>;
}

function listen(): Session {
  const socket = new FakeTranscriptionSocket();
  const controller = new AbortController();
  const updates: TranscriptUpdate[] = [];

  const engine = new DeepgramTranscriptionEngine(new SilentAudioSource(), {
    socket: () => Promise.resolve(socket),
  });

  const consuming = (async (): Promise<void> => {
    for await (const update of engine.transcribe(controller.signal)) {
      updates.push(update);
    }
  })();

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    socket,
    updates,
    settle,
    finish: async (): Promise<void> => {
      socket.hangUp();
      controller.abort();
      await consuming;
    },
  };
}

describe("DeepgramTranscriptionEngine", () => {
  it("opens the socket explicitly, because building it does not", async () => {
    const session = listen();
    await session.settle();

    expect(session.socket.connected).toBe(true);
    await session.finish();
  });

  it("reports interim results as the utterance grows", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("open");
    session.socket.emitResult("open chrome");
    await session.settle();

    expect(session.updates.map((u) => u.text)).toEqual(["open", "open chrome"]);
    expect(session.updates.every((u) => !u.isFinal)).toBe(true);
    await session.finish();
  });

  it("appends later segments to the ones already settled", async () => {
    const session = listen();
    await session.settle();

    // Deepgram settles a segment, then starts reporting the next one from
    // scratch. Without accumulation the utterance would appear to restart.
    session.socket.emitResult("open chrome", { isFinal: true });
    session.socket.emitResult("and then");
    session.socket.emitResult("and then open youtube");
    await session.settle();

    expect(session.updates.map((u) => u.text)).toEqual([
      "open chrome",
      "open chrome and then",
      "open chrome and then open youtube",
    ]);
    await session.finish();
  });

  it("ends the utterance when the speaker pauses", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("open chrome", { isFinal: true, speechFinal: true });
    await session.settle();

    expect(session.updates).toHaveLength(1);
    expect(session.updates[0]?.isFinal).toBe(true);
    await session.finish();
  });

  it("starts a fresh utterance after a pause", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("open chrome", { isFinal: true, speechFinal: true });
    session.socket.emitResult("open notepad", { isFinal: true, speechFinal: true });
    await session.settle();

    const [first, second] = session.updates;
    // The second utterance must not carry the first one's words, or the
    // segmenter would dispatch "open chrome" a second time.
    expect(first?.text).toBe("open chrome");
    expect(second?.text).toBe("open notepad");
    expect(first?.utteranceId).not.toBe(second?.utteranceId);
    await session.finish();
  });

  it("ignores the empty results that arrive during silence", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("");
    session.socket.emitResult("   ");
    await session.settle();

    expect(session.updates).toEqual([]);
    await session.finish();
  });

  it("ignores messages that carry no transcript at all", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitRaw({ type: "Metadata", request_id: "abc" });
    session.socket.emitRaw({ type: "SpeechStarted" });
    await session.settle();

    expect(session.updates).toEqual([]);
    await session.finish();
  });

  it("carries the recogniser's confidence through", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("open chrome", { confidence: 0.42 });
    await session.settle();

    expect(session.updates[0]?.confidence).toBeCloseTo(0.42);
    await session.finish();
  });

  it("clamps a confidence outside the unit interval rather than throwing", async () => {
    const session = listen();
    await session.settle();

    session.socket.emitResult("open chrome", { confidence: 1.4 });
    await session.settle();

    expect(session.updates[0]?.confidence).toBe(1);
    await session.finish();
  });

  it("ends the stream when the socket hangs up", async () => {
    const socket = new FakeTranscriptionSocket();
    const engine = new DeepgramTranscriptionEngine(new SilentAudioSource(), {
      socket: () => Promise.resolve(socket),
    });

    const updates: TranscriptUpdate[] = [];
    const consuming = (async (): Promise<void> => {
      for await (const update of engine.transcribe(new AbortController().signal)) {
        updates.push(update);
      }
    })();

    for (let i = 0; i < 6; i++) await Promise.resolve();
    socket.emitResult("open chrome");
    socket.hangUp();

    // Resolves only because the close handler ends the loop.
    await consuming;
    expect(updates.map((u) => u.text)).toEqual(["open chrome"]);
    expect(socket.closedByConsumer).toBe(true);
  });

  it("ends the stream when the socket errors", async () => {
    const socket = new FakeTranscriptionSocket();
    const engine = new DeepgramTranscriptionEngine(new SilentAudioSource(), {
      socket: () => Promise.resolve(socket),
    });

    const consuming = (async (): Promise<void> => {
      for await (const _ of engine.transcribe(new AbortController().signal)) {
        // Nothing; the point is that the loop terminates.
      }
    })();

    for (let i = 0; i < 6; i++) await Promise.resolve();
    socket.fail("connection reset");

    await consuming;
    expect(socket.closedByConsumer).toBe(true);
  });

  it("refuses to start without a key", () => {
    const original = process.env["DEEPGRAM_API_KEY"];
    delete process.env["DEEPGRAM_API_KEY"];

    try {
      expect(() => new DeepgramTranscriptionEngine(new SilentAudioSource())).toThrow(/DEEPGRAM_API_KEY/);
    } finally {
      if (original !== undefined) process.env["DEEPGRAM_API_KEY"] = original;
    }
  });
});
