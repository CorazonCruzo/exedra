// Маркер и карандаш на страницах книги (пользователь 2026-11-25: выделять слова зелёным флуоресцентным маркером и отправлять снимки экрана дальше, прежде всего для английского;
// «управлять этим как в жизни»: вести, выделять, лучше ровно и с выбором угла; ещё самый простой карандаш, натуральный на бумаге, и чтобы со стилусом на планшете).
// Штрихи хранятся векторами в долях страницы (x, y от 0 до 1 по картинке страницы, верх — y = 0) и рисуются на холст страницы; холст идёт в шейдер страницы (book.js, `uInkF`/`uInkB`)
// и умножается на бумагу, как настоящие чернила: повторный проход маркером по тому же месту темнее, а внутри одного штриха — нет (штрих сперва собирается целиком, потом ложится).
// Маркер — скошенный наконечник: прямоугольник длиной w и толщиной w·NIB, повёрнутый на угол a; штрих — след этого прямоугольника. Карандаш — линия с нажимом (толщина и густота),
// графит ложится на бугорки бумаги (зерно). Хранилище — IndexedDB `exedra-ink`, запись на файл книги: { pages: { n: [штрих…] } }.
import * as THREE from 'three';

const H = 2048, NIB = .2, LRU = 8;
export const PEN = {
  hl: { w: [.008, .04], w0: .019, a0: 70 * Math.PI / 180, rgb: '#6cf06a', glow: 1 },   // маркер: толщина в долях высоты страницы, угол наконечника (от горизонтали)
  pc: { w: [.001, .006], w0: .0024, rgb: '#4c4c52' },                                     // карандаш
  er: { r: .012 },                                                                          // ластик: радиус в долях высоты страницы
};

// ——— Хранилище ———
const DB = 'exedra-ink';
let dbp = null;
const db = () => dbp ??= new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('books'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('books', mode), q = fn(t.objectStore('books')); t.oncomplete = () => ok(q?.result); t.onerror = () => no(t.error); }); };
export const removeInk = id => tx('readwrite', s => s.delete(id)).catch(() => {});

// ——— Зерно бумаги для графита: плитка случайных бугорков (одна на всех, всегда одинаковая) ———
let grain = null;
function grainTile() {
  if (grain) return grain;
  const N = 128, c = Object.assign(document.createElement('canvas'), { width: N, height: N }), g = c.getContext('2d'), im = g.createImageData(N, N);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const v = new Float32Array(N * N); for (let i = 0; i < v.length; i++) v[i] = rnd();
  // Чуть сгладить: бугорок бумаги — не одна точка.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const at = (dx, dy) => v[((y + dy + N) % N) * N + (x + dx + N) % N], k = .5 * at(0, 0) + .125 * (at(1, 0) + at(-1, 0) + at(0, 1) + at(0, -1));
    im.data[(y * N + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (k - .38) * 2.4)));
  }
  g.putImageData(im, 0, 0); return grain = c;
}

