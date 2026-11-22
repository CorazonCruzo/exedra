# python3 -I post.py вход.glb выход.glb [--rough R] [--base r,g,b] [--mat индекс] [--unlit-alpha]
# Правка описания материала без Blender: шероховатость и цвет-множитель; без прозрачности и свечения по умолчанию не трогает.
import sys, json, struct
a = sys.argv[1:]
src, dst = a[:2]
def opt(k, d=None): return a[a.index(k) + 1] if k in a else d
d = open(src, 'rb').read()
clen, = struct.unpack('<I', d[12:16]); j = json.loads(d[20:20 + clen]); rest = d[20 + clen:]
only = opt('--mat')  # индексы или части имён материалов через запятую
only = None if only is None else only.split(',')
for i, m in enumerate(j.get('materials', [])):
    if only is not None and not any((t.isdigit() and int(t) == i) or (not t.isdigit() and t in m.get('name', '')) for t in only): continue
    p = m.setdefault('pbrMetallicRoughness', {})
    if opt('--rough'): p['roughnessFactor'] = float(opt('--rough'))
    if opt('--metal'): p['metallicFactor'] = float(opt('--metal'))
    if opt('--base'): p['baseColorFactor'] = [float(x) for x in opt('--base').split(',')] + [1.0]
for spec in [x for x in a if x.startswith('--mask=')]:  # --mask=имя_или_индекс:порог — альфа-отсечение вместо смешивания
    i, c = spec[7:].split(':'); m = j['materials'][int(i)] if i.isdigit() else next(m for m in j['materials'] if i in m.get('name', '')); m['alphaMode'] = 'MASK'; m['alphaCutoff'] = float(c)
def strip(o):  # лишние расширения материалов/текстур: «ничего не делающие» повороты и зеркальность — обычный металл-шероховатость достаточно
    if isinstance(o, dict):
        ext = o.get('extensions')
        if ext:
            for k in ('KHR_texture_transform', 'KHR_materials_specular', 'KHR_materials_ior'): ext.pop(k, None)
            if not ext: del o['extensions']
        for v in list(o.values()): strip(v)
    elif isinstance(o, list):
        for v in o: strip(v)
for k in ('materials', 'textures'): strip(j.get(k, []))
for k in ('extensionsUsed', 'extensionsRequired'):
    if k in j:
        j[k] = [e for e in j[k] if e not in ('KHR_texture_transform', 'KHR_materials_specular', 'KHR_materials_ior')]
        if not j[k]: del j[k]
b = json.dumps(j, separators=(',', ':')).encode(); b += b' ' * (-len(b) % 4)
out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(b) + len(rest)) + struct.pack('<I4s', len(b), b'JSON') + b + rest
open(dst, 'wb').write(out); print('POST ok', len(out))
