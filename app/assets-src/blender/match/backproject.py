import json, numpy as np
from scipy.spatial.transform import Rotation as R
f=json.load(open('fit.json')); cam=np.array(f['cam']); C=627
rot=R.from_rotvec(cam[:3]); Cp=-rot.inv().apply(cam[3:6])
def ray(u,v):
    dcam=np.array([(u-C)/cam[6],(v-C)/cam[6],1.0]); return rot.inv().apply(dcam)
def onplane(u,v,axis,val):
    d=ray(u,v); t=(val-Cp[axis])/d[axis]; return Cp+d*t
W=0.33
groups={
 'left cheek outline -> x=-W/2':(0,-W/2,[(195,705),(175,750),(155,790),(135,830),(120,865),(108,895),(102,920),(95,965),(98,1000)]),
 'front lip (center col) -> y=-0.155':(1,-0.155,[(500,1000),(500,1040),(500,1075),(300,975),(300,1050)]),
 'housing front col x500 -> y=-0.036':(1,-0.036,[(500,680),(500,640),(500,625),(500,610)]),
 'right silhouette -> x=+W/2':(0,W/2,[(1060,600),(1065,650),(1080,700),(1095,720),(1060,800),(1010,880),(960,980),(920,1070),(905,1105)]),
 'housing top-left silhouette -> x=-W/2':(0,-W/2,[(205,640),(215,600),(240,570),(270,540),(300,520),(330,505)]),
}
for g,(ax,val,pts) in groups.items():
    print(g)
    for u,v in pts:
        P=onplane(u,v,ax,val); print(f'   ({u},{v}) -> x={P[0]:.3f} y={P[1]:.3f} z={P[2]:.3f}')
