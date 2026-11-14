import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MAX_TEXT } from "../../shared/protocol";
import { befriend, connect, eventually, inboxStub, register, waitOffline } from "./helpers";

const note = (id: string, to: string, text = "哥们吃饭了吗") => ({ type: "note" as const, id, to, text, sentAt: 1_700_000_000_000 });

describe("notes", () => {
  it("delivers to an online friend", async () => {
    const { a, b, ca, cb } = await befriend();
    ca.send(note("n1", b.userId));
    expect(await cb.next("note")).toEqual({ type: "note", id: "n1", from: a.userId, fromName: "小王", text: "哥们吃饭了吗", sentAt: 1_700_000_000_000 });
    expect(await ca.next("status")).toEqual({ type: "status", id: "n1", state: "delivered" });
  });

  it("queues for an offline friend and delivers on reconnect until acked", async () => {
    const { b, ca, cb } = await befriend();
    cb.close();
    await waitOffline(b.userId);
    ca.send(note("n2", b.userId));
    expect(await ca.next("status")).toEqual({ type: "status", id: "n2", state: "queued" });

    const cb2 = await connect(b);
    await cb2.next("hello");
    expect((await cb2.next("note")).id).toBe("n2");
    cb2.close();
    await waitOffline(b.userId);

    const cb3 = await connect(b); // not acked yet → redelivered
    await cb3.next("hello");
    expect((await cb3.next("note")).id).toBe("n2");
    cb3.send({ type: "ack", id: "n2" });
    await eventually(() =>
      runInDurableObject(inboxStub(b.userId), async (_i, s) => (await s.storage.get("q:n2")) === undefined),
    );
  });

  it("rejects notes to non-friends", async () => {
    const a = await register("小王");
    const b = await register("阿杰");
    const ca = await connect(a);
    await ca.next("hello");
    ca.send(note("n3", b.userId));
    expect(await ca.next("status")).toEqual({ type: "status", id: "n3", state: "rejected", reason: "not_friend" });
  });

  it("rejects empty and too-long notes", async () => {
    const { b, ca } = await befriend();
    ca.send(note("e1", b.userId, "   "));
    expect(await ca.next("status")).toMatchObject({ id: "e1", state: "rejected", reason: "empty" });
    ca.send(note("e2", b.userId, "字".repeat(MAX_TEXT + 1)));
    expect(await ca.next("status")).toMatchObject({ id: "e2", state: "rejected", reason: "too_long" });
    ca.send(note("e3", b.userId, "字".repeat(MAX_TEXT)));
    expect(await ca.next("status")).toMatchObject({ id: "e3", state: "delivered" });
  });

  it("rate limits to 10 notes per minute per sender", async () => {
    const { b, ca } = await befriend();
    for (let i = 0; i < 10; i++) {
      ca.send(note(`r${i}`, b.userId));
      expect(await ca.next("status")).toMatchObject({ id: `r${i}`, state: "delivered" });
    }
    ca.send(note("r10", b.userId));
    expect(await ca.next("status")).toMatchObject({ id: "r10", state: "rejected", reason: "rate_limited" });
  });

  it("drops queued notes older than 7 days", async () => {
    const u = await register("小王");
    await runInDurableObject(inboxStub(u.userId), async (_i, s) => {
      await s.storage.put("q:old", {
        note: { id: "old", from: "x", fromName: "x", text: "过期了", sentAt: 0 },
        queuedAt: Date.now() - 8 * 24 * 3600 * 1000,
      });
    });
    const c = await connect(u);
    await c.next("hello");
    const got = await c.drain(200);
    expect(got.filter((m) => m.type === "note")).toEqual([]);
    expect(await runInDurableObject(inboxStub(u.userId), (_i, s) => s.storage.get("q:old"))).toBeUndefined();
  });
});

const raw = (c: { send: (m: never) => void }, m: unknown) => c.send(m as never);

