/**
 * All sounds are synthesised on the fly (no samples, nothing to license).
 *
 * Paper sounds (feed, tear, crumple, drop) are always physical. What a keystroke sounds like is the
 * user's choice: a sound pack. Nature packs also lay a quiet ambient bed under the typing that fades in
 * with the first key and out a few seconds after the last one.
 */
export type SoundPack = "typewriter" | "music" | "drop" | "chime" | "marimba" | "rain" | "leaves" | "fire";
export const SOUND_PACKS: { id: SoundPack; name: string; group: string }[] = [
  { id: "typewriter", name: "老式打字机", group: "打字机" },
  { id: "music", name: "钢琴音符", group: "音乐" },
  { id: "drop", name: "水滴", group: "好听的音效" },
  { id: "chime", name: "风铃", group: "好听的音效" },
  { id: "marimba", name: "木琴", group: "好听的音效" },
  { id: "rain", name: "下雨", group: "自然声" },
  { id: "leaves", name: "落叶", group: "自然声" },
  { id: "fire", name: "篝火", group: "自然声" },
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wet: GainNode | null = null;
let volume = 0.6;
let pack: SoundPack = "typewriter";
let ambientOn = true;

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}
export function setSound(p: { soundPack?: string; ambient?: boolean }): void {
  if (p.soundPack && SOUND_PACKS.some((s) => s.id === p.soundPack)) {
    if (p.soundPack !== pack) stopAmbient(true);
    pack = p.soundPack as SoundPack;
  }
  if (typeof p.ambient === "boolean") { ambientOn = p.ambient; if (!ambientOn) stopAmbient(); }
}

/** Audio graph: sources -> (dry) master, and -> reverb -> master, for the musical packs. */
function ac(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.2, 3.2);
  wet = ctx.createGain(); wet.gain.value = 0.32;
  wet.connect(verb).connect(master);
  return ctx;
}
function impulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return b;
}
const out = (reverb = 0): AudioNode => {
  ac();
  if (!reverb) return master!;
  const g = ctx!.createGain(); g.gain.value = 1;
  g.connect(master!);
  const s = ctx!.createGain(); s.gain.value = reverb; g.connect(s).connect(wet!);
  return g;
};

// ------------------------------------------------------------------ primitives
function noise(dur: number, freq: number, q: number, gain: number, opts: { type?: BiquadFilterType; at?: number; shape?: number; dest?: AudioNode } = {}): void {
  if (volume <= 0) return;
  const c = ac();
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  const k = opts.shape ?? 4;
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** k;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = opts.type ?? "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(opts.dest ?? out());
  src.start(c.currentTime + (opts.at ?? 0));
}

/** A decaying partial. */
function partial(freq: number, dur: number, gain: number, opts: { type?: OscillatorType; at?: number; attack?: number; dest?: AudioNode; glideTo?: number; glide?: number } = {}): void {
  if (volume <= 0) return;
  const c = ac();
  const t = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator(); o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t);
  if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, t + (opts.glide ?? 0.05));
  const g = c.createGain();
  const a = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  o.connect(g).connect(opts.dest ?? out());
  o.start(t); o.stop(t + a + dur + 0.05);
}
const tone = (freq: number, dur: number, gain: number) => partial(freq, dur, gain, { attack: 0.002 });

// the same letter always gives the same note: a major pentatonic over three octaves
const PENTA = [0, 2, 4, 7, 9];
function noteFor(ch: string, base = 261.63, octaves = 3): number {
  const code = ch.codePointAt(0) ?? 65;
  const i = (code * 7) % (PENTA.length * octaves);
  return base * 2 ** ((PENTA[i % PENTA.length] + 12 * Math.floor(i / PENTA.length)) / 12);
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ instruments
const piano = (f: number, gain = 0.22, at = 0) => {
  const d = out(0.9);
  partial(f, 1.6, gain, { at, dest: d, attack: 0.003 });
  partial(f * 2, 0.7, gain * 0.28, { at, dest: d, attack: 0.003 });
  partial(f * 3, 0.35, gain * 0.08, { at, dest: d, attack: 0.003 });
  noise(0.012, 3000, 1, gain * 0.25, { at, dest: d });          // hammer
};
const musicBox = (f: number, gain = 0.16) => {
  const d = out(1);
  partial(f, 1.1, gain, { type: "triangle", dest: d, attack: 0.002 });
  partial(f * 4.0, 0.25, gain * 0.15, { dest: d, attack: 0.001 });
};
const drop = (f: number, gain = 0.28) => {
  const d = out(0.8);
  partial(f * 0.55, 0.16, gain, { dest: d, glideTo: f * 1.5, glide: 0.06, attack: 0.002 });   // the rising "bloop"
  partial(f * 2.2, 0.05, gain * 0.15, { dest: d, at: 0.012, attack: 0.001 });
};
const chime = (f: number, gain = 0.12) => {
  const d = out(1);
  for (const [r, g, dur] of [[1, 1, 2.6], [2.76, 0.45, 1.6], [5.4, 0.22, 0.9], [8.93, 0.1, 0.5]] as const)
    partial(f * r, dur, gain * g, { dest: d, attack: 0.002 });
};
const marimba = (f: number, gain = 0.3) => {
  const d = out(0.5);
  partial(f, 0.55, gain, { dest: d, attack: 0.002 });
  partial(f * 4, 0.12, gain * 0.35, { dest: d, attack: 0.001 });
  partial(f * 10, 0.03, gain * 0.1, { dest: d, attack: 0.001 });
  noise(0.01, 900, 1.5, gain * 0.3, { dest: d });                // mallet
};
const raindrop = (gain = 0.25) => {
  const d = out(0.6);
  const f = rnd(1800, 4200);
  partial(f, 0.05, gain, { dest: d, glideTo: f * 1.35, glide: 0.03, attack: 0.001 });
  noise(0.012, 6000, 1, gain * 0.35, { dest: d, type: "highpass" });
};
const leaf = (gain = 0.5) => {
  const d = out(0.25);
  const n = 5 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) noise(rnd(0.008, 0.02), rnd(2500, 7000), rnd(1, 3), gain * rnd(0.3, 1), { dest: d, at: i * rnd(0.007, 0.02), shape: 2 });
};
const crackle = (gain = 0.6) => {
  const d = out(0.2);
  noise(0.006, rnd(2500, 5000), 0.8, gain, { dest: d, type: "highpass", shape: 1 });
  if (Math.random() < 0.6) noise(0.05, rnd(120, 220), 1, gain * 0.6, { dest: d, at: 0.004 });
  if (Math.random() < 0.4) noise(0.004, rnd(3000, 6000), 1, gain * 0.5, { dest: d, at: rnd(0.02, 0.06), type: "highpass", shape: 1 });
};

