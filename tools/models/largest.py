# Blender без окна: от модели остаются только крупные связные куски (мелкий мусор скана — прочь); материалы и развёртка не трогаются.
import bpy, sys, bmesh
src, dst, share = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for ob in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
    part = [-1] * len(bm.faces); sizes = []
    for f in bm.faces:
        if part[f.index] >= 0: continue
        k = len(sizes); n = 0; stack = [f]; part[f.index] = k
        while stack:
            g = stack.pop(); n += 1
            for v in g.verts:
                for h in v.link_faces:
                    if part[h.index] < 0: part[h.index] = k; stack.append(h)
        sizes.append(n)
    lim = max(sizes) * float(share)
    print('[l]', ob.name, 'parts', len(sizes), 'top', sorted(sizes, reverse=True)[:6], 'kept', sum(1 for s in sizes if s >= lim), flush=True)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if sizes[part[f.index]] < lim], context='FACES')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    print('[l] dims', tuple(round(v, 3) for v in ob.dimensions), flush=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_tangents=False, export_apply=True)
