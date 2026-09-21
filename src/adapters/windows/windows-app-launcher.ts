/**
 * `IAppLauncher` backed by the Windows shell, through the sidecar.
 *
 * This is the fast path. Starting an application or opening a URL is an
 * operating system call measured in milliseconds, where reaching the same place
 * by reading the screen and clicking costs seconds per step. Anything
 * expressible here must never go through the perception loop.
 */

import type { IAppLauncher } from "../../core/ports/execution.js";
import type { ForegroundWindow } from "../../core/types/observation.js";
import { toForegroundWindow } from "./mapping.js";
import type { SidecarClient, SidecarRequestOptions } from "./sidecar-client.js";

/**
 * Activation polls for the window to come forward, so it needs longer than a
 * plain call. The sidecar gives up after three seconds either way.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

const NO_PARAMS = {} as Readonly<Record<string, never>>;

export interface WindowsAppLauncherOptions {
  readonly timeoutMs?: number;
}

export class WindowsAppLauncher implements IAppLauncher {
  readonly #client: SidecarClient;
  readonly #timeoutMs: number;

  constructor(client: SidecarClient, options: WindowsAppLauncherOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Start an application by name or path.
   *
   * Resolution is the shell's business, so bare names like "notepad" work
   * without hard-coded paths. Returning true means the process was started, not
   * that its window is ready; callers that need the window wait for it.
   */
  async launch(appId: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("launch_app", { appId }, this.#options(signal));
    return result.started;
  }

  /** Opens in the default browser. Only http and https are accepted, enforced sidecar-side. */
  async openUrl(url: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("open_url", { url }, this.#options(signal));
    return result.started;
  }

  /** False when no such process is running, or when Windows refused the foreground change. */
  async activate(processName: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("activate_app", { processName }, this.#options(signal));
    return result.activated;
  }

  async foreground(signal?: AbortSignal): Promise<ForegroundWindow> {
    const result = await this.#client.request("foreground", NO_PARAMS, this.#options(signal));
    return toForegroundWindow(result);
  }

  #options(signal: AbortSignal | undefined): SidecarRequestOptions {
    return { timeoutMs: this.#timeoutMs, ...(signal === undefined ? {} : { signal }) };
  }
}
