"""Подставка для книги (Wood Stand Book Reader, Francesco Coldesina, CC BY 4.0) -> GLB для зала.

    Blender -b --factory-startup --python tools/models/stand_build.py -- вход.glb папка_вывода [--work папка_для_временных_файлов]

Что делает (всё, кроме чтения-записи картинок и numpy, — обычный Python; Blender здесь ради них):
  1. Режет единую сетку по частям: base (основание), rack (зубчатая планка), frame (рамка с полочкой и перекладиной),
     strut (распорка). Куски сетки уже разрезаны по швам оригинала (535 отдельных кусков), поэтому режется
     только по существующим швам, без правки руками. Куски шарниров отдаются тому, кто на них вращается.
  2. Ставит точки вращения: frame — на оси нижних шарниров рамки, strut — на оси шарнира распорки;
     strut вложен в frame, поэтому при наклоне рамки распорка едет вместе с ней.
  3. Две версии дерева (chocolate, rosewood) — только уровни и цвет текстуры оригинала (зерно остаётся),
     шероховатость сглажена, латунь шарниров — по маске металла из карты шероховатости.
  4. Пишет bookstand-chocolate.glb и bookstand-rosewood.glb (метры, Y вверх, цвет JPEG, нормали и шероховатость PNG)
     и stand_kin.json (числа для notes.md).
Углы ступеней считает stand_kin.py (тот же каталог) — здесь вызывается как модуль.
"""
import sys, os, json, struct, math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stand_kin

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
work = args[args.index('--work') + 1] if '--work' in args else '/tmp/stand-work'
os.makedirs(out, exist_ok=True)
os.makedirs(work, exist_ok=True)

MM = 0.001
NORMAL_SCALE = 0.6                     # рельеф оригинала («потрёпанность») ослаблен в материале; в three.js — material.normalScale
ROOT_X, ROOT_Y = 165.0, 77.17          # центр основания на столе, мм (исходные оси: Z вверх)
A_YZ = stand_kin.A                     # ось шарниров рамки (y, z)
P_YZ = stand_kin.P0                    # ось шарнира распорки (y, z)


