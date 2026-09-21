import { describe, expect, it } from "vitest";
import { LineBuffer } from "../../src/adapters/windows/transport.js";

describe("LineBuffer", () => {
  it("emits complete lines only", () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("holds a partial line until its newline arrives", () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"big":"AAA')).toEqual([]);
    expect(buffer.remainder).toBe('{"big":"AAA');
    expect(buffer.push('BBB"}\n')).toEqual(['{"big":"AAABBB"}']);
    expect(buffer.remainder).toBe("");
  });

  it("survives a chunk boundary falling on the newline", () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}')).toEqual([]);
    expect(buffer.push("\n")).toEqual(['{"a":1}']);
  });

  it("strips carriage returns and drops blank lines", () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\r\n\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });
});
