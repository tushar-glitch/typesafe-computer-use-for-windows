/**
 * The composition root.
 *
 * The one place that knows which concrete adapter serves which port. Nothing
 * else in the codebase calls `new` on an adapter, which is what keeps the
 * application layer testable against fakes and the core free of Windows, of
 * HTTP, and of any particular vendor.
 */

import { TypeSafeDecisionProvider } from "../adapters/decision/typesafe-decision-provider.js";
import { SystemClock } from "../adapters/platform/system-clock.js";
import { startSidecar } from "../adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../adapters/windows/sidecar-client.js";
import {
  WindowsAccessibilityProvider,
  WindowsFocusedFieldReader,
} from "../adapters/windows/windows-accessibility-provider.js";
import { WindowsAppLauncher } from "../adapters/windows/windows-app-launcher.js";
import { WindowsElementInvoker } from "../adapters/windows/windows-element-invoker.js";
import { WindowsInputDevice } from "../adapters/windows/windows-input-device.js";
import { WindowsOcrEngine } from "../adapters/windows/windows-ocr-engine.js";
import { WindowsScreenCapturer } from "../adapters/windows/windows-screen-capturer.js";
import { HandlerChain } from "../application/handlers/handler-chain.js";
import { TypeTextHandler } from "../application/handlers/type-text-handler.js";
import { SessionLedger } from "../application/session/session-ledger.js";
import { FirstAvailableComposer } from "../application/text/first-available-composer.js";
import { VerbatimTextComposer } from "../application/text/verbatim-text-composer.js";
import { GroqTextComposer } from "../adapters/writing/groq-text-composer.js";
import { ActionRunner } from "../application/loop/action-runner.js";
import { ScreenLoopHandler, type ScreenLoopOptions } from "../application/loop/screen-loop-handler.js";
import { PerceptionPipeline } from "../application/perception/perception-pipeline.js";
import type { IDecisionProvider } from "../core/ports/decision.js";
import type { ILogger } from "../core/ports/platform.js";
import type { ITextComposer } from "../core/ports/writing.js";

export interface Agent {
  readonly chain: HandlerChain;
  /** What the session remembers. Read by the segmenter and written by the loop. */
  readonly session: SessionLedger;
  /**
   * Pay the cold-start costs before the user says anything.
   *
   * The OCR engine takes about 450ms to build and the first decision call
   * about 1.1 seconds more than the rest. Paid lazily, both land on the first
   * spoken command, which is the one moment the system has to feel immediate.
   */
  warm(signal?: AbortSignal): Promise<void>;
  close(): void;
}

export interface BuildAgentOptions {
  readonly logger?: ILogger;
  /** Shared so a long-running session keeps its memory across rebuilds. */
  readonly session?: SessionLedger;
  /** Overridable so a run can be driven by a fake, or by another provider. */
  readonly decisions?: IDecisionProvider;
  readonly loop?: ScreenLoopOptions;
  /** Overridable so a run can be driven without a writing model. */
  readonly composer?: ITextComposer;
  /** Leave the screen loop out, for a run that must only ever use the fast path. */
  readonly fastPathOnly?: boolean;
}

export function buildAgent(options: BuildAgentOptions = {}): Agent {
  const sidecar: SidecarClient = startSidecar({
    defaultTimeoutMs: 20_000,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  const launcher = new WindowsAppLauncher(sidecar);
  const decisions =
    options.decisions ??
    new TypeSafeDecisionProvider(options.logger === undefined ? {} : { logger: options.logger });

  const perception = new PerceptionPipeline(
    new WindowsScreenCapturer(sidecar),
    new WindowsOcrEngine(sidecar),
    new WindowsAccessibilityProvider(sidecar),
    options.logger === undefined ? {} : { logger: options.logger },
  );

  const input = new WindowsInputDevice(sidecar);

  // The writer first, because it handles dictated text as well as composed
  // text and declines credential fields deliberately. Verbatim behind it so a
  // dictated phrase still types when the network is not there.
  const composer = options.composer ?? buildComposer(options.logger);

  const actions = new ActionRunner(input, new WindowsElementInvoker(sidecar), launcher, {
    composer,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  const clock = new SystemClock();
  const session = options.session ?? new SessionLedger(clock);

  // Two handlers, not five. Launching applications and opening websites used
  // to be handlers here and were the wrong shape entirely: a handler returns a
  // verdict, so the goal died the moment one fired, and "play a song on
  // youtube" stopped at the results page. They are now actions inside the
  // loop, where the goal survives every step.
  //
  // Typing keeps a handler because the characters are already in the sentence,
  // so it needs no screen and no model at all. It hands back when nothing
  // editable has focus, and the loop clicks into a field first.
  const handlers = [
    new TypeTextHandler(
      input,
      new WindowsFocusedFieldReader(sidecar),
      composer,
      options.logger === undefined ? {} : { logger: options.logger },
    ),
    ...(options.fastPathOnly === true
      ? []
      : [
          new ScreenLoopHandler(perception, decisions, actions, clock, session, {
            ...(options.loop ?? {}),
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          }),
        ]),
  ];

  return {
    chain: new HandlerChain(handlers, options.logger === undefined ? {} : { logger: options.logger }),
    session,

    async warm(signal?: AbortSignal): Promise<void> {
      // Both are best-effort. A failed warm-up must never stop the agent
      // starting; it only means the first command pays what this would have.
      await Promise.allSettled([
        sidecar.request("ping", {}, signal === undefined ? {} : { signal }),
        decisions instanceof TypeSafeDecisionProvider ? decisions.warm(signal) : Promise.resolve(),
      ]);
    },

    close(): void {
      sidecar.close();
    },
  };
}

/**
 * The writing model when one is configured, and verbatim behind it.
 *
 * Without a key, composed text is simply unavailable and the action refuses,
 * which is honest: the loop reports that composing needs a writing model
 * rather than typing a guess.
 */
function buildComposer(logger: ILogger | undefined): ITextComposer {
  const verbatim = new VerbatimTextComposer();
  if ((process.env["GROQ_API_KEY"] ?? "").length === 0) return verbatim;

  return new FirstAvailableComposer(
    [new GroqTextComposer(logger === undefined ? {} : { logger }), verbatim],
    logger === undefined ? {} : { logger },
  );
}
