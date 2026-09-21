/** Ambient capabilities every layer needs, injected rather than imported. */

import type { Milliseconds } from "../types/scalars.js";

export interface IClock {
  now(): Milliseconds;
  sleep(duration: Milliseconds, signal?: AbortSignal): Promise<void>;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface ILogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that stamps every record with `fields`. */
  child(fields: LogFields): ILogger;
}
