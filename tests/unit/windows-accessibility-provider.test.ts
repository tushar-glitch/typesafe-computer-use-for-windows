import { describe, expect, it } from "vitest";
import { SidecarClient } from "../../src/adapters/windows/sidecar-client.js";
import { WindowsAccessibilityProvider } from "../../src/adapters/windows/windows-accessibility-provider.js";
import { toUiRole } from "../../src/adapters/windows/mapping.js";
import { FakeTransport } from "../fixtures/fake-transport.js";

function harness(): { provider: WindowsAccessibilityProvider; transport: FakeTransport } {
  const transport = new FakeTransport();
  const client = new SidecarClient(transport, {
    idFactory: (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
  });
  return { provider: new WindowsAccessibilityProvider(client), transport };
}

const emptyTree = {
  onscreen: [],
  offscreen: [],
  focusedField: null,
  truncated: false,
  examined: 0,
  skipped: 0,
  fetchMs: 1,
  classifyMs: 1,
  elapsedMs: 2,
};

describe("toUiRole", () => {
  it("accepts the known vocabulary", () => {
    expect(toUiRole("button")).toBe("button");
    expect(toUiRole("list item")).toBe("list item");
  });

  it("collapses anything unrecognised to other", () => {
    // A newer sidecar must not be able to smuggle an unknown role into the union.
    expect(toUiRole("hyperlink")).toBe("other");
    expect(toUiRole("")).toBe("other");
  });
});

describe("WindowsAccessibilityProvider", () => {
  it("sends the default walk budget", async () => {
    const { provider, transport } = harness();
    const pending = provider.snapshot();

    const envelope = transport.envelopes()[0];
    expect(envelope?.command).toBe("uia_tree");
    expect(envelope?.params).toEqual({ budgetMs: 400 });

    transport.emit({ id: "r1", ok: true, result: emptyTree });
    await pending;
  });

  it("lets the caller override the budget per call", async () => {
    const { provider, transport } = harness();
    const pending = provider.snapshot({ budgetMs: 120 });

    expect(transport.envelopes()[0]?.params).toEqual({ budgetMs: 120 });

    transport.emit({ id: "r1", ok: true, result: emptyTree });
    await pending;
  });

  it("maps elements, handles and the focused field", async () => {
    const { provider, transport } = harness();
    const pending = provider.snapshot();

    transport.emit({
      id: "r1",
      ok: true,
      result: {
        ...emptyTree,
        onscreen: [
          { role: "button", label: "Close", bounds: { x: 10, y: 4, width: 40, height: 20 }, invokable: true, handle: "e1" },
          { role: "weird", label: "Odd", bounds: { x: 0, y: 0, width: 5, height: 5 }, invokable: false, handle: "e2" },
        ],
        offscreen: [
          { role: "menu", label: "Hidden", bounds: { x: -900, y: 0, width: 60, height: 20 }, invokable: true, handle: "e3" },
        ],
        focusedField: {
          role: "field",
          label: "Search",
          placeholder: "Type here",
          value: "note",
          bounds: { x: 100, y: 8, width: 200, height: 24 },
          handle: "e4",
          isEditable: true,
        },
        truncated: true,
        examined: 87,
        elapsedMs: 412,
      },
    });

    const snapshot = await pending;
    expect(snapshot.onscreen).toHaveLength(2);
    expect(snapshot.onscreen[0]).toEqual({
      role: "button",
      label: "Close",
      bounds: { x: 10, y: 4, width: 40, height: 20 },
      invokable: true,
      handle: "e1",
    });
    expect(snapshot.onscreen[1]?.role).toBe("other");
    expect(snapshot.offscreen[0]?.handle).toBe("e3");
    expect(snapshot.focusedField?.element).toBe("e4");
    expect(snapshot.focusedField?.isEditable).toBe(true);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.examined).toBe(87);
    expect(snapshot.elapsed).toBe(412);
  });

  it("tolerates a focused field with no handle", async () => {
    const { provider, transport } = harness();
    const pending = provider.snapshot();

    transport.emit({
      id: "r1",
      ok: true,
      result: {
        ...emptyTree,
        focusedField: {
          role: "other",
          label: "",
          placeholder: "",
          value: "",
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          handle: null,
          isEditable: false,
        },
      },
    });

    const snapshot = await pending;
    expect(snapshot.focusedField?.element).toBeNull();
  });

  it("propagates a sidecar failure", async () => {
    const { provider, transport } = harness();
    const pending = provider.snapshot();
    transport.emit({ id: "r1", ok: false, error: { code: "no-foreground-window", message: "nothing in front" } });
    await expect(pending).rejects.toThrow(/no-foreground-window/);
  });
});
