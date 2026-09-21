/**
 * The UIA walk against the real tree of whatever window is in front.
 *
 * Deliberately light on counts: the foreground window is whatever the machine
 * happens to be showing, and it may legitimately expose nothing (a minimised
 * window reports off-screen bounds and everything gets pruned). What is
 * asserted is that the walk stays inside its budget and that everything it
 * does return is well formed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { resolveSidecarPath, startSidecar } from "../../src/adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsAccessibilityProvider } from "../../src/adapters/windows/windows-accessibility-provider.js";
import type { UiRole } from "../../src/core/types/observation.js";

const built = resolveSidecarPath() !== null;

const ROLES: ReadonlySet<UiRole> = new Set<UiRole>([
  "button", "link", "field", "checkbox", "radio", "tab",
  "menu", "list item", "cell", "image", "slider", "combo", "other",
]);

describe.skipIf(!built)("UI Automation (integration)", () => {
  let client: SidecarClient | null = null;
  const connect = (): SidecarClient => (client ??= startSidecar({ defaultTimeoutMs: 20_000 }));

  afterAll(() => client?.close());

  it("returns a well-formed snapshot of the foreground window", async () => {
    const snapshot = await new WindowsAccessibilityProvider(connect()).snapshot();

    expect(Array.isArray(snapshot.onscreen)).toBe(true);
    expect(Array.isArray(snapshot.offscreen)).toBe(true);
    expect(snapshot.examined).toBeGreaterThanOrEqual(0);

    for (const element of [...snapshot.onscreen, ...snapshot.offscreen]) {
      expect(ROLES.has(element.role)).toBe(true);
      expect(element.label.length).toBeGreaterThan(0);
      expect(element.handle.length).toBeGreaterThan(0);
      expect(element.bounds.width).toBeGreaterThan(0);
      expect(element.bounds.height).toBeGreaterThan(0);
    }
  });

  it("gives every element a distinct handle", async () => {
    const snapshot = await new WindowsAccessibilityProvider(connect()).snapshot();
    const handles = [...snapshot.onscreen, ...snapshot.offscreen].map((element) => element.handle);

    expect(new Set(handles).size).toBe(handles.length);
  });

  it("honours the walk budget", async () => {
    const provider = new WindowsAccessibilityProvider(connect());

    const started = performance.now();
    const snapshot = await provider.snapshot({ budgetMs: 150 });
    const wall = performance.now() - started;

    // The budget bounds the walk, not the round trip, so allow generous slack
    // for process hand-off. The point is that it returns promptly rather than
    // running to completion on a large tree.
    expect(wall).toBeLessThan(3_000);
    expect(snapshot.elapsed).toBeLessThan(1_500);
  });

  it("offers off-screen controls only when they can be invoked", async () => {
    const snapshot = await new WindowsAccessibilityProvider(connect()).snapshot();

    // Nothing on the capture points at these, so a click cannot reach them.
    for (const element of snapshot.offscreen) {
      expect(element.invokable).toBe(true);
    }
  });
});
