import sys, cv2, numpy as np
ph=cv2.imread('/Users/zizic/Downloads/微信图片_20261111211336_2070_88.jpg'); r=cv2.imread(sys.argv[1])
r=cv2.resize(r,(ph.shape[1],ph.shape[0]))
e=cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(r,cv2.COLOR_BGR2GRAY),(3,3),0),40,110)
out=ph.copy(); out[e>0]=(0,0,255)
blend=cv2.addWeighted(ph,0.5,r,0.5,0)
cv2.imwrite(sys.argv[2],np.hstack([out,blend]))
