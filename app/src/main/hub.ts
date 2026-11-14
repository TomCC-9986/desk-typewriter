import { app, screen } from "electron";
import { hostname } from "node:os";
import { Lan, type LanMe, type LanMessage, type LanReply } from "./lan";
import { Ble, bleHelperPath } from "./ble";
import { normalizeCode } from "@shared/code";
import type { Note, ServerMsg } from "@shared/protocol";
import { Connection } from "../lib/connection";
import { SeenIds } from "../lib/seen-ids";
import { trashTarget, type Point } from "../lib/trash-target";
import type { AppView, SendResult, TypewriterInit } from "../shared/ipc-types";
import type { Settings, Store } from "./store";
import { readDockInfo, trashNoteFile } from "./trash";
import type { Windows } from "./windows";

export const AUTOTRASH_MS = Number(process.env.DESK_AUTOTRASH_MS) || 30 * 60_000;

type FriendResult = { ok: boolean; reason?: string };

export class Hub {
  online = false;
  onTray: (() => void) | null = null;
  private conn: Connection;
  private seen: SeenIds;
  private shownRequests = new Set<string>();
  private statusWaiters = new Map<string, (r: SendResult) => void>();
  private friendWaiter: ((r: FriendResult) => void) | null = null;
  private lan: Lan;
  private ble: Ble;

  constructor(private store: Store, private win: Windows) {
    this.seen = new SeenIds(store.data.seen);
    this.conn = new Connection({
      url: () => this.wsUrl(),
      onMessage: (m) => this.onServer(m),
      onStatus: (v) => { this.online = v; this.changed(); },
    });
    this.lan = new Lan({ me: () => this.lanMe(), onMessage: (m) => this.onLan(m), onPeers: () => this.changed() });
    this.ble = new Ble({ me: () => this.lanMe(), onMessage: (m) => this.onLan(m), onPeers: () => this.changed(),
      helper: bleHelperPath(process.resourcesPath, app.getAppPath(), app.isPackaged) });
  }

  start(): void {
    this.conn.start();
    if (this.store.data.settings.lan) void this.lan.start().catch((e) => console.warn("lan start", e));
    if (this.store.data.settings.bluetooth) this.ble.start();
    for (const r of this.store.data.lan.incoming) this.showRequest(`lan:${r.id}`, `${r.nickname}（附近）`);
  }
  stop(): void { this.lan.stop(); this.ble.stop(); }

  /** Nearby machines from both transports, keyed by LAN identity (Wi-Fi preferred: faster, longer range). */
  private nearbyPeers(): { id: string; nickname: string; via: "wifi" | "bt" }[] {
    const out = new Map<string, { id: string; nickname: string; via: "wifi" | "bt" }>();
    for (const p of this.ble.peers.values()) out.set(p.id, { id: p.id, nickname: p.nickname, via: "bt" });
    for (const p of this.lan.peers.values()) out.set(p.id, { id: p.id, nickname: p.nickname, via: "wifi" });
    return [...out.values()];
  }
  private async sendNearby(id: string, m: LanMessage): Promise<LanReply> {
    if (this.lan.peers.has(id)) {
      const r = await this.lan.send(id, m);
      if (r.ok || r.reason !== "not_nearby" || !this.ble.peers.has(id)) return r;
    }
    return this.ble.send(id, m);
  }
  reconnect(): void { this.conn.restart(); }

  private changed(): void {
    this.win.broadcast("state:changed");
    this.onTray?.();
  }

  private wsUrl(): string | null {
    const id = this.store.data.identity;
    if (!id) return null;
    const base = this.store.data.settings.serverUrl.replace(/^http/, "ws").replace(/\/$/, "");
    return `${base}/ws?uid=${encodeURIComponent(id.userId)}&secret=${encodeURIComponent(id.secret)}`;
  }

  view(): AppView {
    const d = this.store.data;
    const id = d.identity;
    return {
      me: id ? { userId: id.userId, nickname: id.nickname, code: id.code } : null,
      blocked: d.blocked, outgoing: d.outgoing, history: d.history, settings: d.settings,
      friends: [...d.friends, ...this.lanFriends()], pending: [...d.pending, ...d.lan.incoming.map((r) => ({ userId: `lan:${r.id}`, nickname: `${r.nickname}（附近）` }))],
      online: this.online, autoTrashMs: AUTOTRASH_MS, heldCount: d.held.length,
      lanOnly: !id && !!d.settings.lanNickname, lanName: this.lanMe().nickname,
      bluetooth: this.ble.available ? (this.ble.running ? this.ble.state : "off") : "unsupported",
      nearby: this.nearbyPeers().map((p) => ({
        id: p.id, nickname: p.nickname, via: p.via,
        state: d.lan.friends.some((f) => f.id === p.id) ? "friend" : d.lan.outgoing.some((o) => o.id === p.id) ? "requested" : "none",
      })),
    };
  }

