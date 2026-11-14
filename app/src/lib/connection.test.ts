import { describe, expect, it, vi } from "vitest";
import { backoffMs, Connection, type SocketLike } from "./connection";

class FakeSock implements SocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

function setup(createFn?: () => FakeSock, extra: Record<string, unknown> = {}) {
  const socks: FakeSock[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const all: Array<{ fn: () => void; ms: number }> = [];
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const conn = new Connection({
    url: () => "ws://test",
    create: createFn ?? (() => { const s = new FakeSock(); socks.push(s); return s; }),
    connectTimeoutMs: 99999,
    ...extra,
    onMessage, onStatus,
    setTimer: (fn, ms) => { const t = { fn, ms }; all.push(t); if (ms !== 99999) timers.push(t); return all.length; },
    clearTimer: () => {},
  });
  return { conn, socks, timers, all, onMessage, onStatus };
}

describe("Connection", () => {
  it("backs off exponentially up to 30s", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(5)).toBe(30000);
  });

  it("only sends while open", () => {
    const { conn, socks, onStatus } = setup();
    conn.start();
    expect(conn.send({ type: "ack", id: "x" })).toBe(false);
    socks[0].onopen!();
    expect(onStatus).toHaveBeenLastCalledWith(true);
    expect(conn.send({ type: "ack", id: "x" })).toBe(true);
    expect(socks[0].sent).toEqual(['{"type":"ack","id":"x"}']);
  });

  it("parses messages", () => {
    const { conn, socks, onMessage } = setup();
    conn.start();
    socks[0].onmessage!({ data: '{"type":"error","reason":"r"}' });
    socks[0].onmessage!({ data: "not json" });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "error", reason: "r" });
  });

  it("reconnects with growing delays and resets after success", () => {
    const { conn, socks, timers, onStatus } = setup();
    conn.start();
    socks[0].onopen!();
    socks[0].onclose!();
    expect(onStatus).toHaveBeenLastCalledWith(false);
    expect(timers[0].ms).toBe(1000);
    timers[0].fn();
    socks[1].onclose!();
    expect(timers[1].ms).toBe(2000);
    timers[1].fn();
    socks[2].onopen!();
    socks[2].onclose!();
    expect(timers[2].ms).toBe(1000);
  });

  it("does not reconnect after stop", () => {
    const { conn, socks, timers } = setup();
    conn.start();
    socks[0].onopen!();
    conn.stop();
    expect(timers).toHaveLength(0);
  });

  it("schedules a retry when create throws", () => {
    const { conn, timers } = setup(() => { throw new Error("bad url"); });
    conn.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1000);
  });

  it("times out a connect that never opens and reconnects", () => {
    const { conn, socks, all } = setup(undefined, { connectTimeoutMs: undefined });
    conn.start();
    expect(all[0].ms).toBe(10000);
    all[0].fn();
    expect(all[1].ms).toBe(1000);
    all[1].fn();
    expect(socks).toHaveLength(2);
  });

  it("start is a no-op when already started", () => {
    const { conn, socks } = setup();
    conn.start();
    conn.start();
    expect(socks).toHaveLength(1);
  });

  it("ignores payloads without a string type", () => {
    const { conn, socks, onMessage } = setup();
    conn.start();
    for (const d of ["null", "5", '"x"', '{"type":3}', "{}"]) socks[0].onmessage!({ data: d });
    expect(onMessage).not.toHaveBeenCalled();
  });
});
