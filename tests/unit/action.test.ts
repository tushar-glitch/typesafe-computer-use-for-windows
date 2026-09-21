import { describe, expect, it } from "vitest";
import type { AgentAction } from "../../src/core/types/action.js";
import { isTargeted, isTerminal } from "../../src/core/types/action.js";

describe("action classification", () => {
  it("treats done and none as terminal", () => {
    expect(isTerminal({ kind: "done" })).toBe(true);
    expect(isTerminal({ kind: "none" })).toBe(true);
    expect(isTerminal({ kind: "wait" })).toBe(false);
  });

  it("gates confidence only on actions that commit to a target", () => {
    expect(isTargeted({ kind: "click_item", itemIndex: 3 })).toBe(true);
    expect(isTargeted({ kind: "press_offscreen", controlIndex: 1 })).toBe(true);
    // Navigation is recoverable: the next step can leave the page.
    expect(isTargeted({ kind: "open_url", url: "https://example.com" })).toBe(false);
    expect(isTargeted({ kind: "scroll", direction: "down", lines: 10 })).toBe(false);
  });

  it("keeps the union exhaustively switchable", () => {
    const describe_ = (action: AgentAction): string => {
      switch (action.kind) {
        case "click_item":
          return `click ${action.itemIndex}`;
        case "press_offscreen":
          return `press ${action.controlIndex}`;
        case "launch_app":
          return `launch ${action.appId}`;
        case "open_url":
          return `open ${action.url}`;
        case "type_text":
        case "type_email":
          return "type";
        case "press_key":
          return `key ${action.key}`;
        case "scroll":
          return `scroll ${action.direction}`;
        case "wait":
        case "done":
        case "none":
          return action.kind;
      }
    };
    expect(describe_({ kind: "launch_app", appId: "chrome" })).toBe("launch chrome");
  });
});
