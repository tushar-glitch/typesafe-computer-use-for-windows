/**
 * Typed RPC over the sidecar transport.
 *
 * Responsibilities, deliberately only these: correlate replies to requests,
 * enforce a deadline, honour cancellation, and fail every outstanding call if
 * the sidecar dies. It knows nothing about screens, elements or actions — the
 * feature adapters sit on top and translate DTOs into domain types.
 */

import type { ILogger } from "../../core/ports/platform.js";
import {
  isResponseEnvelope,
  type ParamsOf,
  type ResultOf,
  type SidecarCommandName,
  type SidecarRequestEnvelope,
} from "./protocol.js";
import type { ISidecarTransport, SidecarExit } from "./transport.js";

export type SidecarErrorCode =
  | "timeout"
  | "cancelled"
  | "transport-closed"
  | "malformed-response"
  | "sidecar-error";

export class SidecarError extends Error {
  readonly code: SidecarErrorCode;
  readonly command: string;

  constructor(code: SidecarErrorCode, command: string, message: string) {
    super(`${command}: ${message}`);
    this.name = "SidecarError";
    this.code = code;
    this.command = command;
  }
}

export interface SidecarRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SidecarClientOptions {
  readonly defaultTimeoutMs?: number;
  readonly logger?: ILogger;
  /** Overridable so tests can assert on deterministic request ids. */
  readonly idFactory?: () => string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

interface PendingCall {
  readonly command: string;
  readonly settle: (outcome: { ok: true; value: unknown } | { ok: false; error: SidecarError }) => void;
}

export class SidecarClient {
  readonly #transport: ISidecarTransport;
  readonly #pending = new Map<string, PendingCall>();
  readonly #defaultTimeoutMs: number;
  readonly #logger: ILogger | undefined;
  readonly #nextId: () => string;
  #closedReason: SidecarError | null = null;

  constructor(transport: ISidecarTransport, options: SidecarClientOptions = {}) {
    this.#transport = transport;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger;

    let counter = 0;
    this.#nextId = options.idFactory ?? ((): string => `r${++counter}`);

    transport.onLine((line) => {
      this.#handleLine(line);
    });
    transport.onClose((exit) => {
      this.#handleClose(exit);
    });
  }

  async request<C extends SidecarCommandName>(
    command: C,
    params: ParamsOf<C>,
    options: SidecarRequestOptions = {},
  ): Promise<ResultOf<C>> {
    if (this.#closedReason !== null) {
      throw new SidecarError("transport-closed", command, this.#closedReason.message);
    }
    if (options.signal?.aborted === true) {
      throw new SidecarError("cancelled", command, "aborted before dispatch");
    }

    const id = this.#nextId();
    const envelope: SidecarRequestEnvelope = { id, command, params };

    return await new Promise<ResultOf<C>>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
      let done = false;

      const cleanup = (): void => {
        done = true;
        this.#pending.delete(id);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const timer = setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new SidecarError("timeout", command, `no response within ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = (): void => {
        if (done) return;
        cleanup();
        reject(new SidecarError("cancelled", command, "aborted while in flight"));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      this.#pending.set(id, {
        command,
        settle: (outcome) => {
          if (done) return;
          cleanup();
          if (outcome.ok) resolve(outcome.value as ResultOf<C>);
          else reject(outcome.error);
        },
      });

      try {
        this.#transport.send(JSON.stringify(envelope));
      } catch (cause: unknown) {
        cleanup();
        const message = cause instanceof Error ? cause.message : String(cause);
        reject(new SidecarError("transport-closed", command, message));
      }
    });
  }

  close(): void {
    this.#transport.close();
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#logger?.warn("sidecar wrote a line that is not JSON", { line: line.slice(0, 200) });
      return;
    }
    if (!isResponseEnvelope(parsed)) {
      this.#logger?.warn("sidecar wrote an unrecognised envelope", { line: line.slice(0, 200) });
      return;
    }
    const call = this.#pending.get(parsed.id);
    if (call === undefined) {
      // A reply to something already timed out or cancelled. Nothing to do.
      this.#logger?.debug("sidecar replied to an unknown request", { id: parsed.id });
      return;
    }
    if (parsed.ok) {
      call.settle({ ok: true, value: parsed.result });
    } else {
      call.settle({
        ok: false,
        error: new SidecarError("sidecar-error", call.command, `${parsed.error.code}: ${parsed.error.message}`),
      });
    }
  }

  #handleClose(exit: SidecarExit): void {
    const detail = exit.stderr.trim().length > 0 ? exit.stderr.trim() : `exit code ${String(exit.code)}`;
    this.#closedReason = new SidecarError("transport-closed", "sidecar", detail);
    this.#logger?.error("sidecar exited", { code: exit.code, signal: exit.signal });
    for (const [id, call] of this.#pending) {
      this.#pending.delete(id);
      call.settle({
        ok: false,
        error: new SidecarError("transport-closed", call.command, detail),
      });
    }
  }
}
