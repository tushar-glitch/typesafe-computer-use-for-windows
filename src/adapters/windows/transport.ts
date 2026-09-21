/**
 * How bytes reach the sidecar.
 *
 * Behind an interface so the RPC client can be tested without a .NET runtime,
 * a child process, or a screen: the tests drive a fake transport and assert on
 * the exact lines written. The real implementation is the only part that needs
 * Windows.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface SidecarExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Anything the sidecar wrote to stderr, for diagnosing a crash. */
  readonly stderr: string;
}

export type LineHandler = (line: string) => void;
export type CloseHandler = (exit: SidecarExit) => void;

export interface ISidecarTransport {
  /** Write one protocol line. The newline is added by the transport. */
  send(line: string): void;
  onLine(handler: LineHandler): void;
  onClose(handler: CloseHandler): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * Splits a byte stream into lines.
 *
 * A chunk boundary can fall anywhere, including inside a multi-byte character
 * or halfway through a base64 screenshot, so partial input is buffered until a
 * newline arrives rather than parsed eagerly.
 */
export class LineBuffer {
  #pending = "";

  push(chunk: string): readonly string[] {
    this.#pending += chunk;
    const parts = this.#pending.split("\n");
    this.#pending = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0);
  }

  /** Whatever arrived without a trailing newline. */
  get remainder(): string {
    return this.#pending;
  }
}

/** Runs the sidecar as a child process and speaks to it over stdio. */
export class ChildProcessTransport implements ISidecarTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #buffer = new LineBuffer();
  readonly #lineHandlers: LineHandler[] = [];
  readonly #closeHandlers: CloseHandler[] = [];
  #stderr = "";
  #open = true;

  constructor(executable: string, args: readonly string[] = []) {
    this.#child = spawn(executable, [...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");

    this.#child.stdout.on("data", (chunk: string) => {
      for (const line of this.#buffer.push(chunk)) {
        for (const handler of this.#lineHandlers) handler(line);
      }
    });
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#child.on("close", (code, signal) => {
      this.#open = false;
      const exit: SidecarExit = { code, signal, stderr: this.#stderr };
      for (const handler of this.#closeHandlers) handler(exit);
    });
    this.#child.on("error", (cause: Error) => {
      this.#open = false;
      const exit: SidecarExit = { code: null, signal: null, stderr: `${this.#stderr}${cause.message}` };
      for (const handler of this.#closeHandlers) handler(exit);
    });
  }

  send(line: string): void {
    if (!this.#open) throw new Error("sidecar transport is closed");
    this.#child.stdin.write(`${line}\n`);
  }

  onLine(handler: LineHandler): void {
    this.#lineHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.#closeHandlers.push(handler);
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#child.stdin.end();
    this.#child.kill();
  }

  get isOpen(): boolean {
    return this.#open;
  }
}
