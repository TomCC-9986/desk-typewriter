import { DurableObject } from "cloudflare:workers";
import type { ClientMsg, Friend, Note, NoteState, ServerMsg } from "../../shared/protocol";
import { MAX_TEXT, QUEUE_TTL_MS, RATE_PER_MIN, textLength } from "../../shared/protocol";
import { normalizeCode } from "../../shared/code";
import { NOTE_ID_RE, parseClientMsg } from "./messages";
import type { Env } from "./index";

export interface RecvResult { state: NoteState; reason?: string }
interface QueueItem { note: Note; queuedAt: number }
const MAX_QUEUE = 300;
const has = (m: FriendMap, k: string) => Object.hasOwn(m, k);

export type FriendMap = Record<string, string>; // userId -> nickname

export const toList = (m: FriendMap): Friend[] =>
  Object.entries(m).map(([userId, nickname]) => ({ userId, nickname }));

export class Inbox extends DurableObject<Env> {
  async init(me: Friend, code: string): Promise<void> {
    await this.ctx.storage.put({ me, code });
  }

  protected async me(): Promise<Friend> {
    return (await this.ctx.storage.get<Friend>("me"))!;
  }
  protected async friends(): Promise<FriendMap> {
    return (await this.ctx.storage.get<FriendMap>("friends")) ?? {};
  }
  protected async pending(): Promise<FriendMap> {
    return (await this.ctx.storage.get<FriendMap>("pending")) ?? {};
  }
  protected async blockedIds(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("blocked")) ?? [];
  }
  protected async blockedList(): Promise<Friend[]> {
    const names = (await this.ctx.storage.get<FriendMap>("blockedNames")) ?? {};
    const friends = await this.friends();
    return (await this.blockedIds()).map((userId) => ({
      userId, nickname: (has(names, userId) ? names[userId] : has(friends, userId) ? friends[userId] : "") ,
    }));
  }
  protected reply(ws: WebSocket, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }
  protected broadcast(msg: ServerMsg): void {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch { /* socket closing */ }
    }
  }
  protected online(): boolean {
    return this.ctx.getWebSockets().some((ws) => ws.readyState === 1);
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const blocked = await this.blockedIds();
    this.reply(server, {
      type: "hello",
      me: await this.me(),
      code: (await this.ctx.storage.get<string>("code")) ?? "",
      friends: toList(await this.friends()).filter((f) => !blocked.includes(f.userId)),
      pending: toList(await this.pending()),
      blocked: await this.blockedList(),
    });
    await this.flush(server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return this.reply(ws, { type: "error", reason: "bad_json" });
    }
    try {
      const msg = parseClientMsg(raw);
      if (!msg) {
        const r = raw as { type?: unknown; id?: unknown } | null;
        if (r && typeof r === "object" && r.type === "note" && typeof r.id === "string") {
          return this.reply(ws, { type: "status", id: r.id, state: "rejected", reason: "bad_message" });
        }
        return this.reply(ws, { type: "error", reason: "bad_message" });
      }
      switch (msg.type) {
        case "friend_request": return await this.requestFriend(ws, msg.code);
        case "friend_response": return await this.respondFriend(ws, msg.from, msg.accepted);
        case "remove_friend": return await this.removeFriend(msg.userId);
        case "block": return await this.block(msg.userId);
        case "unblock": return await this.unblock(msg.userId);
        case "note": return await this.sendNote(ws, msg);
        case "ack": await this.ctx.storage.delete(`q:${msg.id}`); return;
      }
    } catch (e) {
      console.error("inbox message failed", e);
      try { this.reply(ws, { type: "error", reason: "bad_message" }); } catch { /* socket closed */ }
    }
  }

  /** Timestamps of this user's recent sends. In memory: resets if the DO hibernates (acceptable for v1). */
  private sent: number[] = [];
  private requests: number[] = [];

  private rateLimited(list: number[], max: number): boolean {
    const now = Date.now();
    const recent = list.filter((t) => now - t < 60_000);
    list.length = 0;
    list.push(...recent);
    if (list.length >= max) return true;
    list.push(now);
    return false;
  }

  private async sendNote(ws: WebSocket, msg: Extract<ClientMsg, { type: "note" }>): Promise<void> {
    const reject = (reason: string) => this.reply(ws, { type: "status", id: msg.id, state: "rejected", reason });
    if (!NOTE_ID_RE.test(msg.id)) return reject("bad_id");
    if (!msg.text.trim()) return reject("empty");
    if (textLength(msg.text) > MAX_TEXT) return reject("too_long");
    if ((await this.blockedIds()).includes(msg.to)) return reject("blocked");
    if (!has(await this.friends(), msg.to)) return reject("not_friend");
    if (this.rateLimited(this.sent, RATE_PER_MIN)) return reject("rate_limited");

    const me = await this.me();
    let res: RecvResult;
    try {
      res = await this.env.INBOX.get(this.env.INBOX.idFromName(msg.to)).receiveNote({
        id: msg.id, from: me.userId, fromName: me.nickname, text: msg.text, sentAt: msg.sentAt,
      });
    } catch (e) {
      console.error("receiveNote rpc failed", e);
      return reject("server_error");
    }
    this.reply(ws, res.state === "rejected"
      ? { type: "status", id: msg.id, state: "rejected", reason: res.reason ?? "not_friend" }
      : { type: "status", id: msg.id, state: res.state });
  }

  async receiveNote(note: Note): Promise<RecvResult> {
    if ((await this.blockedIds()).includes(note.from)) return { state: "delivered" }; // silent: the sender can't tell
    if (!has(await this.friends(), note.from)) return { state: "rejected", reason: "not_friend" };
    const key = `q:${note.id}`;
    const existing = await this.ctx.storage.get<QueueItem>(key);
    if (existing && existing.note.from !== note.from) return { state: "rejected", reason: "bad_id" };
    if (!existing) {
      let count = (await this.ctx.storage.list({ prefix: "q:" })).size;
      if (count >= MAX_QUEUE) {
        await this.pruneExpired();
        count = (await this.ctx.storage.list({ prefix: "q:" })).size;
        if (count >= MAX_QUEUE) return { state: "rejected", reason: "inbox_full" };
      }
    }
    await this.ctx.storage.put(key, { note, queuedAt: Date.now() } satisfies QueueItem);
    if (!this.online()) return { state: "queued" };
    this.broadcast({ type: "note", ...note });
    return { state: "delivered" };
  }

  private async pruneExpired(): Promise<void> {
    const cutoff = Date.now() - QUEUE_TTL_MS;
    for (const [key, item] of await this.ctx.storage.list<QueueItem>({ prefix: "q:" })) {
      if (item.queuedAt < cutoff) await this.ctx.storage.delete(key);
    }
  }

  private async flush(ws: WebSocket): Promise<void> {
    const items = await this.ctx.storage.list<QueueItem>({ prefix: "q:" });
    const friends = await this.friends();
    const blocked = await this.blockedIds();
    const cutoff = Date.now() - QUEUE_TTL_MS;
    const live: QueueItem[] = [];
    for (const [key, item] of items) {
      if (item.queuedAt < cutoff || !has(friends, item.note.from) || blocked.includes(item.note.from)) await this.ctx.storage.delete(key);
      else live.push(item);
    }
    live.sort((x, y) => x.queuedAt - y.queuedAt || x.note.sentAt - y.note.sentAt);
    for (const { note } of live) this.reply(ws, { type: "note", ...note });
  }

  private async requestFriend(ws: WebSocket, rawCode: string): Promise<void> {
    if (this.rateLimited(this.requests, 5)) return this.reply(ws, { type: "error", reason: "rate_limited" });
    const code = normalizeCode(rawCode);
    if (!code) return this.reply(ws, { type: "error", reason: "bad_code" });
    const target = await this.env.USERS.get(`code:${code}`);
    if (!target) return this.reply(ws, { type: "error", reason: "code_not_found" });
    const me = await this.me();
    if (target === me.userId) return this.reply(ws, { type: "error", reason: "self" });
    if (has(await this.friends(), target)) return this.reply(ws, { type: "error", reason: "already_friends" });
    try {
      await this.env.INBOX.get(this.env.INBOX.idFromName(target)).receiveFriendRequest(me);
    } catch (e) {
      console.error("receiveFriendRequest rpc failed", e);
      return this.reply(ws, { type: "error", reason: "server_error" });
    }
    this.reply(ws, { type: "request_sent", code });
  }

  async receiveFriendRequest(from: Friend): Promise<void> {
    const blocked = (await this.ctx.storage.get<string[]>("blocked")) ?? [];
    if (blocked.includes(from.userId)) return; // silent: the sender can't tell
    const pending = await this.pending();
    pending[from.userId] = from.nickname;
    await this.ctx.storage.put("pending", pending);
    this.broadcast({ type: "friend_request", from: from.userId, nickname: from.nickname });
  }

  private async respondFriend(ws: WebSocket, fromId: string, accepted: boolean): Promise<void> {
    const pending = await this.pending();
    if (!has(pending, fromId)) return;
    const nickname = pending[fromId];
    delete pending[fromId];
    await this.ctx.storage.put("pending", pending);
    if (!accepted) return;
    let ok: boolean;
    try {
      const me = await this.me();
      ok = await this.env.INBOX.get(this.env.INBOX.idFromName(fromId)).addFriend(me, (await this.ctx.storage.get<string>("code")) ?? undefined);
    } catch (e) {
      console.error("peer addFriend rpc failed", e);
      const again = await this.pending();
      again[fromId] = nickname;
      await this.ctx.storage.put("pending", again);
      return this.reply(ws, { type: "error", reason: "server_error" });
    }
    if (!ok) return; // the requester blocked us in the meantime
    await this.addFriend({ userId: fromId, nickname });
  }

  /** Returns false (and does nothing) if this inbox has blocked the user. */
  async addFriend(f: Friend, code?: string): Promise<boolean> {
    const blocked = (await this.ctx.storage.get<string[]>("blocked")) ?? [];
    if (blocked.includes(f.userId)) return false;
    const pending = await this.pending();
    if (has(pending, f.userId)) {
      delete pending[f.userId];
      await this.ctx.storage.put("pending", pending);
    }
    const friends = await this.friends();
    friends[f.userId] = f.nickname;
    await this.ctx.storage.put("friends", friends);
    this.broadcast(code
      ? { type: "friend_added", userId: f.userId, nickname: f.nickname, code }
      : { type: "friend_added", userId: f.userId, nickname: f.nickname });
    return true;
  }

  private async removeFriend(userId: string): Promise<void> {
    await this.dropFriend(userId);
    try {
      await this.env.INBOX.get(this.env.INBOX.idFromName(userId)).dropFriend((await this.me()).userId);
    } catch (e) {
      console.error("peer dropFriend rpc failed", e);
    }
  }

  async dropFriend(userId: string): Promise<void> {
    for (const [key, item] of await this.ctx.storage.list<QueueItem>({ prefix: "q:" })) {
      if (item.note.from === userId) await this.ctx.storage.delete(key);
    }
    const friends = await this.friends();
    if (!has(friends, userId)) return;
    delete friends[userId];
    await this.ctx.storage.put("friends", friends);
    this.broadcast({ type: "friend_removed", userId });
  }

  /** One-way and silent: only this inbox changes; the other side keeps its friendship record and is not told. */
  private async block(userId: string): Promise<void> {
    const me = await this.me();
    if (userId === me.userId) return;
    const blocked = await this.blockedIds();
    const friends = await this.friends();
    const pending = await this.pending();
    const names = (await this.ctx.storage.get<FriendMap>("blockedNames")) ?? {};
    const nickname = has(friends, userId) ? friends[userId] : has(pending, userId) ? pending[userId] : has(names, userId) ? names[userId] : "";
    if (!blocked.includes(userId)) blocked.push(userId);
    names[userId] = nickname;
    await this.ctx.storage.put({ blocked, blockedNames: names });
    if (has(pending, userId)) {
      delete pending[userId];
      await this.ctx.storage.put("pending", pending);
    }
    for (const [key, item] of await this.ctx.storage.list<QueueItem>({ prefix: "q:" })) {
      if (item.note.from === userId) await this.ctx.storage.delete(key);
    }
    this.broadcast({ type: "friend_blocked", userId, nickname });
  }

  private async unblock(userId: string): Promise<void> {
    const blocked = await this.blockedIds();
    if (!blocked.includes(userId)) return;
    const names = (await this.ctx.storage.get<FriendMap>("blockedNames")) ?? {};
    const friends = await this.friends();
    const nickname = has(names, userId) ? names[userId] : has(friends, userId) ? friends[userId] : "";
    delete names[userId];
    await this.ctx.storage.put({ blocked: blocked.filter((b) => b !== userId), blockedNames: names });
    this.broadcast({ type: "friend_unblocked", userId, nickname });
    // the friendship record was kept, so it comes back to the list
    if (has(friends, userId)) this.broadcast({ type: "friend_added", userId, nickname: friends[userId] });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, "error"); } catch { /* already closed */ }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code, "bye"); } catch { /* already closed */ }
  }
}
