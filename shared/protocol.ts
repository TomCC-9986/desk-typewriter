export const MAX_TEXT = 500;
export const RATE_PER_MIN = 10;
export const QUEUE_TTL_MS = 7 * 24 * 3600 * 1000;

export interface Friend { userId: string; nickname: string }
export interface Note { id: string; from: string; fromName: string; text: string; sentAt: number }

export type ClientMsg =
  | { type: "note"; id: string; to: string; text: string; sentAt: number }
  | { type: "ack"; id: string }
  | { type: "friend_request"; code: string }
  | { type: "friend_response"; from: string; accepted: boolean }
  | { type: "remove_friend"; userId: string }
  | { type: "block"; userId: string }
  | { type: "unblock"; userId: string };

export type NoteState = "delivered" | "queued" | "rejected";

export type ServerMsg =
  | { type: "hello"; me: Friend; code: string; friends: Friend[]; pending: Friend[]; blocked?: Friend[] }
  | ({ type: "note" } & Note)
  | { type: "status"; id: string; state: NoteState; reason?: string }
  | { type: "request_sent"; code: string }
  | { type: "friend_request"; from: string; nickname: string }
  | { type: "friend_added"; userId: string; nickname: string; code?: string }
  | { type: "friend_blocked"; userId: string; nickname: string }
  | { type: "friend_unblocked"; userId: string; nickname: string }
  | { type: "friend_removed"; userId: string }
  | { type: "error"; reason: string };

/** Counts code points so emoji / CJK count as one char, matching the client. */
export function textLength(s: string): number {
  return [...s].length;
}
