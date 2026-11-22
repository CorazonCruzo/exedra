# Blender без окна: контактный лист из картинок (JPEG) — ... --python sheet.py -- выход.jpg колонки ячейка_px файл1 файл2 ...
import bpy, sys
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
out, cols, cell = a[0], int(a[1]), int(a[2]); files = a[3:]
rows = (len(files) + cols - 1) // cols
sheet = np.ones((rows * cell, cols * cell, 4), dtype=np.float32) * 0.15; sheet[:, :, 3] = 1
for k, f in enumerate(files):
    im = bpy.data.images.load(f); w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    s = cell / max(w, h); nw, nh = int(w * s), int(h * s)
    ys = (np.arange(nh) / s).astype(int).clip(0, h - 1); xs = (np.arange(nw) / s).astype(int).clip(0, w - 1)
    t = px[ys][:, xs]; r, c = divmod(k, cols); rr = rows - 1 - r
    sheet[rr * cell:rr * cell + nh, c * cell:c * cell + nw] = t
im = bpy.data.images.new('sheet', cols * cell, rows * cell); im.pixels.foreach_set(sheet.reshape(-1))
im.filepath_raw = out; im.file_format = 'JPEG'; bpy.context.scene.render.image_settings.quality = 85; im.save()
