// Папка для листов — кожаная, с тиснёным грифоном: крышка и изнанка сняты с папки Георга Хульбе 1902 года
// (Метрополитен-музей, CC0; как готовились снимки — tools/models/tooled_cover.py). Листы лежат в ней свободно.
// Крышки — картон в коже, у обреза углы скруглены, как у настоящей; корешок круглый.
// Лежит на столе в трёх положениях (`pose`): закрытая лицом вверх (`face`), раскрытая (`open`) и закрытая задней крышкой вверх (`back`);
// закрывается любой крышкой: передняя вместе с левой стопкой ложится на правую, задняя вместе с правой стопкой — через корешок налево.
// Открытая — разворот: справа очередной лист, слева оборот прошлого (сквозь бумагу чуть проступает текст).
// Листы в развороте не плоские: от корешка поднимаются дугой и полого спускаются к краю, как в настоящей книге.
// Лист перелистывается рукой — берёшь в любом месте, эта точка идёт за рукой, лист изгибается и ложится налево.
import * as THREE from 'three';
import { Spring, clamp, sfx, holdSpring, HOLD_MIN, holdSettled } from './util.js';
import { A4, drawPage, drawBack, blankPage, pageMaterial, pageJob, disposeMaterial } from './paper.js';
import { t } from './i18n.js';
import { Label, LABEL_KEY, UNNAMED } from './label.js';

const W0 = .232, AX = .012;
export const BINDER = { w: W0, d: .309, cover: .0045, sheet: .0005, axis: -W0 / 2 + AX, hinge: -W0 / 2 };
const { w: W, d: D, cover: C, sheet: T } = BINDER;
const PW = A4.w, PH = A4.h;
// Ось подшивки — у корешка; от неё лист и отсчитывается.
const AXIS = BINDER.axis, HINGE = BINDER.hinge;
// Где середина того, что лежит на столе, в осях корешка: закрытая — посередине, раскрытая — на корешке, перевёрнутая — там, где лежала левая половина.
// Папка на столе стоит серединой в своём месте (`px`, `pz`), а `body` сдвинут так, чтобы корешок остался на месте, когда положение меняется.
export const CX = { face: 0, open: -W0 / 2, back: -W0 };
export const POSES = Object.keys(CX);
const NU = 28;
const BEV = .0012;

// Дуга открытого листа на расстоянии s от корешка; A — её высота.
export const arch = (s, A) => A * (1 - Math.exp(-s / .014)) * Math.pow(Math.max(0, 1 - s / PW), .7);
// Чем больше листов на стороне, тем выше дуга (и не выше 6,5 мм).
const archOf = n => n > 0 ? Math.min(.0065, .002 + n * T * 1.5) : 0;
// Приподнятый наружный край (лист «ожил»: к нему тянется рука): up — на сколько он выше у самого обреза, нарастает от корешка плавно.
const rise = (s, up) => up * Math.pow(s / PW, 1.8);
// Высоты, на которые край приподнимается: указатель над листом (`hover`) и лист взяли, но ещё не повели (`held`).
export const PERK = { hover: .014, held: .02 };
// Наклон каждой полосы листа в покое.
function restAngles(A, up = 0) {
  const out = new Float32Array(NU), du = PW / NU, h = s => arch(s, A) + (up > 0 ? rise(s, up) : 0);
  for (let i = 0; i < NU; i++) out[i] = Math.atan2(h((i + 1) * du) - h(i * du), du);
  return out;
}

