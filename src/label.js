// Ярлык на крышке папки: клочок бумаги, наклеенный на кожу, надпись — теми же литерами и оттиском, что у машинки (`typeInk`).
// Место, размер и число строк — в `VARIANTS` (a, b, c); `?label=a|b|c` ставит вариант, `?label=off` — без ярлыка. Положение задано в точках снимка крышки
// (`assets/textures/portfolio-cover.jpg`, 1213 × 1616): папка на столе покрыта этим снимком целиком, так что точка снимка — точка на крышке.
// Холст маленький (не больше 512 × 256 точек по площади) и перерисовывается, только когда поменялась надпись; своих шейдеров у ярлыка нет —
// обычный матовый материал (как у крышки: бумага и карта волокон) и плоская тень-подложка из простого материала без света.
import * as THREE from 'three';
import { typeInk } from './typewriter.js';
import { paperSource } from './paper.js';

const SNAP = { w: 1213, h: 1616 };
// Размеры — в миллиметрах, середина — в точках снимка. rot — на сколько градусов ярлык наклеен криво (по часовой стрелке).
// a — узкая полоска в верхнем поле, поверх рядов ромбов (грифона и щит не задевает); b — карточка в правом нижнем углу, на нижнем поле;
// c — карточка в пустом тёмном углу над щитом: ничего из тиснения не закрывает, но на тёмном поле заметнее всего.
export const VARIANTS = {
  a: { title: 'полоска вверху', cx: 607, cy: 88, w: 100, h: 13, rot: 0, lines: 1 },
  b: { title: 'карточка внизу справа', cx: 1018, cy: 1512, w: 48, h: 25, rot: -1.6, lines: 2 },
  c: { title: 'карточка над щитом', cx: 978, cy: 276, w: 40, h: 26, rot: 1.2, lines: 3 },
};
const Q = new URLSearchParams(location.search).get('label');
export const LABEL_KEY = Q === 'off' ? null : VARIANTS[Q] ? Q : 'a';   // выбор пользователя 2026-11-21 — узкая полоска вверху
// Что напечатать, если у папки нет названия: «pencil» — первая строка первого листа бледно, как карандашом; «empty» — пустой ярлык.
export const UNNAMED = new URLSearchParams(location.search).get('unnamed') === 'empty' ? 'empty' : 'pencil';

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const FONT = 'PT Mono';
const ADV = .6;   // ширина знака в долях кегля — как у машинки
const PAD = 1.9;  // поле от края ярлыка до надписи, мм
const EM_MAX = 6.4, EM_MIN = 2.5;   // кегль, мм: крупнее — не надо, мельче — не прочесть, режем с «…»

