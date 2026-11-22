# Blender без окна: ковёр mfb64 «Fine Persian Heriz Carpet» (628 тыс. треугольников, из них 625 тыс. — бахрома) -> плоский лист в ~1 тыс. треугольников.
# ... --python rug_build.py -- rug.glb выход.glb [--side 2048] [--tris 1000]
#  * полотно (Object_4, уже почти плоское) упрощается, цвет — исходная фотография (1024 px) -> side, слегка подостренная;
#  * карта нормалей синтезируется: рельеф = контуры красителя из яркости фотографии + мелкое «зерно» узелков + крупная неровность; полотно лежит плоско;
#  * бахрома — две полосы-четырёхугольника на коротких концах с прорезной (alphaMode MASK) текстурой пучков нитей вместо 625 тыс. треугольников.
import bpy, sys, math, random, bmesh
import numpy as np
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[:2]
def opt(k, d=None): return a[a.index(k) + 1] if k in a else d
side = int(opt('--side', 2048)); tris = int(opt('--tris', 1000))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.image_settings.quality = 80
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == 'MESH' and o.name != 'Object_4': bpy.data.objects.remove(o, do_unlink=True)
ob = next(o for o in sc.objects if o.type == 'MESH')
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for o in list(sc.objects):
    if o != ob: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
# Сплющить в плоскость (z ±6 мм от скручивания краёв) и упростить.
for v in me.vertices: v.co.z = 0.0
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
n0 = len(me.polygons) * 2
m = ob.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(1); bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris(); bpy.ops.object.mode_set(mode='OBJECT')
nt = sum(len(p.vertices) - 2 for p in me.polygons); print('RUG carpet tris', n0, '->', nt)
if nt > tris:
    m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = tris / nt; bpy.ops.object.modifier_apply(modifier='dec')
# Цвет и нормали.
src_img = next(i for i in bpy.data.images if i.name.startswith('Image_0'))
W0, H0 = src_img.size
px = np.empty(W0 * H0 * 4, dtype=np.float32); src_img.pixels.foreach_get(px); px = px.reshape(H0, W0, 4)[:, :, :3]  # sRGB-кодированные значения
def resize(arr, n):  # билинейно, numpy
    h, w = arr.shape[:2]; ys = (np.arange(n) + 0.5) * h / n - 0.5; xs = (np.arange(n) + 0.5) * w / n - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1); x0 = np.clip(np.floor(xs).astype(int), 0, w - 1); y1 = np.clip(y0 + 1, 0, h - 1); x1 = np.clip(x0 + 1, 0, w - 1)
    fy = (ys - np.floor(ys))[:, None, None] if arr.ndim == 3 else (ys - np.floor(ys))[:, None]; fx = (xs - np.floor(xs))[None, :, None] if arr.ndim == 3 else (xs - np.floor(xs))[None, :]
    return (arr[y0][:, x0] * (1 - fx) + arr[y0][:, x1] * fx) * (1 - fy) + (arr[y1][:, x0] * (1 - fx) + arr[y1][:, x1] * fx) * fy
def blur(arr, r):  # прямоугольное размытие через FFT-свёртку по осям (дёшево)
    k = np.zeros(arr.shape[0]); k[:r + 1] = 1; k[-r:] = 1; k /= k.sum()
    K = np.fft.rfft(k)
    t = np.fft.irfft(np.fft.rfft(arr, axis=0) * K[:, None], n=arr.shape[0], axis=0)
    return np.fft.irfft(np.fft.rfft(t, axis=1) * K[None, :], n=arr.shape[1], axis=1)
col = np.clip(resize(px, side), 0, 1)
rng = np.random.default_rng(7)
# подострить цвет (маска нерезкости), чтобы мелкий рисунок читался при увеличении
bl = np.stack([blur(col[:, :, c], 2) for c in range(3)], axis=2); col = np.clip(col + 0.6 * (col - bl), 0, 1)
# рельеф считается вдвое грубее цвета (карта нормалей — 1024): контуры красителя (высокие частоты яркости) + узелки + крупная неровность ворса
ns = side // 2
lum = resize(px, ns) @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
knots = blur(rng.standard_normal((ns, ns)).astype(np.float32), 1)
big = blur(rng.standard_normal((ns, ns)).astype(np.float32), 12)
hf = lum - blur(lum, 2)
h = 0.9 * hf / (hf.std() + 1e-6) + 0.55 * knots / (knots.std() + 1e-6) + 0.35 * big / (big.std() + 1e-6)
strength = 0.9
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
nx, ny, nz = -gx, gy, np.ones_like(gx)   # +Y = вверх в картинке (OpenGL), как ждёт glTF; строки картинки идут сверху вниз -> знак у gy
nl = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2); nrm = np.stack([nx / nl, ny / nl, nz / nl], axis=2) * 0.5 + 0.5
# Картинки Blender хранят строки снизу вверх — перевернуть массивы.
def mk(name, arr, srgb, fmt='JPEG'):
    im = bpy.data.images.new(name, arr.shape[1], arr.shape[0], alpha=arr.shape[2] == 4); im.file_format = fmt
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    out = np.ones((arr.shape[0], arr.shape[1], 4), dtype=np.float32); out[:, :, :arr.shape[2]] = arr[::-1]
    im.pixels.foreach_set(out.reshape(-1)); im.pack(); return im
