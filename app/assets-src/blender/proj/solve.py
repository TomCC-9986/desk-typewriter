"""Solve the real (perspective) camera of the front and top photos from keycap correspondences.
Model key points come straight from model.py's layout constants."""
import json, re, numpy as np, cv2
from scipy.optimize import linear_sum_assignment, least_squares
src = open('../model.py').read()
ns = {}
exec(src[src.index('PITCH = 0.0251'):src.index('SHIFTED =')], ns)
cap_h = float(re.search(r'CAP_W, CAP_D, CAP_H, CAP_DISH = [\d.]+, [\d.]+, ([\d.]+)', src).group(1))
P3 = {}
for chars, x0, y, z in ns['ROWS']:
    for i, ch in enumerate(chars): P3[ch] = (x0 + i * ns['PITCH'], y, z + cap_h / 2)
r = ns['ROWS']
P3['tab'] = (-0.138, r[0][2] + 0.55 * (r[1][2] - r[0][2]), r[0][3] + 0.55 * (r[1][3] - r[0][3]) + cap_h / 2)
P3['lock'] = (-0.1245, r[2][2] + 0.003, r[2][3] + 0.002 + cap_h / 2)
P3['shiftL'] = (-0.1217, r[3][2], r[3][3] + cap_h / 2); P3['shiftR'] = (0.1224, r[3][2], r[3][3] + cap_h / 2)
P3['space'] = (0.0, -0.147, 0.0592 + 0.0058)
names = list(P3); X = np.array([P3[n] for n in names])
blobs = json.load(open('blobs.json'))
VIEWS = {  # initial guess: sheet centre of the machine, px per metre, looking along
 "front": dict(c=(315, 520), up=np.array([0, 0, 1.0]), fwd=np.array([0, 1.0, 0]), ppm=1397),
 "top":   dict(c=(1476, 450), up=np.array([0, 1.0, 0]), fwd=np.array([0, 0, -1.0]), ppm=1397),
}
EXTRA = {   # hand-read landmarks off off the key plane: (model xyz, sheet px)
 "front": {"knobL": ((-0.177, 0.148, 0.191), (68, 412)), "trimL": ((-0.163, -0.054, 0.1432), (87, 497)),
           "screwL": ((-0.077, -0.0557, 0.166), (220, 467)), "footL": ((-0.147, -0.125, 0.0045), (108, 696)), "footR": ((0.147, -0.125, 0.0045), (518, 696))},
 "top": {"knobL": ((-0.177, 0.148, 0.191), (1212, 298)), "trimL": ((-0.163, -0.054, 0.1432), (1262, 519)),
         "tipL": ((-0.09, 0.027, 0.2), (1349, 452)), "backL": ((-0.163, 0.099, 0.2), (1242, 342))},
}
W_EXTRA = 2.0
out = {}
for v, g in VIEWS.items():
    B = np.array([(b[0], b[1]) for b in blobs[v] if b[2] > 300])
    right = np.cross(g['fwd'], g['up'])
    # rough orthographic guess for the first matching
    def ortho(X): return np.stack([g['c'][0] + (X @ right) * g['ppm'], g['c'][1] - (X @ g['up'] - (0.1 if v == 'front' else 0.0)) * g['ppm']], 1)
    proj = ortho(X)
    best = None
    for it in range(6):
        C = np.linalg.norm(proj[:, None] - B[None], axis=2)
        ri, ci = linear_sum_assignment(C)
        ex = EXTRA[v]
        obj = np.vstack([X[ri], [e[0] for e in ex.values()]]).astype(np.float64)
        img = np.vstack([B[ci], [e[1] for e in ex.values()]]).astype(np.float64)
        wts = np.r_[np.ones(len(ri)), np.full(len(ex), W_EXTRA)]
        res = None
        Rg = np.array([right, -g['up'], g['fwd']])   # world -> camera, looking along fwd
        tgt = np.array([0, 0.02, 0.12])
        for D in (0.6, 1.0, 1.6, 2.5, 4.0, 8.0):
            cam0 = tgt - g['fwd'] * D
            rv0 = cv2.Rodrigues(Rg)[0].ravel(); tv0 = -Rg @ cam0
            def fun(p):
                Kp = np.array([[p[6], 0, p[7]], [0, p[6], p[8]], [0, 0, 1.]])
                pr, _ = cv2.projectPoints(obj, p[:3], p[3:6], Kp, None); return ((pr.reshape(-1, 2) - img) * wts[:, None]).ravel()
            s = least_squares(fun, np.r_[rv0, tv0, g['ppm'] * D, g['c'][0], g['c'][1]], loss='soft_l1', f_scale=3)
            if res is None or s.cost < res.cost: res = s
        p = res.x
        Kp = np.array([[p[6], 0, p[7]], [0, p[6], p[8]], [0, 0, 1.]])
        proj = cv2.projectPoints(X, p[:3], p[3:6], Kp, None)[0].reshape(-1, 2)
        err = np.linalg.norm(proj[ri] - img[:len(ri)], axis=1)
        pe = cv2.projectPoints(obj[len(ri):], p[:3], p[3:6], Kp, None)[0].reshape(-1, 2)
        exerr = {k: (pe[i] - img[len(ri) + i]).round(1).tolist() for i, k in enumerate(ex)}
        best = (p, err, ri, ci, exerr)
    p, err, ri, ci, exerr = best
    R = cv2.Rodrigues(p[:3])[0]; cam = -R.T @ p[3:6]
    print(f"{v}: rms {np.sqrt((err**2).mean()):.2f}px  max {err.max():.1f}px  f={p[6]:.0f}px  camera at {cam.round(3)}")
    worst = sorted(zip(err.round(1), [names[i] for i in ri]))[-6:]
    print("   worst keys:", worst)
    print("   landmarks (px off):", exerr)
    out[v] = dict(rvec=p[:3].tolist(), tvec=p[3:6].tolist(), f=p[6], cx=p[7], cy=p[8], cam=cam.tolist(),
                  resid={names[i]: (proj[i] - B[j]).round(1).tolist() for i, j in zip(ri, ci)})
json.dump(out, open('cams.json', 'w'), indent=1)
