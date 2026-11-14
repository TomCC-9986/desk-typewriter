import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { connect, register } from "./helpers";

describe("register + auth", () => {
  it("creates an identity with a pairing code", async () => {
    const u = await register("小王");
    expect(u.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(u.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(u.nickname).toBe("小王");
  });

  it("requires a nickname and trims it to 16 chars", async () => {
    const bad = await SELF.fetch("http://x/register", { method: "POST", body: JSON.stringify({ nickname: "  " }) });
    expect(bad.status).toBe(400);
    const long = await register("一二三四五六七八九十一二三四五六七八");
    expect([...long.nickname].length).toBeLessThanOrEqual(16);
  });

  it("rejects bad secrets and non-upgrade requests", async () => {
    const u = await register("阿杰");
    const bad = await SELF.fetch(`http://x/ws?uid=${u.userId}&secret=nope`, { headers: { Upgrade: "websocket" } });
    expect(bad.status).toBe(401);
    const plain = await SELF.fetch(`http://x/ws?uid=${u.userId}&secret=${u.secret}`);
    expect(plain.status).toBe(426);
  });

  it("greets a connected client with hello", async () => {
    const u = await register("小李");
    const c = await connect(u);
    expect(await c.next("hello")).toEqual({
      type: "hello",
      me: { userId: u.userId, nickname: "小李" },
      code: u.code,
      friends: [],
      pending: [],
      blocked: [],
    });
    c.close();
  });

  it("limits registrations per IP per hour", async () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 250)}`;
    const reg = () => SELF.fetch("http://x/register", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify({ nickname: "批量" }) });
    for (let i = 0; i < 5; i++) expect((await reg()).status).toBe(200);
    const blocked = await reg();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
  });

  it("answers /health", async () => {
    expect(await (await SELF.fetch("http://x/health")).text()).toBe("ok");
  });
});
