import numpy as np, json, os, cv2
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as R
IMG=1254; C=IMG/2
W=0.33
row1=[(280,700),(338,707),(397,713),(456,720),(518,725),(580,731),(642,736),(708,747),(772,755),(840,762),(912,767)]
row2=[(285,760),(345,768),(405,775),(466,781),(528,786),(592,790)]
row3=[(280,822),(340,830),(405,838)]
rowz=[(287,885),(350,892),(416,900),(482,907),(548,914),(615,920),(682,930),(752,940),(832,953)]
obs={'botL':(105,1030),'botR':(905,1110),'trimL':(205,650),'trimR':(1000,735),
     'spL':(248,948),'spR':(745,1012),'knobL':(270,480),'knobR':(1170,558),
     'rolL':(500,447),'rolR':(840,475),'eyeL':(400,545),'eyeR':(850,582)}
skip=set(os.environ.get('SKIP','').split(','))
PRIOR=dict(yf=-0.155,p=0.0226,Wh=0.162,yh=-0.036,zt=0.117,x1=-0.13,y1=-0.049,z1=0.114,x4=-0.11,y4=-0.1315,z4=0.056,
 sb=0.095,ys=-0.1485,zs=0.0465,xk=0.199,yk=0.104,zk=0.172,xr=0.065,yb=0.078,zb=0.186,xe=0.086,ye=0.03,ze=0.16)
SIG=float(os.environ.get('SIG','0.01'))
PRIOR.update(y2=-0.076,z2=0.095,y3=-0.104,z3=0.075)
B={ # name: (lo, init, hi)
 'wb':(0.14,0.165,0.2),
 'x2':(-0.17,-0.12,-0.03),'y2':(-0.15,-0.076,0.03),'z2':(0.02,0.09,0.15),
 'x3':(-0.17,-0.11,-0.03),'y3':(-0.17,-0.104,0.0),'z3':(0.02,0.075,0.14),
 'yf':(-0.22,-0.155,-0.08),'p':(0.02699,0.027,0.02701),
 'Wh':(0.12,0.155,0.19),'yh':(-0.08,-0.01,0.08),'zt':(0.05,0.1,0.16),
 'x1':(-0.17,-0.1,-0.04),'y1':(-0.12,-0.03,0.06),'z1':(0.03,0.09,0.15),
 'x4':(-0.17,-0.08,-0.03),'y4':(-0.18,-0.09,0.0),'z4':(0.01,0.05,0.1),
 'sb':(0.05,0.09,0.13),'ys':(-0.2,-0.12,-0.04),'zs':(0.005,0.035,0.08),
 'xk':(0.15,0.2,0.27),'yk':(-0.02,0.08,0.2),'zk':(0.07,0.15,0.25),
 'xr':(0.02,0.06,0.12),'yb':(-0.02,0.07,0.2),'zb':(0.08,0.17,0.27),
 'xe':(0.04,0.08,0.14),'ye':(-0.06,0.03,0.12),'ze':(0.07,0.13,0.2)}
names=list(B)
def pts(d):
    P={'botL':(-d['wb'],d['yf'],0.004),'botR':(d['wb'],d['yf'],0.004),'trimL':(-d['Wh'],d['yh'],d['zt']),'trimR':(d['Wh'],d['yh'],d['zt']),
       'spL':(-d['sb'],d['ys'],d['zs']),'spR':(d['sb'],d['ys'],d['zs']),'knobL':(-d['xk'],d['yk'],d['zk']),'knobR':(d['xk'],d['yk'],d['zk']),
       'rolL':(-d['xr'],d['yb'],d['zb']),'rolR':(d['xr'],d['yb'],d['zb']),'eyeL':(-d['xe'],d['ye'],d['ze']),'eyeR':(d['xe'],d['ye'],d['ze'])}
    X=[];I=[];L=[]
    for k,v in P.items():
        if k in skip: continue
        X.append(v); I.append(obs[k]); L.append(k)
    for i,o in enumerate(row1): X.append((d['x1']+i*d['p'],d['y1'],d['z1'])); I.append(o); L.append(f'r1_{i}')
    for i,o in enumerate(row2): X.append((d['x2']+i*d['p'],d['y2'],d['z2'])); I.append(o); L.append(f'r2_{i}')
    for i,o in enumerate(row3): X.append((d['x3']+i*d['p'],d['y3'],d['z3'])); I.append(o); L.append(f'r3_{i}')
    for i,o in enumerate(rowz): X.append((d['x4']+i*d['p'],d['y4'],d['z4'])); I.append(o); L.append(f'rz_{i}')
    return np.array(X),np.array(I,float),L
def project(cam,X):
    Xc=R.from_rotvec(cam[:3]).apply(X)+cam[3:6]; f=cam[6]
    return np.stack([C+f*Xc[:,0]/Xc[:,2], C+f*Xc[:,1]/Xc[:,2]],1)
def unpack(v): return v[:7], dict(zip(names,v[7:]))
def res(v):
    cam,d=unpack(v); X,I,_=pts(d)
    pr=[(d[n]-PRIOR[n])/SIG for n in names if n not in ('p','x1','x2','x3','x4','wb')]
    return np.concatenate([(project(cam,X)-I).ravel(), pr, [ (d['Wh']-W/2+0.004)*1000 if d['Wh']>W/2-0.004 else 0 ]])
lb=np.array([-np.inf]*6+[400]+[B[n][0] for n in names]); ub=np.array([np.inf]*6+[4000]+[B[n][2] for n in names])
best=None
for f in (800,1100,1500,2000):
    d0={n:B[n][1] for n in names}; X,I,_=pts(d0)
    ok,rv,tv=cv2.solvePnP(X,I,np.array([[f,0,C],[0,f,C],[0,0,1.]]),None,flags=cv2.SOLVEPNP_SQPNP)
    v0=np.clip(np.concatenate([rv.ravel(),tv.ravel(),[f],[d0[n] for n in names]]),lb+1e-9,ub-1e-9)
    s=least_squares(res,v0,bounds=(lb,ub),loss='soft_l1',f_scale=4,max_nfev=40000)
    if best is None or s.cost<best.cost: best=s
cam,d=unpack(best.x); X,I,L=pts(d); err=np.linalg.norm(project(cam,X)-I,axis=1)
print('rms',round(float(np.sqrt((err**2).mean())),2),'worst',sorted(zip(err.round(1),L))[-5:])
print('fov',round(float(np.degrees(2*np.arctan(C/cam[6]))),1),'campos',(-R.from_rotvec(cam[:3]).inv().apply(cam[3:6])).round(3))
print({n:(round(d[n],4),'*' if abs(d[n]-B[n][0])<1e-3 or abs(d[n]-B[n][2])<1e-3 else '') for n in names})
print('BOTTOM HALF WIDTH',d['wb']);json.dump({'cam':list(cam),'dims':d,'W':W},open('fit_wb.json','w'),indent=1)
