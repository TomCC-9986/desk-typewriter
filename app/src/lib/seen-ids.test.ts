import { describe, expect, it } from "vitest";
import { SeenIds } from "./seen-ids";

describe("SeenIds", () => {
  it("reports first sighting only", () => {
    const s = new SeenIds();
    expect(s.add("a")).toBe(true);
    expect(s.add("a")).toBe(false);
  });
  it("forgets the oldest beyond the limit and round-trips via toJSON", () => {
    const s = new SeenIds([], 2);
    s.add("a"); s.add("b"); s.add("c");
    expect(s.toJSON()).toEqual(["b", "c"]);
    expect(new SeenIds(s.toJSON()).add("b")).toBe(false);
  });
});
