import { BUILDS, DATE, VERSION } from "./releases";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** both languages side by side; CSS shows the one matching <html lang> */
const T = (zh: string, en: string) => `<span class="lz">${zh}</span><span class="le">${en}</span>`;
const mb = (n: number) => (n ? `${Math.max(1, Math.round(n / 1048576))} MB` : T("即将上传", "soon"));
const APPLE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.7 1.3-2.7s-2.4-1-2.4-4zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z"/></svg>`;
const WIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 4.5l8.2-1.1v7.9H2zm9.2-1.3L22 1.7v9.6H11.2zM2 12.6h8.2v7.9L2 19.4zm9.2 0H22v9.7l-10.8-1.5z"/></svg>`;
const CARET = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

export function page(sizes: number[]): string {
  const builds = BUILDS.map((b, i) => ({ ...b, size: sizes[i] ?? 0, icon: b.id === "win" ? WIN : APPLE, short: b.label.replace("Mac · ", "") }));
  /** dropdown of the three builds; the matching one is marked by script */
  const menu = (id: string) => `<div class="dd" id="${id}"><div class="dd-list" role="menu">${builds.map((b) =>
    `<a role="menuitem" data-id="${b.id}" href="/dl/${b.id}"><span class="i">${b.icon}</span><span class="tx"><b>${b.id === "win" ? "Windows" : T(esc("Mac · " + b.short), esc(b.labelEn))}</b><small>${T(esc(b.detail), esc(b.detailEn))}</small></span><span class="sz">${mb(b.size)}</span></a>`).join("")}</div></div>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>桌面打字机 · Desk Typewriter</title>
<meta name="description" content="一台放在桌面上的老式打字机。敲一张纸条寄出去，它会从朋友屏幕的顶上一行一行打印下来。Mac 与 Windows 免费下载。" />
<meta property="og:title" content="桌面打字机" />
<meta property="og:description" content="把想说的话，打在朋友的桌面上。" />
<meta property="og:image" content="/assets/hero.webp" />
<meta name="theme-color" content="#f4f1ec" />
<link rel="icon" type="image/png" href="/assets/icon-64.png" />
<link rel="apple-touch-icon" href="/assets/icon-180.png" />
<link rel="preload" href="/assets/typewriter.glb" as="fetch" crossorigin />
<script>(function () {   // ?lang= > saved choice > browser language; set before first paint so nothing flips
  var l = null; try { l = new URLSearchParams(location.search).get("lang") || localStorage.getItem("dt-lang"); } catch (e) {}
  if (l !== "en" && l !== "zh") l = /^zh/i.test(navigator.language || "") ? "zh" : "en";
  document.documentElement.lang = l === "en" ? "en" : "zh-CN";
  if (l === "en") document.title = "Desk Typewriter — type a note onto a friend's desktop";
})();</script>
<style>
  :root {
    --bg: #f4f1ec; --bg-2: #ebe6de; --card: #fbfaf7; --ink: #1d1b18; --ink-2: #5f5a52; --ink-3: #9a948a;
    --line: rgba(29, 27, 24, .1); --sage: #8d9a80; --sage-ink: #4f5b45;
    --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
    --mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    --ease: cubic-bezier(.2, .7, .1, 1);
    /* display faces (all SIL OFL 1.1, free for commercial use, self-hosted): EB Garamond for English, 思源宋体 Noto Serif SC (subset to the page text) for Chinese, IBM Plex Mono (unmodified) for labels */
    --en: "EB Garamond", "Iowan Old Style", Georgia, serif;
    --zh: "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif;
    --tw: "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, monospace;
    --rust: #b4532f;
  }
  @font-face { font-family: "EB Garamond"; font-style: normal; font-weight: 400 600; font-display: swap; src: url(/assets/fonts/eb-garamond.woff2) format("woff2"); }
  @font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400 600; font-display: swap; src: url(/assets/fonts/eb-garamond-italic.woff2) format("woff2"); }
  @font-face { font-family: "Noto Serif SC"; font-weight: 400 600; font-display: swap; src: url(/assets/fonts/noto-serif-sc.woff2) format("woff2"); }
  @font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-display: swap; src: url(/assets/fonts/ibm-plex-mono.woff2) format("woff2"); }
  .en { font-family: var(--en); font-weight: 500; letter-spacing: -.005em; }
  .zh { font-family: var(--zh); font-weight: 600; letter-spacing: .01em; }
  .tw { font-family: var(--tw); letter-spacing: .04em; }
  p.en-sub { margin: 8px 0 0; font: italic 400 16px/1.55 var(--en); color: var(--ink-3); }
  /* ---------------- two languages: everything is written twice, <html lang> picks one ---------------- */
  html[lang="en"] .lz, html:not([lang="en"]) .le { display: none !important; }
  .lang { position: relative; display: inline-flex; height: 30px; padding: 2px; border-radius: 999px; border: 1px solid var(--line); background: rgba(251, 250, 247, .7); }
  .lang button { position: relative; z-index: 1; min-width: 36px; padding: 0 10px; border: 0; background: none; border-radius: 999px; cursor: pointer; color: var(--ink-3); font: 500 12.5px var(--sans); letter-spacing: .04em; transition: color .25s; }
  .lang button[data-l="en"] { font: 13px var(--tw); letter-spacing: .06em; }
  .lang::before { content: ""; position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc(50% - 2px); border-radius: 999px; background: var(--ink); transition: transform .3s var(--ease); }
  html[lang="en"] .lang::before { transform: translateX(100%); }
  html:not([lang="en"]) .lang [data-l="zh"], html[lang="en"] .lang [data-l="en"] { color: #fff; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; color: var(--ink); font: 400 17px/1.7 var(--sans); -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 32px; }

  /* ---------------- nav ---------------- */
  nav { position: fixed; inset: 0 0 auto; z-index: 30; transition: background .3s, box-shadow .3s; }
  nav.solid { background: rgba(244, 241, 236, .94); box-shadow: 0 1px 0 var(--line); }   /* no backdrop blur: it re-samples the WebGL canvas every frame */
  nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 60px; }
  .mark { display: flex; align-items: center; gap: 10px; }
  .mark .en { font-size: 21px; line-height: 1; }
  .mark .zh { font-size: 13px; font-weight: 400; color: var(--ink-3); padding-left: 10px; border-left: 1px solid var(--line); }
  .mark img { width: 26px; height: 26px; border-radius: 6px; }
  .links { display: flex; align-items: center; gap: 28px; font-size: 14px; color: var(--ink-2); }
  .links > a:hover { color: var(--ink); }
  .links > a.gh { display: inline-flex; align-items: center; color: var(--ink-2); transition: color .2s; }   /* repo link, kept on phones too */

  /* ---------------- download button + menu (pick your machine) ---------------- */
  .dl { position: relative; display: inline-flex; }
  .dl > button { display: inline-flex; align-items: center; gap: 8px; border: 0; cursor: pointer; font: 500 15px var(--sans); color: #fff; background: var(--ink); border-radius: 999px;
    height: 48px; padding: 0 22px 0 26px; box-shadow: 0 10px 24px -12px rgba(29, 27, 24, .6); transition: transform .25s var(--ease), background .2s; }
  .dl > button:hover { background: #000; transform: translateY(-1px); }
  .dl.small > button { height: 34px; padding: 0 12px 0 16px; font-size: 13.5px; box-shadow: none; }
  .dl > button svg { opacity: .7; transition: transform .25s var(--ease); }
  .dl.open > button svg { transform: rotate(180deg); }
  .dd { position: absolute; top: calc(100% + 10px); left: 50%; z-index: 40; width: 340px; transform: translate(-50%, -6px); opacity: 0; pointer-events: none; transition: opacity .2s, transform .25s var(--ease); }
  .dl.small .dd { left: auto; right: 0; transform: translate(0, -6px); }
  .dl.open .dd { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
  .dl.small.open .dd { transform: translate(0, 0); }
  .dd-list { background: #fff; border-radius: 16px; padding: 6px; box-shadow: 0 0 0 1px var(--line), 0 24px 50px -20px rgba(30, 24, 16, .35); text-align: left; }
  .dd-list a { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 11px; transition: background .15s; }
  .dd-list a:hover { background: var(--bg); }
  .dd-list .i { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: var(--bg-2); color: var(--ink); }
  .dd-list .tx { flex: 1; min-width: 0; line-height: 1.35; }
  .dd-list b { display: block; font-weight: 600; font-size: 14.5px; }
  .dd-list small { display: block; font-size: 12px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dd-list .sz { flex: none; font: 12px var(--mono); color: var(--ink-3); }
  .dd-list a.mine .i { background: var(--ink); color: #fff; }
  html[lang="en"] .dd-list a.mine b::after { content: "this computer"; }
  .dd-list a.mine b::after { content: "这台电脑"; margin-left: 8px; font-size: 11px; font-weight: 500; color: var(--sage-ink); background: rgba(141, 154, 128, .16); padding: 1px 7px; border-radius: 999px; vertical-align: 1px; }

  /* ---------------- scroll story: the machine is pinned, chapters pass by ---------------- */
  #story { position: relative; height: 640vh; background: var(--bg); }
  .sticky { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden; background: radial-gradient(80% 60% at 50% 70%, #e6e0d6 0%, rgba(230, 224, 214, 0) 70%), var(--bg); }
  #stage { position: absolute; inset: 0; cursor: grab; touch-action: pan-y; outline: none; }
  #stage.dragging { cursor: grabbing; }
  #stage .tw-canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; opacity: 0; transition: opacity 1.2s var(--ease); }
  .tw-ready #stage .tw-canvas { opacity: 1; }
  .poster { position: absolute; left: 50%; top: 52%; width: min(46%, 560px); height: auto; transform: translateX(-50%); transition: opacity 1s var(--ease); filter: drop-shadow(0 30px 28px rgba(60, 46, 30, .22)); }
  .tw-ready .poster { opacity: 0; }
  #tw-loading { position: absolute; left: 50%; bottom: 4%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); transition: opacity .5s; }
  #tw-loading::before { content: attr(data-label); }
  #tw-loading::after { content: ""; width: 140px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, var(--ink) calc(var(--p, 0) * 100%), rgba(29, 27, 24, .1) 0); }
  .tw-ready #tw-loading, .tw-failed #tw-loading { opacity: 0; }
  #tw-input { position: absolute; width: 2px; height: 20px; opacity: 0; border: 0; padding: 0; resize: none; caret-color: transparent; }
  #tw-preedit { position: absolute; transform: translateX(-50%); padding: 4px 10px; font: 15px var(--sans); color: var(--ink); background: #fff; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .12); opacity: 0; pointer-events: none; white-space: pre; z-index: 6; }
  #tw-preedit.on { opacity: 1; }
  #tw-toast { position: absolute; left: 50%; bottom: 8%; transform: translate(-50%, 6px); z-index: 8; padding: 11px 20px; max-width: 92%; text-align: center; font-size: 14.5px;
    background: rgba(255, 255, 255, .96); border-radius: 14px; box-shadow: 0 12px 30px -12px rgba(0, 0, 0, .25);
    opacity: 0; transition: opacity .45s var(--ease), transform .45s var(--ease); pointer-events: none; }
  #tw-toast.on { opacity: 1; transform: translate(-50%, 0); }

  /* the note printing on "the friend's screen" (chapter 03): the app's own receiver styles (windows/common.css + feeder.css) */
  #recv { position: absolute; z-index: 4; top: 60px; left: 56%; width: 280px; height: 0; pointer-events: none; opacity: 0; transition: opacity .4s;
    --line-h: 28px; --ink: #24201c; --ink-soft: #6b655b; --font: "American Typewriter", "Courier New", Courier, "Songti SC", "STSong", "SimSun", serif; font-family: var(--font); }
  #recv.on { opacity: 1; }
  #recv .paper { position: absolute; top: 0; left: 0; width: 280px; box-sizing: border-box; color: var(--ink);
    height: calc(var(--rows, 0) * var(--line-h) + 36px + var(--extra, 0px)); transition: height .14s cubic-bezier(.3, 1.5, .6, 1);
    background: linear-gradient(180deg, #fdfbf6 0%, #f8f3e8 65%, #f2ebdc 100%);
    box-shadow: 0 0 0 .5px rgba(80, 60, 30, .14), 0 1px 1px rgba(40, 28, 10, .06), 0 6px 12px -2px rgba(40, 28, 10, .16), 0 18px 32px -8px rgba(40, 28, 10, .24); }
  #recv .paper::before { content: ""; position: absolute; top: -3px; left: -12px; right: -12px; height: 7px; border-radius: 0 0 5px 5px; background: linear-gradient(#2a2623, #48423b); box-shadow: 0 2px 4px rgba(0, 0, 0, .3); }
  #recv .lines { height: 100%; box-sizing: border-box; overflow: hidden; padding: 18px 21px 0; font-size: 18px; line-height: var(--line-h); }
  #recv .line { height: var(--line-h); white-space: pre; }
  #recv .ch { display: inline-block; text-align: center; white-space: pre; opacity: var(--ink, 1); transform: translateY(var(--y, 0)) rotate(var(--r, 0)); }
  #recv .sig { color: var(--ink-soft); font-size: 15px; text-align: right; }
  #recv .tear-edge { position: absolute; left: 0; bottom: -9px; width: 100%; height: 10px; pointer-events: none; filter: drop-shadow(0 3px 2px rgba(40, 28, 10, .14)); }

  .chap { position: absolute; z-index: 5; pointer-events: none; opacity: var(--o, 0); translate: 0 var(--dy, 16px); will-change: opacity, translate; }
  .chap.on { pointer-events: auto; }
  .chap button, .chap a, .chap .dl { pointer-events: auto; }
  .hero-chap { left: 0; right: 0; top: 0; padding: clamp(84px, 11vh, 118px) 20px 0; text-align: center; }
  .kicker { display: inline-flex; align-items: center; gap: 12px; font: 13px var(--tw); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
  .kicker::before, .kicker::after { content: ""; width: 28px; height: 1px; background: currentColor; opacity: .4; }
  .kicker i { font-style: normal; color: var(--rust); }
  h1 { margin: 18px 0 0; font-weight: 400; text-wrap: balance; }
  h1 .en { display: block; font-size: clamp(40px, 5.4vw, 76px); line-height: 1.02; }
  h1 .en em { font-style: italic; color: var(--rust); }
  h1 .zh { display: block; font-size: clamp(38px, 4.6vw, 66px); line-height: 1.18; letter-spacing: 0; color: var(--ink); }
  h1 .zh, h2 .zh { word-break: keep-all; overflow-wrap: anywhere; }   /* break Chinese headlines at punctuation, not mid-word */
  h1 .zh em, h2 .zh em { font-style: normal; color: var(--rust); }
  .hero-chap .sub { margin: 16px auto 0; max-width: 34em; color: var(--ink-2); font-size: clamp(15px, 1.3vw, 17.5px); line-height: 1.75; text-wrap: balance; }
  .hero-chap .cta { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  .ghost { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--line); background: rgba(251, 250, 247, .7); color: var(--ink); font: 500 15px var(--sans); cursor: pointer; transition: border-color .2s, background .2s; }
  .ghost:hover { border-color: rgba(29, 27, 24, .3); background: #fff; }
  .ghost::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #c0503a; box-shadow: 0 0 0 3px rgba(192, 80, 58, .18); }
  .side { top: 50%; width: min(420px, 34vw); transform: translateY(-50%); }
  .side.left { left: max(32px, calc(50vw - 560px)); }
  .side.right { right: max(32px, calc(50vw - 560px)); }
  .side .n { display: flex; align-items: baseline; gap: 10px; font: 13px var(--tw); color: var(--ink-2); letter-spacing: .12em; text-transform: uppercase; }
  .side .n b { font: italic 500 34px/1 var(--en); color: var(--rust); letter-spacing: 0; text-transform: none; }
  .side h2 { margin: 14px 0 0; font-weight: 400; text-wrap: balance; }
  .side h2 .en { display: block; font-size: clamp(32px, 3.4vw, 50px); line-height: 1.05; }
  .side h2 .zh { display: block; font-size: clamp(30px, 3vw, 44px); line-height: 1.22; }
  .side p { margin: 14px 0 0; color: var(--ink-2); font-size: 16.5px; }
  .acts { display: flex; align-items: center; gap: 14px; margin-top: 22px; flex-wrap: wrap; }
  .acts .tip { font-size: 13px; color: var(--ink-3); }
  .chipbtn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: 500 14px var(--sans); cursor: pointer; transition: border-color .2s, background .2s; }
  .chipbtn:hover { border-color: rgba(29, 27, 24, .3); background: #fff; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .pills span { font-size: 13px; color: var(--sage-ink); background: rgba(141, 154, 128, .15); padding: 4px 12px; border-radius: 999px; }
  .sounds { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .sounds button { height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font: 13.5px var(--sans); cursor: pointer; transition: all .2s; }
  .sounds button:hover { color: var(--ink); border-color: rgba(29, 27, 24, .3); }
  .sounds button.on { background: var(--ink); color: #fff; border-color: var(--ink); }
  .progress { position: absolute; z-index: 6; right: 22px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; }
  .progress i { width: 6px; height: 6px; border-radius: 50%; background: rgba(29, 27, 24, .18); transition: background .3s, transform .3s; }
  .progress i.on { background: var(--rust); transform: scale(1.3); }

  section { padding: 120px 0; }
  .label { font: 13px var(--tw); letter-spacing: .16em; text-transform: uppercase; color: var(--rust); }
  section h2 { margin: 14px 0 0; font-weight: 400; }
  section h2 .en { display: block; font-size: clamp(40px, 5vw, 68px); line-height: 1.02; }
  section h2 .zh { display: block; font-size: clamp(36px, 4.4vw, 60px); line-height: 1.15; }
  .lead { margin: 16px 0 0; max-width: 32em; color: var(--ink-2); font-size: 18px; }
  .builds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 48px; }
  .build { position: relative; display: flex; flex-direction: column; padding: 26px 26px 22px; border-radius: 20px; background: var(--card); box-shadow: 0 1px 0 var(--line), 0 20px 40px -32px rgba(60, 46, 30, .35); transition: transform .3s var(--ease), box-shadow .3s var(--ease); }
  .build:hover { transform: translateY(-2px); box-shadow: 0 1px 0 var(--line), 0 26px 46px -28px rgba(60, 46, 30, .45); }
  .build .os { display: inline-flex; align-items: center; gap: 7px; font: 12.5px var(--tw); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
  .build .t { margin-top: 12px; font: 500 28px/1.15 var(--en); }
  .build .t small { display: block; margin-top: 4px; font: 500 15px var(--zh); letter-spacing: .04em; color: var(--ink-2); }
  .build .d { text-wrap: pretty; margin-top: 4px; color: var(--ink-2); font-size: 14px; }
  .build .go { margin-top: 26px; display: flex; align-items: center; justify-content: space-between; font: 12.5px var(--mono); color: var(--ink-3); }
  .build .go b { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; background: var(--bg-2); color: var(--ink); font: 500 14px var(--sans); transition: background .2s, color .2s; }
  .build:hover .go b, .build.mine .go b { background: var(--ink); color: #fff; }
  .build.mine { box-shadow: 0 0 0 1.5px var(--ink), 0 20px 40px -30px rgba(60, 46, 30, .45); }
  html[lang="en"] .build.mine::before { content: "fits this computer"; }
  .build.mine::before { content: "适合这台电脑"; position: absolute; top: 25px; right: 24px; font-size: 12px; font-weight: 500; color: var(--sage-ink); }
  .hint { margin-top: 16px; font-size: 14px; color: var(--ink-3); }
  .install { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 72px; padding-top: 40px; border-top: 1px solid var(--line); }
  .install h3 { margin: 0 0 12px; font-weight: 400; display: flex; align-items: baseline; gap: 12px; }
  .install h3 .en { font-size: 26px; }
  .install h3 .zh { font-size: 24px; }
  .install ol { margin: 0; padding-left: 1.2em; color: var(--ink-2); font-size: 14.5px; }
  .install li { margin: 6px 0; }
  code { font: 12.5px var(--mono); background: var(--bg-2); padding: 2px 6px; border-radius: 5px; word-break: break-all; }
  footer { padding: 0 0 44px; color: var(--ink-3); font: 12.5px var(--tw); letter-spacing: .08em; }
  footer .wrap { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 24px; }

  #veil { position: fixed; inset: 0; z-index: 25; background: var(--bg); opacity: 0; pointer-events: none; transition: opacity .18s ease; }
  #veil.on { opacity: 1; }
  .rv { opacity: 0; transform: translateY(18px); transition: opacity .9s var(--ease), transform .9s var(--ease); }
  .rv.in { opacity: 1; transform: none; }
  @media (max-width: 820px) {
    .side { left: 20px !important; right: 20px !important; width: auto; top: 84px; transform: none; }
    h1 .zh { font-size: 34px; }
    .side h2 .en { font-size: 30px; }
    .side h2 .zh { font-size: 26px; }
    .mark .zh { display: none; }
    .links { gap: 12px; }
    .links > .dl.small { display: none; }   /* phones: the hero has the download button; keep room for 中/EN */
    .side p { font-size: 15px; }
    .hero-chap { padding-top: 80px; }
    .hero-chap .sub br { display: none; }
    #recv { left: 50%; margin-left: -140px; top: 58px; }
    .chap.side[data-i="3"] { top: auto; bottom: 28px; }   /* the note comes down from the top on phones: text goes below */
    .progress { display: none; }
    .wrap { padding: 0 20px; }
    .links > a { display: none; }
    section { padding: 84px 0; }
    .steps, .feats, .builds, .install { grid-template-columns: 1fr; }
    .dd { width: min(340px, calc(100vw - 40px)); }
  }
  @media (prefers-reduced-motion: reduce) { .rv { opacity: 1; transform: none; } }
</style>
</head>
<body>
<nav id="nav"><div class="wrap">
  <a class="mark" href="/"><img src="/assets/icon-64.png" alt="" width="26" height="26" /><span class="en">Desk Typewriter</span><span class="zh lz">桌面打字机</span></a>
  <div class="links"><a href="#story" id="toStory">${T("体验", "Try it")}</a><a href="#download">${T("下载", "Download")}</a>
    <div class="dl small"><button type="button" aria-haspopup="menu">${T("下载", "Get it")} ${CARET}</button>${menu("ddNav")}</div>
    <div class="lang" role="group" aria-label="Language / 语言"><button type="button" data-l="zh" lang="zh-CN">中</button><button type="button" data-l="en" lang="en">EN</button></div>
    <a class="gh" href="https://github.com/TomCC-9986/desk-typewriter" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub"><svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
  </div>
</div></nav>

<div id="story">
  <div class="sticky">
    <div id="stage" tabindex="-1" aria-label="3D typewriter">
      <img class="poster" src="/assets/hero.webp" alt="Desk Typewriter" width="1200" height="927" />
      <div id="tw-loading" data-label=""></div>
      <textarea id="tw-input" aria-label="Type on the typewriter" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <div id="tw-preedit"></div>
      <div id="tw-toast"></div>
      <div id="recv" aria-hidden="true"></div>
    </div>

    <div class="chap hero-chap on" data-i="0" style="--o:1;--dy:0px">
      <span class="kicker">${T("Mac 与 Windows <i>✦</i> 免费", "Mac &amp; Windows <i>✦</i> Free")}</span>
      <h1><span class="en le">Type a note onto a <em>friend's</em> desktop.</span><span class="zh lz">把想说的话，打在<em>朋友</em>的桌面上。</span></h1>
      <p class="sub lz">一台住在屏幕角落的老式打字机。敲一张纸条寄出去，<br />它会在朋友的屏幕顶上一行行打印出来。</p>
      <p class="sub le">An old typewriter that lives in the corner of your screen. Type a note, send it, <br />and it prints line by line from the top of your friend's screen.</p>
      <div class="cta">
        <div class="dl"><button type="button" aria-haspopup="menu" id="heroBtn">${T("免费下载", "Download free")} ${CARET}</button>${menu("ddHero")}</div>
        <button type="button" class="ghost" data-act="type">${T("让它打一句", "Watch it type")}</button>
      </div>
    </div>
    <div class="chap side left" data-i="1">
      <div class="n"><b>01</b>${T("敲下", "Strike")}</div><h2><span class="en le">Every key really goes down.</span><span class="zh lz">每个键，都真的按下去。</span></h2>
      <p class="lz">键帽沉下去，字锤甩到纸上，嗒的一声。打中文时，拼音一个个按下去，选好字才落到纸上。打到行尾，铃会叮一声。</p>
      <p class="le">Caps sink, a type bar swings up and strikes the paper — clack. Typing Chinese, every pinyin letter is pressed before the character lands. Near the end of a line, the bell rings.</p>
      <div class="acts"><button type="button" class="chipbtn" data-act="type">${T("再打一句", "Again")}</button><span class="tip">${T("也可以直接用你的键盘打", "or just type on your keyboard")}</span></div>
    </div>
    <div class="chap side left" data-i="2">
      <div class="n"><b>02</b>${T("寄出", "Send")}</div><h2><span class="en le">Hit return. Off it goes.</span><span class="zh lz">回车，纸就寄走了。</span></h2>
      <p class="lz">纸从滚筒里卷出、撕下、飞走。对方不在线也没关系，会替你存着，等他上线再打印。</p>
      <p class="le">The sheet rolls out of the platen, tears off and flies away. Friend offline? It waits for them and prints the moment they're back.</p>
      <div class="acts"><button type="button" class="chipbtn" data-act="send">${T("寄出这张", "Send this one")}</button></div>
    </div>
    <div class="chap side right" data-i="3">
      <div class="n"><b>03</b>${T("收到", "Receive")}</div><h2><span class="en le">It prints down from the top of their screen.</span><span class="zh lz">在朋友的屏幕顶上，一行一行打出来。</span></h2>
      <p class="lz">纸条从屏幕上沿降下，逐字打印。可以拖到桌面上贴着；半小时没人理，就揉成一团扔进废纸篓。</p>
      <p class="le">The note comes down from the top edge, letter by letter. Drag it onto the desktop and it stays taped there — left alone for half an hour, it crumples into the bin.</p>
    </div>
    <div class="chap side left" data-i="4">
      <div class="n"><b>04</b>${T("附近与远方", "Near &amp; Far")}</div><h2><span class="en le">Across the room, or across the world.</span><span class="zh lz">近的远的，都送得到。</span></h2>
      <p class="lz">同一个 Wi-Fi、或者蓝牙够得着的电脑，不用联网就能互传，Mac 和 Windows 之间也行。远方的朋友，交换一个配对码就够。</p>
      <p class="le">Computers on the same Wi-Fi or within Bluetooth range swap notes with no internet at all — Mac and Windows alike. Friends far away? Just trade a pairing code.</p>
      <div class="pills">${T("<span>局域网</span><span>蓝牙</span><span>配对码</span><span>单向拉黑</span>", "<span>LAN</span><span>Bluetooth</span><span>Pairing code</span><span>Block</span>")}</div>
    </div>
    <div class="chap side right" data-i="5">
      <div class="n"><b>05</b>${T("声音", "Sound")}</div><h2><span class="en le">Make it sound like you.</span><span class="zh lz">打字声，换成你喜欢的。</span></h2>
      <p class="lz">老式打字机、钢琴、下雨、木琴……点一种声音，它会用这个声音打一句给你听。</p>
      <p class="le">Typewriter, piano, rain, marimba… pick one and it types a line for you in that sound.</p>
      <div class="sounds" id="sounds"></div>
    </div>
    <div class="progress" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  </div>
</div>

<section id="download"><div class="wrap">
  <div class="label rv">${T("下载", "Download")}</div>
  <h2 class="rv"><span class="en le">Put one on your desk.</span><span class="zh lz">选你的电脑，放一台在桌面上。</span></h2>
  <p class="lead rv">${T(`免费，版本 ${VERSION}。装好后它停在屏幕右下角，点一下或用快捷键展开。`, `Free, version ${VERSION}. It parks in the corner of your screen — click it or press the shortcut to open.`)}</p>
  <div class="builds">
    ${builds.map((b) => `<a class="build rv" data-id="${b.id}" href="/dl/${b.id}"><span class="os">${b.icon}${b.id === "win" ? "Windows" : "macOS"}</span><span class="t">${b.id === "win" ? "Windows 10 / 11" : b.id === "mac-arm64" ? "Apple silicon" : "Intel Mac"}<small>${b.id === "win" ? T("64 位电脑", "64-bit PCs") : T(esc(b.short), b.id === "mac-arm64" ? "M-series chips" : "Intel chips")}</small></span><span class="d">${T(esc(b.detail), esc(b.detailEn))}</span><span class="go"><span>${mb(b.size)}</span><b>${T("下载", "Get")}</b></span></a>`).join("\n    ")}
  </div>
  <p class="hint" id="chipHint"></p>
  <div class="install">
    <div class="rv">
      <h3><span class="en le">On a Mac</span><span class="zh lz">Mac 安装</span></h3>
      <ol class="lz">
        <li>打开 <code>.dmg</code>，把「桌面打字机」拖进「应用程序」。</li>
        <li>提示「无法验证开发者」：系统设置 › 隐私与安全性，点「仍要打开」。</li>
        <li>仍打不开：在终端运行 <code>xattr -cr /Applications/桌面打字机.app</code></li>
        <li>询问蓝牙时点「允许」。快捷键 <code>⌘⌥P</code> 展开。</li>
      </ol>
      <ol class="le">
        <li>Open the <code>.dmg</code> and drag the app into Applications.</li>
        <li>“Developer cannot be verified”: System Settings › Privacy &amp; Security › Open Anyway.</li>
        <li>Still won't open? In Terminal run <code>xattr -cr /Applications/桌面打字机.app</code></li>
        <li>Allow Bluetooth when asked. Press <code>⌘⌥P</code> to open it.</li>
      </ol>
    </div>
    <div class="rv">
      <h3><span class="en le">On Windows</span><span class="zh lz">Windows 安装</span></h3>
      <ol class="lz">
        <li>运行 <code>.exe</code>，会自动装好并打开。</li>
        <li>提示「Windows 已保护你的电脑」：点「更多信息」›「仍要运行」。</li>
        <li>防火墙询问时点「允许访问」，才能收到身边电脑的纸条。</li>
        <li>快捷键 <code>Ctrl Alt P</code> 展开。</li>
      </ol>
      <ol class="le">
        <li>Run the <code>.exe</code> — it installs and opens by itself.</li>
        <li>“Windows protected your PC”: More info › Run anyway.</li>
        <li>Allow access when the firewall asks, so notes from nearby computers get through.</li>
        <li>Press <code>Ctrl Alt P</code> to open it.</li>
      </ol>
    </div>
  </div>
</div></section>
<footer><div class="wrap"><span>Desk Typewriter${T(" · 桌面打字机", "")} ${VERSION} · ${DATE}</span><span>${T("写给朋友之间的小纸条。", "Made for notes between friends.")}</span></div></footer>

<script>
(function () {
  var ua = navigator.userAgent, id = null, hint = "";
  if (/Windows/i.test(ua)) id = "win";
  else if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) {
    id = "mac-arm64";
    try { var gl = document.createElement("canvas").getContext("webgl"), ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (ext && /Intel|AMD|Radeon|NVIDIA/i.test(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)))) id = "mac-x64"; } catch (e) {}
    hint = '<span class="lz">不确定芯片？点左上角苹果图标 › 关于本机，「芯片」写着 Apple 就选 Apple 芯片。</span><span class="le">Not sure which chip? Apple menu › About This Mac — if “Chip” says Apple, pick Apple silicon.</span>';
  } else hint = '<span class="lz">桌面打字机是电脑软件，请在 Mac 或 Windows 电脑上打开这个页面下载。</span><span class="le">Desk Typewriter is a desktop app — open this page on a Mac or Windows computer to download it.</span>';
  if (id) document.querySelectorAll('[data-id="' + id + '"]').forEach(function (el) { el.classList.add("mine"); });
  document.getElementById("chipHint").innerHTML = hint;
  // language switch (top right): flips <html lang>, remembered; the live demo listens for "langchange"
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () {
      var l = b.getAttribute("data-l"), root = document.documentElement;
      if ((root.lang === "en") === (l === "en")) return;
      root.lang = l === "en" ? "en" : "zh-CN";
      document.title = l === "en" ? "Desk Typewriter — type a note onto a friend's desktop" : "桌面打字机 · Desk Typewriter";
      try { localStorage.setItem("dt-lang", l); } catch (e) {}
      try { var u = new URL(location.href); if (u.searchParams.has("lang")) { u.searchParams.set("lang", l); history.replaceState(null, "", u); } } catch (e) {}
      dispatchEvent(new CustomEvent("langchange", { detail: l }));
    });
  });
  // download buttons open a menu of the three builds
  var dls = document.querySelectorAll(".dl");
  dls.forEach(function (dl) {
    dl.querySelector("button").addEventListener("click", function (e) {
      e.stopPropagation(); var on = !dl.classList.contains("open");
      dls.forEach(function (x) { x.classList.remove("open"); }); dl.classList.toggle("open", on);
    });
  });
  document.addEventListener("click", function () { dls.forEach(function (x) { x.classList.remove("open"); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") dls.forEach(function (x) { x.classList.remove("open"); }); });
  var dots = document.querySelectorAll(".progress i"), chaps = document.querySelectorAll(".chap");
  var mo = new MutationObserver(function () { chaps.forEach(function (c, i) { if (dots[i]) dots[i].classList.toggle("on", c.classList.contains("on")); }); });
  chaps.forEach(function (c) { mo.observe(c, { attributes: true, attributeFilter: ["class"] }); });   // the chapters only: the dots are not observed
  var veil = document.createElement("div"); veil.id = "veil"; document.body.append(veil);
  function jumpTo(y) {   // fade out, jump without scrolling through the story, fade back in
    veil.classList.add("on");
    setTimeout(function () { scrollTo({ top: y, behavior: "instant" }); requestAnimationFrame(function () { veil.classList.remove("on"); }); }, 180);
  }
  document.getElementById("toStory").addEventListener("click", function (e) {
    e.preventDefault(); var st = document.getElementById("story"); jumpTo(st.offsetTop + (st.offsetHeight - innerHeight) / 5);
  });
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    if (a.id === "toStory") return;
    a.addEventListener("click", function (e) { var t = document.querySelector(a.getAttribute("href")); if (!t) return; e.preventDefault(); jumpTo(t.getBoundingClientRect().top + scrollY - 40); });
  });
  var nav = document.getElementById("nav");
  addEventListener("scroll", function () { nav.classList.toggle("solid", scrollY > 20); }, { passive: true });
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".rv").forEach(function (el, i) { el.style.transitionDelay = (i % 3) * 80 + "ms"; io.observe(el); });
})();
</script>
<script type="module" src="/assets/demo.js"></script>
</body>
</html>`;
}