# ---------------------------------------------------------------- чтение GLB
raw = open(src, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
J = json.loads(raw[20:20 + jl])
BIN = raw[20 + jl + 8:]
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def acc(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    return np.frombuffer(BIN, CT[a['componentType']], n, off).reshape(a['count'], NC[a['type']]).copy()


def img_bytes(i):
    bv = J['bufferViews'][J['images'][i]['bufferView']]
    return BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]


at = J['meshes'][0]['primitives'][0]['attributes']
POS, NRM, TAN, UV = acc(at['POSITION']), acc(at['NORMAL']), acc(at['TANGENT']), acc(at['TEXCOORD_0'])
IDX = acc(J['meshes'][0]['primitives'][0]['indices']).reshape(-1, 3)
NV = len(POS)
print('vertices', NV, 'triangles', len(IDX))


# ---------------------------------------------------------------- куски
def find(p, i):
    while p[i] != i:
        p[i] = p[p[i]]
        i = p[i]
    return i


def components(weld_dist=0.0):
    """Связные куски по треугольникам; weld_dist > 0 — ещё и вершины ближе этого расстояния считаются одной."""
    par = list(range(NV))
    if weld_dist > 0:
        kd = KDTree(NV)
        for i, p in enumerate(POS):
            kd.insert(Vector(p), i)
        kd.balance()
        for i, p in enumerate(POS):
            for _, j, _ in kd.find_range(Vector(p), weld_dist):
                if j != i:
                    par[find(par, i)] = find(par, j)
    for t in IDX:
        par[find(par, t[1])] = find(par, t[0])
        par[find(par, t[2])] = find(par, t[0])
    return np.array([find(par, i) for i in range(NV)])


part = components()                                   # 535 кусков по индексам
weld = components(0.01)   # склейка по расстоянию — 7 тел
print('parts', len(set(part)), 'welded bodies', len(set(weld)))


def bbox(ids):
    p = POS[ids]
    return p.min(0), p.max(0)


# тела после склейки узнаём по габаритам (не по номеру)
body = {}
sizes = {}
for w in set(weld):
    ids = np.where(weld == w)[0]
    lo, hi = bbox(ids)
    sizes[w] = len(ids)
    if hi[0] - lo[0] > 320:
        body[w] = 'big'
    elif hi[0] - lo[0] > 200 and lo[1] < -90:
        body[w] = 'ledge'
    elif hi[0] - lo[0] > 200:
        body[w] = 'crossbar'
    elif hi[1] > 30 and lo[2] < 7:
        body[w] = 'strut'
    elif abs(lo[0] - 148.12) < .1 and hi[1] > -1:
        body[w] = 'strut_leaf'
    elif abs(lo[0] - 148.12) < .1 and lo[2] < 113:
        body[w] = 'frame_leaf'
    elif abs(lo[0] - 148.12) < .1:
        body[w] = 'pin'
    else:
        raise SystemExit('unknown body %s %s %s' % (w, lo, hi))
print('bodies', sorted(body.values()))

# рамка: U — вдоль рамки от нижней кромки, N — от задней грани к книге (мм, от нижнего заднего угла H)
H_Y, H_Z = -68.79, 12.0
TH0 = 60.0
cu, su = math.cos(math.radians(TH0)), math.sin(math.radians(TH0))


def un(y, z):
    return (cu * (y - H_Y) + su * (z - H_Z), -su * (y - H_Y) + cu * (z - H_Z))


def part_info(ids):
    p = POS[ids]
    lo, hi = p.min(0), p.max(0)
    u, n = zip(*[un(y, z) for y, z in p[:, 1:]])
    u, n = np.array(u), np.array(n)
    tris = np.where(np.isin(IDX[:, 0], ids))[0]
    nn = NRM[ids].mean(0)
    return dict(lo=lo, hi=hi, c=p.mean(0), u=(u.min(), u.max()), n=(n.min(), n.max()),
                uc=u.mean(), nc=n.mean(), N=nn / (np.linalg.norm(nn) + 1e-9), tris=tris)


def hinge_group(inf, x0):
    """Часть шарнира у основания рамки -> 'base' или 'frame'."""
    lo, hi = inf['lo'], inf['hi']
    dx = hi[0] - lo[0]
    if dx > 20:                                        # сплошные пластины и ось на всю ширину шарнира
        return 'frame' if inf['u'][1] > 10 else 'base'
    if inf['u'][1] > 8:                                # концевые щёчки пластины рамки
        return 'frame'
    if inf['uc'] > 4.0:                                # винты на пластине рамки
        return 'frame'
    if inf['nc'] < -1.0:                               # винты на пластине основания
        return 'base'
    xc = inf['c'][0]
    if dx < 0.01:                                      # торцевой диск: его слот — по стороне, куда смотрит нормаль
        xc -= 0.1 * np.sign(inf['N'][0])
    slot = int((xc - x0) // 6.75)                      # 5 колен по 6,75 мм: 0,2,4 - рамка, 1,3 - основание
    return 'frame' if slot % 2 == 0 else 'base'


group = {}
for p in sorted(set(part)):
    ids = np.where(part == p)[0]
    w = weld[ids[0]]
    kind = body[w]
    if kind != 'big':
        group[p] = {'ledge': 'frame', 'crossbar': 'frame', 'frame_leaf': 'frame',
                    'strut': 'strut', 'strut_leaf': 'strut', 'pin': 'strut'}[kind]
        continue
    inf = part_info(ids)
    lo, hi = inf['lo'], inf['hi']
    for x0 in (4.25, 292.0):
        if lo[0] >= x0 - .05 and hi[0] <= x0 + 33.8 and hi[1] < -57.5 and hi[2] < 26:
            group[p] = hinge_group(inf, x0)
            break
    else:
        if hi[2] > 12.05:
            group[p] = 'frame'
        elif lo[0] >= 145.9 and hi[0] <= 184.1 and lo[1] >= -30.9 and hi[1] <= 185.3:
            group[p] = 'rack'
        else:
            group[p] = 'base'

G = {'base': [], 'rack': [], 'frame': [], 'strut': []}
vgroup = np.array([group[p] for p in part])
for ti, t in enumerate(IDX):
    g = vgroup[t[0]]
    assert vgroup[t[1]] == g and vgroup[t[2]] == g
    G[g].append(ti)
for g in G:
    print('group', g, 'triangles', len(G[g]))
assert sum(len(v) for v in G.values()) == len(IDX)

# ---------------------------------------------------------------- геометрия по группам
P3 = lambda y, z, x=ROOT_X: np.array([x, y, z])          # точка в исходных осях (мм)
PIVOT = {'base': np.array([ROOT_X, ROOT_Y, 0.0]), 'rack': np.array([ROOT_X, ROOT_Y, 0.0]),
         'frame': P3(*A_YZ), 'strut': P3(*P_YZ)}


def to_gltf(v):
    """исходные оси (x, y, z вверх) -> glTF (x, z, -y)."""
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def build_mesh(g):
    tri = IDX[G[g]]
    used = np.unique(tri)
    remap = np.full(NV, -1)
    remap[used] = np.arange(len(used))
    pos = to_gltf(POS[used] - PIVOT[g]) * MM
    nrm = to_gltf(NRM[used])
    tg = TAN[used]
    tan = np.concatenate([to_gltf(tg[:, :3]), tg[:, 3:4]], 1)
    return dict(pos=pos.astype(np.float32), nrm=nrm.astype(np.float32), tan=tan.astype(np.float32),
                uv=UV[used].astype(np.float32), idx=remap[tri].astype(np.uint16).reshape(-1))


MESH = {g: build_mesh(g) for g in G}

# ---------------------------------------------------------------- кинематика ступеней
K = stand_kin.notches()
print(json.dumps(K, indent=1))


# ---------------------------------------------------------------- проверка: рамка не уходит в основание ни на одной ступени
fv = np.unique(IDX[G['frame']])
FP = POS[fv]
clear = []
for r in K['rows']:
    a = math.radians(r['frame_deg'] - TH0)
    y0, z0 = FP[:, 1] - A_YZ[0], FP[:, 2] - A_YZ[1]
    y1 = A_YZ[0] + y0 * math.cos(a) - z0 * math.sin(a)
    z1 = A_YZ[1] + y0 * math.sin(a) + z0 * math.cos(a)
    over = (y1 > H_Y + .3)                                  # над самим основанием (не перед его передней гранью)
    zmin = z1[over].min()
    clear.append(round(float(zmin - 12.0), 2))
    # прочие вершины основания: ниже верха основания у вершин рамки быть не должно
print('frame lowest point over the base minus base top (mm), per notch:', clear)
K['frame_clearance_mm'] = clear

# ---------------------------------------------------------------- текстуры
def load_img(data, name, ext):
    fp = os.path.join(work, name + ext)
    open(fp, 'wb').write(data)
    im = bpy.data.images.load(fp)
    im.colorspace_settings.name = 'Non-Color'          # числа как есть, без пересчёта в линейные
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[:, :, :3]
    bpy.data.images.remove(im)
    return a


def save_img(a, name, fmt, quality=90):
    h, w = a.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(a, 0, 1)
    im.pixels.foreach_set(rgba.ravel())
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.quality = quality
    sc.view_settings.view_transform = 'Standard'
    ext = '.jpg' if fmt == 'JPEG' else '.png'
    fp = os.path.join(work, name + ext)
    im.filepath_raw = fp
    im.file_format = fmt
    im.save()
    bpy.data.images.remove(im)
    return open(fp, 'rb').read()


ALB = load_img(img_bytes(J['textures'][0]['source']), 'alb_src', '.jpg')
MR = load_img(img_bytes(J['textures'][1]['source']), 'mr_src', '.png')
NRMTEX = img_bytes(J['textures'][2]['source'])          # нормали — как есть, байты оригинала

lin = lambda s: np.power(np.clip(s, 0, 1), 2.2)
srgb = lambda l: np.power(np.clip(l, 0, 1), 1 / 2.2)
metal = MR[:, :, 2] > .95                                # маска металла (шарниры) в той же развёртке: ровный блок 255 в канале B;
#                                                          у дерева там 0,25-0,6 (в оригинале «металличность» дерева выше нуля — её обнуляем)
wood = ~metal
Lw = lin(ALB) @ np.array([.2126, .7152, .0722], dtype=np.float32)
Lm = Lw[wood].mean()

VARIANTS = {
    # средний цвет дерева после обработки, sRGB 0..255; сравнить: стол #392a22, постаменты #3d3028
    'chocolate': dict(mean=(66, 46, 35), gamma=.55, mix=.25),
    'rosewood': dict(mean=(78, 33, 25), gamma=.55, mix=.30),
}
BRASS = np.array([208, 160, 82], dtype=np.float32) / 255      # цвет латуни (sRGB), как у ламп зала


def recolor(v):
    lo_, hi_ = .30, 2.6
    r = np.clip(Lw / Lm, lo_, hi_) ** v['gamma']             # сжатие размаха яркости: сучки, подпалины, светлые доски
    Tl = lin(np.array(v['mean'], dtype=np.float32) / 255)
    ch = lin(ALB) / np.maximum(Lw[:, :, None], 1e-4)          # цветность оригинала, на 1 по яркости
    ch = ch / ch[wood].mean((0,))                              # усреднённая цветность — единица
    ch = 1 + v['mix'] * (np.clip(ch, .4, 2.5) - 1)
    out = Tl[None, None, :] * r[:, :, None] * ch
    # латунь — по маске, яркость узора оригинала сохранена мягко
    br = lin(BRASS)[None, None, :] * (.55 + .45 * np.clip(Lw / max(Lw[metal].mean(), 1e-4), 0, 1.6)[:, :, None]) * 1.0
    out = np.where(metal[:, :, None], br, out)
    return srgb(out)


def soften_mr(mr):
    """Шероховатость дерева: сжать размах (лак не должен блестеть пластиком), латуни — полуматовая 0,35."""
    m = mr.copy()
    g = m[:, :, 1]
    gw = g[wood]
    mean = gw.mean()
    m[:, :, 1] = np.where(metal, .35, np.clip(.70 + .45 * (g - mean) + (mean - .70) * 0, .45, 1.0))
    m[:, :, 2] = np.where(metal, 1.0, 0.0)
    m[:, :, 0] = 1.0
    return m


MRS = soften_mr(MR)
MRS = MRS.reshape(512, 2, 512, 2, 3).mean((1, 3))      # шероховатость — плавная карта, хватает 512 (латунная метка остаётся)
print('roughness before: mean %.2f std %.2f -> after: mean %.2f std %.2f' % (
    MR[:, :, 1][wood].mean(), MR[:, :, 1][wood].std(), MRS[:, :, 1][MRS[:, :, 2] < .01].mean(), MRS[:, :, 1][MRS[:, :, 2] < .01].std()))
MRPNG = save_img(MRS, 'mr', 'PNG')


# ---------------------------------------------------------------- запись GLB
def write_glb(path, albedo_jpeg, variant):
    chunks = []
    views = []
    accs = []

    def add_view(data, target=None):
        while sum(len(c) for c in chunks) % 4:
            chunks.append(b'\0')
        off = sum(len(c) for c in chunks)
        chunks.append(bytes(data))
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def add_acc(arr, ctype, typ, target, minmax=False):
        vi = add_view(arr.tobytes(), target)
        a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0] if arr.ndim > 1 else arr.size), 'type': typ}
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    meshes, nodes = [], []
    node_of = {}
    order = ['base', 'rack', 'frame', 'strut']
    for g in order:
        m = MESH[g]
        prim = {'attributes': {
            'POSITION': add_acc(m['pos'], 5126, 'VEC3', 34962, True),
            'NORMAL': add_acc(m['nrm'], 5126, 'VEC3', 34962),
            'TEXCOORD_0': add_acc(m['uv'], 5126, 'VEC2', 34962)},
            'indices': add_acc(m['idx'], 5123, 'SCALAR', 34963), 'material': 0, 'mode': 4}
        meshes.append({'name': 'bookstand_' + g, 'primitives': [prim]})
    imgs = [add_view(albedo_jpeg), add_view(MRPNG), add_view(NRMTEX)]

    def vec(g):
        return [float(x) for x in to_gltf(PIVOT[g] - PIVOT['base']) * MM] if g != 'base' else [0.0, 0.0, 0.0]

    f_off = to_gltf(PIVOT['frame'] - PIVOT['base']) * MM
    s_off = to_gltf(PIVOT['strut'] - PIVOT['frame']) * MM
    nodes = [
        {'name': 'bookstand', 'children': [1, 2, 3], 'extras': {'bookstand': K['extras']}},
        {'name': 'base', 'mesh': 0},
        {'name': 'rack', 'mesh': 1},
        {'name': 'frame', 'mesh': 2, 'translation': [float(x) for x in f_off], 'children': [4]},
        {'name': 'strut', 'mesh': 3, 'translation': [float(x) for x in s_off]},
    ]
    gl = {
        'asset': {'version': '2.0', 'generator': 'reading-room/tools/models/stand_build.py',
                  'copyright': 'Wood Stand Book Reader by Francesco Coldesina (CC BY 4.0), recoloured',
                  'extras': {'author': 'Francesco Coldesina (https://sketchfab.com/topfrank2013)',
                             'license': 'CC-BY-4.0', 'source': J['asset']['extras']['source'], 'variant': variant}},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes,
        'materials': [{'name': 'stand_wood_' + variant, 'doubleSided': True,
                       'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1},
                                                'metallicFactor': 1.0, 'roughnessFactor': 1.0},
                       'normalTexture': {'index': 2, 'scale': NORMAL_SCALE}}],
        'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}, {'sampler': 0, 'source': 2}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'images': [{'bufferView': imgs[0], 'mimeType': 'image/jpeg', 'name': 'albedo'},
                   {'bufferView': imgs[1], 'mimeType': 'image/png', 'name': 'metal_rough'},
                   {'bufferView': imgs[2], 'mimeType': 'image/png', 'name': 'normal'}],
        'bufferViews': views, 'accessors': accs,
    }
    binb = b''.join(chunks)
    binb += b'\0' * (-len(binb) % 4)
    gl['buffers'] = [{'byteLength': len(binb)}]
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + binb
    open(path, 'wb').write(glb)
    return len(glb)


info = {'triangles': {g: len(G[g]) for g in G}, 'kin': K, 'files': {}}
for name, v in VARIANTS.items():
    rgb = recolor(v)
    jpg = save_img(rgb, 'albedo_' + name, 'JPEG', 90)
    wood_mean = (rgb[wood].mean((0)) * 255).round().astype(int).tolist()
    p = os.path.join(out, 'bookstand-%s.glb' % name)
    size = write_glb(p, jpg, name)
    info['files'][name] = {'glb_bytes': size, 'albedo_jpeg': len(jpg), 'normal_png': len(NRMTEX), 'mr_png': len(MRPNG),
                           'mean_srgb_after': wood_mean}
    print(name, 'glb', size, 'bytes; albedo', len(jpg), 'mean srgb', wood_mean)
    # сам рекол для контроля глазами
    open(os.path.join(work, 'albedo_%s.jpg' % name), 'wb').write(jpg)
json.dump(info, open(os.path.join(out, 'stand_info.json'), 'w'), indent=1)
