import { describe, expect, it } from "vitest";
import { PROJECT_NAME } from "../../src/index.js";

describe("toolchain", () => {
  it("resolves ESM imports from src", () => {
    expect(PROJECT_NAME).toBe("jev-voice-windows");
  });
});
