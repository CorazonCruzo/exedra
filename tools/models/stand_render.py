"""Снимки подставки (Cycles, без окна): тёмный стол, тёплая лампа сверху слева, зелёная книга 17 x 24 x 3 см на полочке.

    Blender -b --factory-startup --python tools/models/stand_render.py -- подставка.glb выход.jpg ступень вид [--nobook] [--samples 96] [--res 1600x1000]

ступень — 1..6 (по возрастанию наклона вниз: 1 — рамка 60 градусов, 6 — самая пологая); вид — side | tq | close | closeview.
Позу ставят сами узлы glb: поворот frame вокруг оси шарниров (вокруг +X) и вложенный в него strut — так же, как будет делать код зала.
"""
import sys, math, json
import bpy
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import stand_kin

a = sys.argv[sys.argv.index('--') + 1:]
glb, outp, notch, view = a[0], a[1], int(a[2]), a[3]
book = '--nobook' not in a
samples = int(a[a.index('--samples') + 1]) if '--samples' in a else 96
res = a[a.index('--res') + 1] if '--res' in a else '1600x1000'
W, Hh = [int(x) for x in res.split('x')]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = {o.name.split('.')[0]: o for o in bpy.data.objects}
frame, strut = objs['frame'], objs['strut']
ROOT = (165.0, 77.17)
mm = lambda y, z, x=165.0: Vector(((x - ROOT[0]) * .001, (y - ROOT[1]) * .001, z * .001))

K = stand_kin.notches()['rows'][notch - 1]
topz = (12 + 292 * math.sin(math.radians(K['frame_deg'])) + 12 * math.cos(math.radians(K['frame_deg']))) * .001   # верх рамки над столом, м

# книга: в позе из файла (рамка 60 градусов), потом родитель — frame
cu, su = .5, math.sqrt(3) / 2
H = (-68.79, 12.0)
def at(u, n):
    return (H[0] + u * cu - n * su, H[1] + u * su + n * cu)

if book:
    y, z = at(42 + 120, 12 + 15)
    bpy.ops.mesh.primitive_cube_add(size=1)
    b = bpy.context.object
    b.name = 'book'
    b.scale = (.170, .240, .030)
    b.rotation_euler = (math.radians(60), 0, 0)
    b.location = mm(y, z)
    mat = bpy.data.materials.new('green')
    mat.use_nodes = True
    bs = mat.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (.02, .075, .036, 1)
    bs.inputs['Roughness'].default_value = .55
    b.data.materials.append(mat)
    bev = b.modifiers.new('bev', 'BEVEL'); bev.width = .0015; bev.segments = 1
    bpy.context.view_layer.update()
    b.parent = frame
    b.matrix_parent_inverse = frame.matrix_world.inverted()

frame.rotation_mode = 'XYZ'; strut.rotation_mode = 'XYZ'
frame.rotation_euler = (K['frame_rot_x'], 0, 0)
strut.rotation_euler = (K['strut_world_rot_x'] - K['frame_rot_x'], 0, 0)
bpy.context.view_layer.update()

# стол: тёмное дерево
bpy.ops.mesh.primitive_plane_add(size=14)
g = bpy.context.object
g.name = 'desk'
m = bpy.data.materials.new('desk'); m.use_nodes = True
nt = m.node_tree
for n in list(nt.nodes):
    if n.type not in ('OUTPUT_MATERIAL', 'BSDF_PRINCIPLED'):
        nt.nodes.remove(n)
bsdf = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord')
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 1.2, 14)
nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; nz.inputs['Detail'].default_value = 6
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = .35; ramp.color_ramp.elements[1].position = .65
ramp.color_ramp.elements[0].color = (.030, .018, .013, 1)
ramp.color_ramp.elements[1].color = (.052, .032, .023, 1)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = .5
g.data.materials.append(m)

# свет и камера
sc = bpy.context.scene
cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam)
sc.collection.objects.link(co); sc.camera = co
target = Vector((0, .02, .095))
if view == 'side':                          # профиль сбоку, камера чуть выше (10 градусов), чтобы был виден стол
    cam.type = 'ORTHO'; cam.ortho_scale = max(.46, 1.6 * (topz + .075))
    tz = cam.ortho_scale / 3.2 - .02
    target = Vector((0, .02, tz)); pos = target + Vector((1.2, 0, .17))
elif view == 'tq':
    cam.lens = 42
    target = Vector((0, .02, .45 * topz + .01))
    pos = target + Vector((.62, -.62, .30)).normalized() * (.78 + .6 * topz)
elif view == 'close':                       # профиль зубчатой планки и стопа распорки: низко сбоку, поверх правого бортика основания
    cam.lens = 80
    yk = (stand_kin.F0[0] + 25 * (notch - 1) - ROOT[1]) * .001
    pos = Vector((.5, yk - .02, .085)); target = Vector((0, yk, .026))
elif view == 'close34':                     # то же в три четверти, сзади-сверху
    cam.lens = 75
    yk = (stand_kin.F0[0] + 25 * (notch - 1) - ROOT[1]) * .001
    pos = Vector((.30, yk + .34, .22)); target = Vector((0, yk, .02))
elif view == 'hinge2':                      # шарнир сзади-слева, чтобы видеть стык листов шарнира при наклоне
    cam.lens = 110
    pos = Vector((-.42, .05, .11)); target = Vector((-.146, -.147, .02))
elif view == 'hinge':                       # нижний шарнир рамки (латунь)
    cam.lens = 90
    pos = Vector((-.40, -.40, .13)); target = Vector((-.146, -.147, .018))
co.location = pos
co.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()
right = co.matrix_world.to_quaternion() @ Vector((1, 0, 0))
up = co.matrix_world.to_quaternion() @ Vector((0, 1, 0))
fwd = (target - pos).normalized()
lp = target - fwd * .7 - right * .55 + up * .75
ld = bpy.data.lights.new('lamp', 'AREA'); ld.shape = 'DISK'; ld.size = .5
ld.energy = 7 * (2.4 if view in ('close', 'close34', 'hinge', 'hinge2') else 1)   # вблизи свет усилен
ld.color = (1.0, .70, .42)
lo = bpy.data.objects.new('lamp', ld); sc.collection.objects.link(lo)
lo.location = lp
lo.rotation_euler = (target - lp).to_track_quat('-Z', 'Y').to_euler()
fl = bpy.data.lights.new('fill', 'AREA'); fl.shape = 'DISK'; fl.size = .6; fl.energy = 1.6; fl.color = (.8, .85, 1)
fo = bpy.data.objects.new('fill', fl); sc.collection.objects.link(fo)
fo.location = target + right * .7 + up * .3 - fwd * .4
fo.rotation_euler = (target - fo.location).to_track_quat('-Z', 'Y').to_euler()
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.012, .010, .009, 1)

sc.render.engine = 'CYCLES'
sc.cycles.samples = samples; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = W, Hh
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.view_settings.exposure = .9
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
sc.render.filepath = outp
bpy.ops.render.render(write_still=True)
print('frame', K['frame_deg'], 'notch', notch)
