"""Скан дверного молотка (лев с кольцом, Battiporta — Musei Vaticani) -> лёгкая вещь для двери (assets/models/door/lion-knocker.glb).

Запуск (Blender без окна):
  Blender -b --factory-startup --python tools/models/knocker.py -- вход.glb выход.glb [--tris 14000] [--head 0.22] [--tex 1024] [--thr 0.45]

Скан — рельеф: лев и кусок двери вокруг него (рваный). Параметры плоскости двери и габариты головы подобраны под этот один файл (вверху скрипта).
  1. склеивает части скана, выравнивает плоскость двери в z = 0 (лицо к +z, голова прямо, кольцо внизу), сваривает швы;
  2. отбрасывает дверь: грани ближе --thr единиц к плоскости, потом остатки по коробкам (верхний и нижний лоскуты) и мелкие обломки;
  3. метры: высота головы (грива, без кольца) = --head; начало — центр спины головы; упрощает до --tris, ставит на плоскость z = 0
     юбку из края (выдавлена до плоскости), запекает цвет и рельеф (нормали) с полной сетки в текстуры --tex px;
  4. пишет .glb: одна сетка, один материал (цвет + нормали, металл 0.6, шероховатость 0.45), JPEG.
"""
import bpy, bmesh, sys, math, numpy as np, argparse
from mathutils import Vector
ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--tris', type=int, default=14000)
ap.add_argument('--head', type=float, default=0.22)
ap.add_argument('--tex', type=int, default=1024)
ap.add_argument('--thr', type=float, default=0.45)
ap.add_argument('--skirt', type=float, default=0.012)
ap.add_argument('--hi', default='')   # куда положить обрезанную полную сетку (для просмотра)
ap.add_argument('--metal', type=float, default=0.6)
ap.add_argument('--rough', type=float, default=0.45)
A = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

# плоскость двери в координатах скана: y = PA x + PB z + PC (лев смотрит к +y); центр головы и её высота в единицах скана после выравнивания
PA, PB, PC = -0.18098189, 0.05764147, -10.4976996
HEAD_X, HEAD_Z0, HEAD_Z1 = 1.1, -5.1, 11.4
RING = (1.95, -4.1, 5.0)  # центр и внешний радиус кольца

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=A.src)
sc = bpy.context.scene
ms = [o for o in sc.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
hi.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects):
    if o != hi: bpy.data.objects.remove(o, do_unlink=True)
me = hi.data
# 1. выравнивание: X вправо, Y вверх, Z к льву (кадр glTF), потом в кадр Blender (X, -Z, Y); метры; центр головы в начало
n = len(me.vertices); v = np.empty(n * 3); me.vertices.foreach_get('co', v); v = v.reshape(-1, 3)
n3 = np.array([-PA, 1.0, -PB]); n3 /= np.linalg.norm(n3)
up = np.array([0, 0, 1.0]); u2 = up - up.dot(n3) * n3; u2 /= np.linalg.norm(u2); u1 = np.cross(u2, n3)
q = v - np.array([0, PC, 0.0])
X, Y, Z = q @ u1, q @ u2, q @ n3
s = A.head / (HEAD_Z1 - HEAD_Z0); yc = (HEAD_Z0 + HEAD_Z1) / 2
me.vertices.foreach_set('co', np.stack([(X - HEAD_X) * s, -Z * s, (Y - yc) * s], 1).ravel()); me.update()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5 * s); bpy.ops.object.mode_set(mode='OBJECT')
# 2. дверь прочь. В кадре Blender: x вправо, z вверх, глубина над плоскостью = -y (в единицах скана = /s)
# цвет грани по текстуре скана (дверь тёмная сине-серая, грива золотая): нужен, чтобы убрать лоскуты двери, не трогая прядей
pix = {}
def texel(f, uvl):
    m = me.materials[f.material_index]
    if m not in pix:
        im = next(k.image for k in m.node_tree.nodes if k.type == 'TEX_IMAGE' and k.image)
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32); im.pixels.foreach_get(a); pix[m] = (a.reshape(im.size[1], im.size[0], 4), im.size)
    a, (w, h) = pix[m]
    u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops); vv = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
    return a[min(h - 1, max(0, int(vv * h))), min(w - 1, max(0, int(u * w))), :3]
