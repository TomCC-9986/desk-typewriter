/**
 * Real-time 3D manual typewriter (three.js), built from primitives.
 * Mechanics follow a real portable:
 *  - a key press drives its type bar up out of the semicircular basket to the printing point;
 *  - the escapement then lets the carriage (platen, paper, knobs, lever) jump one space LEFT;
 *  - the carriage-return lever swings, the carriage slams back right and the platen ratchets one line,
 *    rolling the paper up around the platen;
 *  - backspace steps the carriage one space right.
 * Units are metres; +y up, +z towards the typist.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import modelBytes from "./model/typewriter.glb";

/** Product-studio light for reflections: dim warm-grey room, big overhead softbox, key box front-left, strip on the right
 *  (the reference sheet's long soft highlights on the enamel and chrome come from exactly this kind of setup). */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.MeshBasicMaterial({ color: 0x3b3631, side: THREE.BackSide }));   // dark room: crisp highlights
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x3a342e }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; env.add(floor);
  const box = (w: number, h: number, pos: [number, number, number], power: number, tint = 0xffffff) => {
    const c = new THREE.Color(tint).multiplyScalar(power);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0.1, 0); env.add(m);
  };
  box(3.0, 1.2, [0, 3.2, -1.2], 6, 0xfff5ea);    // overhead softbox: long highlight along the deck and roll
  box(1.6, 1.4, [-2.6, 2.2, 1.2], 6, 0xfff1e2); // key box front-left
  box(0.25, 2.6, [2.6, 1.2, 0.8], 7);           // narrow strip right: a sharp edge line on the right side
  box(0.25, 2.6, [-2.8, 1.0, -0.6], 5);         // narrow strip left-back: edge line on the left
  box(2.6, 0.5, [0, 0.4, 3.2], 2.2);            // low front fill: lifts the keyboard, draws a line on the front lip
  return env;
}

/** Tune the exported materials for real-time studio light. */
function studioMaterial(src: THREE.MeshStandardMaterial): THREE.Material {
  const name = src.name;
  if (name === "enamel_baked" || name === "mint_part" || name === "mint") {
    // painted pressed steel: glossy clear coat over the paint, bare steel where it is chipped (baked metalness mask)
    return new THREE.MeshPhysicalMaterial({
      map: src.map, color: src.color, name,
      metalness: src.metalnessMap ? 1 : 0, metalnessMap: src.metalnessMap ?? null,
      roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.32, envMapIntensity: 0.85,
    });
  }
  if (name === "tray" || name === "well") { src.color.set(0x2a2119); src.roughness = 0.85; src.envMapIntensity = 0.3; }   // dark oily brown, levers stay readable
  if (name === "chrome") { src.roughness = Math.min(src.roughness, 0.14); src.metalness = 1; src.envMapIntensity = 1.5; }
  if (name === "steel" || name === "typebar") { src.metalness = 1; src.roughness = Math.min(src.roughness, 0.3); }
  if (name === "cream") { src.roughness = 0.38; }
  return src;
}
import { charWidth } from "../../lib/layout";

export interface PaperCell { ch: string; struck: boolean; i: number }

// ---------- dimensions ----------
export const COLS = 24;            // width units per line (CJK = 2)
const PITCH = 0.0052;              // carriage step per width unit
const LINE = PITCH * 28 / 9.9;     // line height, same proportion as the 2D paper
const TEXT_W = COLS * PITCH;
const PAPER_W = 0.17;
const PAPER_LEN = 0.8;            // long sheet: room for ~50 lines
const TOP_MARGIN = 0.016;
const PAPER_PX = 1536;             // texture width: ~9 px/mm so the type stays crisp when the machine is shown large
const PX_PER_M = PAPER_PX / PAPER_W;

// platen geometry comes from the Blender model (empties "platen_axis" and "print_point")
let PLATEN_C = new THREE.Vector3(0, 0.146, -0.112);
let PLATEN_R = 0.0205;
let PRINT_PHI = THREE.MathUtils.degToRad(-8);
let LEAVE_PHI = THREE.MathUtils.degToRad(12);
const SHEET_LEAN = THREE.MathUtils.degToRad(15);   // standing sheet's lean back from vertical
const START_PHI = THREE.MathUtils.degToRad(-70);
let PAPER_R = PLATEN_R + 0.0007;
let PRINT_POINT = new THREE.Vector3();

const CAM_TARGET = new THREE.Vector3(-0.045, 0.17, -0.01);
const CAM_HOME = new THREE.Vector3(-0.2, 0.72, 1.46);
const SIGN_FACE = 0.42;            // desk sign yaw relative to the machine at rest

// ---------- palette ----------
const C = {
  mint: 0x7fa48d, cream: 0xe9dfc8, ink: 0x1d1b18, chrome: 0xd8d8d8, steel: 0x8a8b8d,
  rubber: 0x141312, bakelite: 0x1a1918, well: 0x121110, orange: 0xc4512f, paper: 0xf6f1e6,
};

