"""Скан гипсовой детали -> лёгкая отливка для зала (assets/models/stucco/*.glb), как их читает castOf в src/room.js.

Запуск (Blender без окна):
  Blender -b --factory-startup --python tools/models/cast.py -- вход.gltf выход.glb [--height 1.78] [--tris 22000] [--ao 0.06] [--strength 0.65] [--gain 1.3] [--flip] [--debris 0.02]

Что делает:
  1. склеивает все сетки сцены, швы между кусками сваривает по расстоянию, выбрасывает мелкие обломки (меньше доли --debris от самого большого куска);
  2. выравнивает (спина — ровно в плоскость стены, боковины отвесно) и ставит как отливки зала: метры, высота ровно --height (равномерный масштаб), спина на плоскости z = 0, лицо к +z, низ на y = 0, по x — по центру
     (в исходнике лицо должно смотреть к +z glTF, иначе --flip — разворот на 180 вокруг вертикали);
  3. убирает грани, глядящие в стену (нормаль почти к -z), — их не видно, и упрощает до --tris треугольников (Decimate, collapse);
  4. затенение складок (ambient occlusion) считает по ПОЛНОЙ сетке скана: из каждой вершины --ao метров лучи по косинусной полусфере, плоскость стены z = 0
     тоже закрывает; 1 — открыто, до 1 - --strength — глубокая складка (доля закрытого умножается на --gain). Кладёт в COLOR_0 (float RGB);
  5. сам пишет .glb: одна сетка, одна примитива, индексы, POSITION, NORMAL (гладкие, острее --crease градусов — рёбра), COLOR_0; без UV, материалов и сжатия.
"""
import bpy, bmesh, sys, math, struct, json, os, argparse, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--height', type=float, default=1.78)
ap.add_argument('--tris', type=int, default=22000)
ap.add_argument('--ao', type=float, default=0.06)
ap.add_argument('--strength', type=float, default=0.65)
ap.add_argument('--gain', type=float, default=1.3)
ap.add_argument('--rays', type=int, default=64)
ap.add_argument('--crease', type=float, default=40)
ap.add_argument('--debris', type=float, default=0.02)
ap.add_argument('--flip', action='store_true')
ap.add_argument('--credit', default='')
A = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=A.src)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
ob = bpy.context.object
ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
for m in list(ob.modifiers): ob.modifiers.remove(m)
src_tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)

bm = bmesh.new(); bm.from_mesh(ob.data)
dim0 = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dim0 * 1e-5)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.faces.ensure_lookup_table()

# Обломки: связные куски по рёбрам.
seen = set(); comps = []
for f in bm.faces:
    if f.index in seen: continue
    stack = [f]; seen.add(f.index); comp = []
    while stack:
        g = stack.pop(); comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen: seen.add(h.index); stack.append(h)
    comps.append(comp)
comps.sort(key=len, reverse=True)
kill = [f for c in comps if len(c) < A.debris * len(comps[0]) for f in c]
def cbox(c):
    vs = [v.co for f in c for v in f.verts]
    return [tuple(round(min(v[i] for v in vs), 3) for i in range(3)), tuple(round(max(v[i] for v in vs), 3) for i in range(3))]
print('PIECES', [(len(c), cbox(c)) for c in comps[:8]], 'removed debris faces', len(kill))
if kill: bmesh.ops.delete(bm, geom=kill, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

# Положение: сырое в системе Blender (z вверх, лицо к -y, как glTF-лицо к +z).
if A.flip: bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
# Выравнивание: скан снят с небольшим наклоном — спина должна лечь ровно в плоскость стены, а боковины быть отвесными.
bm.normal_update()
nb = Vector()
for f in bm.faces:
    if f.normal.y > 0.8: nb += f.normal * f.calc_area()
if nb.length > 0:
    q = nb.normalized().rotation_difference(Vector((0, 1, 0)))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bm.normal_update()
    roll = 0; wsum = 0
    for f in bm.faces:
        if abs(f.normal.x) > 0.9:
            sgn = 1 if f.normal.x > 0 else -1; w = f.calc_area(); roll += math.atan2(f.normal.z * sgn, f.normal.x * sgn) * w; wsum += w
    roll = roll / wsum if wsum else 0
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(roll, 3, 'Y'))
    print('ALIGN back tilt deg', round(math.degrees(q.angle), 3), 'side roll deg', round(math.degrees(roll), 3))
lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)]); hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
k = A.height / (hi.z - lo.z)
# Спина — плоскость y = 0 (в glTF z = 0): самая задняя точка (y = max) на неё.
bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Scale(k, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -hi.y, -lo.z)))
bm.normal_update()
bm.verts.ensure_lookup_table()
hi_bvh = BVHTree.FromPolygons([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces])
wmax = max(abs(v.co.x) for v in bm.verts) * 4
wall = BVHTree.FromPolygons([(-wmax, 0, -1), (wmax, 0, -1), (wmax, 0, A.height * 2), (-wmax, 0, A.height * 2)], [(0, 1, 2), (0, 2, 3)])
print('SOURCE TRIS', src_tris, 'after weld/debris', len(bm.faces), 'scale', k)

