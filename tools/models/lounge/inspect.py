# Blender без окна: осмотр модели — объекты, треугольники, габариты в мировых осях (Blender: Z вверх), материалы, картинки.
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
tot = 0
for o in bpy.context.scene.objects:
    if o.type != 'MESH': print('OBJ', o.type, o.name); continue
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = [round(min(p[i] for p in pts), 3) for i in range(3)]; hi = [round(max(p[i] for p in pts), 3) for i in range(3)]
    t = sum(len(p.vertices) - 2 for p in o.data.polygons); tot += t
    print('MESH', repr(o.name), 'tris', t, 'min', lo, 'max', hi, 'mats', [m.name for m in o.data.materials if m])
print('TOTAL tris', tot)
for m in bpy.data.materials:
    if m.use_nodes:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b: print('MAT', m.name, 'base', tuple(round(v, 2) for v in b.inputs['Base Color'].default_value), 'rough', round(b.inputs['Roughness'].default_value, 2), 'metal', round(b.inputs['Metallic'].default_value, 2), 'alpha', round(b.inputs['Alpha'].default_value, 2), 'blend', m.blend_method if hasattr(m, 'blend_method') else '')
for im in bpy.data.images: print('IMG', im.name, tuple(im.size), im.colorspace_settings.name)
