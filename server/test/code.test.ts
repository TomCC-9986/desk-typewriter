import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, generateCode, normalizeCode } from "../../shared/code";

describe("pairing code", () => {
  it("generates XXX-XXX from the unambiguous alphabet", () => {
    let i = 0;
    const code = generateCode(() => i++);
    expect(code).toBe("ABC-DEF");
    for (let n = 0; n < 50; n++) {
      expect(generateCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{3}-[A-HJ-KM-NP-Z2-9]{3}$/);
    }
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
  });

  it("normalizes user input", () => {
    expect(normalizeCode("k7q 29m")).toBe("K7Q-29M");
    expect(normalizeCode("K7Q-29M")).toBe("K7Q-29M");
    expect(normalizeCode("k7q29m")).toBe("K7Q-29M");
  });

  it("rejects wrong length or ambiguous characters", () => {
    expect(normalizeCode("K7Q-29")).toBeNull();
    expect(normalizeCode("K7O-29M")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});
