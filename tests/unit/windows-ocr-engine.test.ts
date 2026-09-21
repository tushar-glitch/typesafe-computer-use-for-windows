import { describe, expect, it } from "vitest";
import { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsOcrEngine } from "../../src/adapters/windows/windows-ocr-engine.js";
import type { ScreenImage } from "../../src/core/types/observation.js";
import { FakeTransport } from "../fixtures/fake-transport.js";

const image: ScreenImage = {
  data: Uint8Array.from([1, 2, 3, 4]),
  format: "png",
  size: { width: 100, height: 50 },
};

function harness(): { engine: WindowsOcrEngine; transport: FakeTransport } {
  const transport = new FakeTransport();
  const client = new SidecarClient(transport, { idFactory: (() => { let n = 0; return () => `r${++n}`; })() });
  return { engine: new WindowsOcrEngine(client), transport };
}

describe("WindowsOcrEngine", () => {
  it("sends the image and omits region when none is given", async () => {
    const { engine, transport } = harness();
    const pending = engine.recognize(image);

    const [envelope] = transport.envelopes();
    expect(envelope?.command).toBe("ocr");
    const params = envelope?.params as { imageBase64: string; region?: unknown };
    expect(params.imageBase64).toBe(Buffer.from(image.data).toString("base64"));
    expect(params).not.toHaveProperty("region");

    transport.emit({ id: "r1", ok: true, result: { lines: [], language: "en-US" } });
    await expect(pending).resolves.toEqual([]);
  });

  it("passes a region through when one is given", async () => {
    const { engine, transport } = harness();
    const pending = engine.recognize(image, { x: 10, y: 20, width: 30, height: 40 });

    const params = transport.envelopes()[0]?.params as { region: unknown };
    expect(params.region).toEqual({ x: 10, y: 20, width: 30, height: 40 });

    transport.emit({ id: "r1", ok: true, result: { lines: [], language: "en-US" } });
    await pending;
  });

  it("maps DTO lines onto domain lines", async () => {
    const { engine, transport } = harness();
    const pending = engine.recognize(image);

    transport.emit({
      id: "r1",
      ok: true,
      result: {
        language: "en-US",
        lines: [
          { text: "Sign in", confidence: 1, bounds: { x: 4, y: 8, width: 60, height: 16 } },
          { text: "Search", confidence: 0.5, bounds: { x: 4, y: 30, width: 50, height: 16 } },
        ],
      },
    });

    const lines = await pending;
    expect(lines).toEqual([
      { text: "Sign in", confidence: 1, bounds: { x: 4, y: 8, width: 60, height: 16 } },
      { text: "Search", confidence: 0.5, bounds: { x: 4, y: 30, width: 50, height: 16 } },
    ]);
  });

  it("clamps an out-of-range confidence rather than throwing", async () => {
    const { engine, transport } = harness();
    const pending = engine.recognize(image);

    transport.emit({
      id: "r1",
      ok: true,
      result: { language: "en-US", lines: [{ text: "x", confidence: 4.2, bounds: { x: 0, y: 0, width: 1, height: 1 } }] },
    });

    const lines = await pending;
    expect(lines[0]?.confidence).toBe(1);
  });

  it("propagates a sidecar failure", async () => {
    const { engine, transport } = harness();
    const pending = engine.recognize(image);
    transport.emit({ id: "r1", ok: false, error: { code: "no-ocr-language", message: "no language pack" } });
    await expect(pending).rejects.toThrow(/no-ocr-language/);
  });
});