// Лист из полос вдоль ширины: можно изогнуть при перелистывании.
function pageGeometry() {
  const g = new THREE.BufferGeometry(), n = (NU + 1) * 2;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let i = 0; i <= NU; i++) for (let r = 0; r < 2; r++) { const k = i * 2 + r; uv[k * 2] = i / NU; uv[k * 2 + 1] = r ? 0 : 1; pos[k * 3 + 2] = r ? PH / 2 : -PH / 2; }
  for (let i = 0; i < NU; i++) { const a = i * 2, b = a + 2, c = a + 1, d = a + 3; idx.push(a, c, b, b, c, d); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
// w(u) — насколько полоса u уже перевернулась: 0 — лежит справа (дуга Ar), 1 — слева (дуга Al).
// ur, ul — на сколько приподнят наружный край листа справа и слева.
function lay(g, y0, w, Ar, Al, ur = 0, ul = 0) {
  const p = g.attributes.position, du = PW / NU, R = restAngles(Ar, ur), L = restAngles(Al, ul);
  let x = AXIS, y = y0;
  for (let i = 0; i <= NU; i++) {
    if (i) { const k = w((i - .5) / NU), phi = (1 - k) * R[i - 1] + k * (Math.PI - L[i - 1]); x += Math.cos(phi) * du; y += Math.sin(phi) * du; }
    for (let r = 0; r < 2; r++) { const k = i * 2 + r; p.setX(k, x); p.setY(k, y); }
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); if (g.boundingBox) g.computeBoundingBox();   // рамка (её заводит Box3.setFromObject в lightMasks) не должна отставать от формы: луч проверяет её раньше треугольников
}
// Край, за который тянут, опережает корешок: лист выгибается, но никогда не уходит ниже стопки.
const lead = p => 1 - Math.pow(1 - p, 1.7), lag = p => Math.pow(p, 1.7);
const turnShape = (p, dir) => u => { const q = lag(p) + (lead(p) - lag(p)) * Math.pow(u, .8); return dir > 0 ? q : 1 - q; };

// Очерк крышки: у корешка углы почти прямые, у обреза — скруглены, как на снимке. От x = 0 до w.
const RS = .003, RF = .012;
function outline(w, d) {
  const s = new THREE.Shape();
  s.moveTo(RS, -d / 2); s.lineTo(w - RF, -d / 2); s.quadraticCurveTo(w, -d / 2, w, -d / 2 + RF); s.lineTo(w, d / 2 - RF); s.quadraticCurveTo(w, d / 2, w - RF, d / 2);
  s.lineTo(RS, d / 2); s.quadraticCurveTo(0, d / 2, 0, d / 2 - RS); s.lineTo(0, -d / 2 + RS); s.quadraticCurveTo(0, -d / 2, RS, -d / 2);
  return s;
}
// Снимок ложится на вещь сверху вниз, как кожа на картон: верх снимка — дальний край (−z). under — снимок на
// нижней стороне: слева направо он идёт от обреза к корешку и так читается, когда крышка откинута налево.
function photoUV(g, under = false) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / W; uv.setXY(i, under ? 1 - u : u, .5 - p.getZ(i) / D); }
  return g;
}
// Крышка: картон в коже с мягкой фаской. Лежит от x = 0 до W, низ на y = 0.
function boardGeometry() {
  const g = new THREE.ExtrudeGeometry(outline(W - 2 * BEV, D - 2 * BEV), { depth: C - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 3, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(BEV, BEV, 0);
  photoUV(g); g.computeVertexNormals();
  return g;
}
// Кожа изнанки — тем же очерком, вплотную к картону. up — лицом вверх (задняя крышка), иначе вниз (откидная).
function liningGeometry(up) {
  const g = new THREE.ShapeGeometry(outline(W - 2 * BEV, D - 2 * BEV), 6);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(BEV, 0, 0);
  return photoUV(g, !up);
}
// Стопка листов в разрезе: снизу ровно, сверху — та же дуга, что у верхнего листа. side = 1 — справа, −1 — слева.
function stackGeometry(h, A, side) {
  const s = new THREE.Shape(), L = PW - .003, n = 16;
  s.moveTo(0, 0); s.lineTo(side * L, 0);
  for (let i = n; i >= 0; i--) { const x = L * i / n; s.lineTo(side * x, h + arch(x, A)); }
  const g = new THREE.ExtrudeGeometry(s, { depth: PH - .004, bevelEnabled: false, curveSegments: 1 });
  g.translate(AXIS, 0, -(PH - .004) / 2);
  // Обрез: полоска на каждый лист.
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) * 4, p.getY(i) / T);
  return g;
}

