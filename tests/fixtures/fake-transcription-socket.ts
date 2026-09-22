import type { TranscriptionSocket } from "../../src/adapters/speech/deepgram-transcription-engine.js";
import type { AudioFormat, IAudioSource } from "../../src/core/ports/speech.js";

/** A socket the test drives, standing in for the vendor websocket. */
export class FakeTranscriptionSocket implements TranscriptionSocket {
  readonly sent: ArrayBufferView[] = [];
  connected = false;
  closedByConsumer = false;

  #onMessage: ((message: unknown) => void) | null = null;
  #onError: ((error: Error) => void) | null = null;
  #onClose: (() => void) | null = null;

  on(event: "message" | "error" | "close", callback: (value: never) => void): void {
    if (event === "message") this.#onMessage = callback as (message: unknown) => void;
    if (event === "error") this.#onError = callback as (error: Error) => void;
    if (event === "close") this.#onClose = callback as () => void;
  }

  connect(): void {
    this.connected = true;
  }

  async waitForOpen(): Promise<unknown> {
    return await Promise.resolve(null);
  }

  sendMedia(payload: ArrayBufferView): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closedByConsumer = true;
  }

  /**
   * One Deepgram result, in the shape their streaming API documents.
   *
   * `isFinal` settles the current segment; `speechFinal` additionally means the
   * speaker paused, which ends the utterance.
   */
  emitResult(
    transcript: string,
    options: { isFinal?: boolean; speechFinal?: boolean; confidence?: number } = {},
  ): void {
    this.#onMessage?.({
      type: "Results",
      is_final: options.isFinal ?? false,
      speech_final: options.speechFinal ?? false,
      channel: { alternatives: [{ transcript, confidence: options.confidence ?? 0.95 }] },
    });
  }

  /** A message with no alternatives, as arrives for metadata frames. */
  emitRaw(message: unknown): void {
    this.#onMessage?.(message);
  }

  fail(message: string): void {
    this.#onError?.(new Error(message));
  }

  hangUp(): void {
    this.#onClose?.();
  }
}

/** Audio that never produces samples and stays open until abandoned. */
export class SilentAudioSource implements IAudioSource {
  readonly format: AudioFormat = {
    sampleRate: 16_000,
    bitsPerSample: 16,
    channels: 1,
    encoding: "linear16",
  };

  async *frames(signal: AbortSignal): AsyncIterable<Uint8Array> {
    // Holds the pump open so the transcript stream is ended by the socket
    // rather than by audio running out, which is what happens in production.
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    });

    // Never reached, but the generator must be able to yield this type.
    if (false as boolean) yield new Uint8Array();
  }
}
