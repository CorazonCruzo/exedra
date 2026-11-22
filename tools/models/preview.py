import bpy, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--')+1:]
src, outdir = args[:2]
# Третий параметр fit / fit-flat — высокая вещь (пилястра): кадр по габаритам, глина с запечённым затенением (fit) или без него (fit-flat).
fit = args[2] if len(args) > 2 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc=bpy.context.scene
try: sc.render.engine='BLENDER_EEVEE'
except TypeError: sc.render.engine='BLENDER_EEVEE_NEXT'
sc.render.resolution_x=800; sc.render.resolution_y=800
sc.render.image_settings.file_format='JPEG'; sc.render.image_settings.quality=88
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True
w.node_tree.nodes['Background'].inputs[0].default_value=(0.55,0.55,0.55,1); w.node_tree.nodes['Background'].inputs[1].default_value=0.8
if fit:
    from mathutils import Vector as V
    ms=[o for o in bpy.data.objects if o.type=='MESH']
    pts=[o.matrix_world@V(c) for o in ms for c in o.bound_box]
    lo=V([min(p[i] for p in pts) for i in range(3)]); hi=V([max(p[i] for p in pts) for i in range(3)])
    ctr=(lo+hi)/2; H=hi.z-lo.z; wy=hi.y  # blender: низ — по z, спина — по +y
    clay=bpy.data.materials.new('clay'); clay.use_nodes=True; b=clay.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(0.82,0.8,0.76,1); b.inputs['Roughness'].default_value=0.85
    if fit=='fit' and any(len(o.data.color_attributes) for o in ms):
        ca=clay.node_tree.nodes.new('ShaderNodeVertexColor'); mix=clay.node_tree.nodes.new('ShaderNodeMix'); mix.data_type='RGBA'; mix.blend_type='MULTIPLY'
        mix.inputs[0].default_value=1; mix.inputs[6].default_value=(0.82,0.8,0.76,1)
        clay.node_tree.links.new(ca.outputs['Color'],mix.inputs[7]); clay.node_tree.links.new(mix.outputs[2],b.inputs['Base Color'])
    for o in ms: o.data.materials.clear(); o.data.materials.append(clay)
    bpy.ops.mesh.primitive_plane_add(size=H*3,location=(ctr.x,wy,ctr.z),rotation=(math.pi/2,0,0)); wall=bpy.context.object
    m=bpy.data.materials.new('wall'); m.use_nodes=True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.62,0.6,0.56,1); wall.data.materials.append(m)
    def alight(loc,e):
        bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; l.data.energy=e; l.data.size=H*0.8
        l.rotation_euler=(ctr-V(loc)).to_track_quat('-Z','Y').to_euler()
    k=(H/1.5)**2
    alight((ctr.x-H*0.8,ctr.y-H*1.3,ctr.z+H*0.9),250*k); alight((ctr.x+H*1.0,ctr.y-H*1.0,ctr.z-H*0.1),80*k)
    def fshot(name,loc,f,tgt):
        bpy.ops.object.camera_add(location=loc); c=bpy.context.object; c.data.lens=f; c.data.clip_end=H*20
        c.rotation_euler=(tgt-V(loc)).to_track_quat('-Z','Y').to_euler()
        sc.camera=c; sc.render.filepath=outdir+'/'+name; bpy.ops.render.render(write_still=True)
    # лицо — к -y (в glTF — к +z); по высоте кадр целиком, длинное фокусное ≈ чертёж
    fshot('front.jpg',(ctr.x,ctr.y-H*1.6,ctr.z),50,ctr)
    fshot("three-quarter.jpg",(ctr.x+H*0.75,ctr.y-H*1.5,ctr.z+H*0.15),50,V((ctr.x,ctr.y,ctr.z)))
    sys.exit()
# wall: glTF z=-0.017 -> blender y=+0.017
bpy.ops.mesh.primitive_plane_add(size=3, location=(0,0.017,0.15), rotation=(math.pi/2,0,0))
wall=bpy.context.object; m=bpy.data.materials.new('wall'); m.use_nodes=True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.62,0.6,0.56,1); wall.data.materials.append(m)
def light(loc, e, kind='AREA', size=1.5):
    bpy.ops.object.light_add(type=kind, location=loc); l=bpy.context.object
    l.data.energy=e
    if kind=='AREA': l.data.size=size
    d=Vector((0,0,0.15))-Vector(loc); l.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
light((-1.2,-2,1.5),250); light((1.5,-1.5,0.3),80)
target=Vector((0,-0.1,0.22))
def shot(name, cam_loc, f=45):
    bpy.ops.object.camera_add(location=cam_loc); c=bpy.context.object; c.data.lens=f
    c.rotation_euler=(target-Vector(cam_loc)).to_track_quat('-Z','Y').to_euler()
    sc.camera=c; sc.render.filepath=outdir+'/'+name; bpy.ops.render.render(write_still=True)
shot('front.jpg',(0,-1.5,0.15),50)
shot('three-quarter.jpg',(0.85,-1.0,0.55),50)
