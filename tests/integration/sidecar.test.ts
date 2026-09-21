/**
 * End-to-end against the real sidecar process.
 *
 * Skipped when the binary is absent, so a clean checkout without .NET still
 * runs a green suite; CI builds it first.
 */

import { afterAll, describe, expect, it } from "vitest";
import { resolveSidecarPath, startSidecar } from "../../src/adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";

const built = resolveSidecarPath() !== null;
const EMPTY = {} as Readonly<Record<string, never>>;

describe.skipIf(!built)("sidecar (integration)", () => {
  let client: SidecarClient | null = null;

  const connect = (): SidecarClient => {
    client ??= startSidecar({ defaultTimeoutMs: 15_000 });
    return client;
  };

  afterAll(() => {
    client?.close();
  });

  it("answers a handshake with a matching protocol version", async () => {
    const pong = await connect().request("ping", EMPTY);
    expect(pong.protocolVersion).toBe(1);
    expect(pong.processId).toBeGreaterThan(0);
  });

  it("reports the foreground window", async () => {
    const foreground = await connect().request("foreground", EMPTY);
    expect(foreground.processId).toBeGreaterThan(0);
    expect(foreground.processName.length).toBeGreaterThan(0);
    expect(foreground.bounds.width).toBeGreaterThan(0);
    expect(foreground.bounds.height).toBeGreaterThan(0);
  });

  it("captures the primary display as a decodable PNG", async () => {
    const capture = await connect().request("capture", { target: "primary-display" });
    const bytes = Buffer.from(capture.imageBase64, "base64");

    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // The PNG IHDR dimensions must agree with the reported ones.
    expect(bytes.readUInt32BE(16)).toBe(capture.width);
    expect(bytes.readUInt32BE(20)).toBe(capture.height);
    expect(capture.width).toBeGreaterThan(100);
    expect(capture.displayScale).toBeGreaterThan(0);
  });

  it("surfaces a sidecar-side failure as a typed error", async () => {
    await expect(
      connect().request("capture", { target: "bogus" as "primary-display" }),
    ).rejects.toMatchObject({ code: "sidecar-error" });
  });

  it("serves concurrent requests without crossing replies", async () => {
    const sidecar = connect();
    const [ping, foreground] = await Promise.all([
      sidecar.request("ping", EMPTY),
      sidecar.request("foreground", EMPTY),
    ]);
    expect(ping.protocolVersion).toBe(1);
    expect(foreground.processId).toBeGreaterThan(0);
  });
});
