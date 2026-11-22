# Общие приёмы подготовки снимков переплётов (Pillow). Только обрезка, поворот, перспектива, маска фона и уровни — без ретуши.
# Запуск: python3 -I tools/bindings/<скрипт>.py (Pillow берётся из PILLOW_PATH, если он не установлен в систему).
import os, sys
for p in [os.environ.get('PILLOW_PATH')]:
    if p: sys.path.insert(0, p)
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'originals', 'bindings')
OUT = os.path.join(ROOT, 'assets', 'bindings')

def fg_mask(im, sat=14, val=80):
    """Маска «не фон»: фон музейных снимков — ровный тёмно-серый (около 47), переплёт либо ярче, либо цветной."""
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    spread = ImageChops.subtract(mx, mn).point(lambda v: 255 if v > sat else 0)
    bright = mx.point(lambda v: 255 if v > val else 0)
    return ImageChops.lighter(spread, bright)

def span(profile, frac):
    """Первый и последний индекс, где доля «не фон» больше frac."""
    idx = [i for i, v in enumerate(profile) if v > frac * 255]
    return (idx[0], idx[-1] + 1) if idx else (0, len(profile))

def board_box(im, fx=.5, fy=.5, scale=8):
    """Рамка книги на музейном снимке: проекции маски по строкам и столбцам, порог — половина длины (лента-закладка и выступы не мешают)."""
    w, h = im.size
    small = im.resize((w // scale, h // scale), Image.BILINEAR)
    m = fg_mask(small).filter(ImageFilter.MedianFilter(5))
    cols = list(m.resize((m.width, 1), Image.BOX).getdata())
    rows = list(m.resize((1, m.height), Image.BOX).getdata())
    x0, x1 = span(cols, fx); y0, y1 = span(rows, fy)
    return (x0 * scale, y0 * scale, x1 * scale, y1 * scale)

def grid(im, step, path, scale=.25):
    d = im.copy(); dr = ImageDraw.Draw(d)
    for x in range(0, d.width, step): dr.line([(x, 0), (x, d.height)], fill=(255, 255, 0), width=2); dr.text((x + 4, 4), str(x), fill=(255, 255, 0))
    for y in range(0, d.height, step): dr.line([(0, y), (d.width, y)], fill=(0, 255, 255), width=2); dr.text((4, y + 4), str(y), fill=(0, 255, 255))
    d.thumbnail((int(d.width * scale) or 1, int(d.height * scale) or 1)); d.save(path, quality=88)
