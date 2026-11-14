"""Colour calibration against the reference photo: render at the solved camera, sample the same pixels,
update per-material linear RGB multipliers (calib.json), repeat.
usage: python3 calibrate.py <iterations> [extra env, e.g. WIN=420]"""
import json, os, subprocess, sys, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); BL = os.path.dirname(HERE)
PHOTO = os.path.expanduser("~/Downloads/微信图片_20261111211336_2070_88.jpg")
OUT = os.environ.get("CAL_OUT", os.path.join(HERE, "cal_render.png"))
CAL = os.path.join(HERE, "calib.json")
HUE = {"mint": [(560, 610), (850, 625)], "cream": [(500, 960), (650, 985)]}   # hue only from directly lit patches; other points correct brightness only
PTS = {  # material: [(x, y) photo pixels on flat, evenly lit patches]
 "mint": [(560, 610), (850, 625), (500, 1045), (300, 1035), (1040, 850), (1060, 760), (120, 900)],
 "cream": [(285, 755), (405, 833), (500, 960), (650, 985)],
 "wall2": [(150, 150), (1100, 150), (1150, 650)],
 "walnut": [(150, 1180), (1000, 1200)],
 "letter": [(550, 300), (800, 250)],
}
def lin(c): c = np.asarray(c, float) / 255; return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
def sample(img, x, y, r=4): return np.median(np.asarray(img)[y - r:y + r + 1, x - r:x + r + 1].reshape(-1, 3), axis=0)
def render():
    env = dict(os.environ, LOOK="photo", VINTAGE="1", CAMFIT=os.path.join(HERE, "fit.json"), CALIB=CAL)
    subprocess.run(["/Applications/Blender.app/Contents/MacOS/Blender", "-b", "-P", os.path.join(BL, "model.py"), "--", "preview", OUT, "24", "photo"],
                   cwd=BL, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
photo = Image.open(PHOTO).convert("RGB")
cal = json.load(open(CAL)) if os.path.exists(CAL) else {}
for it in range(int(sys.argv[1]) if len(sys.argv) > 1 else 2):
    render(); r = Image.open(OUT).convert("RGB")
    print(f"--- iteration {it}")
    for m, pts in PTS.items():
        P = np.array([lin(sample(photo, x, y)) for x, y in pts]); R = np.array([lin(sample(r, x, y)) for x, y in pts])
        ratio = np.exp(np.mean(np.log((P + 1e-4) / (R + 1e-4)), axis=0))
        if m in HUE:
            Ph = np.array([lin(sample(photo, x, y)) for x, y in HUE[m]]); Rh = np.array([lin(sample(r, x, y)) for x, y in HUE[m]])
            hue = np.exp(np.mean(np.log((Ph + 1e-4) / (Rh + 1e-4)), axis=0)); hue /= np.exp(np.mean(np.log(hue)))
            ratio = hue * np.exp(np.mean(np.log(ratio)))
        per_pt = (np.log((P.mean(1) + 1e-4) / (R.mean(1) + 1e-4)) / np.log(2)).round(2)   # stops of error per point
        k = np.clip(np.array(cal.get(m, [1, 1, 1])) * np.clip(ratio, 0.4, 2.5), 0.05, 4.0)
        cal[m] = k.round(4).tolist()
        print(f"{m:7s} ratio {ratio.round(3)} -> mult {cal[m]}  per-point stops {per_pt}")
    json.dump(cal, open(CAL, "w"), indent=1)
