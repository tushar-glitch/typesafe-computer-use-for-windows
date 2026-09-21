/**
 * `IAccessibilityProvider` backed by UI Automation, through the sidecar.
 *
 * Supplies what OCR structurally cannot: icon-only buttons, the role of each
 * control, and a handle that can be invoked without aiming a mouse at it.
 *
 * Every snapshot is bounded and usually partial. Measured on this machine, a
 * File Explorer window yields 55 to 79 controls in about 410ms and still
 * reports `truncated`. That is the intended operating point, not a defect:
 * an exhaustive walk of a Chromium window costs twelve seconds, so the walk is
 * deliberately cut short and callers treat the result as the reachable
 * controls rather than all of them.
 */

import type {
  AccessibilityOptions,
  AccessibilitySnapshot,
  IAccessibilityProvider,
} from "../../core/ports/perception.js";
import { toAccessibilitySnapshot } from "./mapping.js";
import type { UiaTreeParams } from "./protocol.js";
import type { SidecarClient } from "./sidecar-client.js";

/**
 * How long the walk may run inside the sidecar.
 *
 * Perception shares a step with capture and OCR, so the tree gets what is left
 * of the budget rather than however long it would like.
 */
const DEFAULT_WALK_BUDGET_MS = 400;

/**
 * Deadline for the request itself, comfortably above the walk budget.
 *
 * The gap absorbs the reply crossing the pipe. If this fires, the sidecar
 * ignored its own budget, which is a fault rather than a slow window.
 */
const REQUEST_TIMEOUT_MS = 5_000;

export interface WindowsAccessibilityProviderOptions {
  readonly walkBudgetMs?: number;
  readonly requestTimeoutMs?: number;
}

export class WindowsAccessibilityProvider implements IAccessibilityProvider {
  readonly #client: SidecarClient;
  readonly #walkBudgetMs: number;
  readonly #requestTimeoutMs: number;

  constructor(client: SidecarClient, options: WindowsAccessibilityProviderOptions = {}) {
    this.#client = client;
    this.#walkBudgetMs = options.walkBudgetMs ?? DEFAULT_WALK_BUDGET_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async snapshot(options?: AccessibilityOptions, signal?: AbortSignal): Promise<AccessibilitySnapshot> {
    const params: UiaTreeParams = { budgetMs: options?.budgetMs ?? this.#walkBudgetMs };

    const tree = await this.#client.request("uia_tree", params, {
      timeoutMs: this.#requestTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });

    return toAccessibilitySnapshot(tree);
  }
}