// ------------------------------------------------------------------ ambient beds (nature packs)
let amb: { stop: (fast?: boolean) => void } | null = null;
let ambTimer = 0;
function loopNoise(c: AudioContext, seconds: number, color: "pink" | "brown"): AudioBufferSourceNode {
  const len = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "pink") { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 2.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
  }
  const s = c.createBufferSource(); s.buffer = b; s.loop = true;
  return s;
}
function startAmbient(): void {
  if (!ambientOn || volume <= 0 || amb) return;
  if (pack !== "rain" && pack !== "leaves" && pack !== "fire") return;
  const c = ac();
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.2);
  g.connect(master!);
  const src = loopNoise(c, 4, pack === "fire" ? "brown" : "pink");
  const f = c.createBiquadFilter();
  const lvl = c.createGain();
  let extra = 0;
  if (pack === "rain") { f.type = "lowpass"; f.frequency.value = 2600; lvl.gain.value = 0.16; }
  if (pack === "leaves") {   // soft wind with slow gusts
    f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 0.6; lvl.gain.value = 0.12;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 0.07;
    lfo.connect(lg).connect(lvl.gain); lfo.start();
  }
  if (pack === "fire") {     // low roar + random pops
    f.type = "lowpass"; f.frequency.value = 380; lvl.gain.value = 0.22;
    extra = window.setInterval(() => { if (Math.random() < 0.55) crackle(rnd(0.08, 0.25)); }, 140);
  }
  src.connect(f).connect(lvl).connect(g); src.start();
  amb = {
    stop: (fast) => {
      const t = c.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (fast ? 0.2 : 2.5));
      src.stop(t + (fast ? 0.25 : 2.6));
      if (extra) window.clearInterval(extra);
      amb = null;
    },
  };
}
function stopAmbient(fast = false): void { amb?.stop(fast); }
/** keep the ambient bed alive while typing; fade out 4 s after the last key */
function touchAmbient(): void {
  startAmbient();
  window.clearTimeout(ambTimer);
  ambTimer = window.setTimeout(() => stopAmbient(), 4000);
}