def cut(f):
    c = f.calc_center_median(); d = -c.y / s; x = c.x / s + HEAD_X; z = c.z / s + yc
    if d < A.thr or any(-w.co.y / s < -0.3 for w in f.verts): return True
    if z > 9.9 and -4.4 < x < 5.4 and (d < 2.5 or z > 10.4):                                    # верхний лоскут двери над гривой: только тёмное, не золотое (уши ниже 10)
        r, g, b = texel(f, uvl)
        if max(r, g, b) < 0.3 and b >= r * 0.85: return True
        if z > 10.4 and r - b < 0.06: return True                                               # у самого верха — только золото
    if z < -4.2 and math.hypot(x - RING[0], z - RING[1]) > RING[2]: return True               # нижние лоскуты вокруг кольца
    return False
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); uvl = bm.loops.layers.uv.active
bmesh.ops.delete(bm, geom=[f for f in bm.faces if cut(f)], context='FACES')
def drop_loose(bm, share):
    bm.faces.ensure_lookup_table(); part = {}; sizes = []
    for f in bm.faces:
        if f.index in part: continue
        k = len(sizes); cnt = 0; st = [f]; part[f.index] = k
        while st:
            g = st.pop(); cnt += 1
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in part: part[h.index] = k; st.append(h)
        sizes.append(cnt)
    lim = max(sizes) * share
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if sizes[part[f.index]] < lim], context='FACES')
    bmesh.ops.delete(bm, geom=[w for w in bm.verts if not w.link_faces], context='VERTS')
    return sorted(sizes, reverse=True)[:6]
print('[knocker] parts', drop_loose(bm, 0.002))
bm.to_mesh(me); bm.free(); me.update()
print('[knocker] hi tris', sum(len(p.vertices) - 2 for p in me.polygons), 'dims', tuple(round(d, 4) for d in hi.dimensions))
if A.hi:
    bpy.ops.export_scene.gltf(filepath=A.hi, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=90, export_apply=True)

# 3. цвет из текстур скана светится сам: запекаем эмиссию
def emissive(old):
    m = bpy.data.materials.new('hi'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs['Emission'], out.inputs['Surface'])
    imgs = [k.image for k in old.node_tree.nodes if k.type == 'TEX_IMAGE' and k.image and k.image.colorspace_settings.name == 'sRGB']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = imgs[0]; nt.links.new(t.outputs['Color'], e.inputs['Color'])
    return m
for k in range(len(me.materials)): me.materials[k] = emissive(me.materials[k])
lo = hi.copy(); lo.data = hi.data.copy(); sc.collection.objects.link(lo)
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
d = lo.modifiers.new('dec', 'DECIMATE'); d.ratio = A.tris / max(1, sum(len(p.vertices) - 2 for p in lo.data.polygons)); bpy.ops.object.modifier_apply(modifier='dec')
print('[knocker] lo tris', sum(len(p.vertices) - 2 for p in lo.data.polygons))
while lo.data.uv_layers: lo.data.uv_layers.remove(lo.data.uv_layers[0])
bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003); bpy.ops.object.mode_set(mode='OBJECT')
col = bpy.data.images.new('colour', A.tex, A.tex); col.generated_color = (0.02, 0.02, 0.025, 1)
nor = bpy.data.images.new('normal', A.tex, A.tex); nor.colorspace_settings.name = 'Non-Color'; nor.generated_color = (0.5, 0.5, 1, 1)
lm = bpy.data.materials.new('lion-knocker'); lm.use_nodes = True; nt = lm.node_tree
bsdf = next(k for k in nt.nodes if k.type == 'BSDF_PRINCIPLED')
tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nor
lo.data.materials.clear(); lo.data.materials.append(lm)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
bk = sc.render.bake; bk.use_selected_to_active = True; bk.margin = 8; bk.use_clear = False
ext = max(hi.dimensions) * 0.006; bk.cage_extrusion = ext; bk.max_ray_distance = ext * 3
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
for k in nt.nodes: k.select = False
tc.select = True; nt.nodes.active = tc
bpy.ops.object.bake(type='EMIT'); print('[knocker] colour baked')
tc.select = False; tn.select = True; nt.nodes.active = tn
bpy.ops.object.bake(type='NORMAL'); print('[knocker] normal baked')
nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
lm.use_backface_culling = True; bsdf.inputs['Metallic'].default_value = A.metal; bsdf.inputs['Roughness'].default_value = A.rough
col.pack(); nor.pack()
bpy.data.objects.remove(hi, do_unlink=True)
# юбка: край у самой плоскости (ниже --skirt метров) выдавливается до z = 0 (в кадре Blender — y = 0); после запекания, чтобы её развёртка тянула цвет края.
# Свисающие пряди гривы не трогаются: под ними остаётся просвет.
bm = bmesh.new(); bm.from_mesh(lo.data)
edges = [e for e in bm.edges if e.is_boundary and all(-w.co.y < A.skirt for w in e.verts)]
r = bmesh.ops.extrude_edge_only(bm, edges=edges)
for w in [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]: w.co.y = 0.0
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
# у открытой сетки «наружу» может выйти и внутрь: лицо смотрит к -y (кадр Blender), если в среднем к +y — переворачиваем
if sum(f.normal.y * f.calc_area() for f in bm.faces) > 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
bm.to_mesh(lo.data); bm.free(); lo.data.update()
print('[knocker] with skirt', sum(len(p.vertices) - 2 for p in lo.data.polygons), 'tris')
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); lo.name = 'lion-knocker'
bpy.ops.export_scene.gltf(filepath=A.out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_tangents=False, export_apply=True)
print('[knocker] exported', A.out, 'dims', tuple(round(d, 4) for d in lo.dimensions))
