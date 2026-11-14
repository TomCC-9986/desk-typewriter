import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ble } from "./ble";
import type { LanMessage } from "./lan";

const live: Ble[] = [];
afterEach(() => { while (live.length) live.pop()!.stop(); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function node(id: string, nickname: string, verdict: (m: LanMessage) => { ok: boolean; reason?: string }) {
  const got: LanMessage[] = [];
  const b = new Ble({ me: () => ({ id, nickname }), onMessage: (m) => { got.push(m); return verdict(m); }, onPeers: () => {},
    helper: join(__dirname, "testdata", "fake-ble.cjs") });
  live.push(b);
  return { b, got };
}

describe("ble transport", () => {
  it("finds a peer by its LAN identity and carries a long note both ways with the receiver's verdict", async () => {
    process.env.FAKE_AIR = mkdtempSync(join(tmpdir(), "air-"));
    const A = node("LA", "甲", () => ({ ok: true }));
    const B = node("LB", "乙", (m) => (m.type === "note" && m.token !== "good" ? { ok: false, reason: "not_friends" } : { ok: true }));
    A.b.start(); B.b.start();
    for (let i = 0; i < 60 && !(A.b.peers.has("LB") && B.b.peers.has("LA")); i++) await wait(50);
    expect(A.b.peers.get("LB")?.nickname).toBe("乙");
    expect(A.b.state).toBe("on");
    const text = "长".repeat(500);
    expect(await A.b.send("LB", { type: "note", from: { id: "LA", nickname: "甲" }, token: "bad", id: "n1", text, sentAt: 1 })).toEqual({ ok: false, reason: "not_friends" });
    expect(await A.b.send("LB", { type: "note", from: { id: "LA", nickname: "甲" }, token: "good", id: "n2", text, sentAt: 1 })).toEqual({ ok: true });
    expect(B.got.at(-1)).toMatchObject({ type: "note", text });
    expect(await B.b.send("LA", { type: "request", from: { id: "LB", nickname: "乙" }, token: "t" })).toEqual({ ok: true });
    expect(await A.b.send("nobody", { type: "request", from: { id: "LA", nickname: "甲" }, token: "t" })).toEqual({ ok: false, reason: "not_nearby" });
  }, 10000);

  it("ignores its own advertisement and malformed helper output", () => {
    const { b } = node("ME", "我", () => ({ ok: true }));
    b.onLine("not json");
    b.onLine(JSON.stringify({ ev: "peer", peer: "dev1", info: JSON.stringify({ id: "ME", nickname: "我" }) }));
    b.onLine(JSON.stringify({ ev: "peer", peer: "dev2", info: "{oops" }));
    expect(b.peers.size).toBe(0);
  });
});
