import type { Friend, Note, NoteState } from "@shared/protocol";
import type { Point } from "../lib/trash-target";
import type { HistoryItem, OutgoingRequest, Settings, StuckNote, TypewriterUi } from "../main/store";

export type { HistoryItem, OutgoingRequest, Point, Settings, StuckNote, TypewriterUi };

export type PrintItem =
  | { kind: "note"; note: Note }
  | { kind: "request"; from: string; nickname: string };

export interface SendResult { state: NoteState | "offline"; reason?: string }

export interface TypewriterInit {
  friends: Friend[];
  lastTo: string | null;
  draft: string;
  volume: number;
  sound: { soundPack: string; ambient: boolean };
  online: boolean;
  ui: TypewriterUi;
}

export interface FlyRequest { id: string; from: Point; to: Point; origin: Point }

export interface AppView {
  me: { userId: string; nickname: string; code: string } | null;
  friends: Friend[];
  pending: Friend[];
  blocked: Friend[];
  outgoing: OutgoingRequest[];
  history: HistoryItem[];
  settings: Settings;
  online: boolean;
  autoTrashMs: number;
  heldCount: number;
  lanOnly: boolean;            // no server account: LAN only
  lanName: string;             // how nearby machines see us
  nearby: { id: string; nickname: string; via: "wifi" | "bt"; state: "friend" | "requested" | "none" }[];
  bluetooth: string;           // on | off | unauthorized | unsupported | resetting | unknown
}