  typewriterInit(): TypewriterInit {
    const d = this.store.data;
    return { friends: [...d.friends, ...this.lanFriends()], lastTo: d.lastTo, draft: d.draft, volume: d.settings.volume, sound: { soundPack: d.settings.soundPack, ambient: d.settings.ambient }, online: this.online, ui: d.typewriterUi };
  }

  // ---- server → app ----
  private onServer(m: ServerMsg): void {
    switch (m.type) {
      case "hello":
        this.store.update((d) => {
          d.friends = m.friends;
          d.pending = m.pending;
          d.blocked = [...(m.blocked ?? []), ...d.blocked.filter((b) => b.userId.startsWith("lan:"))]; // LAN blocks are local
          d.outgoing = d.outgoing.filter((o) => Date.now() - o.at < 7 * 24 * 3600_000); // requests nobody answered
          if (d.identity) { d.identity.code = m.code; d.identity.nickname = m.me.nickname; }
        });
        for (const p of m.pending) this.showRequest(p.userId, p.nickname);
        this.changed();
        break;
      case "note":
        this.receive({ id: m.id, from: m.from, fromName: m.fromName, text: m.text, sentAt: m.sentAt });
        break;
      case "status":
        this.statusWaiters.get(m.id)?.({ state: m.state, reason: m.reason });
        this.statusWaiters.delete(m.id);
        break;
      case "request_sent":
        this.store.update((d) => {
          d.outgoing = [...d.outgoing.filter((o) => o.code !== m.code), { code: m.code, at: Date.now() }];
        });
        this.changed();
        this.friendWaiter?.({ ok: true });
        break;
      case "error":
        if (this.friendWaiter) this.friendWaiter({ ok: false, reason: m.reason });
        else console.warn("server error with no pending friend request:", m.reason);
        break;
      case "friend_request":
        this.store.update((d) => {
          if (!d.pending.some((p) => p.userId === m.from)) d.pending.push({ userId: m.from, nickname: m.nickname });
        });
        this.showRequest(m.from, m.nickname);
        this.changed();
        break;
      case "friend_added": {
        let accepted = false;
        this.store.update((d) => {
          d.friends = [...d.friends.filter((f) => f.userId !== m.userId), { userId: m.userId, nickname: m.nickname }];
          d.pending = d.pending.filter((p) => p.userId !== m.userId);
          if (m.code) {
            const had = d.outgoing.length;
            d.outgoing = d.outgoing.filter((o) => o.code !== m.code);
            accepted = d.outgoing.length < had;
          }
        });
        if (accepted) this.win.broadcast("friend:accepted", m.nickname);
        this.changed();
        break;
      }
      case "friend_blocked":
        this.store.update((d) => {
          d.friends = d.friends.filter((f) => f.userId !== m.userId);
          d.blocked = [...d.blocked.filter((b) => b.userId !== m.userId), { userId: m.userId, nickname: m.nickname }];
          if (d.lastTo === m.userId) d.lastTo = null;
        });
        this.changed();
        break;
      case "friend_unblocked":
        this.store.update((d) => { d.blocked = d.blocked.filter((b) => b.userId !== m.userId); });
        this.changed();
        break;
      case "friend_removed":
        this.store.update((d) => {
          d.friends = d.friends.filter((f) => f.userId !== m.userId);
          if (d.lastTo === m.userId) d.lastTo = null;
        });
        this.changed();
        break;
    }
  }

  private showRequest(from: string, nickname: string): void {
    if (this.shownRequests.has(from)) return;
    this.shownRequests.add(from);
    void this.win.print({ kind: "request", from, nickname });
  }

  private receive(note: Note): void {
    if (this.seen.add(note.id)) {
      const dnd = this.store.data.settings.dnd;
      this.store.update((d) => {
        d.seen = this.seen.toJSON();
        d.history = [{ ...note, receivedAt: Date.now() }, ...d.history].slice(0, 200);
        if (dnd) d.held.push(note);
      });
      if (!dnd) void this.win.print({ kind: "note", note });
      this.changed();
    }
    if (!note.from.startsWith("lan:")) this.conn.send({ type: "ack", id: note.id }); // after persisting; duplicates are acked too
  }

