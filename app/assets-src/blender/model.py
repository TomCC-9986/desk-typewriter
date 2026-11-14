"""Original mint portable typewriter, modelled in Blender (bpy), styled after a 1960s portable.

Run:
  Blender -b -P model.py -- preview <out.png> [samples]   # Cycles front still for review
  Blender -b -P model.py -- export  <out.glb>             # GLB for the app (no floor/lights)
  Blender -b -P model.py -- save    <out.blend> 0 side    # editable .blend with lights + camera
  Blender -b -P model.py -- blend   <out.blend>           # save .blend then open in GUI

Named nodes used by the app:
  key_<CHAR> (Q, W, …, digits, punctuation, "space"), bar_00..bar_35 (origin = pivot),
  carriage (parent of platen/knobs/frame/lever/bail), platen, lever, ribbon,
  print_point (empty at the printing point), platen_axis (empty at platen centre, scale.x = radius)
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["preview", "preview.png"]
MODE, OUT = argv[0], os.path.abspath(argv[1])
SAMPLES = int(argv[2]) if len(argv) > 2 else 48

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root = bpy.data.collections.new("machine")
scene.collection.children.link(root)

# ------------------------------------------------------------------ materials
def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

def mat(name, hexcol, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.06):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = coat_rough
    return m

def grain(m, rough_var=0.06, bump=0.0, scale=900.0, tint=None):
    """Vintage surface: roughness wobble, optional orange-peel bump, optional colour tint variation.
    Skipped for glTF export (procedural nodes don't survive it and the base colour would turn white)."""
    if MODE == "export" and os.environ.get("VINTAGE") != "1":
        return m
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    r0 = p.inputs["Roughness"].default_value
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = max(0.0, r0 - rough_var)
    mr.inputs["To Max"].default_value = r0 + rough_var
    nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], p.inputs["Roughness"])
    if bump:
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.0002
        nt.links.new(nz.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
        if "Coat Normal" in p.inputs:
            nt.links.new(b.outputs["Normal"], p.inputs["Coat Normal"])
    if tint:
        big = nt.nodes.new("ShaderNodeTexNoise")
        big.inputs["Scale"].default_value = 60
        nt.links.new(tc.outputs["Object"], big.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["A"].default_value = p.inputs["Base Color"].default_value
        mix.inputs["B"].default_value = (*srgb(tint), 1)
        nt.links.new(big.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], p.inputs["Base Color"])
    return m

M = {
    "mint": grain(mat("mint", "#9db6a4", 0.26, coat=0.7, coat_rough=0.14), 0.05, bump=0.08, scale=1400, tint="#97ad9c"),
    "cream": grain(mat("cream", "#e9dec3", 0.34, coat=0.4, coat_rough=0.2), 0.06, tint="#dccb9f"),
    "ink": mat("ink", "#141110", 0.5),
    "chrome": grain(mat("chrome", "#e2e2e2", 0.1, 1.0), 0.06, scale=500),
    "steel": mat("steel", "#9a9a9c", 0.32, 1.0),
    "dark": mat("dark", "#1c1c1d", 0.55),
    "well": mat("well", "#1d1915", 1.0),   # dark oily brown, not black
    "graphite": mat("graphite", "#3c3e40", 0.5, 0.6),
    "rubber": grain(mat("rubber", "#1b1b1b", 0.68), 0.08, bump=0.05, scale=2500),
    "bakelite": mat("bakelite", "#171717", 0.25, coat=0.6),
    "red": mat("red", "#c8402a", 0.35, coat=0.5),
    "bronze": grain(mat("bronze", "#8a6a43", 0.35, 0.95), 0.1, scale=700),
    "rim": mat("rim", "#2a2a2a", 0.3, 0.8),
    "ribbon": mat("ribbon", "#5a1a16", 0.75),
    "ribbon_red": mat("ribbon_red", "#9e2a22", 0.7),
    "cap_red": mat("cap_red", "#a4362b", 0.35, coat=0.4),
    "tray": mat("tray", "#16110d", 0.9),   # dark oily brown, as seen between the levers
    "typebar": mat("typebar", "#5d5a54", 0.5, 0.85),
    "mint_part": mat("mint_part", "#9db6a4", 0.3, coat=0.5, coat_rough=0.16),
}

for _k in ("tray", "well"):   # shadowed interiors: no glancing reflections of the room
    _p = M[_k].node_tree.nodes["Principled BSDF"]
    if "Specular IOR Level" in _p.inputs: _p.inputs["Specular IOR Level"].default_value = 0.0
# ------------------------------------------------------------------ helpers
def link(o, parent=None):
    if o.name not in root.objects:
        for c in o.users_collection:
            c.objects.unlink(o)
        root.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o

def shade(o, smooth=True):
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o

def bevel(o, width, segs=4, angle=None, harden=False):
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = width
    b.segments = segs
    if angle is None:
        b.limit_method = "NONE"
    else:
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(angle)
    b.harden_normals = harden
    return o

def set_mat(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    return o

def act():
    """Active object; works under Blender 5.x -P startup where context.object may be missing."""
    return bpy.context.view_layer.objects.active

def rbox(name, size, loc, m, r=0.004, segs=4, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = act()
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    shade(o); set_mat(o, m)
    if r:
        bevel(o, r, segs)
    return link(o, parent)

def cyl(name, r, depth, loc, m, rot=(0, 0, 0), verts=48, parent=None, smooth=True, bev=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = act()
    o.name = name
    shade(o, smooth); set_mat(o, m)
    if bev:
        bevel(o, bev, 3, angle=40)
    return link(o, parent)

def profile_extrude(name, profile, x0, x1, m, r=0.01, segs=6):
    """Side profile [(y, z), ...] extruded from x0 to x1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    L = [bm.verts.new((x0, y, z)) for y, z in profile]
    R = [bm.verts.new((x1, y, z)) for y, z in profile]
    bm.faces.new(L[::-1]); bm.faces.new(R)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((L[i], L[j], R[j], R[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    root.objects.link(o)
    shade(o); set_mat(o, m)
    if r:
        bevel(o, r, segs)
    return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    root.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o

def boolean(target, cutter, op="DIFFERENCE"):
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    # boolean must come before the bevel
    if "bevel" in target.modifiers:
        bpy.context.view_layer.objects.active = target
        while target.modifiers[0].name != "bool":
            bpy.ops.object.modifier_move_up(modifier="bool")
    cutter.hide_render = True
    cutter.hide_viewport = True
    return mod

# ------------------------------------------------------------------ dimensions (from refs/三视图.jpg)
# All three views share ~1400 px/m with the housing 461 px = 0.33 m wide. z includes 9 mm rubber feet.
W = 0.33          # housing width
HW = W / 2
TOP_Z = 0.2       # deck height (side view: 0.188 at the front roll rising to 0.209 at the back)
PANEL_Y = -0.0557 # front face of the housing (side view)
HOUSE_BACK = 0.101
TRIM_Z = 0.1432   # chrome line at the housing's lower front edge (front view z 0.145)
FEET = 0.009

def poly_prism(name, pts, axis, a0, a1):
    """Extrude a 2D polygon. axis 'x': pts are (y, z); 'y': pts are (x, z); 'z': pts are (x, y)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    def v3(p, a):
        u, w = p
        return (a, u, w) if axis == "x" else (u, a, w) if axis == "y" else (u, w, a)
    lo = [bm.verts.new(v3(p, a0)) for p in pts]; hi = [bm.verts.new(v3(p, a1)) for p in pts]
    bm.faces.new(lo); bm.faces.new(hi[::-1])
    for i in range(len(pts)):
        j = (i + 1) % len(pts); bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); root.objects.link(o); set_mat(o, M["mint"])
    return o
prism = lambda name, outline, z0, z1, m=None: (lambda o: (set_mat(o, m) if m else None, o)[1])(poly_prism(name, outline, "z", z0, z1))

def rounded_rect(x0, x1, y0, y1, r_front, r_back, n=10):
    pts = []
    for (cx, cy, r, a0) in ((x1 - r_front, y0 + r_front, r_front, -90), (x1 - r_back, y1 - r_back, r_back, 0),
                            (x0 + r_back, y1 - r_back, r_back, 90), (x0 + r_front, y0 + r_front, r_front, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

# ------------------------------------------------------------------ body: visual hull of the three views
# side view silhouette (y, z): low front lip, 43 deg keyboard cheek, housing with a big front roll rising to the back,
# then the low rear deck under the carriage
SIDE = [(-0.160, FEET), (-0.160, 0.0404), (-0.1505, 0.050), (-0.0557, 0.1240), (-0.0557, 0.1432),   # cheek edge ~36 deg (side view highlight line) (-0.0550, 0.1689),
        (-0.0462, 0.1836), (-0.0315, 0.1931), (-0.0021, 0.1975), (0.0493, 0.2048), (0.0970, 0.2093), (HOUSE_BACK, 0.2060),
        (HOUSE_BACK + 0.002, 0.1468), (0.209, 0.1468), (0.209, FEET)]
# front view silhouette, half (x, z): lower body flares out slightly toward the bottom, housing sides vertical
FRONT_HALF = [(0.1675, FEET), (0.168, 0.02), (0.167, 0.07), (0.1675, 0.13), (0.165, 0.15), (0.165, 0.19), (0.158, 0.205), (0.145, 0.214)]
FRONT = [(-x, z) for x, z in FRONT_HALF] + [(x, z) for x, z in reversed(FRONT_HALF)]
side = poly_prism("hull_side", SIDE, "x", -0.2, 0.2)
front = poly_prism("hull_front", FRONT, "y", -0.3, 0.3)
plan = poly_prism("hull_plan", rounded_rect(-0.169, 0.169, -0.160, 0.209, 0.03, 0.012), "z", -0.05, 0.4)
hull = side; hull.name = "hull"
boolean(hull, front, "INTERSECT")
boolean(hull, plan, "INTERSECT")
# keyboard pocket: thin 15 mm side walls, 10 mm front lip, floor sloping up toward the housing
KB_HALF = 0.150
pocket = poly_prism("pocket_cutter", [(-0.150, 0.02), (-0.150, 0.4), (-0.058, 0.4), (-0.058, 0.085)], "x", -KB_HALF, KB_HALF)
boolean(hull, pocket)
FLOOR_A, FLOOR_B = Vector((0, -0.150, 0.02)), Vector((0, -0.058, 0.085))
SLOPE = math.atan2(FLOOR_B.z - FLOOR_A.z, FLOOR_B.y - FLOOR_A.y)

# fan-shaped type-basket opening (top view): pointed side tips, an arc bulging toward the typist,
# and open at the back to the platen
# opening half-widths back-projected from the top photo onto the deck with its solved camera (proj/solve.py)
OPEN_PROFILE = [(0.135, 0.050), (0.094, 0.050), (0.082, 0.046), (0.069, 0.0475), (0.057, 0.0545), (0.044, 0.062), (0.032, 0.0745),
                (0.019, 0.0895), (0.010, 0.093), (0.000, 0.087), (-0.012, 0.073), (-0.022, 0.056), (-0.031, 0.037), (-0.037, 0.019), (-0.040, 0.0)]
def fan_outline(shrink=0.0, n=4):
    """Smooth closed outline through OPEN_PROFILE (mirrored), optionally shrunk inward."""
    prof = [(y, max(0.0, h - shrink)) for y, h in OPEN_PROFILE]
    prof[-1] = (prof[-1][0] + shrink, 0.0)
    dense = []   # Catmull-Rom through the profile for smooth flanks
    for i in range(len(prof) - 1):
        p0, p1, p2, p3 = prof[max(i - 1, 0)], prof[i], prof[i + 1], prof[min(i + 2, len(prof) - 1)]
        for k in range(n):
            t = k / n
            dense.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in range(2)))
    dense.append(prof[-1])
    right = [(max(0.0, h), y) for y, h in dense]                 # back -> front along x > 0
    left = [(-h, y) for h, y in reversed(right[:-1])]            # front -> back along x < 0
    return right + left
def inside_outline(x, y, poly):
    c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: c = not c
    return c
hole = prism("basket_cutter", fan_outline(), 0.1, 0.4)
boolean(hull, hole)
for o in (front, plan, pocket, hole):
    o.hide_render = True; o.hide_viewport = True

# ---- merge into one casting: apply mods, join, voxel-remesh, smooth ----
def apply_all(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.hide_viewport = False
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)

shell_parts = [hull]
for o in shell_parts:
    apply_all(o)
bpy.ops.object.select_all(action="DESELECT")
for o in shell_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = hull
bpy.ops.object.join()
shell = bpy.context.object
shell.name = "shell"
# round every edge like a die-cast body: SDF closing + opening (offset +r, -2r, +r), then back to a mesh
FILLET = float(os.environ.get("FILLET", "0.003"))   # pressed steel: small radii (big rolls are in the profiles)
gn = bpy.data.node_groups.new("cast_fillet", "GeometryNodeTree")
gn.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
gn.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
nin = gn.nodes.new("NodeGroupInput"); nout = gn.nodes.new("NodeGroupOutput")
sdf = gn.nodes.new("GeometryNodeMeshToSDFGrid")
sdf.inputs["Voxel Size"].default_value = float(os.environ.get("VOXEL", "0.0014"))
sdf.inputs["Band Width"].default_value = 24
prev = sdf.outputs[0]
gn.links.new(nin.outputs[0], sdf.inputs["Mesh"])
for d in (FILLET, -2 * FILLET, FILLET):
    off = gn.nodes.new("GeometryNodeSDFGridOffset")
    off.inputs["Distance"].default_value = d
    gn.links.new(prev, off.inputs["Grid"])
    prev = off.outputs[0]
tomesh = gn.nodes.new("GeometryNodeGridToMesh")
tomesh.inputs["Threshold"].default_value = 0.0   # SDF surface is the 0 level (node default 0.1 is for density grids)
gn.links.new(prev, tomesh.inputs["Grid"])
setm = gn.nodes.new("GeometryNodeSetMaterial")
setm.inputs["Material"].default_value = M["mint"]
gn.links.new(tomesh.outputs[0], setm.inputs["Geometry"])
gn.links.new(setm.outputs[0], nout.inputs[0])
gmod = shell.modifiers.new("cast", "NODES"); gmod.node_group = gn
sm = shell.modifiers.new("smooth", "CORRECTIVE_SMOOTH")
sm.factor = 0.5
sm.iterations = 4
sm.use_only_smooth = True
if MODE == "export":
    dec = shell.modifiers.new("decimate", "DECIMATE")
    dec.ratio = 0.3
shade(shell)

# dark well lining the opening
liner = prism("basket_liner", fan_outline(0.0012), 0.11, TOP_Z - 0.014, M["tray"])
lbm = bmesh.new(); lbm.from_mesh(liner.data)
bmesh.ops.delete(lbm, geom=[f for f in lbm.faces if abs(f.normal.z) > 0.9], context="FACES"); lbm.to_mesh(liner.data); lbm.free()
bf = prism("basket_floor", fan_outline(0.0015), 0.1, 0.12, M["well"])
# dark interior of the keyboard pocket (seen between the key levers)
pk_mid = (FLOOR_A + FLOOR_B) / 2
tray = rbox("tray", (2 * KB_HALF - 0.002, (FLOOR_B - FLOOR_A).length, 0.004), pk_mid + Vector((0, 0, 0.003)), M["tray"], r=0.001, rot=(SLOPE, 0, 0))

# chrome trim line along the housing's lower edge: straight across the front, rising along the sides
bpy.ops.mesh.primitive_cylinder_add(radius=0.0012, depth=W - 0.012, location=(0, PANEL_Y - 0.0012, TRIM_Z), rotation=(0, math.pi / 2, 0), vertices=16)
link(set_mat(shade(act()), M["chrome"])).name = "trim"
for sx in (-1, 1):
    a, b = Vector((sx * (HW + 0.0008), PANEL_Y + 0.006, TRIM_Z)), Vector((sx * (HW + 0.0008), HOUSE_BACK - 0.004, 0.156))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0012, depth=(b - a).length, location=(a + b) / 2, vertices=16)
    t = act(); t.rotation_mode = "QUATERNION"; t.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
    link(set_mat(shade(t), M["chrome"])).name = f"trim_side_{sx}"
for sx in (-1, 1):
    cyl(f"deck_screw_{sx}", 0.0012, 0.0008, (sx * 0.077, PANEL_Y - 0.0002, 0.166), M["graphite"], rot=(math.pi / 2, 0, 0), verts=16)
def bead(name, pts, r):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r; cu.bevel_resolution = 4; cu.use_fill_caps = True
    sp_ = cu.splines.new("POLY"); sp_.points.add(len(pts) - 1)
    for pt, v in zip(sp_.points, pts): pt.co = (*v, 1)
    o = bpy.data.objects.new(name, cu); root.objects.link(o); o.data.materials.append(M["mint_part"])   # flat colour: exports cleanly
    return o
BX = KB_HALF + 0.0028
cheek = lambda t: (-0.0580 + (-0.1490 + 0.0580) * t, 0.1228 + (0.0508 - 0.1228) * t)   # top edge of the cheek (side profile), back -> front
pts = [(-BX, *cheek(i / 12)) for i in range(13)]
pts += [(-BX + 0.006, -0.1515, 0.0475), (BX - 0.006, -0.1515, 0.0475)]
pts += [(BX, *cheek(1 - i / 12)) for i in range(13)]
bead("kb_bead", [(x, y, z + 0.0008) for x, y, z in pts], 0.0032)   # rolled edge round the keyboard opening
# rubber feet
for fx in (-0.13, 0.13):
    for fy in (-0.125, 0.175):
        cyl(f"foot_{fx}_{fy}", 0.013, FEET, (fx, fy, FEET / 2), M["rubber"], verts=32, bev=0.002)

# ------------------------------------------------------------------ keys
# (chars, x of first key, y, z of the key tops): x from the top view (1397 px/m, centre x 1476), y/z from the side view
PITCH = 0.0251
ROWS = [
    ("1234567890-", -0.1152, -0.0725, 0.1369),
    ("QWERTYUIOP",  -0.1057, -0.0915, 0.1141),
    ("ASDFGHJKL;",  -0.0990, -0.1090, 0.0958),
    ("ZXCVBNM.",    -0.0883, -0.1275, 0.0774),
]
SHIFTED = dict(zip("1234567890-", "!@#$%^&*()_"))
CAP_R = 0.0082

try:
    FONT = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf")   # bold geometric legends like the photo
except Exception as e:
    print("font", e); FONT = None
def letter(ch, loc, parent, size=0.0142):
    cu = bpy.data.curves.new(f"lbl_{ch}", "FONT")
    cu.body = ch
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.size = size
    cu.extrude = 0.00006
    if FONT and ch.isascii(): cu.font = FONT   # arrows etc. fall back to the default font
    t = bpy.data.objects.new(f"lbl_{ch}", cu)
    t.location = loc
    root.objects.link(t)
    t.data.materials.append(M["ink"])
    t.parent = parent
    return t

# ---- shared key-cap mesh: rounded-square (superellipse) cap, slightly tapered, dished top ----
CAP_W, CAP_D, CAP_H, CAP_DISH = 0.0198, 0.0190, 0.0128, 0.00035   # top view: 27 x 23 px caps   # photo: ~0.8 pitch, tall front face visible   # big chunky caps, ~86% of the pitch
def superellipse(n_pts, a, b, e=4.0):
    pts = []
    for i in range(n_pts):
        t = 2 * math.pi * i / n_pts
        c, s_ = math.cos(t), math.sin(t)
        pts.append((a * math.copysign(abs(c) ** (2 / e), c), b * math.copysign(abs(s_) ** (2 / e), s_)))
    return pts

def make_cap_mesh(name, w, d, h, dish):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    N = 48
    # (z, scale) loops from the bottom edge up over the rounded shoulder, then inward across the dished top
    loops = [(0.0, 1.0), (0.6 * h, 0.997), (0.82 * h, 0.985), (0.93 * h, 0.958), (0.985 * h, 0.92), (h, 0.875),   # boxy cap, small shoulder radius
             (h - dish * 0.45, 0.62), (h - dish * 0.85, 0.32)]
    rings = []
    for z, sc in loops:
        rings.append([bm.verts.new((x * sc, y * sc, z)) for x, y in superellipse(N, w / 2, d / 2, 4.2 if sc > 0.8 else 3.0)])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(N):
            j = (i + 1) % N
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    c = bm.verts.new((0, 0, h - dish))
    for i in range(N):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % N], c))
    bm.faces.new(rings[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    for p_ in me.polygons:
        p_.use_smooth = True
    return me

CAP_MESH = make_cap_mesh("cap_mesh", CAP_W, CAP_D, CAP_H, CAP_DISH)
CAP_MESH.materials.append(M["cream"])
CAP_MESH_RED = CAP_MESH.copy(); CAP_MESH_RED.materials[0] = M["cap_red"]
KEY_TILT = math.radians(3)   # side view: flat tops, vertical 12 mm front faces   # big top faces turned toward the typist   # caps face the typist

def keycap(name, x, y, w=0.0, label="", top=None, wide=1.0, upper=""):

    k = empty(f"key_{name}", (x, y, top))
    if w:
        cap = rbox(f"cap_{name}", (w, 0.0155, 0.006), (0, 0, 0), M["cream"], r=0.0028, segs=4, parent=k)
        cap.location = (0, 0, 0)
    else:
        cap = bpy.data.objects.new(f"cap_{name}", CAP_MESH)
        root.objects.link(cap); cap.parent = k
        cap.location = (0, 0, -CAP_H / 2)
        cap.rotation_euler = (KEY_TILT, 0, 0)
        cap.scale = (wide, 1, 1)
    # vertical steel key stem, then the dark key lever running back and down into the machine
    if not w:   # dark key neck under the cap (very visible in the photo), then the thin steel stem
        cyl(f"neck_{name}", 0.0042, 0.02, (0, 0.0012, -CAP_H / 2 - 0.01), M["dark"], verts=20, parent=k, bev=0.0008)   # long dark key neck (side view)
    cyl(f"stem_{name}", 0.0012, 0.02, (0, 0.0015, -CAP_H / 2 - 0.028), M["steel"], verts=10, parent=k)
    lev = rbox(f"lever_{name}", (0.0011, 0.05, 0.0024), (0, 0, 0), M["steel"], r=0, parent=k)   # thin steel key lever into the machine
    lev.location = (0, 0.0015 + 0.025 * math.cos(0.5), -CAP_H / 2 - 0.028 - 0.025 * math.sin(0.5))
    lev.rotation_euler = (-0.5, 0, 0)
    tilt = KEY_TILT if not w else 0.0
    h_ = (CAP_H - CAP_DISH * 0.2 + 0.00012) if not w else 0.0031   # just above the dish rim
    def place(t, dy):   # dy: offset along the cap top (+ = toward the back)
        t.rotation_euler = (tilt, 0, 0)
        t.location = (0, -math.sin(tilt) * h_ + math.cos(tilt) * dy, -CAP_H / 2 + math.cos(tilt) * h_ + math.sin(tilt) * dy)
    if upper:   # number row: shifted symbol above, figure below, both small (as on the reference)
        place(letter(upper, (0, 0, 0), k, size=0.0072), 0.0036)
        place(letter(label, (0, 0, 0), k, size=0.0078), -0.0034)
    elif label:
        place(letter(label, (0, 0, 0), k, size=0.0112 if len(label) == 1 and label.isalpha() else 0.009), 0.0)
    return k

for chars, x0, y, z in ROWS:
    for i, ch in enumerate(chars):
        keycap(ch, x0 + i * PITCH, y, label=ch, top=z, upper=SHIFTED.get(ch, ""))
# function keys at the row ends, placed as on the reference (no extra app keys: a normal keyboard)
keycap("tab", -0.138, ROWS[0][2] + 0.55 * (ROWS[1][2] - ROWS[0][2]), label="⇥", top=ROWS[0][3] + 0.55 * (ROWS[1][3] - ROWS[0][3]))
keycap("lock", -0.1245, ROWS[2][2] + 0.003, label="⇪", top=ROWS[2][3] + 0.002)
keycap("shiftL", -0.1217, ROWS[3][2], label="⇧", top=ROWS[3][3], wide=1.3)
keycap("shiftR", 0.1224, ROWS[3][2], label="⇧", top=ROWS[3][3], wide=1.3)
# space bar on two stems
sp = empty("key_space", (0.0, -0.147, 0.0592))   # side view: top 65 mm, front -154 mm   # clear in front of the bottom row (top view)   # front view: z 0.051; top view: 0.193 wide
rbox("cap_space", (0.193, 0.0135, 0.0115), (0, 0, 0), M["cream"], r=0.0026, segs=5, parent=sp).location = (0, 0, 0)   # flat bar resting just above the front lip
for sx in (-1, 1):
    cyl(f"stem_space{sx}", 0.0012, 0.03, (sx * 0.06, 0.006, -0.016), M["steel"], rot=(math.radians(-24), 0, 0), verts=10, parent=sp)

# ------------------------------------------------------------------ carriage
PY, PZ, PR = 0.148, 0.191, 0.0215   # side view knob centre; top view platen 60 px   # platen centre (y, z) and radius: just behind/above the housing
carriage = empty("carriage", (0, 0, 0))
platen = cyl("platen", PR, 0.30, (0, PY, PZ), M["rubber"], rot=(0, math.pi / 2, 0), verts=64, parent=carriage)
# chrome end frames + top rail + back paper table
for sx in (-1, 1):
    # side view: shaped green end plate round the knob (stepped top rising to the back, cut front-bottom corner)
    prof = [(-0.034, -0.03), (-0.022, -0.044), (0.046, -0.044), (0.052, -0.036), (0.052, 0.05), (0.044, 0.058),
            (0.016, 0.058), (0.004, 0.044), (-0.026, 0.036), (-0.036, 0.014)]
    fr = poly_prism(f"frame_{sx}", [(PY + a, PZ + b) for a, b in prof], "x", sx * 0.158, sx * 0.167)
    set_mat(fr, M["mint_part"]); shade(fr); bevel(fr, 0.0025, 3); fr.parent = carriage
    for (dy, dz, r_) in ((0.038, -0.006, 0.0032), (0.03, 0.03, 0.0012), (0.0, -0.04, 0.0012)):   # screw head + two small holes
        sc = cyl(f"screw_{sx}_{dy}", r_, 0.0016, (sx * (0.1675 + 0.0006), PY + dy, PZ + dz), M["steel"] if r_ > 0.002 else M["dark"], rot=(0, math.pi / 2, 0), verts=20, parent=carriage, bev=0.0006 if r_ > 0.002 else 0)
        if r_ > 0.002:
            rbox(f"slot_{sx}_{dy}", (0.0005, 0.0048, 0.0007), (sx * (0.1675 + 0.0015), PY + dy, PZ + dz), M["dark"], r=0, rot=(math.radians(35), 0, 0), parent=carriage)
    cyl(f"endboss_{sx}", 0.02, 0.006, (sx * 0.166, PY, PZ), M["mint_part"], rot=(0, math.pi / 2, 0), verts=48, parent=carriage, bev=0.002)
    # side mechanism: line-space block, ratchet housing, paper-release lever
    rbox(f"mech_{sx}", (0.01, 0.018, 0.016), (sx * 0.163, PY - 0.03, PZ + 0.018), M["steel"], r=0.002, parent=carriage)
    cyl(f"ratchet_{sx}", 0.014, 0.008, (sx * 0.17, PY, PZ), M["steel"], rot=(0, math.pi / 2, 0), verts=40, parent=carriage)
    rbox(f"release_{sx}", (0.004, 0.006, 0.03), (sx * 0.162, PY + 0.012, PZ + 0.04), M["chrome"], r=0.0015, rot=(math.radians(-15), 0, 0), parent=carriage)
    cyl(f"shaft_{sx}", 0.006, 0.02, (sx * 0.168, PY, PZ), M["chrome"], rot=(0, math.pi / 2, 0), verts=24, parent=carriage)
    cyl(f"ring_{sx}", 0.016, 0.004, (sx * 0.1665, PY, PZ), M["chrome"], rot=(0, math.pi / 2, 0), verts=40, parent=carriage, bev=0.001)
    knob = cyl(f"knob_{sx}", 0.022, 0.018, (sx * 0.177, PY, PZ), M["cream"], rot=(0, math.pi / 2, 0), verts=96, parent=carriage)
    for v in knob.data.vertices:  # knurling
        a = math.atan2(v.co.y, v.co.x)
        if round((a + math.pi) / (2 * math.pi) * 96) % 2:
            v.co.x *= 0.935; v.co.y *= 0.935
    bevel(knob, 0.003, 3, angle=50)
rbox("carriage_back", (0.31, 0.012, 0.075), (0, 0.199, 0.2), M["mint_part"], r=0.004, segs=3, parent=carriage)
rbox("carriage_back_top", (0.3, 0.03, 0.006), (0, 0.19, 0.236), M["mint_part"], r=0.0025, segs=3, parent=carriage)   # top view: flat green rail across the back
rbox("inner_frame", (0.27, 0.022, 0.006), (0, 0.176, 0.222), M["mint_part"], r=0.002, parent=carriage)   # top view: green inner frame behind the platen
rbox("inner_slot", (0.2, 0.012, 0.003), (0, 0.176, 0.2245), M["graphite"], r=0.001, parent=carriage)
for sx in (-1, 1):   # chrome levers standing up on the end plates (paper release, line space) -- side view
    rbox(f"release_lever_{sx}", (0.004, 0.008, 0.034), (sx * 0.156, PY + 0.022, PZ + 0.062), M["chrome"], r=0.0015, rot=(math.radians(-12), 0, 0), parent=carriage)
    rbox(f"linespace_{sx}", (0.004, 0.012, 0.026), (sx * 0.156, PY - 0.012, PZ + 0.058), M["chrome"], r=0.0015, rot=(math.radians(18), 0, 0), parent=carriage)
    cyl(f"margin_rod_{sx}", 0.0022, 0.03, (sx * 0.15, PY + 0.04, PZ + 0.05), M["steel"], rot=(0, math.pi / 2, 0), verts=12, parent=carriage)
for sx in (-1, 1):
    cyl(f"back_screw_{sx}", 0.0026, 0.0015, (sx * 0.133, 0.19, 0.2395), M["steel"], verts=20, parent=carriage, bev=0.0005)
rail = cyl("rail", 0.0045, 0.36, (0, PY + 0.02, PZ + 0.024), M["chrome"], rot=(0, math.pi / 2, 0), verts=24, parent=carriage)
# margin scale strip in front of the platen
rbox("scale", (0.26, 0.003, 0.006), (0, PY - PR - 0.009, PZ + 0.008), M["chrome"], r=0.0012, parent=carriage)
# paper bail with rollers
bail_y, bail_z = PY - PR - 0.0035, PZ + 0.014
bail = cyl("bail", 0.0018, 0.28, (0, bail_y, bail_z), M["chrome"], rot=(0, math.pi / 2, 0), verts=16, parent=carriage)
for i in range(-56, 57):   # engraved scale on the bail rod (reference: dotted markings along its length)
    if abs(abs(i * 0.0024) - 0.065) < 0.009: continue      # not under the rollers
    cyl(f"bail_tick_{i}", 0.00185, 0.0005 if i % 5 else 0.0009, (i * 0.0024, bail_y, bail_z), M["ink"], rot=(0, math.pi / 2, 0), verts=10, parent=carriage)
for sx in (-1, 1):
    cyl(f"bail_roller_{sx}", 0.0048, 0.014, (sx * 0.065, bail_y, bail_z), M["rubber"], rot=(0, math.pi / 2, 0), verts=24, parent=carriage)
    cyl(f"bail_arm_{sx}", 0.0018, 0.034, (sx * 0.142, PY - 0.013, PZ + 0.011), M["chrome"], rot=(math.radians(58), 0, 0), verts=12, parent=carriage)
# carriage-return lever (left), pivot at its base
lever = empty("lever", (-0.162, PY - 0.01, 0.236), parent=carriage)   # front view: blade at z 0.245 running left, tip down at z 0.193
def strap(name, pts, width, thick, m, parent, wdirs=None, widths=None):
    """Flat strip swept along pts. wdirs[i]: wanted width direction at each point (made perpendicular to the path)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new(); rings = []
    for i, p_ in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        want = wdirs[i] if wdirs else Vector((0, 0, 1))
        wv = (want - t * want.dot(t)).normalized(); nv = wv.cross(t).normalized()
        w_ = widths[i] if widths else width
        rings.append([bm.verts.new(p_ + wv * sx_ * w_ / 2 + nv * sz_ * thick / 2) for sx_, sz_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); root.objects.link(o); o.parent = parent
    shade(o); set_mat(o, m); bevel(o, 0.0009, 2)
    return o
def bez(p0, p1, p2, p3, n):
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]
# photo: runs out level to the left from the carriage top, then curls down into a broad spoon
arm = [Vector((-0.04 * t, -0.112 * t, 0.002 * t)) for t in (i / 20 for i in range(21))]           # level arm
# the spoon only dips 16 mm: its lowest point (z ~0.222) stays above the deck (<= 0.209) wherever the carriage slides
hook = bez(arm[-1], arm[-1] + Vector((-0.004, -0.012, 0.0)), arm[-1] + Vector((-0.006, -0.02, -0.007)), arm[-1] + Vector((-0.006, -0.02, -0.016)), 16)
path = arm + hook[1:]   # side view: level at z 0.238, ends near y 0   # top view: reaches forward to the housing front
side = Vector((0.942, -0.336, 0))          # horizontal, across the arm in plan
n_arm = len(arm)
wd = [Vector((0, 0, 1)) if i < n_arm else Vector((0, 0, 1)).lerp(side, min(1, (i - n_arm + 1) / 6)) for i in range(len(path))]
ws = [0.008 if i < n_arm else 0.008 + 0.006 * min(1, (i - n_arm + 1) / 8) for i in range(len(path))]   # on edge along the arm, broad spoon at the end
strap("lever_tube", path, 0.011, 0.003, M["chrome"], lever, wdirs=wd, widths=ws)
rbox("lever_ball", (0.012, 0.016, 0.012), (0, 0, 0), M["chrome"], r=0.003, parent=lever).location = (0.004, 0.002, -0.004)   # pivot bracket

# printing point + platen axis markers for the app
PRINT = Vector((0, PY - math.cos(math.radians(8)) * (PR + 0.0006), PZ - math.sin(math.radians(8)) * (PR + 0.0006)))
empty("print_point", PRINT)
ax = empty("platen_axis", (0, PY, PZ))
ax.scale = (PR, PR, PR)

# ------------------------------------------------------------------ type basket: bars fanned in the scoop
SEG_C = Vector((0, PRINT.y, TOP_Z - 0.09))   # segment arc centre, under the basket floor (bars hidden at rest)
SEG_R = 0.02
for i in range(36):
    a = math.radians(-62 + i * (124 / 35))
    pivot = SEG_C + Vector((math.sin(a) * SEG_R, -math.cos(a) * SEG_R, 0))
    rest_dir = Vector((math.sin(a), -math.cos(a), -1.8)).normalized()  # parked steeply down inside the body; the visible fan is decorative
    length = (PRINT - pivot).length - 0.002
    piv = empty(f"bar_{i:02d}", pivot)
    # orient the empty so local +Y points along the bar at rest
    piv.rotation_mode = "QUATERNION"
    piv.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(rest_dir)
    b = rbox(f"barmesh_{i:02d}", (0.0018, length, 0.0016), (0, length / 2, 0), M["bronze"], r=0, parent=piv)
    b.location = (0, length / 2, 0)
    rbox(f"slug_{i:02d}", (0.0036, 0.0065, 0.0038), (0, length - 0.003, 0.0008), M["bronze"], r=0.0007, segs=2, parent=piv).location = (0, length - 0.003, 0.0008)
# decorative basket seen through the opening: bars lie in a shallow bowl, converging toward the printing point
FAN_C = Vector((0, PRINT.y - 0.004, TOP_Z - 0.014))
OPEN_PTS = fan_outline()
for i in range(48):   # semicircular fan, heads lined up just inside the front curve
    a = math.radians(-50 + i * (100 / 47))
    d = Vector((math.sin(a), -math.cos(a), 0))
    r0 = 0.035
    r1 = r0
    while inside_outline(FAN_C.x + d.x * (r1 + 0.012), FAN_C.y + d.y * (r1 + 0.012), OPEN_PTS): r1 += 0.002   # stop ~1 cm inside the rim
    p0 = FAN_C + d * r0; p1 = FAN_C + d * r1 + Vector((0, 0, -0.016))   # outer ends sit lower
    mid = (p0 + p1) / 2; L_ = (p1 - p0).length
    bar = rbox(f"fan_{i:02d}", (0.0013, L_, 0.0022), mid, M["typebar"], r=0)
    bar.rotation_mode = "QUATERNION"; bar.rotation_quaternion = Vector((0, 1, 0)).rotation_difference((p0 - p1).normalized())
    head = rbox(f"fanhead_{i:02d}", (0.0034, 0.008, 0.004), p1 + Vector((0, 0, 0.0015)), M["typebar"], r=0.0007, segs=2)
    head.rotation_euler = (0, 0, a)
# segment: chrome half ring the bars pivot in
seg = cyl("segment", 0.03, 0.004, FAN_C + Vector((0, 0, -0.008)), M["graphite"], verts=64, bev=0.001)   # dark, below the bars
# visible type guide: chrome plate with a U-shaped top just in front of the paper
rbox("guide_plate", (0.016, 0.0025, 0.02), (0, PRINT.y - 0.009, TOP_Z - 0.006), M["chrome"], r=0.001)
for sx in (-1, 1):
    rbox(f"guide_ear_{sx}", (0.0022, 0.0025, 0.007), (sx * 0.0075, PRINT.y - 0.009, TOP_Z - 0.006), M["chrome"], r=0.0008)   # kept below the printing line so the fresh text stays readable
    cyl(f"guide_screw_{sx}", 0.0016, 0.001, (sx * 0.005, PRINT.y - 0.0105, TOP_Z - 0.012), M["dark"], rot=(math.pi / 2, 0, 0), verts=14)
# thin chrome card-holder wire loop over the type guide (front view: tall narrow arch)
loop = [Vector((math.sin(t) * 0.0055 * (1 if abs(t) < math.pi / 2 else 1), PRINT.y - 0.0085, TOP_Z - 0.004 + 0.016 * math.cos(t))) for t in (math.pi * (k / 20 - 0.5) for k in range(21))]
cu = bpy.data.curves.new("card_holder", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0006; cu.bevel_resolution = 2
sp_ = cu.splines.new("POLY"); sp_.points.add(len(loop) - 1)
for pt, v in zip(sp_.points, loop): pt.co = (v.x, v.y, v.z, 1)
ch_ = bpy.data.objects.new("card_holder", cu); root.objects.link(ch_); ch_.data.materials.append(M["chrome"])
if MODE == "export": ch_.hide_render = True   # in the app it would sit over the freshly typed letter
# type guide + ribbon vibrator in front of the printing point
rbox("type_guide", (0.014, 0.004, 0.014), (0, PRINT.y - 0.006, PRINT.z - 0.006), M["chrome"], r=0.0015)
rbox("ribbon", (0.032, 0.0008, 0.0075), (0, PRINT.y - 0.0018, PRINT.z - 0.008), M["ribbon"], r=0)
for k_, mat_ in ((0, M["ribbon"]), (1, M["ribbon_red"])):
    rbox(f"ribbon_band_{k_}", (0.17, 0.0006, 0.0034), (0, PRINT.y - 0.012, TOP_Z - 0.001 - k_ * 0.0034), mat_, r=0)   # black/red ribbon across the back of the opening

# ------------------------------------------------------------------ vintage mode (materials)
VINTAGE = os.environ.get("VINTAGE") == "1"

def age(m, grime=0.6, dust=0.25, wear=0.25, grime_col="#4a3d2a", dust_col="#d6c9a8", wear_col="#e3dbc3"):
    """Crevice grime (AO), dust on up-facing surfaces, worn convex edges (pointiness)."""
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    inp = p.inputs["Base Color"]
    src = inp.links[0].from_socket if inp.is_linked else None
    base = tuple(inp.default_value)
    def mixer(a_socket, a_val, col, fac_socket):
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MIX"
        if a_socket is not None: nt.links.new(a_socket, mx.inputs["A"])
        else: mx.inputs["A"].default_value = a_val
        mx.inputs["B"].default_value = (*srgb(col), 1)
        nt.links.new(fac_socket, mx.inputs["Factor"])
        return mx.outputs["Result"]
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.samples = 16; ao.inputs["Distance"].default_value = 0.012; ao.only_local = True
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(ao.outputs["AO"], inv.inputs[1])
    gm = nt.nodes.new("ShaderNodeMath"); gm.operation = "MULTIPLY"; gm.inputs[1].default_value = grime; gm.use_clamp = True
    nt.links.new(inv.outputs[0], gm.inputs[0])
    out = mixer(src, base, grime_col, gm.outputs[0])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Normal"], sep.inputs[0])
    up = nt.nodes.new("ShaderNodeMapRange"); up.inputs["From Min"].default_value = 0.55; up.inputs["From Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], up.inputs["Value"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 260; nz.inputs["Detail"].default_value = 8
    sp = nt.nodes.new("ShaderNodeMapRange"); sp.inputs["From Min"].default_value = 0.5; sp.inputs["From Max"].default_value = 0.75
    nt.links.new(nz.outputs["Fac"], sp.inputs["Value"])
    dm = nt.nodes.new("ShaderNodeMath"); dm.operation = "MULTIPLY"; nt.links.new(up.outputs["Result"], dm.inputs[0]); nt.links.new(sp.outputs["Result"], dm.inputs[1])
    dm2 = nt.nodes.new("ShaderNodeMath"); dm2.operation = "MULTIPLY"; dm2.inputs[1].default_value = dust; nt.links.new(dm.outputs[0], dm2.inputs[0])
    out = mixer(out, None, dust_col, dm2.outputs[0])
    wm = nt.nodes.new("ShaderNodeMapRange"); wm.inputs["From Min"].default_value = 0.52; wm.inputs["From Max"].default_value = 0.58
    nt.links.new(geo.outputs["Pointiness"], wm.inputs["Value"])
    wm2 = nt.nodes.new("ShaderNodeMath"); wm2.operation = "MULTIPLY"; wm2.inputs[1].default_value = wear; nt.links.new(wm.outputs["Result"], wm2.inputs[0])
    out = mixer(out, None, wear_col, wm2.outputs[0])
    nt.links.new(out, inp)
    return m

def chips(m, amount=0.8, col="#55554d"):
    """Paint chipped off convex edges: pointiness edge mask x high-contrast noise -> dark primer."""
    nt = m.node_tree; p = nt.nodes["Principled BSDF"]; inp = p.inputs["Base Color"]
    src = inp.links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    e = nt.nodes.new("ShaderNodeMapRange"); e.inputs["From Min"].default_value = 0.505; e.inputs["From Max"].default_value = 0.54
    nt.links.new(geo.outputs["Pointiness"], e.inputs["Value"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 140; nz.inputs["Detail"].default_value = 10; nz.inputs["Roughness"].default_value = 0.7
    th = nt.nodes.new("ShaderNodeMapRange"); th.inputs["From Min"].default_value = 0.55; th.inputs["From Max"].default_value = 0.6
    nt.links.new(nz.outputs["Fac"], th.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.use_clamp = True
    nt.links.new(e.outputs["Result"], mul.inputs[0]); nt.links.new(th.outputs["Result"], mul.inputs[1])
    # scattered pin-head chips on flat areas (photo: dark dots all over the deck and lip)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vo = nt.nodes.new("ShaderNodeTexVoronoi"); vo.inputs["Scale"].default_value = 60; vo.feature = "F1"
    wob = nt.nodes.new("ShaderNodeTexNoise"); wob.inputs["Scale"].default_value = 400; nt.links.new(tc.outputs["Object"], wob.inputs["Vector"])
    vin = nt.nodes.new("ShaderNodeMix"); vin.data_type = "VECTOR"; vin.inputs["Factor"].default_value = 0.004   # ragged chip outlines
    nt.links.new(tc.outputs["Object"], vin.inputs[4]); nt.links.new(wob.outputs["Color"], vin.inputs[5])
    nt.links.new(vin.outputs[1], vo.inputs["Vector"])
    rnd = nt.nodes.new("ShaderNodeMapRange"); rnd.inputs["From Min"].default_value = 0.9; rnd.inputs["From Max"].default_value = 0.91   # only a few cells
    sepc = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(vo.outputs["Color"], sepc.inputs["Color"])
    nt.links.new(sepc.outputs[0], rnd.inputs["Value"])   # one uniform random per cell (the RGB average was almost never > 0.9)
    dot = nt.nodes.new("ShaderNodeMapRange"); dot.inputs["From Min"].default_value = 0.11; dot.inputs["From Max"].default_value = 0.07   # small dot at the cell centre
    nt.links.new(vo.outputs["Distance"], dot.inputs["Value"])
    spot = nt.nodes.new("ShaderNodeMath"); spot.operation = "MULTIPLY"; spot.use_clamp = True
    nt.links.new(rnd.outputs["Result"], spot.inputs[0]); nt.links.new(dot.outputs["Result"], spot.inputs[1])
    both = nt.nodes.new("ShaderNodeMath"); both.operation = "MAXIMUM"
    nt.links.new(mul.outputs[0], both.inputs[0]); nt.links.new(spot.outputs[0], both.inputs[1])
    mul = both
    amt = nt.nodes.new("ShaderNodeMath"); amt.operation = "MULTIPLY"; amt.inputs[1].default_value = amount
    nt.links.new(mul.outputs[0], amt.inputs[0])
    mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
    nt.links.new(src, mx.inputs["A"]); mx.inputs["B"].default_value = (*srgb(col), 1)
    nt.links.new(amt.outputs[0], mx.inputs["Factor"])
    nt.links.new(mx.outputs["Result"], inp)

def patina(m):
    """Old enamel as on the three-view sheet: blotchy tone, fine speckle, chipped bottom edge showing primer with
    rusty rims, thin scratches, the seam line ~1 cm above the base, satin roughness variation."""
    nt = m.node_tree; p = nt.nodes["Principled BSDF"]; inp = p.inputs["Base Color"]
    src = inp.links[0].from_socket
    tc = nt.nodes.new("ShaderNodeTexCoord"); obj = tc.outputs["Object"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(obj, sep.inputs[0])
    def noise(scale, detail=6, rough=0.6, vec=None):
        n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail; n.inputs["Roughness"].default_value = rough
        nt.links.new(vec or obj, n.inputs["Vector"]); return n.outputs["Fac"]
    def maprange(v, a, b, lo=0.0, hi=1.0):
        r = nt.nodes.new("ShaderNodeMapRange"); r.inputs["From Min"].default_value = a; r.inputs["From Max"].default_value = b
        r.inputs["To Min"].default_value = lo; r.inputs["To Max"].default_value = hi; nt.links.new(v, r.inputs["Value"]); return r.outputs["Result"]
    def math_(op, a, b=None, clamp=True):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = op; n.use_clamp = clamp
        (nt.links.new(a, n.inputs[0]) if not isinstance(a, float) else n.inputs[0].__setattr__("default_value", a))
        if b is not None: (nt.links.new(b, n.inputs[1]) if not isinstance(b, float) else n.inputs[1].__setattr__("default_value", b))
        return n.outputs[0]
    def mix(a, col, fac, blend="MIX"):
        x = nt.nodes.new("ShaderNodeMix"); x.data_type = "RGBA"; x.blend_type = blend
        nt.links.new(a, x.inputs["A"]); x.inputs["B"].default_value = (*srgb(col), 1) if isinstance(col, str) else col
        (nt.links.new(fac, x.inputs["Factor"]) if not isinstance(fac, float) else x.inputs["Factor"].__setattr__("default_value", fac))
        return x.outputs["Result"]
    out = src
    # blotchy tone: big soft patches a little lighter / darker
    blot = noise(14, 3, 0.5)
    out = mix(out, "#6a6f52", maprange(blot, 0.45, 0.75, 0.0, 0.5))         # darker, browner patches
    out = mix(out, "#b7b99b", maprange(blot, 0.45, 0.2, 0.0, 0.3))          # faded lighter patches
    out = mix(out, "#737858", maprange(noise(45, 5, 0.6), 0.55, 0.75, 0.0, 0.3))   # medium mottling
    # fine speckle
    out = mix(out, "#5d604a", maprange(noise(900, 2, 0.5), 0.58, 0.7, 0.0, 0.6))
    # chipped base edge: noisy band along the bottom (and the lowest few mm of the lip)
    # edges: Cycles bevel normal vs true normal -> 1 on rounded edges/corners
    bev = nt.nodes.new("ShaderNodeBevel"); bev.inputs["Radius"].default_value = 0.004; bev.samples = 8
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dp = nt.nodes.new("ShaderNodeVectorMath"); dp.operation = "DOT_PRODUCT"
    nt.links.new(bev.outputs["Normal"], dp.inputs[0]); nt.links.new(geo.outputs["Normal"], dp.inputs[1])
    edge = maprange(dp.outputs["Value"], 0.985, 0.94)
    low = math_("MAXIMUM", maprange(sep.outputs["Z"], 0.017, 0.011), math_("MULTIPLY", edge, 0.8))   # base band + every worn edge
    ragged = maprange(noise(140, 8, 0.72), 0.53, 0.6)
    chip = math_("MULTIPLY", low, ragged)
    chip.node.name = "CHIP_MASK"
    rim = math_("SUBTRACT", maprange(noise(140, 8, 0.72), 0.48, 0.53), ragged)
    out = mix(out, "#5a3f28", math_("MULTIPLY", low, rim))                   # rusty rim round each chip
    out = mix(out, "#cfc6a8", chip)                                          # pale primer showing through
    # a few dark pin chips and rust dots over the whole body
    dots = maprange(noise(220, 2, 0.4), 0.74, 0.78)
    out = mix(out, "#3d3326", math_("MULTIPLY", dots, 0.85))
    # thin scratches (stretched noise)
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (2.0, 60.0, 60.0); nt.links.new(obj, mp.inputs["Vector"])
    scr = maprange(noise(30, 4, 0.6, mp.outputs["Vector"]), 0.71, 0.73)
    out = mix(out, "#c4c0a6", math_("MULTIPLY", scr, 0.6))
    # seam line just above the base
    seam = math_("MULTIPLY", maprange(sep.outputs["Z"], 0.0168, 0.0175), maprange(sep.outputs["Z"], 0.0188, 0.0181))
    out = mix(out, "#3a3a2e", math_("MULTIPLY", seam, 0.8))
    nt.links.new(out, inp)
    # satin enamel: roughness varies with the patina, chips are matte
    r = p.inputs["Roughness"]
    for l in list(r.links): nt.links.remove(l)
    rr = maprange(blot, 0.2, 0.8, 0.3, 0.46)
    nt.links.new(math_("MAXIMUM", rr, math_("MULTIPLY", chip, 0.75)), r)
    p.inputs["Coat Weight"].default_value = 0.35; p.inputs["Coat Roughness"].default_value = 0.22

def recolor(m, hexcol=None, rough=None, coat=None, coat_rough=None):
    p = m.node_tree.nodes["Principled BSDF"]
    if hexcol:
        for l in list(p.inputs["Base Color"].links): m.node_tree.links.remove(l)
        p.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    if rough is not None:
        for l in list(p.inputs["Roughness"].links): m.node_tree.links.remove(l)
        p.inputs["Roughness"].default_value = rough
    if coat is not None: p.inputs["Coat Weight"].default_value = coat
    if coat_rough is not None: p.inputs["Coat Roughness"].default_value = coat_rough

if VINTAGE:  # aged materials (renders and baked export)
    # aged lacquer: warmer, yellowed green, satin
    recolor(M["mint"], "#879a80", rough=0.32, coat=0.6, coat_rough=0.16)   # glossy aged sage enamel (sampled off the photo)
    grain(M["mint"], 0.1, bump=0.18, scale=900)
    age(M["mint"], grime=0.9, dust=0.12, wear=0.45)
    chips(M["mint"], amount=0.9, col="#4d473b")
    patina(M["mint"])
    recolor(M["mint_part"], "#879a80", rough=0.32, coat=0.6, coat_rough=0.16)
    age(M["mint_part"], grime=0.9, dust=0.1, wear=0.4)
    recolor(M["cream"], "#d9c8a3", coat=0.3, coat_rough=0.25)   # photo caps: pale cream, not tan
    grain(M["cream"], 0.08, tint="#d9cdb0")
    age(M["cream"], grime=0.7, dust=0.15, wear=0.0, grime_col="#5a4a30")
    recolor(M["chrome"], "#d6cbb6", rough=0.2)
    grain(M["chrome"], 0.12, scale=350)
    age(M["chrome"], grime=0.8, dust=0.2, wear=0.0, grime_col="#3d3326")
    recolor(M["bronze"], "#8c877e", rough=0.3)   # nickel type bars, as seen through the opening
    recolor(M["rubber"], "#262422", rough=0.8)
    recolor(M["ink"], "#17130f")

def use_gpu():
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices: d.use = True
        if hasattr(prefs, "metalrt"): prefs.metalrt = "OFF"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("GPU", e)

def project_photos(o, img):
    """Paint the real photo onto the shell texture: top photo (solved perspective camera) on upward faces,
    side photo (orthographic, as matched before) on the side panels. Lighting is divided out with a broad blur."""
    import json, numpy as np
    deps = os.path.join(os.getcwd(), ".pydeps")   # opencv-python-headless installed with --target (Blender's python has none)
    if deps not in sys.path: sys.path.insert(0, deps)
    try:
        import cv2
    except ImportError:
        print("PROJ: no cv2 in Blender python, skipped"); return
    here = os.getcwd()
    ref = cv2.imread(os.path.join(here, "../../../refs/三视图.png"))[..., ::-1].astype(np.float32) / 255.0
    cams = json.load(open(os.path.join(here, "proj", "cams.json")))
    N = img.size[0]
    # bake world position and normal into float images (same UVs as the colour)
    nt = o.active_material.node_tree if o.active_material else M["mint"].node_tree
    nt = M["mint"].node_tree
    geo = nt.nodes.new("ShaderNodeNewGeometry"); em = nt.nodes.new("ShaderNodeEmission")
    mo = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]; nt.links.new(em.outputs[0], mo.inputs["Surface"])
    tnode = [n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image == img][0]
    def bake_vec(sock, name):
        b = bpy.data.images.new(name, N, N, float_buffer=True); b.colorspace_settings.name = "Non-Color"
        nt.links.new(sock, em.inputs["Color"]); tnode.image = b; nt.nodes.active = tnode
        bpy.ops.object.bake(type="EMIT", margin=16)
        return np.array(b.pixels[:], dtype=np.float32).reshape(N, N, 4)[..., :3]
    P = bake_vec(geo.outputs["Position"], "pos"); Nn = bake_vec(geo.outputs["Normal"], "nrm")
    tnode.image = img
    col = np.array(img.pixels[:], dtype=np.float32).reshape(N, N, 4)
    valid = np.linalg.norm(Nn, axis=2) > 0.5
    lum = ref @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hsv = cv2.cvtColor((ref * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    body = (hsv[..., 0] >= 22) & (hsv[..., 0] <= 70) & (hsv[..., 1] >= 18) & (hsv[..., 2] >= 60)   # sage paint (not keys, metal, background)
    paintish = body | ((hsv[..., 1] >= 40) & (hsv[..., 0] <= 22) & (hsv[..., 2] < 170))             # + rust/brown chips
    m = paintish.astype(np.float32)
    blur = cv2.GaussianBlur(lum * m, (0, 0), 18) / np.maximum(cv2.GaussianBlur(m, (0, 0), 18), 1e-3)
    def sample(u, v):
        uu, vv = u.astype(np.float32), v.astype(np.float32)
        c = cv2.remap(ref, uu, vv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        b = cv2.remap(blur, uu, vv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        ok = cv2.remap(paintish.astype(np.float32), uu, vv, cv2.INTER_LINEAR) > 0.6
        return c, b, ok
    sm = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    X, Y, Z = P[..., 0], P[..., 1], P[..., 2]
    acc = np.zeros((N, N, 3), np.float32); wsum = np.zeros((N, N), np.float32)
    # --- top photo, solved camera
    c = cams["top"]
    Rm = cv2.Rodrigues(np.array(c["rvec"]))[0].astype(np.float32); t = np.array(c["tvec"], np.float32)
    Pc = P @ Rm.T + t
    u = c["f"] * Pc[..., 0] / Pc[..., 2] + c["cx"]; v = c["f"] * Pc[..., 1] / Pc[..., 2] + c["cy"]
    camw = -Rm.T @ t; vd = camw[None, None, :] - P; vd /= np.linalg.norm(vd, axis=2, keepdims=True)
    facing = np.sum(Nn * vd, axis=2)
    ct, bt, okt = sample(u, v)
    wt = sm(0.55, 0.85, facing) * sm(0.6, 0.8, Nn[..., 2]) * okt * valid * (Y < 0.088) * (Z > 0.17)   # the deck only
    # --- side photo, orthographic (right view; the left panel gets it mirrored)
    us = 875 + (Y - 0.0309) * 1362; vs = 450 - (Z - 0.1836) * 1362
    cs, bs, oks = sample(us, vs)
    ws = sm(0.6, 0.9, np.abs(Nn[..., 0])) * oks * valid * ~((Y > 0.085) & (Z > 0.14)) * (Z > 0.012)
    target = float(np.median(blur[body]))
    for cc, bb, ww in ((ct, bt, wt), (cs, bs, ws)):
        flat = cc * (target / np.maximum(bb, 0.05))[..., None]   # divide out the photo's light
        fl = flat @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        flat *= np.minimum(1.0, 1.12 * target / np.maximum(fl, 1e-4))[..., None]   # the photo's own specular highlights are not paint
        acc += flat * ww[..., None]; wsum += ww
    w = np.clip(wsum, 0, 1)[..., None]
    photo = acc / np.maximum(wsum, 1e-4)[..., None]
    col[..., :3] = col[..., :3] * (1 - w) + np.clip(photo, 0, 1) * w
    img.pixels[:] = col.ravel()
    print("PROJ: painted", int((wsum > 0.5).sum()), "texels from the photos")

def bake_shell():
    """Bake the aged enamel colour (grime/dust/wear/tint) of the decimated shell into a texture for the app."""
    o = bpy.data.objects["shell"]
    apply_all(o)
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("shell_color", 2048, 2048)
    nt = M["mint"].node_tree
    node = nt.nodes.new("ShaderNodeTexImage"); node.image = img; nt.nodes.active = node
    scene.render.engine = "CYCLES"; scene.cycles.samples = 64; use_gpu()
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=16)
    except RuntimeError as e:
        print("GPU bake failed, CPU", e); scene.cycles.device = "CPU"
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=16)
    if os.environ.get("PROJ", "1") == "1":
        project_photos(o, img)
    path = os.path.join(os.getcwd(), "tex", "shell_baked.png")
    img.filepath_raw = path; img.file_format = "PNG"; img.save()
    metal = None
    if "CHIP_MASK" in nt.nodes:   # where the paint is chipped off, bare steel shows: bake that mask for metalness
        em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(nt.nodes["CHIP_MASK"].outputs[0], em.inputs["Color"])
        mo = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]; nt.links.new(em.outputs[0], mo.inputs["Surface"])
        metal = bpy.data.images.new("shell_metal", 2048, 2048); metal.colorspace_settings.name = "Non-Color"
        node.image = metal; nt.nodes.active = node
        bpy.ops.object.bake(type="EMIT", margin=16)
        mpath = os.path.join(os.getcwd(), "tex", "shell_metal.png"); metal.filepath_raw = mpath; metal.file_format = "PNG"; metal.save()
        print("BAKED", mpath)
    baked = bpy.data.materials.new("enamel_baked"); baked.use_nodes = True
    bt = baked.node_tree; bp = bt.nodes["Principled BSDF"]
    tn = bt.nodes.new("ShaderNodeTexImage"); tn.image = img
    bt.links.new(tn.outputs["Color"], bp.inputs["Base Color"])
    if metal:
        tm = bt.nodes.new("ShaderNodeTexImage"); tm.image = metal
        sc = bt.nodes.new("ShaderNodeSeparateColor"); bt.links.new(tm.outputs["Color"], sc.inputs["Color"])
        bt.links.new(sc.outputs["Blue"], bp.inputs["Metallic"])
    bp.inputs["Roughness"].default_value = 0.4
    bp.inputs["Coat Weight"].default_value = 0.8
    bp.inputs["Coat Roughness"].default_value = 0.1
    o.data.materials.clear(); o.data.materials.append(baked)
    print("BAKED", path)

def apply_calib(flat=False):
    """Per-material linear RGB multipliers solved against the reference photo by match/calibrate.py."""
    path = os.environ.get("CALIB") or os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.getcwd(), "match", "calib.json")
    if not os.path.exists(path): return
    import json
    for key, k in json.load(open(path)).items():
        m = M.get(key) or bpy.data.materials.get(key)
        if m is None: continue
        nt = m.node_tree; p_ = nt.nodes["Principled BSDF"]; inp = p_.inputs["Base Color"]
        if flat or not inp.is_linked:
            c = inp.default_value; inp.default_value = (min(1, c[0] * k[0]), min(1, c[1] * k[1]), min(1, c[2] * k[2]), 1)
            continue
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"; mx.inputs["Factor"].default_value = 1.0
        nt.links.new(inp.links[0].from_socket, mx.inputs["A"]); mx.inputs["B"].default_value = (*k, 1)
        nt.links.new(mx.outputs["Result"], inp)
# ------------------------------------------------------------------ output
def bake_curves_and_mods():
    bpy.context.view_layer.update()
    for o in list(root.objects):
        if o.type in {"FONT", "CURVE"}:
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.convert(target="MESH")

if MODE == "blend":
    bake_curves_and_mods()
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("SAVED", OUT)
    raise SystemExit(0)

if MODE == "export":
    if VINTAGE:
        apply_calib_mint = True
        _cal = {}
        try:
            import json; _cal = json.load(open(os.path.join(os.getcwd(), "match", "calib_3view.json")))
        except Exception: pass
        # three-view sheet was shot under neutral light: full strength
        if "mint" in _cal:   # bake the photo-calibrated enamel
            m = M["mint"]; nt = m.node_tree; inp = nt.nodes["Principled BSDF"].inputs["Base Color"]
            mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"; mx.inputs["Factor"].default_value = 1.0
            nt.links.new(inp.links[0].from_socket, mx.inputs["A"]); mx.inputs["B"].default_value = (*_cal["mint"], 1); nt.links.new(mx.outputs["Result"], inp)
        bake_shell()
        # procedural colour chains don't survive glTF: give the small parts flat aged colours
        for key, col, rough in (("mint_part", "#8e9e87", 0.5), ("cream", "#d8c9a7", 0.38), ("chrome", "#d2c7b1", 0.24), ("bronze", "#8c877e", 0.32), ("rubber", "#262422", 0.8), ("ink", "#17130f", 0.55)):
            m = M[key]; nt = m.node_tree; p_ = nt.nodes["Principled BSDF"]
            for inp in ("Base Color", "Roughness", "Normal", "Coat Normal"):
                if inp in p_.inputs:
                    for l in list(p_.inputs[inp].links): nt.links.remove(l)
            p_.inputs["Base Color"].default_value = (*srgb(col), 1)
            p_.inputs["Roughness"].default_value = rough
        for key, ck in (("cream", "cream"), ("mint_part", "mint")):   # flat parts get the same photo calibration
            if ck in _cal:
                c = M[key].node_tree.nodes["Principled BSDF"].inputs["Base Color"]
                c.default_value = tuple(min(1.0, c.default_value[i] * _cal[ck][i]) for i in range(3)) + (1,)
    bake_curves_and_mods()
    bpy.ops.object.select_all(action="DESELECT")
    for o in root.objects:
        if not o.hide_render:
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_extras=False, export_cameras=False, export_lights=False)
    print("EXPORTED", OUT)
    raise SystemExit(0)

# ------------------------------------------------------------------ preview render (Cycles)
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1460, 1060
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    scene.view_settings.view_transform = "Filmic"
scene.view_settings.exposure = float(os.environ.get("EXPO", "-3.2"))
scene.render.film_transparent = os.environ.get("TRANSPARENT") == "1"
use_gpu()

# dark studio: reflections get contrast from black surroundings + a few large softboxes
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (0.03, 0.03, 0.032, 1); bg.inputs["Strength"].default_value = 1.0

def light(name, loc, size, power, shape="RECTANGLE", size_y=None, color=(1, 1, 1), target=(0, 0.02, 0.07)):
    l = bpy.data.lights.new(name, "AREA"); l.shape = shape; l.size = size; l.energy = power; l.color = color
    if size_y: l.size_y = size_y
    o = bpy.data.objects.new(name, l); scene.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o

light("key", (-0.55, -0.75, 0.95), 0.9, 140, size_y=0.6, color=(1.0, 0.96, 0.9))     # big warm softbox, top-left
light("top", (0.0, 0.05, 1.0), 0.7, 70, size_y=0.5)                                  # overhead box for the long top highlights
light("stripL", (-0.75, -0.1, 0.3), 1.2, 60, size_y=0.08, target=(0, 0, 0.08))       # strip lights draw edges on chrome/enamel
light("stripR", (0.75, -0.1, 0.3), 1.2, 45, size_y=0.08, color=(0.9, 0.95, 1.0), target=(0, 0, 0.08))
light("rim", (0.15, 0.85, 0.55), 0.8, 80)

# warm grey seamless backdrop (sweep)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
sweep = act(); sweep.name = "backdrop"
me = sweep.data
bm = bmesh.new()
cols = []
for k in range(25):  # floor then a smooth curve up the back
    t = k / 24
    if t < 0.6:
        y, z = -1.2 + t / 0.6 * 1.5, 0.0
    else:
        a = (t - 0.6) / 0.4 * (math.pi / 2)
        y, z = 0.3 + math.sin(a) * 0.6, (1 - math.cos(a)) * 0.6
    cols.append((y, z))
vs = [[bm.verts.new((x, y, z)) for (y, z) in cols] for x in (-2, 2)]
for k in range(len(cols) - 1):
    bm.faces.new((vs[0][k], vs[1][k], vs[1][k + 1], vs[0][k + 1]))
bm.to_mesh(me); bm.free()
shade(sweep)
sweep.data.materials.clear()
sweep.data.materials.append(mat("backdrop", "#cbc4b8", 0.85))
if os.environ.get("TRANSPARENT") == "1":
    sweep.is_shadow_catcher = True

if VINTAGE:
    for n in ("key", "top", "stripL", "stripR", "rim"):
        bpy.data.objects.remove(bpy.data.objects[n])
    bpy.data.objects.remove(sweep)
    bg.inputs["Color"].default_value = (0.012, 0.009, 0.007, 1)
    light("tungsten", (-0.5, -0.65, 0.85), 0.55, 90, size_y=0.45, color=(1.0, 0.74, 0.48))
    light("bounce", (0.6, -0.5, 0.35), 1.0, 14, color=(1.0, 0.88, 0.72))
    light("window", (0.55, 0.6, 0.7), 0.9, 40, color=(0.85, 0.9, 1.0))
    light("top", (0.0, 0.0, 1.0), 0.6, 18, color=(1.0, 0.9, 0.78))
    # walnut desk
    bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0)); desk = act(); desk.name = "desk"
    dm = bpy.data.materials.new("walnut"); dm.use_nodes = True; nt = dm.node_tree; pb = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.35, 9.0, 1.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave"); wv.wave_type = "BANDS"; wv.bands_direction = "X"
    wv.inputs["Scale"].default_value = 2.2; wv.inputs["Distortion"].default_value = 1.6; wv.inputs["Detail"].default_value = 8; wv.inputs["Detail Scale"].default_value = 2.5; wv.inputs["Detail Roughness"].default_value = 0.6
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    _w0, _w1 = ("#2e1a0e", "#7a5232") if os.environ.get("LOOK") == "photo" else ("#24150c", "#5b3920")
    if os.environ.get("LOOK") == "photo":   # plank grain clearly visible, like the photo's old table
        wv.inputs["Scale"].default_value = 3.0; wv.inputs["Distortion"].default_value = 1.6
    cr.color_ramp.elements[0].color = (*srgb(_w0), 1); cr.color_ramp.elements[1].color = (*srgb(_w1), 1)
    nt.links.new(wv.outputs["Fac"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], pb.inputs["Base Color"])
    pb.inputs["Roughness"].default_value = 0.42; pb.inputs["Coat Weight"].default_value = 0.35; pb.inputs["Coat Roughness"].default_value = 0.2
    desk.data.materials.append(dm)
    # dark wall
    bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0.75, 1.0), rotation=(math.pi / 2, 0, 0)); wall = act(); wall.name = "wall"
    wall.data.materials.append(mat("wall", "#2a221c", 0.9))
    # the letter, wrapped round the platen and leaning back on the paper table
    tex_path = os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.getcwd(), "tex", "letter.png")
    me = bpy.data.meshes.new("letter"); bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
    PW, PL = (0.245 if os.environ.get("LOOK") == "photo" else 0.16), 0.2   # photo: a wide blank sheet
    path = []
    R = PR + 0.0008
    for k in range(18):  # around the front of the platen
        phi = math.radians(-50 + k * (68 / 17))
        path.append((PY - math.cos(phi) * R, PZ + math.sin(phi) * R))
    y0, z0 = path[-1]
    seg = 0.004
    ang = math.radians(18)
    while len(path) < 18 + 40:
        ang = min(math.radians(32), ang + math.radians(0.6))
        y0 += math.sin(ang) * seg; z0 += math.cos(ang) * seg
        path.append((y0, z0))
    L = [0.0]
    for k in range(1, len(path)):
        L.append(L[-1] + math.dist(path[k], path[k - 1]))
    total = L[-1]
    rows = [[bm.verts.new((x, y, z)) for (y, z) in path] for x in (-PW / 2, PW / 2)]
    for k in range(len(path) - 1):
        f = bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
        for loop, (u, kk) in zip(f.loops, ((0, k), (1, k), (1, k + 1), (0, k + 1))):
            v = 1 - (total - L[kk]) / PL * 0.0 - (total - L[kk]) / (total * 1.25)
            loop[uvl].uv = (u, 1 - (total - L[kk]) / total * 0.75 - 0.02)
    bm.to_mesh(me); bm.free()
    letter_obj = bpy.data.objects.new("letter", me); root.objects.link(letter_obj); shade(letter_obj)
    lm = bpy.data.materials.new("letter"); lm.use_nodes = True; lnt = lm.node_tree; lp = lnt.nodes["Principled BSDF"]
    im = lnt.nodes.new("ShaderNodeTexImage"); im.image = bpy.data.images.load(tex_path)
    if os.environ.get("LOOK") == "photo":   # blank aged sheet like the photo
        st = lnt.nodes.new("ShaderNodeTexNoise"); st.inputs["Scale"].default_value = 5; st.inputs["Detail"].default_value = 4
        stc = lnt.nodes.new("ShaderNodeValToRGB"); stc.color_ramp.elements[0].color = (*srgb("#c4a072"), 1); stc.color_ramp.elements[1].color = (*srgb("#d6b98f"), 1)
        stc.color_ramp.elements[0].position = 0.35; stc.color_ramp.elements[1].position = 0.6
        lnt.links.new(st.outputs["Fac"], stc.inputs["Fac"]); lnt.links.new(stc.outputs["Color"], lp.inputs["Base Color"])   # foxed, uneven old paper
    else:
        lnt.links.new(im.outputs["Color"], lp.inputs["Base Color"])
    lp.inputs["Roughness"].default_value = 0.85
    if "Subsurface Weight" in lp.inputs:
        lp.inputs["Subsurface Weight"].default_value = 0.08
    letter_obj.data.materials.append(lm)
    letter_obj.parent = bpy.data.objects["carriage"]
    scene.view_settings.look = "AgX - Base Contrast"

if os.environ.get("LOOK") == "photo":   # warm afternoon window light like the reference photo
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    bg.inputs["Color"].default_value = (0.05, 0.04, 0.03, 1); bg.inputs["Strength"].default_value = 1.0
    # side window from the left (photo: lit left/top, right side face in shade, sun streaks on the desk at left)
    light("window", (-1.5, -0.05, 0.75), 1.2, float(os.environ.get("WIN", "420")), size_y=1.0, color=(1.0, 0.82, 0.62), target=(0, 0, 0.08))
    light("bounce", (0.9, -1.1, 0.35), 1.5, float(os.environ.get("BOUNCE", "8")), color=(1.0, 0.85, 0.7))
    if "wall" in bpy.data.objects:
        bpy.data.objects["wall"].data.materials[0] = mat("wall2", "#b99b7c", 0.95)
    apply_calib()
    scene.view_settings.exposure = float(os.environ.get("EXPO", "-1.6"))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
view = argv[3] if len(argv) > 3 else "front"
k_ = 1.18 if os.environ.get("VINTAGE") == "1" else 1.0
cam.location = {"front": (0, -1.12 * k_, 0.78 * k_), "ref": (-0.15, -1.24, 0.66), "photo": (0.22, -0.66, 0.4)}.get(view, (-0.6 * k_, -1.0 * k_, 0.8 * k_))
cam.data.lens = 40 if view == "photo" else 85   # the photo has strong close-up perspective
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = (cam.location - Vector((0, -0.08, 0.08))).length
cam.data.dof.aperture_fstop = 4.0 if os.environ.get("VINTAGE") == "1" else 5.6
aim = (0.0, -0.01, 0.1) if view == "photo" else (0, 0.0, 0.075 if os.environ.get("VINTAGE") != "1" else 0.1)
cam.rotation_euler = (Vector(aim) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
if os.environ.get("CAMFIT"):   # camera solved from the reference photo (OpenCV pose, see match/fit*.py)
    import json
    from mathutils import Matrix
    fit = json.load(open(os.environ["CAMFIT"]))
    rv, tv, fpx = Vector(fit["cam"][:3]), Vector(fit["cam"][3:6]), fit["cam"][6]
    ang = rv.length
    Rwc = Matrix.Rotation(ang, 3, rv.normalized()) if ang > 0 else Matrix.Identity(3)
    Rcw = Rwc.transposed()
    cam.location = -(Rcw @ tv)
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = (Rcw @ Matrix.Diagonal((1, -1, -1))).to_euler()
    cam.data.sensor_fit = "HORIZONTAL"; cam.data.sensor_width = 36
    cam.data.lens = fpx / 1254 * 36
    cam.data.dof.use_dof = False
    scene.render.resolution_x = scene.render.resolution_y = 1254
if MODE == "save":
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("SAVED", OUT)
    raise SystemExit(0)
if view == "photo3":   # render from the cameras solved off the reference photos (proj/solve.py -> proj/cams.json)
    import json
    from mathutils import Matrix
    cams = json.load(open(os.path.join(os.path.dirname(OUT) if False else os.getcwd(), "proj", "cams.json")))
    for o in [o for o in scene.objects if o.type == "LIGHT"]: bpy.data.objects.remove(o)
    for n in ("desk", "wall", "backdrop", "letter"):
        if n in bpy.data.objects: bpy.data.objects[n].hide_render = True
    bg.inputs["Color"].default_value = (1, 1, 1, 1); bg.inputs["Strength"].default_value = 0.35
    light("softL", (-0.6, -0.8, 0.9), 1.2, 60, color=(1, 0.97, 0.92), target=(0, 0, 0.1))
    light("softR", (0.8, -0.3, 0.6), 1.2, 25, target=(0, 0, 0.1))
    light("topb", (0, 0.2, 1.2), 1.2, 30, target=(0, 0, 0.1))
    scene.view_settings.exposure = float(os.environ.get("EXPO3", "-1.45"))
    scene.render.film_transparent = True
    apply_calib()
    Wpx, Hpx = 1774, 887
    scene.render.resolution_x, scene.render.resolution_y = Wpx, Hpx
    scene.render.resolution_percentage = int(os.environ.get("SCALE", "100"))   # e.g. 300 for a hero image
    cam.data.type = "PERSP"; cam.data.dof.use_dof = False; cam.data.sensor_fit = "HORIZONTAL"; cam.data.sensor_width = 36
    for name, c in cams.items():
        rv = Vector(c["rvec"]); ang = rv.length
        Rwc = Matrix.Rotation(ang, 3, rv.normalized()) if ang > 0 else Matrix.Identity(3)
        Rcw = Rwc.transposed()
        cam.location = -(Rcw @ Vector(c["tvec"]))
        cam.rotation_mode = "XYZ"; cam.rotation_euler = (Rcw @ Matrix.Diagonal((1, -1, -1))).to_euler()
        cam.data.lens = c["f"] / Wpx * 36
        cam.data.shift_x = -(c["cx"] - Wpx / 2) / Wpx
        cam.data.shift_y = (c["cy"] - Hpx / 2) / Wpx
        scene.render.filepath = OUT.replace(".png", f"_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
    raise SystemExit(0)
if view == "ortho3":   # three orthographic views at the reference sheet's scale (refs/三视图.jpg)
    for o in [o for o in scene.objects if o.type == "LIGHT"]: bpy.data.objects.remove(o)
    for n in ("desk", "wall", "backdrop", "letter"):
        if n in bpy.data.objects: bpy.data.objects[n].hide_render = True
    bg.inputs["Color"].default_value = (1, 1, 1, 1); bg.inputs["Strength"].default_value = 0.35
    light("softL", (-0.6, -0.8, 0.9), 1.2, 60, color=(1, 0.97, 0.92), target=(0, 0, 0.1))
    light("softR", (0.8, -0.3, 0.6), 1.2, 25, target=(0, 0, 0.1))
    light("topb", (0, 0.2, 1.2), 1.2, 30, target=(0, 0, 0.1))
    scene.view_settings.exposure = float(os.environ.get("EXPO3", "0.0"))
    scene.render.film_transparent = True
    apply_calib()
    cam.data.type = "ORTHO"; cam.data.dof.use_dof = False; cam.data.sensor_fit = "HORIZONTAL"
    VIEWS = {  # name: (location, look-at, px width, px height, px per metre)
        "front": (Vector((0, -2, 0.179)), Vector((0, 0, 0.179)), 600, 600, 1397),
        "side": (Vector((2, 0.0309, 0.1836)), Vector((0, 0.0309, 0.1836)), 550, 600, 1362),
        "top": (Vector((0, 0.026, 2)), Vector((0, 0.026, 0)), 600, 600, 1397),
    }
    for name, (loc, at, wpx, hpx, ppm) in VIEWS.items():
        cam.location = loc
        up = "Y" if name == "top" else "Y"
        cam.rotation_euler = (at - loc).to_track_quat("-Z", "Y").to_euler()
        cam.data.ortho_scale = wpx / ppm
        scene.render.resolution_x, scene.render.resolution_y = wpx, hpx
        scene.render.filepath = OUT.replace(".png", f"_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
    raise SystemExit(0)
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("RENDERED", OUT)
