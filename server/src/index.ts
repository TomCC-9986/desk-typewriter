import { generateCode } from "../../shared/code";
import { Inbox } from "./inbox";

export { Inbox };

export interface Env {
  USERS: KVNamespace;
  INBOX: DurableObjectNamespace<Inbox>;
}

interface UserRecord { secretHash: string; code: string; nickname: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

const REGISTER_PER_HOUR = 5;

/** Fixed-window counter per client IP in KV (approximate: KV is eventually consistent, good enough against bulk sign-ups). */
async function registerAllowed(req: Request, env: Env): Promise<boolean> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const key = `rl:reg:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await env.USERS.get(key)) ?? "0");
  if (n >= REGISTER_PER_HOUR) return false;
  await env.USERS.put(key, String(n + 1), { expirationTtl: 3700 });
  return true;
}

async function register(req: Request, env: Env): Promise<Response> {
  if (!(await registerAllowed(req, env))) return json({ error: "rate_limited" }, 429);
  let body: { nickname?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const nickname = typeof body.nickname === "string" ? [...body.nickname.trim()].slice(0, 16).join("") : "";
  if (!nickname) return json({ error: "nickname_required" }, 400);

  let code = generateCode();
  for (let i = 0; await env.USERS.get(`code:${code}`); i++) {
    if (i > 10) return json({ error: "code_exhausted" }, 500);
    code = generateCode();
  }
  const userId = crypto.randomUUID();
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  const record: UserRecord = { secretHash: await sha256(secret), code, nickname };
  await env.INBOX.get(env.INBOX.idFromName(userId)).init({ userId, nickname }, code);
  await env.USERS.put(`code:${code}`, userId);
  await env.USERS.put(`user:${userId}`, JSON.stringify(record));
  return json({ userId, secret, code, nickname });
}

async function connect(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
  const uid = url.searchParams.get("uid") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  const raw = await env.USERS.get(`user:${uid}`);
  if (!raw) return new Response("unauthorized", { status: 401 });
  const rec = JSON.parse(raw) as UserRecord;
  if (rec.secretHash !== (await sha256(secret))) return new Response("unauthorized", { status: 401 });
  return env.INBOX.get(env.INBOX.idFromName(uid)).fetch(req);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/register" && req.method === "POST") return register(req, env);
    if (url.pathname === "/ws") return connect(req, env, url);
    if (url.pathname === "/health") return new Response("ok");
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
