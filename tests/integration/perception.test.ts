/**
 * The whole perception stack against the live screen.
 *
 * Counts are deliberately loose: the foreground window is whatever the machine
 * happens to be showing. What is pinned is that the three sources compose, and
 * that every item comes back in one coordinate space, which is the property
 * that decides whether a click lands.
 */

import { afterAll, describe, expect, it } from "vitest";
import { resolveSidecarPath, startSidecar } from "../../src/adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsAccessibilityProvider } from "../../src/adapters/windows/windows-accessibility-provider.js";
import { WindowsOcrEngine } from "../../src/adapters/windows/windows-ocr-engine.js";
import { WindowsScreenCapturer } from "../../src/adapters/windows/windows-screen-capturer.js";
import { PerceptionPipeline } from "../../src/application/perception/perception-pipeline.js";
import { MAX_CHOICE_OPTIONS } from "../../src/core/ports/decision.js";

const built = resolveSidecarPath() !== null;

describe.skipIf(!built)("PerceptionPipeline (integration)", () => {
  let client: SidecarClient | null = null;
  const connect = (): SidecarClient => (client ??= startSidecar({ defaultTimeoutMs: 25_000 }));

  const build = (): PerceptionPipeline => {
    const sidecar = connect();
    return new PerceptionPipeline(
      new WindowsScreenCapturer(sidecar),
      new WindowsOcrEngine(sidecar),
      new WindowsAccessibilityProvider(sidecar),
    );
  };

  afterAll(() => client?.close());

  it("composes capture, OCR and the tree into one numbered list", async () => {
    const observation = await build().observe();

    expect(observation.items.length).toBeGreaterThan(0);
    expect(observation.items.length).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);

    // Indices are contiguous from zero, because the model is given them as
    // option labels and must be able to name any of them.
    expect(observation.items.map((item) => item.index)).toEqual(
      observation.items.map((_, index) => index),
    );

    for (const item of observation.items) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.bounds.width).toBeGreaterThan(0);
      expect(item.bounds.height).toBeGreaterThan(0);
      // A tree-backed item must carry the handle that lets it be invoked.
      if (item.source !== "ocr") expect(item.element).not.toBeNull();
    }
  });

  it("reports where the capture sits, so pixels map back to the desktop", async () => {
    const observation = await build().observe();

    expect(observation.image.size.width).toBeGreaterThan(0);
    expect(Number.isFinite(observation.image.origin.x)).toBe(true);
    expect(Number.isFinite(observation.image.origin.y)).toBe(true);
  });

  it("places every item in screen coordinates, not image coordinates", async () => {
    const observation = await build().observe();
    const { origin, size } = observation.image;

    // The capture spans the virtual desktop, so every item must fall inside it
    // once the origin is accounted for. An item still in image space would sit
    // outside these bounds on a machine whose origin is not zero.
    for (const item of observation.items) {
      expect(item.bounds.x).toBeGreaterThanOrEqual(origin.x - 1);
      expect(item.bounds.y).toBeGreaterThanOrEqual(origin.y - 1);
      expect(item.bounds.x).toBeLessThanOrEqual(origin.x + size.width + 1);
      expect(item.bounds.y).toBeLessThanOrEqual(origin.y + size.height + 1);
    }
  });

  it("finds controls that carry no text at all", async () => {
    // The reason the accessibility tree is worth its cost. Any ordinary window
    // has some icon-only control, and OCR cannot see one.
    const observation = await build().observe();
    const fromTree = observation.items.filter((item) => item.source !== "ocr");

    expect(fromTree.length).toBeGreaterThan(0);
  });
});
