"""Vintage grade for a render: warm cast, brown-lifted shadows, slight fade, vignette, film grain."""
import sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
h, w, _ = im.shape
lum = im[..., 0] * 0.299 + im[..., 1] * 0.587 + im[..., 2] * 0.114
im = im * 0.88 + lum[..., None] * 0.12                                  # fade the colour a little
im = im * np.array([1.04, 1.0, 0.9], np.float32)                         # warm
im = 0.035 * np.array([1.0, 0.75, 0.5], np.float32) + im * 0.95         # lift blacks to warm brown
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
im *= (1 - 0.38 * np.clip(d - 0.45, 0, 1) ** 1.6)[..., None]             # vignette
rng = np.random.default_rng(1)
g = rng.normal(0, 1, (h, w)).astype(np.float32)
im += (g * 0.028 * (0.6 + 0.4 * (1 - lum)))[..., None]                   # grain, stronger in shadows
Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).save(dst, quality=95)
print("graded", dst)