// ——— Рисование штриха ———
// Точки штриха: плоский массив [x, y, p, x, y, p, …] в долях страницы (p — нажим 0…1).
const hull = pts => {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
};
function nibAt(x, y, s, W) {
  const L = s.w * H / 2, T = s.w * NIB * H / 2, c = Math.cos(s.a), n = Math.sin(s.a), X = x * W, Y = y * H;
  // Ось наконечника: a от горизонтали, против часовой на странице (y вниз — поэтому −sin).
  const ux = c * L, uy = -n * L, vx = n * T, vy = c * T;
  return [[X + ux + vx, Y + uy + vy], [X + ux - vx, Y + uy - vy], [X - ux - vx, Y - uy - vy], [X - ux + vx, Y - uy + vy]];
}
const fillPoly = (g, q) => { g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fill(); };
// Прямоугольник, который штрих задевает (в точках холста), с запасом.
function bbox(s, W) {
  const p = s.p, pad = (s.k === 'hl' ? s.w * .55 : s.w * 1.2) * H + 3; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i] * W); x1 = Math.max(x1, p[i] * W); y0 = Math.min(y0, p[i + 1] * H); y1 = Math.max(y1, p[i + 1] * H); }
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad)); return [x0, y0, Math.min(W, Math.ceil(x1 + pad)) - x0, Math.min(H, Math.ceil(y1 + pad)) - y0];
}
// Штрих — на общий черновой холст `tmp` (форма), потом умножением на холст страницы `g`.
function paint(g, tmp, s, W) {
  const [bx, by, bw, bh] = bbox(s, W); if (bw <= 0 || bh <= 0) return;
  const t = tmp.getContext('2d'), p = s.p; t.clearRect(bx, by, bw, bh); t.save(); t.beginPath(); t.rect(bx, by, bw, bh); t.clip();
  if (s.k === 'hl') {
    t.fillStyle = PEN.hl.rgb;
    if (p.length === 3) fillPoly(t, nibAt(p[0], p[1], s, W));
    for (let i = 3; i < p.length; i += 3) fillPoly(t, hull([...nibAt(p[i - 3], p[i - 2], s, W), ...nibAt(p[i], p[i + 1], s, W)]));
    t.restore();
    g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh);
    // Где наконечник встал и где поднялся, краски чуть больше (лёгкое пятно по форме наконечника).
    g.globalAlpha = .35; g.fillStyle = PEN.hl.rgb; fillPoly(g, nibAt(p[0], p[1], s, W)); if (p.length > 3) fillPoly(g, nibAt(p[p.length - 3], p[p.length - 2], s, W));
    g.restore(); return;
  }
  // Карандаш: отрезки между серединами соседних точек — дугами через сами точки, у каждого своя толщина по нажиму; концы круглые.
  t.strokeStyle = PEN.pc.rgb; t.lineCap = t.lineJoin = 'round'; let pm = 0;
  const wOf = q => s.w * H * (.55 + .9 * q), n = p.length / 3, X = i => p[3 * i] * W, Y = i => p[3 * i + 1] * H, P = i => p[3 * i + 2];
  if (n === 1) { t.fillStyle = PEN.pc.rgb; t.beginPath(); t.arc(X(0), Y(0), wOf(P(0)) / 2, 0, 7); t.fill(); pm = P(0); }
  for (let i = 0; i < n - 1; i++) {
    const ax = i ? (X(i - 1) + X(i)) / 2 : X(0), ay = i ? (Y(i - 1) + Y(i)) / 2 : Y(0), bx2 = i < n - 2 ? (X(i) + X(i + 1)) / 2 : X(n - 1), by2 = i < n - 2 ? (Y(i) + Y(i + 1)) / 2 : Y(n - 1);
    t.lineWidth = wOf(P(i)); t.beginPath(); t.moveTo(ax, ay); t.quadraticCurveTo(X(i), Y(i), bx2, by2); t.stroke(); pm += P(i);
  }
  if (n > 1) pm /= n - 1;
  // Графит остаётся на бугорках бумаги: в ямках его нет (сильнее нажали — ямок меньше).
  t.globalCompositeOperation = 'destination-out'; t.globalAlpha = .6 - .4 * pm; t.fillStyle = t.createPattern(grainTile(), 'repeat'); t.fillRect(bx, by, bw, bh);
  t.restore();
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = Math.min(1, .7 + .4 * pm); g.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh); g.restore();
}

// Расстояние от точки (в точках холста) до штриха — для ластика.
function near(s, x, y, r, W) {
  const p = s.p, reach = r + (s.k === 'hl' ? s.w * .5 : s.w * .7) * H;
  for (let i = 0; i < p.length; i += 3) {
    const ax = p[i] * W, ay = p[i + 1] * H, bx = (p[i + 3] ?? p[i]) * W, by = (p[i + 4] ?? p[i + 1]) * H, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const k = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    if (Math.hypot(ax + dx * k - x, ay + dy * k - y) <= reach) return true;
  }
  return false;
}

