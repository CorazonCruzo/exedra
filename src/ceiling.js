import { t } from './i18n.js';
// Потолок зала — как на лучших станциях московского метро: высокий свод в кессонах с золочёными розетками,
// по его оси — ряд овальных куполков, каждый с росписью и светится изнутри от кольца ламп, между ними висят люстры.
// Над карнизом — пояс арочных окон со свинцовыми переплётами, в дальнем торце — большое веерное окно.
// Цвета — из самого зала: дерево карниза как у шкафов, кессоны — зелень ламп и сукна, рёбра — сливки бумаги, розетки — латунь.
// Росписи — набор на выбор (ART_SETS): по умолчанию Людвиг фон Хофман («Идиллия», 1894–95; «Ноктюрн», 1897) и его учитель
// Пюви де Шаванн («Священная роща», 1884–89; «Между искусством и природой», 1890–95) — небо, деревья, фигуры в бледной зелени и охре;
// или «Русское небо» — Рылов, Куинджи, Левитан. В каждом куполке свой кусок; в поле под аркой ближнего торца — «Между искусством и природой» целиком.
// Без картин (не загрузились) — небо, нарисованное программно.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { FAN_BARS } from './glass.js';

const rnd = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const texture = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

// ——— Живопись ———
// Штукатурка: тёплая известь, тон чуть гуляет.
// seamless — для плитки: пятна у края повторяются с другой стороны, шва нет.
function plaster(g, W, H, r, base = '#d8ccb6', seamless = false) {
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const shifts = seamless ? [-1, 0, 1] : [0];
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = r() * H, s = (30 + r() * 120) * W / 1024, dark = r() < .5, a = dark ? .03 + r() * .04 : .03 + r() * .05;
    for (const ox of shifts) for (const oy of shifts) {
      const cx = x + ox * W, cy = y + oy * H, gr = g.createRadialGradient(cx, cy, 0, cx, cy, s);
      gr.addColorStop(0, dark ? `rgba(150,128,96,${a.toFixed(3)})` : `rgba(240,232,214,${a.toFixed(3)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(cx - s, cy - s, 2 * s, 2 * s);
    }
  }
}
// Небо в облаках — запасное, если картина не загрузилась.
function sky(g, cx, cy, rx, ry, r) {
  const S = 256, h = S / 2, c = canvas(S, S), q = c.getContext('2d');
  const gr = q.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, '#f2deae'); gr.addColorStop(.4, '#c9cbbb'); gr.addColorStop(.75, '#9eabb0'); gr.addColorStop(1, '#b8996a');
  q.fillStyle = gr; q.fillRect(0, 0, S, S);
  const blob = (x, y, s, col) => { const b = q.createRadialGradient(x, y, 0, x, y, s); b.addColorStop(0, col); b.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); q.fillStyle = b; q.fillRect(x - s, y - s, 2 * s, 2 * s); };
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = .55 + r() * .4, s = (.12 + r() * .14) * h, x = h + Math.cos(a) * h * d, y = h + Math.sin(a) * h * d;
    for (let k = 0; k < 7; k++) { const px = x + (r() - .5) * s * 1.8, py = y + (r() - .5) * s, ps = s * (.45 + r() * .55); blob(px, py, ps, 'rgba(250,240,218,.4)'); }
  }
  g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(c, cx - rx, cy - ry, 2 * rx, 2 * ry); g.restore();
}
// Рама росписи — тусклое золото: тень, охра, блик.
function frame(g, path, w) {
  g.save();
  for (const [lw, col] of [[w * 2.4, 'rgba(70,52,30,.35)'], [w, '#b39150'], [w * .35, '#e0c98c']]) { g.lineWidth = lw; g.strokeStyle = col; path(); g.stroke(); }
  g.restore();
}
const oval = (g, cx, cy, rx, ry) => () => { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); };
// Кусок картины в прямоугольник x, y, w, h: crop — [номер картины, sx, sy, sw, sh] (доли картины), подрезается под пропорции места.
function fade(g, arts, [k, fx, fy, fw, fh], x, y, w, h) {
  const art = arts[k];
  let sx = fx * art.width, sy = fy * art.height, sw = fw * art.width, sh = fh * art.height;
  if (sw / sh > w / h) { const n = sh * w / h; sx += (sw - n) / 2; sw = n; } else { const n = sw * h / w; sy += (sh - n) / 2; sh = n; }
  g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(art, sx, sy, sw, sh, x, y, w, h); g.restore();
}
// Наборы росписей — на выбор (кнопка «убранство»): файлы в assets/art и куски для куполков (от галереи вдаль) — [номер картины, x, y, ширина, высота]
// в долях картины; lunette — кусок для овала под аркой ближнего торца, если нет муралa (по умолчанию — первый кусок куполков).
export const ART_SETS = {
  // Хофман и его учитель Пюви де Шаванн — одна манера и одна гамма (бледная зелень, сливки, охра, как сам зал):
  // 0 — Хофман «Идиллия», 1 — Хофман «Ноктюрн» (снят в раме: куски — внутри рамы), 2 — Пюви «Священная роща», 3 — Пюви «Между искусством и природой».
  // Первым над галереей — летящие музы, дальше художники чередуются.
  hofmann: {
    files: ['hofmann-idyll', 'hofmann-notturno', 'puvis-sacred-grove', 'puvis-inter-artes'],
    cupolas: [[2, .15, .02, .3, .55], [0, .05, 0, .5, .55], [3, .47, .12, .22, .7], [1, .5, .16, .38, .5], [2, .48, .3, .3, .6], [3, .08, .25, .25, .6], [2, 0, .25, .3, .5], [3, .68, .28, .22, .5]],
    title: t('decor.art.hofmann'), lunette: [0, 0, 0, 1, .7],
  },
  // «Русское небо»: Рылов «В голубом просторе» (1918), Куинджи «Облако» и «Облако над горной долиной», Левитан «Озеро».
  russian: {
    title: t('decor.art.russian'),
    files: ['rylov-v-golubom-prostore', 'kuindzhi-oblako', 'kuindzhi-oblako-nad-dolinoj', 'levitan-ozero'],
    cupolas: [[0, 0.055, 0, 0.85, 0.852], [1, 0.025, 0, 0.85, 0.863], [2, 0.2, 0.004, 0.6, 0.653], [3, 0.05, 0, 0.9, 0.876], [0, 0.056, 0.086, 0.527, 0.528], [1, 0.027, 0.132, 0.527, 0.535], [2, 0.154, 0.178, 0.372, 0.405], [3, 0.061, 0.078, 0.558, 0.543]],
  },
};
// Доля проекции сверху в раскладке росписи по куполу (остальное — по длине дуги).
const DOME_FLAT = .25;
// Атлас росписей куполков: 4 × 2 овала, у каждого рама по краю. 1024 px на куполок: к ним теперь можно подняться вплотную.
function cupolaAtlas(set, n, aspect, r) {
  const arts = set?.images;
  const CW = 1024, CH = Math.round(CW * aspect), cols = 4, rows = Math.ceil(n / cols), c = canvas(CW * cols, CH * rows), g = c.getContext('2d');
  plaster(g, c.width, c.height, r, '#e2d6bf');
  for (let i = 0; i < n; i++) {
    const cx = (i % cols + .5) * CW, cy = (Math.floor(i / cols) + .5) * CH, rx = CW * .5, ry = CH * .5;
    g.save(); oval(g, cx, cy, rx, ry)(); g.clip();
    if (arts) fade(g, arts, set.cupolas[i % set.cupolas.length], cx - rx, cy - ry, 2 * rx, 2 * ry); else sky(g, cx, cy, rx, ry, r);
    g.restore();
    frame(g, oval(g, cx, cy, rx * .985, ry * .985), 6);
  }
  return { tex: texture(c), cols, rows };
}
// Поле под аркой в ближнем торце. С муралом — роспись во всё поле, по краю арки и внизу золочёная рама;
// без него — роспись из набора в овальной раме посреди извести.
function lunetteCanvas(seed, set, aspect, mural) {
  if (mural) {
    const W = 2048, H = Math.round(W * aspect), c = canvas(W, H), g = c.getContext('2d');
    // Тонкую тёмную кромку снимка — прочь: по 1,5% с краёв.
    const m = .015, sw = mural.width * (1 - 2 * m), sh = mural.height * (1 - 2 * m);
    let sx = mural.width * m, sy = mural.height * m, w = sw, h = sh;
    if (sw / sh > W / H) { w = sh * W / H; sx += (sw - w) / 2; } else { h = sw * H / W; sy += (sh - h) * .35; }
    g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(mural, sx, sy, w, h, 0, 0, W, H); g.restore();
    const b = W * .006;
    frame(g, () => { g.beginPath(); g.ellipse(W / 2, H, W / 2 - b * 1.5, H - b * 1.5, 0, Math.PI, 0); g.lineTo(W - b * 1.5, H - b * 1.5); g.lineTo(b * 1.5, H - b * 1.5); g.closePath(); }, b);
    return texture(c);
  }
  const arts = set?.images;
  const W = 1024, H = Math.round(W * aspect), c = canvas(W, H), g = c.getContext('2d'), r = rnd(seed);
  plaster(g, W, H, r, '#d9bf8a');
  const cx = W / 2, cy = H * .48, rx = W * .16, ry = H * .34;
  g.save(); oval(g, cx, cy, rx, ry)(); g.clip(); if (arts) fade(g, arts, set.lunette ?? set.cupolas[0], cx - rx, cy - ry, 2 * rx, 2 * ry); else sky(g, cx, cy, rx, ry, r); g.restore();
  frame(g, oval(g, cx, cy, rx, ry), 5);
  return texture(c);
}
// Арочное окно: ромбы свинцового переплёта, по краю — кайма цветного стекла (янтарь и зелень), вверху — веер.
// Холст — в пропорциях окна: ширина 2·hw, высота rh + hw (прямая часть и полукруг).
function windowCanvas(hw, rh, r) {
  const k = 300, W = Math.round(2 * hw * k), H = Math.round((rh + hw) * k), c = canvas(W, H), g = c.getContext('2d');
  const pane = (path, base) => { const v = .78 + r() * .22; g.fillStyle = base.replace('V', v.toFixed(2)); path(); g.fill(); };
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const cx = W / 2, cyA = hw * k, b = .09 * k;
  // Ромбы: ряды через полромба со сдвигом — стекло без зазоров, между ромбами только свинец.
  const q = .2 * k, dia = (x, y) => { g.beginPath(); g.moveTo(x, y - q * .7); g.lineTo(x + q / 2, y); g.lineTo(x, y + q * .7); g.lineTo(x - q / 2, y); g.closePath(); };
  const each = f => { for (let row = -2; row * q * .7 < H + q; row++) for (let x = -q; x < W + q; x += q) f(x + (row % 2 ? q / 2 : 0), row * q * .7); };
  each((x, y) => pane(() => dia(x, y), 'rgba(226,222,204,V)'));
  g.strokeStyle = '#151210'; g.lineWidth = 3; each((x, y) => { dia(x, y); g.stroke(); });
  // Веер в полукруге и кайма.
  g.save(); g.beginPath(); g.arc(cx, cyA, hw * k - b, Math.PI, 0); g.closePath(); g.fillStyle = '#000'; g.fill();
  for (let i = 0; i < 9; i++) { const a0 = Math.PI + i / 9 * Math.PI, a1 = a0 + Math.PI / 9; pane(() => { g.beginPath(); g.moveTo(cx, cyA); g.arc(cx, cyA, hw * k - b - 3, a0, a1); g.closePath(); }, i % 2 ? 'rgba(214,170,92,V)' : 'rgba(236,226,196,V)'); }
  g.fillStyle = 'rgba(190,120,50,.95)'; g.beginPath(); g.arc(cx, cyA, .1 * k, Math.PI, 0); g.fill();
  g.strokeStyle = '#151210'; g.lineWidth = 3; for (let i = 0; i <= 9; i++) { const an = Math.PI + i / 9 * Math.PI; g.beginPath(); g.moveTo(cx, cyA); g.lineTo(cx + Math.cos(an) * hw * k, cyA + Math.sin(an) * hw * k); g.stroke(); }
  g.restore();
  g.lineWidth = b; g.strokeStyle = 'rgba(0,0,0,1)';
  const outline = () => { g.beginPath(); g.moveTo(b / 2, H); g.lineTo(b / 2, cyA); g.arc(cx, cyA, hw * k - b / 2, Math.PI, 0); g.lineTo(W - b / 2, H); };
  g.setLineDash([b * 1.6, b * .4]); g.strokeStyle = 'rgba(200,140,60,.95)'; outline(); g.stroke(); g.lineDashOffset = .4 * b; g.strokeStyle = 'rgba(80,120,74,.95)'; g.setLineDash([b * .4, b * 1.6]); outline(); g.stroke(); g.setLineDash([]);
  g.lineWidth = 4; g.strokeStyle = '#151210'; outline(); g.stroke(); g.beginPath(); g.moveTo(0, cyA); g.lineTo(W, cyA); g.stroke();
  return texture(c);
}
// Веерное окно в торце: полуовал по форме свода, лучи переплёта от середины, кольцо и солнце из янтарного стекла.
function fanCanvas(aspect, r) {
  const W = 1024, H = Math.round(W * aspect), c = canvas(W, H), g = c.getContext('2d'), cx = W / 2, cy = H;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const n = 18, rings = [.28, .62, 1];
  for (let j = 0; j < rings.length; j++) for (let i = 0; i < n; i++) {
    const a0 = Math.PI + i / n * Math.PI, a1 = a0 + Math.PI / n, r0 = j ? rings[j - 1] : .1, r1 = rings[j], v = .8 + r() * .3;
    g.fillStyle = j === 0 ? `rgba(214,160,80,${v.toFixed(2)})` : j === 1 && i % 3 === 1 ? `rgba(110,140,96,${v.toFixed(2)})` : `rgba(234,226,204,${v.toFixed(2)})`;
    g.beginPath(); g.ellipse(cx, cy, cx * r1, H * r1, 0, a0, a1); g.ellipse(cx, cy, cx * r0, H * r0, 0, a1, a0, true); g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(200,128,50,.95)'; g.beginPath(); g.ellipse(cx, cy, cx * .1, H * .1, 0, Math.PI, 0); g.fill();
  g.strokeStyle = '#151210'; g.lineWidth = 7;
  for (let i = 0; i <= n; i++) { const an = Math.PI + i / n * Math.PI; g.beginPath(); g.moveTo(cx + Math.cos(an) * cx * .1, cy + Math.sin(an) * H * .1); g.lineTo(cx + Math.cos(an) * cx, cy + Math.sin(an) * H); g.stroke(); }
  for (const rr of [.1, ...rings]) { g.beginPath(); g.ellipse(cx, cy, cx * rr, H * rr, 0, Math.PI, 0); g.stroke(); }
  g.lineWidth = 3; for (const rr of [.45, .81]) { g.beginPath(); g.ellipse(cx, cy, cx * rr, H * rr, 0, Math.PI, 0); g.stroke(); }
  return texture(c);
}
// Лампы по кольцу куполка: тёмная бронзовая лента, на ней светлые точки.
function bulbs() {
  const c = canvas(64, 16), g = c.getContext('2d');
  g.fillStyle = '#2e2216'; g.fillRect(0, 0, 64, 16);
  const gr = g.createRadialGradient(32, 8, 0, 32, 8, 8); gr.addColorStop(0, '#fff6dc'); gr.addColorStop(.45, '#ffd590'); gr.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = gr; g.fillRect(20, 0, 24, 16);
  const t = texture(c); t.wrapS = THREE.RepeatWrapping; return t;
}

// ——— Геометрия ———
// Протяжка профиля вдоль пути: profile — точки [n, b] (n — вдоль нормали пути, b — вдоль второй оси), frames — {p, n, b}.
// Каждый отрезок профиля — своя полоса: рёбра профиля остаются чёткими.
// uv — развёртка в метрах: u вдоль пути (вдоль волокон дерева), v — по профилю.
export function sweep(profile, frames, closed = false, uv = false) {
  const pos = [], tex = [], idx = [], fr = closed ? [...frames, frames[0]] : frames, v = new THREE.Vector3();
  let acc = 0; const along = fr.map((f, i) => (acc += i ? f.p.distanceTo(fr[i - 1].p) : 0));
  acc = 0; const across = profile.map((q, j) => (acc += j ? Math.hypot(q[0] - profile[j - 1][0], q[1] - profile[j - 1][1]) : 0));
  for (let j = 0; j < profile.length - 1; j++) {
    const base = pos.length / 3;
    for (const [i, f] of fr.entries()) for (const k of [j, j + 1]) { const [n, b] = profile[k]; v.copy(f.p).addScaledVector(f.n, n).addScaledVector(f.b, b); pos.push(v.x, v.y, v.z); tex.push(along[i], across[k]); }
    for (let i = 0; i < fr.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
}
// Сетка по двум параметрам: at(u, v) → [x, y, z, s, t] (s, t — UV).
function grid(nu, nv, at) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const [x, y, z, s, t] = at(i / nu, j / nv); pos.push(x, y, z); uv.push(s, t); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const q = i * (nv + 1) + j; idx.push(q, q + nv + 1, q + 1, q + 1, q + nv + 1, q + nv + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

// w — ширина зала, z0/z1 — его ближний и дальний торцы, y0 — верх стен (там карниз).
// art — набор росписей из ART_SETS с загруженными картинами (images) или null.
// cornice — на сколько карниз отстоит от стены (он лежит на фризе над шкафами), wood — материал дерева шкафов: его текстура у карниза.
// casts — сканы гипсовых отливок (assets/models/stucco): сетки в метрах, лицом к +z, спиной на z = 0. Каких нет — те простые, из коробок.
// limeMaps — карты настоящей штукатурки {map, normalMap}: ими фактурится вся известь.
// mural — картина во всё поле под аркой в ближнем торце (или null).
export function buildCeiling(scene, { w, z0, z1, y0, art = null, bays = 8, cornice = 0, wood = null, casts = {}, limeMaps = null, mural = null }) {
  // Над карнизом (y0) — пояс окон высотой CL, на нём пята свода.
  const CL = 2, a = w / 2, wallTop = y0 + .12, ys = wallTop + CL, H = 4.4, crown = ys + H, Lb = (z0 - z1) / bays;
  // Окна пояса: по одному на пролёт с каждой стороны, полукруглый верх.
  // Подоконник выше выноса карниза, чтобы снизу окно не пряталось за ним.
  const hw = .8, sill = wallTop + .45, rh = CL - .65 - hw, deepW = .35;
  // Куполки: овал поперёк зала шире, чем вдоль; над проёмом — короткая стенка с лампами и сам купол.
  // Пояс вдоль куполков отступает от их рам, а рамы — от поперечных арок.
  const rx = 2.3, rz = Lb / 2 - .62, lift = .7, hd = 2.1, tc = Math.acos((rx + .5) / a), RIBS = [.42, .82, tc];
  const group = new THREE.Group(); scene.add(group);
  const glow = [], r = rnd(7);
  // Светотень — в каждой точке: свет снизу, от ламп зала; к замку свода чуть темнее; над карнизом — полоса тени.
  // У свода ещё и кессоны: к рёбрам свет не достаёт, углы темнее; внутри овалов куполков свода нет — там проём.
  // uHall.w — высота середины люстр, uBay.w — сила их свечения на своде.
  const U = { uShade: { value: new THREE.Vector4(ys, crown + lift + hd, wallTop, a) }, uHall: { value: new THREE.Vector4(H, z0, z1, crown - 2.2) }, uBay: { value: new THREE.Vector4(Lb, rx, rz, 0) }, uRibs: { value: new THREE.Vector3(...RIBS) }, uWin: { value: new THREE.Vector3(sill, rh, hw) } };
  // Известь — настоящая штукатурка (скан, limeMaps): её тон и рельеф кладутся на поверхность с трёх сторон по положению в зале,
  // поэтому развёртка не нужна — ни своду, ни лепнине, ни отливкам.
  const L = limeMaps && { uLime: { value: limeMaps.map }, uLimeN: { value: limeMaps.normalMap }, uLimeS: { value: 1 / 2.23 } };
  // mode: 'vault' — свод (проёмы куполков, кессоны), 'clere' — пояс окон (проёмы окон). lime — известь с фактурой.
  const shaded = (m, mode = '', lime = false) => {
    const vault = mode === 'vault';
    lime = lime && !!L;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U, lime ? L : {});
      sh.vertexShader = 'varying vec3 vCeil, vCeilN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vCeil = (modelMatrix * vec4(transformed, 1.)).xyz; vCeilN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = 'uniform vec4 uShade, uHall, uBay;\nuniform vec3 uRibs, uWin;\nvarying vec3 vCeil, vCeilN;\n' + (lime ? 'uniform sampler2D uLime, uLimeN;\nuniform float uLimeS;\n' : '') + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float zz = (uHall.y - vCeil.z) / uBay.x, ce = length(vec2(vCeil.x / uBay.y, (fract(zz) - .5) * uBay.x / uBay.z));
          ${vault ? 'if (ce < 1.) discard;' : ''}
          ${mode === 'clere' ? `float wu = (fract(zz) - .5) * uBay.x, wh = vCeil.y - uWin.x;
          if (abs(wu) < uWin.z && wh > 0. && (wh < uWin.y || length(vec2(wu, wh - uWin.y)) < uWin.z)) discard;` : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float shadeK = 1. - .15 * smoothstep(uShade.x, uShade.y, vCeil.y);
          float above = vCeil.y - uShade.z, wall = min(uShade.w - abs(vCeil.x), min(uHall.y - vCeil.z, vCeil.z - uHall.z));
          if (above > 0. && wall < .9) shadeK *= 1. - .4 * (1. - smoothstep(0., 1.4, above)) * (1. - max(0., wall) / .9);
          ${vault ? `
          float t = atan(max(vCeil.y - uShade.x, 0.) / uHall.x, vCeil.x / uShade.w), s = min(t, 3.14159 - t), R = .5 * (uShade.w + uHall.x);
          float fb = fract(zz), fh = fract(zz * 2.);
          float d = s < uRibs.z
            ? min(min(min(abs(s - uRibs.x), abs(s - uRibs.y)), min(abs(s - uRibs.z), s)) * R, min(fh, 1. - fh) * uBay.x * .5)
            : min(abs(s - uRibs.z) * R, min(fb, 1. - fb) * uBay.x);
          d = min(d, (ce - 1.) * uBay.z);
          shadeK *= mix(.55, 1., smoothstep(.02, .55, d));` : ''}
          diffuseColor.rgb *= shadeK;
          ${lime ? `
          vec3 limeW = pow(abs(normalize(vCeilN)), vec3(4.)); limeW /= dot(limeW, vec3(1.));
          vec2 lX = vCeil.zy * uLimeS, lY = vCeil.xz * uLimeS, lZ = vCeil.xy * uLimeS;
          vec3 limeC = texture2D(uLime, lX).rgb * limeW.x + texture2D(uLime, lY).rgb * limeW.y + texture2D(uLime, lZ).rgb * limeW.z;
          diffuseColor.rgb *= mix(1., dot(limeC, vec3(.2126, .7152, .0722)) / .454, .75);` : ''}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${lime ? `
          vec3 tX = texture2D(uLimeN, lX).xyz * 2. - 1., tY = texture2D(uLimeN, lY).xyz * 2. - 1., tZ = texture2D(uLimeN, lZ).xyz * 2. - 1.;
          vec3 limeN = normalize(normalize(vCeilN) * faceDirection + .7 * (vec3(0., tX.y, tX.x) * limeW.x + vec3(tY.x, 0., tY.y) * limeW.y + vec3(tZ.x, tZ.y, 0.) * limeW.z));
          normal = normalize((viewMatrix * vec4(limeN, 0.)).xyz);` : ''}`)
        // Светят только три люстры из семи: их прямой свет на своде слабее, чтобы не было пятен над ними. Солнце — в полную силу.
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= .35;'))
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // Отсвет каждой люстры на своде: ближайший крюк — на ближайшей границе пролётов.
          float hk = clamp(floor(zz + .5), 1., ${bays - 1}.), dz = vCeil.z - (uHall.y - hk * uBay.x);
          float dh = length(vec3(vCeil.x, vCeil.y - uHall.w, dz));
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1., .84, .62) * uBay.w / (1. + dh * dh * .18);
          totalEmissiveRadiance *= shadeK;
          #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor;
          #endif`);
    };
    m.customProgramCacheKey = () => 'ceiling-' + mode + (lime ? '-lime' : '');
    return m;
  };
  const mat = (o, base, mode, lime) => { const m = shaded(new THREE.MeshStandardMaterial({ roughness: .9, side: THREE.DoubleSide, ...o }), mode, lime); glow.push([m, base, m.emissive.clone()]); return m; };
  // Кессоны — приглушённая зелень ламп и сукна, рёбра и рамы — сливочная известь, розетки и бусины — латунь, карниз — дерево шкафов.
  const tile = canvas(512, 512); plaster(tile.getContext('2d'), 512, 512, r, '#55634a', true);
  const vaultTex = texture(tile); vaultTex.wrapS = vaultTex.wrapT = THREE.RepeatWrapping;
  const field = mat({ color: 0xffffff, map: vaultTex, emissive: 0xffffff, emissiveMap: vaultTex }, .06, 'vault', true);
  const stucco = mat({ color: 0xe4cfa4, emissive: 0xe4cfa4 }, .05, '', true), clere = mat({ color: 0xe4cfa4, emissive: 0xe4cfa4 }, .05, 'clere', true);
  // Дерево карниза — как у фриза под ним: та же текстура, тот же лёгкий подъём тона.
  const LIFT = new THREE.Color(1.26, 1.21, 1.13), woodTone = wood ? wood.color.clone().multiply(LIFT) : new THREE.Color(0x6a3822);
  const woodwork = mat({ color: woodTone, emissive: woodTone, roughness: .55, ...(wood && { map: wood.map, emissiveMap: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap }) }, .03);
  const gold = () => shaded(new THREE.MeshStandardMaterial({ color: 0xc9a056, metalness: .75, roughness: .35, side: THREE.DoubleSide })), gilt = gold();
  const fresco = (t, base = .05) => mat({ map: t, emissive: 0xffffff, emissiveMap: t }, base);
  const add = (geo, m) => { const o = new THREE.Mesh(geo, m); group.add(o); return o; };
  // Лепнина и позолота копятся и в конце сливаются в две сетки — две отрисовки вместо сотен.
  const moulded = [], gilded = [];
  // Положить тело в общую сетку: m — где оно стоит. Отливку — копией; зеркальную — с обратным обходом граней, чтобы лицо осталось лицом.
  const put = (list, geo, m) => { geo.deleteAttribute('uv'); list.push(geo.applyMatrix4(m)); };
  const cast = (list, name, m) => {
    const g = casts[name].clone(); put(list, g, m);
    if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]; }
  };

  // Свод: x = a·cos t, y = ys + H·sin t (коробовый), вдоль всего зала. Текстура — по длине дуги и по длине зала, в метрах.
  const arc = (t, out = new THREE.Vector3()) => out.set(a * Math.cos(t), ys + H * Math.sin(t), 0);
  const inward = t => new THREE.Vector3(-Math.cos(t) / a, -Math.sin(t) / H, 0).normalize();
  const along = t => new THREE.Vector3(-a * Math.sin(t), H * Math.cos(t), 0).normalize();
  const yAt = x => ys + H * Math.sqrt(Math.max(0, 1 - (x / a) ** 2));
  {
    const N = 128, len = [0]; for (let i = 1; i <= N; i++) len.push(len[i - 1] + arc(i / N * Math.PI).distanceTo(arc((i - 1) / N * Math.PI)));
    add(grid(N, bays * 8, (u, v) => { const p = arc(u * Math.PI); return [p.x, p.y, z0 - (z0 - z1) * v, len[Math.round(u * N)] / 3, (z0 - z1) * v / 3]; }), field);
  }
  // Поперечные арки — на границах пролётов, на всю дугу; посередине пролёта — рёбра только по бокам, до куполков.
  const transverse = (z, t0, t1) => { const fr = []; for (let i = 0; i <= 48; i++) { const t = t0 + (t1 - t0) * i / 48; fr.push({ p: arc(t).setZ(z), n: inward(t), b: Z }); } return fr; };
  const RIB = (half, deep) => [[0, -half], [deep * .45, -half], [deep * .55, -half * .82], [deep, -half * .72], [deep, half * .72], [deep * .55, half * .82], [deep * .45, half], [0, half]];
  for (let k = 0; k <= bays; k++) {
    const z = z0 - k * Lb;
    moulded.push(sweep(RIB(.3, .26), transverse(z, 0, Math.PI)));
    for (const s of [-1, 1]) gilded.push(sweep([[.26, s * .2], [.29, s * .18], [.29, s * .13], [.26, s * .11]], transverse(z, 0, Math.PI)));
    if (k < bays) for (const [t0, t1] of [[0, tc], [Math.PI - tc, Math.PI]]) moulded.push(sweep(RIB(.15, .17), transverse(z - Lb / 2, t0, t1)));
  }
  // Продольные рёбра по бокам и пояс у куполков.
  const straight = t => [{ p: arc(t).setZ(z0), n: inward(t), b: along(t) }, { p: arc(t).setZ(z1), n: inward(t), b: along(t) }];
  for (const side of [0, 1]) for (const [i, t] of RIBS.entries()) {
    const tt = side ? Math.PI - t : t, edge = i === RIBS.length - 1;
    moulded.push(sweep(RIB(edge ? .2 : .14, edge ? .22 : .15), straight(tt)));
    if (edge) for (const s of [-1, 1]) gilded.push(sweep([[.22, s * .14], [.25, s * .12], [.25, s * .08], [.22, s * .06]], straight(tt)));
  }
  // Розетки посреди кессонов: золочёные цветки, обращённые в зал.
  {
    const prof = [[0, 0], [.17, 0], [.17, .02], [.13, .035], [.1, .06], [.06, .07], [.03, .095], [0, .1]].map(([x, y]) => new THREE.Vector2(x, y));
    const ros = new THREE.LatheGeometry(prof, 14).deleteAttribute('uv'), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    const rows = [RIBS[0] / 2, (RIBS[0] + RIBS[1]) / 2, (RIBS[1] + RIBS[2]) / 2];
    for (let k = 0; k < bays * 2; k++) for (const t of rows) for (const tt of [t, Math.PI - t]) {
      // Отливка — акантовая розетка Дикарта, позолоченная; без неё — точёный цветок.
      // Лицом в зал, верхом вдоль зала — все одинаково повёрнуты.
      if (casts.rosette) { const n = inward(tt); cast(gilded, 'rosette', m.makeBasis(new THREE.Vector3().crossVectors(Z, n), Z, n).setPosition(arc(tt).setZ(z0 - (k + .5) * Lb / 2))); }
      else gilded.push(ros.clone().applyMatrix4(m.compose(arc(tt).setZ(z0 - (k + .5) * Lb / 2), q.setFromUnitVectors(UP, inward(tt)), one)));
    }
  }

  // Куполки. Роспись — из атласа; купол светится от кольца ламп у основания: у края ярче, к вершине мягче.
  const atlas = cupolaAtlas(art, bays, rz / rx, r);
  const bulbTex = bulbs(); bulbTex.repeat.x = Math.round(Math.PI * (rx + rz) / .22);
  const ringMat = new THREE.MeshBasicMaterial({ map: bulbTex, color: 0xffffff });
  const domeMat = fresco(atlas.tex, .2); domeMat.vertexColors = true;
  const hooks = [], walls = [], bands = [], domes = [];
  for (let i = 0; i < bays; i++) {
    const zc = z0 - (i + .5) * Lb, base = crown + lift, col = i % atlas.cols, row = Math.floor(i / atlas.cols);
    // Рама проёма — по поверхности свода.
    const ringFrames = [];
    for (let k = 0; k < 96; k++) {
      const f = k / 96 * Math.PI * 2, x = rx * Math.cos(f), z = rz * Math.sin(f), p = new THREE.Vector3(x, yAt(x), zc + z);
      const n = new THREE.Vector3(-x / (a * a), -(p.y - ys) / (H * H), 0).normalize(), T = new THREE.Vector3(-rx * Math.sin(f), 0, rz * Math.cos(f));
      const b = new THREE.Vector3().crossVectors(n, T).normalize(); if (b.x * x + b.z * z < 0) b.negate();
      ringFrames.push({ p, n, b });
    }
    moulded.push(sweep([[-.3, -.02], [0, -.02], [.1, 0], [.14, .06], [.14, .2], [.08, .26], [0, .3]], ringFrames, true));
    gilded.push(sweep([[.14, .07], [.17, .09], [.17, .15], [.14, .17]], ringFrames, true));
    // Стенка над проёмом и лента ламп по её верху.
    walls.push(grid(96, 3, (u, v) => { const f = u * Math.PI * 2, x = rx * Math.cos(f), z = rz * Math.sin(f), yb = yAt(x) - .1; return [x, yb + (base - yb) * v, zc + z, u, v]; }));
    bands.push(grid(96, 1, (u, v) => { const f = u * Math.PI * 2; return [rx * .995 * Math.cos(f), base - .16 + .12 * v, zc + rz * .995 * Math.sin(f), u, v]; }));
    // Купол: полуэллипсоид; верх картины — к галерее. Роспись ложится по поверхности: расстояние от середины картины — почти по длине дуги
    // от вершины (q), а не проекцией сверху — та у основания, где купол почти отвесный, растягивала край картины в полосы.
    const dome = grid(96, 24, (u, v) => {
      const f = u * Math.PI * 2, th = v * Math.PI / 2, c = Math.cos(th), q = DOME_FLAT * c + (1 - DOME_FLAT) * (1 - v);
      return [rx * c * Math.cos(f), base + hd * Math.sin(th), zc + rz * c * Math.sin(f), (col + .5 + .5 * q * Math.cos(f)) / atlas.cols, 1 - (row + .5 - .5 * q * Math.sin(f)) / atlas.rows];
    });
    const p = dome.attributes.position, cl = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { const g = 1.2 - .6 * (p.getY(k) - base) / hd; cl[k * 3] = cl[k * 3 + 1] = cl[k * 3 + 2] = g; }
    dome.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    domes.push(dome);
    if (i > 0) hooks.push(new THREE.Vector3(0, crown - .02, z0 - i * Lb));
  }

  add(mergeGeometries(walls), stucco); add(mergeGeometries(bands), ringMat); add(mergeGeometries(domes), domeMat);

  // Окна. Стекло светится небом из-за окна: ночью — тёмная синева, днём — тёплый свет; его задаёт свет в зале.
  // Дымка зала их не скрывает: окно в дальнем торце видно и ночью.
  // Нарисованные стёкла — запасные, пока не загружен снимок настоящего стекла (setGlass).
  // GLASS_SKY — какая доля цвета неба видна в стекле (у простого стекла — треть); GLASS_BODY — цвет стекла самого по себе: свет зала оно отражает слабо.
  const GLASS_SKY = .3, GLASS_BODY = 0x5a524a;
  const painted = { side: windowCanvas(hw, rh, r), fan: fanCanvas(H / (2 * a), r) };
  // Стекло светится небом из-за окна (emissive), а ещё отражает свет зала своим же рисунком (map, приглушённо):
  // ночью окно — не чёрная дыра, а тёмный витраж, в котором видны свинец и цвета под люстрами.
  const glass = new THREE.MeshStandardMaterial({ color: 0x5a524a, map: painted.side, roughness: .18, metalness: 0, emissive: 0xffffff, emissiveMap: painted.side, side: THREE.DoubleSide, fog: false });
  const fanGlass = glass.clone(); fanGlass.map = fanGlass.emissiveMap = painted.fan;
  // По стеклу на сторону: солнце светит в окна одной стороны (утром — восточные, вечером — западные).
  const sides = { [-1]: { glass: glass.clone(), panes: [], out: new THREE.Vector3(-1, 0, 0) }, [1]: { glass, panes: [], out: new THREE.Vector3(1, 0, 0) } };
  // Солнце за стеклом — там, где оно на небе: стекло в его стороне светится ярче, широким мягким пятном без края. Самого диска и тесного
  // ореола нет: сквозь толстое неровное стекло солнце не видно кружком, а кружок, бегущий по стеклу вслед за взглядом, читался не как солнце;
  // ночью его нет. Блики ламп — только на стекле с рельефом (карта нормалей из снимка, glass.js): они мелкие, по кружкам и свинцу.
  // Гладкое стекло отразило бы люстру пятном в пол-окна — у него бликов нет. Блики неяркие (0,1 силы): в полную силу стекло «маслянистое».
  let skyNow = null;
  const SUN = { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunOn: { value: 0 } };
  const GLINT = 'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );';
  for (const m of [glass, sides[-1].glass, fanGlass]) {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, SUN);
      sh.fragmentShader = 'uniform vec3 uSunDir;\nuniform float uSunOn;\n' + sh.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(GLINT, `#ifdef USE_NORMALMAP\n${GLINT.replace(/;$/, ' * .1;')}\n#endif`))
        // Отражение зала в стекле с рельефом — вчетверо слабее: иначе кружки блестят сплошь, как масляные.
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n#ifdef USE_NORMALMAP\n\treflectedLight.indirectSpecular *= .25;\n#endif')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float sunC = max(dot(normalize(-vViewPosition), normalize((viewMatrix * vec4(uSunDir, 0.)).xyz)), 0.);
          totalEmissiveRadiance *= 1. + uSunOn * (pow(sunC, 10.) * .5 + pow(sunC, 3.) * .45);
          // Мягкий потолок яркости — по самому яркому каналу, весь цвет разом: стекло на солнце светит сильно, но красное остаётся красным,
          // а не выгорает в белое (у экрана свой предел, за ним все цвета сходятся к белому).
          float eMax = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b);
          if (eMax > 0.) totalEmissiveRadiance *= 1.2 * (1. - exp(-eMax / 1.2)) / eMax;`);
    };
    m.customProgramCacheKey = () => 'sunlit-glass';
  }
  // Контуры проёмов — для лучей в воздухе (sun.js): точки по краю окна и наружная нормаль.
  const windows = [];
  const arch = () => { const sh = new THREE.Shape(); sh.moveTo(-hw, 0); sh.lineTo(-hw, rh); sh.absarc(0, rh, hw, Math.PI, 0, true); sh.lineTo(hw, 0); sh.lineTo(-hw, 0); return sh; };
  // Замковый камень: клин шире кверху, с фаской; лицо — в зал (по местной z).
  const keystone = (() => {
    const top = sill + rh + hw, sh = new THREE.Shape().moveTo(-.075, top - .07).lineTo(.075, top - .07).lineTo(.115, top + .27).lineTo(-.115, top + .27).closePath();
    return mergeVertices(new THREE.ExtrudeGeometry(sh, { depth: .07, bevelEnabled: true, bevelThickness: .015, bevelSize: .012, bevelSegments: 2 }).translate(0, 0, .015).deleteAttribute('uv'));
  })();
  for (let i = 0; i < bays; i++) for (const sd of [-1, 1]) {
    const zc = z0 - (i + .5) * Lb, X = sd * a;
    // Стекло — в глубине проёма; откосы и наличник — известь, по наличнику — латунная бусина.
    // Из зала видна изнанка стекла: развёртка отражена, чтобы снимок, сделанный изнутри, читался как снят.
    const g = new THREE.ShapeGeometry(arch(), 24), p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, 1 - (p.getX(k) + hw) / (2 * hw), p.getY(k) / (rh + hw));
    sides[sd].panes.push(g.applyMatrix4(new THREE.Matrix4().makeRotationY(sd * Math.PI / 2).setPosition(X + sd * deepW, sill, zc)));
    const ring = [new THREE.Vector3(X, sill, zc + sd * hw)];
    for (let k = 0; k <= 12; k++) { const an = Math.PI - k / 12 * Math.PI; ring.push(new THREE.Vector3(X, sill + rh + hw * Math.sin(an), zc - sd * hw * Math.cos(an))); }
    ring.push(new THREE.Vector3(X, sill, zc - sd * hw));
    windows.push({ pts: ring, out: sides[sd].out });
    // Наличник — одна протяжка по всему контуру проёма. В координатах окна (u — вдоль стены, h — вверх) b смотрит внутрь проёма;
    // нижние углы — на ус (b по диагонали длиной √2), каждый угол — двумя кадрами, чтобы грани остались чёткими.
    const out = new THREE.Vector3(sd, 0, 0), at = (u, h) => new THREE.Vector3(X, sill + h, zc - sd * u), dir = (du, dh) => new THREE.Vector3(0, dh, -sd * du);
    const fr = (u, h, du, dh) => ({ p: at(u, h), n: out, b: dir(du, dh) });
    const contour = [fr(-hw, 0, 1, 1), fr(hw, 0, -1, 1), fr(hw, 0, -1, 1), fr(hw, rh, -1, 0)];
    for (let k = 1; k < 24; k++) { const an = k / 24 * Math.PI; contour.push(fr(hw * Math.cos(an), rh + hw * Math.sin(an), -Math.cos(an), -Math.sin(an))); }
    contour.push(fr(-hw, rh, 1, 0), fr(-hw, 0, 1, 1));
    // Наличник — откос и три уступа с гуськом по краю, по среднему уступу — золочёная бусина.
    moulded.push(sweep([[deepW, 0], [0, 0], [-.025, -.005], [-.025, -.05], [-.045, -.06], [-.045, -.11], [-.06, -.12], [-.075, -.15], [-.075, -.175], [-.05, -.2], [0, -.21]], contour));
    gilded.push(sweep([[-.045, -.07], [-.06, -.077], [-.06, -.093], [-.045, -.1]], contour));
    // Замковый камень в вершине арки (подпирает тягу у пяты свода), импосты на пяте арки, подоконник.
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, sd), UP, new THREE.Vector3(-sd, 0, 0)).setPosition(X, 0, zc);
    if (casts.keystone) cast(moulded, 'keystone', M.clone().multiply(new THREE.Matrix4().makeTranslation(0, sill + rh + hw + .095, 0)));
    else put(moulded, keystone.clone(), M);
    for (const u of [-1, 1]) put(moulded, new THREE.BoxGeometry(.26, .075, .1), M.clone().multiply(new THREE.Matrix4().makeTranslation(u * (hw + .1), sill + rh + .0375, .05)));
    put(moulded, new THREE.BoxGeometry(2 * hw + .56, .07, .15), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, sill - .035, .075)));
    put(moulded, new THREE.BoxGeometry(2 * hw + .44, .035, .1), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, sill - .0875, .05)));
  }
  for (const sd of [-1, 1]) add(mergeGeometries(sides[sd].panes), sides[sd].glass);
  // Сияние вокруг светлых окон — свет, рассеянный в воздухе и на откосах, как его видит глаз: окно не вырезано из стены, а светит в неё.
  // Мягкий ореол по форме арки, на плоскости стены; яркость и цвет — от неба и солнца (setSky).
  // Текстура — квадрат, окно в нём занимает середину (ширина 0,6); вокруг — стопка всё больших арок, каждая чуть светит,
  // самая большая не доходит до края: ореол гаснет к краям квадрата.
  const ARCH = (rh + hw) / (2 * hw) * .6, glareTex = (() => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d');
    const arch = k => { const w = .3 * k, top = .5 - ARCH / 2 * k, bottom = .5 + ARCH / 2 * k; g.beginPath(); g.moveTo(.5 - w, bottom); g.lineTo(.5 - w, top + w); g.arc(.5, top + w, w, Math.PI, 0); g.lineTo(.5 + w, bottom); g.closePath(); };
    g.scale(S, S); g.fillStyle = '#fff'; g.globalAlpha = .05;
    for (let k = 0; k < 30; k++) { arch(1 + k * .019); g.fill(); }
    // Само стекло ореол не трогает — иначе он белит цвета витража; край выреза размыт, чтобы окно не выглядело вырезанным.
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.filter = 'blur(2px)'; arch(.97); g.fill();
    return texture(c);
  })();
  const glare = { [-1]: [], [1]: [] }, glareMat = () => new THREE.MeshBasicMaterial({ map: glareTex, color: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const glareMats = { [-1]: glareMat(), [1]: glareMat(), fan: glareMat() }, GS = 2 * hw / .6;
  for (let i = 0; i < bays; i++) for (const sd of [-1, 1]) glare[sd].push(new THREE.PlaneGeometry(GS, GS).applyMatrix4(new THREE.Matrix4().makeRotationY(sd * Math.PI / 2).setPosition(sd * (a - .012), sill + (rh + hw) / 2, z0 - (i + .5) * Lb)));
  for (const sd of [-1, 1]) { const o = add(mergeGeometries(glare[sd]), glareMats[sd]); o.renderOrder = 3; }
  // У веерного окна — полуовал: такая же стопка, только полуэллипсов от середины низа; низ отрезан карнизом под окном.
  { const S = 256, c = canvas(S, S / 2), g = c.getContext('2d'); g.scale(S, S / 2); g.fillStyle = '#fff'; g.globalAlpha = .05;
    for (let k = 0; k < 30; k++) { const r = .8 + k * .0065; g.beginPath(); g.ellipse(.5, 1, .5 * r / .995, r, 0, Math.PI, 0); g.fill(); }
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.filter = 'blur(2px)'; g.beginPath(); g.ellipse(.5, 1, .5 * .78 / .995, .78, 0, Math.PI, 0); g.fill();
    glareMats.fan.map = texture(c);
    const o = add(new THREE.PlaneGeometry(2 * a / .8 * .995, H / .8 * .995).translate(0, ys + H / .8 * .995 / 2, z1 + .03), glareMats.fan); o.renderOrder = 3; }
  // Поля над поясом окон в торцах: ближнее — роспись в раме (видно с изнанки — развёртка отражена), дальнее — веерное окно.
  const lt = lunetteCanvas(61, art, H / (2 * a), mural);
  for (const [z, rot] of [[z0, 0], [z1, Math.PI]]) {
    const shape = new THREE.Shape(); shape.moveTo(-a, 0); for (let i = 0; i <= 64; i++) { const t = Math.PI - i / 64 * Math.PI; shape.lineTo(a * Math.cos(t), H * Math.sin(t)); }
    const g = new THREE.ShapeGeometry(shape, 32), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 1 - (p.getX(i) + a) / (2 * a), p.getY(i) / H);
    const o = add(g, z === z0 ? fresco(lt) : fanGlass); o.position.set(0, ys, z); o.rotation.y = rot;
  }
  // Прутья веерного окна — золочёные, того же золота, что картуш под окном: настоящие тела перед стеклом (свет зала ложится на них,
  // как на «глаз»), а не тёмные линии в самом стекле. Раскладка — та же, что у нарисованных (FAN_BARS): лучи из середины низа и три дуги.
  const fanBars = (() => {
    const { rays, hub, mid, rim, w } = FAN_BARS, parts = [], zb = z1 + .004, P = (t, r) => new THREE.Vector3(a * r * Math.cos(t), ys + H * r * Math.sin(t), zb);
    const bar = wd => [[0, -wd / 2], [.014, -wd / 2], [.024, -wd / 4], [.024, wd / 4], [.014, wd / 2], [0, wd / 2]];
    const ray = (t, r0, wd) => { const p0 = P(t, r0), p1 = P(t, rim), b = new THREE.Vector3().subVectors(p1, p0).normalize().cross(Z); parts.push(sweep(bar(wd), [{ p: p0, n: Z, b }, { p: p1, n: Z, b }])); };
    for (let i = 0; i <= rays; i++) ray(i / rays * Math.PI, hub, w.ray);
    for (let i = 0; i < rays; i++) ray((i + .5) / rays * Math.PI, mid, w.half);
    for (const [r, wd] of [[hub, w.hub], [mid, w.mid], [rim - .004, w.rim]]) {
      const fr = []; for (let k = 0; k <= 96; k++) { const t = k / 96 * Math.PI; fr.push({ p: P(t, r), n: Z, b: new THREE.Vector3(Math.cos(t) / a, Math.sin(t) / H, 0).normalize() }); }
      parts.push(sweep(bar(wd), fr));
    }
    return add(mergeGeometries(parts), gold());
  })();
  // Над рамой росписи в ближнем торце — дуговая гирлянда с раковиной (отливка Дикарта); над муралом во всё поле её нет.
  // Низ касается рамы, верх не заходит под торцевую арку.
  if (casts.crest && !mural) cast(moulded, 'crest', new THREE.Matrix4().compose(new THREE.Vector3(0, ys + 3.8, z0), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI), new THREE.Vector3(1.2, 1.1, 1)));
  { const pts = []; for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI; pts.push(new THREE.Vector3(a * Math.cos(t), ys + H * Math.sin(t), z1)); } windows.push({ pts, out: new THREE.Vector3(0, 0, -1) }); }
  // Пояс окон: боковые стены с проёмами (вырезает шейдер), торцы — гладкие; под пятой свода — тонкая тяга.
  const flat = (geo, m, list = moulded) => { geo.deleteAttribute('uv'); list.push(geo.applyMatrix4(m)); };
  const belt = [];
  for (const s of [-1, 1]) flat(new THREE.PlaneGeometry(z0 - z1, CL, bays * 4, 6), new THREE.Matrix4().makeRotationY(-s * Math.PI / 2).setPosition(s * a, wallTop + CL / 2, (z0 + z1) / 2), belt);
  for (const z of [z0, z1]) flat(new THREE.PlaneGeometry(w, CL, 1, 6), new THREE.Matrix4().makeTranslation(0, wallTop + CL / 2, z));
  const beltMesh = add(mergeGeometries(belt), clere);
  beltMesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  beltMesh.customDepthMaterial.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vCeil;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vCeil = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = 'uniform vec4 uHall, uBay;\nuniform vec3 uWin;\nvarying vec3 vCeil;\n' + sh.fragmentShader.replace('void main() {', `void main() {
      float zz = (uHall.y - vCeil.z) / uBay.x, wu = (fract(zz) - .5) * uBay.x, wh = vCeil.y - uWin.x;
      if (abs(wu) < uWin.z && wh > 0. && (wh < uWin.y || length(vec2(wu, wh - uWin.y)) < uWin.z)) discard;`);
  };
  const line = (p0, p1, n) => [{ p: p0, n, b: UP }, { p: p1, n, b: UP }];
  // Тяга под пятой свода — поглубже рёбер: в неё упираются рёбра свода, их торцы не видны.
  for (const s of [-1, 1]) moulded.push(sweep([[0, -.04], [.2, -.03], [.28, .01], [.2, .05], [0, .07]], line(new THREE.Vector3(s * a, ys, z0), new THREE.Vector3(s * a, ys, z1), new THREE.Vector3(-s, 0, 0))));
  const CORNICE = [[0, -.36], [.04, -.36], [.05, -.3], [.1, -.27], [.12, -.19], [.21, -.15], [.25, -.07], [.37, -.02], [.42, .06], [.42, .12], [0, .12]];
  // Карниз по верху стен — дерево, как у шкафов, по кромке латунь: стены зала кончаются деревом, выше — известь и свод.
  // Карниз стоит на лице фриза — в cornice от стены, сверху его закрывает полка до стены.
  const carved = [], ca = a - cornice, cz0 = z0 - cornice, cz1 = z1 + cornice;
  const sideLine = s => line(new THREE.Vector3(s * ca, y0, cz0), new THREE.Vector3(s * ca, y0, cz1), new THREE.Vector3(-s, 0, 0));
  const endLine = (z, s) => line(new THREE.Vector3(-ca, y0, z), new THREE.Vector3(ca, y0, z), new THREE.Vector3(0, 0, s));
  for (const s of [-1, 1]) carved.push(sweep(CORNICE, sideLine(s), false, true));
  for (const [z, s] of [[cz0, -1], [cz1, 1]]) carved.push(sweep(CORNICE, endLine(z, s), false, true));
  if (cornice > 0) {
    const CAP = [[-cornice, .12], [0, .12]];
    // Полка вдоль боковых стен — на всю длину, до самых торцов: в углах не остаётся щели.
    for (const s of [-1, 1]) carved.push(sweep(CAP, line(new THREE.Vector3(s * ca, y0, z0), new THREE.Vector3(s * ca, y0, z1), new THREE.Vector3(-s, 0, 0)), false, true));
    for (const [z, s] of [[cz0, -1], [cz1, 1]]) carved.push(sweep(CAP, endLine(z, s), false, true));
  }
  const BEAD = [[.42, .07], [.45, .085], [.45, .105], [.42, .12]];
  for (const s of [-1, 1]) gilded.push(sweep(BEAD, sideLine(s)));
  for (const [z, s] of [[cz0, -1], [cz1, 1]]) gilded.push(sweep(BEAD, endLine(z, s)));
  // ——— Лепнина пояса окон ———
  // Тела — в общие сетки штукатурки и позолоты; place — поставить на стену: e — где, rotY — куда смотрит лицо.
  const M4 = (x, y, z, rotY = 0, rotZ = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, rotZ, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  // Пилястра: аттическая база на плинте (два вала и выкружка между ними, с возвратом на бока), ствол с пятью каннелюрами, поясок-астрагал
  // и капитель. Ставится лицом в зал: (wx, wz) — точка на стене, rotY — поворот лица. Свет на извести ровный, поэтому тень в каннелюрах
  // и выкружке положена в цвет вершин — как запечённое затенение у отливок.
  const PIL = { w: .3, d: .07, base: .15, flutes: 5, flute: .036, deep: .015 };
  const BASE = [[0, 0], [.05, 0], [.05, .05], [.036, .052], [.046, .062], [.05, .076], [.046, .09], [.034, .098], [.024, .102], [.018, .11], [.022, .12], [.03, .124], [.036, .134], [.03, .146], [.012, .15], [0, .15]];
  const shadeBy = (geo, f) => { const p = geo.attributes.position, c = new Float32Array(p.count * 3), v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) c.fill(f(v.fromBufferAttribute(p, i)), i * 3, i * 3 + 3); geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return geo; };
  const pilaster = (wx, wz, rotY) => {
    const h0 = wallTop + .06, h1 = ys - .16, { w, d, base, flutes, flute, deep } = PIL, hw = w / 2;
    const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, rotY), side = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, rotY), W0 = new THREE.Vector3(wx, 0, wz);
    const at = (dx, y, dz) => W0.clone().addScaledVector(side, dx).addScaledVector(out, dz).setY(y);
    // База обходит ствол с трёх сторон: путь — по следу ствола на стене, в углах профиль идёт по биссектрисе.
    const ring = (profile, y) => sweep(profile, [[-hw, 0, -1, 0], [-hw, d, -1, 1], [hw, d, 1, 1], [hw, 0, 1, 0]].map(([dx, dz, nx, nz]) => ({ p: at(dx, y, dz), n: side.clone().multiplyScalar(nx).addScaledVector(out, nz), b: UP })));
    const depth = v => v.clone().sub(W0).dot(out);
    moulded.push(shadeBy(ring(BASE, h0), v => { const y = v.y - h0; return 1 - .3 * Math.exp(-(((y - .108) / .016) ** 2)) - .12 * Math.exp(-(((y - .052) / .008) ** 2)); }));
    // Капитель — отливка с цинковой капители из Дрездена (около 1870), сплющенная до глубины пилястры; без неё — плита и шейка.
    const cap = casts.capital ? .43 : .34, y0 = h0 + base, y1 = h1 - cap;
    // Ствол: гладкие поля по краям и между каннелюрами, каннелюра — дуга из шести отрезков.
    const gap = (w - flutes * flute) / (flutes + 1), cut = [[0, -hw], [d, -hw]];
    for (let k = 0; k < flutes; k++) { const c = -hw + gap + flute / 2 + k * (gap + flute); for (let q = 0; q <= 6; q++) { const t = q / 6 * Math.PI; cut.push([d - deep * Math.sin(t), c - flute / 2 * Math.cos(t)]); } }
    cut.push([d, hw], [0, hw]);
    moulded.push(shadeBy(sweep(cut, [{ p: at(0, y0, 0), n: out, b: side }, { p: at(0, y1 + .02, 0), n: out, b: side }]), v => 1 - .42 * Math.min(1, Math.max(0, (d - depth(v)) / deep))));
    // Поясок под капителью: полочка и валик.
    moulded.push(ring([[0, 0], [.012, 0], [.012, .012], [.02, .018], [.022, .028], [.016, .038], [0, .04]], y1 - .03));
    // Шире на четверть прежнего не нужно: низ капители — как ствол (0,3 м); глубина — как у пилястры.
    if (casts.capital) cast(moulded, 'capital', M4(wx, h1 - .215, wz, rotY, 0, 1, 1, .65));
    else {
      put(moulded, new THREE.BoxGeometry(w + .14, .2, .16), M4(...at(0, h1 - .1, .08).toArray(), rotY));
      put(moulded, new THREE.BoxGeometry(w + .06, .06, .13), M4(...at(0, h1 - .23, .065).toArray(), rotY));
    }
  };
  // По бокам — между окнами, на границах пролётов; в торцах — по две по краям.
  for (let k = 0; k <= bays; k++) for (const sd of [-1, 1]) pilaster(sd * a, z0 - k * Lb, -sd * Math.PI / 2);
  for (const [z, rotY] of [[z1, 0], [z0, Math.PI]]) for (const x of [-a + .5, -a + 2.4, a - 2.4, a - .5]) pilaster(x, z, rotY);
  // Под тягой у пяты свода — ов (яйца и стрелки), отливка по 40 см; без неё — зубчики. По всем стенам, над окнами нет.
  if (casts.ovolo) {
    // По бокам — отрезками между окнами: каждый проходит над пилястрой и кончается у наличника (на высоте пояса он уже — ±0,5 м);
    // целое число отливок, по середине отрезка, а у торцов — от самого угла.
    const half = Lb / 2 - .5, P = .4;
    for (const sd of [-1, 1]) for (let k = 0; k <= bays; k++) {
      const c = z0 - k * Lb, lo = Math.max(z1, c - half), hi = Math.min(z0, c + half), n = Math.floor((hi - lo) / P + 1e-6);
      const first = k === 0 ? z0 - P / 2 : k === bays ? z1 + P / 2 + (n - 1) * P : c + (n - 1) / 2 * P;
      for (let j = 0; j < n; j++) cast(moulded, 'ovolo', M4(sd * a, ys - .1, first - j * P, -sd * Math.PI / 2));
    }
    for (const [z, rotY] of [[z0, Math.PI], [z1, 0]]) for (let x = -a + .2; x < a - .15; x += .4) cast(moulded, 'ovolo', M4(x, ys - .1, z, rotY));
  } else {
    const dent = new THREE.BoxGeometry(.07, .09, .08);
    for (const sd of [-1, 1]) for (let z = z0 - .1; z > z1 + .1; z -= .17) {
      const wu = ((z0 - z) / Lb % 1 - .5) * Lb; if (Math.abs(wu) < hw + .25) continue;
      put(moulded, dent.clone(), M4(sd * (a - .04), ys - .11, z, -sd * Math.PI / 2));
    }
    for (const z of [z0, z1]) for (let x = -a + .1; x < a - .1; x += .17) put(moulded, dent.clone(), M4(x, ys - .11, z + (z === z1 ? .04 : -.04)));
  }
  // Под главным окном — картуш: овальная рама с позолотой, в поле — лучи солнца, как в окне над ним.
  // По бокам — подвесы из цветов на латунных кольцах и фриз с тюльпанами в духе югендстиля (отливки Дикарта, слева — зеркально);
  // без отливок — завитки волют и гирлянды из листьев. Под росписью в ближнем торце — то же самое, один в один («лучше повтори прям так же»,
  // пользователь, 2026-11-13): всё собранное для дальнего торца повторяется поворотом на пол-оборота вокруг середины зала.
  const cartoucheFrom = [moulded.length, gilded.length];
  {
    const cy = wallTop + CL / 2 + .02, zf = z1, ex = .95, ey = .7;
    const ovalFrames = (rx2, ry2, z) => { const fr = []; for (let k = 0; k < 64; k++) { const f = k / 64 * Math.PI * 2, p = new THREE.Vector3(rx2 * Math.cos(f), cy + ry2 * Math.sin(f), z); fr.push({ p, n: new THREE.Vector3(0, 0, 1), b: new THREE.Vector3(-Math.cos(f) * ry2, -Math.sin(f) * rx2, 0).normalize() }); } return fr; };
    moulded.push(sweep([[0, -.2], [.06, -.2], [.1, -.15], [.12, -.06], [.1, 0], [0, .02]], ovalFrames(ex + .14, ey + .14, zf), true));
    gilded.push(sweep([[0, -.07], [.07, -.065], [.11, -.03], [.12, 0], [.11, .03], [.07, .065], [0, .07]], ovalFrames(ex, ey, zf), true));
    put(moulded, new THREE.CircleGeometry(1, 48), M4(0, cy, zf + .015, 0, 0, ex - .05, ey - .05, 1));
    for (let k = 0; k < 24; k++) { const an = k / 24 * Math.PI * 2, l = (k % 2 ? .42 : .6); put(gilded, new THREE.BoxGeometry(.035, l, .02), M4(Math.cos(an) * (l / 2 + .14) * ex / ey * .85, cy + Math.sin(an) * (l / 2 + .14) * .85, zf + .03, 0, an - Math.PI / 2)); }
    put(gilded, new THREE.SphereGeometry(.12, 16, 10), M4(0, cy, zf + .03, 0, 0, 1, 1, .5));
    if (casts.drops && casts.tulips) for (const sx of [-1, 1]) {
      cast(moulded, 'drops', M4(sx * (ex + .5), cy - .07, zf, 0, 0, 1.2, 1.2, 1.2));
      put(gilded, new THREE.TorusGeometry(.055, .017, 8, 18), M4(sx * (ex + .5), cy + .5, zf + .03));
      const span = a - 2.4 - .3 - (ex + .78), k = span / 2 / 1.55;
      for (const i of [0, 1]) cast(moulded, 'tulips', M4(sx * (ex + .78 + span * (i + .5) / 2), cy, zf, 0, 0, sx * k, k, 1));
    } else for (const sx of [-1, 1]) {
      // Волюта: спираль от рамы наружу и вниз.
      const pts = []; for (let k = 0; k <= 40; k++) { const t = k / 40 * Math.PI * 2.4, r0 = .32 * Math.exp(-.28 * t); pts.push(new THREE.Vector3(sx * (ex + .3 + .32 - r0 * Math.cos(t)), cy - .15 - r0 * Math.sin(t) * .9 + .2, zf + .06)); }
      put(moulded, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, .045, 8), new THREE.Matrix4());
      // Гирлянда: провис между рамой и лентой у пилястры; листья крупнее к середине; с ленты свисает кисть.
      const P0 = new THREE.Vector3(sx * (ex + .25), cy + .38, zf + .1), P1 = new THREE.Vector3(sx * (a - 2.75), cy + .5, zf + .1), N = 30;
      const at = t => new THREE.Vector3().lerpVectors(P0, P1, t).add(new THREE.Vector3(0, -.55 * Math.sin(Math.PI * t), 0));
      for (let k = 0; k <= N; k++) {
        const t = k / N, p = at(t), tg = at(Math.min(1, t + .01)).sub(at(Math.max(0, t - .01))), sz = .55 + .55 * Math.sin(Math.PI * t);
        put(moulded, new THREE.SphereGeometry(1, 8, 6), M4(p.x, p.y + (k % 2 ? .03 : -.03) * sz, p.z + (k % 3) * .015, 0, Math.atan2(tg.y, tg.x) + (k % 2 ? .5 : -.5), .11 * sz, .065 * sz, .06 * sz));
      }
      for (let k = 1; k <= 6; k++) { const sz = 1 - k / 8; put(moulded, new THREE.SphereGeometry(1, 8, 6), M4(P1.x + (k % 2 ? .03 : -.03), P1.y - k * .1, P1.z, 0, k % 2 ? .4 : -.4, .07 * sz, .09 * sz, .05 * sz)); }
      for (const P of [P0, P1]) put(gilded, new THREE.TorusGeometry(.07, .022, 8, 18), M4(P.x, P.y + .02, P.z + .03));
    }
  }
  { const turn = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, z0 + z1);
    for (const [list, from] of [[moulded, cartoucheFrom[0]], [gilded, cartoucheFrom[1]]]) for (const g of list.slice(from)) list.push(g.clone().applyMatrix4(turn)); }
  // В отливках затенение складок запечено в цвет вершин — рельеф читается и при ровном свете; остальной лепнине — белый, чтобы сетки слились.
  const tone = list => list.map(g => g.attributes.color ? g : g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)));
  const relief = mat({ color: 0xe4cfa4, emissive: 0xe4cfa4, vertexColors: true }, .05, '', true); gilt.vertexColors = true;
  add(mergeGeometries(carved), woodwork); add(mergeGeometries(tone(moulded)), relief); add(mergeGeometries(tone(gilded)), gilt);

  // Всё, кроме стёкол и ленты ламп, заслоняет солнце: свет входит только в окна.
  // Золочёные прутья веерного окна солнце заслоняют: в полдень их веер ложится тенью на заднюю стену и пол галереи.
  const lightOnly = new Set([glass, sides[-1].glass, fanGlass, ringMat, ...Object.values(glareMats)]);
  // sunOnly — только у тех, кто заслоняет: зал включает тень всем помеченным, когда рисует тень солнца, — помеченное стекло
  // заслоняло бы солнце целиком (так и было: в окна светили только лучи в воздухе, а пятен света на стенах не было).
  group.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = !lightOnly.has(o.material); o.userData.sunOnly = o.castShadow; } });

  // Ночью свод едва виден, куполки светятся вполсилы; с верхним светом и днём проступает всё.
  // PASS — как стекло меняет прошедшее солнце: tint — насколько красит своим тоном, clear — пропускание светлого витража (за единицу),
  // dim — насколько темнее свет за тёмным стеклом.
  const glowTint = new THREE.Color(1, 1, 1), FAN_OUT = new THREE.Vector3(0, 0, -1), PASS = { tint: .2, clear: .7, dim: .3 };
  return {
    group, hooks, windows, chandelierY: crown - 2.2,
    // Высота свода над точкой x (поперёк зала), отступив от него внутрь на inset: выше взгляду нельзя.
    roof: (x, inset = 0) => ys + (H - inset) * Math.sqrt(Math.max(0, 1 - (x / (a - inset)) ** 2)),
    // Размеры стёкол — тем, кто собирает для них текстуру (glass.js): боковое окно и веерное.
    glassDims: { side: { hw, rh }, fan: { aspect: H / (2 * a), width: 2 * a } },
    // tint — цвет света, которым сейчас светятся известь, дерево и росписи: вечером — тёплый, от ламп, днём — дневной.
    setLight(v, day = 0, tint = null) {
      if (tint) glowTint.copy(tint);
      for (const [m, base, own] of glow) { m.emissiveIntensity = base * (.35 + v * 2.2 + day * 2.4); m.emissive.copy(own).multiply(glowTint); }
      ringMat.color.setScalar(.55 + v * 1.1);
      U.uBay.value.w = .06 + v * .22;
    },
    // Небо в окнах: цвет неба; окна, в которые смотрит солнце, — ярче и цвета солнца.
    setSky(sky, dir) {
      skyNow = [sky, dir];
      // Солнце в окне только теплит стекло, а не красит его целиком: витраж сохраняет свои цвета. Ореол — от того же света.
      const gray = new THREE.Color(), paint = (m, out, halo, lit = .45) => {
        const sunIn = Math.max(0, dir.dot(out)) * (sky.sun > 0 ? 1 : 0);
        // Тёплая доля — не только в окнах, куда смотрит солнце: при солнце и теневые окна теплеют вполовину (свет рассеян по небу),
        // иначе одно и то же стекло в боковых окнах зеленее и холоднее, чем в веерном.
        m.emissive.copy(sky.sky).lerp(sky.sunColor, Math.min(.45, Math.max(sunIn, Math.min(1, sky.sun / 2.2) * .5) * .7)); m.emissiveIntensity = (.2 + sky.day * 1.35 + sunIn * sky.sun * lit) * (m.userData.gain ?? 1);
        // Ореол на стене — полного цвета неба; а стекло — на треть (GLASS_SKY), остальное — тёплый белый: на закате окно тёплое,
        // но стекло не становится всё одним оранжевым или розовым.
        halo.color.copy(m.emissive).multiplyScalar(sky.day * .16 + sunIn * sky.sun * .05);
        const l = m.emissive.r * .2126 + m.emissive.g * .7152 + m.emissive.b * .0722; m.emissive.lerp(gray.setRGB(l, l * .96, l * .88), 1 - GLASS_SKY);
      };
      // Боковые окна, в которые светит солнце, горят заметно ярче теневых: свет в зал идёт через них. Веерное приглушено (решение пользователя).
      paint(sides[1].glass, sides[1].out, glareMats[1], .75); paint(sides[-1].glass, sides[-1].out, glareMats[-1], .75); paint(fanGlass, FAN_OUT, glareMats.fan);
      SUN.uSunDir.value.copy(dir); SUN.uSunOn.value = Math.min(1, sky.sun / 2.2);
    },
    // Тон карниза — вслед за деревом зала, с тем же лёгким подъёмом.
    setWoodTone(c) { woodwork.color.copy(c).multiply(LIFT); const own = glow.find(g => g[0] === woodwork)[2]; woodwork.emissive.copy(own.copy(woodwork.color)).multiply(glowTint); },
    // Стёкла: side — боковых окон, fan — веерного в торце; текстура снимка или null — нарисованное.
    // gain — сколько света пропускает стекло снимка: простое стекло днём ярче своего снимка, без убавки оно выгорало бы.
    setGlass({ side, fan, sideGain = 1, fanGain = 1 }) {
      for (const m of [sides[1].glass, sides[-1].glass]) { m.map = m.emissiveMap = side ?? painted.side; m.userData.gain = side ? sideGain : 1; m.color.setHex(GLASS_BODY); }
      fanGlass.map = fanGlass.emissiveMap = fan ?? painted.fan; fanGlass.userData.gain = fan ? fanGain : 1; fanGlass.color.setHex(GLASS_BODY);
      // Рельеф стекла — из его снимка (блики ламп); тон — для света, прошедшего сквозь окно.
      for (const [m, t] of [[sides[1].glass, side], [sides[-1].glass, side], [fanGlass, fan]]) {
        const relief = t?.userData.relief ?? null; if (!!m.normalMap !== !!relief) m.needsUpdate = true;
        m.normalMap = relief; m.userData.tone = t?.userData.tone ?? null;
      }
      if (skyNow) this.setSky(...skyNow);
    },
    // Солнце, прошедшее в зал сквозь стёкла: в out — его окраска стеклом тех окон, в которые оно светит (dir — на солнце),
    // возвращается доля прошедшего света. Тёмное зелёное стекло даёт зеленоватый и более слабый свет, чем светлый витраж.
    sunPass(dir, out) {
      let w = 0, k = 0; out.setRGB(0, 0, 0);
      for (const [m, o] of [[sides[1].glass, sides[1].out], [sides[-1].glass, sides[-1].out], [fanGlass, FAN_OUT]]) {
        const s = Math.max(0, dir.dot(o)), t = m.userData.tone; if (!s) continue;
        const top = t ? Math.max(t.r, t.g, t.b, 1e-4) : 1, c = ch => t ? 1 + (t[ch] / top - 1) * PASS.tint : 1;
        out.r += s * c('r'); out.g += s * c('g'); out.b += s * c('b'); k += s * (1 + (Math.min(1, (m.userData.gain ?? 1) / PASS.clear) - 1) * PASS.dim); w += s;
      }
      if (!w) { out.setRGB(1, 1, 1); return 1; }
      out.multiplyScalar(1 / w); return k / w;
    },
    // Другой набор росписей в куполках (с загруженными картинами в images): атлас рисуется заново.
    setArt(set) {
      const next = cupolaAtlas(set, bays, rz / rx, r), was = domeMat.map;
      domeMat.map = domeMat.emissiveMap = next.tex; was?.dispose();
    },
  };
}
