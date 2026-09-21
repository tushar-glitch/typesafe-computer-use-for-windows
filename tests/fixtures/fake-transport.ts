import type { CloseHandler, ISidecarTransport, LineHandler, SidecarExit } from "../../src/adapters/windows/transport.js";

/** An in-memory transport. Records what was written; lets the test push replies. */
export class FakeTransport implements ISidecarTransport {
  readonly sent: string[] = [];
  #lineHandlers: LineHandler[] = [];
  #closeHandlers: CloseHandler[] = [];
  #open = true;

  send(line: string): void {
    if (!this.#open) throw new Error("fake transport is closed");
    this.sent.push(line);
  }

  onLine(handler: LineHandler): void {
    this.#lineHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.#closeHandlers.push(handler);
  }

  close(): void {
    this.#open = false;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Simulate the sidecar writing one line. */
  emit(payload: unknown): void {
    const line = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const handler of this.#lineHandlers) handler(line);
  }

  /** Simulate the sidecar process dying. */
  die(exit: Partial<SidecarExit> = {}): void {
    this.#open = false;
    const info: SidecarExit = { code: exit.code ?? 1, signal: exit.signal ?? null, stderr: exit.stderr ?? "" };
    for (const handler of this.#closeHandlers) handler(info);
  }

  /** The parsed envelopes written so far. */
  envelopes(): readonly { id: string; command: string; params: unknown }[] {
    return this.sent.map((line) => JSON.parse(line) as { id: string; command: string; params: unknown });
  }
}
