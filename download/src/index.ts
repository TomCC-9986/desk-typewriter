/**
 * 桌面打字机 download site: one HTML page + installers stored as <=20 MiB static-asset parts (Workers assets cap a
 * file at 25 MiB) and stitched back into one stream per download, with Range support so a broken download can resume. Routes: /  ·  /dl/<build id>  ·  /assets/<file>  ·  /latest.json
 */
import { BUILDS, DATE, VERSION } from "./releases";
import { page } from "./page";

interface Env { ASSETS: Fetcher }
import { MANIFEST } from "./manifest";

function rangeOf(req: Request, size: number): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN, end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) { start = size - Number(m[2]); end = size - 1; }   // suffix range: last N bytes
  if (start < 0 || start >= size || end < start) return null;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

/** Stream bytes [offset, offset+length) of a build by fetching the overlapping parts one after another. */
function stitch(env: Env, origin: string, parts: [string, number][], offset: number, length: number): ReadableStream {
  const { readable, writable } = new TransformStream();
  (async () => {
    let pos = 0;
    try {
      for (const [path, n] of parts) {
        const a = Math.max(offset, pos), b = Math.min(offset + length, pos + n);   // overlap with this part
        if (a < b) {
          const whole = a === pos && b === pos + n;
          const r = await env.ASSETS.fetch(new Request(origin + path, whole ? {} : { headers: { range: `bytes=${a - pos}-${b - pos - 1}` } }));
          if (!r.body || (r.status !== 200 && r.status !== 206)) throw new Error(`part ${path}: ${r.status}`);
          if (!whole && r.status === 200) {   // assets ignored the range: skip/trim by hand
            const reader = r.body.getReader(), w = writable.getWriter();
            let skip = a - pos, left = b - a;
            for (;;) {
              const { done, value } = await reader.read(); if (done || left <= 0) break;
              let c = value as Uint8Array;
              if (skip) { const k = Math.min(skip, c.length); c = c.subarray(k); skip -= k; }
              if (c.length) { const take = c.subarray(0, left); await w.write(take); left -= take.length; }
            }
            w.releaseLock(); reader.cancel().catch(() => {});
          } else {
            await r.body.pipeTo(writable, { preventClose: true });
          }
        }
        pos += n;
      }
      await writable.close();
    } catch (e) { await writable.abort(e).catch(() => {}); }
  })();
  return readable;
}

function serveBuild(req: Request, env: Env, origin: string, id: string, headers: Record<string, string>): Response {
  const m = MANIFEST[id];
  if (!m) return new Response("还没上传这个文件", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const base: Record<string, string> = { "accept-ranges": "bytes", "content-type": "application/octet-stream", etag: `"${id}-${m.size}"`, ...headers };
  if (req.method === "HEAD") return new Response(null, { headers: { ...base, "content-length": String(m.size) } });
  const r = rangeOf(req, m.size);
  if (req.headers.has("range") && !r) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${m.size}` } });
  if (r) return new Response(stitch(env, origin, m.parts, r.offset, r.length), { status: 206, headers: { ...base, "content-length": String(r.length), "content-range": `bytes ${r.offset}-${r.offset + r.length - 1}/${m.size}` } });
  return new Response(stitch(env, origin, m.parts, 0, m.size), { headers: { ...base, "content-length": String(m.size) } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    if (url.pathname === "/") {
      const sizes = BUILDS.map((b) => MANIFEST[b.id]?.size ?? 0);
      return new Response(page(sizes), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/latest.json") {
      return Response.json({ version: VERSION, date: DATE, builds: BUILDS.map((b) => ({ id: b.id, url: `${url.origin}/dl/${b.id}` })) },
        { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
    }
    const dl = /^\/dl\/([a-z0-9-]+)$/.exec(url.pathname);
    if (dl) {
      const b = BUILDS.find((x) => x.id === dl[1]);
      if (!b) return new Response("not found", { status: 404 });
      return serveBuild(req, env, url.origin, b.id, {
        "content-disposition": `attachment; filename="desk-typewriter-${VERSION}-${b.id}${b.key.slice(b.key.lastIndexOf("."))}"; filename*=UTF-8''${encodeURIComponent(b.file)}`,
        "cache-control": "public, max-age=86400",
      });
    }
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/img/")) return env.ASSETS.fetch(req);
    return new Response("not found", { status: 404 });
  },
};
