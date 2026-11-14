import { describe, expect, it } from "vitest";
import { charWidth, wrap, wrapItems } from "./layout";

describe("layout", () => {
  it("measures CJK and fullwidth as 2, latin as 1", () => {
    expect(charWidth("a")).toBe(1);
    expect(charWidth(" ")).toBe(1);
    expect(charWidth("你")).toBe(2);
    expect(charWidth("，")).toBe(2);
    expect(charWidth("😀")).toBe(2);
  });

  it("wraps by width units", () => {
    expect(wrap("abc", 2)).toEqual(["ab", "c"]);
    expect(wrap("你好吗", 4)).toEqual(["你好", "吗"]);
    expect(wrap("a你好", 4)).toEqual(["a你", "好"]);
  });

  it("honours newlines and empty input", () => {
    expect(wrap("a\nb", 10)).toEqual(["a", "b"]);
    expect(wrap("a\n", 10)).toEqual(["a", ""]);
    expect(wrap("", 10)).toEqual([""]);
  });

  it("wraps arbitrary items", () => {
    const items = [{ ch: "你" }, { ch: "\n" }, { ch: "b" }];
    expect(wrapItems(items, (i) => i.ch, 4)).toEqual([[{ ch: "你" }], [{ ch: "b" }]]);
  });
});
