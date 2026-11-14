/**
 * WebGL2 paper crumple that behaves like a soft sheet being squeezed by hand:
 * - the sheet (drawn from the DOM into a texture) is a dense grid;
 * - edges start folding before the centre;
 * - as the sheet is compressed its lost area is pushed into ridged multi-octave
 *   folds (sharp creases, soft surfaces), then it settles into an irregular ball;
 * - smooth per-vertex normals from finite differences, wrap diffuse, crease
 *   occlusion and a little translucency make it read as paper, not facets;
 * - two squeezes with a pause, and a tiny spring-back at the end.
 */
import { sfx } from "./sound";

const VS = `#version 300 es
precision highp float;
in vec2 aUV;
uniform float uT;
uniform vec2 uSize;
uniform float uR;
uniform float uSeed;
uniform float uSpin;
uniform float uPulse;
uniform mat4 uProj;
out vec2 vUV;
out vec3 vN;
out float vCrease;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// ridged fbm: sharp crease lines where the noise crosses its midpoint
float ridged(vec3 x) {
  float s = 0.0, a = 0.5;
  for (int o = 0; o < 4; o++) {
    float n = 1.0 - abs(vnoise(x) * 2.0 - 1.0);
    s += n * n * a;
    x = x * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

vec3 place(vec2 uv, float maxLen, out float crease) {
  vec2 p = (uv - 0.5) * uSize;
  vec2 q = p / maxLen;                                    // within the unit circle
  float d = clamp(length(q), 0.0, 1.0);                   // 0 centre .. 1 corner
  float tl = clamp(uT * 1.3 - (1.0 - d) * 0.3, 0.0, 1.0); // edges go first
  tl = tl * tl * (3.0 - 2.0 * tl);

  float sMin = uR * 1.25 / maxLen;
  float s = mix(1.0, sMin, tl);
  vec3 x = vec3(q * 3.2, uSeed);
  vec3 n = vec3(ridged(x), ridged(x + vec3(5.2, 1.3, 7.7)), ridged(x + vec3(2.8, 8.1, 4.4))) - 0.42;
  crease = n.z;
  float amp = maxLen * 0.3 * pow(max(0.0, 1.0 - s * s), 0.75);
  vec3 sheet = vec3(p * s, 0.0) + vec3(n.x * 0.55, n.y * 0.55, n.z) * amp;

  // settle into an irregular ball
  float th = d * 3.14159 * 0.97;
  float ph = atan(q.y, q.x);
  float r = uR * (0.86 + 0.5 * n.z) * (1.0 + uPulse);
  vec3 ball = r * vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th));
  float w = smoothstep(0.55, 1.0, tl);
  return mix(sheet, ball, w);
}

vec3 spin(vec3 v) {
  float a = uSpin * uT;
  v.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * v.xz;
  float b = a * 0.6;
  v.xy = mat2(cos(b), -sin(b), sin(b), cos(b)) * v.xy;
  return v;
}

void main() {
  float maxLen = length(uSize * 0.5);
  vUV = aUV;
  float c, c1, c2;
  vec2 e = vec2(1.0 / 160.0, 1.0 / 90.0);
  vec3 P = place(aUV, maxLen, c);
  vec3 Px = place(aUV + vec2(e.x, 0.0), maxLen, c1);
  vec3 Py = place(aUV + vec2(0.0, e.y), maxLen, c2);
  vCrease = c;
  vN = spin(normalize(cross(Px - P, Py - P)));
  P = spin(P);
  gl_Position = uProj * vec4(P.x, -P.y, P.z - 900.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vN;
in float vCrease;
uniform sampler2D uTex;
uniform float uT;
out vec4 o;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (tex.a < 0.01) discard;
  // y is flipped in the vertex shader, so the printed side is the back face
  bool printed = !gl_FrontFacing;
  vec3 n = normalize(vN);
  n.y = -n.y;
  if (n.z < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.4, 0.55, 0.75));
  float wrap = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0);      // soft paper diffuse
  float back = clamp(-dot(n, L), 0.0, 1.0) * 0.18;               // light through thin paper
  float cavity = mix(1.0, 0.8 + 0.2 * smoothstep(-0.25, 0.25, vCrease), smoothstep(0.0, 0.5, uT));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 16.0) * 0.035 * smoothstep(0.0, 0.3, uT);
  float k = mix(1.0, (0.62 + 0.45 * wrap + back) * cavity, smoothstep(0.0, 0.25, uT));
  vec3 base = printed ? tex.rgb : vec3(0.94, 0.915, 0.86);
  vec3 col = base * k;
  col = mix(col, col * vec3(1.02, 0.99, 0.93), 1.0 - k);   // warm, not silver, in the shadows
  o = vec4(col + spec, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** Draws the paper element (background, typed chars, signature, torn edge) into a canvas. */
function paperToCanvas(el: HTMLElement, dpr: number): HTMLCanvasElement {
  const box = el.getBoundingClientRect();
  const pad = 10; // room for the torn edge
  const c = document.createElement("canvas");
  c.width = Math.ceil(box.width * dpr);
  c.height = Math.ceil((box.height + pad) * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const grad = g.createLinearGradient(0, 0, 0, box.height);
  grad.addColorStop(0, "#fdfbf6"); grad.addColorStop(0.65, "#f8f3e8"); grad.addColorStop(1, "#f2ebdc");
  g.fillStyle = grad;
  g.fillRect(0, 0, box.width, box.height);
  const edge = el.querySelector<SVGPolygonElement>(".tear-edge polygon");
  if (edge) {
    g.fillStyle = "#f2ebdc";
    g.beginPath();
    const pts = edge.getAttribute("points")!.split(" ").map((s) => s.split(",").map(Number));
    const sx = box.width / 280;
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * sx, box.height + y) : g.moveTo(x * sx, box.height + y)));
    g.closePath();
    g.fill();
  }
  g.textBaseline = "middle";
  for (const node of el.querySelectorAll<HTMLElement>(".ch, .sig")) {
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.fillStyle = cs.color;
    g.globalAlpha = Number(cs.opacity) || 1;
    if (node.classList.contains("sig")) {
      g.textAlign = "right";
      g.fillText(node.textContent ?? "", r.right - box.left, r.top - box.top + r.height / 2);
    } else {
      g.textAlign = "center";
      g.fillText(node.textContent ?? "", r.left - box.left + r.width / 2, r.top - box.top + r.height / 2);
    }
  }
  g.globalAlpha = 1;
  return c;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

/** Two squeezes with a short hold in between, like a hand balling up paper. */
function squeeze(k: number): number {
  if (k < 0.45) return 0.55 * easeInOut(k / 0.45);
  if (k < 0.56) return 0.55 + 0.03 * ((k - 0.45) / 0.11);
  return 0.58 + 0.42 * easeOut((k - 0.56) / 0.44);
}

/**
 * Crumples `el` with WebGL. The element is hidden and replaced by a canvas that
 * ends showing the ball; that canvas is returned so callers can drop / fly it.
 * Returns null when WebGL2 is unavailable.
 */
export async function crumpleGL(el: HTMLElement, ballSize = 60, duration = 1500): Promise<HTMLElement | null> {
  const dpr = window.devicePixelRatio || 1;
  const box = el.getBoundingClientRect();
  const S = Math.ceil(Math.max(box.width, box.height) * 1.6);
  const canvas = document.createElement("canvas");
  canvas.width = S * dpr; canvas.height = S * dpr;
  Object.assign(canvas.style, {
    position: "fixed", width: `${S}px`, height: `${S}px`, pointerEvents: "none", zIndex: "50",
    left: `${box.left + box.width / 2 - S / 2}px`, top: `${box.top + box.height / 2 - S / 2}px`,
    filter: "drop-shadow(0 10px 14px rgba(30,20,8,.26))",
  });
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true });
  if (!gl) return null;

  const tex = paperToCanvas(el, dpr);
  const sheetH = box.height + 10;

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  gl.useProgram(prog);

  const NX = 150, NY = Math.max(40, Math.round(NX * sheetH / box.width));
  const uv = new Float32Array(NX * NY * 12);
  let k = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const u0 = i / NX, u1 = (i + 1) / NX, v0 = j / NY, v1 = (j + 1) / NY;
    uv.set([u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1], k);
    k += 12;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aUV");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const U = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform2f(U("uSize"), box.width, sheetH);
  gl.uniform1f(U("uR"), ballSize / 2);
  gl.uniform1f(U("uSeed"), rand(0, 50));
  gl.uniform1f(U("uSpin"), rand(-1.1, 1.1));
  gl.uniform1i(U("uTex"), 0);
  const f = 900 / (S / 2), near = 100, far = 3000;
  gl.uniformMatrix4fv(U("uProj"), false, new Float32Array([
    f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0,
  ]));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  document.body.append(canvas);
  el.style.visibility = "hidden";

  const uT = U("uT"), uPulse = U("uPulse");
  const springMs = 260;
  let secondSqueeze = false;
  await new Promise<void>((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      const k = Math.min(1, elapsed / duration);
      if (!secondSqueeze && k > 0.56) { secondSqueeze = true; sfx.crumple(); }
      // little spring-back after the final squeeze
      const sp = Math.min(1, Math.max(0, elapsed - duration) / springMs);
      gl.uniform1f(uT, squeeze(k));
      gl.uniform1f(uPulse, Math.sin(sp * Math.PI) * 0.06 * (1 - sp));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, uv.length / 2);
      if (elapsed < duration + springMs) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  return canvas;
}