// Надпись по строкам: самый крупный кегль, при котором она входит; не входит и мельчайшим — обрезается многоточием.
export function fit(text, innerW, innerH, maxLines) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const wrap = cols => {
    const lines = []; let cur = '';
    for (let w of words) {
      while ([...w].length > cols) { if (cur) { lines.push(cur); cur = ''; } lines.push([...w].slice(0, cols).join('')); w = [...w].slice(cols).join(''); }
      if (!cur) cur = w; else if ([...cur].length + 1 + [...w].length <= cols) cur += ' ' + w; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  for (let em = EM_MAX; em >= EM_MIN - 1e-6; em *= .94) {
    const cols = Math.floor(innerW / (ADV * em)), lh = em * 1.38;
    if (cols < 1) continue;
    const lines = wrap(cols);
    if (lines.length <= maxLines && lines.length * lh <= innerH + em * .2) return { em, lines };
  }
  const em = EM_MIN, cols = Math.max(1, Math.floor(innerW / (ADV * em))), lines = wrap(cols).slice(0, maxLines);
  if (words.length && wrap(cols).length > maxLines || lines.some(l => [...l].length > cols)) { const last = [...lines[lines.length - 1]].slice(0, Math.max(1, cols - 1)).join('').trimEnd(); lines[lines.length - 1] = last + '…'; }
  return { em, lines };
}

// Всё нарисованное в точках на миллиметр d: бумага со снимка листа, потемнение к краю, тонкая линейка, надпись.
function draw(canvas, v, d, text, pale, seed) {
  const W = canvas.width, H = canvas.height, g = canvas.getContext('2d'), rnd = mulberry(seed * 977 + 13);
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
  const paper = paperSource();
  if (paper) {
    // Кусок настоящей бумаги в её же масштабе (лист снят на всю ширину 210 мм), с места, которое зависит от папки.
    const k = paper.width / 210, sw = v.w * k, sh = v.h * k, sx = (.1 + rnd() * .8) * (paper.width - sw), sy = (.12 + rnd() * .76) * (paper.height - sh);
    g.drawImage(paper, sx, sy, sw, sh, 0, 0, W, H);
  } else { g.fillStyle = '#e8dcbc'; g.fillRect(0, 0, W, H); }
  // Ярлык светлее листа: бумага чистая, без пожелтевших краёв. Края чуть темнее — рука, возраст.
  g.fillStyle = 'rgba(255,240,205,.24)'; g.fillRect(0, 0, W, H);
  const edge = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.hypot(W, H) * .56);
  edge.addColorStop(0, 'rgba(120,88,48,0)'); edge.addColorStop(1, 'rgba(120,88,48,.2)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5; i++) { const x = rnd() * W, y = rnd() * H, r = (.4 + rnd() * .9) * d; g.fillStyle = `rgba(150,100,52,${(.05 + rnd() * .07).toFixed(3)})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  // Торец бумаги: верхняя и левая кромки ловят свет, нижняя и правая — в тени.
  g.fillStyle = 'rgba(255,255,250,.5)'; g.fillRect(0, 0, W, Math.max(1, d * .09)); g.fillRect(0, 0, Math.max(1, d * .09), H);
  g.fillStyle = 'rgba(70,48,28,.42)'; g.fillRect(0, H - Math.max(1, d * .1), W, Math.max(1, d * .1)); g.fillRect(W - Math.max(1, d * .1), 0, Math.max(1, d * .1), H);
  // Печатная линейка, чуть неровная по краске.
  g.strokeStyle = 'rgba(48,36,30,.55)'; g.lineWidth = Math.max(1, d * .16);
  const m = 1.15 * d; g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  g.strokeStyle = 'rgba(48,36,30,.22)'; g.lineWidth = Math.max(1, d * .1); g.strokeRect(m + .22 * d, m + .24 * d, W - 2 * m, H - 2 * m);
  if (!text) return;
  const iw = v.w - 2 * PAD, ih = v.h - 2 * PAD, { em, lines } = fit(text, iw, ih, v.lines), lh = em * 1.38, top = (v.h - lines.length * lh) / 2;
  // Название — в два удара по одному месту (литеры бьют по ленте дважды: оттиск плотнее, прочесть можно и издалека); карандашная первая строка — в один и бледная.
  const px = em * d;
  for (let pass = 0; pass < (pale ? 1 : 2); pass++) {
    const r2 = mulberry(seed * 4099 + text.length), ink = pale ? .7 : pass ? .6 : 1;
    lines.forEach((l, i) => {
      const chars = [...l], w = chars.length * ADV * em, x0 = (v.w - w) / 2, y = top + i * lh + lh / 2 + em * .3;
      chars.forEach((ch, j) => { if (ch !== ' ') typeInk(g, ch, (x0 + (j + .5) * ADV * em) * d, y * d, { font: FONT, px, ink, rand: r2 }); });
    });
  }
}

// Мягкая тень под ярлыком — одна на папку, маленькая; без света (MeshBasicMaterial), только затемняет кожу под краем.
function shadowCanvas(wmm, hmm, margin) {
  const k = 12, w = Math.round((wmm + 2 * margin) * k), h = Math.round((hmm + 2 * margin) * k), c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
  const o = 4000; g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = margin * k * .8; g.shadowOffsetX = o; g.fillStyle = '#000';
  g.fillRect(margin * k - o, margin * k, wmm * k, hmm * k);
  return c;
}

const all = new Set();
if (LABEL_KEY) document.fonts?.load(`400 24px "${FONT}"`, 'АаЙй').then(() => { for (const l of all) l.redraw(); }).catch(() => {});

export class Label {
  // parent — крышка (сетка в осях доски: x от корешка, y вверх от низа, верх — на y = top); W, D — её ширина и глубина; normal — карта волокон бумаги листов.
  constructor(parent, { W, D, top, normal, seed, key = LABEL_KEY }) {
    const v = this.v = VARIANTS[key]; this.seed = seed | 0; this.text = ''; this.pale = false; this.shown = null;
    const d = this.d = Math.min(10, Math.sqrt(131072 / (v.w * v.h)));   // точек на миллиметр: холст не больше 512 × 256 по площади
    this.canvas = Object.assign(document.createElement('canvas'), { width: Math.round(v.w * d), height: Math.round(v.h * d) });
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const w = v.w / 1000, h = v.h / 1000;
    let nm = null;
    if (normal) { nm = normal.clone(); nm.wrapS = nm.wrapT = THREE.RepeatWrapping; nm.repeat.set(normal.repeat.x * w / .21, normal.repeat.y * h / .297); nm.needsUpdate = true; }
    // Материал — как у крышки (карта цвета + карта волокон), так что новых шейдеров нет; тон приглушён, чтобы под лампой бумага не выгорала.
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, normalMap: nm, normalScale: new THREE.Vector2(.5, .5), roughness: .94, color: 0xffecd0, envMapIntensity: .3 });
    this.nm = nm;
    this.group = new THREE.Group();
    this.group.position.set(v.cx / SNAP.w * W, top, (v.cy / SNAP.h - .5) * D); this.group.rotation.y = -v.rot * Math.PI / 180;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), this.mat);
    this.mesh.position.y = .0004; this.mesh.receiveShadow = true; this.mesh.userData.label = this;
    // Тень-подложка чуть шире и сдвинута вниз-вправо (свет — слева и сзади).
    const mg = 2.2;
    this.shadowTex = new THREE.CanvasTexture(shadowCanvas(v.w, v.h, mg)); this.shadowTex.colorSpace = THREE.SRGBColorSpace;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, color: 0x000000, transparent: true, opacity: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.shade = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * mg / 1000, h + 2 * mg / 1000).rotateX(-Math.PI / 2), this.shadowMat);
    this.shade.position.set(.0007, .00015, .0009); this.shade.renderOrder = 1; this.shade.raycast = () => {};
    this.group.add(this.shade, this.mesh); parent.add(this.group);
    for (const o of [this.mesh, this.shade]) o.castShadow = false;
    all.add(this); this.redraw();
  }
  // text — что напечатать; pale — бледно, как карандашом.
  set(text, pale = false) {
    text = (text || '').trim(); const key = text + '|' + pale;
    if (key === this.shown) return;
    this.text = text; this.pale = pale; this.redraw();
  }
  redraw() { draw(this.canvas, this.v, this.d, this.text, this.pale, this.seed); this.tex.needsUpdate = true; this.shown = this.text + '|' + this.pale; }
  // Середина ярлыка и два угла (по ширине и по высоте) в мировых осях — по ним поле ввода ложится на ярлык.
  corners(out = []) {
    const w = this.v.w / 2000, h = this.v.h / 2000, m = this.mesh; m.updateWorldMatrix(true, false);
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, z], i) => (out[i] ||= new THREE.Vector3()).set(x, 0, z).applyMatrix4(m.matrixWorld));
  }
  dispose() {
    all.delete(this); this.group.parent?.remove(this.group);
    this.tex.dispose(); this.shadowTex.dispose(); this.mat.dispose(); this.shadowMat.dispose(); this.nm?.dispose(); this.mesh.geometry.dispose(); this.shade.geometry.dispose();
  }
}
