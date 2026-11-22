# Blender без окна: та же пальма (AllQuad, Dypsis lutescens), но в спокойной кадке вместо пышной жардиньерки -> palm-a/b/c.glb
# ... --python palm_calm_build.py -- пальма.glb выход.glb --kind a|b|c [--src кадка.glb] [--planter-h 0.5] [--total-h 1.85] [--tex 512] [--tint r,g,b]
#       [--tris 7000] [--palm-xy 1.1] [--twin 0.5] [--twin-k 0.78] [--p1 x,y] [--p2 x,y]  (--p1/--p2: где в кадке посажены растения, м)
# Растение и посадка — те же, что в palm_build.py (оригинал не тронут): лист — отсечение по альфе (post.py --mask), стебли воткнуты в землю.
# Кадки: a — ящик «Версаль» из простых брусков с текстурой ореха зала (src не нужен); b — медная ванна (Antique Copper Cooking Tub,
#   вариант Brass Refurbished, Mad_Lobster_Workshop, CC BY) без крышки; c — зелёный глазурованный горшок с блюдцем (Hidden Town, Emily Rink, CC BY).
# Метры, Z вверх в Blender (Y вверх в glTF), начало — центр низа кадки, высота земли (soil_z) считается по кадке; общая высота — --total-h.
import bpy, sys, math, bmesh, time, os, random, tempfile
from mathutils import Vector as V, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
palm_src, dst = a[:2]
def opt(k, d): return type(d)(a[a.index(k) + 1]) if k in a else d
KIND = opt('--kind', 'a'); SRC = opt('--src', ''); PH = opt('--planter-h', 0.5); TOTAL = opt('--total-h', 1.85); TRIS = opt('--tris', 5200); TEX = opt('--tex', 512)
TWIN = opt('--twin', 0.5); TWIN_K = opt('--twin-k', 0.78); PXY = opt('--palm-xy', 1.1); PK = opt('--palm-k', 1.0)
def xy(k, d): return tuple(float(x) for x in opt(k, d).split(','))
P1 = xy('--p1', '0,0'); P2 = xy('--p2', '0.04,0.025')
HERE = os.path.dirname(os.path.abspath(__file__)); TEXDIR = os.path.normpath(os.path.join(HERE, '../../../assets/textures'))
t0 = time.time(); log = lambda *x: print('[calm]', round(time.time() - t0), *x, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
random.seed(7)

def join(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob
def tris(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)
def bbox(ob):
    pts = [v.co for v in ob.data.vertices]
    return V([min(p[i] for p in pts) for i in range(3)]), V([max(p[i] for p in pts) for i in range(3)])
def shrink_images(size, q=82):  # все картинки кадки -> JPEG заданного размера; из файла (иначе экспортёр перекодирует в PNG)
    tmp = tempfile.mkdtemp(); redo = {}
    for im in list(bpy.data.images):
        if not im.users: bpy.data.images.remove(im); continue
        if im.size[0] > size: im.scale(size, size)
        sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = q
        p = os.path.join(tmp, im.name.replace('/', '_') + '.jpg'); im.file_format = 'JPEG'; im.filepath_raw = p; im.save(quality=q)
        ld = bpy.data.images.load(p); ld.name = im.name + '-s'; ld.colorspace_settings.name = im.colorspace_settings.name; ld.pack(); redo[im] = ld
    for m in bpy.data.materials:
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image in redo: n.image = redo[n.image]
def flat_material(name, rgb, rough=1.0, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m
def ray_r(poly, ang):  # расстояние от (0,0) до многоугольника вдоль луча под углом ang
    d = V((math.cos(ang), math.sin(ang))); best = 1e9
    for i in range(len(poly)):
        p, q = V(poly[i]), V(poly[(i + 1) % len(poly)]); e = q - p; den = d.x * e.y - d.y * e.x
        if abs(den) < 1e-12: continue
        t = (p.x * e.y - p.y * e.x) / den; s = (p.x * d.y - p.y * d.x) / den
        if t > 0 and -1e-9 <= s <= 1 + 1e-9: best = min(best, t)
    return best
def soil_mesh(poly, z, amp=0.004, rings=7, n=48, name='soil'):  # земля: слегка бугристая «тарелка» по контуру poly, центр чуть выше краёв
    bm = bmesh.new(); rr = [ray_r(poly, 2 * math.pi * i / n) for i in range(n)]
    rows = [[bm.verts.new((rr[i] * math.cos(2 * math.pi * i / n) * t / rings, rr[i] * math.sin(2 * math.pi * i / n) * t / rings,
                           z + amp * (1 - (t / rings) ** 2) + random.uniform(-amp, amp) * 0.6 * (1 if t < rings else 0.2))) for i in range(n)] for t in range(1, rings + 1)]
    c = bm.verts.new((0, 0, z + amp))
    for i in range(n): bm.faces.new((c, rows[0][i], rows[0][(i + 1) % n]))
    for t in range(rings - 1):
        for i in range(n): bm.faces.new((rows[t][i], rows[t + 1][i], rows[t + 1][(i + 1) % n], rows[t][(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob
def hull2d(pts):
    pts = sorted(set(pts)); cr = lambda o, p, q: (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    lo = []; up = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def import_one(path):
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in sc.objects if o not in before and o.type == 'MESH']
def islands(ob):  # связные куски сетки: список списков индексов вершин
    bm = bmesh.new(); bm.from_mesh(ob.data); seen = set(); out = []
    for v in bm.verts:
        if v.index in seen: continue
        st = [v]; comp = []; seen.add(v.index)
        while st:
            x = st.pop(); comp.append(x.index)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen: seen.add(o.index); st.append(o)
        out.append(comp)
    bm.free(); return out
def delete_verts(ob, idx):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in idx], context='VERTS'); bm.to_mesh(ob.data); bm.free(); ob.data.update()

SOIL_RGB = (0.11, 0.065, 0.04)
# ---------------------------------------------------------------- кадка
if KIND == 'a':  # ящик «Версаль»: четыре стойки с навершиями, филёнки в рамках, земля внутри; всё из брусков с текстурой орехового шпона зала
    W = 0.46; H = 0.46; PS = 0.07; fin = 0.05
    tmp = tempfile.mkdtemp()
    def small(name, size, q):
        im = bpy.data.images.load(os.path.join(TEXDIR, name)); im.scale(size, size); p = os.path.join(tmp, name); im.file_format = 'JPEG'; im.filepath_raw = p; im.save(quality=q)
        ld = bpy.data.images.load(p); ld.name = name; ld.pack(); return ld
    col = small('walnut-color.jpg', 1024, 80); nor = small('walnut-normal.jpg', 512, 80); nor.colorspace_settings.name = 'Non-Color'
    wm = bpy.data.materials.new('wood'); wm.use_nodes = True; nt = wm.node_tree; bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nor
    nt.links.new(tc.outputs['Color'], bs.inputs['Base Color']); nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Roughness'].default_value = 0.55; bs.inputs['Metallic'].default_value = 0.0
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    def uvs(faces, vertical, off):  # развёртка в метрах по осям грани; волокна ореха идут вдоль u
        for f in faces:
            n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                p = l.vert.co; h = (p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y)
                u, v = (h[1], h[0]) if vertical else h
                l[uv].uv = (u + off[0], v + off[1])
    def box(cx, cy, z0, sx, sy, sz, vertical=False):
        r = bmesh.ops.create_cube(bm, size=1.0); vs = r['verts']
        for v in vs: v.co = V((cx + v.co.x * sx, cy + v.co.y * sy, z0 + (v.co.z + 0.5) * sz))
        fs = list({f for v in vs for f in v.link_faces}); uvs(fs, vertical, (random.random(), random.random())); return fs
    def frustum(cx, cy, z0, s0, s1, h):
        vs = [bm.verts.new((cx + sx * s / 2, cy + sy * s / 2, z)) for s, z in ((s0, z0), (s1, z0 + h)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        fs = [bm.faces.new((vs[3], vs[2], vs[1], vs[0])), bm.faces.new((vs[4], vs[5], vs[6], vs[7]))] + [bm.faces.new((vs[i], vs[(i + 1) % 4], vs[4 + (i + 1) % 4], vs[4 + i])) for i in range(4)]
        bmesh.ops.recalc_face_normals(bm, faces=fs); uvs(fs, True, (random.random(), random.random()))
    c = W / 2 - PS / 2; span = W - 2 * PS
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(sx * c, sy * c, 0, PS, PS, H, vertical=True)            # стойка
            box(sx * c, sy * c, H, PS * 1.15, PS * 1.15, 0.012)           # плита под навершие
            frustum(sx * c, sy * c, H + 0.012, PS * 0.95, PS * 0.30, fin) # пирамидка
    RT = 0.045  # верхняя и нижняя рамы, филёнка в них
    for sgn in (-1, 1):
        for ax in (0, 1):
            ex, ey = (span, 0.034) if ax == 0 else (0.034, span); ox, oy = (0, sgn * (W / 2 - 0.017 - 0.002)) if ax == 0 else (sgn * (W / 2 - 0.017 - 0.002), 0)
            box(ox, oy, H - 0.07, ex, ey, 0.07)                              # верхняя рама (с карнизным валиком)
            box(ox, oy, 0.045, ex, ey, 0.055)                                # нижняя рама
            pz0, pz1 = 0.10, H - 0.07
            px, py = (span - 0.012, 0.026) if ax == 0 else (0.026, span - 0.012)
            ix, iy = (0, sgn * (W / 2 - 0.013 - 0.004)) if ax == 0 else (sgn * (W / 2 - 0.013 - 0.004), 0)
            box(ix, iy, pz0, px, py, pz1 - pz0)                              # филёнка
            qx, qy = (px - 0.07, 0.012) if ax == 0 else (0.012, py - 0.07)
            fx, fy = (0, sgn * (W / 2 - 0.004 + 0.002)) if ax == 0 else (sgn * (W / 2 - 0.004 + 0.002), 0)
            box(fx, fy, pz0 + 0.035, qx, qy, pz1 - pz0 - 0.07)               # накладное поле филёнки
    box(0, 0, 0.04, W - 0.04, W - 0.04, 0.02)  # дно (под землёй, чтобы не просвечивало)
    me = bpy.data.meshes.new('planter'); bm.to_mesh(me); bm.free(); lo = bpy.data.objects.new('planter', me); sc.collection.objects.link(lo)
    lo.data.materials.append(wm); soil_z = H - 0.055
    half = W / 2 - PS * 0.5 - 0.01
    so = soil_mesh([(-half, -half), (half, -half), (half, half), (-half, half)], soil_z); so.data.materials.append(flat_material('soil', SOIL_RGB))
    bpy.ops.object.select_all(action='DESELECT'); lo = join([lo, so]); lo.name = 'planter'
    log('Versailles box', tuple(round(d, 3) for d in lo.dimensions), 'tris', tris(lo), 'soil z', round(soil_z, 3))
elif KIND == 'b':  # медная ванна: вариант Brass Refurbished (Object_10) из набора шести, без крышки, с землёй внутри
    obs = import_one(SRC)
    keep = next(o for o in obs if o.name == 'Object_10')
    for o in obs:
        if o != keep: bpy.data.objects.remove(o, do_unlink=True)
    ob = join([keep])
    drop = []  # крышка лежит рядом с ванной (y > 0.1 целиком) — выбрасываем эти куски
    for comp in islands(ob):
        if min(ob.data.vertices[i].co.y for i in comp) > 0.1: drop += comp
    delete_verts(ob, drop)
    for o in list(sc.objects):
        if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
    lo0, hi0 = bbox(ob); k = PH / (hi0.z - lo0.z)
    ob.data.transform(Matrix.Scale(k, 4)); ob.data.update(); lo0, hi0 = bbox(ob)
    body = sorted(islands(ob), key=len, reverse=True)
    big = body[0]; bp = [ob.data.vertices[i].co for i in big]  # корпус — самый большой кусок
    cx = (min(p.x for p in bp) + max(p.x for p in bp)) / 2; cy = (min(p.y for p in bp) + max(p.y for p in bp)) / 2
    ob.data.transform(Matrix.Translation(V((-cx, -cy, -lo0.z)))); ob.data.update(); lo0, hi0 = bbox(ob)
    bp = [ob.data.vertices[i].co for i in big]; rim = max(p.z for p in bp); soil_z = rim - 0.055  # земля на 5,5 см ниже края
    # внутренний вкладыш — следующий по размеру кусок такой же длины; его верхнее кольцо даёт контур земли
    bigx = max(p.x for p in bp) - min(p.x for p in bp)
    liner = next(c for c in body[1:] if (max(ob.data.vertices[i].co.x for i in c) - min(ob.data.vertices[i].co.x for i in c)) > 0.8 * bigx)
    ztop = max(ob.data.vertices[i].co.z for i in liner)
    sl = [(ob.data.vertices[i].co.x, ob.data.vertices[i].co.y) for i in liner if ob.data.vertices[i].co.z > ztop - 0.05]
    hull = hull2d([(round(x, 4), round(y, 4)) for x, y in sl])
    cxs = sum(p[0] for p in hull) / len(hull); cys = sum(p[1] for p in hull) / len(hull)  # контур чуть сжат: стенка сужается книзу
    poly = [(cxs + (p[0] - cxs) * 0.93, cys + (p[1] - cys) * 0.90) for p in hull]
    so = soil_mesh(poly, soil_z); so.data.materials.append(flat_material('soil', SOIL_RGB))
    t0n = tris(ob); bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    d = ob.modifiers.new('dec', 'DECIMATE'); d.ratio = min(1.0, TRIS / t0n); bpy.ops.object.modifier_apply(modifier='dec')
    lo = join([ob, so]); lo.name = 'planter'
    log('copper tub', tuple(round(d, 3) for d in lo.dimensions), 'tris', t0n, '->', tris(lo), 'rim', round(rim, 3), 'soil z', round(soil_z, 3), 'hull', len(hull))
    shrink_images(TEX)
elif KIND == 'c':  # горшок и блюдце — как есть, масштаб по высоте
    obs = import_one(SRC)
    for o in list(sc.objects):
        if o.type == 'EMPTY': pass
    ob = join(obs)
    for o in list(sc.objects):
        if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
    lo0, hi0 = bbox(ob); k = PH / (hi0.z - lo0.z)
    ob.data.transform(Matrix.Scale(k, 4)); ob.data.update(); lo0, hi0 = bbox(ob)
    ob.data.transform(Matrix.Translation(V((0, 0, -lo0.z)))); ob.data.update(); lo0, hi0 = bbox(ob)
    soil_z = hi0.z - 0.045
    # внутренний радиус по срезу у земли: самая близкая к оси вершина (стенка полая)
    ring = [math.hypot(v.co.x, v.co.y) for v in ob.data.vertices if abs(v.co.z - soil_z) < 0.01]
    rin = min(ring) if ring else 0.2; log('pot inner radius at soil', round(rin, 3), 'of', len(ring))
    n = 48; so = soil_mesh([(rin * 0.95 * math.cos(2 * math.pi * i / n), rin * 0.95 * math.sin(2 * math.pi * i / n)) for i in range(n)], soil_z)
    so.data.materials.append(flat_material('soil', SOIL_RGB))
    t0n = tris(ob); bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    d = ob.modifiers.new('dec', 'DECIMATE'); d.ratio = min(1.0, TRIS / t0n); bpy.ops.object.modifier_apply(modifier='dec')
    lo = join([ob, so]); lo.name = 'planter'
    log('green pot', t0n, '->', tris(lo), tuple(round(d, 3) for d in lo.dimensions), 'soil z', round(soil_z, 3))
    shrink_images(TEX)

# ---------------------------------------------------------------- пальма (как в palm_build.py)
before = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=palm_src)
new = [o for o in sc.objects if o not in before and o.type == 'MESH']
plant = [o for o in new if 'POT' not in o.name]
for o in new:
    if o not in plant: bpy.data.objects.remove(o, do_unlink=True)
pl = join(plant)
for m in pl.data.materials:  # LEAN: у листьев убираем карты рельефа и шероховатости — шероховатость числом
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for n in [n for n in nt.nodes if n.type in ('NORMAL_MAP', 'SEPARATE_COLOR') or (n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'Non-Color')]: nt.nodes.remove(n)
    b.inputs['Roughness'].default_value = 0.6; b.inputs['Metallic'].default_value = 0.0
for o in list(sc.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
pl.modifiers.new('dec', 'DECIMATE').ratio = TWIN; bpy.ops.object.select_all(action='DESELECT'); pl.select_set(True); bpy.context.view_layer.objects.active = pl
bpy.ops.object.modifier_apply(modifier='dec'); log('palm decimated to', tris(pl))
pl2 = pl.copy(); pl2.data = pl.data.copy(); sc.collection.objects.link(pl2); pl2.name = 'palm-b'
# высота растения после масштаба (до посадки) -> сколько воткнуть в землю, чтобы вся пальма от пола была TOTAL
tp = pl.data.copy(); tp.transform(Matrix.Diagonal((PXY, PXY, PK, 1))); pz = [v.co.z for v in tp.vertices]; PLANT_H = max(pz) - min(pz); bpy.data.meshes.remove(tp)
SINK = max(0.06, min(0.30, soil_z + PLANT_H - TOTAL)); log('plant h', round(PLANT_H, 3), 'soil', round(soil_z, 3), 'sink', round(SINK, 3))
def plant_at(ob, k, rot, dx, dy):
    ob.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Diagonal((PXY * k, PXY * k, PK * k, 1))); ob.data.update()
    plo, phi = bbox(ob)
    base = [v.co for v in ob.data.vertices if v.co.z < plo.z + 0.15]
    bx = sum(p.x for p in base) / len(base); by = sum(p.y for p in base) / len(base)
    brad = max(math.hypot(p.x - bx, p.y - by) for p in base)
    ob.data.transform(Matrix.Translation(V((dx - bx, dy - by, soil_z - SINK * k - plo.z)))); ob.data.update()
    return brad
brad = plant_at(pl, 1.0, 0, *P1)
plant_at(pl2, TWIN_K, 150, *P2)
plo, phi = bbox(pl); pl.name = 'palm'
log('palm base radius', round(brad, 3), 'plant z', round(plo.z, 3), round(phi.z, 3), 'tris', tris(pl), 'width', tuple(round(d, 3) for d in pl.dimensions))
bpy.ops.object.select_all(action='DESELECT'); pl.select_set(True); lo.select_set(True); pl2.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_jpeg_quality=88, export_tangents=False, export_apply=True, export_cameras=False, export_lights=False)
log('exported', dst, 'total tris', tris(pl) + tris(lo) + tris(pl2), 'top z', round(max(phi.z, bbox(pl2)[1].z), 3))
