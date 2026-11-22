# python3 -I glbinfo.py файл.glb ... — треугольники, материалы и размеры картинок внутри glb (без Blender)
import sys, json, struct
for f in sys.argv[1:]:
    d = open(f, 'rb').read(); cl, = struct.unpack('<I', d[12:16]); j = json.loads(d[20:20 + cl])
    tris = 0
    for m in j['meshes']:
        for p in m['primitives']:
            tris += (j['accessors'][p['indices']]['count'] // 3) if 'indices' in p else j['accessors'][p['attributes']['POSITION']]['count'] // 3
    imgs = [(i.get('name'), i['mimeType'].split('/')[1], j['bufferViews'][i['bufferView']]['byteLength'] // 1024) for i in j.get('images', [])]
    print(f.split('/')[-1], len(d) // 1024, 'KB tris', tris, 'mats', len(j['materials']), 'images(KB)', imgs)