  // ---- app → server ----
  sendNote(to: string, text: string): Promise<SendResult> {
    const id = crypto.randomUUID();
    if (to.startsWith("lan:")) return this.sendLanNote(to.slice(4), id, text);
    if (!this.conn.send({ type: "note", id, to, text, sentAt: Date.now() })) return Promise.resolve({ state: "offline" });
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.statusWaiters.delete(id); resolve({ state: "offline" }); }, 8000);
      this.statusWaiters.set(id, (r) => {
        clearTimeout(t);
        if (r.state !== "rejected") this.store.update((d) => { d.lastTo = to; d.draft = ""; });
        resolve(r);
      });
    });
  }

  addFriend(code: string): Promise<FriendResult> {
    const norm = normalizeCode(code);
    if (!norm) return Promise.resolve({ ok: false, reason: "bad_code" });
    if (!this.conn.send({ type: "friend_request", code: norm })) return Promise.resolve({ ok: false, reason: "offline" });
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.friendWaiter = null; resolve({ ok: false, reason: "timeout" }); }, 6000);
      this.friendWaiter = (r) => { clearTimeout(t); this.friendWaiter = null; resolve(r); };
    });
  }

  respond(from: string, accepted: boolean): void {
    if (from.startsWith("lan:")) { this.respondLan(from.slice(4), accepted); return; }
    this.conn.send({ type: "friend_response", from, accepted });
    this.shownRequests.delete(from);
    this.store.update((d) => { d.pending = d.pending.filter((p) => p.userId !== from); });
    this.changed();
  }

  removeFriend(userId: string): void {
    if (!userId.startsWith("lan:")) { this.conn.send({ type: "remove_friend", userId }); return; }
    this.store.update((d) => { d.lan.friends = d.lan.friends.filter((f) => `lan:${f.id}` !== userId); if (d.lastTo === userId) d.lastTo = null; });
    this.changed();
  }
  blockFriend(userId: string): void {
    if (!userId.startsWith("lan:")) { this.conn.send({ type: "block", userId }); return; }
    this.store.update((d) => {
      const f = d.lan.friends.find((x) => `lan:${x.id}` === userId);
      d.lan.friends = d.lan.friends.filter((x) => `lan:${x.id}` !== userId);
      d.blocked = [...d.blocked.filter((b) => b.userId !== userId), { userId, nickname: f ? `${f.nickname}（附近）` : "局域网用户" }];
      if (d.lastTo === userId) d.lastTo = null;
    });
    this.changed();
  }
  unblockFriend(userId: string): void {
    if (!userId.startsWith("lan:")) { this.conn.send({ type: "unblock", userId }); return; }
    this.store.update((d) => { d.blocked = d.blocked.filter((b) => b.userId !== userId); });
    this.changed();
  }

  // ---- LAN mode ----
  private lanMe(): LanMe {
    const d = this.store.data;
    return { id: d.lan.id, nickname: (d.identity?.nickname || d.settings.lanNickname || hostname().replace(/\.local$/, "")).slice(0, 16) };
  }
  private lanFriends(): { userId: string; nickname: string }[] {
    return this.store.data.lan.friends.map((f) => ({ userId: `lan:${f.id}`, nickname: `${f.nickname}（附近）` }));
  }
  private onLan(m: LanMessage): LanReply {
    const d = this.store.data;
    const uid = `lan:${m.from.id}`;
    if (d.blocked.some((b) => b.userId === uid)) return { ok: true };   // silently dropped; the sender can't tell
    if (m.type === "request") {
      if (d.lan.friends.some((f) => f.id === m.from.id)) return { ok: true };
      this.store.update((x) => {
        x.lan.incoming = [...x.lan.incoming.filter((r) => r.id !== m.from.id), { id: m.from.id, nickname: m.from.nickname, token: m.token }];
      });
      this.showRequest(uid, `${m.from.nickname}（附近）`);
      this.changed();
      return { ok: true };
    }
    if (m.type === "accept") {
      const out = d.lan.outgoing.find((o) => o.id === m.from.id);
      if (!out) return { ok: false, reason: "no_request" };
      this.store.update((x) => {
        x.lan.outgoing = x.lan.outgoing.filter((o) => o.id !== m.from.id);
        x.lan.friends = [...x.lan.friends.filter((f) => f.id !== m.from.id), { id: m.from.id, nickname: m.from.nickname, sendToken: m.token, recvToken: out.token }];
      });
      this.win.broadcast("friend:accepted", `${m.from.nickname}（附近）`);
      this.changed();
      return { ok: true };
    }
    const f = d.lan.friends.find((x) => x.id === m.from.id);
    if (!f || f.recvToken !== m.token) return { ok: false, reason: "not_friends" };
    if (f.nickname !== m.from.nickname) this.store.update(() => { f.nickname = m.from.nickname; });
    this.receive({ id: m.id, from: uid, fromName: m.from.nickname, text: m.text.slice(0, 500), sentAt: m.sentAt });
    return { ok: true };
  }
  async addLanFriend(peerId: string): Promise<FriendResult> {
    const token = crypto.randomUUID();
    this.store.update((d) => { d.lan.outgoing = [...d.lan.outgoing.filter((o) => o.id !== peerId), { id: peerId, token, at: Date.now() }]; });
    this.changed();
    const r = await this.sendNearby(peerId, { type: "request", from: this.lanMe(), token });
    if (!r.ok) { this.store.update((d) => { d.lan.outgoing = d.lan.outgoing.filter((o) => o.id !== peerId); }); this.changed(); }
    return r;
  }
  private respondLan(id: string, accepted: boolean): void {
    const req = this.store.data.lan.incoming.find((r) => r.id === id);
    this.shownRequests.delete(`lan:${id}`);
    this.store.update((d) => { d.lan.incoming = d.lan.incoming.filter((r) => r.id !== id); });
    if (req && accepted) {
      const recv = crypto.randomUUID();
      this.store.update((d) => {
        d.lan.friends = [...d.lan.friends.filter((f) => f.id !== id), { id, nickname: req.nickname, sendToken: req.token, recvToken: recv }];
      });
      void this.sendNearby(id, { type: "accept", from: this.lanMe(), token: recv });
    }
    this.changed();
  }
  private async sendLanNote(id: string, noteId: string, text: string): Promise<SendResult> {
    const f = this.store.data.lan.friends.find((x) => x.id === id);
    if (!f) return { state: "rejected", reason: "not_friends" };
    const r = await this.sendNearby(id, { type: "note", from: this.lanMe(), token: f.sendToken, id: noteId, text, sentAt: Date.now() });
    if (!r.ok) return { state: "rejected", reason: r.reason === "not_nearby" ? "not_nearby" : r.reason };
    this.store.update((d) => { d.lastTo = `lan:${id}`; d.draft = ""; });
    return { state: "delivered" };
  }
  lanNickname(name: string): void {
    this.store.update((d) => { d.settings.lanNickname = name.trim().slice(0, 16); });
    this.ble.refreshInfo();
    this.changed();
  }

  async register(nickname: string, serverUrl: string): Promise<FriendResult> {
    const base = serverUrl.trim().replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/register`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname }),
      });
      const body = (await res.json()) as { userId: string; secret: string; code: string; nickname: string; error?: string };
      if (!res.ok) return { ok: false, reason: body.error ?? `http_${res.status}` };
      this.store.update((d) => {
        d.identity = { userId: body.userId, secret: body.secret, code: body.code, nickname: body.nickname };
        d.settings.serverUrl = base;
      });
      this.conn.restart();
      this.changed();
      return { ok: true };
    } catch {
      return { ok: false, reason: "network" };
    }
  }

  setSettings(patch: Partial<Settings>): void {
    const before = { ...this.store.data.settings };
    this.store.update((d) => { d.settings = { ...d.settings, ...patch }; });
    const after = this.store.data.settings;
    if (after.serverUrl !== before.serverUrl) this.conn.restart();
    if (after.openAtLogin !== before.openAtLogin) app.setLoginItemSettings({ openAtLogin: after.openAtLogin });
    if (after.feedPosition !== before.feedPosition) this.win.repositionFeeder();
    if (after.lan !== before.lan) { if (after.lan) void this.lan.start().catch((e) => console.warn("lan start", e)); else this.lan.stop(); }
    if (after.bluetooth !== before.bluetooth) { if (after.bluetooth) this.ble.start(); else this.ble.stop(); }
    if (before.dnd && !after.dnd) {
      const held = this.store.data.held;
      this.store.update((d) => { d.held = []; });
      for (const note of held) void this.win.print({ kind: "note", note });
    }
    this.changed();
  }

  async autoTrash(note: Note, from: Point): Promise<void> {
    const d = screen.getDisplayNearestPoint(from);
    const to = trashTarget(process.platform, d.bounds, d.workArea, await readDockInfo());
    await this.win.fly(from, to);
    await trashNoteFile(note);
  }
}
