import { describe, expect, it } from "vitest";
import { noteFileBody, noteFileName } from "./note-file";

const note = { id: "ab12cd34", from: "u", fromName: "小/王", text: "哥们吃饭了吗", sentAt: new Date(2026, 10, 11, 14, 2).getTime() };

describe("note file", () => {
  it("builds a safe file name", () => {
    expect(noteFileName(note)).toBe("纸条-小_王-1402-ab12cd34.txt");
  });
  it("sanitizes control chars and trailing dots", () => {
    expect(noteFileName({ ...note, fromName: "a\nb.. " })).toBe("纸条-a_b-1402-ab12cd34.txt");
  });
  it("writes text and signature", () => {
    expect(noteFileBody(note)).toBe("哥们吃饭了吗\n\n— 小/王 2026-11-11 14:02\n");
  });
});
