"""Colour calibration against the three-view sheet (neutral white studio light): render ortho3 at the
sheet's scale, sample the same pixels in both, update per-material linear RGB multipliers (calib_3view.json)."""
import json, os, subprocess, sys, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); BL = os.path.dirname(HERE)
SHEET = os.path.join(BL, "../../../refs/三视图.jpg")
OUT = os.path.join(HERE, "cal3.png")
CAL = os.path.join(HERE, "calib_3view.json")
ORIGIN = {"front": (15, 150), "side": (600, 150), "top": (1180, 150)}
PTS = {   # material: [(view, sheet x, sheet y)] on flat, evenly lit patches
 "mint": [("front", 300, 470), ("front", 470, 470), ("front", 300, 678), ("side", 900, 600), ("side", 1000, 560), ("side", 820, 620),
          ("side", 860, 470), ("top", 1300, 400), ("top", 1660, 400), ("top", 1480, 490)],
 "cream": [("top", 1450, 672), ("side", 1050, 455)],
}
def lin(c): c = np.asarray(c, float) / 255; return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
def sample(img, x, y, r=5):
    a = np.asarray(img)[y - r:y + r + 1, x - r:x + r + 1]
    if a.shape[-1] == 4:
        a = a[a[..., 3] > 250][:, :3]
    else:
        a = a.reshape(-1, 3)
    return np.median(a, axis=0) if len(a) else None
sheet = Image.open(SHEET).convert("RGB")
cal = json.load(open(CAL)) if os.path.exists(CAL) else {}
for it in range(int(sys.argv[1]) if len(sys.argv) > 1 else 2):
    env = dict(os.environ, VINTAGE="1", CALIB=CAL, EXPO3=os.environ.get("EXPO3", "-1.0"))
    subprocess.run(["/Applications/Blender.app/Contents/MacOS/Blender", "-b", "-P", os.path.join(BL, "model.py"), "--", "preview", OUT, "24", "ortho3"],
                   cwd=BL, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    views = {v: Image.open(OUT.replace(".png", f"_{v}.png")) for v in ORIGIN}
    print(f"--- iteration {it}")
    for m, pts in PTS.items():
        P, R = [], []
        for v, x, y in pts:
            r = sample(views[v], x - ORIGIN[v][0], y - ORIGIN[v][1])
            if r is None: print("  miss", m, v, x, y); continue
            P.append(lin(sample(sheet, x, y))); R.append(lin(r))
        P, R = np.array(P), np.array(R)
        ratio = np.exp(np.mean(np.log((P + 1e-4) / (R + 1e-4)), axis=0))
        ratio = ratio / (ratio @ np.array([0.2126, 0.7152, 0.0722]))   # chroma only: brightness is the lighting's job (EXPO3)
        k = np.clip(np.array(cal.get(m, [1, 1, 1])) * np.clip(ratio, 0.4, 2.5), 0.05, 4.0)
        cal[m] = k.round(4).tolist()
        stops = (np.log((P.mean(1) + 1e-4) / (R.mean(1) + 1e-4)) / np.log(2)).round(2)
        print(f"{m:6s} ratio {ratio.round(3)} -> mult {cal[m]}  per-point stops {stops}")
    json.dump(cal, open(CAL, "w"), indent=1)