describe("notes hardening", () => {
  it("does not deliver queued notes from a removed friend", async () => {
    const { a, b, ca, cb } = await befriend();
    cb.close();
    await waitOffline(b.userId);
    ca.send(note("rm1", b.userId));
    await ca.next("status");
    ca.send({ type: "remove_friend", userId: b.userId });
    await ca.next("friend_removed");
    const cb2 = await connect(b);
    await cb2.next("hello");
    expect((await cb2.drain(200)).filter((m) => m.type === "note")).toEqual([]);
    expect(await runInDurableObject(inboxStub(b.userId), (_i, s) => s.storage.get("q:rm1"))).toBeUndefined();
    void a;
  });

  it("flush skips and deletes entries whose sender is no longer a friend", async () => {
    const u = await register("小王");
    await runInDurableObject(inboxStub(u.userId), async (_i, s) => {
      await s.storage.put("q:ghost", { note: { id: "ghost", from: "x", fromName: "x", text: "hi", sentAt: 1 }, queuedAt: Date.now() });
    });
    const c = await connect(u);
    await c.next("hello");
    expect((await c.drain(200)).filter((m) => m.type === "note")).toEqual([]);
    expect(await runInDurableObject(inboxStub(u.userId), (_i, s) => s.storage.get("q:ghost"))).toBeUndefined();
  });

  it("rejects bad ids and id collisions across senders", async () => {
    const { a, b, ca, cb } = await befriend();
    const c = await register("小李");
    const cc = await connect(c);
    await cc.next("hello");
    cc.send({ type: "friend_request", code: b.code });
    await cc.next("request_sent");
    await cb.next("friend_request");
    cb.send({ type: "friend_response", from: c.userId, accepted: true });
    await cb.next("friend_added");
    await cc.next("friend_added");

    cb.close();
    await waitOffline(b.userId);
    ca.send(note("same", b.userId));
    expect(await ca.next("status")).toMatchObject({ state: "queued" });
    cc.send(note("same", b.userId));
    expect(await cc.next("status")).toEqual({ type: "status", id: "same", state: "rejected", reason: "bad_id" });
    ca.send(note("no spaces!", b.userId));
    expect(await ca.next("status")).toMatchObject({ state: "rejected", reason: "bad_id" });
    void a;
  });

  it("rejects non-finite sentAt and malformed messages", async () => {
    const { b, ca } = await befriend();
    raw(ca, { type: "note", id: "s1", to: b.userId, text: "hi", sentAt: null });
    expect(await ca.next("status")).toEqual({ type: "status", id: "s1", state: "rejected", reason: "bad_message" });
    raw(ca, { type: "friend_response", from: b.userId, accepted: "yes" });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "bad_message" });
    raw(ca, null);
    expect(await ca.next("error")).toEqual({ type: "error", reason: "bad_message" });
    raw(ca, { type: "remove_friend", userId: "constructor" });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "bad_message" });
    raw(ca, { type: "note", id: "s2", to: "__proto__", text: "hi", sentAt: 1 });
    expect(await ca.next("status")).toMatchObject({ id: "s2", state: "rejected", reason: "bad_message" });
  });

  it("flushes by server queue time, not client sentAt", async () => {
    const u = await register("小王");
    const mk = (id: string, sentAt: number, queuedAt: number) => ({ note: { id, from: "x", fromName: "x", text: id, sentAt }, queuedAt });
    const t = Date.now();
    await runInDurableObject(inboxStub(u.userId), async (_i, s) => {
      await s.storage.put("friends", { x: "x" });
      await s.storage.put("q:late", mk("late", 1, t - 1000));
      await s.storage.put("q:early", mk("early", 9e12, t - 5000));
    });
    const c = await connect(u);
    await c.next("hello");
    expect((await c.next("note")).id).toBe("early");
    expect((await c.next("note")).id).toBe("late");
  });

  it("caps the queue at 300 and prunes expired entries first", async () => {
    const { a, b, ca, cb } = await befriend();
    cb.close();
    await waitOffline(b.userId);
    const fill = (queuedAt: number) => runInDurableObject(inboxStub(b.userId), async (_i, s) => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < 300; i++) o[`q:f${i}`] = { note: { id: `f${i}`, from: a.userId, fromName: "x", text: "x", sentAt: 1 }, queuedAt };
      await s.storage.put(o);
    });
    await fill(Date.now());
    ca.send(note("over", b.userId));
    expect(await ca.next("status")).toEqual({ type: "status", id: "over", state: "rejected", reason: "inbox_full" });
    await fill(Date.now() - 8 * 24 * 3600 * 1000);
    ca.send(note("fits", b.userId));
    expect(await ca.next("status")).toMatchObject({ id: "fits", state: "queued" });
  });
});

describe("notes and blocking", () => {
  it("a blocked sender sees delivered but the recipient gets nothing; unblock restores delivery", async () => {
    const { a, b, ca, cb } = await befriend();
    cb.send({ type: "block", userId: a.userId });
    await cb.next("friend_blocked");

    ca.send(note("bk1", b.userId));
    expect(await ca.next("status")).toEqual({ type: "status", id: "bk1", state: "delivered" });
    expect((await cb.drain(200)).filter((m) => m.type === "note")).toEqual([]);
    expect(await runInDurableObject(inboxStub(b.userId), (_i, s) => s.storage.get("q:bk1"))).toBeUndefined();

    cb.send({ type: "unblock", userId: a.userId });
    await cb.next("friend_unblocked");
    ca.send(note("bk2", b.userId));
    expect((await cb.next("note")).id).toBe("bk2");
  });

  it("the blocker cannot send to someone they blocked", async () => {
    const { a, b, cb } = await befriend();
    cb.send({ type: "block", userId: a.userId });
    await cb.next("friend_blocked");
    cb.send(note("bk3", a.userId));
    expect(await cb.next("status")).toEqual({ type: "status", id: "bk3", state: "rejected", reason: "blocked" });
    expect(b.userId).toBeTruthy();
  });
});
