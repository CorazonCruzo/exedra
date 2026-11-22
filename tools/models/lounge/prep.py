# Blender без окна: мебель с Sketchfab/Poly Haven -> одна лёгкая вещь для зала: метры, Y вверх, лицо к +z, начало в центре низа.
# ... --python prep.py -- вход выход [--rot градусы_вокруг_вертикали] [--scale k] [--height м] [--tris N] [--side 1024] [--keep имя,имя] [--drop имя,имя] [--q 85] [--rough-lift Image_1:0.5]
#  --height сам подбирает масштаб по высоте; --keep / --drop — отбор объектов по подстроке имени (до склейки);
#  --tris — упрощение сетки (Decimate, доля от текущего числа); --side — потолок стороны текстур.
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[:2]
def opt(k, d=None):
    return a[a.index(k) + 1] if k in a else d
rot = float(opt('--rot', 0)); scale = float(opt('--scale', 1)); height = opt('--height'); tris = opt('--tris'); side = int(opt('--side', 2048)); q = int(opt('--q', 75))
keep = [s for s in (opt('--keep') or '').split(',') if s]; drop = [s for s in (opt('--drop') or '').split(',') if s]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == 'MESH']
sel = [o for o in meshes if (not keep or any(k in o.name for k in keep)) and not any(d in o.name for d in drop)]
for o in meshes:
    if o not in sel: bpy.data.objects.remove(o, do_unlink=True)
for o in list(sc.objects):
    if o.type != 'MESH' and o.type != 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in sel: o.select_set(True)
bpy.context.view_layer.objects.active = sel[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(sel) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
for o in list(sc.objects):
    if o != ob: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
from mathutils import Matrix
ob.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z')); ob.data.update()
if height: scale = float(height) / ob.dimensions.z
ob.data.transform(Matrix.Scale(scale, 4)); ob.data.update()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
n0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if tris and int(tris) < n0:
    m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = int(tris) / n0; bpy.ops.object.modifier_apply(modifier='dec')
pts = [v.co.copy() for v in ob.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
ob.data.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))); ob.data.update()
lift = opt('--rough-lift')  # имя_картинки:a — шероховатость (канал G в карте ORM) подтягивается к 1: g' = a + (1 - a) * g
if lift:
    import numpy as np
    nm, aa = lift.split(':'); aa = float(aa)
    for im in bpy.data.images:
        if nm in im.name:
            px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32); im.pixels.foreach_get(px); px = px.reshape(-1, 4)
            px[:, 1] = aa + (1 - aa) * px[:, 1]; im.pixels.foreach_set(px.reshape(-1)); im.update(); print('PREP rough-lift', im.name, aa)
for im in bpy.data.images:
    if max(im.size) > side: k = side / max(im.size); im.scale(int(im.size[0] * k), int(im.size[1] * k))
    else:  # JPEG, пришедший с источника, экспортёр отдаёт как есть; «тронутую» картинку он кодирует заново с нашим качеством
        import numpy as np
        px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32); im.pixels.foreach_get(px); im.pixels.foreach_set(px); im.update()
print('PREP scale', round(scale, 4), 'tris', n0, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'dims(m)', tuple(round(v, 3) for v in ob.dimensions))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=q, export_tangents=False, export_apply=True, export_cameras=False, export_lights=False)
