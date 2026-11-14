#!/usr/bin/env node
// Fake dt-ble for tests: two processes share an "air" directory. Each announces itself as a file; "send" drops a
// message file into the peer's inbox and waits for the reply file the peer writes after asking its app.
const fs = require("fs"), path = require("path"), rl = require("readline");
const AIR = process.env.FAKE_AIR; let me = null, info = "{}";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const dir = (d) => path.join(AIR, d);
function tick() {
  if (!me) return;
  fs.writeFileSync(path.join(dir(me), "info"), info);
  for (const d of fs.readdirSync(AIR)) {
    if (d === me) continue;
    try { out({ ev: "seen", peer: d, rssi: -50 }); out({ ev: "peer", peer: d, info: fs.readFileSync(path.join(dir(d), "info"), "utf8") }); } catch {}
  }
  for (const f of fs.readdirSync(path.join(dir(me), "in"))) {
    if (!f.endsWith(".msg")) continue;
    const p = path.join(dir(me), "in", f); const data = fs.readFileSync(p, "utf8"); fs.unlinkSync(p);
    out({ ev: "msg", req: Number(f.split(".")[0]), data, _from: f });
  }
}
const replyFor = new Map();
rl.createInterface({ input: process.stdin }).on("line", (l) => {
  const c = JSON.parse(l);
  if (c.cmd === "start") { me = String(process.pid); fs.mkdirSync(path.join(dir(me), "in"), { recursive: true }); info = c.info; out({ ev: "state", state: "on" }); setInterval(tick, 50); }
  if (c.cmd === "info") info = c.info;
  if (c.cmd === "send") {
    const box = path.join(dir(c.peer), "in"); const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    fs.writeFileSync(path.join(box, `${id}.msg`), c.data);
    const t = setInterval(() => { const r = path.join(box, `${id}.reply`); if (fs.existsSync(r)) { clearInterval(t); out({ ev: "sent", req: c.req, reply: fs.readFileSync(r, "utf8") }); fs.unlinkSync(r); } }, 30);
  }
  if (c.cmd === "reply") fs.writeFileSync(path.join(dir(me), "in", `${c.req}.reply`), c.data);
  if (c.cmd === "stop") process.exit(0);
});
