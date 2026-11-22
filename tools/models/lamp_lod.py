# Blender без окна: банкирская лампа -> две лёгкие сетки (mid, far) из частей body/glass/chain в мировых координатах, UV и нормали с оригинала, без материалов.
# Запуск: Blender -b --factory-startup --python tools/models/lamp_lod.py -- assets/models/bankers-lamp.glb mid.glb far.glb [--glass-skip i,j]
import bpy, bmesh, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst_mid, dst_far = args[:3]
SKIP = [int(i) for i in args[args.index('--glass-skip') + 1].split(',')] if '--glass-skip' in args else []  # индексы в списке найденных «стёкол», которые отдать в body
BEAD_TRIS = 480          # столько треугольников в бусине цепочки; цепочка — всё, что целиком висит в её отвесе (бусины, верхнее звено, кисточка)
CHAIN_R = 0.05           # ...не дальше этой доли размаха лампы от оси бусин
GLASS_BOTTOM = 0.62      # низ стекла выше этой доли высоты лампы...
GLASS_SPAN = 0.50        # ...и размах по горизонтали больше этой доли размаха лампы
BEAD = 40                # треугольников на бусину цепочки (mid)
TASSEL = 160             # ...и на кисточку на её конце
BUDGET = {'mid': {'body': 9000, 'glass': 1250}, 'far': {'body': 880, 'glass': 296}}
FLOOR = {'mid': 40, 'far': 24}   # меньше этого на деталь не опускаемся
THIN_R = 0.25           # вершины ближе этой доли радиуса к оси — «стебель», его защищаем при упрощении
THIN_W = 0.1
POWER = {'mid': 0.8, 'far': 1.2}   # доля бюджета детали ~ (диагональ габарита)^POWER

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def world_bbox(o):
    pts = [o.data.vertices[i].co for i in range(len(o.data.vertices))]
    lo = Vector([min(p[k] for p in pts) for k in range(3)]); hi = Vector([max(p[k] for p in pts) for k in range(3)])
    return lo, hi

def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # вершины — в мировых координатах (Blender: z вверх)
    for o in ms: o.data.materials.clear()
    return ms

def classify(ms, report=False):
    box = [world_bbox(o) for o in ms]
    lo = Vector([min(b[0][k] for b in box) for k in range(3)]); hi = Vector([max(b[1][k] for b in box) for k in range(3)])
    H = hi.z - lo.z; W = max(hi.x - lo.x, hi.y - lo.y)
    groups = {'chain': [], 'glass': [], 'body': []}
    cand = 0
    beads = [(a + b) / 2 for o, (a, b) in zip(ms, box) if tris(o) == BEAD_TRIS]
    ax, ay = sum(c.x for c in beads) / len(beads), sum(c.y for c in beads) / len(beads)
    for i, (o, (a, b)) in enumerate(zip(ms, box)):
        if max(abs(a.x - ax), abs(b.x - ax), abs(a.y - ay), abs(b.y - ay)) < CHAIN_R * W:
            if report: print('CHAIN: mesh', i, o.name, 'tris', tris(o))
            groups['chain'].append(o); continue
        if a.z > lo.z + GLASS_BOTTOM * H and max(b.x - a.x, b.y - a.y) > GLASS_SPAN * W:
            if report: print('GLASS match: mesh', i, o.name, 'tris', tris(o), 'bbox z', round(a.z, 3), round(b.z, 3), 'span', round(max(b.x - a.x, b.y - a.y), 3))
            cand += 1
            if cand - 1 not in SKIP: groups['glass'].append(o); continue
        groups['body'].append(o)
    if report:
        print('lamp bbox (Blender z-up)', tuple(round(v, 4) for v in lo), tuple(round(v, 4) for v in hi))
        print({k: (len(v), sum(tris(o) for o in v)) for k, v in groups.items()})
    return groups, lo, hi