# Грани, глядящие в стену (нормаль почти к -z), не видны — убираем до упрощения, чтобы --tris считался по видимому.
bm.normal_update()
back = [f for f in bm.faces if f.normal.y > 0.35]
bmesh.ops.delete(bm, geom=back, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(ob.data); bm.free()

# Упрощение.
dm = ob.modifiers.new('d', 'DECIMATE'); dm.decimate_type = 'COLLAPSE'; dm.ratio = min(1, A.tris / len(ob.data.polygons)); dm.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='d')
bm = bmesh.new(); bm.from_mesh(ob.data)
thr = math.radians(A.crease)
for e in bm.edges:
    e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0) > thr)
for f in bm.faces: f.smooth = True
bm.to_mesh(ob.data); bm.free()
me = ob.data
print('DECIMATED TRIS', len(me.polygons), 'culled back faces (before)', len(back))
cn = me.corner_normals

# Вершины для glTF: (вершина, нормаль) без повторов; z-вверх Blender -> y-вверх glTF: (x, z, -y).
key = {}; P = []; N = []; src_v = []; idx = []
for poly in me.polygons:
    tri = []
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index; n = cn[li].vector
        kk = (vi, round(n.x, 3), round(n.y, 3), round(n.z, 3))
        if kk not in key:
            key[kk] = len(P); p = me.vertices[vi].co; P.append((p.x, p.z, -p.y)); N.append((n.x, n.z, -n.y)); src_v.append((p.copy(), Vector(n)))
        tri.append(key[kk])
    idx += tri

# Затенение: полная сетка скана + стена.
random.seed(7)
dirs = []
R = A.rays
for i in range(R):  # Фибоначчи по полусфере, косинусное распределение
    r = math.sqrt((i + .5) / R); th = i * 2.399963
    dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - r * r))))
eps = 0.001
col = []
for p, n in src_v:
    n = n.normalized(); t = n.cross(Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((1, 0, 0))).normalized(); b = n.cross(t)
    ph = random.random() * 6.2832; c, s = math.cos(ph), math.sin(ph)
    o = p + n * eps; occ = 0
    for dx, dy, dz in dirs:
        x, y = dx * c - dy * s, dx * s + dy * c
        d = (t * x + b * y + n * dz)
        w = 0
        for bv in (hi_bvh, wall):
            h = bv.ray_cast(o, d, A.ao)
            if h[0] is not None: w = max(w, 1 - h[3] / A.ao)
        occ += w
    a = 1 - A.strength * min(1, occ / R * A.gain)
    col.append((a, a, a))
ys = [p[1] for p in P]
print('AO min/mean/max', min(c[0] for c in col), sum(c[0] for c in col) / len(col), max(c[0] for c in col))

# .glb
ns = len(P); u16 = ns < 65536
pos = b''.join(struct.pack('<3f', *p) for p in P); nor = b''.join(struct.pack('<3f', *n) for n in N); cb = b''.join(struct.pack('<3f', *c) for c in col)
ib = struct.pack('<%d%s' % (len(idx), 'H' if u16 else 'I'), *idx)
while len(ib) % 4: ib += b'\0'
mn = [min(p[i] for p in P) for i in range(3)]; mx = [max(p[i] for p in P) for i in range(3)]
name = os.path.splitext(os.path.basename(A.out))[0]
j = {'asset': {'version': '2.0', 'generator': 'tools/models/cast.py', **({'extras': {'credit': A.credit}} if A.credit else {})},
     'buffers': [{'byteLength': len(pos) * 3 + len(ib)}],
     'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos), 'byteStride': 12, 'target': 34962},
                     {'buffer': 0, 'byteOffset': len(pos), 'byteLength': len(pos), 'byteStride': 12, 'target': 34962},
                     {'buffer': 0, 'byteOffset': 2 * len(pos), 'byteLength': len(pos), 'byteStride': 12, 'target': 34962},
                     {'buffer': 0, 'byteOffset': 3 * len(pos), 'byteLength': len(idx) * (2 if u16 else 4), 'target': 34963}],
     'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': ns, 'type': 'VEC3', 'min': mn, 'max': mx},
                   {'bufferView': 1, 'componentType': 5126, 'count': ns, 'type': 'VEC3'},
                   {'bufferView': 2, 'componentType': 5126, 'count': ns, 'type': 'VEC3'},
                   {'bufferView': 3, 'componentType': 5123 if u16 else 5125, 'count': len(idx), 'type': 'SCALAR'}],
     'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2}, 'indices': 3, 'mode': 4}]}],
     'nodes': [{'name': name, 'mesh': 0}], 'scenes': [{'name': name, 'nodes': [0]}], 'scene': 0}
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
body = pos + nor + cb + ib
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(body), b'BIN\0') + body
open(A.out, 'wb').write(out)
print('WROTE', A.out, len(out), 'bytes; verts', ns, 'tris', len(idx) // 3, 'bbox', [round(v, 4) for v in mn], [round(v, 4) for v in mx])
