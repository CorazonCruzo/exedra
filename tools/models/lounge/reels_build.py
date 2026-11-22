# Blender без окна: «Pathé 9.5mm film reels» (timvanderheijden, Sketchfab, CC BY 4.0) -> реквизит для столика у проектора.
# Исходник — фотограмметрия натюрморта на чёрной ткани: 285 кусков сетки (связных компонент), одна текстура 4096.
# Берём куски двух предметов, ткань и остальное выбрасываем: (A) латунная крышка «PATHÉ 9m/m5» на проволочной подставке,
# (B) лежащая коробка с приоткрытой крышкой и белой бобиной внутри. Куски отсортированы по числу граней — номера ниже
# относятся к этому порядку и годятся только для этого файла. Метры: исходник в «сантиметрах ×0,01 ×100» = реальные размеры
# (крышка Ø ≈ 12 см), дальше умножается на --k (множитель вида; у проектора в зале 1,6).
# ... --python reels_build.py -- исходник.glb выход.glb [--k 1.6] [--tris 26000] [--tex 1024] [--gap 0.03]
import bpy, sys, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[:2]
def opt(k, d=None): return a[a.index(k) + 1] if k in a else d
K = float(opt('--k', 1.6)); TRIS = int(opt('--tris', 26000)); TEX = int(opt('--tex', 1024))
A_IDS = [0, 1, 16, 21, 27, 33, 50, 64, 69, 78, 89, 96, 98, 104]   # крышка, подставка (проволока) и мелкие куски обода
B_IDS = [2, 8, 9, 12, 17]                                          # лежащая коробка, бобина; ткань на этих кусках срезается по цвету
DARK = 0.08; ISLAND = 250                                           # грани темнее DARK (чёрная ткань) и острова меньше ISLAND граней — долой
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
ob.data.transform(Matrix.Scale(100 * K, 4)); ob.data.update()   # миллиметры в метры (как у проектора) и множитель вида
bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
def comps_of(faces):
    fs = set(faces); seen = set(); out = []
    for f in faces:
        if f in seen: continue
        st = [f]; seen.add(f); c = []
        while st:
            x = st.pop(); c.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g in fs and g not in seen: seen.add(g); st.append(g)
        out.append(c)
    return out
comps = sorted(comps_of(list(bm.faces)), key=lambda c: -len(c))
im = bpy.data.images[0]; W, H = im.size
px = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3].mean(axis=2)
uv = bm.loops.layers.uv[0]   # TEXCOORD_0 — единственный набор, на который ссылается материал (в исходнике их 9)
def lum(f):
    t = [px[int(min(max(l[uv].uv.y, 0), .9999) * H), int(min(max(l[uv].uv.x, 0), .9999) * W)] for l in f.loops]
    return sum(t) / len(t)
def group(ids, filt):
    out = []
    for i in ids:
        c = comps[i]
        if filt:
            c = [f for f in c if lum(f) >= DARK]
            c = [f for isl in comps_of(c) if len(isl) >= ISLAND for f in isl]
        out += c
    return out
def make(name, faces):
    keep = set(faces); b = bm.copy(); b.faces.ensure_lookup_table()
    idx = {f.index for f in faces}
    dele = [f for f in b.faces if f.index not in idx]
    bmesh.ops.delete(b, geom=dele, context='FACES')
    me = bpy.data.meshes.new(name); b.to_mesh(me); b.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    for m in ob.data.materials: me.materials.append(m)
    for l in [l.name for l in me.uv_layers if l.name != uv.name]: me.uv_layers.remove(me.uv_layers[l])  # в исходнике 8 наборов UV, нужен один
    return o
A = make('pathe-lid-standing', group(A_IDS, False)); B = make('pathe-tin-lying', group(B_IDS, True))
bpy.data.objects.remove(ob)
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def dec(o, n):
    m = o.modifiers.new('d', 'DECIMATE'); m.ratio = min(1.0, n / tris(o)); m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='d')
def verts(o): return np.array([v.co[:] for v in o.data.vertices])
def bake(o, M):
    o.data.transform(M); o.data.update()
