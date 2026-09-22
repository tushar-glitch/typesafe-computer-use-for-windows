/**
 * `ITranscriptionEngine` over Deepgram's streaming API.
 *
 * The important behaviour is not transcription, which the vendor handles, but
 * how their event stream is turned into the growing utterance the segmenter
 * expects.
 *
 * Deepgram reports in segments. Interim results revise the segment currently
 * being spoken; `is_final` settles one; `speech_final` ends the utterance
 * because the speaker paused. The segmenter, though, wants the whole utterance
 * so far on every update, because a command can span several segments. So
 * settled segments are accumulated here and the live one appended, and the
 * utterance identity only changes when Deepgram says the speaker stopped.
 */

import { DeepgramClient, ListenV1InterimResults, ListenV1Punctuate } from "@deepgram/sdk";
import type { IAudioSource, ITranscriptionEngine } from "../../core/ports/speech.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { TranscriptUpdate } from "../../core/types/transcript.js";
import { confidence, milliseconds } from "../../core/types/scalars.js";

export interface DeepgramTranscriptionEngineOptions {
  readonly apiKey?: string;
  readonly logger?: ILogger;
  /** Deepgram model. Nova-3 is their accurate streaming default. */
  readonly model?: string;
  /**
   * Silence, in milliseconds, that ends a segment.
   *
   * Short, because a settled segment is what lets the segmenter treat earlier
   * clauses as finished. Too short and ordinary pauses fragment a sentence.
   */
  readonly endpointingMs?: number;
  /**
   * Supply the socket instead of opening one against Deepgram.
   *
   * Used by the tests to replay recorded message sequences; production leaves
   * it unset and the adapter connects for itself.
   */
  readonly socket?: (signal: AbortSignal) => Promise<TranscriptionSocket>;
}

const DEFAULTS = {
  model: "nova-3",
  endpointingMs: 300,
} as const;

/** Only the fields of a Deepgram result this code reads. */
interface ResultMessage {
  readonly type?: string;
  readonly is_final?: boolean;
  readonly speech_final?: boolean;
  readonly channel?: {
    readonly alternatives?: readonly { readonly transcript?: string; readonly confidence?: number }[];
  };
}

/**
 * The part of the vendor socket this adapter uses.
 *
 * Narrow on purpose, and injectable: the interesting logic here is how a
 * stream of segment events becomes a growing utterance, and that deserves to
 * be tested against the documented message shapes rather than only against a
 * live microphone and a quiet room.
 */
export interface TranscriptionSocket {
  on(event: "message", callback: (message: unknown) => void): void;
  on(event: "error", callback: (error: Error) => void): void;
  on(event: "close", callback: () => void): void;
  /** Opens the socket. Building it and opening it are separate steps. */
  connect(): void;
  waitForOpen(): Promise<unknown>;
  sendMedia(payload: ArrayBufferView): void;
  close(): void;
}

export class DeepgramTranscriptionEngine implements ITranscriptionEngine {
  readonly name = "deepgram";

  readonly #audio: IAudioSource;
  readonly #logger: ILogger | undefined;
  readonly #openSocket: (signal: AbortSignal) => Promise<TranscriptionSocket>;

