/**
 * The whole thing: microphone to action.
 *
 *   pnpm listen --transcribe-only    show what is heard, act on nothing
 *   pnpm listen --fast-path-only     act, but never drive the screen loop
 *   pnpm listen                      everything
 *
 * Stop with Ctrl-C.
 */

import { DeepgramTranscriptionEngine } from "../adapters/speech/deepgram-transcription-engine.js";
import { SidecarAudioSource } from "../adapters/windows/sidecar-audio-source.js";
import { SystemClock } from "../adapters/platform/system-clock.js";
import { TypeSafeDecisionProvider } from "../adapters/decision/typesafe-decision-provider.js";
import { SerialCommandQueue } from "../application/dispatch/serial-command-queue.js";
import { JevIntentSegmenter } from "../application/segmentation/jev-intent-segmenter.js";
import { buildAgent } from "../composition/build-agent.js";
import type { ILogger, LogFields } from "../core/ports/platform.js";

function quietLogger(verbose: boolean): ILogger {
  const write = (mark: string, message: string, fields?: LogFields): void => {
    if (!verbose) return;
    console.error(`    ${mark} ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`);
  };

  const logger: ILogger = {
    debug: (message, fields) => write("·", message, fields),
    info: (message, fields) => write("·", message, fields),
    warn: (message, fields) => console.error(`    ! ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`),
    error: (message, fields) => console.error(`    ! ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`),
    child: () => logger,
  };

  return logger;
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const transcribeOnly = flags.has("--transcribe-only");
  const fastPathOnly = flags.has("--fast-path-only");
  const logger = quietLogger(flags.has("--verbose"));

  const controller = new AbortController();
  const stop = (): void => {
    console.log("\nstopping...");
    controller.abort();
  };
  process.on("SIGINT", stop);

  const audio = new SidecarAudioSource({ logger });
  const transcription = new DeepgramTranscriptionEngine(audio, { logger });

  if (transcribeOnly) {
    console.log("listening (transcribe only, nothing will be acted on). Ctrl-C to stop.\n");

    let lastLine = "";
    for await (const update of transcription.transcribe(controller.signal)) {
      if (update.text === lastLine && !update.isFinal) continue;
      lastLine = update.text;
      console.log(`${update.isFinal ? "FINAL " : "      "} ${update.text}`);
    }
    return;
  }

  const decisions = new TypeSafeDecisionProvider({ logger });
  const agent = buildAgent({ decisions, logger, fastPathOnly, loop: { maxSteps: 8 } });
  const segmenter = new JevIntentSegmenter(decisions, new SystemClock(), { logger });

  const queue = new SerialCommandQueue(agent.chain, {
    logger,
    session: agent.session,
    onOutcome: (command, outcome) => {
      const detail = outcome.status === "completed" ? outcome.summary : outcome.reason;
      console.log(`  -> ${outcome.status}: ${detail}`);
    },
  });

  console.log("warming up...");
  await agent.warm(controller.signal);
  console.log(`listening${fastPathOnly ? " (fast path only)" : ""}. Ctrl-C to stop.\n`);

  try {
    for await (const command of segmenter.segment(transcription.transcribe(controller.signal), controller.signal)) {
      console.log(`heard (${command.timing}): ${JSON.stringify(command.text)}`);
      queue.submit(command);
    }

    await queue.drain();
  } finally {
    queue.cancelAll("listener stopped");
    agent.close();
  }
}

await main();
