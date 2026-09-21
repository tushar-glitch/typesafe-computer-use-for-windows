/**
 * Runs spoken phrases through the fast path and reports what each one cost.
 *
 * No microphone and no decision model: this is the deterministic half of the
 * system, exercised with the phrases a speaker would produce. It exists to
 * show, with a clock, that the common requests never touch the screen loop.
 *
 *   pnpm demo:fast-path "open chrome" "open youtube" "play ride it"
 */

import { DeepLinkSearchHandler } from "../application/handlers/deep-link-search-handler.js";
import { HandlerChain } from "../application/handlers/handler-chain.js";
import { LaunchAppHandler } from "../application/handlers/launch-app-handler.js";
import { OpenSiteHandler } from "../application/handlers/open-site-handler.js";
import { WindowsAppLauncher } from "../adapters/windows/windows-app-launcher.js";
import { startSidecar } from "../adapters/windows/sidecar-process.js";
import type { CommandId, SpokenCommand } from "../core/types/command.js";
import { confidence, milliseconds } from "../core/types/scalars.js";

const DEFAULT_PHRASES = [
  "Hey, can you open chrome",
  "and then open youtube",
  "play my favourite song which is Ride It",
] as const;

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
  const phrases = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [...DEFAULT_PHRASES];

  const sidecar = startSidecar();
  const launcher = new WindowsAppLauncher(sidecar);

  // Cheapest and most specific first. The screen loop would sit at the end.
  const chain = new HandlerChain([
    new DeepLinkSearchHandler(launcher),
    new LaunchAppHandler(launcher),
    new OpenSiteHandler(launcher),
  ]);

  console.log(`chain: ${chain.order.join(" -> ")}\n`);

  const controller = new AbortController();
  let total = 0;

  try {
    for (const [index, phrase] of phrases.entries()) {
      const started = performance.now();
      const outcome = await chain.dispatch(asCommand(phrase, index), controller.signal);
      const elapsed = performance.now() - started;
      total += elapsed;

      const detail = outcome.status === "completed" ? outcome.summary : outcome.reason;
      console.log(`${`${elapsed.toFixed(0)}ms`.padStart(7)}  ${outcome.status.padEnd(9)} ${JSON.stringify(phrase)}`);
      console.log(`         ${detail}`);
    }
  } finally {
    sidecar.close();
  }

  console.log(`\ntotal ${total.toFixed(0)}ms for ${phrases.length} commands`);
}

await main();
