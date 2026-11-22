# Blender без окна: пальма (AllQuad, Dypsis lutescens, горшок убран) в медной жардиньерке (matousekfoto, Ornate planter) -> assets/models/lounge/palm.glb
# ... --python palm_build.py -- пальма.glb жардиньерка.glb выход.glb [--tris 7000] [--planter-h 0.5] [--palm-k 1.0] [--palm-xy 1.1] [--tex 1024] [--sink 0.05]
# Метры, Y вверх, начало — центр низа жардиньерки. Жардиньерка: три куска скана с тремя текстурами -> одна лёгкая сетка, цвет и рельеф запечены с полной.
# Пальма: только растение (лист — отсечение по альфе, доработка материала — post.py --mask), посажена на землю внутри жардиньерки.
import bpy, sys, math, bmesh, time
from mathutils import Vector as V, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
palm_src, pot_src, dst = a[:3]
def opt(k, d): return type(d)(a[a.index(k) + 1]) if k in a else d
TRIS = opt('--tris', 7000); PH = opt('--planter-h', 0.5); PK = opt('--palm-k', 1.0); PXY = opt('--palm-xy', 1.1); TEX = opt('--tex', 1024); LEAN = '--lean' in a; TWIN = opt('--twin', 0.0); TWIN_K = opt('--twin-k', 0.78); SINK = opt('--sink', 0.12)
t0 = time.time(); log = lambda *x: print('[palm]', round(time.time() - t0), *x, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
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

# ---- жардиньерка
bpy.ops.import_scene.gltf(filepath=pot_src)
hi = join([o for o in sc.objects if o.type == 'MESH'])
for o in list(sc.objects):
    if o != hi: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
lo0, hi0 = bbox(hi); k = PH / (hi0.z - lo0.z)
hi.data.transform(Matrix.Scale(k, 4)); hi.data.update()
lo0, hi0 = bbox(hi)
foot = [v.co for v in hi.data.vertices if v.co.z < lo0.z + 0.01]
cx = sum(p.x for p in foot) / len(foot); cy = sum(p.y for p in foot) / len(foot)
hi.data.transform(Matrix.Translation(V((-cx, -cy, -lo0.z)))); hi.data.update()
lo0, hi0 = bbox(hi)
log('planter scale', round(k, 4), 'dims', tuple(round(d, 3) for d in hi.dimensions), 'faces', len(hi.data.polygons))
# высота земли внутри: самая высокая точка в круге радиуса 0.06 м по центру чаши
soil_z = max(v.co.z for v in hi.data.vertices if math.hypot(v.co.x, v.co.y) < 0.06)
rim = max(v.co.z for v in hi.data.vertices if math.hypot(v.co.x, v.co.y) > 0.1 and v.co.z > PH * 0.8 and abs(v.co.y) < 0.06 and abs(v.co.x) < 0.2)
log('soil top z', round(soil_z, 3), 'rim approx', round(rim, 3))
def emissive(old):
    m = bpy.data.materials.new('hi'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs['Emission'], out.inputs['Surface'])
    img = next(n.image for n in old.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.links.new(t.outputs['Color'], e.inputs['Color'])
    return m
for i in range(len(hi.data.materials)): hi.data.materials[i] = emissive(hi.data.materials[i])
lo = hi.copy(); lo.data = hi.data.copy(); sc.collection.objects.link(lo)
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
d = lo.modifiers.new('dec', 'DECIMATE'); d.ratio = TRIS / tris(lo); bpy.ops.object.modifier_apply(modifier='dec')
log('planter decimated to', tris(lo))
while lo.data.uv_layers: lo.data.uv_layers.remove(lo.data.uv_layers[0])
bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004); bpy.ops.object.mode_set(mode='OBJECT')
col = bpy.data.images.new('planter-colour', TEX, TEX); col.generated_color = (0.2, 0.25, 0.22, 1)
nor = bpy.data.images.new('planter-normal', TEX, TEX); nor.colorspace_settings.name = 'Non-Color'; nor.generated_color = (0.5, 0.5, 1, 1)
lm = bpy.data.materials.new('planter-copper'); lm.use_nodes = True; nt = lm.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nor
lo.data.materials.clear(); lo.data.materials.append(lm)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
bk = sc.render.bake; bk.use_selected_to_active = True; bk.margin = 8; bk.use_clear = False
ext = max(hi.dimensions) * 0.006; bk.cage_extrusion = ext; bk.max_ray_distance = ext * 3
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
for n in nt.nodes: n.select = False
tc.select = True; nt.nodes.active = tc; bpy.ops.object.bake(type='EMIT'); log('colour baked')
tc.select = False; tn.select = True; nt.nodes.active = tn; bpy.ops.object.bake(type='NORMAL'); log('normal baked')
nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Metallic'].default_value = 0.55; bsdf.inputs['Roughness'].default_value = 0.5
# Экспортёр отдаёт JPEG «как есть» только для картинок, пришедших из файла: сохраняем запечённое и подгружаем обратно.
import tempfile, os
tmp = tempfile.mkdtemp(); sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
for node, im in ((tc, col), (tn, nor)):
    path = os.path.join(tmp, im.name + '.jpg'); im.file_format = 'JPEG'; im.filepath_raw = path; im.save(quality=88)
    ld = bpy.data.images.load(path); ld.name = im.name; ld.colorspace_settings.name = im.colorspace_settings.name; ld.pack(); node.image = ld
lo.name = 'planter'; bpy.data.objects.remove(hi, do_unlink=True)

# ---- пальма
before = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=palm_src)
new = [o for o in sc.objects if o not in before and o.type == 'MESH']
plant = [o for o in new if 'POT' not in o.name]
for o in new:
    if o not in plant: bpy.data.objects.remove(o, do_unlink=True)
