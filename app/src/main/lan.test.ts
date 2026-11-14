import { afterEach, describe, expect, it } from "vitest";
import { broadcastAddresses, isLanMessage, Lan, type LanMessage } from "./lan";

const live: Lan[] = [];
afterEach(() => { while (live.length) live.pop()!.stop(); });

function node(id: string, nickname: string, udpPort: number, onMessage: (m: LanMessage) => { ok: boolean; reason?: string } = () => ({ ok: true })) {
  const got: LanMessage[] = [];
  const lan = new Lan({ me: () => ({ id, nickname }), onMessage: (m) => { got.push(m); return onMessage(m); }, onPeers: () => {}, udpPort });
  live.push(lan);
  return { lan, got };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lan", () => {
  it("validates messages", () => {
    expect(isLanMessage({ type: "note", from: { id: "a", nickname: "A" }, token: "t", id: "n", text: "hi", sentAt: 1 })).toBe(true);
    expect(isLanMessage({ type: "note", from: { id: "a", nickname: "A" }, token: "t", id: "n", text: 5, sentAt: 1 })).toBe(false);
    expect(isLanMessage({ type: "request", from: { id: "a" }, token: "t" })).toBe(false);
    expect(isLanMessage({ type: "hack", from: { id: "a", nickname: "A" }, token: "t" })).toBe(false);
    expect(broadcastAddresses()).toContain("255.255.255.255");
  });

  it("delivers a message over HTTP and reports the receiver's verdict", async () => {
    const tokens = { b: "secret-b" };
    const a = node("A", "甲", 47301);
    const b = node("B", "乙", 47302, (m) => (m.type !== "note" || m.token === tokens.b ? { ok: true } : { ok: false, reason: "not_friends" }));
    await a.lan.start(); await b.lan.start();
    a.lan.addPeer({ id: "B", nickname: "乙", addr: "127.0.0.1", port: b.lan.httpPort, seen: Date.now() });
    expect(await a.lan.send("B", { type: "request", from: { id: "A", nickname: "甲" }, token: "secret-a" })).toEqual({ ok: true });
    expect(b.got[0]).toMatchObject({ type: "request", token: "secret-a" });
    expect(await a.lan.send("B", { type: "note", from: { id: "A", nickname: "甲" }, token: "wrong", id: "n1", text: "你好", sentAt: 1 })).toEqual({ ok: false, reason: "not_friends" });
    expect(await a.lan.send("B", { type: "note", from: { id: "A", nickname: "甲" }, token: "secret-b", id: "n2", text: "你好", sentAt: 1 })).toEqual({ ok: true });
    expect(await a.lan.send("C", { type: "request", from: { id: "A", nickname: "甲" }, token: "x" })).toEqual({ ok: false, reason: "not_nearby" });
  });

  it("finds a nearby machine by broadcast", async () => {
    const a = node("A", "甲", 47310);
    const b = node("B", "乙", 47310);
    await a.lan.start(); await b.lan.start();
    for (let i = 0; i < 40 && !(a.lan.peers.has("B") && b.lan.peers.has("A")); i++) await wait(100);
    expect(a.lan.peers.get("B")?.nickname).toBe("乙");
    expect(b.lan.peers.get("A")?.port).toBe(a.lan.httpPort);
  }, 8000);
});
