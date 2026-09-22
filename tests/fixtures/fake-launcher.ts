import type { IAppLauncher } from "../../src/core/ports/execution.js";
import type { ForegroundWindow } from "../../src/core/types/observation.js";
import { commandId, type SpokenCommand } from "../../src/core/types/command.js";
import { confidence, milliseconds } from "../../src/core/types/scalars.js";

/** Records what the fast path asked the operating system to do. */
export class FakeLauncher implements IAppLauncher {
  readonly launched: string[] = [];
  readonly opened: string[] = [];
  readonly activated: string[] = [];

  /** Process names this pretends are already running. */
  running = new Set<string>();

  launchResult = true;
  openResult = true;

   
  async launch(appId: string): Promise<boolean> {
    this.launched.push(appId);
    return this.launchResult;
  }

   
  async openUrl(url: string): Promise<boolean> {
    this.opened.push(url);
    return this.openResult;
  }

   
  async activate(processName: string): Promise<boolean> {
    this.activated.push(processName);
    return this.running.has(processName);
  }

   
  async foreground(): Promise<ForegroundWindow> {
    return {
      processId: 1,
      processName: "explorer",
      title: "File Explorer",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
  }
}

/** A confirmed command, as the segmenter would emit one. */
export function spoken(text: string): SpokenCommand {
  return {
    id: commandId("c1"),
    text,
    timing: "confirmed",
    confidence: confidence(0.9),
    receivedAt: milliseconds(0),
    utteranceId: "u1",
    supersedes: null,
  };
}