# Фотография в Blender читается в сыром виде sRGB-значений (pixels — линейные только для не-sRGB; здесь берётся то, что отдаёт пакет): запись в ту же sRGB-картинку даёт тот же код.
img_col = mk('carpet_colour', col[::-1], True); img_nor = mk('carpet_normal', nrm[::-1], False)
mat = bpy.data.materials.new('carpet'); mat.use_nodes = True; t = mat.node_tree; b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
tc = t.nodes.new('ShaderNodeTexImage'); tc.image = img_col; tn = t.nodes.new('ShaderNodeTexImage'); tn.image = img_nor
nm = t.nodes.new('ShaderNodeNormalMap'); t.links.new(tc.outputs['Color'], b.inputs['Base Color']); t.links.new(tn.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
b.inputs['Roughness'].default_value = 0.92; b.inputs['Metallic'].default_value = 0.0
me.materials.clear(); me.materials.append(mat)
# Бахрома: полосы на концах по x (там, где у фотографии кромка), нити лежат вдоль x наружу.
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys); FL = 0.075
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.verify()
def strip(xa, xb, flip):
    vs = [bm.verts.new((xa, y0, 0)), bm.verts.new((xa, y1, 0)), bm.verts.new((xb, y1, 0)), bm.verts.new((xb, y0, 0))]
    f = bm.faces.new(vs if not flip else vs[::-1])
    for l, uv in zip(f.loops, ([(0, 0), (1, 0), (1, 1), (0, 1)] if not flip else [(0, 1), (1, 1), (1, 0), (0, 0)])): l[uvl].uv = uv
    f.material_index = 1
    return f
fL = strip(x0 - FL, x0 + 0.004, False); fR = strip(x1 - 0.004, x1 + FL, False)
# нормали вверх
for f in bm.faces:
    if f.normal.z < 0: f.normal_flip()
bm.to_mesh(me); bm.free(); me.update()
# узор нитей: u вдоль y (2048 по 2,87 м ≈ 1,4 мм), v вдоль x; левая полоса — v от наружи (0) к полотну (1), правая зеркально -> одна текстура с развёрткой, где v=1 у полотна/0 снаружи
SW, SH = 2048, 64
al = np.zeros((SH, SW), dtype=np.float32); cc = np.zeros((SH, SW, 3), dtype=np.float32)
rng2 = np.random.default_rng(11)
yy = np.arange(SH)[:, None]  # строка 0 = внешний конец (в Blender-картинке строка 0 — низ, но мы запишем как есть и согласуем с UV ниже)
nstr = 1100
for i in range(nstr):
    u = rng2.uniform(0, SW); lean = rng2.normal(0, 0.12); wob = rng2.uniform(0.5, 2.5); ph = rng2.uniform(0, 6.28); w = rng2.uniform(0.7, 1.4)
    L = rng2.uniform(0.62, 1.0)  # длина нити (доля от полосы)
    tint = rng2.uniform(0.82, 1.08); base = np.array([0.88, 0.80, 0.66]) * tint
    for r in range(int(SH * L)):
        # ближе к краю (r=0) нити уже торчат из ковра; сдвиг — волна + наклон
        cx = u + lean * r + wob * math.sin(ph + r * 0.18)
        for dx in (-1, 0, 1):
            px_ = int(round(cx)) + dx
            cov = max(0.0, 1.0 - abs(cx - px_) / (w + 0.5))
            if cov > 0 and 0 <= px_ < SW and al[r, px_ % SW] < cov:
                al[r, px_ % SW] = cov; cc[r, px_ % SW] = base * (0.9 + 0.1 * math.cos(ph + r))
# строка r=0 у полотна, растёт наружу: убрать «хвосты» у края — альфа 1 в первых строках у полотна
al[:3, :] = np.maximum(al[:3, :], 0.9)
fr = np.zeros((SH, SW, 4), dtype=np.float32); fr[:, :, :3] = cc; fr[:, :, 3] = (al > 0.35).astype(np.float32)
# Теперь UV: строка r=0 — у полотна. Для картинки Blender (строка 0 — низ, v=0): v=0 у полотна. Левая полоса: v=1 снаружи -> уже заданы uv (0,0),(1,0) на x0-FL => снаружи v=0: инвертируем.
img_fr = mk('fringe', fr, True, 'PNG')
fmat = bpy.data.materials.new('fringe'); fmat.use_nodes = True; t = fmat.node_tree; b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
ti = t.nodes.new('ShaderNodeTexImage'); ti.image = img_fr; t.links.new(ti.outputs['Color'], b.inputs['Base Color']); t.links.new(ti.outputs['Alpha'], b.inputs['Alpha'])
b.inputs['Roughness'].default_value = 0.95
me.materials.append(fmat)
# UV полос: v=0 — у полотна, v=1 — наружу.
uvd = me.uv_layers.active.data
for p in me.polygons:
    if p.material_index == 1:
        cs = [me.vertices[me.loops[l].vertex_index].co for l in p.loop_indices]
        for l in p.loop_indices:
            c = me.vertices[me.loops[l].vertex_index].co
            u = (c.y - y0) / (y1 - y0)
            if c.x < 0: v = 1.0 - (c.x - (x0 - FL)) / FL      # левая: снаружи x0-FL -> v=1
            else: v = (c.x - (x1 - 0.004)) / FL * 1.0         # правая: снаружи x1+FL -> v=1 ...
            uvd[l].uv = (u, min(max(v, 0), 1))
# поправка: у левой полосы вторая точка внутри полотна — v у полотна 0
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
print('RUG final tris', sum(len(p.vertices) - 2 for p in me.polygons), 'dims', tuple(round(v, 3) for v in ob.dimensions))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=80, export_apply=True, export_cameras=False, export_lights=False, use_selection=True, export_tangents=False)
