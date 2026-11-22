# Материал скана — непрозрачный и без собственного свечения (в исходнике стоит смешивание и свечение на полную). Геометрия и картинки не трогаются.
import sys, json, struct
src, dst = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()
clen, = struct.unpack('<I', d[12:16]); j = json.loads(d[20:20 + clen]); rest = d[20 + clen:]
for m in j['materials']:
    m.pop('alphaMode', None); m.pop('emissiveFactor', None); m.pop('emissiveTexture', None)
b = json.dumps(j, separators=(',', ':')).encode(); b += b' ' * (-len(b) % 4)
out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(b) + len(rest)) + struct.pack('<I4s', len(b), b'JSON') + b + rest
open(dst, 'wb').write(out); print('ok', len(out))
