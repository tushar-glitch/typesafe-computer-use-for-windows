/**
 * `IElementInvoker` backed by UI Automation patterns, through the sidecar.
 *
 * Acting on the control itself rather than the pixels over it. The invocation
 * lands when a banner, tooltip or sticky header covers the target, and it
 * reaches controls scrolled entirely out of view, which no click can.
 *
 * Every method returns a boolean rather than throwing on refusal, because
 * refusal is the common case: controls advertise a pattern and then decline it.
 * The caller falls back to a synthetic click. A thrown error here means the
 * handle itself was bad.
 */

import type { IElementInvoker } from "../../core/ports/execution.js";
import type { ElementHandle } from "../../core/types/observation.js";
import type { SidecarClient, SidecarRequestOptions } from "./sidecar-client.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface WindowsElementInvokerOptions {
  readonly timeoutMs?: number;
}

export class WindowsElementInvoker implements IElementInvoker {
  readonly #client: SidecarClient;
  readonly #timeoutMs: number;

  constructor(client: SidecarClient, options: WindowsElementInvokerOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async invoke(handle: ElementHandle, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("element_invoke", { handle }, this.#options(signal));
    return result.accepted;
  }

  async setValue(handle: ElementHandle, text: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("element_set_value", { handle, text }, this.#options(signal));
    return result.accepted;
  }

  async focus(handle: ElementHandle, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#client.request("element_focus", { handle }, this.#options(signal));
    return result.accepted;
  }

  async readValue(handle: ElementHandle, signal?: AbortSignal): Promise<string | null> {
    const result = await this.#client.request("element_read_value", { handle }, this.#options(signal));
    return result.value;
  }

  #options(signal: AbortSignal | undefined): SidecarRequestOptions {
    return { timeoutMs: this.#timeoutMs, ...(signal === undefined ? {} : { signal }) };
  }
}
