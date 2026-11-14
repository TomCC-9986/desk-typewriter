import type { ClientMsg } from "../../shared/protocol";

export const UUID_RE = /^[0-9a-f-]{36}$/;
export const NOTE_ID_RE = /^[\w-]{1,64}$/;

const isStr = (v: unknown): v is string => typeof v === "string";
const isUuid = (v: unknown): v is string => isStr(v) && UUID_RE.test(v);

/** Validates the shape of every field; returns null for anything malformed. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "note":
      if (!isStr(m.id) || !isUuid(m.to) || !isStr(m.text) || typeof m.sentAt !== "number" || !Number.isFinite(m.sentAt)) return null;
      return { type: "note", id: m.id, to: m.to, text: m.text, sentAt: m.sentAt };
    case "ack":
      return isStr(m.id) ? { type: "ack", id: m.id } : null;
    case "friend_request":
      return isStr(m.code) ? { type: "friend_request", code: m.code } : null;
    case "friend_response":
      return isUuid(m.from) && typeof m.accepted === "boolean"
        ? { type: "friend_response", from: m.from, accepted: m.accepted } : null;
    case "remove_friend":
      return isUuid(m.userId) ? { type: "remove_friend", userId: m.userId } : null;
    case "block":
      return isUuid(m.userId) ? { type: "block", userId: m.userId } : null;
    case "unblock":
      return isUuid(m.userId) ? { type: "unblock", userId: m.userId } : null;
    default:
      return null;
  }
}
