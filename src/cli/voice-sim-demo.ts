/**
 * The voice pipeline, driven by a simulated speaker.
 *
 * Everything downstream of the microphone is real: the clause splitter, live
 * Jev judging whether a fragment is complete, the queue, and the handler
 * chain acting on the desktop. Only the audio is faked, by emitting partial
 * transcripts word by word at a speaking pace.
 *
 * The point is the timeline. Each line shows when a command fired relative to
 * when the sentence finished, which is the thing the design exists to buy.
 *
 *   pnpm demo:voice
 *   pnpm demo:voice "open notepad and then open the calculator"
 */

import { buildAgent } from "../composition/build-agent.js";
import { SystemClock } from "../adapters/platform/system-clock.js";
import { TypeSafeDecisionProvider } from "../adapters/decision/typesafe-decision-provider.js";
import { SerialCommandQueue } from "../application/dispatch/serial-command-queue.js";
import { JevIntentSegmenter } from "../application/segmentation/jev-intent-segmenter.js";
import type { TranscriptUpdate } from "../core/types/transcript.js";
import { confidence, milliseconds } from "../core/types/scalars.js";

const DEFAULT_SENTENCE = "hey can you open chrome and then open youtube and play my favourite song which is ride it";

/** Roughly conversational: a word every 180ms. */
const WORD_INTERVAL_MS = 180;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Emit the sentence the way a streaming recogniser would: the whole utterance
 * so far, growing, several times a second, with a final at the end.
 */
async function* speak(sentence: string, startedAt: number): AsyncIterable<TranscriptUpdate> {
  const words = sentence.split(/\s+/).filter(Boolean);

  for (let spoken = 1; spoken <= words.length; spoken++) {
    await sleep(WORD_INTERVAL_MS);
    const text = words.slice(0, spoken).join(" ");
    console.log(`${elapsed(startedAt)}  speaking: ${text}`);

    yield {
      text,
      isFinal: false,
      confidence: confidence(0.95),
      at: milliseconds(Math.round(performance.now())),
      utteranceId: "utterance-1",
    };
  }

  // A short trailing pause, then the engine settles the utterance.
  await sleep(300);
  console.log(`${elapsed(startedAt)}  speaking: [finished]`);

  yield {
    text: sentence,
    isFinal: true,
    confidence: confidence(0.97),
    at: milliseconds(Math.round(performance.now())),
    utteranceId: "utterance-1",
  };
}

function elapsed(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1000).toFixed(2)}s`.padStart(6);
}

async function main(): Promise<void> {
  const sentence = process.argv.slice(2).join(" ") || DEFAULT_SENTENCE;

  const started = performance.now();
  const decisions = new TypeSafeDecisionProvider();
  // Fast path only: this demo is about when commands fire, not about the
  // screen loop, and the loop would dominate the timeline.
  const agent = buildAgent({ decisions, fastPathOnly: true });

  const queue = new SerialCommandQueue(agent.chain, {
    session: agent.session,
    onOutcome: (command, outcome) => {
      const detail = outcome.status === "completed" ? outcome.summary : outcome.reason;
      console.log(`${elapsed(started)}  -> ${outcome.status}: ${detail}`);
    },
  });

  console.log("warming up...");
  await Promise.all([agent.warm(), decisions.warm()]);
  console.log(`ready\n\nsentence: ${JSON.stringify(sentence)}\n`);

  const controller = new AbortController();
  const segmenter = new JevIntentSegmenter(decisions, new SystemClock(), {
    speculativeThreshold: 0.7,
    minAskIntervalMs: 200,
  });

  try {
    for await (const command of segmenter.segment(speak(sentence, started), controller.signal)) {
      console.log(
        `${elapsed(started)}  FIRED (${command.timing}): ${JSON.stringify(command.text)}`
          + (command.supersedes === null ? "" : ` [supersedes ${JSON.stringify(command.supersedes)}]`),
      );
      queue.submit(command);
    }

    await queue.drain();
  } finally {
    agent.close();
  }

  console.log(`\nsentence took ${((performance.now() - started) / 1000).toFixed(2)}s to speak`);
}

await main();
