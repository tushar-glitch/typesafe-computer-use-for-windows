import { describe, expect, it, vi } from "vitest";
import { TypeTextHandler } from "../../src/application/handlers/type-text-handler.js";
import { VerbatimTextComposer } from "../../src/application/text/verbatim-text-composer.js";
import type { IInputDevice } from "../../src/core/ports/execution.js";
import type { IFocusedFieldReader } from "../../src/core/ports/perception.js";
import type { FocusedField } from "../../src/core/types/observation.js";
import { spoken } from "../fixtures/fake-launcher.js";

const NEVER_ABORTED = new AbortController().signal;

function editableField(label = "Text Editor"): FocusedField {
  return {
    role: "field",
    label,
    placeholder: "",
    value: "",
    bounds: { x: 0, y: 0, width: 400, height: 200 },
    element: null,
    isEditable: true,
  };
}

function reader(field: FocusedField | null): IFocusedFieldReader {
  return { focusedField: () => Promise.resolve(field) };
}

function input(): IInputDevice {
  return {
    moveTo: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    clearFocusedField: vi.fn(async () => undefined),
  };
}

describe("VerbatimTextComposer", () => {
  const composer = new VerbatimTextComposer();

  it("takes the words after the verb", () => {
    expect(composer.text("type hello world")).toBe("hello world");
    expect(composer.text("write down the meeting is at four")).toBe("the meeting is at four");
    expect(composer.text("enter tushar@example.com")).toBe("tushar@example.com");
  });

  it("survives speech filler", () => {
    expect(composer.text("hey can you please type hello world")).toBe("hello world");
  });

  it("declines a request to invent text rather than typing it literally", () => {
    // Typing the words "anything about india" into a document looks broken.
    // Declining lets the caller say what is actually missing.
    expect(composer.text("type anything about india")).toBeNull();
    expect(composer.text("write a poem about the sea")).toBeNull();
    expect(composer.text("type something clever")).toBeNull();
  });

  it("declines when there is no typing verb at all", () => {
    expect(composer.text("open notepad")).toBeNull();
  });

  it("declines a verb with nothing after it", () => {
    expect(composer.text("type")).toBeNull();
  });
});

describe("TypeTextHandler", () => {
  it("claims a typing command without reading the screen", () => {
    const handler = new TypeTextHandler(input(), reader(null));

    // canHandle may be asked of several handlers, so none of them may do work.
    expect(handler.canHandle(spoken("type hello world"))).toBe(true);
    expect(handler.canHandle(spoken("open notepad"))).toBe(false);

    // Claimed even though the default composer cannot serve it, so the reason
    // reaches the speaker instead of the screen loop failing obscurely.
    expect(handler.canHandle(spoken("type anything about india"))).toBe(true);
  });

  it("types into a focused editable field", async () => {
    const device = input();
    const handler = new TypeTextHandler(device, reader(editableField()));

    const outcome = await handler.execute(spoken("type hello world"), NEVER_ABORTED);

    expect(outcome.status).toBe("completed");
    expect(device.typeText).toHaveBeenCalledWith("hello world", NEVER_ABORTED);
  });

  it("hands back to the chain when nothing editable has focus", async () => {
    const device = input();
    const handler = new TypeTextHandler(device, reader(null));

    const outcome = await handler.execute(spoken("type hello world"), NEVER_ABORTED);

    // Unhandled, not failed: the screen loop can click into a field first.
    expect(outcome.status).toBe("unhandled");
    expect(device.typeText).not.toHaveBeenCalled();
  });

  it("refuses to type into something that is not editable", async () => {
    const device = input();
    const readOnly: FocusedField = { ...editableField(), role: "button", isEditable: false };
    const handler = new TypeTextHandler(device, reader(readOnly));

    const outcome = await handler.execute(spoken("type hello world"), NEVER_ABORTED);

    expect(outcome.status).toBe("unhandled");
    expect(device.typeText).not.toHaveBeenCalled();
  });

  it("explains itself when asked to compose text it cannot write", async () => {
    const device = input();
    const handler = new TypeTextHandler(device, reader(editableField()));

    const outcome = await handler.execute(spoken("type anything about india"), NEVER_ABORTED);

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toMatch(/writing model/);
    expect(device.typeText).not.toHaveBeenCalled();
  });

  it("uses a composer that can write, when one is supplied", async () => {
    const device = input();
    const generative = {
      name: "fake-writer",
      compose: () => Promise.resolve("India is a country in South Asia."),
    };
    const handler = new TypeTextHandler(device, reader(editableField()), generative);

    const outcome = await handler.execute(spoken("type anything about india"), NEVER_ABORTED);

    expect(outcome.status).toBe("completed");
    expect(device.typeText).toHaveBeenCalledWith("India is a country in South Asia.", NEVER_ABORTED);
  });

  it("passes the field context to the composer", async () => {
    const compose = vi.fn(() => Promise.resolve("ok"));
    const handler = new TypeTextHandler(input(), reader(editableField("Search")), { name: "spy", compose });

    await handler.execute(spoken("type hello"), NEVER_ABORTED);

    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: "type hello", fieldLabel: "Search" }),
      NEVER_ABORTED,
    );
  });
});
