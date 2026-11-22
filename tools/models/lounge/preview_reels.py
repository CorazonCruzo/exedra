# Blender без окна: снимки малой вещи на столе (три вида) на сером фоне, свет — как в preview_palm.py / preview.py.
# ... --python preview_reels.py -- файл.glb папка [префикс]
import bpy, sys, math, os
from mathutils import Vector as V
a = sys.argv[sys.argv.index('--') + 1:]
src, outdir = a[:2]; pre = a[2] if len(a) > 2 and not a[2].startswith('--') else ''
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
# --with файл.glb x y масштаб [повернуть°] — добавить соседа (в метрах Blender: x вправо, y вглубь), чтобы видеть размер рядом с проектором
if '--with' in a:
    i = a.index('--with'); wf, wx, wy, ws = a[i + 1], float(a[i + 2]), float(a[i + 3]), float(a[i + 4]); wr = float(a[i + 5]) if len(a) > i + 5 else 0
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=wf)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.parent is None:
            o.scale = (ws, ws, ws); o.location = (wx, wy, 0); o.rotation_euler[2] = math.radians(wr)
try: sc.render.engine = 'BLENDER_EEVEE'
except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 1000; sc.render.resolution_y = 800
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.55, 0.55, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
ms = [o for o in bpy.data.objects if o.type == 'MESH']
pts = [o.matrix_world @ V(c) for o in ms for c in o.bound_box]
lo = V([min(p[i] for p in pts) for i in range(3)]); hi = V([max(p[i] for p in pts) for i in range(3)])
H = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z); ctr = (lo + hi) / 2  # Blender: Z вверх, импорт glTF уже повернул Y -> Z
bpy.ops.mesh.primitive_plane_add(size=H * 8, location=(0, 0, lo.z)); fl = bpy.context.object  # стол (ореховый тон)
m = bpy.data.materials.new('floor'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.3, 0.27, 1); fl.data.materials.append(m)
def alight(loc, e, tgt):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = e; l.data.size = H * 0.8
    l.rotation_euler = (tgt - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    if os.environ.get('PV_NOSHADOW'): l.data.use_shadow = False
k = (H / 1.5) ** 2
alight((-H * 0.9, -H * 1.2, H * 1.1 + lo.z), 300 * k, ctr); alight((H * 1.1, -H * 0.9, H * 0.4 + lo.z), 120 * k, ctr)
import os
ROT = math.radians(float(os.environ.get('PV_ROT', 0)))  # PV_ROT — повернуть камеры вокруг вещи (вид сзади и т. п.)
def shot(name, loc, f, tgt):
    d = V(loc) - tgt; loc = tuple(tgt + V((d.x * math.cos(ROT) - d.y * math.sin(ROT), d.x * math.sin(ROT) + d.y * math.cos(ROT), d.z)))
    bpy.ops.object.camera_add(location=loc); c = bpy.context.object; c.data.lens = (32 if '--with' in a else f); c.data.clip_end = H * 20
    c.rotation_euler = (tgt - V(loc)).to_track_quat('-Z', 'Y').to_euler(); sc.camera = c
    sc.render.filepath = outdir + '/' + pre + name; bpy.ops.render.render(write_still=True)
shot('front.jpg', (ctr.x, -H * 2.6, ctr.z + H * 0.25), 50, ctr)
shot('three-quarter.jpg', (ctr.x + H * 1.7, -H * 1.9, ctr.z + H * 1.0), 50, ctr)
shot('top.jpg', (ctr.x + H * 0.5, -H * 1.1, ctr.z + H * 2.4), 50, ctr)
