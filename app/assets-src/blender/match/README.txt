照片对齐工具（参考照片 ~/Downloads/微信图片_20261111211336_2070_88.jpg, 1254x1254）
1. fit_camera.py  在照片上手工标的关键点（四排键中心、装饰条两端、空格键、旋钮、纸夹滚轮、眼形开口两端、机身底角）
                  + 机身宽 0.33 m → 最小二乘同时解相机(位姿+焦距)和尺寸，输出 fit.json（重投影 rms ≈ 4 px）
                  深度歧义：同一条视线上的点可前后滑动，按物理合理的 y 固定后沿射线求 z（见 model.py ROWS 注释）
2. backproject.py 把照片轮廓点反投影到机身侧面/正面平面，得到侧面剖面线
3. 渲染对齐视角：CAMFIT=match/fit.json VINTAGE=1 [LOOK=photo] Blender -b -P model.py -- preview out.png 24 photo
4. overlay.py out.png ov.png   渲染边缘(红)叠在照片上 + 半透明混合，逐处看误差
