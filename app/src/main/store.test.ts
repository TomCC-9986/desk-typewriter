import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaults, Store } from "./store";

const dir = () => mkdtempSync(join(tmpdir(), "desk-store-"));

describe("Store", () => {
  it("starts with defaults", () => {
    const s = new Store(dir());
    expect(s.data).toEqual({ ...defaults(), lan: { ...defaults().lan, id: expect.any(String) } });
  });

  it("persists updates", () => {
    const d = dir();
    new Store(d).update((x) => { x.draft = "草稿"; });
    expect(new Store(d).data.draft).toBe("草稿");
    expect(JSON.parse(readFileSync(join(d, "state.json"), "utf8")).draft).toBe("草稿");
  });

  it("fills in fields missing from older files", () => {
    const d = dir();
    writeFileSync(join(d, "state.json"), JSON.stringify({ draft: "x", settings: { volume: 0.2 } }));
    const s = new Store(d);
    expect(s.data.draft).toBe("x");
    expect(s.data.settings.volume).toBe(0.2);
    expect(s.data.settings.feedPosition).toBe("center");
    expect(s.data.stuck).toEqual([]);
  });

  it("survives a corrupt file", () => {
    const d = dir();
    writeFileSync(join(d, "state.json"), "{nope");
    expect(new Store(d).data).toEqual({ ...defaults(), lan: { ...defaults().lan, id: expect.any(String) } });
  });

  it("moves a corrupt file aside", () => {
    const d = dir();
    writeFileSync(join(d, "state.json"), "{nope");
    new Store(d);
    expect(readdirSync(d).some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
  });

  it("validates shapes", () => {
    const d = dir();
    writeFileSync(join(d, "state.json"), JSON.stringify({ friends: "x", seen: {}, identity: { userId: 1 }, draft: "k" }));
    const s = new Store(d);
    expect(s.data.friends).toEqual([]);
    expect(s.data.seen).toEqual([]);
    expect(s.data.identity).toBeNull();
    expect(s.data.draft).toBe("k");
    writeFileSync(join(d, "state.json"), "[1]");
    expect(new Store(d).data).toEqual({ ...defaults(), lan: { ...defaults().lan, id: expect.any(String) } });
    const id = { userId: "a", secret: "b", code: "c", nickname: "d" };
    writeFileSync(join(d, "state.json"), JSON.stringify({ identity: id }));
    expect(new Store(d).data.identity).toEqual(id);
  });

  it("update never throws when saving fails", () => {
    const d = dir();
    const s = new Store(d);
    (s as any).file = join(d, "no", "such", "dir", "state.json");
    (s as any).dir = join(d, "\0bad");
    expect(() => s.update((x) => { x.draft = "z"; })).not.toThrow();
  });
});

describe("lan state", () => {
  it("creates a LAN identity for old state files and drops malformed LAN friends", () => {
    const d = mkdtempSync(join(tmpdir(), "dt-"));
    writeFileSync(join(d, "state.json"), JSON.stringify({ draft: "x" }));
    const a = new Store(d);
    expect(typeof a.data.lan.id).toBe("string");
    expect(a.data.lan.friends).toEqual([]);
    writeFileSync(join(d, "state.json"), JSON.stringify({ lan: { id: "L1", friends: [{ id: "p", nickname: "n", sendToken: "s", recvToken: "r" }, { id: 3 }], outgoing: "bad" } }));
    const b = new Store(d);
    expect(b.data.lan.id).toBe("L1");
    expect(b.data.lan.friends).toHaveLength(1);
    expect(b.data.lan.outgoing).toEqual([]);
    expect(b.data.settings.lan).toBe(true);
  });
});
