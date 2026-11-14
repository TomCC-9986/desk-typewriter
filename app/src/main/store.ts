import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Friend, Note } from "@shared/protocol";

export interface Identity { userId: string; secret: string; code: string; nickname: string }
export type FeedPosition = "left" | "center" | "right";
export interface Settings {
  serverUrl: string;
  volume: number;
  soundPack: string;   // see windows/sound.ts SOUND_PACKS
  ambient: boolean;    // nature packs: quiet background bed while typing
  lan: boolean;        // LAN mode: find nearby typewriters, pass notes without the internet
  bluetooth: boolean;  // Bluetooth LE: the same, without any network at all (macOS / Windows helper)
  lanNickname: string; // name shown to nearby machines when there is no server account
  dnd: boolean;
  feedPosition: FeedPosition;
  openAtLogin: boolean;
  shortcut: string;
}
/** A friend request we sent that the other side has not answered yet. */
export interface OutgoingRequest { code: string; at: number }
/** LAN friend: tokens swapped when the request was accepted (sendToken: we present it; recvToken: they must). */
export interface LanFriend { id: string; nickname: string; sendToken: string; recvToken: string }
export interface LanState {
  id: string;                                              // our LAN identity (independent of the server account)
  friends: LanFriend[];
  outgoing: { id: string; token: string; at: number }[];   // requests we sent (token = what they must present to us)
  incoming: { id: string; nickname: string; token: string }[];
}
export interface HistoryItem extends Note { receivedAt: number }
export interface StuckNote { note: Note; x: number; y: number; w: number; h: number }

export interface StoreData {
  identity: Identity | null;
  settings: Settings;
  friends: Friend[];
  pending: Friend[];
  blocked: Friend[];
  outgoing: OutgoingRequest[];
  history: HistoryItem[];
  draft: string;
  lastTo: string | null;
  seen: string[];
  held: Note[];      // received during 勿扰, printed when it is turned off
  stuck: StuckNote[]; // notes dragged onto the desktop
  typewriterUi: TypewriterUi;
  lan: LanState;
}

/** Where the typewriter parks when collapsed, and where it sits when open (null = bottom centre). */
export interface TypewriterUi { corner: "left" | "right"; pos: { x: number; y: number } | null; yaw?: number; pitch?: number }

export const DEFAULT_SERVER =
  process.env.DESK_SERVER || process.env.DESK_SERVER_DEFAULT || "http://127.0.0.1:8787";

export function defaults(): StoreData {
  return {
    identity: null,
    settings: {
      serverUrl: DEFAULT_SERVER,
      volume: 0.6,
      soundPack: "typewriter",
      ambient: true,
      lan: true,
      bluetooth: true,
      lanNickname: "",
      dnd: false,
      feedPosition: "center",
      openAtLogin: false,
      shortcut: process.env.DESK_SHORTCUT || "CommandOrControl+Alt+P",
    },
    friends: [], pending: [], blocked: [], outgoing: [], history: [],
    draft: "", lastTo: null, seen: [], held: [], stuck: [],
    typewriterUi: { corner: "right", pos: null },
    lan: { id: crypto.randomUUID(), friends: [], outgoing: [], incoming: [] },
  };
}

export class Store {
  data: StoreData;
  private file: string;

  constructor(private dir: string) {
    this.file = join(dir, "state.json");
    this.data = this.load();
  }

  update(fn: (d: StoreData) => void): void {
    fn(this.data);
    this.save();
  }

  private load(): StoreData {
    const base = defaults();
    let text: string;
    try { text = readFileSync(this.file, "utf8"); } catch { return base; }
    try {
      const raw = JSON.parse(text);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
      const out = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {}) } } as StoreData;
      for (const k of ["friends", "pending", "blocked", "outgoing", "history", "seen", "held", "stuck"] as const) {
        if (!Array.isArray(raw[k])) (out as unknown as Record<string, unknown>)[k] = base[k];
      }
      const id = raw.identity;
      const ok = id && typeof id === "object" &&
        ["userId", "secret", "code", "nickname"].every((f) => typeof id[f] === "string");
      out.identity = ok ? id : null;
      const lan = raw.lan;
      out.lan = lan && typeof lan === "object" && typeof lan.id === "string" ? {
        id: lan.id,
        friends: Array.isArray(lan.friends) ? lan.friends.filter((f: Record<string, unknown>) => f && ["id", "nickname", "sendToken", "recvToken"].every((k) => typeof f[k] === "string")) : [],
        outgoing: Array.isArray(lan.outgoing) ? lan.outgoing : [],
        incoming: Array.isArray(lan.incoming) ? lan.incoming : [],
      } : base.lan;
      return out;
    } catch {
      try { if (existsSync(this.file)) renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return base;
    }
  }

  private save(retry = true): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error("store save failed", e);
      if (retry) setTimeout(() => this.save(false), 500);
    }
  }
}
