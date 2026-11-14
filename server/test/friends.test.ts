import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { befriend, connect, eventually, inboxStub, register } from "./helpers";

describe("friends", () => {
  it("pairs two users only after acceptance", async () => {
    const a = await register("小王");
    const b = await register("阿杰");
    const ca = await connect(a);
    const cb = await connect(b);
    await ca.next("hello");
    await cb.next("hello");

    ca.send({ type: "friend_request", code: b.code.toLowerCase().replace("-", " ") });
    expect(await ca.next("request_sent")).toEqual({ type: "request_sent", code: b.code });
    expect(await cb.next("friend_request")).toEqual({ type: "friend_request", from: a.userId, nickname: "小王" });

    cb.send({ type: "friend_response", from: a.userId, accepted: true });
    expect(await cb.next("friend_added")).toEqual({ type: "friend_added", userId: a.userId, nickname: "小王" });
    expect(await ca.next("friend_added")).toEqual({ type: "friend_added", userId: b.userId, nickname: "阿杰", code: b.code });
  });

  it("keeps requests for offline users and shows them in hello", async () => {
    const a = await register("小王");
    const b = await register("阿杰");
    const ca = await connect(a);
    await ca.next("hello");
    ca.send({ type: "friend_request", code: b.code });
    await ca.next("request_sent");

    const cb = await connect(b);
    const hello = await cb.next("hello");
    expect(hello.pending).toEqual([{ userId: a.userId, nickname: "小王" }]);
  });

  it("rejects bad, unknown and own codes", async () => {
    const a = await register("小王");
    const ca = await connect(a);
    await ca.next("hello");
    ca.send({ type: "friend_request", code: "nope" });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "bad_code" });
    ca.send({ type: "friend_request", code: "ZZZ-ZZZ" });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "code_not_found" });
    ca.send({ type: "friend_request", code: a.code });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "self" });
  });

  it("declining does not create a friendship", async () => {
    const a = await register("小王");
    const b = await register("阿杰");
    const ca = await connect(a);
    const cb = await connect(b);
    await ca.next("hello");
    await cb.next("hello");
    ca.send({ type: "friend_request", code: b.code });
    await cb.next("friend_request");
    cb.send({ type: "friend_response", from: a.userId, accepted: false });
    const got = await ca.drain(200);
    expect(got.filter((m) => m.type === "friend_added")).toEqual([]);
    await eventually(() =>
      runInDurableObject(inboxStub(b.userId), async (_i, s) => !(await s.storage.get<Record<string, string>>("pending"))?.[a.userId]),
    );
  });

  it("removing a friend notifies both sides", async () => {
    const { a, b, ca, cb } = await befriend();
    ca.send({ type: "remove_friend", userId: b.userId });
    expect(await ca.next("friend_removed")).toEqual({ type: "friend_removed", userId: b.userId });
    expect(await cb.next("friend_removed")).toEqual({ type: "friend_removed", userId: a.userId });
  });

  it("blocking is one-way: the other side is not told and keeps the friendship", async () => {
    const { a, b, ca, cb } = await befriend();
    cb.send({ type: "block", userId: a.userId });
    expect(await cb.next("friend_blocked")).toEqual({ type: "friend_blocked", userId: a.userId, nickname: "小王" });
    expect(await ca.drain(200)).toEqual([]);
    expect(await runInDurableObject(inboxStub(a.userId), (_i, s) => s.storage.get<Record<string, string>>("friends")))
      .toHaveProperty(b.userId);
    // reconnecting: blocked user is not in the blocker's friends, but listed in blocked; other side unchanged
    cb.close();
    const cb2 = await connect(b);
    const hb = await cb2.next("hello");
    expect(hb.friends).toEqual([]);
    expect(hb.blocked).toEqual([{ userId: a.userId, nickname: "小王" }]);
    const ca2 = await connect(a);
    expect((await ca2.next("hello")).friends).toEqual([{ userId: b.userId, nickname: "阿杰" }]);
  });

  it("unblock restores the friend on the blocker's side", async () => {
    const { a, b, cb } = await befriend();
    cb.send({ type: "block", userId: a.userId });
    await cb.next("friend_blocked");
    cb.send({ type: "unblock", userId: a.userId });
    expect(await cb.next("friend_unblocked")).toEqual({ type: "friend_unblocked", userId: a.userId, nickname: "小王" });
    expect(await cb.next("friend_added")).toMatchObject({ userId: a.userId });
    expect(await runInDurableObject(inboxStub(b.userId), (_i, s) => s.storage.get("blocked"))).toEqual([]);
  });

  it("blocking silently drops future requests", async () => {
    const { a, b, ca, cb } = await befriend();
    cb.send({ type: "block", userId: a.userId });
    await cb.next("friend_blocked");
    cb.send({ type: "remove_friend", userId: a.userId });
    await cb.next("friend_removed");
    await ca.next("friend_removed");
    ca.send({ type: "friend_request", code: b.code });
    await ca.next("request_sent");
    const got = await cb.drain(200);
    expect(got.filter((m) => m.type === "friend_request")).toEqual([]);
  });
});

describe("friends hardening", () => {
  it("addFriend refuses blocked users and does not add them", async () => {
    const a = await register("小王");
    const b = await register("阿杰");
    await runInDurableObject(inboxStub(a.userId), async (_i, s) => { await s.storage.put("blocked", [b.userId]); });
    const ok = await inboxStub(a.userId).addFriend({ userId: b.userId, nickname: "阿杰" });
    expect(ok).toBe(false);
    expect(await runInDurableObject(inboxStub(a.userId), (_i, s) => s.storage.get("friends"))).toBeUndefined();
  });

  it("rate limits friend requests to 5 per minute", async () => {
    const a = await register("小王");
    const ca = await connect(a);
    await ca.next("hello");
    for (let i = 0; i < 5; i++) {
      ca.send({ type: "friend_request", code: "nope" });
      expect(await ca.next("error")).toEqual({ type: "error", reason: "bad_code" });
    }
    ca.send({ type: "friend_request", code: "nope" });
    expect(await ca.next("error")).toEqual({ type: "error", reason: "rate_limited" });
  });
});
