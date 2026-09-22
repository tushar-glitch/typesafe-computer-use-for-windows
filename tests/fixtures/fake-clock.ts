import type { IClock } from "../../src/core/ports/platform.js";
import { milliseconds, type Milliseconds } from "../../src/core/types/scalars.js";

/** A clock that never actually waits, and records how long it was asked to. */
export class FakeClock implements IClock {
  readonly sleeps: number[] = [];
  #now = 0;

  now(): Milliseconds {
    return milliseconds(this.#now);
  }

   
  async sleep(duration: Milliseconds): Promise<void> {
    this.sleeps.push(duration);
    this.#now += duration;
  }
}