def thin_weights(o):
    # вес вершины для Decimate: у тонкого стебля мал (его схлопывают в последнюю очередь), у широкого основания 1; ось — по верхней части детали
    vs = [v.co for v in o.data.vertices]
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    top = [v for v in vs if v.z > z0 + 0.6 * (z1 - z0)]
    cx = (min(v.x for v in top) + max(v.x for v in top)) / 2; cy = (min(v.y for v in top) + max(v.y for v in top)) / 2
    rmax = max(((v.x - cx) ** 2 + (v.y - cy) ** 2) ** 0.5 for v in vs)
    return [THIN_W if ((v.x - cx) ** 2 + (v.y - cy) ** 2) ** 0.5 < THIN_R * rmax else 1.0 for v in vs]

def decimate(o, target, protect=False):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=DIST)
    bm.to_mesh(o.data); bm.free()
    n = tris(o); lo0, hi0 = world_bbox(o)
    if target >= n: return
    if protect:
        vg = o.vertex_groups.new(name='thin')
        for i, w in enumerate(thin_weights(o)): vg.add([i], w, 'REPLACE')
    ref = o.copy(); ref.data = o.data.copy(); bpy.context.scene.collection.objects.link(ref)  # оригинал детали — источник нормалей
    m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target / n; m.use_collapse_triangulate = True
    if protect: m.vertex_group = 'thin'; m.vertex_group_factor = 1.0
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')
    for p in o.data.polygons: p.use_smooth = True
    t = o.modifiers.new('nrm', 'DATA_TRANSFER'); t.object = ref; t.use_loop_data = True; t.data_types_loops = {'CUSTOM_NORMAL'}
    t.loop_mapping = 'POLYINTERP_NEAREST'; t.use_object_transform = False
    bpy.ops.object.modifier_apply(modifier='nrm')
    bpy.data.objects.remove(ref, do_unlink=True)
    # Decimate чуть сжимает крайние точки: растягиваем деталь до габарита оригинала (если не слишком сильно разошлись)
    lo1, hi1 = world_bbox(o)
    if all(0.8 < (hi0[k] - lo0[k]) / max(hi1[k] - lo1[k], 1e-9) < 1.3 for k in range(3)):
        for v in o.data.vertices:
            v.co = Vector([lo0[k] + (v.co[k] - lo1[k]) * (hi0[k] - lo0[k]) / (hi1[k] - lo1[k]) for k in range(3)])

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    return o

def build(mode, dst):
    global DIST
    ms = load()
    groups, lo, hi = classify(ms, report=(mode == 'mid'))
    DIST = 1e-5 * (hi - lo).length
    out = []
    for g in ('body', 'glass'):
        objs = groups[g]
        diag = {o: (lambda b: (b[1] - b[0]).length)(world_bbox(o)) for o in objs}
        biggest = max(objs, key=tris) if g == 'body' else None  # основание со стеблем
        wsum = sum(d ** POWER[mode] for d in diag.values())
        for o in objs:
            decimate(o, max(FLOOR[mode], round(BUDGET[mode][g] * diag[o] ** POWER[mode] / wsum)), protect=(o is biggest and mode == 'far'))
            print(mode, g, o.name, 'diag', round(diag[o], 3), '->', tris(o))
        out.append(join(objs, g))
    if mode == 'mid':
        for o in groups['chain']:
            if tris(o) > 200: decimate(o, BEAD if tris(o) == BEAD_TRIS else TASSEL)  # бусины и кисточка; верхнее звено (80 треугольников) — как есть
        out.append(join(groups['chain'], 'chain'))
    print(mode, {o.name: tris(o) for o in out}, 'total', sum(tris(o) for o in out))
    for o in out:
        for p in o.data.polygons: p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in out: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_materials='NONE', export_image_format='NONE',
        export_texcoords=True, export_normals=True, export_tangents=False, export_vertex_color='NONE', export_cameras=False, export_lights=False,
        export_apply=False, export_yup=True, export_draco_mesh_compression_enable=False)

build('mid', dst_mid)
build('far', dst_far)
