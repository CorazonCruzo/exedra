# Подставка: связные куски после склейки по расстоянию (Blender -b --python stand_parts.py -- вход.glb)
import bpy, bmesh, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
o = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bm = bmesh.new(); bm.from_mesh(o.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
bm.verts.ensure_lookup_table(); bm.verts.index_update(); bm.faces.index_update()
print('after weld verts', len(bm.verts), 'faces', len(bm.faces))
seen = set(); comps = []
for v in bm.verts:
    if v.index in seen: continue
    stack = [v]; seen.add(v.index); cur = []
    while stack:
        a = stack.pop(); cur.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen: seen.add(b.index); stack.append(b)
    comps.append(cur)
print('components', len(comps))
for i, c in enumerate(sorted(comps, key=lambda c: -len(c))[:40]):
    mn = Vector((min(v.co.x for v in c), min(v.co.y for v in c), min(v.co.z for v in c)))
    mx = Vector((max(v.co.x for v in c), max(v.co.y for v in c), max(v.co.z for v in c)))
    faces = set(f for v in c for f in v.link_faces)
    print('  comp', i, 'verts', len(c), 'faces', len(faces), 'min', tuple(round(x, 1) for x in mn), 'max', tuple(round(x, 1) for x in mx))
