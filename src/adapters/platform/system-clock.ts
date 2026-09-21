/**
 * `IClock` over the real clock.
 *
 * Time is injected rather than imported so the loop can be tested without
 * actually waiting: a run with five settle pauses would otherwise take three
 * seconds of test time and be flaky on a loaded machine.
 */

import type { IClock } from "../../core/ports/platform.js";
import { milliseconds, type Milliseconds } from "../../core/types/scalars.js";

export class SystemClock implements IClock {
  now(): Milliseconds {
    return milliseconds(Date.now());
  }

  /** Resolves early, without throwing, when the wait is abandoned. */
  async sleep(duration: Milliseconds, signal?: AbortSignal): Promise<void> {
    if (duration <= 0 || signal?.aborted === true) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, duration);

      function finish(): void {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve();
      }

      signal?.addEventListener("abort", finish, { once: true });
    });
  }
}