# --- крышка A: нормаль лицевой стороны (PATHÉ) — наименьшая главная ось облака точек латунных кусков 0 и 1
va = np.array([v.co[:] for f in comps[0] + comps[1] for v in f.verts])
w, e = np.linalg.eigh(np.cov((va - va.mean(0)).T)); n = Vector(e[:, 0])
if n.dot(Vector((1, -1, 1))) < 0: n = -n
yaw = math.radians(-90) - math.atan2(n.y, n.x)   # лицо — к зрителю (в Blender это −y, в glTF +z)
bake(A, Matrix.Rotation(yaw, 4, 'Z'))
def zmin(o): return min(v.co.z for v in o.data.vertices)
bake(A, Matrix.Translation((0, 0, -zmin(A))))
# --- коробка B: лежит как лежала, поворот — чтобы лицо крышки смотрело на зрителя чуть вбок
bake(B, Matrix.Rotation(math.radians(float(opt('--b-yaw', 225))), 4, 'Z'))
bake(B, Matrix.Translation((0, 0, -zmin(B))))
def bbox(o):
    v = verts(o); return v.min(0), v.max(0)
(alo, ahi), (blo, bhi) = bbox(A), bbox(B)
gap = float(opt('--gap', 0.0))
# B перед A (к зрителю, −y), по центру A; задний край B заходит под наклон крышки
bake(B, Matrix.Translation(((alo[0] + ahi[0]) / 2 - (blo[0] + bhi[0]) / 2 + float(opt('--b-dx', -0.02)), alo[1] - bhi[1] + float(opt('--b-overlap', 0.025)) - gap, 0)))
for o, k in ((A, 0.55), (B, 0.45)): dec(o, TRIS * k)
# Нормали: в исходнике текстура разрезана на сотни мелких островов, и вершины на их границах продублированы — у каждой
# дубликатной вершины своя нормаль, свет ложится пятнами по островам. Склеиваем вершины по положению, нормаль считаем
# по склеенной сетке, чуть сглаживаем по соседям (ITER) и записываем в каждый угол грани.
def weld_normals(o, iters=int(opt('--smooth', 6))):
    me = o.data; co = np.array([v.co[:] for v in me.vertices]); key = {}
    wid = np.array([key.setdefault(tuple(np.round(c, 5)), len(key)) for c in co])
    nv = len(key); acc = np.zeros((nv, 3)); edges = set()
    for p in me.polygons:
        vs = [wid[i] for i in p.vertices]
        for v in vs: acc[v] += np.array(p.normal[:]) * p.area
        for i in range(len(vs)): edges.add((min(vs[i], vs[(i + 1) % len(vs)]), max(vs[i], vs[(i + 1) % len(vs)])))
    ed = np.array(list(edges)); n = acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12)
    for _ in range(iters):
        t = n.copy(); np.add.at(t, ed[:, 0], n[ed[:, 1]]); np.add.at(t, ed[:, 1], n[ed[:, 0]])
        n = t / (np.linalg.norm(t, axis=1, keepdims=True) + 1e-12)
    loops = [n[wid[l.vertex_index]].tolist() for l in me.loops]
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.normals_split_custom_set(loops); me.update()
GEO = int(opt('--geo-smooth', 0))
for o in (A, B):
    if GEO:  # и сама сетка слегка сглаживается: мелкие бугры дают пятнистые тени от ламп
        m = o.modifiers.new('g', 'SMOOTH'); m.factor = 0.6; m.iterations = GEO
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='g')
    weld_normals(o)
# --- центр габарита по x/y — в нуль, низ — на z = 0
v = np.vstack([verts(A), verts(B)]); lo, hi = v.min(0), v.max(0)
sh = Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
for o in (A, B): bake(o, sh)
root = bpy.data.objects.new('reels', None); sc.collection.objects.link(root)
for o in (A, B): o.parent = root
im.scale(TEX, TEX)
# материал в исходнике «без освещения» (свет запечён в цвет); делаем обычный: цвет — та же текстура, лёгкий металл (латунь), шероховатость 0,6
mat = A.data.materials[0]; nt = mat.node_tree
tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
for n in list(nt.nodes):
    if n.name != tex.name: nt.nodes.remove(n)
bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(tex.outputs[0], bs.inputs['Base Color']); nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
bs.inputs['Metallic'].default_value = 0.25; bs.inputs['Roughness'].default_value = 0.6
# пустые узлы Sketchfab из импорта не нужны
for o in [o for o in bpy.data.objects if o.type == 'EMPTY' and o.name != root.name]: bpy.data.objects.remove(o, do_unlink=True)
v = np.vstack([verts(A), verts(B)]); lo, hi = v.min(0), v.max(0)
print('REELS tris', tris(A) + tris(B), 'размер x/в/г (м)', round(hi[0] - lo[0], 3), round(hi[2] - lo[2], 3), round(hi[1] - lo[1], 3), 'K', K)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=int(opt('--q', 85)), export_tangents=False, export_apply=True, export_cameras=False, export_lights=False)