  constructor(audio: IAudioSource, options: DeepgramTranscriptionEngineOptions = {}) {
    this.#audio = audio;
    this.#logger = options.logger;

    if (options.socket !== undefined) {
      this.#openSocket = options.socket;
      return;
    }

    const key = options.apiKey ?? process.env["DEEPGRAM_API_KEY"] ?? "";
    if (key.length === 0) {
      throw new Error("DEEPGRAM_API_KEY is not set; streaming transcription needs a key");
    }

    const model = options.model ?? DEFAULTS.model;
    const endpointing = options.endpointingMs ?? DEFAULTS.endpointingMs;
    const format = audio.format;

    this.#openSocket = async (signal): Promise<TranscriptionSocket> => {
      const client = new DeepgramClient({ apiKey: key });

      return await client.listen.v1.connect({
        Authorization: `Token ${key}`,
        model,
        encoding: "linear16",
        sample_rate: format.sampleRate,
        channels: format.channels,
        // The SDK models these flags as string enums rather than booleans.
        interim_results: ListenV1InterimResults.True,
        punctuate: ListenV1Punctuate.True,
        endpointing,
        abortSignal: signal,
      });
    };
  }

  async *transcribe(signal: AbortSignal): AsyncIterable<TranscriptUpdate> {
    const socket = await this.#openSocket(signal);

    // Updates arrive on a callback but are consumed by a for-await. This queue
    // bridges the two, and holds anything that arrives while the consumer is
    // busy rather than dropping it.
    const pending: TranscriptUpdate[] = [];
    let wake: (() => void) | null = null;
    let closed = false;

    const push = (update: TranscriptUpdate): void => {
      pending.push(update);
      wake?.();
    };

    const finish = (): void => {
      closed = true;
      wake?.();
    };

    /** Segments already settled in the current utterance. */
    let settled = "";
    let utteranceSequence = 0;
    let utteranceId = `u${utteranceSequence}`;

    socket.on("message", (message) => {
      const result = message as ResultMessage;
      const alternative = result.channel?.alternatives?.[0];
      if (alternative === undefined) return;

      const text = (alternative.transcript ?? "").trim();
      const spoken = `${settled}${settled.length > 0 && text.length > 0 ? " " : ""}${text}`.trim();

      // Deepgram emits empty interim results constantly during silence.
      if (spoken.length === 0) return;

      const utteranceOver = result.speech_final === true;

      push({
        text: spoken,
        isFinal: utteranceOver,
        confidence: confidence(Math.min(1, Math.max(0, alternative.confidence ?? 0))),
        at: milliseconds(Math.round(performance.now())),
        utteranceId,
      });

      if (utteranceOver) {
        // The speaker stopped. Anything after this belongs to a new request.
        settled = "";
        utteranceSequence++;
        utteranceId = `u${utteranceSequence}`;
        return;
      }

      if (result.is_final === true && text.length > 0) {
        settled = spoken;
      }
    });

    socket.on("error", (error) => {
      this.#logger?.error("transcription socket failed", { error: error.message });
      finish();
    });

    socket.on("close", () => {
      this.#logger?.debug("transcription socket closed");
      finish();
    });

    // Despite the name, client.listen.v1.connect only builds the socket: it
    // comes back CLOSED, and opening it is a second, explicit call. Handlers
    // are registered first so nothing that arrives early is missed.
    socket.connect();

    // Sending before it opens loses the first frames, which are the start of
    // the first word.
    await socket.waitForOpen();
    this.#logger?.debug("transcription socket open");

    // Pump audio in the background. The consumer below drives the transcript,
    // not the microphone, so the two must not block each other.
    //
    // The pump gets its own signal, derived from the caller. The microphone
    // never stops on its own, so when the socket closes or errors the pump has
    // to be told to stop as well. Awaiting it without that hangs the stream
    // forever, which would turn a dropped connection into a silent freeze.
    const pumpController = new AbortController();
    const abortPump = (): void => {
      pumpController.abort();
    };
    if (signal.aborted) abortPump();
    else signal.addEventListener("abort", abortPump, { once: true });

    const pumping = this.#pump(socket, pumpController.signal).finally(finish);

    try {
      for (;;) {
        while (pending.length > 0) {
          const update = pending.shift();
          if (update !== undefined) yield update;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by the socket callbacks above, which flow analysis does not follow
        if (closed || signal.aborted) return;

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      abortPump();
      signal.removeEventListener("abort", abortPump);
      socket.close();
      await pumping.catch(() => undefined);
    }
  }

  async #pump(socket: { sendMedia(payload: ArrayBufferView): void }, signal: AbortSignal): Promise<void> {
    for await (const frame of this.#audio.frames(signal)) {
      if (signal.aborted) return;

      try {
        socket.sendMedia(frame);
      } catch (error: unknown) {
        // A closed socket mid-stream is ordinary at shutdown.
        this.#logger?.debug("dropped an audio frame", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
  }
}
