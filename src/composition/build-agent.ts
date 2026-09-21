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
import { WindowsAccessibilityProvider } from "../adapters/windows/windows-accessibility-provider.js";
import { WindowsAppLauncher } from "../adapters/windows/windows-app-launcher.js";
import { WindowsElementInvoker } from "../adapters/windows/windows-element-invoker.js";
import { WindowsInputDevice } from "../adapters/windows/windows-input-device.js";
import { WindowsOcrEngine } from "../adapters/windows/windows-ocr-engine.js";
import { WindowsScreenCapturer } from "../adapters/windows/windows-screen-capturer.js";
import { DeepLinkSearchHandler } from "../application/handlers/deep-link-search-handler.js";
import { HandlerChain } from "../application/handlers/handler-chain.js";
import { LaunchAppHandler } from "../application/handlers/launch-app-handler.js";
import { OpenSiteHandler } from "../application/handlers/open-site-handler.js";
import { ActionRunner } from "../application/loop/action-runner.js";
import { ScreenLoopHandler, type ScreenLoopOptions } from "../application/loop/screen-loop-handler.js";
import { PerceptionPipeline } from "../application/perception/perception-pipeline.js";
import type { IDecisionProvider } from "../core/ports/decision.js";
import type { ILogger } from "../core/ports/platform.js";

export interface Agent {
  readonly chain: HandlerChain;
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
  /** Overridable so a run can be driven by a fake, or by another provider. */
  readonly decisions?: IDecisionProvider;
  readonly loop?: ScreenLoopOptions;
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

  const actions = new ActionRunner(
    new WindowsInputDevice(sidecar),
    new WindowsElementInvoker(sidecar),
    options.logger === undefined ? {} : { logger: options.logger },
  );

  // Order is the design: every fast-path handler is an OS call measured in
  // milliseconds, and the screen loop costs over a second per step. The loop
  // claims anything, so it must come last.
  const handlers = [
    new DeepLinkSearchHandler(launcher),
    new LaunchAppHandler(launcher),
    new OpenSiteHandler(launcher),
    ...(options.fastPathOnly === true
      ? []
      : [
          new ScreenLoopHandler(
            perception,
            decisions,
            actions,
            new SystemClock(),
            options.loop ?? {},
          ),
        ]),
  ];

  return {
    chain: new HandlerChain(handlers, options.logger === undefined ? {} : { logger: options.logger }),

    async warm(signal?: AbortSignal): Promise<void> {
      // Both are best-effort. A failed warm-up must never stop the agent
      // starting; it only means the first command pays what this would have.
      await Promise.allSettled([
        sidecar.request("ping", {} as Readonly<Record<string, never>>, signal === undefined ? {} : { signal }),
        decisions instanceof TypeSafeDecisionProvider ? decisions.warm(signal) : Promise.resolve(),
      ]);
    },

    close(): void {
      sidecar.close();
    },
  };
}
