import type { AppView, Settings } from "../../shared/ipc-types";
import { SOUND_PACKS, setSound, setVolume, sfx, type SoundPack } from "../sound";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let view: AppView;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

const REASONS: Record<string, string> = {
  bad_code: "配对码格式不对", code_not_found: "没有这个配对码", self: "这是你自己的码",
  already_friends: "你们已经是好友了", offline: "没连上服务器", timeout: "服务器没响应", network: "连不上服务器",
  nickname_required: "名字不能为空",
  not_nearby: "对方已经不在附近了", not_friends: "对方还不是你的局域网好友", no_request: "对方没收到请求，再发一次",
  rate_limited: "太频繁了，过一分钟再试", server_error: "服务器出错了，稍后再试", bad_message: "请求格式不对",
};
const reason = (r?: string) => REASONS[r ?? ""] ?? `出错了（${r}）`;

async function render(): Promise<void> {
  view = await window.desk.invoke<AppView>("state:get");
  const ready = !!view.me || view.lanOnly;
  $("setup").hidden = ready;
  $("main").hidden = !ready;
  if (!ready) {
    if (!$<HTMLInputElement>("server").value) $<HTMLInputElement>("server").value = view.settings.serverUrl;
    return;
  }
  // LAN-only: no pairing code / add-by-code (both need the server)
  $("me").hidden = !view.me; $("add").hidden = !view.me;
  $("code").textContent = view.me?.code ?? "";

  $("nearbySec").hidden = !view.settings.lan && !view.settings.bluetooth;
  const BT = { unauthorized: "蓝牙没有授权：到「系统设置 › 隐私与安全性 › 蓝牙」里允许桌面打字机。", off: view.settings.bluetooth ? "蓝牙没有打开。" : "",
    unsupported: view.settings.bluetooth ? "这台电脑暂不支持蓝牙互传，只能用 Wi-Fi。" : "" } as Record<string, string>;
  $("btState").textContent = BT[view.bluetooth] ?? "";
  $("lanName").textContent = view.lanName;
  const STATE = { friend: "已是好友", requested: "等待对方同意" } as const;
  $("nearbyList").replaceChildren(...(view.nearby.length ? view.nearby.map((p) => el("li", {},
    el("span", { className: "name", textContent: `${p.nickname}${p.via === "bt" ? " · 蓝牙" : " · Wi-Fi"}` }),
    p.state === "none"
      ? el("button", { className: "primary", textContent: "加为好友", onclick: async () => {
          $("nearbyMsg").textContent = "发送中…";
          const r = await window.desk.invoke<{ ok: boolean; reason?: string }>("lan:add", p.id);
          $("nearbyMsg").textContent = r.ok ? `已发给「${p.nickname}」，等对方同意` : reason(r.reason);
        } })
      : el("span", { className: "muted", textContent: STATE[p.state] }),
  )) : [el("li", { className: "muted", textContent: "正在找附近的打字机…（对方也要打开局域网模式或蓝牙）" })]));
  $("online").classList.toggle("on", view.online);
  $("online").title = view.online ? "在线" : "离线";

  $("pendingSec").hidden = !view.pending.length;
  $("pending").replaceChildren(...view.pending.map((p) => el("li", {},
    el("span", { className: "name", textContent: `${p.nickname} 想加你` }),
    el("button", { className: "primary", textContent: "同意", onclick: () => window.desk.send("friend:respond", { from: p.userId, accepted: true }) }),
    el("button", { textContent: "拒绝", onclick: () => window.desk.send("friend:respond", { from: p.userId, accepted: false }) }),
  )));

  $("outgoing").replaceChildren(...view.outgoing.map((o) => el("li", { className: "wait" },
    el("span", { className: "name", textContent: `${o.code} · 等待对方同意` }),
  )));
  $("blockedSec").hidden = !view.blocked.length;
  $("blockedList").replaceChildren(...view.blocked.map((b) => el("li", {},
    el("span", { className: "name", textContent: b.nickname || "（未知）" }),
    el("button", { textContent: "解除拉黑", onclick: () => window.desk.send("friend:unblock", b.userId) }),
  )));

  $("friendList").replaceChildren(...(view.friends.length ? view.friends.map((f) => el("li", {},
    el("span", { className: "name", textContent: f.nickname }),
    el("button", { textContent: "删除", onclick: () => { if (confirm(`删除好友「${f.nickname}」？`)) window.desk.send("friend:remove", f.userId); } }),
    el("button", { textContent: "拉黑", onclick: () => { if (confirm(`拉黑「${f.nickname}」？对方的纸条和好友请求你都不会收到，对方不会知道。`)) window.desk.send("friend:block", f.userId); } }),
  )) : [el("li", { className: "muted", textContent: "还没有好友" })]));

  const s = view.settings;
  $<HTMLInputElement>("volume").value = String(s.volume);
  setVolume(s.volume); setSound(s);
  const sp = $<HTMLSelectElement>("soundPack");
  if (!sp.options.length) {
    for (const g of [...new Set(SOUND_PACKS.map((p) => p.group))]) {
      const og = document.createElement("optgroup"); og.label = g;
      for (const p of SOUND_PACKS.filter((x) => x.group === g)) og.append(new Option(p.name, p.id));
      sp.append(og);
    }
  }
  sp.value = s.soundPack;
  $<HTMLInputElement>("ambient").checked = s.ambient;
  $("ambientRow").style.display = ["rain", "leaves", "fire"].includes(s.soundPack) ? "" : "none";
  $<HTMLSelectElement>("feedPosition").value = s.feedPosition;
  $<HTMLInputElement>("dnd").checked = s.dnd;
  $<HTMLInputElement>("lan").checked = s.lan;
  $<HTMLInputElement>("bluetooth").checked = s.bluetooth;
  $<HTMLInputElement>("openAtLogin").checked = s.openAtLogin;
  if (document.activeElement !== $("serverUrl")) $<HTMLInputElement>("serverUrl").value = s.serverUrl;
  $("shortcut").textContent = s.shortcut.replace("CommandOrControl", navigator.platform.includes("Mac") ? "⌘" : "Ctrl").replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt").replace(/\+/g, " ");

  $("historyList").replaceChildren(...(view.history.length ? view.history.slice(0, 50).map((h) => el("li", {},
    el("span", { className: "text", textContent: h.text }),
    el("span", { className: "when", textContent: `${h.fromName} · ${new Date(h.sentAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` }),
  )) : [el("li", { className: "muted", textContent: "还没收到过纸条" })]));
}