// ——— Страница ———
class Page {
  constructor(ink, n) { this.ink = ink; this.n = n; this.list = []; this.cv = null; this.tex = null; this.base = null; this.t = 0; }
  get W() { return Math.max(64, Math.round(H * this.ink.aspect)); }
  ensure() {
    const W = this.W;
    if (this.cv && this.cv.width === W) return;
    this.tex?.dispose(); this.cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.flipY = false; this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.redraw();
  }
  redraw() {
    const g = this.cv.getContext('2d'); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(0, 0, this.cv.width, H);
    for (const s of this.list) paint(g, this.ink.tmp(this.cv.width), s, this.cv.width);
    this.tex.needsUpdate = true; this.dirty = null;
  }
  free() { this.tex?.dispose(); this.tex = null; this.cv = null; this.base = null; }
}

// ——— Чернила одной книги (одного файла) ———
export class Ink {
  constructor(id, aspect = .7) {
    this.id = id; this.aspect = aspect; this.upload = null; this.held = null; this.pages = new Map(); this.undo = []; this.onChange = null; this.live = null; this.clock = 0; this.saveT = 0; this.dead = false; this._tmp = null;
    this.ready = tx('readonly', s => s.get(id)).then(r => {
      if (this.dead || !r?.pages) return;
      for (const [n, list] of Object.entries(r.pages)) if (list?.length) { const pg = new Page(this, +n); pg.list = list; this.pages.set(+n, pg); }
      this.onChange?.();
    }).catch(e => console.warn('ink', e));
  }
  tmp(W) { if (!this._tmp || this._tmp.width < W) this._tmp = Object.assign(document.createElement('canvas'), { width: W, height: H }); return this._tmp; }
  setAspect(a) { if (a > 0 && Math.abs(a - this.aspect) > 1e-4) { this.aspect = a; for (const pg of this.pages.values()) if (pg.cv) pg.ensure(); this.onChange?.(); } }
  has(n) { return !!this.pages.get(n)?.list.length; }
  // Текстура страницы n (null — на ней ничего нет). Холсты держатся у последних LRU страниц, к которым обращались; остальные рисуются заново, когда снова понадобятся.
  tex(n) {
    const pg = this.pages.get(n); if (!pg?.list.length && !pg?.base) return null;
    pg.t = ++this.clock; pg.ensure();
    const held = [...this.pages.values()].filter(p => p.cv); if (held.length > LRU) held.sort((a, b) => a.t - b.t).slice(0, held.length - LRU).forEach(p => p !== pg && !p.base && p.free());
    return pg.tex;
  }
  page(n) { let pg = this.pages.get(n); if (!pg) this.pages.set(n, pg = new Page(this, n)); return pg; }

