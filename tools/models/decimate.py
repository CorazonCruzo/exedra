# Blender без окна: скан -> одна сетка, упрощённая до заданной доли треугольников, без ламп и камер; текстуры — JPEG.
import bpy, sys
src, dst, ratio = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH' and not any(c.type == 'MESH' for c in o.children_recursive): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-4); bpy.ops.object.mode_set(mode='OBJECT')
m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = float(ratio); bpy.ops.object.modifier_apply(modifier='dec')
for o in list(bpy.context.scene.objects):
    if o != ob: bpy.data.objects.remove(o, do_unlink=True)
print('tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'dims', tuple(round(v, 2) for v in ob.dimensions))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_tangents=False, export_apply=True, use_selection=False)
