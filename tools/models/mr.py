# Спекулярно-глянцевый материал скана -> обычный металл/шероховатость: цвет — та же текстура, без металла, матовый. Геометрия и картинки не трогаются.
import sys, json, struct
src, dst = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()
clen, = struct.unpack('<I', d[12:16]); j = json.loads(d[20:20 + clen]); rest = d[20 + clen:]
for m in j['materials']:
    sg = m.get('extensions', {}).pop('KHR_materials_pbrSpecularGlossiness', None)
    if not m.get('extensions'): m.pop('extensions', None)
    if sg:
        pbr = {'metallicFactor': 0.0, 'roughnessFactor': 1.0, 'baseColorFactor': sg.get('diffuseFactor', [1, 1, 1, 1])}
        if 'diffuseTexture' in sg: pbr['baseColorTexture'] = sg['diffuseTexture']
        m['pbrMetallicRoughness'] = pbr
for k in ('extensionsUsed', 'extensionsRequired'):
    if k in j:
        j[k] = [e for e in j[k] if e != 'KHR_materials_pbrSpecularGlossiness']
        if not j[k]: del j[k]
b = json.dumps(j, separators=(',', ':')).encode(); b += b' ' * (-len(b) % 4)
out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(b) + len(rest)) + struct.pack('<I4s', len(b), b'JSON') + b + rest
open(dst, 'wb').write(out); print('ok', len(out))