  // Начать штрих на странице n в точке (x, y) с нажимом p. s: { k: 'hl' | 'pc', w, a }.
  begin(n, s, x, y, p) {
    this.end(); const pg = this.page(n); pg.t = ++this.clock; pg.ensure();
    pg.base = Object.assign(document.createElement('canvas'), { width: pg.cv.width, height: H }); pg.base.getContext('2d').drawImage(pg.cv, 0, 0);
    this.live = { pg, s: { ...s, p: [x, y, p] }, box: null };
    this.draw(); this.onChange?.();
  }
  // Повести: straight — штрих прямой от начала до этой точки (почти горизонтальный ложится ровно по строке).
  move(x, y, p, straight = false) {
    const L = this.live; if (!L) return; const q = L.s.p;
    if (straight) {
      const W = L.pg.cv.width, dx = (x - q[0]) * W, dy = (y - q[1]) * H;
      if (Math.abs(dy) < Math.abs(dx) * Math.tan(3 * Math.PI / 180)) y = q[1];
      q.length = 3; q.push(x, y, p);
    } else {
      const lx = q[q.length - 3], ly = q[q.length - 2], W = L.pg.cv.width;
      if (Math.hypot((x - lx) * W, (y - ly) * H) < 1.2) return;
      q.push(x, y, p);
    }
    L.stale = true;   // нарисуется в кадре (`flush`): у стилуса движений за кадр несколько, а рисовать штрих нужно один раз
  }
  draw() {
    const L = this.live, pg = L.pg, W = pg.cv.width, g = pg.cv.getContext('2d'), b = bbox(L.s, W), u = L.box ? [Math.min(L.box[0], b[0]), Math.min(L.box[1], b[1])] : b;
    // Восстановить то, что было под прошлым видом штриха, и положить штрих заново.
    const r = L.box ? [u[0], u[1], Math.max(L.box[0] + L.box[2], b[0] + b[2]) - u[0], Math.max(L.box[1] + L.box[3], b[1] + b[3]) - u[1]] : b;
    if (r[2] > 0 && r[3] > 0) g.drawImage(pg.base, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);   // холст непрозрачный: обычное наложение и есть замена
    paint(g, this.tmp(W), L.s, W); L.box = b;
    const d = pg.dirty; pg.dirty = d ? [Math.min(d[0], r[0]), Math.min(d[1], r[1]), Math.max(d[2], r[0] + r[2]), Math.max(d[3], r[1] + r[3])] : [r[0], r[1], r[0] + r[2], r[1] + r[3]];
  }
  // Раз в кадр (зовёт зал): изменённое за кадр — в текстуру. Целиком холст страницы грузится ~4 мс, поэтому, когда можно (`upload` от зала: текстура уже на видеокарте), — только
  // изменённый прямоугольник; иначе — целиком.
  flush() {
    if (this.live?.stale) { this.live.stale = false; this.draw(); }
    const pg = this.live?.pg ?? this.held; this.held = null; const d = pg?.dirty; if (!d || !pg.tex) return; pg.dirty = null;
    const x = Math.max(0, d[0]), y = Math.max(0, d[1]), w = Math.min(pg.cv.width, d[2]) - x, h = Math.min(H, d[3]) - y;
    if (w > 0 && h > 0 && !this.upload?.(pg.tex, x, y, w, h)) pg.tex.needsUpdate = true;
  }
  end() {
    const L = this.live; if (!L) return; if (L.stale) this.draw(); this.live = null; L.pg.base = null; this.held = L.pg;   // последнее изменение уйдёт в текстуру в следующем кадре (`flush`)
    // Короткий тычок маркером (меньше 2 мм пути) не оставляет следа: это не выделение.
    const q = L.s.p; let len = 0; for (let i = 3; i < q.length; i += 3) len += Math.hypot((q[i] - q[i - 3]) * this.aspect, q[i + 1] - q[i - 2]);
    if (L.s.k === 'hl' && len < .006) { L.pg.redraw(); this.onChange?.(); return; }
    L.s.p = q.map(v => Math.round(v * 1e4) / 1e4);
    L.pg.list.push(L.s); this.undo.push({ op: 'add', n: L.pg.n, s: L.s }); if (this.undo.length > 200) this.undo.shift();
    this.store(); this.onChange?.();
  }
  cancel() { const L = this.live; if (!L) return; this.live = null; L.pg.base = null; L.pg.redraw(); this.onChange?.(); }
  // Ластик: убрать штрихи страницы n, которые проходят рядом с точкой. true — что-то стёрто.
  erase(n, x, y) {
    const pg = this.pages.get(n); if (!pg?.list.length) return false; pg.ensure();
    const W = pg.cv.width, gone = pg.list.filter(s => near(s, x * W, y * H, PEN.er.r * H, W)); if (!gone.length) return false;
    pg.list = pg.list.filter(s => !gone.includes(s)); this.undo.push({ op: 'del', n, list: gone });
    pg.redraw(); this.store(); this.onChange?.(); return true;
  }
  // Отменить последнее (штрих или стирание). Возвращает страницу, на которой отменили, или 0.
  back() {
    const u = this.undo.pop(); if (!u) return 0; const pg = this.page(u.n);
    if (u.op === 'add') pg.list = pg.list.filter(s => s !== u.s); else pg.list.push(...u.list);
    pg.ensure(); pg.redraw(); this.store(); this.onChange?.(); return u.n;
  }
  store() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      const pages = {}; for (const [n, pg] of this.pages) if (pg.list.length) pages[n] = pg.list.map(({ k, w, a, p }) => a === undefined ? { k, w, p } : { k, w, a, p });
      tx('readwrite', s => Object.keys(pages).length ? s.put({ pages }, this.id) : s.delete(this.id)).catch(e => console.warn('ink save', e));
    }, 400);
  }
  dispose() { this.dead = true; this.live = null; for (const pg of this.pages.values()) pg.free(); }
}
