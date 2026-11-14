"""Overlay renders from the solved photo cameras on the reference sheet: edges (red) + 50% blend, per view crop."""
import cv2, numpy as np, sys
d = sys.argv[1]; tag = sys.argv[2] if len(sys.argv) > 2 else "o"
ref = cv2.imread('../../../../refs/三视图.png')
for v, (x0, y0, x1, y1) in {"front": (0, 180, 620, 720), "top": (1180, 170, 1774, 730)}.items():
    m = cv2.imread(f'{d}/r_{v}.png', cv2.IMREAD_UNCHANGED); a = m[..., 3:4] / 255.0
    comp = (m[..., :3] * a + ref * (1 - a)).astype(np.uint8)
    e = cv2.Canny(cv2.cvtColor((m[..., :3] * a + 255 * (1 - a)).astype(np.uint8), cv2.COLOR_BGR2GRAY), 40, 120)
    ov = ref.copy(); ov[e > 0] = (0, 0, 255)
    blend = cv2.addWeighted(ref, 0.5, comp, 0.5, 0)
    cv2.imwrite(f'{d}/ov_{tag}_{v}.png', np.hstack([ov[y0:y1, x0:x1], blend[y0:y1, x0:x1]]))
