# Blender без окна: корзина для бумаг (assets/models/bin) — одна сетка, преобразования применены, высота в метрах, дно на y = 0, середина дна в начале координат;
# текстуры уменьшены до стороны и сохранены JPEG (как shrink.py).
# Запуск: Blender -b --factory-startup --python tools/models/basket.py -- вход.glb выход.glb высота_м сторона
import bpy, sys
from mathutils import Vector
src, dst, height, side = sys.argv[sys.argv.index('--') + 1:][:4]
height, side = float(height), int(side)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != ob: bpy.data.objects.remove(o, do_unlink=True)
# Blender: Z вверх. Масштаб — по высоте; дно — в ноль, середина по X и Y — в ноль.
vs = [v.co for v in ob.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
k = height / (hi.z - lo.z)
for v in ob.data.vertices: v.co = Vector(((v.co.x - (lo.x + hi.x) / 2) * k, (v.co.y - (lo.y + hi.y) / 2) * k, (v.co.z - lo.z) * k))
for im in bpy.data.images:
    if im.size[0] > side: im.scale(side, max(1, round(im.size[1] * side / im.size[0])))
print('tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'dims', tuple(round(v, 3) for v in ob.dimensions))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_tangents=False, export_apply=True)
