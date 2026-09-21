import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidecarClient, SidecarError } from "../../src/adapters/windows/sidecar-client.js";
import { FakeTransport } from "../fixtures/fake-transport.js";

const EMPTY = {} as Readonly<Record<string, never>>;

describe("SidecarClient", () => {
  let transport: FakeTransport;
  let client: SidecarClient;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = new FakeTransport();
    client = new SidecarClient(transport, { idFactory: (() => { let n = 0; return () => `r${++n}`; })() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a correlated envelope", async () => {
    const pending = client.request("ping", EMPTY);
    expect(transport.envelopes()).toEqual([{ id: "r1", command: "ping", params: {} }]);

    transport.emit({ id: "r1", ok: true, result: { protocolVersion: 1, sidecarVersion: "0.1.0", processId: 42 } });
    await expect(pending).resolves.toEqual({ protocolVersion: 1, sidecarVersion: "0.1.0", processId: 42 });
  });

  it("correlates replies that arrive out of order", async () => {
    const first = client.request("ping", EMPTY);
    const second = client.request("foreground", EMPTY);

    transport.emit({ id: "r2", ok: true, result: { processId: 9, processName: "chrome", title: "x", bounds: { x: 0, y: 0, width: 1, height: 1 } } });
    transport.emit({ id: "r1", ok: true, result: { protocolVersion: 1, sidecarVersion: "0.1.0", processId: 1 } });

    await expect(second).resolves.toMatchObject({ processName: "chrome" });
    await expect(first).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it("rejects when the sidecar reports an error", async () => {
    const pending = client.request("capture", { target: "foreground-window" });
    transport.emit({ id: "r1", ok: false, error: { code: "no-window", message: "nothing in the foreground" } });

    await expect(pending).rejects.toThrow(SidecarError);
    await expect(pending).rejects.toMatchObject({ code: "sidecar-error", command: "capture" });
  });

  it("times out when no reply arrives", async () => {
    const pending = client.request("ping", EMPTY, { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(client.pendingCount).toBe(0);
  });

  it("honours an abort signal mid-flight", async () => {
    const controller = new AbortController();
    const pending = client.request("ping", EMPTY, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    controller.abort();
    await assertion;
    expect(client.pendingCount).toBe(0);
  });

  it("refuses a request whose signal is already aborted", async () => {
    await expect(client.request("ping", EMPTY, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(transport.sent).toHaveLength(0);
  });

  it("fails every outstanding call when the sidecar dies", async () => {
    const first = client.request("ping", EMPTY);
    const second = client.request("foreground", EMPTY);

    transport.die({ code: 3, stderr: "System.AccessViolationException" });

    await expect(first).rejects.toMatchObject({ code: "transport-closed" });
    await expect(second).rejects.toThrow(/AccessViolationException/);
    expect(client.pendingCount).toBe(0);
  });

  it("refuses new requests once the sidecar has died", async () => {
    transport.die({ code: 1, stderr: "boom" });
    await expect(client.request("ping", EMPTY)).rejects.toMatchObject({ code: "transport-closed" });
  });

  it("ignores malformed lines and replies to unknown ids", async () => {
    const pending = client.request("ping", EMPTY);

    transport.emit("this is not json");
    transport.emit({ id: "r1" });
    transport.emit({ id: "unknown", ok: true, result: {} });
    expect(client.pendingCount).toBe(1);

    transport.emit({ id: "r1", ok: true, result: { protocolVersion: 1, sidecarVersion: "0.1.0", processId: 7 } });
    await expect(pending).resolves.toMatchObject({ processId: 7 });
  });

  it("does not settle twice when a reply follows a timeout", async () => {
    const pending = client.request("ping", EMPTY, { timeoutMs: 500 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(501);
    await assertion;

    expect(() => {
      transport.emit({ id: "r1", ok: true, result: { protocolVersion: 1, sidecarVersion: "0.1.0", processId: 1 } });
    }).not.toThrow();
  });
});
