# Готовит текстуры переплётов из снимков в originals/bindings: обрезка по рамке, выпрямления нет (снимки сняты строго сверху), зеркало там, где корешок
# на снимке с другой стороны, масштаб, JPEG. Никакой ретуши: ни заплаток, ни правки цвета и уровней.
#   python3 -I tools/bindings/prepare.py [id ...]       (Pillow — через PILLOW_PATH, если не установлен)
# Рамки — в точках оригинала: (x0, y0, x1, y1). Лицо крышки — без полосы корешка; корешок — полоса вдоль всей высоты; форзац — чистый кусок мрамора с поправкой на
# отношение сторон крышки (0,667); rim — маленький чистый кусок кожи для торцов картона.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c
from PIL import Image

COVER_H, SPINE_H, ENDPAPER = 1536, 2048, (1024, 1536)

B = {
  'mm': dict(src='met-681556-grammont-1876-marius-michel-red', n='i19511474',
    front=(500, 335, 2445, 3645), back=(296, 280, 2225, 3536), spine=(690, 276, 1170, 3660),
    endpaper=('ef2', (2160, 500, 3520, 2540)), rim=(1300, 1700)),
  'noel': dict(src='met-681259-office-noel-1768-red-marbled', n='i19550054',
    front=(400, 464, 2340, 3656), back=(360, 416, 2335, 3704), spine=(812, 362, 1258, 3618),
    endpaper=('ef', (2080, 200, 3520, 2360)), rim=(900, 2850)),
  'tel': dict(src='met-681128-telemaque-1790-red', n='i19546889',
    front=(330, 312, 2500, 3705), back=(220, 352, 2440, 3740), backflip=True, spine=(604, 316, 1196, 3764),
    endpaper=('ef', (2100, 230, 3520, 2360)), rim=(1300, 1700)),
  'mol': dict(src='met-681563-moliere-1773-green', n='i19511747',
    front=(400, 312, 2512, 3664), back=(344, 296, 2470, 3656), spine=(620, 252, 1130, 3756),
    endpaper=('eb', (328, 280, 1800, 2488)), rim=(800, 1500)),
  'rag': dict(src='met-681546-ragguagli-1669-green', n='i19511814',
    front=(460, 340, 2120, 3660), back=(400, 280, 2112, 3700), spine=(764, 262, 1308, 3716),
    endpaper=('eb', (380, 500, 1848, 2702)), rim=(1000, 2850)),
}

def save(im, path, q=90):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, quality=q, optimize=True, progressive=True)
    return os.path.getsize(path)

def run(key):
    b = B[key]; d = os.path.join(c.SRC, b['src']); out = os.path.join(c.OUT, key)
    op = lambda s: Image.open(os.path.join(d, f"{b['n']}-{s}.jpg")).convert('RGB')
    info = {}
    for side in ('front', 'back'):
        im = op('cf' if side == 'front' else 'cb').crop(b[side])
        if side == 'back' and b.get('backflip'): im = im.transpose(Image.FLIP_LEFT_RIGHT)
        w = round(im.width * COVER_H / im.height)
        info[side] = dict(aspect=round(im.width / im.height, 4), size=save(im.resize((w, COVER_H), Image.LANCZOS), f'{out}/{side}.jpg', 90), px=(w, COVER_H))
    sp = op('cs').crop(b['spine']); w = round(sp.width * SPINE_H / sp.height)
    info['spine'] = dict(aspect=round(sp.width / sp.height, 4), size=save(sp.resize((w, SPINE_H), Image.LANCZOS), f'{out}/spine.jpg', 90), px=(w, SPINE_H))
    e, box = b['endpaper']; ep = op(e).crop(box).resize(ENDPAPER, Image.LANCZOS)
    info['endpaper'] = dict(aspect=round((box[2] - box[0]) / (box[3] - box[1]), 4), size=save(ep, f'{out}/endpaper.jpg', 90), px=ENDPAPER)
    # Торцы картона — гладкий тон кожи: кусок поля (512 точек) усредняется до 32 × 32, рельефа зерна на торце не нужно (он вытягивался бы полосами).
    rx, ry = b['rim']; rim = op('cf').crop((rx, ry, rx + 512, ry + 512)).resize((32, 32), Image.BOX)
    info['rim'] = dict(size=save(rim, f'{out}/rim.jpg', 90))
    json.dump(info, open(f'{out}/info.json', 'w'), indent=1)
    print(key, json.dumps(info))

if __name__ == '__main__':
    for k in (sys.argv[1:] or B): run(k)
