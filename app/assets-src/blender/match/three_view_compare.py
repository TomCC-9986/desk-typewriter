import cv2, numpy as np, sys
S=sys.argv[1]; tag=sys.argv[2]
ref=cv2.imread('/Users/zizic/Claude工作区/交互作品/桌面打字机/refs/三视图.png')
crops={'front':(15,150,615,750),'side':(600,150,1150,750),'top':(1180,150,1780,750)}
rows=[]; ovs=[]
for k,(x0,y0,x1,y1) in crops.items():
    r=ref[y0:min(y1,ref.shape[0]),x0:min(x1,ref.shape[1])]
    r=cv2.copyMakeBorder(r,0,(y1-y0)-r.shape[0],0,(x1-x0)-r.shape[1],cv2.BORDER_CONSTANT,value=(252,252,254))
    m=cv2.imread(f'{S}/r_{k}.png',cv2.IMREAD_UNCHANGED)
    a=m[...,3:4]/255.0; comp=(m[...,:3]*a+np.full_like(m[...,:3],252)*(1-a)).astype(np.uint8)
    rows.append(np.vstack([r,comp]))
    e=cv2.Canny(cv2.cvtColor(comp,cv2.COLOR_BGR2GRAY),40,120); ov=r.copy(); ov[e>0]=(0,0,255); ovs.append(ov)
cv2.imwrite(f'{S}/sbs_{tag}.png', cv2.resize(np.hstack(rows),None,fx=0.75,fy=0.75))
cv2.imwrite(f'{S}/ov_{tag}.png', cv2.resize(np.hstack(ovs),None,fx=0.75,fy=0.75))
