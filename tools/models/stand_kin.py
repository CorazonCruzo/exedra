"""Подставка для книги: кинематика ступеней (чистый Python, без Blender).

    python3 -I tools/models/stand_kin.py

Исходные оси модели: X — ширина, Y — вглубь (от книги к задней кромке стола), Z — вверх; мм. Работаем в плоскости (y, z).
A  — ось нижних шарниров рамки (центр колена шарнира);
P0 — ось шарнира распорки (штифт на перекладине рамки) в позе из файла (рамка 60 градусов, ступень 1);
F0 — остриё стопы распорки в той же позе (в углу первой выемки зубчатой планки).
Распорка — твёрдый стержень P-F, рамка поворачивается вокруг A; ступень k определяется тем, куда ставится остриё:
в угол выемки с вертикальной стенкой, шаг выемок 25 мм. Решаем |P(theta) - F_k| = |P0 - F0| (корень ближе к 60 градусам).
"""
import math, json

A = (-69.77, 13.14)
P0 = (-4.59, 122.58)
F0 = (31.66, 6.0)
TH0 = 60.0
PITCH = 25.0
N_NOTCH = 6
# профиль зубчатой планки (y, z), мм: ступенька — пологий спуск 18 мм, дно 4 мм на уровне 6, стенка вверх, площадка 3 мм
RACK = [(-30.79, 12.0), (9.66, 12.0)]
for _k in range(N_NOTCH):
    _y = 27.66 + PITCH * _k
    RACK += [(_y, 6.0), (_y + 4, 6.0), (_y + 4, 12.0), (_y + 7, 12.0)]
RACK.append((185.12, 12.0))
STRUT = [(-5.32, 121.98), (6.35, 124.64), (30.52, 18.66), (31.66, 6.0), (26.18, 10.72), (14.34, 35.64)]


def rot(p, c, a):
    a = math.radians(a)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


def area(p):
    return .5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def clip(subject, clipper):
    out = subject
    for i in range(len(clipper)):
        a, b = clipper[i], clipper[(i + 1) % len(clipper)]
        inp, out = out, []
        if not inp:
            break
        inside = lambda p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9
        def inter(p, q):
            d = (p[0] - q[0]) * (a[1] - b[1]) - (p[1] - q[1]) * (a[0] - b[0])
            t = ((p[0] - a[0]) * (a[1] - b[1]) - (p[1] - a[1]) * (a[0] - b[0])) / d
            return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            if inside(q):
                if not inside(p):
                    out.append(inter(p, q))
                out.append(q)
            elif inside(p):
                out.append(inter(p, q))
    return out


def ccw(p):
    return p if area(p) > 0 else p[::-1]


def seg_dist(p, a, b):
    t = max(0, min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)))
    return math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]))


def under_rack(p):
    for (y1, z1), (y2, z2) in zip(RACK, RACK[1:]):
        if y2 > y1 and y1 <= p[0] <= y2:
            return p[1] < z1 + (z2 - z1) * (p[0] - y1) / (y2 - y1)
    return False


def notches():
    L = math.dist(P0, F0)
    rows = []
    rack_cells = [[(y1, 0), (y2, 0), (y2, z2), (y1, z1)] for (y1, z1), (y2, z2) in zip(RACK, RACK[1:]) if y2 > y1]
    for k in range(N_NOTCH):
        F = (F0[0] + PITCH * k, F0[1])
        f = lambda th: math.dist(rot(P0, A, th - TH0), F) - L
        prev, th = None, None
        for i in range(6000):
            t = 80 - i * .01
            v = f(t)
            if prev is not None and prev * v <= 0:
                lo, hi = t, t + .01
                for _ in range(60):
                    mid = (lo + hi) / 2
                    lo, hi = (lo, mid) if f(lo) * f(mid) <= 0 else (mid, hi)
                th = (lo + hi) / 2
                break
            prev = v
        P = rot(P0, A, th - TH0)
        d = math.atan2(F[1] - P[1], F[0] - P[0]) - math.atan2(F0[1] - P0[1], F0[0] - P0[0])   # поворот распорки в мире, рад, против часовой
        tr = lambda q: (P[0] + (q[0] - P0[0]) * math.cos(d) - (q[1] - P0[1]) * math.sin(d), P[1] + (q[0] - P0[0]) * math.sin(d) + (q[1] - P0[1]) * math.cos(d))
        st = [tr(q) for q in STRUT]
        cs = ccw(st)
        tris = [[cs[0], cs[i], cs[i + 1]] for i in range(1, len(cs) - 1)]
        ov = sum(abs(area(c)) for t in tris for r in rack_cells for c in [clip(t, ccw(r))] if len(c) > 2)
        pen = max([min(seg_dist(q, RACK[i], RACK[i + 1]) for i in range(len(RACK) - 1)) for q in st if under_rack(q)] or [0])
        delta = math.radians(th - TH0)            # поворот рамки вокруг +X (в glTF то же, что против часовой в плоскости y-z модели)
        rows.append(dict(notch=k + 1, wall_y=F[0], frame_deg=round(th, 2), frame_rot_x=round(delta, 5),
                         strut_world_rot_x=round(d, 5), strut_local_rot_x=round(d - delta, 5),
                         strut_from_horizontal_deg=round(math.degrees(math.atan2(P[1] - F[1], F[0] - P[0])), 1),
                         overlap_mm2=round(ov, 2), penetration_mm=round(pen, 2), strut_min_z=round(min(q[1] for q in st), 2)))
    return {'rows': rows, 'strut_length_mm': round(L, 2), 'extras': {
        'how': 'frame.rotation.x = frameRotX; strut.rotation.x = strutLocalRotX (strut is a child of frame); notch 1 is the pose stored in the file',
        'notches': [dict(notch=r['notch'], frameDeg=r['frame_deg'], frameRotX=r['frame_rot_x'],
                                                          strutLocalRotX=r['strut_local_rot_x']) for r in rows]}}


if __name__ == '__main__':
    r = notches()
    print('длина распорки (штифт-остриё), мм', r['strut_length_mm'])
    for x in r['rows']:
        print(x)