pl = join(plant)
if LEAN:  # у листьев убираем карты рельефа и шероховатости: на тонких карточках их почти не видно, а весят вместе 0,6 МБ — шероховатость одним числом
    for m in pl.data.materials:
        nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for n in [n for n in nt.nodes if n.type in ('NORMAL_MAP', 'SEPARATE_COLOR') or (n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'Non-Color')]: nt.nodes.remove(n)
        b.inputs['Roughness'].default_value = 0.6; b.inputs['Metallic'].default_value = 0.0
for o in list(sc.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
if TWIN:  # второе растение: оба упрощены до доли TWIN (листочки — полоски по несколько треугольников, сворачиваются без больших потерь)
    pl.modifiers.new('dec', 'DECIMATE').ratio = TWIN; bpy.ops.object.select_all(action='DESELECT'); pl.select_set(True); bpy.context.view_layer.objects.active = pl
    bpy.ops.object.modifier_apply(modifier='dec'); log('palm decimated to', tris(pl))
    pl2 = pl.copy(); pl2.data = pl.data.copy(); sc.collection.objects.link(pl2); pl2.name = 'palm-b'
def plant_at(ob, k, rot, dx, dy):  # растение шире, чем выше (кроне нужна полнота); стебли втыкаются в землю в точке (dx, dy)
    ob.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Diagonal((PXY * k, PXY * k, PK * k, 1))); ob.data.update()
    plo, phi = bbox(ob)
    base = [v.co for v in ob.data.vertices if v.co.z < plo.z + 0.15]
    bx = sum(p.x for p in base) / len(base); by = sum(p.y for p in base) / len(base)
    brad = max(math.hypot(p.x - bx, p.y - by) for p in base)
    ob.data.transform(Matrix.Translation(V((dx - bx, dy - by, soil_z - SINK * k - plo.z)))); ob.data.update()
    return brad
brad = plant_at(pl, 1.0, 0, 0, 0)
if TWIN: plant_at(pl2, TWIN_K, 150, 0.04, 0.025)
plo, phi = bbox(pl); pl.name = 'palm'
log('palm base radius', round(brad, 3), 'plant z', round(plo.z, 3), round(phi.z, 3), 'tris', tris(pl), 'width', tuple(round(d, 3) for d in pl.dimensions))
for o in (pl, lo): o.select_set(True)
bpy.ops.object.select_all(action='DESELECT'); pl.select_set(True); lo.select_set(True)
if TWIN: pl2.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_jpeg_quality=88, export_tangents=False, export_apply=True, export_cameras=False, export_lights=False)
log('exported', dst, 'total tris', tris(pl) + tris(lo) + (tris(pl2) if TWIN else 0))