const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const easeOutBack = (x: number, k = 1.6) => 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2;

type Tween = { start: number; dur: number; fn: (k: number) => void; done?: () => void; cancelled?: boolean };

export class Typewriter3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private carriage = new THREE.Group();
  private rig = new THREE.Group();      // everything that turns when the user rotates the machine
  private platen!: THREE.Mesh;
  private lever!: THREE.Group;
  private paper!: THREE.Mesh;
  private paperCanvas = document.createElement("canvas");
  private paperTex: THREE.CanvasTexture;
  private keys = new Map<string, THREE.Object3D>();
  private bars: { mesh: THREE.Object3D; rest: THREE.Quaternion; hit: THREE.Quaternion }[] = [];
  private ribbon!: THREE.Mesh;
  private tweens: Tween[] = [];
  private platenBase = new THREE.Quaternion();
  private leverBase = new THREE.Quaternion();
  private platenAngle = 0;
  private loaded = false;
  private barFlight: { bar: { mesh: THREE.Object3D; rest: THREE.Quaternion; hit: THREE.Quaternion }; resolve: () => void; tween: Tween } | null = null;
  ready: Promise<void>;
  private running = false;
  private feed = TOP_MARGIN;        // metres of paper past the printing point
  private carriageX = TEXT_W / 2;
  private paperLift = 0;            // used when the sheet is pulled out

  /** head: px of empty canvas above the machine frame (room for the standing sheet); the framing is unchanged. */
  /** modelUrl: load a (meshopt-compressed) model from the web instead of the bundled one (the download site). */
  constructor(width: number, height: number, head = 0, private modelUrl?: string) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
    this.scene.environmentIntensity = 0.75;

    // the original 22 deg view of the frame (height - head) sits at the bottom of a taller canvas: render a window
    // [0, height] of a virtual image centred on the frame's centre
    this.camera = new THREE.PerspectiveCamera(22, 1, 0.05, 10);
    this.frame(width, height, head);
    this.camera.position.set(-0.2, 0.72, 1.46);
    this.camera.lookAt(CAM_TARGET);

    this.paperCanvas.width = PAPER_PX;
    this.paperCanvas.height = Math.round(PAPER_LEN * PX_PER_M);
    this.paperTex = new THREE.CanvasTexture(this.paperCanvas);
    this.paperTex.colorSpace = THREE.SRGBColorSpace;
    this.paperTex.flipY = false;
    this.paperTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();   // the upper sheet leans back: sharp at grazing angles

    this.lights();
    this.rig.add(this.carriage);
    this.scene.add(this.rig);
    this.drawPaper([]);
    this.buildSign();
    this.ready = this.load();
  }

  // ======================================================== building
  private add(mesh: THREE.Mesh, parent: THREE.Object3D = this.scene): THREE.Mesh {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private lights(): void {
    const key = new THREE.DirectionalLight(0xfff1df, 1.5); // near-neutral warm white: the model colours are calibrated to neutral light (refs/三视图.jpg)
    key.position.set(-0.6, 1.1, 0.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -0.35; key.shadow.camera.right = 0.35;
    key.shadow.camera.top = 0.35; key.shadow.camera.bottom = -0.35;
    key.shadow.radius = 10;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.002;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff3e6, 0.3);
    fill.position.set(0.8, 0.4, 0.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xcfdcff, 0.45); // cool window light from behind
    rim.position.set(0.2, 0.6, -0.9);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** Load the Blender model and pick out the moving parts by name. */
  /** Size the canvas; the 22 deg view of the frame (height - head) sits at the bottom, with head px of headroom above. */
  private vw = 860; private vh = 680; private vhead = 0;
  private frame(width: number, height: number, head: number): void {
    this.vw = width; this.vh = height; this.vhead = head;
    const frameH = height - head, centreY = head + frameH / 2, fullH = 2 * centreY;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(11)) / this.zoom * fullH / frameH));
    this.camera.aspect = width / fullH;
    if (head || this.lift || this.shiftX) this.camera.setViewOffset(width, fullH, this.shiftX, this.lift, width, height); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  private floorMat = new THREE.ShadowMaterial({ opacity: 0.22 });
  /** Studio look for the product page: the key light from straight above, so the shadow sits softly under the machine. */
  studioShadow(opacity = 0.16): void {
    this.floorMat.opacity = opacity;
    this.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && l.castShadow) { l.position.set(-0.25, 1.4, 0.45); l.shadow.radius = 22; }
    });
  }
  /** Hide the desk sign (the product page shows the machine alone). */
  showSign(v: boolean): void { this.sign.visible = v; for (const m of this.signMeshes) m.visible = v; }
  /** px the picture is shifted up / left (product page framing). */
  lift = 0;
  shiftX = 0;
  /** Re-apply zoom / lift / shift without resizing the renderer (cheap: for per-frame scroll animation). */
  reframe(): void { this.frame(this.vw, this.vh, this.vhead); }
  /** Canvas-relative screen rectangle of the machine (visible meshes, not the sheet). */
  screenBox(): { x: number; y: number; w: number; h: number } {
    this.camera.updateMatrixWorld(); this.rig.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3(), w = this.vw, h = this.vh;
    this.rig.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m === this.paper) return;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
        v.set(cx, cy, cz).applyMatrix4(m.matrixWorld).project(this.camera);
        const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /** Zoom and shift so the machine's screen box is h px tall and centred on (cx, cy). */
  frameTo(cx: number, cy: number, h: number): void {
    for (let i = 0; i < 4; i++) {
      const b = this.screenBox();
      if (b.h > 1) this.zoom *= h / b.h;
      this.reframe();
      const c = this.screenBox();
      this.shiftX += c.x + c.w / 2 - cx; this.lift += c.y + c.h / 2 - cy;
      this.reframe();
    }
  }
  /** >1 frames the machine tighter (the product page shows it large). */
  zoom = 1;
  setPixelRatio(r: number): void { this.renderer.setPixelRatio(r); }
  /** Resize the canvas (web page layout). */
  resize(width: number, height: number, head = 0): void {
    this.renderer.setSize(width, height);
    this.frame(width, height, head);
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let buf: ArrayBuffer;
    if (this.modelUrl) buf = await (await fetch(this.modelUrl)).arrayBuffer();
    else { const bytes = modelBytes as Uint8Array; buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
    const gltf = await loader.parseAsync(buf, "");
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.material = studioMaterial(m.material as THREE.MeshStandardMaterial); }
    });
    this.rig.add(model);
    model.updateMatrixWorld(true);
    const node = (n: string) => model.getObjectByName(n);
    const world = (n: string) => node(n)!.getWorldPosition(new THREE.Vector3());

    PLATEN_C = world("platen_axis");
    PLATEN_R = node("platen_axis")!.scale.x || PLATEN_R;
    PAPER_R = PLATEN_R + 0.0007;
    PRINT_POINT = world("print_point");
    // print a little above the platen's equator so the typist can see the fresh line
    // the platen sits low behind the housing (refs/三视图.jpg): strike high on its front so the fresh line clears the deck
    PRINT_PHI = THREE.MathUtils.degToRad(32);
    PRINT_POINT = new THREE.Vector3(0, PLATEN_C.y + Math.sin(PRINT_PHI) * PAPER_R, PLATEN_C.z + Math.cos(PRINT_PHI) * PAPER_R);
    LEAVE_PHI = PRINT_PHI + THREE.MathUtils.degToRad(4);   // sheet leans back ~30 deg like the side view

    // re-parent the carriage parts under our own group so we can slide it
    const car = node("carriage")!;
    this.platen = node("platen") as THREE.Mesh;
    this.platenBase = this.platen.quaternion.clone();
    this.lever = node("lever") as THREE.Group;
    this.leverBase = this.lever.quaternion.clone();
    this.ribbon = node("ribbon") as THREE.Mesh;
    this.ribbon.position.y -= 0.009;                  // ribbon vibrator rests below the printing line
    const guide = node("type_guide");
    if (guide) guide.position.y -= 0.008;
    // paper bail sits higher up the sheet so the line just typed stays in view
    car.traverse((o) => {
      if (o.name.startsWith("bail")) { o.position.y += 0.012; o.position.z -= 0.006; }
      if (o.name === "scale") { o.position.y -= 0.016; o.position.z += 0.004; } // margin scale below the printing line
    });
    this.carriage.add(car); // after looking up its children: they leave `model` with it
    model.traverse((o) => {
      if (o.name.startsWith("key_")) this.keys.set(o.name.slice(4), o as THREE.Group);
    });
    for (let i = 0; i < 36; i++) {
      const bar = node(`bar_${String(i).padStart(2, "0")}`);
      const mesh = node(`barmesh_${String(i).padStart(2, "0")}`);
      if (!bar || !mesh) continue;
      const pivot = bar.getWorldPosition(new THREE.Vector3());
      const restDir = mesh.getWorldPosition(new THREE.Vector3()).sub(pivot).normalize();
      const target = PRINT_POINT.clone().add(new THREE.Vector3(0, Math.sin(PRINT_PHI), Math.cos(PRINT_PHI)).multiplyScalar(0.003)); // stop just short of the paper
      const hitDir = target.sub(pivot).normalize();
      const rest = bar.quaternion.clone();
      const hit = new THREE.Quaternion().setFromUnitVectors(restDir, hitDir).multiply(rest);
      this.bars.push({ mesh: bar as unknown as THREE.Mesh, rest, hit });
    }

    // paper (geometry rebuilt from the feed position)
    // paper keeps its contrast: no tone-map squash, a touch of self-light so the sheet leaning back away from the key light
    // doesn't go grey, and a sharper mip choice (-0.6 LOD) for the text seen at an angle
    // lit like real paper; a little sheen-free self light only so the standing sheet's back-lit side isn't muddy
    const mat = new THREE.MeshStandardMaterial({ map: this.paperTex, roughness: 0.95, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveMap: this.paperTex, emissiveIntensity: 0.08 });
    mat.onBeforeCompile = (sh) => {   // slightly sharper mip choice for the text
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>",
        "#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, -0.4 );\n#endif");
    };
    this.paper = this.add(new THREE.Mesh(new THREE.BufferGeometry(), mat), this.carriage);
    this.loaded = true;
    this.applyCarriage();
  }

  // ======================================================== paper path (in carriage space)
  private arcLen(phi: number): number { return (phi - START_PHI) * PAPER_R; }

  /** Point + tangent along the paper path at arc length s (around the platen, then straight up). */
  private pathPoint(s: number): { p: THREE.Vector3; n: THREE.Vector3 } {
    const arcEnd = this.arcLen(LEAVE_PHI);
    if (s <= arcEnd) {
      const phi = START_PHI + s / PAPER_R;
      const p = new THREE.Vector3(0, PLATEN_C.y + Math.sin(phi) * PAPER_R, PLATEN_C.z + Math.cos(phi) * PAPER_R);
      return { p, n: new THREE.Vector3(0, Math.sin(phi), Math.cos(phi)) };
    }
    // after the platen the sheet bends smoothly (over BEND) from its exit angle to standing up with a slight lean, like a
    // real typewriter: a sheet lying far back is seen nearly edge-on and its text smears
    const base = new THREE.Vector3(0, PLATEN_C.y + Math.sin(LEAVE_PHI) * PAPER_R, PLATEN_C.z + Math.cos(LEAVE_PHI) * PAPER_R);
    const a0 = LEAVE_PHI, a1 = SHEET_LEAN, BEND = 0.02;   // angles of the tangent from vertical (tilting back)
    const d = s - arcEnd;
    const at = (a: number) => new THREE.Vector3(0, Math.cos(a), -Math.sin(a));
    const nrm = (a: number) => new THREE.Vector3(0, Math.sin(a), Math.cos(a));
    const k = BEND / (a1 - a0);
    const onBend = (t: number) => { const a = a0 + (a1 - a0) * t; return base.clone().add(new THREE.Vector3(0, k * (Math.sin(a) - Math.sin(a0)), k * (Math.cos(a) - Math.cos(a0)))); };
    if (d <= BEND) { const t = d / BEND; return { p: onBend(t), n: nrm(a0 + (a1 - a0) * t) }; }
    return { p: onBend(1).add(at(a1).multiplyScalar(d - BEND)), n: nrm(a1) };
  }

  private rebuildPaper(): void {
    const sPrint = this.arcLen(PRINT_PHI);
    const top = sPrint + this.feed + this.paperLift;        // where the paper's top edge is
    const bottom = Math.max(0, top - PAPER_LEN);
    const N = 90;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= N; j++) {
      const s = bottom + (top - bottom) * (j / N);
      const { p } = this.pathPoint(s);
      const v = (top - s) / PAPER_LEN;  // 0 = top edge of the sheet
      pos.push(-PAPER_W / 2, p.y, p.z, PAPER_W / 2, p.y, p.z);
      uv.push(0, v, 1, v);
      if (j) idx.push((j - 1) * 2, j * 2, (j - 1) * 2 + 1, (j - 1) * 2 + 1, j * 2, j * 2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.paper.geometry.dispose();
    this.paper.geometry = g;
  }

  /** Paint the typed rows onto the sheet. */
  private paperImg: HTMLImageElement | null = null;
  private lastRows: PaperCell[][] = [];
  /** The aged sheet from the reference photo (img/paper_aged.jpg), tiled down the long sheet with mirrored repeats. */
  private paperWaiters: (() => void)[] = [];
  private paperGround(g: CanvasRenderingContext2D, W: number, H: number, redraw?: () => void): void {
    if (!this.paperImg) {
      this.paperImg = new Image();
      this.paperImg.onload = () => { this.drawPaper(this.lastRows); for (const f of this.paperWaiters.splice(0)) f(); };
      this.paperImg.src = "img/paper_aged.jpg";
    }
    if (redraw && !this.paperImg.complete) this.paperWaiters.push(redraw);
    const im = this.paperImg;
    if (!im.complete || !im.naturalWidth) { g.fillStyle = "#e9cfab"; g.fillRect(0, 0, W, H); return; }
    const th = Math.round(im.naturalHeight * W / im.naturalWidth);
    for (let y = 0, i = 0; y < H; y += th, i++) {
      g.save();
      if (i % 2) { g.translate(0, y + th); g.scale(1, -1); g.drawImage(im, 0, 0, W, th); }
      else g.drawImage(im, 0, y, W, th);
      g.restore();
    }
  }

  drawPaper(rows: PaperCell[][]): void {
    this.lastRows = rows;
    const g = this.paperCanvas.getContext("2d")!;
    const W = this.paperCanvas.width, H = this.paperCanvas.height;
    this.paperGround(g, W, H, () => this.drawPaper(this.lastRows));
    g.globalCompositeOperation = "multiply";   // ink sits in the paper: its mottling shows through
    const left = (PAPER_W - TEXT_W) / 2 * PX_PER_M;
    const pitch = PITCH * PX_PER_M, line = LINE * PX_PER_M;
    const size = pitch * 18 / 9.9; // same em/unit ratio as the 2D paper
    g.textBaseline = "alphabetic";
    g.textAlign = "center";
    rows.forEach((row, r) => {
      let u = 0;
      const baseY = TOP_MARGIN * PX_PER_M + r * line;
      for (const c of row) {
        const w = charWidth(c.ch);
        const cx = left + (u + w / 2) * pitch;
        if (c.ch !== " ") {
          g.save();
          g.translate(cx, baseY + (rnd(c.i, 2) - 0.5) * 2);
          g.rotate((rnd(c.i, 1) - 0.5) * 0.05);
          g.globalAlpha = 0.86 + rnd(c.i, 3) * 0.14;         // ribbon variation, but never grey
          g.fillStyle = "#1a120b";
          g.font = `${Math.round(size)}px "American Typewriter", "Courier New", "Songti SC", "STSong", serif`;
          g.fillText(c.ch, 0, 0);
          g.lineWidth = size * 0.03; g.strokeStyle = "#1a120b"; g.lineJoin = "round";
          g.strokeText(c.ch, 0, 0);                          // a hair of ink spread: solid strokes, readable when shown small
          if (c.struck) { // overstrike, like a real backspace + "/"
            g.globalAlpha = 0.85;
            g.lineWidth = size * 0.12;
            g.strokeStyle = "#1f1c18";
            g.beginPath(); g.moveTo(-w * pitch * 0.45, -size * 0.3); g.lineTo(w * pitch * 0.45, -size * 1.2); g.stroke();
          }
          g.restore();
        }
        u += w;
      }
    });
    g.globalCompositeOperation = "source-over";
    this.paperTex.needsUpdate = true;
  }

  // ======================================================== state → pose
  private applyCarriage(): void {
    if (!this.loaded) return;
    this.carriage.position.x = this.carriageX;
    this.platen.quaternion.copy(this.platenBase).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.platenAngle));
    this.rebuildPaper();
  }

  private setLever(angle: number): void {
    this.lever.quaternion.copy(this.leverBase).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
  }

  private targetX(col: number): number { return TEXT_W / 2 - col * PITCH; }
  private targetFeed(row: number): number { return TOP_MARGIN + row * LINE; }

  /** Jump without animation (e.g. when a draft is restored). */
  setPosition(row: number, col: number): void {
    this.carriageX = this.targetX(col);
    this.feed = this.targetFeed(row);
    this.paperLift = 0;
    this.platenAngle = -this.feed / PLATEN_R;
    this.applyCarriage();
  }

  /** Escapement: carriage jumps to `col` (one space per unit) with a tiny settle. */
  step(col: number): void {
    const from = this.carriageX, to = this.targetX(col);
    this.tween(55, (k) => { this.carriageX = from + (to - from) * easeOutBack(k, 2.2); this.applyCarriage(); });
  }

  /** Carriage return + line feed: lever swings, platen ratchets, carriage slams back. */
  carriageReturn(row: number, col = 0): Promise<void> {
    const fromX = this.carriageX, toX = this.targetX(col);
    const fromF = this.feed, toF = this.targetFeed(row);
    const rot0 = this.platenAngle;
    return new Promise((resolve) => {
      this.tween(120, (k) => { if (this.loaded) this.setLever(-0.5 * Math.sin(k * Math.PI)); });
      this.tween(110, (k) => {
        const e = 1 - (1 - k) ** 2;
        this.feed = fromF + (toF - fromF) * e;
        this.platenAngle = rot0 - ((toF - fromF) / PLATEN_R) * e;
        this.applyCarriage();
      });
      this.tween(330, (k) => {
        const e = k < 0.85 ? (k / 0.85) ** 2 : 1 + Math.sin((k - 0.85) / 0.15 * Math.PI) * -0.012;
        this.carriageX = fromX + (toX - fromX) * Math.min(1.0, e);
        this.applyCarriage();
      }, () => { this.carriageX = toX; this.applyCarriage(); resolve(); });
    });
  }

  /** Key goes down, its type bar flies to the printing point. Resolves at the moment of impact. */
  /** Just push a key down (no type bar): pinyin keystrokes while the IME is composing. */
  pressKey(letter: string): void {
    if (!this.loaded) return;
    const key = this.keys.get(letter.toUpperCase());
    if (!key) return;
    const y0 = key.userData.y0 ?? (key.userData.y0 = key.position.y);
    this.tween(110, (k) => { key.position.y = y0 - 0.0035 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * (k < 0.6 ? 1 : (1 - k) / 0.4); });
  }

  strike(ch: string, withBar = true): Promise<void> {
    if (!this.loaded) return Promise.resolve();
    const keyName = ch === " " ? "space" : this.keys.has(ch.toUpperCase()) ? ch.toUpperCase() : this.randomKey(ch);
    const key = this.keys.get(keyName)!;
    const y0 = key.userData.y0 ?? (key.userData.y0 = key.position.y);
    this.tween(110, (k) => { key.position.y = y0 - 0.0035 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * (k < 0.6 ? 1 : (1 - k) / 0.4); });
    if (!withBar || ch === " ") return new Promise((r) => setTimeout(r, 30));
    const bar = this.bars[((ch.codePointAt(0) ?? 0) * 7) % this.bars.length];
    const ry = this.ribbon.userData.y0 ?? (this.ribbon.userData.y0 = this.ribbon.position.y);
    // a new key press parks whatever bar is still in the air
    if (this.barFlight) {
      this.barFlight.tween.cancelled = true;
      this.barFlight.bar.mesh.quaternion.copy(this.barFlight.bar.rest);
      this.barFlight.resolve();
    }
    return new Promise((resolve) => {
      let hit = false;
      const flight = { bar, resolve: () => { if (!hit) { hit = true; resolve(); } }, tween: null as unknown as Tween };
      flight.tween = this.tween(110, (k) => {
        const up = k < 0.4 ? (k / 0.4) ** 1.6 : 1 - ((k - 0.4) / 0.6) ** 0.8;
        bar.mesh.quaternion.slerpQuaternions(bar.rest, bar.hit, up);
        this.ribbon.position.y = ry + 0.016 * up;     // ribbon lifts over the printing point only while striking
        if (k >= 0.4) flight.resolve();
      }, () => { bar.mesh.quaternion.copy(bar.rest); this.ribbon.position.y = ry; if (this.barFlight === flight) this.barFlight = null; });
      this.barFlight = flight;
    });
  }

  private randomKey(ch: string): string {
    const names = [...this.keys.keys()].filter((n) => n.length === 1);
    return names[(ch.codePointAt(0) ?? 0) % names.length];
  }

  /** Roll the sheet up and out of the machine (sending). */
  pullOut(): Promise<void> {
    const from = this.paperLift;
    return new Promise((resolve) => this.tween(520, (k) => {
      this.paperLift = from + 0.3 * k * k;
      this.platenAngle -= 0.12;
      this.applyCarriage();
    }, resolve));
  }

  /** A fresh sheet rolls in to the top margin. */
  feedNewSheet(): void {
    this.paperLift = 0;
    this.carriageX = this.targetX(0);
    this.feed = -0.05;
    this.applyCarriage();
    const to = this.targetFeed(0);
    this.tween(420, (k) => { this.feed = -0.05 + (to + 0.05) * (1 - (1 - k) ** 3); this.platenAngle = -this.feed / PLATEN_R; this.applyCarriage(); });
  }

  // ======================================================== desk sign (walnut base + paper card)
  private sign = new THREE.Group();
  private signCanvas = document.createElement("canvas");
  private signTex!: THREE.CanvasTexture;
  private signMeshes: THREE.Mesh[] = [];

  private signHolder: THREE.Group | null = null;
  /** The recipient object beside the machine: an airmail envelope standing in a little brass letter rack. */
  private buildSign(): void {
    const holder0 = new THREE.Group();
    this.signCanvas.width = 1100; this.signCanvas.height = 712;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    this.signTex.anisotropy = 8;
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8925a, roughness: 0.32, metalness: 1 });
    const wire = (len: number) => new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, len, 10), brass);
    // rack: a flat brass foot and two bent wire hoops, one each side of the envelope
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.003, 0.034), brass); foot.position.y = 0.0015;
    const parts: THREE.Mesh[] = [foot];
    for (const z of [-0.011, 0.011]) for (const x of [-0.05, 0.05]) {
      const post = wire(0.016); post.position.set(x, 0.011, z); parts.push(post);
    }
    for (const z of [-0.011, 0.011]) { const bar = wire(0.1); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.019, z); parts.push(bar); }   // low: below the address
    const paperSide = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.85 });
    this.signHolder = holder0;
    const W = 0.2, H = W * 712 / 1100;
    const card = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.0016), [paperSide, paperSide, paperSide, paperSide, face, paperSide]);
    const holder = holder0;
    holder.position.set(0, 0.004, 0.002);
    holder.rotation.x = -0.16;                       // the envelope leans back in the rack
    card.position.y = H / 2;
    holder.add(card);
    for (const m of [...parts, card]) { m.castShadow = true; m.receiveShadow = true; this.signMeshes.push(m); }
    this.sign.add(...parts, holder);
    this.sign.position.set(-0.3, 0, -0.08);         // beside the machine's left flank
    this.sign.rotation.y = SIGN_FACE;                // turned toward the typist
    this.rig.add(this.sign);
    this.drawSign("", "");
  }


  /** Repaint the card: recipient name, a status line, the key hints. */
  private lastSign: [string, string] = ["", ""];
  drawSign(name: string, status: string): void {
    const g = this.signCanvas.getContext("2d")!;
    const W = this.signCanvas.width, H = this.signCanvas.height;
    this.lastSign = [name, status];
    this.paperGround(g, W, H, () => this.drawSign(...this.lastSign));   // same aged sheet as the paper in the machine
    const hand = '"Hannotate SC", "HanziPen SC", "Kaiti SC", "STKaiti", "KaiTi", serif';
    const sans = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    // airmail border: red / blue diagonal stripes
    const B = 30;
    g.save(); g.beginPath(); g.rect(0, 0, W, H); g.rect(B, B, W - 2 * B, H - 2 * B); g.clip("evenodd");
    for (let x = -H, k = 0; x < W + H; x += 44, k++) {
      g.fillStyle = k % 2 ? "rgba(41, 70, 132, .78)" : "rgba(176, 52, 40, .78)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 22, 0); g.lineTo(x + 22 - H, H); g.lineTo(x - H, H); g.fill();
    }
    g.restore();
    // stamp, top right: perforated edge, a little typewriter
    const sx = W - B - 190, sy = B + 34, sw = 150, sh = 178;
    g.fillStyle = "#f6efe0"; g.fillRect(sx, sy, sw, sh);
    g.fillStyle = "rgba(0,0,0,0)";
    g.save(); g.globalCompositeOperation = "destination-out";
    for (let x = sx; x <= sx + sw; x += 15) for (const y of [sy, sy + sh]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
    for (let y = sy; y <= sy + sh; y += 15) for (const x of [sx, sx + sw]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
    g.restore();
    g.fillStyle = "#8f9a7b"; g.fillRect(sx + 14, sy + 14, sw - 28, sh - 56);
    g.fillStyle = "#efe4c8"; g.fillRect(sx + 40, sy + 50, sw - 80, 30);              // typewriter: body
    g.fillStyle = "#3c3a35"; g.fillRect(sx + 34, sy + 42, sw - 68, 10);              // platen
    g.fillStyle = "#f4ead2"; g.fillRect(sx + 52, sy + 24, sw - 104, 20);             // sheet
    g.fillStyle = "#5f6a4f"; for (let i = 0; i < 4; i++) g.fillRect(sx + 46 + i * 15, sy + 88, 9, 7);
    g.fillStyle = "#4f5b45"; g.font = `600 26px ${sans}`; g.textAlign = "center"; g.fillText("中国 · 8分", sx + sw / 2, sy + sh - 16);
    // postmark: double circle + wavy cancel lines over the stamp's left edge
    g.strokeStyle = "rgba(40, 34, 28, .55)"; g.lineWidth = 4;
    const px = sx - 30, py = sy + 92;
    g.beginPath(); g.arc(px, py, 64, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(px, py, 48, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "rgba(40, 34, 28, .6)"; g.font = `600 22px ${sans}`; g.fillText("桌面打字机", px, py - 4); g.font = `20px ${sans}`; g.fillText("寄 出", px, py + 22);
    for (let j = 0; j < 4; j++) { g.beginPath(); for (let x = 0; x <= 200; x += 8) g.lineTo(px + 70 + x, py - 30 + j * 20 + Math.sin(x / 18) * 6); g.stroke(); }
    // address
    g.textAlign = "left";
    g.fillStyle = "#6b5a44"; g.font = `500 34px ${sans}`;
    g.fillText("寄 给", B + 70, H / 2 - 40);
    g.fillStyle = "#1e1812"; g.font = `150px ${hand}`;
    if (!name) { g.fillStyle = "rgba(60, 46, 30, .45)"; g.font = `86px ${hand}`; }
    g.fillText(name || "还没有收信人", B + 70, H / 2 + 100, W - 2 * B - 330);
    g.strokeStyle = "rgba(60, 46, 30, .4)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(B + 70, H / 2 + 130); g.lineTo(W - B - 260, H / 2 + 130); g.stroke();
    g.fillStyle = "#7a6650"; g.font = `30px ${sans}`;
    g.fillText(status || "点信封换人 ▾", B + 70, H / 2 + 180, W - 2 * B - 140);
    // rubber stamp once the note is through: red 已送达, or grey-blue 待投递 while the friend is offline
    const st = status.startsWith("已送达") ? ["已送达", "rgba(178, 40, 30, .85)"] : status.startsWith("对方离线") ? ["待投递", "rgba(52, 76, 120, .8)"] : null;
    if (st) {
      g.save(); g.translate(W - B - 250, H / 2 + 90); g.rotate(-0.18);
      g.strokeStyle = st[1]; g.fillStyle = st[1]; g.lineWidth = 9;
      g.beginPath(); g.roundRect(-150, -66, 300, 132, 18); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.roundRect(-136, -52, 272, 104, 12); g.stroke();
      g.font = `700 76px ${sans}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(st[0], 0, 4);
      g.restore(); g.textBaseline = "alphabetic";
    }
    // key hints along the bottom
    g.fillStyle = "rgba(60, 46, 30, .72)"; g.font = `26px ${sans}`;
    g.fillText("↵ 寄出    ⇧↵ 换行    esc 收起    右键拖 旋转", B + 70, H - B - 34);
    this.signTex.needsUpdate = true;
  }


  private raycaster = new THREE.Raycaster();

  /** Name of the key under the pointer ("A", "1", "space", "shiftL", …) or null. */
  keyAt(x: number, y: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    let best: { name: string; d: number } | null = null;
    for (const [name, key] of this.keys) {
      const hit = this.raycaster.intersectObject(key, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { name, d: hit.distance };
    }
    return best?.name ?? null;
  }

  /** Does a click hit the named key (e.g. "space")? Presses it if so. */
  hitKey(name: string, x: number, y: number): boolean {
    const key = this.keys.get(name);
    if (!key) return false;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (!this.raycaster.intersectObject(key, true).length) return false;
    const y0 = key.userData.y0 ?? (key.userData.y0 = key.position.y);
    this.tween(160, (k) => { key.position.y = y0 - 0.0035 * Math.sin(k * Math.PI); });
    return true;
  }

  /** Does a click at canvas-relative CSS px hit the desk sign? */
  hitSign(x: number, y: number): boolean {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(this.signMeshes, false).length > 0;
  }

  /** Screen rectangle covering the sign (for the click-through hit test). */
  signRect(): DOMRect {
    this.sign.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.sign);
    const r = this.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(cx, cy, cz).project(this.camera);
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return new DOMRect(x0, y0, x1 - x0, y1 - y0);
  }

  /** Screen quad (CSS px, TL TR BR BL) for a paper slip of w×h CSS px standing in the sign card's plane, just to its right,
   *  so a DOM menu can be warped onto it with matrix3d and share the scene's perspective. Sits on the card's left. */
  signSlipQuad(w: number, h: number): { x: number; y: number }[] {
    if (!this.signHolder) return [];
    this.sign.updateMatrixWorld(true);
    const M_PER_PX = 0.00072, r = this.canvas.getBoundingClientRect();
    const W = w * M_PER_PX, H = h * M_PER_PX;
    const x0 = -0.11 - W, y0 = 0.13, z = 0.012;   // left of the card (open desk), a little in front of it
    return [[x0, y0], [x0 + W, y0], [x0 + W, y0 - H], [x0, y0 - H]].map(([lx, ly]) => {
      const v = this.signHolder!.localToWorld(new THREE.Vector3(lx, ly, z)).project(this.camera);
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    });
  }

  /** Tilt the view up/down: the camera orbits the machine vertically (radians, clamped). */
  setPitch(pitch: number): number {
    const p = Math.max(-0.22, Math.min(0.5, pitch));
    const off = CAM_HOME.clone().sub(CAM_TARGET);
    const right = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0, 1, 0)).normalize();
    off.applyAxisAngle(right, -p);
    this.camera.position.copy(CAM_TARGET).add(off);
    this.camera.lookAt(CAM_TARGET);
    return p;
  }

  /** Turn the whole machine about the vertical axis (radians, clamped to ±45°). */
  setYaw(yaw: number): number {
    const y = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, yaw));
    this.rig.rotation.y = y;
    this.sign.rotation.y = SIGN_FACE - y * 0.6;      // the card keeps roughly facing the typist
    return y;
  }

  /** Smallest empty canvas space (CSS px) left/right of the machine + (visible) sign. */
  sideGap(): number {
    this.camera.updateMatrixWorld(); this.rig.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.rig.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh && o !== this.paper) box.expandByObject(o, false); });
    const w = this.canvas.clientWidth || 860;
    let l = Infinity, r = -Infinity;
    for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(cx, cy, cz).project(this.camera); const x = (v.x + 1) / 2 * w; l = Math.min(l, x); r = Math.max(r, x);
    }
    return Math.min(l, w - r);
  }
  /** Empty canvas space (CSS px) below the lowest visible point of machine + sign at the current angle. */
  bottomGap(): number {
    this.camera.updateMatrixWorld(); this.rig.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.rig.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) box.expandByObject(o, false); });
    const h = this.canvas.clientHeight || 680;
    let lowest = -Infinity;
    for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(cx, cy, cz).project(this.camera);
      lowest = Math.max(lowest, (1 - v.y) / 2 * h);
    }
    return Math.max(0, h - lowest - 4);
  }

  /** Screen position (CSS px within the canvas) of the printing point, for the IME window. */
  printPointOnScreen(): { x: number; y: number } {
    this.rig.updateMatrixWorld(true);
    const v = PRINT_POINT.clone().applyMatrix4(this.rig.matrixWorld).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  // ======================================================== loop
  private tween(dur: number, fn: (k: number) => void, done?: () => void): Tween {
    const t: Tween = { start: performance.now(), dur, fn, done };
    this.tweens.push(t);
    return t;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      for (const t of [...this.tweens]) {
        if (t.cancelled) { this.tweens.splice(this.tweens.indexOf(t), 1); continue; }
        const k = Math.min(1, (now - t.start) / t.dur);
        t.fn(k);
        if (k >= 1) { this.tweens.splice(this.tweens.indexOf(t), 1); t.done?.(); }
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; }
}
