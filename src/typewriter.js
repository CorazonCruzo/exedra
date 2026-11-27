// Модуль взят из прототипов «Концентрации» (concentration, docs/design/prototypes-2026-11-08/typewriter2.js, коммит 4b984ef).
// Пишущая машинка на настоящей модели: «Victorian typewriter», Tijerín Art Studio, CC BY
// (sketchfab.com/3d-models/victorian-typewriter-cbfcb0e1d8c74f02bde4cfa7b92115f9).
// Звуки — записи: удары — Smith-Corona Prestige Auto 12, lonemonk, CC BY 3.0;
// возврат каретки — Work With Sounds, CC BY 4.0; звоночек — _stubb, CC0 (Wikimedia Commons).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { plainImages, fetchSound } from './util.js';
import { PAGE, BOOK, pageLayout, layoutLine, printLine, lineInks, typeInk, bookWidth, justifyXs, mulberry } from './typeink.js';
export { PAGE, BOOK, pageLayout, layoutLine, printLine, lineInks, typeInk };

// ——— Звук: нарезка настоящих записей ———
const STRIKES = [0.098, 0.236, 0.605, 0.754, 1.014, 1.189, 1.313, 1.451, 1.598, 1.874, 1.998, 2.305, 2.468, 3.279, 3.528, 3.768, 3.951, 4.161, 4.324, 4.462, 4.783, 5.095, 5.476, 5.639, 6.086, 6.228, 6.386, 6.707];
export const sound = (() => {
  let ctx, master, buf = {}, on = true, loading;
  const load = base => {
    if (loading) return loading;
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = .9; master.connect(ctx.destination);
    loading = Promise.all(['strikes', 'return', 'bell'].map(n => fetchSound(ctx, `${base}tw-${n}.wav`).then(b => { buf[n] = b; }, e => console.warn(e))));
    return loading;
  };
  const play = (b, offset, dur, { rate = 1, gain = 1 } = {}) => {
    if (!on || !ctx || !b) return;
    if (ctx.state === 'suspended') ctx.resume();
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(master); s.start(0, offset, dur);
  };
  let last = -1;
  const pick = () => { let i; do { i = Math.floor(Math.random() * STRIKES.length); } while (i === last); last = i; return STRIKES[i]; };
  return {
    load,
    get on() { return on; }, set on(v) { on = v; },
    // Разбудить звук в ответ на нажатие — иначе мобильный Safari его не включит.
    wake() { if (ctx?.state === 'suspended') ctx.resume(); },
    strike() { play(buf.strikes, pick(), .12, { rate: .96 + Math.random() * .08, gain: .85 + Math.random() * .3 }); },
    space() { play(buf.strikes, pick(), .12, { rate: .8, gain: .55 }); },
    back() { play(buf.strikes, pick(), .1, { rate: .9, gain: .4 }); },
    ret() { play(buf.return, 0, 1.5, { gain: 1.05 }); },
    bell() { play(buf.bell, 0, 1.05, { gain: 1.1 }); },
    paper() { if (!on || !buf.strikes) return; for (let i = 0; i < 4; i++) setTimeout(() => play(buf.strikes, pick(), .06, { rate: .5, gain: .25 }), i * 70); },
  };
})();

class Spring {
  constructor(v, k = 120, c = 16) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  step(dt) { const n = Math.ceil(dt / .008), h = dt / n; for (let i = 0; i < n; i++) { this.vel += (this.k * (this.t - this.v) - this.c * this.vel) * h; this.v += this.vel * h; } return this.v; }
  set(v) { this.v = this.t = v; this.vel = 0; }
}

// Физические клавиши по рядам (от дальнего к ближнему), слева направо.
const ROWS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];

// Что печатает клавиша при нажатии на модели: по-русски (ЙЦУКЕН) или по-английски — как печатали последним.
const LAYOUTS = {
  ru: { KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н', KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з', BracketLeft: 'х', BracketRight: 'ъ', KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р', KeyJ: 'о', KeyK: 'л', KeyL: 'д', Semicolon: 'ж', Quote: 'э', KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т', KeyM: 'ь', Comma: 'б', Period: 'ю', Slash: '.' },
  en: { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y', KeyU: 'u', KeyI: 'i', KeyO: 'o', KeyP: 'p', BracketLeft: '[', BracketRight: ']', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';', Quote: "'", KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyB: 'b', KeyN: 'n', KeyM: 'm', Comma: ',', Period: '.', Slash: '/' },
};
for (const L of Object.values(LAYOUTS)) { for (let d = 0; d <= 9; d++) L['Digit' + d] = String(d); L.Minus = '-'; L.Equal = '='; }
// С Shift — знаки, как на обычной клавиатуре. Буквы просто становятся заглавными; ъ — Shift + ь (своей клавиши на модели нет).
const SHIFTED = {
  ru: { Digit1: '!', Digit2: '"', Digit3: '№', Digit4: ';', Digit5: '%', Digit6: ':', Digit7: '?', Digit8: '*', Digit9: '(', Digit0: ')', Minus: '—', Equal: '+', Slash: ',', KeyM: 'ъ' },
  en: { Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&', Digit8: '*', Digit9: '(', Digit0: ')', Minus: '_', Equal: '+', BracketLeft: '{', BracketRight: '}', Semicolon: ':', Quote: '"', Comma: '<', Period: '>', Slash: '?' },
};

// Связные куски сетки: каждая клавиша (колпачок со штоком) — отдельный кусок.
// Надпись «Typewriter» на задней стенке в текстуре модели крошечная (≈ 20 × 140 точек на всю стенку) и вблизи расплывалась (её «логотип как-то стал нечётко
// выглядеть», 2026-11-26). Грани с ней (их развёртка — в левом нижнем углу атласа) уходят в свою деталь с текстурой в 8 раз крупнее: лак и золотая рамка — тот же кусок,
// увеличенный, с резкой границей золота по середине перехода; само слово набрано заново шрифтом того же склада (Abril Fatface, OFL) — у исходных 15 точек на букву
// засечек не разобрать, порог рисовал кляксы. Новая развёртка — вторая (uv1), рельеф и шероховатость берутся по прежней.
const LOGO = { text: 'Typewriter', font: 'Abril Fatface', K: 8 };
async function sharpLogo(mesh) {
  const g = mesh.geometry, idx = g.index, uv = g.attributes.uv, img = mesh.material.map?.image; if (!idx || !uv || !img?.width) return;
  const W = img.width, H = img.height, inBox = i => uv.getX(i) < .12 && uv.getY(i) > .78, logo = [], rest = [];
  for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); (inBox(a) && inBox(b) && inBox(c) ? logo : rest).push(a, b, c); }
  if (!logo.length) return;
  let u0 = 1, u1 = 0, v0 = 1, v1 = 0; for (const i of logo) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
  const K = LOGO.K, x0 = Math.max(0, Math.floor(u0 * W) - 2), y0 = Math.max(0, Math.floor(v0 * H) - 2), w = Math.min(W, Math.ceil(u1 * W) + 2) - x0, h = Math.min(H, Math.ceil(v1 * H) + 2) - y0;
  const src = document.createElement('canvas'); src.width = w; src.height = h; const sx = src.getContext('2d'); sx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const goldOf = r => Math.min(1, Math.max(0, (r - 28) / 110));   // лак — красного около 15, золото в тени букв — от 70, на свету — за 200
  // Цвет золота и лака — средние из самого куска; где слово — золото вдали от краёв куска (у краёв — рамка).
  const sp = sx.getImageData(0, 0, w, h).data, gold = [0, 0, 0, 0], lac = [0, 0, 0, 0], m = 21; let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, k = goldOf(sp[i]), o = k > .9 ? gold : k < .05 ? lac : null; if (o) { o[0] += sp[i]; o[1] += sp[i + 1]; o[2] += sp[i + 2]; o[3]++; }
    if (k > .5 && x > m && x < w - m && y > m && y < h - m) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  }
  for (const o of [gold, lac]) for (let j = 0; j < 3; j++) o[j] /= Math.max(1, o[3]);
  const rgb = (c, k = 1) => `rgb(${c.slice(0, 3).map(v => Math.round(Math.min(255, v * k))).join(',')})`;
  const c = document.createElement('canvas'); c.width = w * K; c.height = h * K;
  const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, w * K, h * K);
  const d = cx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const k = goldOf(p[i]), e = Math.min(1, Math.max(0, (k - .22) / .16)), s = e * e * (3 - 2 * e), lit = .82 + .3 * k;
    for (let j = 0; j < 3; j++) p[i + j] = lac[j] + (gold[j] * lit - lac[j]) * s;
  }
  cx.putImageData(d, 0, 0);
  // Слово: в атласе оно идёт вдоль куска (по y) и лежит зеркально — так оно и рисуется: поворот на четверть против часовой и зеркало.
  if (bx1 > bx0) {
    const pad = 2; cx.fillStyle = rgb(lac); cx.fillRect((bx0 - pad) * K, (by0 - pad) * K, (bx1 - bx0 + 2 * pad) * K, (by1 - by0 + 2 * pad) * K);
    try { await document.fonts.load(`100px "${LOGO.font}"`, LOGO.text); } catch {}
    const len = (by1 - by0 + 1) * K, tall = (bx1 - bx0 + 1) * K;
    cx.save(); cx.translate((bx0 + bx1 + 1) / 2 * K, (by0 + by1 + 1) / 2 * K); cx.rotate(-Math.PI / 2); cx.scale(-1, 1);
    cx.font = `100px "${LOGO.font}", Georgia, serif`; const mt = cx.measureText(LOGO.text), fw = mt.width, fh = mt.actualBoundingBoxAscent + mt.actualBoundingBoxDescent;
    cx.scale(len / fw * .94, tall / fh * .9); cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    const base = (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2, gr = cx.createLinearGradient(0, -mt.actualBoundingBoxAscent + base, 0, mt.actualBoundingBoxDescent + base);
    gr.addColorStop(0, rgb(gold, 1.25)); gr.addColorStop(.55, rgb(gold, 1)); gr.addColorStop(1, rgb(gold, .7));
    cx.fillStyle = rgb(lac, .5); cx.fillText(LOGO.text, 1.6, base + 2.4);                  // тень: буквы чуть над лаком
    cx.fillStyle = gr; cx.fillText(LOGO.text, 0, base);
    cx.lineWidth = 1.1; cx.strokeStyle = rgb(gold, .45); cx.strokeText(LOGO.text, 0, base);    // тёмный край, как у тиснения
    cx.restore();
  }
  const g2 = g.clone(), uv1 = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { uv1[i * 2] = (uv.getX(i) * W - x0) / w; uv1[i * 2 + 1] = (uv.getY(i) * H - y0) / h; }
  g2.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)); g2.setIndex(logo); g.setIndex(rest);
  const map = new THREE.CanvasTexture(c); map.flipY = false; map.colorSpace = mesh.material.map.colorSpace; map.channel = 1; map.anisotropy = 8;
  const mat = mesh.material.clone(); mat.map = map;
  const plate = new THREE.Mesh(g2, mat); plate.castShadow = plate.receiveShadow = true; plate.position.copy(mesh.position); plate.quaternion.copy(mesh.quaternion); plate.scale.copy(mesh.scale); mesh.parent.add(plate);
}

