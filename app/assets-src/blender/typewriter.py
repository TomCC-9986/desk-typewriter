"""Original mint-green portable typewriter, modelled from primitives and rendered with Cycles.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b -P typewriter.py -- <out_dir> [samples]
Writes body.png, body_down.png (all keys pressed), carriage.png (body as holdout), layout.json.
All images share one camera, so they stack pixel-perfectly.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "renders")
SAMPLES = int(argv[1]) if len(argv) > 1 else 128  # set LAYOUT_ONLY=1 to only rewrite layout.json
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 1800, 1250
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
try:
    scene.view_settings.view_transform = "Khronos PBR Neutral"
except TypeError:
    scene.view_settings.view_transform = "Standard"
scene.view_settings.exposure = -1.1
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    if hasattr(prefs, "metalrt"):
        prefs.metalrt = "OFF"
    scene.cycles.device = "GPU"
except Exception as e:  # CPU fallback
    print("GPU setup failed:", e)

BODY, CARRIAGE, KEYS, BAIL = [], [], [], []

def mat(name, color, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.05, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    if "Specular IOR Level" in p.inputs:
        p.inputs["Specular IOR Level"].default_value = spec
    return m

def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

M_MINT = mat("mint", srgb("#8fc3a2"), rough=0.32, coat=1.0, coat_rough=0.04)
M_CREAM = mat("cream", srgb("#f1e8d2"), rough=0.28, coat=0.6, coat_rough=0.08)
M_INK = mat("ink", srgb("#141210"), rough=0.6)
M_CHROME = mat("chrome", (0.9, 0.9, 0.9), rough=0.12, metal=1.0)
M_STEEL = mat("steel", (0.55, 0.55, 0.56), rough=0.35, metal=1.0)
M_RUBBER = mat("rubber", srgb("#0d0c0c"), rough=0.55)
M_BAKELITE = mat("bakelite", srgb("#1b1a19"), rough=0.22, coat=0.5)
M_WELL = mat("well", srgb("#0f0e0d"), rough=0.75)
M_ORANGE = mat("orange", srgb("#d9542f"), rough=0.3, coat=0.6)

def finish(obj, material, group, smooth=True, bevel=0.0, segs=4):
    obj.data.materials.append(material)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if bevel:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segs
        b.limit_method = "ANGLE"
        b.harden_normals = True
    group.append(obj)
    return obj

def cyl(r, depth, loc, rot=(0, 0, 0), verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    return bpy.context.object

def box(size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return o

# ---------------------------------------------------------------- body hull (side profile extruded across x)
W = 0.31
profile = [(-0.150, 0.000), (-0.150, 0.022), (-0.142, 0.030), (0.010, 0.074), (0.030, 0.096),
           (0.125, 0.100), (0.150, 0.086), (0.150, 0.000)]
me = bpy.data.meshes.new("hull")
bm = bmesh.new()
left = [bm.verts.new((-W / 2, y, z)) for y, z in profile]
right = [bm.verts.new((W / 2, y, z)) for y, z in profile]
bm.faces.new(left[::-1])
bm.faces.new(right)
n = len(profile)
for i in range(n):
    j = (i + 1) % n
    bm.faces.new((left[i], left[j], right[j], right[i]))
bm.to_mesh(me)
bm.free()
hull = bpy.data.objects.new("hull", me)
scene.collection.objects.link(hull)
finish(hull, M_MINT, BODY, bevel=0.012, segs=10)
hull.modifiers["bevel"].limit_method = "NONE"

# raised side cheeks framing the keyboard
for sx in (-1, 1):
    ch = box((0.022, 0.13, 0.03), (sx * 0.142, -0.07, 0.044), rot=(math.atan2(0.044, 0.152), 0, 0))
    finish(ch, M_MINT, BODY, bevel=0.009, segs=8)

# chrome trim along the front lip + blank badge
trim = cyl(0.0016, W - 0.02, (0, -0.1515, 0.02), rot=(0, math.pi / 2, 0), verts=16)
finish(trim, M_CHROME, BODY)
badge = box((0.05, 0.003, 0.009), (0, -0.147, 0.0275), rot=(math.radians(-10), 0, 0))
finish(badge, M_CHROME, BODY, bevel=0.002)

# ---------------------------------------------------------------- keyboard
SLOPE = math.atan2(0.044, 0.152)
def deck_z(y):  # deck surface height along the slope
    return 0.030 + (y + 0.142) * (0.044 / 0.152)

well = box((0.262, 0.13, 0.004), (0, -0.075, deck_z(-0.075) + 0.001), rot=(SLOPE, 0, 0))
finish(well, M_WELL, BODY, bevel=0.004)

ROWS = [("ZXCVBNM,.?", 0.015, -0.120), ("ASDFGHJKL;:", 0.009, -0.094),
        ("QWERTYUIOP½", 0.003, -0.068), ("1234567890-", -0.003, -0.042)]
PITCH = 0.0215
key_meta = []
for chars, off, y in ROWS:
    count = len(chars)
    for i, ch in enumerate(chars):
        x = (i - (count - 1) / 2) * PITCH + off
        top = deck_z(y) + 0.016
        parts = []
        cap = cyl(0.0082, 0.0045, (x, y, top), verts=40)
        finish(cap, M_CREAM, KEYS, bevel=0.0012, segs=3); parts.append(cap)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.0084, minor_radius=0.0009, location=(x, y, top - 0.0008))
        ring = bpy.context.object
        finish(ring, M_CHROME, KEYS); parts.append(ring)
        stem = cyl(0.0011, 0.016, (x, y + 0.002, top - 0.009), rot=(math.radians(-12), 0, 0), verts=12)
        finish(stem, M_STEEL, KEYS); parts.append(stem)
        cu = bpy.data.curves.new(f"t_{ch}", "FONT")
        cu.body = ch
        cu.align_x, cu.align_y = "CENTER", "CENTER"
        cu.size = 0.0078
        cu.extrude = 0.00008
        t = bpy.data.objects.new(f"t_{ch}", cu)
        scene.collection.objects.link(t)
        t.location = (x, y, top + 0.0027)
        t.data.materials.append(M_INK)
        KEYS.append(t); parts.append(t)
        key_meta.append({"ch": ch, "parts": parts, "center": Vector((x, y, top + 0.0023)), "r": 0.0092})

space = box((0.13, 0.011, 0.005), (0, -0.138, deck_z(-0.138) + 0.012))
finish(space, M_CREAM, KEYS, bevel=0.0025, segs=4)
space_meta = {"ch": " ", "parts": [space], "center": Vector((0, -0.138, deck_z(-0.138) + 0.0145)), "r": 0.0}

# ---------------------------------------------------------------- type-bar basket under the carriage
basket = cyl(0.068, 0.006, (0, 0.06, 0.098), verts=96)
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(basket.data)
for v in [v for v in bm.verts if v.co.y < -0.002]:
    pass
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(0, 1, 0), clear_inner=True)
bmesh.update_edit_mesh(basket.data)
bpy.ops.object.mode_set(mode="OBJECT")
basket.rotation_euler = (0, 0, math.pi)
finish(basket, M_WELL, BODY, smooth=False)
for i in range(34):
    a = math.radians(-80 + i * (160 / 33))
    L = 0.058
    bar = box((0.0018, L, 0.0016), (math.sin(a) * L / 2, 0.06 - math.cos(a) * L / 2, 0.1015), rot=(0, 0, -a))
    finish(bar, M_STEEL, BODY, smooth=False)
guide = box((0.012, 0.01, 0.012), (0, 0.072, 0.108))
finish(guide, M_CHROME, BODY, bevel=0.002)

# ---------------------------------------------------------------- carriage
PY, PZ, PR = 0.108, 0.128, 0.019
platen = cyl(PR, 0.262, (0, PY, PZ), rot=(0, math.pi / 2, 0), verts=64)
finish(platen, M_RUBBER, CARRIAGE)
rail = cyl(0.004, 0.33, (0, 0.128, 0.104), rot=(0, math.pi / 2, 0), verts=24)
finish(rail, M_CHROME, CARRIAGE)
for sx in (-1, 1):
    plate = box((0.006, 0.05, 0.05), (sx * 0.134, PY + 0.004, PZ - 0.008))
    finish(plate, M_CHROME, CARRIAGE, bevel=0.002)
    shaft = cyl(0.005, 0.02, (sx * 0.142, PY, PZ), rot=(0, math.pi / 2, 0), verts=24)
    finish(shaft, M_CHROME, CARRIAGE)
    accent = cyl(0.016, 0.004, (sx * 0.149, PY, PZ), rot=(0, math.pi / 2, 0), verts=40)
    finish(accent, M_ORANGE, CARRIAGE)
    knob = cyl(0.022, 0.03, (sx * 0.166, PY, PZ), rot=(0, math.pi / 2, 0), verts=72)
    # knurled ribs: pull every other rim vertex inwards
    for v in knob.data.vertices:
        ang = math.atan2(v.co.y, v.co.x)
        idx = round((ang + math.pi) / (2 * math.pi) * 72)
        if idx % 2:
            v.co.x *= 0.93
            v.co.y *= 0.93
    finish(knob, M_BAKELITE, CARRIAGE, bevel=0.003, segs=3)
bail = cyl(0.0018, 0.215, (0, PY - PR - 0.004, PZ + 0.011), rot=(0, math.pi / 2, 0), verts=16)
finish(bail, M_CHROME, BAIL)
for sx in (-1, 1):
    roller = cyl(0.0042, 0.013, (sx * 0.05, PY - PR - 0.004, PZ + 0.011), rot=(0, math.pi / 2, 0), verts=24)
    finish(roller, M_RUBBER, BAIL)
    arm = cyl(0.0015, 0.03, (sx * 0.106, PY - 0.012, PZ + 0.008), rot=(math.radians(60), 0, 0), verts=12)
    finish(arm, M_CHROME, BAIL)

# carriage-return lever on the left
curve = bpy.data.curves.new("lever", "CURVE")
curve.dimensions = "3D"
curve.bevel_depth = 0.0028
curve.bevel_resolution = 6
sp = curve.splines.new("BEZIER")
pts = [(-0.140, PY - 0.004, PZ + 0.022), (-0.175, PY - 0.03, PZ + 0.03), (-0.205, PY - 0.07, PZ + 0.026)]
sp.bezier_points.add(len(pts) - 1)
for bp, co in zip(sp.bezier_points, pts):
    bp.co = co
    bp.handle_left_type = bp.handle_right_type = "AUTO"
lever = bpy.data.objects.new("lever", curve)
scene.collection.objects.link(lever)
lever.data.materials.append(M_CHROME)
CARRIAGE.append(lever)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0065, location=pts[-1])
finish(bpy.context.object, M_BAKELITE, CARRIAGE)

# ---------------------------------------------------------------- shadow catcher, lights, world, camera
bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0))
floor = bpy.context.object
floor.is_shadow_catcher = True

def area(name, loc, size, power, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA")
    l.size = size
    l.energy = power
    l.color = color
    o = bpy.data.objects.new(name, l)
    scene.collection.objects.link(o)
    o.location = loc
    d = Vector((0, 0, 0.05)) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o

area("key", (-0.55, -0.55, 0.85), 0.9, 95)
area("fill", (0.7, -0.45, 0.35), 0.8, 30, (0.95, 0.97, 1.0))
area("rim", (0.1, 0.7, 0.6), 0.7, 55)
area("top", (0.0, 0.0, 1.0), 0.6, 25)

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
ramp.color_ramp.elements[1].position = 0.75
ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
mr = nt.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = -1
mr.inputs["From Max"].default_value = 1
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.45

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 85
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -1.12, 0.58)
cam.rotation_euler = (Vector((0, 0.005, 0.07)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

# ---------------------------------------------------------------- layout export (pixel coords)
from bpy_extras.object_utils import world_to_camera_view
bpy.context.view_layer.update()
RX, RY = scene.render.resolution_x, scene.render.resolution_y
def px(co):
    v = world_to_camera_view(scene, cam, Vector(co))
    return [round(v.x * RX, 1), round((1 - v.y) * RY, 1)]

layout = {
    "size": [RX, RY],
    "keys": {},
    "platenTop": px((0, PY, PZ + PR)),
    "platenFront": px((0, PY - PR, PZ)),
    "bail": px((0, PY - PR - 0.004, PZ + 0.011)),
    "platenLeft": px((-0.131, PY, PZ + PR)),
    "platenRight": px((0.131, PY, PZ + PR)),
    "typePoint": px((0, PY - PR * 0.7, PZ + PR * 0.7)),
}
for k in key_meta + [space_meta]:
    c = px(k["center"])
    edge = px(k["center"] + Vector((k["r"] or 0.066, 0, 0)))
    layout["keys"][k["ch"]] = {"x": c[0], "y": c[1], "r": round(abs(edge[0] - c[0]) * (1 if k["r"] else 1), 1),
                               "h": round(abs(edge[0] - c[0]) * 0.18, 1) if not k["r"] else None}
with open(os.path.join(OUT, "layout.json"), "w") as f:
    json.dump(layout, f, indent=1)

if os.environ.get("LAYOUT_ONLY"):
    print("DONE layout", OUT)
    raise SystemExit(0)

# ---------------------------------------------------------------- renders
def render(path, retries=2):
    scene.render.filepath = os.path.join(OUT, path)
    for attempt in range(retries + 1):
        try:
            bpy.ops.render.render(write_still=True)
            return
        except RuntimeError as e:
            print("render failed", attempt, e)
            scene.cycles.device = "CPU"
    raise SystemExit(1)

def set_camera_visible(objs, visible):
    for o in objs:
        o.visible_camera = visible

def set_holdout(objs, holdout):
    for o in objs:
        o.is_holdout = holdout

# 1) body + keys, carriage invisible to the camera (still casts shadows)
set_camera_visible(CARRIAGE + BAIL, False)
render("body.png")

# 2) same with every key pressed down
for k in key_meta + [space_meta]:
    for p in k["parts"]:
        p.location.z -= 0.0032
        p.location.y += 0.0008
render("body_down.png")
for k in key_meta + [space_meta]:
    for p in k["parts"]:
        p.location.z += 0.0032
        p.location.y -= 0.0008

# 3) carriage only, body as holdout, no floor shadow
set_camera_visible(CARRIAGE, True)
set_holdout(BODY + KEYS, True)
floor.hide_render = True
render("carriage.png")

# 4) paper bail only (sits on top of the paper), everything else holdout
set_camera_visible(BAIL, True)
set_holdout(CARRIAGE, True)
render("bail.png")
print("DONE", OUT)
