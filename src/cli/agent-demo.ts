/**
 * Runs phrases through the whole agent: fast path first, screen loop behind it.
 *
 * Everything except the microphone. Each phrase is treated as a command the
 * segmenter would have produced, and the timing shows which path served it.
 *
 *   pnpm demo:agent "open notepad" "open the format menu"
 */

import { buildAgent } from "../composition/build-agent.js";
import type { ILogger, LogFields } from "../core/ports/platform.js";
import type { CommandId, SpokenCommand } from "../core/types/command.js";
import { confidence, milliseconds } from "../core/types/scalars.js";

/** Prints step detail to stderr, keeping stdout to the outcome of each phrase. */
function consoleLogger(prefix = ""): ILogger {
  const write = (level: string, message: string, fields?: LogFields): void => {
    const detail = fields === undefined ? "" : ` ${JSON.stringify(fields)}`;
    console.error(`  ${prefix}${level} ${message}${detail}`);
  };

  return {
    debug: (message, fields) => write("·", message, fields),
    info: (message, fields) => write("·", message, fields),
    warn: (message, fields) => write("!", message, fields),
    error: (message, fields) => write("!", message, fields),
    child: () => consoleLogger(prefix),
  };
}

function asCommand(text: string, index: number): SpokenCommand {
  return {
    id: `c${index}` as CommandId,
    text,
    timing: "confirmed",
    confidence: confidence(0.9),
    receivedAt: milliseconds(0),
    utteranceId: "demo",
    supersedes: null,
  };
}

async function main(): Promise<void> {
  const phrases = process.argv.slice(2);
  if (phrases.length === 0) {
    console.error('usage: pnpm demo:agent "open notepad" "open the format menu"');
    process.exitCode = 1;
    return;
  }

  const agent = buildAgent({
    logger: consoleLogger(),
    loop: { maxSteps: 6, minConfidence: 0.4, settleMs: 700 },
  });

  console.log(`chain: ${agent.chain.order.join(" -> ")}`);

  const warmStarted = performance.now();
  await agent.warm();
  console.log(`warmed in ${(performance.now() - warmStarted).toFixed(0)}ms\n`);

  const controller = new AbortController();

  try {
    for (const [index, phrase] of phrases.entries()) {
      console.log(`> ${JSON.stringify(phrase)}`);
      const started = performance.now();
      const outcome = await agent.chain.dispatch(asCommand(phrase, index), controller.signal);
      const elapsed = performance.now() - started;

      const detail = outcome.status === "completed" ? outcome.summary : outcome.reason;
      console.log(`  ${outcome.status} in ${elapsed.toFixed(0)}ms: ${detail}\n`);
    }
  } finally {
    agent.close();
  }
}

await main();