// В корпусе модели есть дыры, хоть и не на виду: не закрыт верх стоек (под верхней плитой), верх и подошвы ножек, торцы нижних перекладин (пользователь 2026-11-27:
// «давай все же заделаем, раз заметили»). Ищем дыры — петли рёбер, у которых один треугольник, — и каждую плоскую (кроме подошвы) закрываем заплаткой
// лицом наружу, прочь от стенок у края (и подошвы ножек — машинку можно поднять). Край плоского листа (стенки в той же плоскости) не трогаем — там закрывать нечего. Заплатка в той же развёртке:
// всем её вершинам — одна точка текстуры, самая тёмная рядом с дырой (лак, а не золотая кромка). M — сетка → машинка; возвращает, сколько дыр закрыто.
function capHoles(mesh, M, height) {
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index, img = mesh.material.map?.image; if (!idx || !uv) return 0;
  const id = new Map(), rep = [], vid = i => { const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`; if (!id.has(k)) { id.set(k, rep.length); rep.push(i); } return id.get(k); };
  // Рёбра: сколько у ребра треугольников и третья вершина его треугольника — по ней видно, с какой стороны дыры стенки.
  const edges = new Map();
  for (let t = 0; t < idx.count; t += 3) { const v = [vid(idx.getX(t)), vid(idx.getX(t + 1)), vid(idx.getX(t + 2))]; for (let j = 0; j < 3; j++) { const a = v[j], b = v[(j + 1) % 3], k = a < b ? `${a}_${b}` : `${b}_${a}`, e = edges.get(k); if (e) e.n++; else edges.set(k, { n: 1, o: v[(j + 2) % 3] }); } }
  const adj = new Map(), opp = new Map();
  for (const [k, e] of edges) if (e.n === 1) { const [a, b] = k.split('_').map(Number); opp.set(k, e.o); for (const [p, q] of [[a, b], [b, a]]) { if (!adj.has(p)) adj.set(p, []); adj.get(p).push(q); } }
  const at = x => new THREE.Vector3().fromBufferAttribute(pos, rep[x]).applyMatrix4(M);
  let px = null; if (img?.width) { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 256, 256); px = x.getImageData(0, 0, 256, 256).data; }
  const lum = i => { if (!px) return 0; const p = (Math.min(255, Math.floor(uv.getY(i) * 256)) * 256 + Math.min(255, Math.floor(uv.getX(i) * 256))) * 4; return px[p] + px[p + 1] + px[p + 2]; };
  const verts = [], uvs = [], seen = new Set(), Mi = M.clone().invert(), AX = ['x', 'y', 'z']; let holes = 0;
  // Петли — замкнутые цепочки рёбер; цепочка с двумя концами (край дыры, где одно ребро моделью поделено иначе) замыкается сама.
  const chains = [], walk = s => { const ch = [s]; seen.add(s); let prev = -1, cur = s; for (;;) { const nx = adj.get(cur).find(q => q !== prev && !seen.has(q)); if (nx === undefined) return { ch, closed: adj.get(cur).includes(s) && ch.length > 2 }; ch.push(nx); seen.add(nx); prev = cur; cur = nx; if (adj.get(cur).length !== 2) return { ch, closed: false, end: adj.get(cur).length === 1 }; } };
  for (const s of adj.keys()) if (!seen.has(s) && adj.get(s).length === 1) { const r = walk(s); if (r.end) chains.push(r.ch); }
  for (const s of adj.keys()) if (!seen.has(s) && adj.get(s).length === 2) { const r = walk(s); if (r.closed) chains.push(r.ch); }
  const oppOf = (a, b) => opp.get(a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const loop of chains) {
    if (loop.length < 3) continue;
    const p = loop.map(at), box = new THREE.Box3().setFromPoints(p), size = box.getSize(new THREE.Vector3());
    const ax = AX.find(a => size[a] < height * 1e-3); if (!ax) continue;   // только плоские (кривой проём под клавиши закрыт дном)
    const [u, w] = AX.filter(a => a !== ax), plane = box.max[ax];
    // Стенки у края: в какую сторону от плоскости дыры они уходят. Все в самой плоскости — это край плоского листа, не дыра.
    let inner = 0, far = 0; for (let j = 0; j + 1 < loop.length || (j + 1 === loop.length && adj.get(loop[j]).includes(loop[0])); j++) { const o = oppOf(loop[j], loop[(j + 1) % loop.length]); if (o === undefined) continue; const d = at(o)[ax] - plane; inner += d; far = Math.max(far, Math.abs(d)); }
    if (far < height * 1e-3) continue;
    const out = inner > 0 ? -1 : 1;
    box.expandByScalar(height * .05);
    let best = -1, bl = Infinity; for (let i = 0; i < pos.count; i++) { if (!box.containsPoint(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M))) continue; const l = lum(i); if (l < bl) { bl = l; best = i; } }
    if (best < 0) continue;
    for (const t of THREE.ShapeUtils.triangulateShape(p.map(v => new THREE.Vector2(v[u], v[w])), [])) {
      const [a, b, c] = t.map(k => p[k]); if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))[ax] * out < 0) t.reverse();
      for (const k of t) { verts.push(...p[k].clone().applyMatrix4(Mi).toArray()); uvs.push(uv.getX(best), uv.getY(best)); }
    }
    holes++;
  }
  if (!verts.length) return 0;
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); cg.computeVertexNormals();
  const cap = new THREE.Mesh(cg, mesh.material); cap.castShadow = cap.receiveShadow = true; cap.position.copy(mesh.position); cap.quaternion.copy(mesh.quaternion); cap.scale.copy(mesh.scale); mesh.parent.add(cap);
  return holes;
}

// Передние стойки каретки сверху казались полыми трубами (пользователь 2026-11-27: «верхушки боковых ножек… будто полые»): на их верхние грани
// натянут тот же кусок текстуры, что и на лицевую, — золотой овал-обводка, и сверху он читается как край отверстия. Верхним граням стоек
// (box — где они, в мерках машинки; M — сетка → машинка) даём одну точку текстуры — самую тёмную рядом, ровный лак. Вершины этих граней — свои копии,
// чтобы не сдвинуть рисунок на соседних.
function plainTops(mesh, M, boxes) {
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index, img = mesh.material.map?.image; if (!idx || !uv || !img?.width) return 0;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 256, 256); const px = x.getImageData(0, 0, 256, 256).data;
  const lum = i => { const p = (Math.min(255, Math.floor(uv.getY(i) * 256)) * 256 + Math.min(255, Math.floor(uv.getX(i) * 256))) * 4; return px[p] + px[p + 1] + px[p + 2]; };
  const P = i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M);
  const attrs = Object.entries(g.attributes), add = Object.fromEntries(attrs.map(([k]) => [k, []])), ix = Array.from(idx.array); let n = pos.count, done = 0;
  for (const box of boxes) {
    let best = -1, bl = Infinity; for (let i = 0; i < pos.count; i++) if (box.containsPoint(P(i))) { const l = lum(i); if (l < bl) { bl = l; best = i; } }
    if (best < 0) continue;
    for (let t = 0; t < ix.length; t += 3) {
      const v = [0, 1, 2].map(k => P(ix[t + k])); if (!v.every(p => box.containsPoint(p))) continue;
      const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize(); if (Math.abs(nrm.y) < .5) continue;   // только верх
      for (let k = 0; k < 3; k++) {
        for (const [key, a] of attrs) for (let j = 0; j < a.itemSize; j++) add[key].push(key === 'uv' ? (j ? uv.getY(best) : uv.getX(best)) : a.array[ix[t + k] * a.itemSize + j]);
        ix[t + k] = n++;
      }
      done++;
    }
  }
  if (!done) return 0;
  for (const [key, a] of attrs) { const arr = new a.array.constructor(a.array.length + add[key].length); arr.set(a.array); arr.set(add[key], a.array.length); g.setAttribute(key, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
  g.setIndex(ix);
  return done;
}

function components(geo) {
  const pos = geo.attributes.position, n = pos.count, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`; if (seen.has(k)) union(i, seen.get(k)); else seen.set(k, i); }
  const idx = geo.index;
  if (idx) for (let t = 0; t < idx.count; t += 3) { union(idx.getX(t), idx.getX(t + 1)); union(idx.getX(t), idx.getX(t + 2)); }
  else for (let t = 0; t < n; t += 3) { union(t, t + 1); union(t, t + 2); }
  const comps = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
  return [...comps.values()];
}


