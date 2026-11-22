# Blender без окна: скан с цветом в вершинах (миллионы треугольников, текстур нет) -> лёгкая сетка с развёрткой,
# на которую цвет и рельеф исходного скана перенесены текстурами (запекание «с выбранного на активный»).
import bpy, sys, math, time
src, dst, tris, size = sys.argv[sys.argv.index('--') + 1:][:4]
tris, size = int(tris), int(size); t0 = time.time()
log = lambda *a: print('[bake]', round(time.time() - t0), *a, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects):
    if o != hi: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
# Исходник светится своим цветом: запекание не зависит от света. Цвет — из текстуры материала, а если текстур нет — из цвета вершин.
attr = hi.data.color_attributes[0].name if hi.data.color_attributes else None
log('joined', len(hi.data.polygons), 'faces, colour attribute', attr, 'materials', len(hi.data.materials), 'dims', tuple(round(v, 3) for v in hi.dimensions))
def emissive(old):
    m = bpy.data.materials.new('hi'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs['Emission'], out.inputs['Surface'])
    img = None
    if old and old.use_nodes:
        imgs = [n.image for n in old.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB']
        img = imgs[0] if imgs else None
    if img:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.links.new(t.outputs['Color'], e.inputs['Color'])
    else:
        # Цвет в вершинах скана записан уже в sRGB, а glTF считает его линейным: без поправки запечённая текстура выходит белёсой.
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = attr or ''
        gm = nt.nodes.new('ShaderNodeGamma'); gm.inputs['Gamma'].default_value = 2.2
        nt.links.new(a.outputs['Color'], gm.inputs['Color']); nt.links.new(gm.outputs['Color'], e.inputs['Color'])
    return m, bool(img)
for k in range(len(hi.data.materials)):
    hi.data.materials[k], textured = emissive(hi.data.materials[k]); log('material', k, 'from texture' if textured else 'from vertex colour')
if not hi.data.materials: hi.data.materials.append(emissive(None)[0])
# Лёгкая копия.
lo = hi.copy(); lo.data = hi.data.copy(); sc.collection.objects.link(lo)
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
# Поверхность скана оперения рваная: сотни тысяч краёв и тысячи отдельных хлопьев — такая сетка почти не упрощается.
# Поэтому лёгкая копия сначала склеивается по расстоянию (около двух миллиметров настоящего размера): хлопья срастаются с поверхностью,
# разрывы закрываются; от неё остаётся самый большой связный кусок, и уже он упрощается. Цвет и рельеф запекаются с полного исходника.
import bmesh
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=max(hi.dimensions) / 400); bpy.ops.mesh.delete_loose(); bpy.ops.object.mode_set(mode='OBJECT')
bm = bmesh.new(); bm.from_mesh(lo.data); bm.faces.ensure_lookup_table()
part = [-1] * len(bm.faces); sizes = []
for f in bm.faces:
    if part[f.index] >= 0: continue
    k = len(sizes); n = 0; stack = [f]; part[f.index] = k
    while stack:
        g = stack.pop(); n += 1
        for e in g.edges:
            for h in e.link_faces:
                if part[h.index] < 0: part[h.index] = k; stack.append(h)
    sizes.append(n)
keep = max(range(len(sizes)), key=lambda k: sizes[k])
bmesh.ops.delete(bm, geom=[f for f in bm.faces if part[f.index] != keep], context='FACES')
bm.to_mesh(lo.data); bm.free(); lo.data.update()
log('welded; kept the largest of', len(sizes), 'parts:', len(lo.data.polygons), 'faces')
d = lo.modifiers.new('dec', 'DECIMATE'); d.ratio = tris / max(1, sum(len(p.vertices) - 2 for p in lo.data.polygons)); bpy.ops.object.modifier_apply(modifier='dec')
log('decimated to', sum(len(p.vertices) - 2 for p in lo.data.polygons), 'tris')
while lo.data.uv_layers: lo.data.uv_layers.remove(lo.data.uv_layers[0])
bpy.ops.object.shade_smooth()
try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as ex: log('no custom normals to clear:', ex)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.002); bpy.ops.object.mode_set(mode='OBJECT')
log('unwrapped')
col = bpy.data.images.new('colour', size, size); nor = bpy.data.images.new('normal', size, size); nor.colorspace_settings.name = 'Non-Color'
lm = bpy.data.materials.new('owl'); lm.use_nodes = True; nt = lm.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nor
lo.data.materials.clear(); lo.data.materials.append(lm)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
bk = sc.render.bake; bk.use_selected_to_active = True; bk.margin = 8
ext = max(hi.dimensions) * 0.004; bk.cage_extrusion = ext; bk.max_ray_distance = ext * 3
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
for n in nt.nodes: n.select = False
tc.select = True; nt.nodes.active = tc
bpy.ops.object.bake(type='EMIT'); log('colour baked')
tc.select = False; tn.select = True; nt.nodes.active = tn
bpy.ops.object.bake(type='NORMAL'); log('normal baked')
nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.85; bsdf.inputs['Metallic'].default_value = 0.0
col.pack(); nor.pack()
while lo.data.color_attributes: lo.data.color_attributes.remove(lo.data.color_attributes[0])
bpy.data.objects.remove(hi, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_tangents=False, export_apply=True)
log('exported', dst)
