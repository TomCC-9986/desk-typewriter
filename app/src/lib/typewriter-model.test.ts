import { describe, expect, it } from "vitest";
import { MAX_TEXT } from "@shared/protocol";
import { TypewriterModel } from "./typewriter-model";

describe("TypewriterModel", () => {
  it("types and reports text", () => {
    const m = new TypewriterModel();
    expect(m.type("你好")).toBe("你好");
    expect(m.text()).toBe("你好");
    expect(m.length).toBe(2);
  });

  it("backspace erases the last char", () => {
    const m = new TypewriterModel("ab");
    expect(m.backspace()).toBe(true);
    expect(m.text()).toBe("a");
    expect(m.cells).toEqual([{ ch: "a", struck: false }]);
    m.backspace();
    expect(m.text()).toBe("");
    expect(m.backspace()).toBe(false);
  });

  it("backspace removes a newline", () => {
    const m = new TypewriterModel("a\n");
    m.backspace();
    expect(m.cells).toEqual([{ ch: "a", struck: false }]);
  });

  it("stops at MAX_TEXT live chars", () => {
    const m = new TypewriterModel();
    expect(m.type("字".repeat(MAX_TEXT + 5))).toHaveLength(MAX_TEXT);
    expect(m.length).toBe(MAX_TEXT);
    m.backspace();
    expect(m.type("多一")).toBe("多");
  });

  it("clear empties everything", () => {
    const m = new TypewriterModel("abc");
    m.clear();
    expect(m.cells).toEqual([]);
  });
});
