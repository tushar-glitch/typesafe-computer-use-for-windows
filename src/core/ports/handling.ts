/**
 * Dispatching a spoken command.
 *
 * Handlers form a chain of responsibility, ordered cheapest-first. Launching an
 * app or opening a deep link is an OS call measured in milliseconds; the screen
 * loop costs seconds per step. The chain exists so the expensive path runs only
 * when no cheap one applies.
 */

import type { CommandOutcome, SpokenCommand } from "../types/command.js";

export interface ICommandHandler {
  readonly name: string;
  /**
   * Whether this handler claims the command. Must not act on the world; the
   * chain may ask several handlers before one accepts.
   */
  canHandle(command: SpokenCommand, signal?: AbortSignal): Promise<boolean> | boolean;
  execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome>;
}

/** Runs commands one at a time, cancelling in-flight work when one supersedes another. */
export interface ICommandQueue {
  submit(command: SpokenCommand): void;
  /** Cancel the running command and drop anything queued behind it. */
  cancelAll(reason: string): void;
  readonly pending: number;
}
