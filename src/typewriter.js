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
  for (const m of [...byMat('Rodillo'), ...byMat('Reglas'), ...byMat('Tuercas')]) carriage.attach(m);
  const platenBox = new THREE.Box3(); byMat('Rodillo').forEach(m => platenBox.expandByObject(m));

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
  const aKey = new Float32Array(geo.attributes.position.count).fill(63);
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
  geo.setAttribute('aKey', new THREE.BufferAttribute(aKey, 1));
  // Направление «вниз» в координатах сетки и ход клавиши.
  const invRot = new THREE.Matrix3().setFromMatrix4(wm).invert();
  const down = new THREE.Vector3(0, -1, 0).applyMatrix3(invRot);
  const travel = width * .012 / new THREE.Vector3().setFromMatrixScale(wm).y;
  const keyU = { uPress: { value: press }, uDown: { value: down.normalize().multiplyScalar(travel) } };
  keysMesh.material = keysMesh.material.clone();
  keysMesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, keyU);
    sh.vertexShader = 'attribute float aKey; uniform float uPress[64]; uniform vec3 uDown;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uDown * uPress[int(aKey + .5)];');
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