// ------------------------------------------------------------------ what each pack does for a key / space / bell / return
type Voice = { key: (ch: string) => void; space: () => void; recv: (ch: string) => void; bell: () => void; ret: () => void };
const mech = {
  clack: () => { noise(0.045, 1700 + Math.random() * 700, 1.2, 1.0); noise(0.02, 300, 1, 0.4); },
  soft: () => noise(0.03, 1400, 1, 0.4),
  tick: () => noise(0.028, 3000 + Math.random() * 500, 2, 0.35),
  ding: () => { tone(2093, 0.9, 0.22); tone(4186, 0.5, 0.06); },
};
const C4 = 261.63;
const VOICES: Record<SoundPack, Voice> = {
  typewriter: { key: () => mech.clack(), space: () => mech.soft(), recv: () => mech.tick(), bell: () => mech.ding(), ret: () => {} },
  music: {
    key: (ch) => piano(noteFor(ch, C4)), space: () => { piano(C4 / 2, 0.12); piano(C4 * 0.75, 0.09); },
    recv: (ch) => musicBox(noteFor(ch, C4 * 2, 2)), bell: () => [1, 1.25, 1.5, 2].forEach((r, i) => piano(C4 * 2 * r, 0.14, i * 0.07)),
    ret: () => { piano(C4 / 2, 0.14); piano(C4 * 0.75, 0.1); piano(C4, 0.1); },
  },
  drop: { key: (ch) => drop(noteFor(ch, 440, 2)), space: () => drop(330, 0.18), recv: (ch) => drop(noteFor(ch, 660, 2), 0.16), bell: () => [0, 0.09, 0.18].forEach((t, i) => setTimeout(() => drop(880 * 1.25 ** i, 0.2), t * 1000)), ret: () => drop(260, 0.25) },
  chime: { key: (ch) => chime(noteFor(ch, 784, 2)), space: () => chime(523, 0.07), recv: (ch) => chime(noteFor(ch, 1046, 2), 0.07), bell: () => [0, 0.12, 0.24, 0.36].forEach((t, i) => setTimeout(() => chime(1046 * [1, 1.125, 1.25, 1.5][i], 0.09), t * 1000)), ret: () => chime(392, 0.1) },
  marimba: { key: (ch) => marimba(noteFor(ch, C4, 2)), space: () => marimba(C4 / 2, 0.22), recv: (ch) => marimba(noteFor(ch, C4 * 2, 2), 0.18), bell: () => [1, 1.25, 1.5].forEach((r, i) => setTimeout(() => marimba(C4 * 2 * r, 0.22), i * 80)), ret: () => { marimba(C4 / 2, 0.25); setTimeout(() => marimba(C4 * 0.75, 0.2), 70); } },
  rain: { key: () => { raindrop(); touchAmbient(); }, space: () => { raindrop(0.12); touchAmbient(); }, recv: () => raindrop(0.15), bell: () => { for (let i = 0; i < 8; i++) setTimeout(() => raindrop(0.18), i * rnd(30, 70)); }, ret: () => { for (let i = 0; i < 4; i++) setTimeout(() => raindrop(0.2), i * 40); touchAmbient(); } },
  leaves: { key: () => { leaf(); touchAmbient(); }, space: () => { leaf(0.25); touchAmbient(); }, recv: () => leaf(0.3), bell: () => { for (let i = 0; i < 5; i++) setTimeout(() => leaf(0.4), i * 70); }, ret: () => { leaf(0.7); touchAmbient(); } },
  fire: { key: () => { crackle(); touchAmbient(); }, space: () => { crackle(0.3); touchAmbient(); }, recv: () => crackle(0.35), bell: () => { for (let i = 0; i < 5; i++) setTimeout(() => crackle(0.5), i * rnd(40, 90)); }, ret: () => { noise(0.25, 200, 0.7, 0.4); touchAmbient(); } },
};
const v = () => VOICES[pack];

export const sfx = {
  /** a typed character (pack sound) */
  key: (ch: string) => (ch === " " ? v().space() : v().key(ch)),
  /** a character appearing on the receiver's sheet */
  recv: (ch: string) => v().recv(ch),
  clack: () => v().key("K"),                                                         // generic key press (friend key, IME)
  soft: () => (pack === "typewriter" ? mech.soft() : v().space()),                   // backspace / space
  tick: () => v().recv("a"),
  feed: () => noise(0.12, 520, 0.8, 0.7),                                            // paper step
  ding: () => v().bell(),                                                            // margin bell
  tear: () => noise(0.32, 2600, 0.5, 0.75),
  crumple: () => { for (let i = 0; i < 6; i++) setTimeout(() => noise(0.06, 1200 + Math.random() * 2200, 1, 0.5), i * 45); },
  drop: () => noise(0.12, 260, 0.9, 0.8),
  ratchet: () => { if (pack === "typewriter") for (let i = 0; i < 3; i++) setTimeout(() => noise(0.03, 2200 + i * 300, 2, 0.5), i * 28); }, // platen line-space ratchet
  thunk: () => (pack === "typewriter" ? (noise(0.14, 180, 0.7, 1.0), noise(0.05, 1400, 1, 0.35)) : v().ret()),  // carriage return
  alert: () => { tone(1318, 0.14, 0.18); setTimeout(() => tone(1760, 0.24, 0.18), 120); },
  /** the note reached the friend: a small bright two-note chime */
  delivered: () => { const d = out(0.8); partial(1174.7, 0.5, 0.16, { dest: d }); setTimeout(() => { partial(1568, 0.9, 0.16, { dest: d }); partial(3136, 0.4, 0.03, { dest: d }); }, 130); },
  /** saved for later (friend offline): one soft low note */
  queued: () => { const d = out(0.8); partial(784, 0.8, 0.13, { dest: d }); },
  /** a short phrase to audition a pack in the settings */
  preview: (p: SoundPack) => {
    const keep = pack; pack = p;
    "hello".split("").forEach((ch, i) => setTimeout(() => { const k = pack; pack = p; sfx.key(ch); pack = k; }, i * 150));
    setTimeout(() => { const k = pack; pack = p; v().bell(); pack = k; }, 800);
    pack = keep;
    if (p === "rain" || p === "leaves" || p === "fire") {
      const k = pack; pack = p; touchAmbient(); pack = k;
    }
  },
};
