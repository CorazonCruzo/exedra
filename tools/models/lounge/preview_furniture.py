# Blender без окна: снимки мебели — три четверти, спереди, сбоку/сверху (800 px, Eevee), светлый пол и серый фон, два источника света.
# Запуск: ... --python preview_furniture.py -- вход.glb папка [имя_префикса] [--top]
import bpy, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
src, outdir = args[:2]
prefix = args[2] if len(args) > 2 and not args[2].startswith('--') else ''
top = '--top' in args
dim = float(args[args.index('--dim') + 1]) if '--dim' in args else 1.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE'
except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 800; sc.render.resolution_y = 800
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.6, 0.6, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
ms = [o for o in sc.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in ms for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
ctr = (lo + hi) / 2; R = max(hi - lo)
print('PREVIEW bbox size (blender xyz)', tuple(round(v, 3) for v in (hi - lo)))
bpy.ops.mesh.primitive_plane_add(size=R * 6, location=(ctr.x, ctr.y, lo.z - 0.002))
fl = bpy.context.object; m = bpy.data.materials.new('floor'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.3, 0.28, 1); m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
fl.data.materials.append(m)
def light(loc, e):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = e * R * R * dim; l.data.size = R
    l.rotation_euler = (ctr - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light((ctr.x - R * 1.2, ctr.y - R * 1.5, hi.z + R * 1.2), 140); light((ctr.x + R * 1.5, ctr.y - R * 0.8, ctr.z + R * 0.5), 50); light((ctr.x, ctr.y + R * 1.5, hi.z + R), 40)
def shot(name, loc, f=50):
    bpy.ops.object.camera_add(location=loc); c = bpy.context.object; c.data.lens = f; c.data.clip_end = R * 30
    c.rotation_euler = (ctr - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = c; sc.render.filepath = outdir + '/' + prefix + name; bpy.ops.render.render(write_still=True)
d = R * 1.5
# glTF +Z (лицо) = Blender -Y
shot('three-quarter.jpg', (ctr.x + d * 0.75, ctr.y - d * 0.85, ctr.z + R * 0.55))
shot('front.jpg', (ctr.x, ctr.y - d * 1.15, ctr.z + R * 0.12))
if top: shot('top.jpg', (ctr.x, ctr.y - 0.001, ctr.z + d * 1.5), 50)
else: shot('side.jpg', (ctr.x + d * 1.15, ctr.y, ctr.z + R * 0.12))
if '--cam' in args:  # --cam x,y,z,tx,ty,tz[,f] (Blender: Z вверх) — ещё один снимок close.jpg
    v = [float(t) for t in args[args.index('--cam') + 1].split(',')]
    ctr = Vector(v[3:6]); shot('close.jpg', tuple(v[:3]), v[6] if len(v) > 6 else 40)