const set = (patch: Partial<Settings>) => window.desk.invoke("settings:set", patch);

$("registerBtn").addEventListener("click", async () => {
  const nickname = $<HTMLInputElement>("nickname").value.trim();
  if (!nickname) { $("setupMsg").textContent = reason("nickname_required"); return; }
  $("setupMsg").textContent = "注册中…";
  const r = await window.desk.invoke<{ ok: boolean; reason?: string }>("register", nickname, $<HTMLInputElement>("server").value);
  $("setupMsg").textContent = r.ok ? "" : reason(r.reason);
  await render();
});
$("copy").addEventListener("click", async () => {
  await window.desk.invoke("clipboard:write", view.me?.code ?? "");
  $("copy").textContent = "已复制";
  setTimeout(() => { $("copy").textContent = "复制"; }, 1200);
});
$("addBtn").addEventListener("click", async () => {
  const code = $<HTMLInputElement>("friendCode").value;
  $("addMsg").textContent = "发送中…";
  const r = await window.desk.invoke<{ ok: boolean; reason?: string }>("friend:add", code);
  $("addMsg").textContent = r.ok ? "" : reason(r.reason); // an accepted-pending request shows in the friends list
  if (r.ok) $<HTMLInputElement>("friendCode").value = "";
});
$("volume").addEventListener("change", (e) => void set({ volume: Number((e.target as HTMLInputElement).value) }));
$("soundPack").addEventListener("change", (e) => {
  const id = (e.target as HTMLSelectElement).value as SoundPack;
  sfx.preview(id);
  void set({ soundPack: id });
});
$("soundTry").addEventListener("click", () => sfx.preview($<HTMLSelectElement>("soundPack").value as SoundPack));
$("ambient").addEventListener("change", (e) => void set({ ambient: (e.target as HTMLInputElement).checked }));
$("feedPosition").addEventListener("change", (e) => void set({ feedPosition: (e.target as HTMLSelectElement).value as Settings["feedPosition"] }));
$("lan").addEventListener("change", (e) => void set({ lan: (e.target as HTMLInputElement).checked }));
$("bluetooth").addEventListener("change", (e) => void set({ bluetooth: (e.target as HTMLInputElement).checked }));
$("lanOnlyBtn").addEventListener("click", async () => {
  const nickname = $<HTMLInputElement>("nickname").value.trim();
  if (!nickname) { $("setupMsg").textContent = reason("nickname_required"); return; }
  await window.desk.invoke("lan:nickname", nickname);
  await set({ lan: true });
  await render();
});
$("dnd").addEventListener("change", (e) => void set({ dnd: (e.target as HTMLInputElement).checked }));
$("openAtLogin").addEventListener("change", (e) => void set({ openAtLogin: (e.target as HTMLInputElement).checked }));
$("serverUrl").addEventListener("change", (e) => void set({ serverUrl: (e.target as HTMLInputElement).value.trim().replace(/\/$/, "") }));

window.desk.on("friend:accepted", (nickname: string) => { $("addMsg").textContent = `「${nickname}」已同意，你们是好友了`; });
window.desk.on("state:changed", () => void render());
window.desk.on("panel:section", (id: string) => {
  const target = $(id === "me" && !view?.me ? "setup" : id);
  target?.scrollIntoView({ behavior: "smooth" });
  if (id === "add") $<HTMLInputElement>("friendCode").focus();
});

void render();