// Обрез стопки — тонкие полоски листов.
let edgeTex = null;
function edgeTexture() {
  if (edgeTex) return edgeTex;
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), g = c.getContext('2d');
  g.fillStyle = '#e6dbbf'; g.fillRect(0, 0, 64, 8);
  g.fillStyle = 'rgba(120,96,64,.38)'; g.fillRect(0, 6, 64, 2);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(110,85,55,${(Math.random() * .12).toFixed(3)})`; g.fillRect(Math.random() * 64, Math.random() * 8, 2 + Math.random() * 6, 1); }
  edgeTex = new THREE.CanvasTexture(c); edgeTex.colorSpace = THREE.SRGBColorSpace; edgeTex.wrapS = edgeTex.wrapT = THREE.RepeatWrapping; edgeTex.anisotropy = 8;
  return edgeTex;
}
export class Binder {
  // ctx: { mats: { leather, cover, inside, lining, normal }, sheets: () => листы этой папки по порядку }; data: { id, name, pose, i } — i листов лежит слева
  constructor(data, ctx) {
    Object.assign(this, data); this.ctx = ctx;
    this.pose = POSES.includes(data.pose) ? data.pose : 'face'; this.i = Math.max(0, data.i | 0);
    const { leather, cover: tooled, inside: motto, lining } = ctx.mats;
    this.group = new THREE.Group(); this.group.userData.binder = this;
    this.body = new THREE.Group(); this.body.position.x = -CX[this.pose]; this.group.add(this.body);
    const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; o.userData.binder = this; return o; };
    const board = boardGeometry();
    this.back = mesh(board, leather); this.back.position.x = -W / 2;
    // Корешок — полукруглый, из той же кожи; при раскрытии распрямляется.
    const half = new THREE.CylinderGeometry(1, 1, D - .002, 20, 1, false, Math.PI, Math.PI).rotateX(Math.PI / 2);
    this.spine = mesh(half, leather);
    const edge = this.edgeMat = new THREE.MeshStandardMaterial({ map: edgeTexture(), color: 0xf2ead8, roughness: .95 });
    this.rightStack = mesh(new THREE.BufferGeometry(), edge); this.leftStack = mesh(new THREE.BufferGeometry(), edge);
    this.stackKey = ['', ''];
    // Изнанка: под листами — гладкая кожа, на откидной крышке — кожа с золочёным девизом.
    const backLining = mesh(liningGeometry(true), lining); backLining.position.set(-W / 2, C + .0002, 0); backLining.castShadow = false;
    // Передняя половина — крышка с левой стопкой и верхним листом слева — поворачивается на корешке. Снаружи — тиснёный грифон.
    // Всё, что на ней лежит, построено в осях раскрытой папки; на крышке оно перевёрнуто (поворот на π и сдвиг) и едет вместе с ней.
    this.coverPivot = new THREE.Group(); this.coverPivot.position.x = -W / 2;
    const cover = mesh(board, tooled);
    const inside = mesh(liningGeometry(false), motto); inside.position.y = -.0002; inside.castShadow = false;
    this.coverPivot.add(cover, inside);
    // Ярлык на передней крышке снаружи: едет с ней, а когда крышка откинута, смотрит вниз.
    this.label = LABEL_KEY ? new Label(cover, { W, D, top: C, normal: ctx.mats.normal, seed: data.id ?? 0 }) : null;
    this.label?.group.traverse(o => { o.userData.binder = this; });
    // Ляссе — шёлковая закладка, хвостик выглядывает снизу.
    this.ribbon = mesh(new THREE.PlaneGeometry(.006, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x3e1216, roughness: .55, side: THREE.DoubleSide }));
    this.ribbon.castShadow = false;
    // Верхние листы справа и слева и тот, что перелистывается.
    this.right = new THREE.Mesh(pageGeometry()); this.left = new THREE.Mesh(pageGeometry()); this.turning = new THREE.Mesh(pageGeometry());
    for (const m of [this.right, this.left, this.turning]) { m.visible = false; m.castShadow = m.receiveShadow = true; m.userData.page = true; }
    // Призрак листа: бледная полупрозрачная страница на стопке, куда ляжет лист, который держат над раскрытой папкой (по одному на каждую сторону).
    this.ghosts = [1, -1].map(side => {
      const m = new THREE.Mesh(pageGeometry(), new THREE.MeshBasicMaterial({ color: 0xf2e8d0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      Object.assign(m, { visible: false, side, a: 0, t: 0, renderOrder: 2, raycast: () => {} }); this.body.add(m); return m;
    });
    this.coverPivot.add(this.leftStack, this.left);
    this.leftStack.rotation.z = this.left.rotation.z = Math.PI; this.leftStack.position.set(-W / 2, 0, 0); this.left.position.set(-W / 2, C, 0);
    // Задняя половина — крышка, правая стопка и верхний лист справа — переворачивается на корешке налево, ось (`backHalf`) — по толщине стопок.
    this.backHalf = new THREE.Group(); this.backIn = new THREE.Group(); this.backHalf.add(this.backIn);
    this.rightStack.position.y = C;
    this.backIn.add(this.back, backLining, this.rightStack, this.right);
    this.body.add(this.backHalf, this.spine, this.coverPivot, this.ribbon, this.turning);
    this.openS = new Spring(this.pose === 'face' ? 0 : 1, 34, 10); this.backS = new Spring(this.pose === 'back' ? 1 : 0, 34, 10); this.turnS = new Spring(0, 70, 13);
    this.turn = null; this.cache = new Map(); this.nl = this.nr = 0; this.peeking = this.lock = this.hinting = false;
    // Приподнятость наружного края верхнего листа справа и слева (м): пружины; perkSide — какой из листов сейчас приподнят (0 — никакой).
    this.lifts = [new Spring(0, 150, 14), new Spring(0, 150, 14)]; this.perkSide = 0;
    this.layout(); this.syncLabel();
  }
  get count() { return this.ctx.sheets(this).length; }
  // Что напечатано на ярлыке: название; без названия — первая строка первого листа бледно (или пусто, `?unnamed=empty`).
  get labelText() {
    const n = (this.name || '').trim(); if (n) return { text: n, pale: false };
    if (UNNAMED === 'empty') return { text: '', pale: false };
    return { text: this.ctx.sheets(this)[0]?.lines.find(l => l.trim())?.trim().slice(0, 60) || '', pale: true };
  }
  // Новое название (пустое — снова без названия).
  setName(v) { this.name = (v || '').trim().slice(0, 60) || null; this.syncLabel(); }
  syncLabel() { if (this.label) { const t = this.labelText; this.label.set(t.text, t.pale); } }
  get title() { return this.name || this.ctx.sheets(this)[0]?.lines.find(l => l.trim())?.trim().slice(0, 40) || t('folder.untitled'); }
  // Толщина закрытой папки — чтобы в ящике на неё можно было положить что-то ещё.
  get thickness() { return 2 * C + Math.max(1, this.n ?? this.count) * T; }
  // Высота верха у раскрытой папки: у своей половины (side = 1 — справа, −1 — слева); за краем листов — только крышка.
  openHeight(side) { const n = side > 0 ? this.nr : this.nl; return C + n * T + archOf(n) * .6; }
  // Высота верха над низом папки (`body.y = 0`) в точке (lx, lz) в осях корешка — по настоящей поверхности: у раскрытой — дуга верхнего листа своей стороны,
  // за краем листов — крышка; у закрытой, и пока что-то движется (крышка, перелистываемый лист), — вся толщина. Для листа в руке: ниже этого он не опускается.
  surfaceAt(lx, lz) {
    const moving = !this.openS.resting || !this.backS.resting || !!this.turn;
    let top;
    if (this.pose !== 'open' || moving) top = this.thickness + .001;
    else {
      const side = lx > AXIS ? 1 : -1, s = Math.abs(lx - AXIS), n = side > 0 ? this.nr : this.nl;
      top = n > 0 && s < PW && Math.abs(lz) < PH / 2 ? (side > 0 ? this.rightY : this.leftY) + .0006 + arch(s, side > 0 ? this.archR : this.archL) : C + .0004;
    }
    return Math.max(top, this.lidAt(lx, this.coverPivot.position.y, clamp(this.openS.v, 0, 1) * Math.PI, 0), this.lidAt(lx, this.backHalf.position.y, clamp(this.backS.v, 0, 1) * Math.PI, 1));
  }
  // Высота приподнятой крышки в точке lx (в осях корешка): крышка — доска от корешка (ось на высоте py), повёрнутая на угол c. back — задняя: её наружная
  // сторона на доске снизу, поэтому после поворота она сверху. Закрытая (угол около 0) и откинутая (около π) крышки уже учтены в толщине и стопках — 0.
  lidAt(lx, py, c, back) {
    if (c < .004 || c > Math.PI - .004) return 0;
    const cc = Math.cos(c), sn = Math.sin(c), s = lx - HINGE;
    if (back) { const t = (s - py * sn) / cc; return Math.abs(cc) > .03 && t > -.002 && t < W ? py + t * sn - py * cc : Math.abs(cc) <= .03 && Math.abs(s - py * sn) < C + .004 ? py + W : 0; }
    if (Math.abs(cc) < .03) return Math.abs(s) < C + .004 ? py + W : 0;
    const t = s / cc; return t > -.002 && t < W ? py + C + t * sn : 0;
  }
  // На сколько приподнятая крышка выше закрытой папки (м): обе крышки вращаются на корешке, их свободный край поднимается на W·sin(угла). Лист в руке берёт это в счёт.
  lidRise() { return W * Math.max(Math.sin(clamp(this.openS.v, 0, 1) * Math.PI), Math.sin(clamp(this.backS.v, 0, 1) * Math.PI)); }
  // Раскрыта ли она так, что листы видны (или ещё движется): иначе страницы не строятся и память под них свободна.
  get paged() { return this.pose === 'open' || (!this.peeking && !this.hinting && (!this.openS.resting || !this.backS.resting)); }
  // Стопки, корешок, крышки и закладка — по числу листов и по тому, как раскрыта папка: k — передняя крышка (0 закрыта, 1 откинута),
  // bb — задняя половина (0 на месте, 1 перевёрнута налево).
  layout() {
    const n = this.count, i = clamp(this.i, 0, n), t = this.turn, th = Math.max(T, n * T);
    const nl = this.nl = Math.max(0, i - (t?.dir === -1 ? 1 : 0)), nr = this.nr = Math.max(0, n - i - (t?.dir === 1 ? 1 : 0));
    const k = clamp(this.openS.v, 0, 1), bb = clamp(this.backS.v, 0, 1), flat = this.peeking ? 0 : k * (1 - bb);
    // Дуга листов — только у раскрытой: закрытая или перевёрнутая стопка лежит ровно.
    this.archR = archOf(nr) * flat; this.archL = archOf(nl) * flat;
    this.stack(this.rightStack, 0, nr * T, this.archR, 1);
    this.stack(this.leftStack, 1, nl * T, this.archL, -1);
    // Передняя крышка: закрыта — лежит на стопке (левая стопка висит под ней и ложится на правую), раскрыта — слева, внутренней стороной вверх.
    // Ось идёт по толщине стопок: пока крышка не дошла до вертикали, она выше правой стопки на толщину левой, потом — на толщину правой.
    const c = k * Math.PI;
    // Когда папка закрывается (крышкой или задней половиной), левая стопка сдвигается на ширину поля у корешка — ложится вровень с правой, а не торчит за корешок.
    this.leftStack.position.x = this.left.position.x = -W / 2 + 2 * AX * (1 - k + bb);
    this.coverPivot.rotation.z = c; this.coverPivot.position.y = k < .5 ? C + nr * T + nl * T * Math.cos(c) : C + nr * T * Math.sin(c);
    // Задняя половина: ось посередине между верхами стопок — перевёрнутая правая стопка ложится на левую.
    const yh = C + (nr + nl) * T / 2 + .0001;
    this.backHalf.position.set(HINGE, yh, 0); this.backIn.position.set(-HINGE, -yh, 0); this.backHalf.rotation.z = bb * Math.PI;
    // Корешок: закрытая — круглый, раскрытая — плоская полоска, перевёрнутая — круглый с другой стороны.
    const hs = (2 * C + th) * (1 - k) + k * (C + (C + th) * bb), sx = (.006 * (1 - k) + .0025 * k) * (1 - bb) - .006 * bb;
    this.spine.scale.set(Math.abs(sx) < 1e-4 ? 1e-4 : sx, hs / 2, 1); this.spine.position.set(-W / 2 + .0015, hs / 2, 0);
    // Закладка выходит из-под верхних листов у корешка и ложится хвостиком на стол (перевёрнутая папка прячет её).
    this.ribbon.visible = bb < .02;
    const ry = C + Math.max(nr * T * .5, .0003), rp = this.ribbon.geometry.attributes.position, x0 = AXIS + .03 + k * .02, z0 = PH / 2 - .002, zc = D / 2 + .002;
    for (let j = 0; j <= 6; j++) {
      const t = j / 6, z = z0 + t * .055, y = z < zc ? ry : Math.max(.0004, ry * Math.pow(1 - Math.min(1, (z - zc) / .016), 2)), x = x0 + t * .012;
      for (const r of [0, 1]) { const v = j * 2 + r; rp.setXYZ(v, x + (r ? .003 : -.003), y, z); }
    }
    rp.needsUpdate = true; this.ribbon.geometry.computeVertexNormals(); this.ribbon.geometry.computeBoundingSphere(); if (this.ribbon.geometry.boundingBox) this.ribbon.geometry.computeBoundingBox();
    this.rightY = C + nr * T; this.leftY = C + nl * T;
  }
  // Стопка перестраивается, только если поменялась её высота или дуга.
  stack(m, k, h, A, side) {
    m.visible = h > T * .5; if (!m.visible) return;
    const key = h.toFixed(5) + '|' + A.toFixed(5); if (key === this.stackKey[k]) return;
    this.stackKey[k] = key; m.geometry.dispose(); m.geometry = stackGeometry(h, A, side);
  }
  // ——— Страницы ———
  // Страница листа k: материал с бумагой сразу, буквы допечатываются по кадрам (`pageJob` в paper.js): целиком лист стоил 0,3–0,5 с, и экран на это время вставал.
  // Видимые страницы печатаются первыми, дальше — соседние листы (`warm`).
  mat(k) {
    const sheets = this.ctx.sheets(this);
    if (k < 0 || k >= sheets.length) return null;
    const s = sheets[k];
    let e = this.cache.get(s.id);
    if (!e) {
      // ?pages=sync (и Binder.sync на ходу) — прежний путь, целиком и сразу: для сравнения замеров.
      if (Binder.sync) e = pageMaterial(drawPage(document.createElement('canvas'), s, 1024), drawBack(document.createElement('canvas'), s, 512), this.ctx.mats.normal);
      else { e = pageMaterial(blankPage(1024, s.seed), blankPage(512), this.ctx.mats.normal); pageJob(e, e.map.image, e.userData.back.value.image, s); }
      this.cache.set(s.id, e);
    }
    // Держим под рукой только соседние страницы.
    const near = new Set(sheets.slice(Math.max(0, this.i - 3), this.i + 4).map(x => x.id));
    for (const [id, m] of this.cache) if (!near.has(id)) { disposeMaterial(m); this.cache.delete(id); }
    return e;
  }
  // Страницы вокруг раскрытой — в работу заранее: сначала те, что видны сейчас, потом лист вперёд, назад, дальше вперёд (так обычно и читают).
  warm(vis) {
    if (Binder.sync) return;
    const sheets = this.ctx.sheets(this), i = this.i;
    for (const d of [0, -1, 1, 2, -2, 3, -3]) this.mat(i + d);
    sheets.forEach((s, k) => { const m = this.cache.get(s.id), j = m?.userData.job; if (j) j.pri = vis.includes(k) ? -1 : k >= i ? k - i : i - k - .5; });
  }
  forget() { for (const m of this.cache.values()) disposeMaterial(m); this.cache.clear(); }
  // Положение: 'face', 'open' или 'back'; snap — сразу, без движения крышек. Куда сдвинуть саму папку (серединой), решает тот, кто её ставит (`Folder.go`).
  setPose(pose, snap = false) {
    if (!POSES.includes(pose)) return;
    this.finishTurn(); this.cov = null; this.peeking = this.lock = this.hinting = false; this.ghost(0); this.perk(0, 0, true); this.pose = pose; this.body.position.x = -CX[pose];
    this.openS.t = pose === 'face' ? 0 : 1; this.backS.t = pose === 'back' ? 1 : 0;
    if (snap) { this.openS.set(this.openS.t); this.backS.set(this.backS.t); }
    this.steady(); this.refresh();
  }
  // Пружины крышек — обычные.
  steady() { for (const s of [this.openS, this.backS]) { s.k = 34; s.c = 10; } }
  // Закрытая папка приоткрывает верхнюю крышку на угол a (радианы; 0 — закрывает): так она подсказывает, что сюда можно положить лист, и принимает его.
  // own — приоткрывает тот, кто кладёт лист: пока он занят (`lock`), подсказка крышку не трогает.
  peek(a, own = false) {
    if (this.pose === 'open' || (this.lock && !own)) return;
    this.lock = own && a > 0; this.peeking = a > 0;
    if (a > 0) this.hinting = a <= .1;   // чуть приоткрытая (подсказка, вздрагивание): листов под крышкой не видно, и страницы ради неё не строятся ни при подъёме, ни при закрытии
    if (this.pose === 'face') this.openS.t = a / Math.PI; else this.backS.t = 1 - a / Math.PI;
    if (a > 0) { const s = this.pose === 'face' ? this.openS : this.backS; s.k = 90; s.c = 17; } else this.steady();
    if (!this.peeking) this.refresh();
  }
  // Папка придавлена (на ней пресс-папье или другая папка) — крышка лишь вздрагивает: приоткрывается градуса на четыре и падает обратно.
  jolt() { if (this.pose === 'open' || this.lock) return; this.peek(.1, true); setTimeout(() => this.peek(0, true), 110); }
  // Крышка side (−1 передняя, 1 задняя) раскрытой папки вздрагивает — хотели закрыть, а нельзя: пружину толкает в сторону закрытия, она возвращается.
  shake(side) { if (this.pose !== 'open' || this.lock) return; const s = side < 0 ? this.openS : this.backS; s.vel += side < 0 ? -.6 : .6; }
  // Призрак на стопке справа (side = 1), слева (−1) или никакого (0): плавно появляется и исчезает.
  ghost(side) {
    for (const g of this.ghosts) { g.t = g.side === side ? .25 : 0; if (g.t) this.placeGhost(g); }
  }
  placeGhost(g) { lay(g.geometry, (g.side > 0 ? this.rightY : this.leftY) + .0016, () => g.side > 0 ? 0 : 1, this.archR, this.archL); }
  // Перелистнуть: dir = 1 — вперёд, −1 — назад. Возвращает false, если дальше некуда.
  flip(dir) {
    if (this.pose !== 'open' || this.openS.v < .9 || this.backS.v > .1 || (dir !== 1 && dir !== -1) || this.turn?.held || this.jam?.()) return false;
    if (this.turn) { if (this.turn.dir !== dir) return false; this.finishTurn(); }
    const n = this.count, k = dir > 0 ? this.i : this.i - 1;
    if (k < 0 || k >= n) return false;
    this.perk(0, 0, true);
    this.turn = { dir, k, t0: performance.now() }; this.turnS.set(dir > 0 ? 0 : Math.PI); this.turnS.t = dir > 0 ? Math.PI : 0;
    const hk = this.hold ? holdSpring(this.hold.n++) : null;
    this.turnS.k = hk ? hk[0] : 70; this.turnS.c = hk ? hk[1] : 13;
    if (hk) sfx.play('page', { gain: .5, rate: 1.1 + Math.random() * .15 }); else sfx.play('page', { gain: .8, rate: .95 + Math.random() * .1 });
    this.refresh(); return true;
  }
  // Зажатая стрелка: листы идут один за другим, понемногу быстрее (до 8 в секунду); отпустили — лист в воздухе долетает, остальные стоят.
  holdFlip(dir) {
    if (this.pose !== 'open') return false;
    this.hold = { dir, n: 0 };
    if (!this.turn && !this.flip(dir)) { this.hold = null; return false; }
    return true;
  }
  endHold() { this.hold = null; }
  // Верхний лист справа (side = 1) или слева (−1) приподнимает наружный край на h метров — к нему тянется рука; 0 — всё ложится. snap — сразу, без пружины.
  perk(side, h = PERK.hover, snap = false) {
    this.perkSide = side ? side : 0;
    this.lifts.forEach((s, j) => { const t = side && (side > 0) === (j === 0) ? h : 0; if (snap) s.set(t); else s.t = t; });
    if (snap) this.layLeaves();
  }
  // Верхние листы лежат заново — когда край приподнялся или опустился (страницы и материалы те же).
  layLeaves() {
    const [ur, ul] = this.lifts.map(s => Math.max(0, s.v));
    if (this.right.visible) lay(this.right.geometry, this.rightY + .0004, () => 0, this.archR, this.archL, ur, 0);
    if (this.left.visible) lay(this.left.geometry, this.leftY + .0004, () => 1, this.archR, this.archL, 0, ul);
  }
  // Перелистывание рукой: точка, за которую взяли (на расстоянии r от корешка), идёт за указателем.
  // Взятый лист сразу чуть приподнимается.
  grab(dir, x) {
    if (!this.flip(dir)) return false;
    const t = this.turn; t.held = true; t.r = Math.max(.05, Math.abs(x - AXIS)); t.vel = 0; t.at = performance.now();
    this.turnS.t = dir > 0 ? .07 : Math.PI - .07; return true;
  }
  // x — где указатель над папкой (в осях корешка, `body`).
  drag(x) {
    const t = this.turn; if (!t?.held) return;
    const th = clamp(Math.acos(clamp((x - AXIS) / t.r, -1, 1)), .07, Math.PI - .07), now = performance.now(), dt = Math.max(.008, (now - t.at) / 1000);
    t.vel = t.vel * .5 + (th - this.turnS.t) / dt * .5; t.at = now; this.turnS.t = th;
  }
  // Отпустили: лист ложится туда, куда ближе, с учётом того, как быстро его вели.
  release() {
    const t = this.turn; if (!t?.held) return;
    t.held = false;
    const fresh = performance.now() - t.at < 120, p = this.turnS.t + (fresh ? clamp(t.vel, -12, 12) * .12 : 0);
    const go = t.dir > 0 ? p > Math.PI * .5 : p < Math.PI * .5;
    if (go) this.turnS.t = t.dir > 0 ? Math.PI : 0;
    else { this.turnS.t = t.dir > 0 ? 0 : Math.PI; t.back = true; }
  }
  // Дошёл до конца — перелистнуть (касание без перетаскивания).
  complete() { const t = this.turn; if (!t) return; t.held = false; this.turnS.t = t.dir > 0 ? Math.PI : 0; }
  finishTurn() {
    const t = this.turn; if (!t) return;
    if (!t.back) this.i += t.dir;
    this.turn = null; this.refresh(); this.onTurn?.();
  }
  // ——— Крышки рукой ———
  // Крышку, как и лист, ведёт указатель: она идёт вокруг корешка, пока рука на том же расстоянии от него. side = −1 — передняя (слева), 1 — задняя (справа);
  // x — где указатель над папкой (в осях корешка).
  grabCover(side, x) {
    this.finishTurn();
    this.cov = { side, r: Math.max(.05, Math.abs(x - HINGE)) };
    const s = side < 0 ? this.openS : this.backS; s.k = 110; s.c = 21;
  }
  dragCover(x) {
    const c = this.cov; if (!c) return;
    const a = Math.acos(clamp((x - HINGE) / c.r, -1, 1)) / Math.PI;
    (c.side < 0 ? this.openS : this.backS).t = a;
  }
  // Отпустили: дальше середины — закрывается этой крышкой, нет — возвращается. Отвечает, в каком положении теперь папка.
  dropCover() {
    const c = this.cov; if (!c) return this.pose;
    const a = (c.side < 0 ? this.openS : this.backS).t, pose = c.side < 0 ? (a < .5 ? 'face' : 'open') : (a > .5 ? 'back' : 'open');
    this.cov = null; return pose;
  }
  // Что под лучом у раскрытой папки: лист (side — правой или левой стопки), поле крышки (side — передняя или задняя) или кожа у корешка и по верхнему и
  // нижнему краю (её тянут целиком). x, z — где луч попал, в осях корешка.
  zone(h) {
    const o = h.object, p = this.body.worldToLocal(h.point.clone());
    // Листы лежат почти по всей папке, так что на «кожу» отданы и полоски листа у верхнего и нижнего края, и желобок у корешка.
    const gutter = Math.abs(p.z) > PH / 2 - .012 || Math.abs(p.x - AXIS) < .018;
    const page = o === this.right || o === this.rightStack ? 1 : o === this.left || o === this.leftStack ? -1 : o === this.turning ? (p.x > AXIS ? 1 : -1) : 0;
    if (page) return { part: gutter ? 'skin' : 'page', side: page, x: p.x, z: p.z };
    const side = p.x > HINGE ? 1 : -1, rim = Math.abs(p.z) > PH / 2 - .004 || Math.abs(p.x - HINGE) < .03;
    return { part: rim ? 'skin' : 'cover', side, x: p.x, z: p.z };
  }
  refresh() {
    const n = this.n = this.count;
    this.syncLabel();
    if (this.i > n) this.i = n;
    this.layout();
    if (!this.paged) { for (const m of [this.right, this.left, this.turning]) m.visible = false; if (this.cache.size) this.forget(); return; }
    const t = this.turn;
    const rightK = t?.dir === 1 ? this.i + 1 : this.i, leftK = t?.dir === -1 ? this.i - 2 : this.i - 1;
    const [ur, ul] = this.lifts.map(s => Math.max(0, s.v));
    const show = (mesh, k, w, y) => { const m = this.mat(k); mesh.visible = !!m; if (m) { mesh.material = m; lay(mesh.geometry, y, () => w, this.archR, this.archL, w ? 0 : ur, w ? ul : 0); } };
    show(this.right, rightK, 0, this.rightY + .0004);
    show(this.left, leftK, 1, this.leftY + .0004);
    if (t) { const m = this.mat(t.k); this.turning.visible = !!m; if (m) this.turning.material = m; this.bendTurning(); } else this.turning.visible = false;
    for (const g of this.ghosts) if (g.visible) this.placeGhost(g);
    this.warm([rightK, leftK, ...(t ? [t.k] : [])]);
  }
  bendTurning() {
    const t = this.turn, th = this.turnS.v, k = clamp(th / Math.PI, 0, 1), p = t.dir > 0 ? k : 1 - k;
    // Переворачиваемый лист поднимается со своей стопки, проходит над корешком и ложится на другую.
    // Над корешком лист проходит выше более толстой стопки, чтобы не задеть её.
    const lin = this.rightY * (1 - k) + this.leftY * k, y = lin + .0012 + Math.sin(k * Math.PI) * (Math.max(this.rightY, this.leftY) - lin + .003);
    lay(this.turning.geometry, y, turnShape(p, t.dir), this.archR, this.archL);
  }
  // Возвращает true, пока что-то движется (нужно перерисовать тени).
  update(dt) {
    const covers = !this.openS.resting || !this.backS.resting; if (this.hinting && !covers && !this.peeking) this.hinting = false;
    let moving = covers || (!!this.turn && !this.turnS.resting);
    for (const g of this.ghosts) if (g.a !== g.t) {
      const step = dt / .15 * .25; g.a = g.a < g.t ? Math.min(g.t, g.a + step) : Math.max(g.t, g.a - step);
      g.material.opacity = g.a; g.visible = g.a > .002; moving = true;
    }
    if (covers) { this.openS.step(dt); this.backS.step(dt); this.refresh(); }
    // Край приподнимается и опускается пружиной; пока лист не движется, ничего не пересчитывается.
    if (this.lifts.some(s => !s.resting)) { for (const s of this.lifts) { s.step(dt); if (s.resting) s.set(s.t); } this.layLeaves(); moving = true; }
    if (this.turn) {
      this.turnS.step(dt); this.bendTurning();
      // Лист лёг на глаз — угол в двух сотых радиана от цели и почти стоит: дальше пружина дрожит незаметно, ждать её покоя незачем.
      const ts = this.turnS; if (!this.turn.held && holdSettled(ts, !!this.hold) && (!this.hold || performance.now() - this.turn.t0 >= HOLD_MIN)) { this.finishTurn(); if (this.hold && !this.flip(this.hold.dir)) this.hold = null; }
    }
    return moving;
  }
  // Папка уходит из зала: свои сетки, обрез, ляссе и призраки освобождаются; кожа, крышки и текстура обреза общие — их не трогаем.
  dispose() {
    this.forget(); this.label?.dispose();
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of [this.edgeMat, this.ribbon.material, ...this.ghosts.map(g => g.material)]) m.dispose();
  }
}
Binder.sync = new URLSearchParams(location.search).get('pages') === 'sync';
