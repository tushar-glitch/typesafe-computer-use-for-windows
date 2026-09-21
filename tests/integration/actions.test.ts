/**
 * Real input against the real desktop.
 *
 * Skipped unless JEV_ALLOW_INPUT_TESTS=1. These move the cursor, press keys and
 * start applications, so running them by accident during an ordinary `pnpm
 * test` would fight whoever is using the machine. Opt in deliberately:
 *
 *   JEV_ALLOW_INPUT_TESTS=1 pnpm test
 */

import { afterAll, describe, expect, it } from "vitest";
import { resolveSidecarPath, startSidecar } from "../../src/adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsAppLauncher } from "../../src/adapters/windows/windows-app-launcher.js";
import { WindowsInputDevice } from "../../src/adapters/windows/windows-input-device.js";
import { WindowsAccessibilityProvider } from "../../src/adapters/windows/windows-accessibility-provider.js";

const enabled = resolveSidecarPath() !== null && process.env["JEV_ALLOW_INPUT_TESTS"] === "1";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!enabled)("actions (integration, opt-in)", () => {
  let client: SidecarClient | null = null;
  const connect = (): SidecarClient => (client ??= startSidecar({ defaultTimeoutMs: 20_000 }));

  afterAll(() => client?.close());

  it("refuses a non-web URL", async () => {
    await expect(new WindowsAppLauncher(connect()).openUrl("file:///C:/Windows/System32/")).rejects.toThrow(/bad-url/);
  });

  it("refuses an unknown key rather than pressing something arbitrary", async () => {
    // The named-key set is closed on purpose; arbitrary injection is a larger
    // capability than this agent needs.
    await expect(
      connect().request("input_key", { key: "f4" }),
    ).rejects.toThrow(/unknown-key/);
  });

  it("launches an app, types into it, and reads the text back through UI Automation", async () => {
    const sidecar = connect();
    const launcher = new WindowsAppLauncher(sidecar);
    const input = new WindowsInputDevice(sidecar);
    const accessibility = new WindowsAccessibilityProvider(sidecar);

    expect(await launcher.launch("notepad")).toBe(true);

    // Poll rather than guess: process start time varies widely.
    let foreground = await launcher.foreground();
    for (let attempt = 0; attempt < 40 && foreground.processName.toLowerCase() !== "notepad"; attempt++) {
      await sleep(100);
      foreground = await launcher.foreground();
    }
    expect(foreground.processName.toLowerCase()).toBe("notepad");

    const before = await accessibility.snapshot();
    expect(before.focusedField?.isEditable).toBe(true);

    const phrase = `jev-${Date.now()}`;
    await input.typeText(phrase);
    await sleep(250);

    // Verified through a different subsystem than the one that wrote it.
    const after = await accessibility.snapshot();
    expect(after.focusedField?.value).toContain(phrase);

    // Leave no unsaved document behind.
    await input.clearFocusedField();
  });
});
