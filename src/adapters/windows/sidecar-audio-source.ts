/**
 * `IAudioSource` over the microphone, via the sidecar in audio mode.
 *
 * A second process rather than a command on the JSON channel: audio is a
 * continuous binary stream, and framing it as JSON lines would mean base64 and
 * a copy per chunk, forever. Here the child writes nothing but samples to
 * stdout, so this reads it as the byte stream it is.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AudioFormat, IAudioSource } from "../../core/ports/speech.js";
import type { ILogger } from "../../core/ports/platform.js";
import { resolveSidecarPath, SidecarNotBuiltError } from "./sidecar-process.js";

/** Must match what the sidecar captures. */
const FORMAT: AudioFormat = {
  sampleRate: 16_000,
  bitsPerSample: 16,
  channels: 1,
  encoding: "linear16",
};

export interface SidecarAudioSourceOptions {
  readonly logger?: ILogger;
}

export class SidecarAudioSource implements IAudioSource {
  readonly format = FORMAT;

  readonly #logger: ILogger | undefined;

  constructor(options: SidecarAudioSourceOptions = {}) {
    this.#logger = options.logger;
  }

  async *frames(signal: AbortSignal): AsyncIterable<Uint8Array> {
    const executable = resolveSidecarPath();
    if (executable === null) throw new SidecarNotBuiltError();

    const child: ChildProcessWithoutNullStreams = spawn(executable, ["--audio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (line: string) => {
      this.#logger?.debug("audio sidecar", { message: line.trim() });
    });

    // Closing stdin is how the child is told to stop; killing it outright can
    // leave the capture device held open.
    const stop = (): void => {
      child.stdin.end();
      child.kill();
    };
    signal.addEventListener("abort", stop, { once: true });

    try {
      for await (const chunk of child.stdout) {
        if (signal.aborted) return;
        yield chunk as Uint8Array;
      }
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }
  }
}
