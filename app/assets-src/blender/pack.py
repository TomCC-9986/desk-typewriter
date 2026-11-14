"""Crop the three renders to a shared bbox, scale to 2x display size, write WebP + layout.json."""
import json, sys
from PIL import Image
SRC, DST, DISPLAY_W = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 660
ims = {n: Image.open(f"{SRC}/{n}.png").convert("RGBA") for n in ("body", "body_down", "carriage", "bail")}
boxes = [im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox() for im in (ims["body"], ims["carriage"])]
x0 = min(b[0] for b in boxes) - 6; y0 = min(b[1] for b in boxes) - 6
x1 = max(b[2] for b in boxes) + 6; y1 = max(b[3] for b in boxes) + 6
scale = DISPLAY_W * 2 / (x1 - x0)
size = (round((x1 - x0) * scale), round((y1 - y0) * scale))
def dehaze(im):
    """Drop the faint full-frame haze the shadow catcher leaves, keep real contact shadows."""
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v < 14 else min(255, round((v - 14) * 255 / 241)))
    return Image.merge("RGBA", (r, g, b, a))
for n, im in ims.items():
    dehaze(im.crop((x0, y0, x1, y1))).resize(size, Image.LANCZOS).save(f"{DST}/{n}.webp", quality=90, method=6)
L = json.load(open(f"{SRC}/layout.json"))
def tx(p): return [round((p[0] - x0) * scale / 2, 1), round((p[1] - y0) * scale / 2, 1)]  # CSS px
out = {"size": [size[0] / 2, size[1] / 2]}
for k in ("platenTop", "platenFront", "bail", "platenLeft", "platenRight", "typePoint"):
    out[k] = tx(L[k])
out["keys"] = {}
for ch, k in L["keys"].items():
    x, y = tx([k["x"], k["y"]])
    out["keys"][ch] = {"x": x, "y": y, "r": round(k["r"] * scale / 2 + 2, 1), **({"h": round(k["h"] * scale / 2 + 3, 1)} if k.get("h") else {})}
json.dump(out, open(f"{DST}/layout.json", "w"), indent=1)
print(out["size"], {k: out[k] for k in ("platenTop", "bail", "typePoint")})
