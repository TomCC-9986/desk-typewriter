照片投射工具（参考图 refs/三视图.png）
1. detect.py   自动找正视图/俯视图里 44 个键帽中心 → blobs.json
2. solve.py    用 model.py 的键位 + 手读的几个点（旋钮、装饰条端、螺丝、脚、开口尖角）解出两张照片的真实透视相机 → cams.json
               正视图 rms ~4 px（相机在前方约 1.1 m、略高），俯视图 rms ~2 px（长焦，约 8 m 外）
3. 渲染相机视角叠图：CALIB=match/calib_3view.json VINTAGE=1 Blender -b -P model.py -- preview out.png 16 photo3 ； python3 proj/overlay.py <dir> tag
4. 导出时 bake_shell() → project_photos()：台面用俯视图（解出的相机）、侧板用右视图（正交）把照片真实漆面投到贴图上，
   用大半径模糊去掉照片自身的光照，压掉照片里的高光。需要 .pydeps 里的 opencv（Blender 自带 python 没有）：
   /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 -m pip install --no-deps --target .pydeps opencv-python-headless
   PROJ=0 可关掉。
