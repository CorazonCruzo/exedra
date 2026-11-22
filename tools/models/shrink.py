# Blender без окна: модель без упрощения сетки — одна сетка, преобразования применены, текстуры уменьшены до заданной стороны и сохранены JPEG.
import bpy, sys
src, dst, side = sys.argv[sys.argv.index('--') + 1:][:3]
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
for im in bpy.data.images:
    if im.size[0] > int(side): im.scale(int(side), int(side))
print('tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'dims', tuple(round(v, 3) for v in ob.dimensions), 'bbox', [tuple(round(c, 3) for c in v) for v in (ob.bound_box[0], ob.bound_box[6])])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_tangents=False, export_apply=True)
