import { describe, expect, it } from "vitest";
import { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsAppLauncher } from "../../src/adapters/windows/windows-app-launcher.js";
import { WindowsElementInvoker } from "../../src/adapters/windows/windows-element-invoker.js";
import { WindowsInputDevice } from "../../src/adapters/windows/windows-input-device.js";
import type { ElementHandle } from "../../src/core/types/observation.js";
import { FakeTransport } from "../fixtures/fake-transport.js";

function client(transport: FakeTransport): SidecarClient {
  return new SidecarClient(transport, {
    idFactory: (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
  });
}

/** Runs an adapter call, feeds it one reply, and returns what went over the wire. */
async function exchange<T>(
  act: (transport: FakeTransport) => Promise<T>,
  reply: unknown,
): Promise<{ command: string; params: unknown; value: T }> {
  const transport = new FakeTransport();
  const pending = act(transport);
  const envelope = transport.envelopes()[0];
  transport.emit({ id: envelope?.id, ok: true, result: reply });
  const value = await pending;
  return { command: envelope?.command ?? "", params: envelope?.params, value };
}

describe("WindowsInputDevice", () => {
  it("clicks at a point", async () => {
    const result = await exchange(
      (t) => new WindowsInputDevice(client(t)).click({ x: 640, y: 360 }),
      { ok: true },
    );
    expect(result.command).toBe("input_click");
    expect(result.params).toEqual({ x: 640, y: 360 });
  });

  it("passes negative coordinates through for a secondary monitor", async () => {
    // A display above or left of the primary lives at negative coordinates.
    const result = await exchange(
      (t) => new WindowsInputDevice(client(t)).moveTo({ x: -200, y: -900 }),
      { ok: true },
    );
    expect(result.params).toEqual({ x: -200, y: -900 });
  });

  it("sends nothing for empty text", async () => {
    const transport = new FakeTransport();
    await new WindowsInputDevice(client(transport)).typeText("");
    expect(transport.sent).toHaveLength(0);
  });

  it("converts lines to wheel notches, negative for downward", async () => {
    const down = await exchange((t) => new WindowsInputDevice(client(t)).scroll("down", 9), { ok: true });
    expect(down.params).toEqual({ notches: -3 });

    const up = await exchange((t) => new WindowsInputDevice(client(t)).scroll("up", 9), { ok: true });
    expect(up.params).toEqual({ notches: 3 });
  });

  it("always scrolls at least one notch", async () => {
    const result = await exchange((t) => new WindowsInputDevice(client(t)).scroll("down", 1), { ok: true });
    expect(result.params).toEqual({ notches: -1 });
  });

  it("presses a named key", async () => {
    const result = await exchange((t) => new WindowsInputDevice(client(t)).pressKey("enter"), { ok: true });
    expect(result.command).toBe("input_key");
    expect(result.params).toEqual({ key: "enter" });
  });

  it("surfaces blocked input as an error", async () => {
    const transport = new FakeTransport();
    const pending = new WindowsInputDevice(client(transport)).click({ x: 1, y: 1 });
    transport.emit({
      id: "r1",
      ok: false,
      error: { code: "input-blocked", message: "target window is running elevated" },
    });
    await expect(pending).rejects.toThrow(/input-blocked/);
  });
});

describe("WindowsElementInvoker", () => {
  const handle = "e42" as ElementHandle;

  it("reports acceptance", async () => {
    const result = await exchange((t) => new WindowsElementInvoker(client(t)).invoke(handle), { accepted: true });
    expect(result.command).toBe("element_invoke");
    expect(result.params).toEqual({ handle: "e42" });
    expect(result.value).toBe(true);
  });

  it("treats refusal as a value, not an error", async () => {
    // Controls routinely advertise a pattern and then decline it; the caller
    // falls back to a synthetic click rather than failing the step.
    const result = await exchange((t) => new WindowsElementInvoker(client(t)).invoke(handle), { accepted: false });
    expect(result.value).toBe(false);
  });

  it("sets a field value", async () => {
    const result = await exchange(
      (t) => new WindowsElementInvoker(client(t)).setValue(handle, "hello"),
      { accepted: true },
    );
    expect(result.params).toEqual({ handle: "e42", text: "hello" });
  });

  it("reads a value back, or null when there is none", async () => {
    const present = await exchange((t) => new WindowsElementInvoker(client(t)).readValue(handle), { value: "abc" });
    expect(present.value).toBe("abc");

    const absent = await exchange((t) => new WindowsElementInvoker(client(t)).readValue(handle), { value: null });
    expect(absent.value).toBeNull();
  });

  it("fails loudly on an expired handle", async () => {
    const transport = new FakeTransport();
    const pending = new WindowsElementInvoker(client(transport)).invoke(handle);
    transport.emit({
      id: "r1",
      ok: false,
      error: { code: "unknown-element", message: "no live element for handle" },
    });
    await expect(pending).rejects.toThrow(/unknown-element/);
  });
});

describe("WindowsAppLauncher", () => {
  it("launches by name", async () => {
    const result = await exchange((t) => new WindowsAppLauncher(client(t)).launch("notepad"), { started: true });
    expect(result.command).toBe("launch_app");
    expect(result.params).toEqual({ appId: "notepad" });
    expect(result.value).toBe(true);
  });

  it("opens a URL", async () => {
    const result = await exchange(
      (t) => new WindowsAppLauncher(client(t)).openUrl("https://example.com/"),
      { started: true },
    );
    expect(result.command).toBe("open_url");
    expect(result.params).toEqual({ url: "https://example.com/" });
  });

  it("rejects a non-web scheme via the sidecar", async () => {
    const transport = new FakeTransport();
    const pending = new WindowsAppLauncher(client(transport)).openUrl("file:///C:/secret.txt");
    transport.emit({ id: "r1", ok: false, error: { code: "bad-url", message: "not an http or https URL" } });
    await expect(pending).rejects.toThrow(/bad-url/);
  });

  it("reports a refused activation as false", async () => {
    const result = await exchange((t) => new WindowsAppLauncher(client(t)).activate("chrome"), { activated: false });
    expect(result.value).toBe(false);
  });

  it("maps the foreground window into the domain", async () => {
    const result = await exchange((t) => new WindowsAppLauncher(client(t)).foreground(), {
      processId: 1234,
      processName: "explorer",
      title: "File Explorer",
      bounds: { x: -246, y: 41, width: 1125, height: 593 },
    });
    expect(result.value).toEqual({
      processId: 1234,
      processName: "explorer",
      title: "File Explorer",
      bounds: { x: -246, y: 41, width: 1125, height: 593 },
    });
  });
});
