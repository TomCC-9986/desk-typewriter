import { SELF, env, runInDurableObject } from "cloudflare:test";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";

export interface Registered { userId: string; secret: string; code: string; nickname: string }

export async function register(nickname: string): Promise<Registered> {
  // a fresh fake IP per call so the per-IP sign-up limit never trips the other tests
  const ip = `test-${crypto.randomUUID()}`;
  const res = await SELF.fetch("http://x/register", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify({ nickname }) });
  if (!res.ok) throw new Error(`register failed ${res.status}`);
  return res.json();
}

export interface Client {
  next<T extends ServerMsg["type"]>(type?: T): Promise<Extract<ServerMsg, { type: T }>>;
  drain(ms: number): Promise<ServerMsg[]>;
  send(m: ClientMsg): void;
  close(): void;
}

export async function connect(u: { userId: string; secret: string }): Promise<Client> {
  const res = await SELF.fetch(`http://x/ws?uid=${u.userId}&secret=${u.secret}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no websocket (status ${res.status})`);
  ws.accept();
  const inbox: ServerMsg[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (e) => {
    inbox.push(JSON.parse(e.data as string));
    waiters.splice(0).forEach((w) => w());
  });
  return {
    async next(type) {
      for (;;) {
        const i = inbox.findIndex((m) => !type || m.type === type);
        if (i >= 0) return inbox.splice(i, 1)[0] as never;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`timeout waiting for ${type ?? "any"}`)), 2000);
          waiters.push(() => { clearTimeout(t); resolve(); });
        });
      }
    },
    async drain(ms) {
      await new Promise((r) => setTimeout(r, ms));
      return inbox.splice(0);
    },
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(1000, "test"),
  };
}

export function inboxStub(userId: string) {
  return env.INBOX.get(env.INBOX.idFromName(userId));
}

export async function eventually(check: () => Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("condition not met in time");
}

export async function waitOffline(userId: string): Promise<void> {
  await eventually(() =>
    runInDurableObject(inboxStub(userId), async (_i, state) =>
      state.getWebSockets().every((ws) => ws.readyState !== 1),
    ),
  );
}

/** Registers two users, connects both, makes them friends, consumes setup messages. */
export async function befriend(nameA = "小王", nameB = "阿杰") {
  const a = await register(nameA);
  const b = await register(nameB);
  const ca = await connect(a);
  const cb = await connect(b);
  await ca.next("hello");
  await cb.next("hello");
  ca.send({ type: "friend_request", code: b.code });
  await ca.next("request_sent");
  await cb.next("friend_request");
  cb.send({ type: "friend_response", from: a.userId, accepted: true });
  await cb.next("friend_added");
  await ca.next("friend_added");
  return { a, b, ca, cb };
}
