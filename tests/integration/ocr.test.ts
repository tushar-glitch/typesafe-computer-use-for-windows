/** OCR against the real Windows engine, on a real screen capture. */

import { afterAll, describe, expect, it } from "vitest";
import { resolveSidecarPath, startSidecar } from "../../src/adapters/windows/sidecar-process.js";
import type { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsOcrEngine } from "../../src/adapters/windows/windows-ocr-engine.js";
import { toScreenImage } from "../../src/adapters/windows/mapping.js";
import { right, bottom } from "../../src/core/types/geometry.js";

const built = resolveSidecarPath() !== null;

describe.skipIf(!built)("Windows OCR (integration)", () => {
  let client: SidecarClient | null = null;
  const connect = (): SidecarClient => (client ??= startSidecar({ defaultTimeoutMs: 20_000 }));

  afterAll(() => client?.close());

  it("recognises text on the live screen, within the image bounds", async () => {
    const sidecar = connect();
    const capture = await sidecar.request("capture", { target: "primary-display" });
    const image = toScreenImage(capture);

    const lines = await new WindowsOcrEngine(sidecar).recognize(image);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.bounds.width).toBeGreaterThan(0);
      expect(line.bounds.height).toBeGreaterThan(0);
      // Every box must sit inside the image it was read from.
      expect(line.bounds.x).toBeGreaterThanOrEqual(0);
      expect(line.bounds.y).toBeGreaterThanOrEqual(0);
      expect(right(line.bounds)).toBeLessThanOrEqual(image.size.width + 1);
      expect(bottom(line.bounds)).toBeLessThanOrEqual(image.size.height + 1);
    }
  });

  it("maps a cropped region back into full-image coordinates", async () => {
    const sidecar = connect();
    const capture = await sidecar.request("capture", { target: "primary-display" });
    const image = toScreenImage(capture);
    const engine = new WindowsOcrEngine(sidecar);

    const halfway = Math.floor(image.size.width / 2);
    const lines = await engine.recognize(image, {
      x: halfway,
      y: 0,
      width: image.size.width - halfway,
      height: image.size.height,
    });

    // Results are reported against the full image, not the crop, so nothing
    // downstream needs to know a crop happened.
    for (const line of lines) {
      expect(line.bounds.x).toBeGreaterThanOrEqual(halfway - 1);
    }
  });

  it("rejects a region with no area", async () => {
    const sidecar = connect();
    const capture = await sidecar.request("capture", { target: "primary-display" });
    const image = toScreenImage(capture);

    await expect(
      new WindowsOcrEngine(sidecar).recognize(image, { x: 0, y: 0, width: 0, height: 0 }),
    ).rejects.toThrow(/empty-region/);
  });
});