export async function createTypewriter({ renderer, url = 'assets/typewriter-victorian.glb', soundBase = 'assets/', fontFamily = 'PT Mono', width = 4.6, paperImage = null, paperPaint = null, face: startFace = 'mono' }) {
  renderer.localClippingEnabled = true;
  sound.load(soundBase);
  const gltf = await plainImages(new GLTFLoader()).loadAsync(url);
  const model = gltf.scene;
  const group = new THREE.Group();
  // Нормализуем: ширина — width, стоит на y = 0, центр по x и z.
  const box0 = new THREE.Box3().setFromObject(model), size0 = box0.getSize(new THREE.Vector3()), c0 = box0.getCenter(new THREE.Vector3());
  const S = width / size0.x;
  const inner = new THREE.Group(); inner.add(model); inner.scale.setScalar(S); inner.position.set(-c0.x * S, -box0.min.y * S, -c0.z * S);
  group.add(inner);
  group.updateMatrixWorld(true);
  const meshes = []; model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; meshes.push(o); } });
  const byMat = name => meshes.filter(m => m.material.name === name);

  // Каретка: валик, линейки и боковины едут вместе.
  const carriage = new THREE.Group(); group.add(carriage);
  // В модели к деталям каретки слиты и неподвижные: задняя стенка с надписью «Typewriter» (в сетке валика) и катушки ленты с шестернями (в «гайках»).
  // Они уезжали с кареткой, и в корпусе открывалась дыра. Туда же слиты механизм звонка, кронштейны внутри боковин и барабан сзади слева —
  // с кареткой они повисали в воздухе. Рама каретки начинается на 63 % высоты машинки; куски, что спускаются ниже 62 %, отделяем — они остаются на корпусе.
  const lowY = size0.y * S * .62;
  for (const m of [...byMat('Rodillo'), ...byMat('Reglas'), ...byMat('Tuercas')]) {
    const g = m.geometry, idx = g.index, low = new Uint8Array(g.attributes.position.count), v = new THREE.Vector3();
    if (idx) for (const ix of components(g)) if (ix.some(i => v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(m.matrixWorld).y < lowY)) for (const i of ix) low[i] = 1;
    const keep = [], stay = [];
    if (idx) for (let t = 0; t < idx.count; t += 3) (low[idx.getX(t)] ? stay : keep).push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    if (stay.length) {
      const body = new THREE.Mesh(g.clone().setIndex(stay), m.material); body.castShadow = body.receiveShadow = true;
      m.parent.add(body); body.position.copy(m.position); body.quaternion.copy(m.quaternion); body.scale.copy(m.scale); g.setIndex(keep);
      if (m.material.name === 'Rodillo') await sharpLogo(body);
    }
    carriage.attach(m);
  }
  const platenBox = new THREE.Box3(); byMat('Rodillo').forEach(m => platenBox.expandByObject(m));
  const toTw = m => new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(m.matrixWorld);
  // Верх передних стоек каретки (обе стороны): около x ±1.8, чуть выше линейки.
  const tops = [1, -1].map(sx => new THREE.Box3(new THREE.Vector3(sx > 0 ? 1.7 : -1.95, 2.74, .05), new THREE.Vector3(sx > 0 ? 1.95 : -1.7, 2.95, .34)));
  for (const m of byMat('Tuercas')) plainTops(m, toTw(m), tops);
  for (const m of byMat('Base_maquina')) capHoles(m, toTw(m), size0.y * S);

  // Клавиши: находим каждую, раскладываем по рядам и даём нажиматься по отдельности.
  const keysMesh = byMat('Teclas')[0];
  const geo = keysMesh.geometry;
  const comps = components(geo);
  const wm = keysMesh.matrixWorld, tmp = new THREE.Vector3();
  let parts = comps.map(ix => {
    const b = new THREE.Box3();
    for (const i of ix) b.expandByPoint(tmp.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(wm));
    return { ix, b, c: b.getCenter(new THREE.Vector3()), s: b.getSize(new THREE.Vector3()) };
  });
  // Колпачок со штоком могут быть разными кусками — склеиваем по положению в плане.
  const keySpacing = width * .065;
  const groups = [];
  parts.sort((a, b) => b.s.x * b.s.z - a.s.x * a.s.z);
  for (const p of parts) {
    const g = groups.find(g => Math.hypot(g.c.x - p.c.x, g.c.z - p.c.z) < keySpacing * .45 && p.s.x < keySpacing * 1.2);
    if (g) { g.ix.push(...p.ix); g.b.union(p.b); } else groups.push({ ix: [...p.ix], b: p.b.clone(), c: p.c.clone(), s: p.s.clone() });
  }
  groups.forEach(g => { g.c = g.b.getCenter(new THREE.Vector3()); g.s = g.b.getSize(new THREE.Vector3()); });
  let aKey = new Float32Array(geo.attributes.position.count).fill(63);
  const press = new Float32Array(64);
  const keyOf = new Map();
  // Пробел — самый широкий кусок; остальные — по рядам.
  const space = groups.reduce((a, b) => (b.s.x > a.s.x ? b : a));
  const caps = groups.filter(g => g !== space && g.s.x < keySpacing * 1.3);
  caps.sort((a, b) => a.c.z - b.c.z);
  const rows = [];
  for (const g of caps) { const r = rows.find(r => Math.abs(r[0].c.z - g.c.z) < keySpacing * .4); if (r) r.push(g); else rows.push([g]); }
  rows.forEach(r => r.sort((a, b) => a.c.x - b.c.x));
  // Маленькие служебные клавиши по краям ряда — не буквы, в раскладку их не берём.
  rows.forEach((r, i) => { const med = [...r].map(g => g.s.x).sort((a, b) => a - b)[r.length >> 1]; rows[i] = r.filter(g => g.s.x > med * .78); });
  const bigRows = rows.filter(r => r.length >= 6).slice(-4);
  let id = 0;
  bigRows.forEach((r, ri) => r.forEach((g, ci) => { const code = ROWS[ri]?.[ci]; g.id = id++; if (code) keyOf.set(code, g.id); for (const i of g.ix) aKey[i] = g.id; }));
  space.id = id++; keyOf.set('Space', space.id); for (const i of space.ix) aKey[i] = space.id;
  // Служебные клавиши тоже нажимаются: RETURN — маленькая слева вверху, две SHIFT — внизу по краям.
  const mapped = new Set(keyOf.values()), rowZ0 = bigRows[0][0].c.z, rowZ1 = bigRows[1][0].c.z;
  for (const g of groups) {
    if (g === space || (g.id !== undefined && mapped.has(g.id))) continue;
    if (g.c.z < rowZ0 - keySpacing * .5 || g.c.z > space.c.z + keySpacing || g.s.x < keySpacing * .3 || g.s.x > keySpacing * 1.6) continue;
    if (g.id === undefined) { if (id >= 63) continue; g.id = id++; for (const i of g.ix) aKey[i] = g.id; }
    keyOf.set(g.c.z < rowZ1 ? 'Enter' : g.c.x < 0 ? 'ShiftLeft' : 'ShiftRight', g.id);
  }
  const codeOf = new Map([...keyOf].map(([c, k]) => [k, c]));
  // Левый SHIFT в модели вынесен вперёд и за рамку, ниже правого. У настоящего Underwood № 5 оба SHIFT — в концах нижнего ряда, вровень с буквами
  // (пользователь 2026-11-27: «странно, что они с правым на разных уровнях»). Ставим его в ряд: колпачок — по глубине и высоте как у Z,
  // и вместе с ним его шток с рычагом (одна деталь) — на ту же глубину. По ширине ряд расставляется ниже, когда рычаги уже привязаны к клавишам,
  // а сам колпачок там же заменяется копией правого.
  {
    const row = bigRows[bigRows.length - 1], z = row[0], sl = groups.find(g => g.id !== undefined && g.id === keyOf.get('ShiftLeft'));
    const lever = sl && parts.find(p => p.s.z > keySpacing * 2 && p.b.max.z > sl.b.min.z && p.b.max.z < sl.b.max.z && p.c.x > sl.b.min.x - keySpacing && p.b.max.x < sl.b.max.x);
    if (sl && lever) {
      const d = new THREE.Vector3(0, z.b.max.y - sl.b.max.y, z.c.z - sl.c.z), wi = wm.clone().invert(), pa = geo.attributes.position;
      for (const i of new Set([...sl.ix, ...lever.ix])) { tmp.fromBufferAttribute(pa, i).applyMatrix4(wm).add(d).applyMatrix4(wi); pa.setXYZ(i, tmp.x, tmp.y, tmp.z); }
      pa.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere();
      sl.b.translate(d); sl.c.add(d); lever.b.translate(d); lever.c.add(d);
    }
  }
  // Шток клавиши с её рычагом — одна деталь сетки: рычаг тянется назад по дну, шток поднимается к колпачку. Чтобы при нажатии двигались не только
  // колпачки, но и штоки (пользователь 2026-11-27), рычаг привязываем к его клавише и поворачиваем вокруг заднего конца: каждая точка опускается
  // на долю хода — у заднего конца ноль, у штока — как колпачок (aW). Клавиша рычага — та, под колпачком которой его передний конец.
  let aW = new Float32Array(geo.attributes.position.count).fill(1);
  {
    const keyed = groups.filter(g => g.id !== undefined && g !== space);
    for (const p of parts) {
      if (p.s.z < keySpacing * 2 || p.b.min.z > rowZ0 - keySpacing * 4 || p.ix.some(i => aKey[i] !== 63)) continue;   // рычаги идут от самой задней оси
      let best = null, bd = keySpacing * .6;
      for (const g of keyed) {
        if (p.c.x < g.b.min.x || p.c.x > g.b.max.x || p.b.min.y > g.b.min.y) continue;
        const dz = Math.max(0, g.b.min.z - p.b.max.z, p.b.max.z - g.b.max.z); if (dz < bd) { bd = dz; best = g; }
      }
      if (!best) continue;
      const z0 = p.b.min.z, span = best.c.z - z0;
      for (const i of p.ix) { aKey[i] = best.id; aW[i] = (tmp.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(wm).z - z0) / span; }
    }
  }
  // Нижний ряд с левым SHIFT — двенадцать клавиш — расставляем заново ровно: шаг как у букв, середина ряда — посередине между боковинами
  // (пользователь 2026-11-27: «кнопка отличается от остальных, и находится она на меньшем расстоянии. справа куча места»). Колпачки едут целиком,
  // штоки — с ними, а рычаги наклоняются вбок вокруг заднего конца (та же доля aW, что и при нажатии).
  {
    const sl = groups.find(g => g.id !== undefined && g.id === keyOf.get('ShiftLeft')), row = bigRows[bigRows.length - 1];
    if (sl && row.length > 2 && !row.includes(sl)) {
      const keysRow = [sl, ...row].sort((a, b) => a.c.x - b.c.x), P = (row[row.length - 1].c.x - row[0].c.x) / (row.length - 1);
      const rc = new THREE.Raycaster(), frame = byMat('Base_maquina'), wallAt = dir => { rc.set(new THREE.Vector3(0, row[0].b.min.y - width * .03, row[0].c.z), new THREE.Vector3(dir, 0, 0)); return rc.intersectObjects(frame, false)[0]?.point.x; };
      const l = wallAt(-1), r = wallAt(1), mid = l !== undefined && r !== undefined ? (l + r) / 2 : (keysRow[0].c.x + keysRow[keysRow.length - 1].c.x) / 2;
      const dx = new Map(keysRow.map((g, i) => [g.id, mid + (i - (keysRow.length - 1) / 2) * P - g.c.x]));
      const wi = wm.clone().invert(), pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) { const d = dx.get(aKey[i]); if (!d) continue; tmp.fromBufferAttribute(pa, i).applyMatrix4(wm); tmp.x += d * aW[i]; tmp.applyMatrix4(wi); pa.setXYZ(i, tmp.x, tmp.y, tmp.z); }
      pa.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere();
      for (const g of keysRow) { const d = dx.get(g.id); g.c.x += d; g.b.translate(new THREE.Vector3(d, 0, 0)); }
      // Колпачок левого SHIFT в модели другой — грубее (59 точек против 123 у правого и у букв), с иным профилем, и рядом с остальными казался меньше
      // (пользователь 2026-11-27: «им бы одинаковыми быть»; у настоящего Underwood оба SHIFT — такие же круглые клавиши). Ставим на его место
      // копию колпачка правого SHIFT — с той же надписью из текстуры; прежние треугольники убираем из индекса.
      const rs = keysRow[keysRow.length - 1], own = new Set(sl.ix), src = new Set(rs.ix), ix = Array.from(geo.index.array), keep = [], add = [];
      for (let t = 0; t < ix.length; t += 3) {
        const tri = ix.slice(t, t + 3);
        if (tri.every(i => own.has(i))) continue;
        keep.push(...tri); if (tri.every(i => src.has(i))) add.push(...tri);
      }
      const verts = [...new Set(add)], at = new Map(verts.map((v, k) => [v, pa.count + k])), shift = sl.c.x - rs.c.x, attrs = Object.entries(geo.attributes);
      for (const [key, a] of attrs) {
        const arr = new a.array.constructor((pa.count + verts.length) * a.itemSize); arr.set(a.array);
        verts.forEach((v, k) => { for (let j = 0; j < a.itemSize; j++) arr[(pa.count + k) * a.itemSize + j] = a.array[v * a.itemSize + j]; });
        if (key === 'position') verts.forEach((v, k) => { tmp.fromBufferAttribute(a, v).applyMatrix4(wm); tmp.x += shift; tmp.applyMatrix4(wi); arr.set(tmp.toArray(), (pa.count + k) * 3); });
        geo.setAttribute(key, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
      const n0 = aKey.length, grow = a => { const b = new Float32Array(n0 + verts.length); b.set(a); return b; };
      aKey = grow(aKey); aW = grow(aW); for (let k = 0; k < verts.length; k++) { aKey[n0 + k] = sl.id; aW[n0 + k] = 1; }
      geo.setIndex([...keep, ...add.map(i => at.get(i))]); geo.computeBoundingBox(); geo.computeBoundingSphere();
    }
  }
  // Днище: у модели под клавишами пусто, и между ними виден стол. У настоящей там рычаги и тёмное нутро — кладём тёмную пластину под штоки клавиш.
  // По ширине — только буквенные ряды и пробел: RETURN вынесен за рамку (и левый SHIFT был, пока его не поставили в ряд), по ним пластина вылезала слева. Дальше она подрезается по самой рамке
  // (её «обложка заезжает за края машинки», 2026-11-26): лучами изнутри — до боковых стенок и до переднего бортика, а высотой — чуть ниже его верха, чтобы край прятался за ним.
  const keyBox = new THREE.Box3(); for (const g of [...bigRows.flat(), space]) keyBox.union(g.b);
  let fx0 = keyBox.min.x - keySpacing * .15, fx1 = keyBox.max.x + keySpacing * .15, fz0 = rowZ0 - keySpacing * 2.6, fz1 = space.c.z + keySpacing * .6, fy = keyBox.min.y - width * .004;
  // Рычаги нижнего ряда спереди спускаются ниже колпачков: пластина шла поверх их концов, и штоки уходили в неё («у левого шифта утонула ножка», 2026-11-27).
  // Кладём её чуть ниже самой низкой точки клавиш над ней.
  for (let i = 0; i < geo.attributes.position.count; i++) { tmp.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(wm); if (tmp.x > fx0 && tmp.x < fx1 && tmp.z > fz0 && tmp.z < fz1) fy = Math.min(fy, tmp.y - width * .004); }
  {
    const frame = byMat('Base_maquina'), rc = new THREE.Raycaster(), cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
    const hit = (o, d) => { rc.set(o, d); return rc.intersectObjects(frame, false)[0]?.point ?? null; };
    for (let k = 1; k < 10; k++) for (const dy of [.004, .017]) {
      const o = new THREE.Vector3(cx, fy + width * dy, fz0 + (fz1 - fz0) * k / 10), l = hit(o, new THREE.Vector3(-1, 0, 0)), r = hit(o, new THREE.Vector3(1, 0, 0));
      if (l && l.x > fx0) fx0 = l.x + width * .002; if (r && r.x < fx1) fx1 = r.x - width * .002;
    }
    const f = hit(new THREE.Vector3(cx, fy - width * .0065, cz), new THREE.Vector3(0, 0, 1));
    if (f && f.z < fz1) {
      fz1 = f.z - width * .002;
      const top = hit(new THREE.Vector3(cx, fy + width, f.z + width * .007), new THREE.Vector3(0, -1, 0)); if (top && top.y < fy + width * .002) fy = Math.min(fy, top.y - width * .002);
    }
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: .85, metalness: .2 }));
  floor.position.set((fx0 + fx1) / 2, fy, (fz0 + fz1) / 2); floor.receiveShadow = true; group.add(floor);
  geo.setAttribute('aKey', new THREE.BufferAttribute(aKey, 1)); geo.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
  // Направление «вниз» в координатах сетки и ход клавиши.
  const invRot = new THREE.Matrix3().setFromMatrix4(wm).invert();
  const down = new THREE.Vector3(0, -1, 0).applyMatrix3(invRot);
  const travel = width * .012 / new THREE.Vector3().setFromMatrixScale(wm).y;
  const keyU = { uPress: { value: press }, uDown: { value: down.normalize().multiplyScalar(travel) } };
  keysMesh.material = keysMesh.material.clone();
  keysMesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, keyU);
    sh.vertexShader = 'attribute float aKey; attribute float aW; uniform float uPress[64]; uniform vec3 uDown;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uDown * uPress[int(aKey + .5)] * aW;');
  };
  const keySprings = Array.from({ length: 64 }, () => new Spring(0, 900, 30));

  // Литера: тонкий рычаг взлетает из корзины к валику.
  // Сам валик ищем по геометрии: в разрезе это окружность, через которую проходит больше всего вершин узла.
  const pb = platenBox, cx = (pb.min.x + pb.max.x) / 2;
  const pts = [];
  for (const m of byMat('Rodillo')) {
    const pa = m.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld); if (Math.abs(v.x - cx) < (pb.max.x - pb.min.x) * .35) pts.push(v); }
  }
  let best = { n: 0 };
  for (let r0 = width * .02; r0 < width * .16; r0 += width * .002) {
    for (const p of pts) {
      // Кандидат: центр на расстоянии r0 позади точки на той же высоте.
      const c = { y: p.y, z: p.z - r0 };
      let n = 0;
      for (const q of pts) if (Math.abs(Math.hypot(q.y - c.y, q.z - c.z) - r0) < r0 * .03) n++;
      if (n > best.n) best = { n, r: r0, y: c.y, z: c.z };
    }
    if (pts.length > 600) break;
  }
  const r = best.r;
  const platenC = new THREE.Vector3(cx, best.y, best.z);
  // Строка печати — на самом верху валика: только что напечатанное сразу видно.
  const printAt = platenC.clone().add(new THREE.Vector3(0, r * 1.0, r * .06));
  const strikeAt = printAt.clone().add(new THREE.Vector3(0, width * .13 * Math.cos(-.36), width * .13 * Math.sin(-.36)));
  // Литерные рычаги стоят веером по дуге корзины, у каждой буквы свой; все сходятся в точке удара.
  // Рычаг — тонкая стальная полоса, на конце литера (брусочек), которой бьют по ленте.
  // Корзина — дуга перед валиком и ниже строки; рычаги взлетают из неё к строке печати.
  // Строка поднята над валиком (чтобы её было видно), поэтому рычаги идут спереди, поверх валика, а не сквозь него.
  const basket = strikeAt.clone().add(new THREE.Vector3(0, -width * .13, width * .22)), arcR = width * .16;
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, metalness: 1, roughness: .22 }), slugMat = new THREE.MeshStandardMaterial({ color: 0x8d8a82, metalness: 1, roughness: .3 });
  const leverGeo = new THREE.BoxGeometry(width * .0035, 1, width * .008); leverGeo.translate(0, .5, 0);
  const slugH = width * .02, slugGeo = new THREE.BoxGeometry(width * .011, slugH, width * .012);
  // Несколько рычагов по кругу: при быстрой печати следующий взлетает, пока прошлый ещё падает.
  const Y = new THREE.Vector3(0, 1, 0);
  const bars = Array.from({ length: 4 }, () => {
    const g = new THREE.Group(), lever = new THREE.Mesh(leverGeo, steel), slug = new THREE.Mesh(slugGeo, slugMat);
    g.add(lever, slug); g.visible = false; group.add(g);
    return { g, lever, slug, swing: new Spring(0, 1300, 34), qRest: new THREE.Quaternion(), qHit: new THREE.Quaternion(), posed: false };
  });
  let nextBar = 0;
  // Место рычага на дуге — по положению клавиши: левые буквы слева, правые справа, ряды чуть смещены.
  const xs = groups.filter(g => g.id !== undefined).map(g => g.c.x), kx0 = Math.min(...xs), kx1 = Math.max(...xs);
  const phiOf = new Map(groups.filter(g => g.id !== undefined).map(g => [g.id, ((g.c.x - kx0) / (kx1 - kx0 || 1) - .5) * 2.1 + ((g.c.z * 37) % 1) * .06]));
  function aimBar(code) {
    for (const b of bars) if (b.posed) { b.posed = false; b.swing.set(0); }
    const b = bars[nextBar++ % bars.length];
    const phi = phiOf.get(keyOf.get(code)) ?? 0, k = 1 - Math.cos(phi);
    const pv = basket.clone().add(new THREE.Vector3(Math.sin(phi) * arcR, -k * arcR * .55, -k * arcR * .25));
    const to = strikeAt.clone().sub(pv), len = to.length() - slugH / 2; to.normalize();
    b.g.position.copy(pv); b.lever.scale.y = len; b.slug.position.y = len;
    // В покое рычаг лежит в корзине — к печатающему, чуть вниз и наружу; в удар взлетает через вертикаль, как у настоящей машинки.
    b.qRest.setFromUnitVectors(Y, new THREE.Vector3(Math.sin(phi) * .45, -.22, .86).normalize());
    b.qHit.setFromUnitVectors(Y, to);
    return b;
  }

  // Лист: выходит из-за валика вверх, наклонён назад; ниже строки печати — спрятан.
  const PW = width * .62, PH = PW * 1.414, CWp = PAGE.W, CHp = PAGE.H;
  const { LM, TOP, LINE, COLS } = PAGE, LIFT = width * .13;
  const pageC = document.createElement('canvas'); pageC.width = CWp; pageC.height = CHp;
  const pg = pageC.getContext('2d');
  const charPx = (CWp - LM * 2) / COLS, LINES = Math.floor((CHp - TOP - PAGE.BOTTOM) / LINE);
  const pageT = new THREE.CanvasTexture(pageC); pageT.colorSpace = THREE.SRGBColorSpace; pageT.anisotropy = 8;
  const tilt = -.36;
  const up = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
  const clip = new THREE.Plane();
  // Холст страницы — обычная текстура листа: залит цветом бумаги, буквы поверх.
  const PAPER = '#f3ecdc';
  const paperMat = new THREE.MeshStandardMaterial({ map: pageT, roughness: .95, side: THREE.DoubleSide, clippingPlanes: [clip] });
  const paperGeo = new THREE.PlaneGeometry(PW, PH, 1, 1); paperGeo.translate(0, -PH / 2, 0);
  const paper = new THREE.Mesh(paperGeo, paperMat); paper.castShadow = true; paper.receiveShadow = true;
  paper.rotation.x = tilt; paper.visible = false; carriage.add(paper);

  // Печать. Строка — ряд оттисков; у каждого своё место, ширина, шрифт и «случай» (seed),
  // поэтому строку можно перепечатать один в один: при выключке, Backspace и переносе на новый лист.
  const fontPx = Math.round(charPx / .6), W = CWp - LM * 2;
  const FACES = { mono: { family: fontFamily, px: fontPx }, book: { family: BOOK.family, px: BOOK.px } };
  const tallPx = Math.max(fontPx, BOOK.px);
  // Стирать с запасом: у оттиска есть ореол, обводка и бледный второй удар.
  const pad = Math.max(3, tallPx * .15);
  let face = FACES[startFace] ? startFace : 'mono';
  const advance = ch => face === 'mono' ? charPx : bookWidth(ch, BOOK.px);
  const newRow = (x0 = 0) => ({ chars: [], x0, soft: false, belled: false });
  const rowEnd = r => r.chars.length ? r.chars[r.chars.length - 1].x + r.chars[r.chars.length - 1].w : r.x0;
  const rowText = r => r.chars.map(c => c.ch).join('');
  const rowBook = r => (r.chars.find(c => c.ch !== ' ')?.f ?? 'mono') === 'book';
  // Формат строки для хозяина страницы — чтобы лист со стола перепечатался так же (см. layoutLine).
  const fmtOf = r => { const fs = r.chars.map(c => c.f[0]).join(''); return (rowBook(r) ? 'b' : '') + (r.soft ? 's' : '') + (r.x0 ? 'i' : '') + (/m/.test(fs) && /b/.test(fs) ? '|' + fs : ''); };
  const firstRow = () => newRow(face === 'book' ? BOOK.px * BOOK.indent : 0);
  // active — машинка слушает клавиши; loaded — в каретке стоит лист (он остаётся, когда от машинки отошли).
  let line = 0, prows = [firstRow()], pages = [], active = false, loaded = false, onEnd = null, onPage = null;
  const carX = new Spring(0, 900, 26), feed = new Spring(0, 150, 18), paperOut = new Spring(0, 60, 12);
  // Каретка ставит под удар место следующего знака.
  const posX = px => PW / 2 - (LM + px) / CWp * PW;
  const aim = () => { carX.t = posX(rowEnd(prows[prows.length - 1]) + (face === 'mono' ? charPx / 2 : BOOK.px * .25)); };
  const placeLine = () => { feed.t = TOP / CHp * PH + line * LINE / CHp * PH; };
  const feedFrom = below => { placeLine(); const t = feed.t; feed.set(t - below); feed.t = t; };
  // Бумага листа, что сейчас в машинке, — на своём холсте: с неё лист начинается, и ею же закрывается место стёртой буквы.
  // paperPaint(g, W, H, seed) рисует бумагу со случайными приметами по числу листа (seed) — оно уходит с листом к хозяину страницы;
  // иначе — свой снимок (paperImage) или ровный цвет с зерном.
  const sheetC = document.createElement('canvas'); sheetC.width = CWp; sheetC.height = CHp;
  const sg = sheetC.getContext('2d');
  let pageSeed = 0;
  function clearPage(seed = (Math.random() * 1e6) | 0) {
    pageSeed = seed;
    if (paperPaint) paperPaint(sg, CWp, CHp, seed);
    else if (paperImage) sg.drawImage(paperImage, 0, 0, CWp, CHp);
    else {
      sg.fillStyle = PAPER; sg.fillRect(0, 0, CWp, CHp);
      // Лёгкое зерно бумаги.
      for (let i = 0; i < 9000; i++) { sg.fillStyle = `rgba(120,100,70,${(Math.random() * .05).toFixed(3)})`; sg.fillRect(Math.random() * CWp, Math.random() * CHp, 1 + Math.random() * 2, 1); }
    }
    pg.drawImage(sheetC, 0, 0); pageT.needsUpdate = true;
  }
  const erase = (x, y, w, h) => { pg.drawImage(sheetC, x, y, w, h, x, y, w, h); pageT.needsUpdate = true; };
  const eraseSpan = (i, x0, x1) => erase(LM + x0 - pad, TOP + i * LINE - tallPx * 1.05, x1 - x0 + pad * 2, tallPx * 1.5);
  let struck = 0;
  function inkChar(c, i) {
    if (c.ch === ' ' || bulk) return;   // вставка (`paste`) сперва раскладывает текст, печатает потом
    const F = FACES[c.f];
    typeInk(pg, c.ch, LM + c.x + c.w / 2, TOP + i * LINE + c.dy, { font: F.family, px: F.px, ink: c.ink, rand: mulberry(c.seed) });
    pageT.needsUpdate = true;
  }
  const reprint = i => { if (bulk) return; eraseSpan(i, -pad, W + pad); prows[i].chars.forEach(c => inkChar(c, i)); };
  // Новый оттиск в конце текущей строки; strike = false — пока не печатать (ждёт новый лист).
  function addChar(ch, strike = true, f = face) {
    const r = prows[prows.length - 1], was = face; face = f;
    const c = { ch, f, w: advance(ch), x: rowEnd(r), dy: (Math.random() - .5) * 2.4, seed: (Math.random() * 2 ** 32) >>> 0, ink: Math.max(.62, .96 - ++struck / 9000) };
    face = was; r.chars.push(c);
    if (strike) inkChar(c, prows.length - 1);
    return c;
  }
  // Выключка: перенесённая книжная строка ровно доходит до правого поля.
  function justify(i) {
    const r = prows[i];
    while (r.chars.length && r.chars[r.chars.length - 1].ch === ' ') r.chars.pop();
    if (!rowBook(r) || !r.chars.length) return;
    const chars = r.chars.map(c => c.ch), xs = r.chars.map(c => c.x);
    justifyXs(chars, xs, r.chars.map(c => c.w), W);
    if (xs.every((x, k) => x === r.chars[k].x)) return;
    r.chars.forEach((c, k) => { c.x = xs[k]; });
    reprint(i);
  }
  function pressKey(code) { const k = keyOf.get(code); if (k !== undefined) keySprings[k].vel = 34; }
  // Смена листа — один шаг: пока лист выходит и новый заправляется, машинка ждёт, нажатое копится.
  // turning: 0 — печатаем; 1 — строки кончились, лист вот-вот выйдет; 2 — лист вышел, новый ещё не заправлен.
  let turning = 0, session = 0, pendingKeys = [];
  // bulk — идёт вставка: листы меняются сразу (`bulkTurn`), заполненные копятся в bulkPages.
  let bulk = false, bulkPages = [];
  // Сколько листов вышло из каретки за этот подход к машинке (с `begin`): вставка на первый лист — в подшивку, на следующие — на стол (room.js, `pasteTyped`).
  let sheetsOut = 0;
  // soft — строку перенесла сама машинка (её выровнять); иначе это Enter, и новый абзац в книжном наборе — с отступа.
  function carriageReturn(soft = false) {
    sound.ret();
    const i = prows.length - 1;
    prows[i].soft = soft;
    if (soft) justify(i);
    prows.push(newRow(!soft && face === 'book' ? BOOK.px * BOOK.indent : 0)); line++; aim(); placeLine();
    if (line >= LINES && !turning) { if (bulk) return bulkTurn(); turning = 1; const sess = session; setTimeout(() => newSheet(sess), 600); }
  }
  // Снимок страницы — чтобы вынутый лист можно было положить на стол.
  const snapshot = () => { const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * CHp / CWp); c.getContext('2d').drawImage(pageC, 0, 0, c.width, c.height); return c; };
  // Лист выходит: заполненное отдаём хозяину страницы (пустое не нужно), перенос ждёт новый лист.
  function deliverPage() {
    sound.paper();
    const done = prows.slice(0, LINES), carry = prows.slice(LINES), lines = done.map(rowText);
    if (lines.join('').trim()) { pages.push(lines.join('\n')); sheetsOut++; onPage?.(snapshot(), lines, done.map(fmtOf), pageSeed); }
    prows = carry.length ? carry : [newRow()]; line = prows.length - 1; turning = 2; paperOut.t = 1;
  }
  // Смена листа при вставке: тот же раздел строк, что у `deliverPage`, только сразу и без снимка.
  function bulkTurn() {
    const done = prows.slice(0, LINES), carry = prows.slice(LINES), lines = done.map(rowText);
    if (lines.join('').trim()) bulkPages.push({ lines, fmt: done.map(fmtOf), seed: pageSeed });
    prows = carry.length ? carry : [newRow()]; line = prows.length - 1; pageSeed = (Math.random() * 1e6) | 0;
  }
  // Новый лист заправлен: печатаем перенос, потом всё, что нажали за время смены, — сразу и по порядку.
  function feedPage() {
    clearPage(); paper.visible = true; paperOut.set(0); feedFrom(1.4);
    prows.forEach((r, i) => r.chars.forEach(c => inkChar(c, i))); aim();
    turning = 0;
    const q = pendingKeys.splice(0);
    if (!q.length) return;
    const loud = sound.on; sound.on = false;
    const now = face;
    try { for (const k of q) { face = k.face ?? now; onKey(k); } } finally { sound.on = loud; face = now; }
    if (loud) sound.strike();
  }
  function newSheet(sess) {
    // Лист успели вынуть раньше или это уже другой сеанс — ничего не делаем.
    if (!active || sess !== session) return;
    deliverPage();
    setTimeout(() => { if (active && sess === session && turning === 2) feedPage(); }, 750);
  }
  // Знак не влез: последнее слово переезжает на новую строку, эта — выравнивается.
  function wrapWord() {
    const r = prows[prows.length - 1];
    let k = r.chars.length; while (k > 0 && r.chars[k - 1].ch !== ' ') k--;
    const word = k > 0 && r.chars.length - k < 20 ? r.chars.splice(k) : [];
    if (word.length) eraseSpan(prows.length - 1, word[0].x, W + pad);
    carriageReturn(true);
    for (const c of word) addChar(c.ch, !turning, c.f);
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); return leave(); }
    if (turning) {
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey || e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); if (pendingKeys.length < 80) pendingKeys.push({ key: e.key, code: e.code, face, tapped: e.tapped, metaKey: false, ctrlKey: false, preventDefault() {} }); }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); pressKey('Enter'); return carriageReturn(false); }
    if (e.key === 'Shift') { pressKey(e.code); return; }
    const r = prows[prows.length - 1], i = prows.length - 1;
    if (e.key === 'Backspace') {
      e.preventDefault();
      // Знак убираем, а строку перепечатываем целиком: оттиски воспроизводятся один в один, соседи не страдают.
      if (r.chars.pop()) { reprint(i); aim(); sound.back(); return; }
      // Строка пуста — бумага вкручивается назад, каретка встаёт в конец прошлой строки.
      // Так не бывает у настоящей машинки, но и стирания у неё нет.
      if (i > 0) {
        prows.pop(); line--;
        const prev = prows[i - 1];
        if (prev.soft) { let x = prev.x0; for (const c of prev.chars) { c.x = x; x += c.w; } prev.soft = false; reprint(i - 1); }
        prev.belled = rowEnd(prev) > W - charPx * 6;
        placeLine(); aim(); sound.paper();
      }
      return;
    }
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (!e.tapped) { unshift(); if (/\p{L}/u.test(e.key)) layout = /[а-яё]/i.test(e.key) ? 'ru' : 'en'; }
    const over = rowEnd(r) + advance(e.key) > W + .5;
    // Пробел на краю строки — просто перевод каретки, без лишнего отступа.
    if (over && e.key === ' ') return carriageReturn(true);
    if (over) wrapWord();
    // Перенос пришёлся на последнюю строку: буква уйдёт на новый лист вместе со словом.
    if (turning) { pressKey(e.code); sound.strike(); addChar(e.key, false); return; }
    if (e.key === ' ') { pressKey('Space'); sound.space(); addChar(' ', false); }
    else { pressKey(e.code); if (!bulk) aimBar(e.code).swing.t = 1; sound.strike(); addChar(e.key); }
    aim();
    const cur = prows[prows.length - 1];
    if (!cur.belled && rowEnd(cur) > W - charPx * 6) { cur.belled = true; if (!bulk) setTimeout(() => sound.bell(), 80); }
  }
  // Клавиши, нажатые в поле ввода страницы, — не машинке (бегунок не мешает печатать).
  addEventListener('keydown', e => { if (!e.target.closest?.('input:not([type=range]), textarea, select, [contenteditable]')) onKey(e); });
  // Нажатия по клавишам на самой модели — печатают то же, что и клавиатура.
  let layout = 'ru', shiftOnce = false;
  const synth = (key, code) => ({ key, code, tapped: true, metaKey: false, ctrlKey: false, preventDefault() {} });
  const holdShift = v => { for (const c of ['ShiftLeft', 'ShiftRight']) { const k = keyOf.get(c); if (k !== undefined) keySprings[k].t = v; } };
  const unshift = () => { if (shiftOnce) { shiftOnce = false; holdShift(0); } };
  // Начало предложения — с заглавной: на модели нет второй руки, чтобы держать Shift.
  // Закрывающие кавычки и скобки не мешают: «…светится.»» — дальше снова с заглавной.
  const ends = ch => '.!?…'.includes(ch), closing = ch => ch === ' ' || '»")]\''.includes(ch);
  function sentenceStart() {
    // Сначала то, что нажато, пока менялся лист, — оно ещё не на бумаге.
    for (let k = pendingKeys.length - 1; k >= 0; k--) {
      const key = pendingKeys[k].key;
      if (key === 'Enter') return true;
      if (key === 'Backspace') break;
      if (!closing(key)) return ends(key);
    }
    for (let i = prows.length - 1; i >= 0; i--) {
      // Строка выше закрыта Enter — это новый абзац.
      if (i < prows.length - 1 && !prows[i].soft) return true;
      const cs = prows[i].chars;
      for (let k = cs.length - 1; k >= 0; k--) if (!closing(cs[k].ch)) return ends(cs[k].ch);
    }
    return true;
  }
  function tap(code) {
    if (!active) return false;
    if (code === 'ShiftLeft' || code === 'ShiftRight') { shiftOnce = !shiftOnce; holdShift(shiftOnce ? .55 : 0); sound.back(); return true; }
    if (code === 'Enter') { onKey(synth('Enter', 'Enter')); return true; }
    if (code === 'Space') { onKey(synth(' ', 'Space')); return true; }
    let ch = LAYOUTS[layout][code];
    if (!ch) return false;
    if (shiftOnce) { ch = SHIFTED[layout][code] ?? ch.toUpperCase(); unshift(); }
    else if (/\p{L}/u.test(ch) && sentenceStart()) ch = ch.toUpperCase();
    onKey(synth(ch, code));
    return true;
  }
  // Вставка (пользователь 2026-11-25: вставить текст и сразу получить распечатку по порядку в подшивке, «как самиздат»). Текст печатается мгновенно, будто его набрали
  // на клавиатуре этим же шрифтом: тот же перенос слов, выключка, абзацы по Enter и смена листов, только без звуков ударов и без ожидания.
  // Заполненные листы (первый — тот, что был в каретке, с уже набранным) отдаются по порядку: { pages: [{ lines, fmt, seed }], cut }; последний недопечатанный остаётся
  // в каретке, каретка — в конце вставленного (пользователь 2026-11-25: «вставил что-то и дальше пишешь»). max — сколько листов самое большее; cut — текст не вошёл.
  function paste(text, max = Infinity) {
    if (!active || !loaded) return null;
    unshift(); settleTurn();
    const chars = [...String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\s+$/, '')].filter(ch => ch === '\n' || (ch.length === 1 && ch >= ' ' && ch !== '\x7f'));
    if (!chars.length) return null;
    const loud = sound.on, worn = struck; let k = 0;
    bulk = true; bulkPages = []; sound.on = false;
    try { for (; k < chars.length && bulkPages.length < max; k++) onKey(chars[k] === '\n' ? synth('Enter', 'Enter') : { key: chars[k], code: '', metaKey: false, ctrlKey: false, preventDefault() {} }); }
    finally { bulk = false; sound.on = loud; struck = worn; }
    const pages = bulkPages; bulkPages = [];
    const cut = k < chars.length; sheetsOut += pages.length;
    // На листе в каретке — то, что осталось (без вышедших листов — тот же лист, допечатанный): перепечатать целиком; новый лист выезжает снизу.
    clearPage(pageSeed); prows.forEach((r, i) => r.chars.forEach(c => inkChar(c, i))); placeLine(); aim();
    if (pages.length) { feedFrom(1.1); sound.paper(); } else sound.strike();
    return { pages, cut };
  }
  // Заправить лист в каретку: чистый или недопечатанный (draft — строки, их формат и число листа). animate — лист выезжает снизу, иначе он просто стоит на месте.
  function loadSheet(draft, animate) {
    clearPage(draft?.seed); line = 0; prows = [firstRow()]; pages = [];
    if (draft?.lines?.length) {
      prows = draft.lines.slice(0, LINES).map((t, i) => {
        const f = draft.fmt?.[i] || '', L = layoutLine(t, f, 1), r = newRow(f.includes('i') ? BOOK.px * BOOK.indent : 0);
        r.soft = f.includes('s');
        L.chars.forEach((ch, j) => r.chars.push({ ch, f: L.faces[j] ? 'book' : 'mono', w: L.ws[j], x: L.xs[j], dy: (Math.random() - .5) * 2.4, seed: (Math.random() * 2 ** 32) >>> 0, ink: .94 }));
        return r;
      });
      prows.forEach((r, i) => r.chars.forEach(c => inkChar(c, i)));
      line = prows.length - 1;
    }
    aim(); carX.set(carX.t); paperOut.set(0);
    if (animate) feedFrom(1.1); else { placeLine(); feed.set(feed.t); }
    paper.visible = true; loaded = true;
  }
  const hasText = () => prows.some(r => rowText(r).trim());
  // Лист уходит из каретки (его вынули или на нём пусто): quick — исчезает сразу, иначе выезжает вверх.
  function unload(quick) {
    loaded = false; prows = [firstRow()]; line = 0; pages = [];
    if (quick) { paper.visible = false; paperOut.set(0); return; }
    sound.paper(); paperOut.t = 1;
    setTimeout(() => { if (!loaded) { paper.visible = false; paperOut.set(0); } }, 900);
  }
  // Смена листа, начатую до ухода или вынимания, доводим до конца: набранное не должно пропасть.
  function settleTurn() { while (turning) { if (turning === 1) deliverPage(); else feedPage(); } pendingKeys = []; session++; }
  // Отойти от машинки: клавиши больше не слушаются, а лист остаётся в каретке как есть (каретка там же, где стояла) — и пустой тоже
  // (пользователь 2026-11-21: при Esc «лист вынимается. так не должно быть»; раньше пустой лист выкатывался из машинки).
  function leave() {
    unshift(); settleTurn(); active = false;
    onEnd?.();
  }
  // Вынуть лист: отдаёт его хозяину страницы (строки, формат, число листа и снимок) или null, если на нём пусто (пустой лист остаётся, если печатают дальше).
  // refill — в каретку встаёт новый чистый лист (печатают дальше); quick — лист взяли рукой, он не выезжает, а исчезает сразу.
  function eject({ refill = false, quick = false } = {}) {
    if (!loaded) return null;
    unshift(); settleTurn();
    if (!hasText()) { if (!refill) unload(quick); return null; }
    const out = { img: snapshot(), lines: prows.map(rowText), fmt: prows.map(fmtOf), seed: pageSeed }, sess = session; sheetsOut++;
    if (refill && active) {
      prows = [firstRow()]; line = 0; pages = []; turning = 2;
      if (quick) paper.visible = false; else { sound.paper(); paperOut.t = 1; }
      setTimeout(() => { if (active && sess === session && turning === 2) { paper.visible = true; feedPage(); } }, quick ? 350 : 750);
    } else unload(quick);
    return out;
  }

  // Точка печати в координатах каретки.
  const printLocal = carriage.worldToLocal(printAt.clone());
  return {
    group, printAt, platenC, platenR: r, page: pageC, paper,
    keysFound: keyOf.size, rowsFound: bigRows.map(r => r.length), partsFound: comps.length,
    // Для проверки: поставить рычаг буквы в положение sw (0 — покой, 1 — удар).
    showBar(code, sw) { const b = aimBar(code); b.swing.set(sw); b.posed = true; },
    bars, strikeAt,
    // Какая клавиша модели под лучом (для нажатий мышью и пальцем) и нажать её.
    keyAt(raycaster) {
      const h = raycaster.intersectObject(keysMesh, false)[0];
      if (!h) return null;
      // Клавишу не должна закрывать другая видимая деталь машинки.
      const far = raycaster.far; raycaster.far = h.distance - 1e-3;
      const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
      const blocked = raycaster.intersectObject(group, true).some(x => x.object !== keysMesh && shown(x.object));
      raycaster.far = far;
      return blocked ? null : codeOf.get(Math.round(aKey[h.face.a])) ?? null;
    },
    tap,
    capInfo: () => groups.filter(g => g.id !== undefined).map(g => ({ id: g.id, code: codeOf.get(g.id) ?? null, c: g.c.toArray().map(v => +v.toFixed(3)), s: +g.s.x.toFixed(3) })),
    pressKey, hold(code, v = 1) { const k = keyOf.get(code); if (k !== undefined) keySprings[k].t = v; },
    // Печатать: лист в каретке (если он там остался — тот же, с того же места) или новый, чистый. cb — когда отошли от машинки (Esc); pageCb — заполненный лист, ушедший на стол.
    begin(cb, pageCb = null) {
      unshift(); session++; turning = 0; pendingKeys = []; onPage = pageCb; onEnd = cb; sheetsOut = 0;
      if (!loaded) { loadSheet(null, true); sound.paper(); }
      active = true;
    },
    // Поставить в каретку недопечатанный лист с прошлого раза (draft: строки, их формат и число листа), не прерывая зал: он просто стоит там.
    show(draft, pageCb = null) { onPage = pageCb; loadSheet(draft, false); },
    // Что сейчас на листе в каретке — чтобы не потерять, если закроют страницу (null — листа нет или он пустой).
    get draft() { return loaded && hasText() ? { lines: prows.map(rowText), fmt: prows.map(fmtOf), seed: pageSeed } : null; },
    leave, eject, paste,
    // Лист в каретке под лучом: где на нём (u, v от 0 до 1; v вверх) или null. Ниже строки печати лист спрятан в машинке — туда не попасть.
    paperAt(h) { return loaded && paper.visible && h.object === paper && h.uv && clip.distanceToPoint(h.point) > 0 ? { u: h.uv.x, v: h.uv.y } : null; },
    get loaded() { return loaded; },
    // В каретке первый лист за этот подход к машинке (до него ни один не вышел).
    get firstSheet() { return sheetsOut === 0; },
    get active() { return active; },
    get lines() { return prows.map(rowText); },
    // Шрифт литер: 'mono' — машинописный, 'book' — книжный. Меняется сразу, со следующей буквы.
    get face() { return face; },
    set face(v) { if (!FACES[v] || v === face) return; face = v; const r = prows[prows.length - 1]; if (!r.chars.length) r.x0 = face === 'book' && !prows[prows.length - 2]?.soft ? BOOK.px * BOOK.indent : 0; aim(); },
    update(dt) {
      carriage.position.x = carX.step(dt);
      const f = feed.step(dt), out = paperOut.step(dt);
      // Печатаемая строка стоит выше валика и бумагодержателя, чтобы её было видно и сверху.
      paper.position.copy(printLocal).addScaledVector(up, f + LIFT + out * PH * 1.2);
      const wp = carriage.localToWorld(printLocal.clone().addScaledVector(up, -.02));
      clip.setFromNormalAndCoplanarPoint(up.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())), wp);
      for (let i = 0; i < 64; i++) press[i] = Math.max(0, Math.min(1, keySprings[i].step(dt)));
      // Удар — импульс: рычаг долетает до ленты и сразу падает обратно в корзину.
      for (const b of bars) {
        const sw = Math.max(0, Math.min(1, b.swing.step(dt)));
        if (!b.posed && b.swing.t === 1 && sw > .97) b.swing.t = 0;
        b.g.quaternion.slerpQuaternions(b.qRest, b.qHit, sw);
        b.g.visible = sw > .04;
      }
    },
  };
}
