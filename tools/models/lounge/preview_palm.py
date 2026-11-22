# Blender без окна: снимки пальмы в жардиньерке (спереди, в три четверти, крупно жардиньерка) на сером фоне, свет — как в preview.py.
# ... --python preview_palm.py -- palm.glb папка
import bpy, sys, math
from mathutils import Vector as V
src, outdir = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE'
except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 800; sc.render.resolution_y = 1000
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.55, 0.55, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
ms = [o for o in bpy.data.objects if o.type == 'MESH']
pts = [o.matrix_world @ V(c) for o in ms for c in o.bound_box]
lo = V([min(p[i] for p in pts) for i in range(3)]); hi = V([max(p[i] for p in pts) for i in range(3)])
H = hi.z - lo.z; ctr = V((0, 0, lo.z + H / 2))
bpy.ops.mesh.primitive_plane_add(size=H * 4, location=(0, 0, 0)); fl = bpy.context.object  # пол
m = bpy.data.materials.new('floor'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.3, 0.27, 1); fl.data.materials.append(m)
def alight(loc, e, tgt):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = e; l.data.size = H * 0.8
    l.rotation_euler = (tgt - V(loc)).to_track_quat('-Z', 'Y').to_euler()
k = (H / 1.5) ** 2
alight((-H * 0.9, -H * 1.2, H * 1.1), 300 * k, ctr); alight((H * 1.1, -H * 0.9, H * 0.4), 120 * k, ctr)
def shot(name, loc, f, tgt):
    bpy.ops.object.camera_add(location=loc); c = bpy.context.object; c.data.lens = f; c.data.clip_end = H * 20
    c.rotation_euler = (tgt - V(loc)).to_track_quat('-Z', 'Y').to_euler(); sc.camera = c
    sc.render.filepath = outdir + '/' + name; bpy.ops.render.render(write_still=True)
shot('front.jpg', (0, -H * 1.95, ctr.z), 50, ctr)
shot('three-quarter.jpg', (H * 1.4, -H * 1.5, ctr.z + H * 0.08), 50, ctr)
shot('planter.jpg', (H * 0.55, -H * 0.8, 0.45), 50, V((0, 0, 0.35)))
