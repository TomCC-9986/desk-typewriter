"""Find keycap centres (cream blobs) in the front and top views of refs/三视图.png."""
import cv2, numpy as np, json, sys
ref = cv2.imread('../../../../refs/三视图.png')
hsv = cv2.cvtColor(ref, cv2.COLOR_BGR2HSV)
cream = ((hsv[..., 0] >= 8) & (hsv[..., 0] <= 28) & (hsv[..., 1] >= 30) & (hsv[..., 1] <= 120) & (hsv[..., 2] >= 150)).astype(np.uint8)
out = {}
vis = ref.copy()
for view, (x0, y0, x1, y1) in {"front": (60, 500, 570, 670), "top": (1260, 525, 1700, 700)}.items():
    m = np.zeros_like(cream); m[y0:y1, x0:x1] = cream[y0:y1, x0:x1]
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    blobs = [(float(cen[i][0]), float(cen[i][1]), int(st[i][4]), int(st[i][2]), int(st[i][3])) for i in range(1, n) if st[i][4] > 60]
    out[view] = blobs
    for x, y, a, w, h in blobs:
        cv2.circle(vis, (int(x), int(y)), 3, (0, 0, 255), -1)
    print(view, len(blobs), "areas", sorted(b[2] for b in blobs)[:5], "...", sorted(b[2] for b in blobs)[-3:])
json.dump(out, open('blobs.json', 'w'), indent=1)
cv2.imwrite(sys.argv[1], vis)
