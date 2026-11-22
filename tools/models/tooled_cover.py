"""Крышка папки из музейных снимков: вырезка, рельеф тиснения, кожа изнанки.

    Blender -b --factory-startup --python tools/models/tooled_cover.py -- крышка.jpg разворот.jpg assets/textures [--aspect 0.7508]

Снимки — папка Георга Хульбе 1902 года (Метрополитен-музей, 2000.421.1, CC0): закрытая, лицом вверх, и раскрытая.
Со снимками делается только вырезка: вещь отделяется от светлого фона, у корешка срезается полоска, чтобы
крышка встала в пропорцию нашей (--aspect — ширина к высоте); фон в скруглённых углах закрывается кожей по соседству.
Рельеф тиснения берётся из яркости снимка (выпуклое на нём светлее вдавленного фона) — карта наклонов для света.
Изнанка: левая половина разворота (с девизом) — на крышку; чистый кусок кожи под девизом — на заднюю крышку,
под листы (кладётся зеркальными повторами).
Blender здесь только ради numpy и чтения-записи картинок.
"""
import sys
import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
cover_path, inside_path, out = args[:3]
aspect = float(args[args.index('--aspect') + 1]) if '--aspect' in args else .7508


def load(path):
    im = bpy.data.images.load(path)
    # Числа снимка как есть (экранные), без перевода в световые.
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return np.flipud(a.reshape(h, w, 4)[:, :, :3]).copy()


def save(a, path, quality=90):
    h, w = a.shape[:2]
    im = bpy.data.images.new('out', w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(a, 0, 1)
    im.pixels.foreach_set(np.flipud(rgba).ravel())
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = quality
    scene.view_settings.view_transform = 'Standard'
    im.filepath_raw = path
    im.file_format = 'JPEG'
    im.save()
    print('saved', path, w, h)


def lum(a):
    return a @ np.array([.2126, .7152, .0722], dtype=np.float32)


def blur(a, r):
    """Размытие «коробкой» r раз подряд по три точки — близко к гауссову."""
    for _ in range(r):
        a = (np.roll(a, 1, 0) + a + np.roll(a, -1, 0)) / 3
        a = (np.roll(a, 1, 1) + a + np.roll(a, -1, 1)) / 3
    return a


def thing(a):
    """Маска вещи на светлом фоне и её рамка. Фон — светлое, до чего можно дойти от края снимка:
    светлая позолота и бумага внутри вещи фоном не считаются."""
    q = 4
    l = lum(a)
    edge = np.median(np.concatenate([l[0], l[-1], l[:, 0], l[:, -1]]))
    light = blur((l > edge - .1).astype(np.float32), 2)[::q, ::q] > .5
    bg = np.zeros_like(light)
    bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    bg &= light
    while True:
        grown = bg | np.roll(bg, 1, 0) | np.roll(bg, -1, 0) | np.roll(bg, 1, 1) | np.roll(bg, -1, 1)
        grown &= light
        if (grown == bg).all():
            break
        bg = grown
    m = ~np.repeat(np.repeat(bg, q, 0), q, 1)[:a.shape[0], :a.shape[1]]
    if m.shape != a.shape[:2]:
        m = np.pad(m, ((0, a.shape[0] - m.shape[0]), (0, a.shape[1] - m.shape[1])), constant_values=False)
    cols = np.where(m.mean(0) > .3)[0]
    rows = np.where(m.mean(1) > .3)[0]
    # Рамка — на несколько точек внутрь: по самому краю вещи на снимке идёт полутень.
    return m, cols[0] + 6, cols[-1] - 5, rows[0] + 6, rows[-1] - 5


def fill(a, m, steps=260):
    """Вне маски — цвет ближайшей кожи: край расползается наружу по точке за шаг."""
    a, m = a.copy(), m.copy()
    for _ in range(steps):
        if m.all():
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(m.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ms = np.roll(m, (dy, dx), (0, 1))
            acc += np.roll(a, (dy, dx), (0, 1)) * ms[:, :, None]
            cnt += ms
        new = (~m) & (cnt > 0)
        a[new] = acc[new] / cnt[new][:, None]
        m |= new
    return a


# ——— Крышка ———
a = load(cover_path)
m, x0, x1, y0, y1 = thing(a)
# Маску чуть ужать: кайма вещи на снимке — полутень фона.
core = blur(m.astype(np.float32), 8) > .995
a = fill(a, core)
h = y1 - y0
x0c = x1 - round(h * aspect)
print('cover: thing', x0, x1, y0, y1, 'cut at spine', x0c - x0, 'px of', x1 - x0)
c = a[y0:y1, x0c:x1]
save(c, f'{out}/portfolio-cover.jpg', 90)

# Рельеф: яркость — высота. Мелкое зерно снимка сглажено, крупные формы оставлены.
hgt = blur(lum(c), 2) * .75 + blur(lum(c), 9) * .25
k = 4
dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * k
dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * k
dx[:, [0, -1]] = 0
dy[[0, -1], :] = 0
n = np.dstack([-dx, dy, np.ones_like(dx)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
save(n * .5 + .5, f'{out}/portfolio-cover-normal.jpg', 92)

# ——— Изнанка ———
b = load(inside_path)
m, x0, x1, y0, y1 = thing(b)
core = blur(m.astype(np.float32), 8) > .995
b = fill(b, core)
h = y1 - y0
w = round(h * aspect)
print('inside: thing', x0, x1, y0, y1, 'left board', w, 'px')
left = b[y0:y1, x0:x0 + w]
save(left, f'{out}/portfolio-inside.jpg', 88)
# Чистая кожа под девизом.
patch = left[round(h * .68):round(h * .95), round(w * .08):round(w * .78)]
save(patch, f'{out}/portfolio-lining.jpg', 88)
