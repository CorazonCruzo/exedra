// «Уголок под балконом»: гостиная в клубном духе под главной галереей — диван, два кресла, журнальный столик с шахматами, ковёр,
// два торшера, приставной столик с проектором «Патэ-Бэби»; стена в штофе (или в дереве) с панелью штукатурки посередине — под будущую проекцию, бра по бокам;
// кессонный потолок. Мебель стоит на полу нижнего зала (y = −5), стена — под балюстрадой, на z = RAIL_Z + GAL.
// Модуль самостоятельный: зал отдаёт ему свои мелочи (r — см. room.js, `loungeApi`), он ничего не знает о книгах, столе и солнце.
// Свет: настоящих ламп всего две (у торшеров, до первой раздачи ламп — lightMasks), остальное — свечение материалов и ореолы.
import * as THREE from 'three';
import { fit, radial } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Что где стоит: [x, z, поворот] — поворот по y; лицо вещи в модели смотрит в +z (к стене), поэтому face() считает поворот «лицом к точке».
// По z: стена — 2,7, открытый край уголка (балюстрада наверху) — −1,15. Высота потолка уголка — 4,58 м.
const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
export const VARIANTS = {
  // a — диван у стены под панелью, кресла по бокам, штоф и шкафы по сторонам: классическая гостиная, смотрят в зал и на стену.
  a: { title: 'диван у стены', wall: 'damask', books: [-1, 1],
    sofa: [0, 2.2, Math.PI], table: [0, .8, 0], chairs: [[-2.05, 1.1, face(-2.05, 1.1, -.1, .25)], [2.05, 1.1, face(2.05, 1.1, .1, .25)]],
    side: [2.7, .15, 0], projector: 'side', chess: 'table', lamps: [[-3.0, 2.3], [3.05, 2.3]], rug: [0, 1.15, 0] },
  // b — диван лицом к стене (спиной к залу): кинозал — стена свободна целиком; всё дерево, по сторонам обшивка. Группа сидит плотно, у стены;
  // проектор — за диваном, на столике повыше (луч идёт над головами к панели); слева в углу — шахматный столик с двумя креслами.
  b: { title: 'диван лицом к стене', wall: 'wood', books: [1],
    // Группа на 0,9 м дальше от экрана, чем была (пользователь 2026-11-21: «перенеси еще всю мебель по центру (включая торшеры и ковер) подальше от экрана»); шахматный угол — на месте.
    sofa: [0, -.6, 0], table: [0, .65, 0], chairs: [[-1.9, .4, face(-1.9, .4, 0, 2.4)], [1.9, .4, face(1.9, .4, 0, 2.4)]],
    side: [1.2, -1.65, 0], sideScale: 1.05, projector: 'side', chess: 'corner', lamps: [[-2.8, 1.35], [2.8, 1.35], [-5.9, 1.75]], rug: [0, .3, 0],
    // Шахматный угол и его торшер — на 0,55 м от стены (пользователь 2026-11-21: «шахматный уголок тоже лучше от стены чуть отодвинуть. как и торшер»).
    // Пальма в зелёном горшке — в углу у шкафов (напротив шахмат); плакат Pathé-Baby — на стене над шахматным углом (выбор пользователя 2026-11-21).
    // Пальма правее и дальше от стены, горшок повёрнут стороной, где меньше сколов глазури; плакат — на боковой стене над шахматами (пользователь 2026-11-21).
    palm: [5.2, 1.45, 1.76],
    // Плакаты: Мозан — Pathé-Baby (1928) — на боковой стене над шахматами; «Театр Опера», выставка радио и кино (Буэнос-Айрес, 1930) — на задней стене, по сторону пальмы (сначала висел над шахматным креслом; поменяли местами по просьбе пользователя 2026-11-22).
    posters: [{ img: 'poster-pathe-baby.jpg', ratio: 1400 / 1982, side: -1, z: .75, y: 1.75, h: 1 }, { img: 'poster-mauzan-opera-1930.jpg', ratio: 1382 / 2048, x: 4.9, y: 1.95, h: 1 },
      // «Истерзанныя души» (Кальмансон, 1917, фильм с Верой Холодной) — симметрично «Театру Опера», над шахматным креслом.
      { img: 'poster-kalmanson-1917.jpg', ratio: 1352 / 2048, x: -4.9, y: 1.95, h: 1 }],
    corner: { table: [-4.9, .65], scale: .8, chairs: [[-4.9, -.35, face(-4.9, -.35, -4.9, .65)], [-4.9, 1.65, face(-4.9, 1.65, -4.9, .65)]] } },
  // c — беседа: диван у стены сдвинут влево, кресла напротив, на приставном столике — шахматы, проектор — на журнальном столике.
  c: { title: 'беседа вчетвером', wall: 'damask', books: [],
    sofa: [-1.45, 2.2, Math.PI], table: [.15, .95, .3], chairs: [[1.85, 1.65, face(1.85, 1.65, .15, .95)], [.5, -.25, face(.5, -.25, -.5, 1.4)]],
    side: [2.3, .35, 0], projector: 'table', chess: 'side', lamps: [[-3.15, 2.35], [3.2, 2.35]], rug: [-.1, 1.0, .06] },
};
// ?lounge=a|b|c — вариант; 0 — без уголка (зал как был). По умолчанию — b (выбор пользователя, 2026-11-21).
export const loungeVariant = q => { const k = q.get('lounge'); return k === '0' ? null : VARIANTS[k] ? k : 'b'; };

export const LOUNGE_FILES = {
  sofa: 'assets/models/lounge/sofa.glb', chair: 'assets/models/lounge/armchair.glb', table: 'assets/models/lounge/coffee-table.glb', side: 'assets/models/lounge/side-table.glb',
  rug: 'assets/models/lounge/rug.glb', lamp: 'assets/models/lounge/floor-lamp-b.glb', projector: 'assets/models/lounge/projector.glb', chess: 'assets/models/lounge/chess-set.glb',
  palm: 'assets/models/lounge/palm-c.glb',
  reels: 'assets/models/lounge/reels.glb',   // латунные коробки Pathé 9,5 мм с бобиной (timvanderheijden, CC BY 4.0 — тот же автор, что у проектора; масштаб вида ×1,6 запечён)   // зелёный глазурованный горшок (пользователь 2026-11-21: «третью, в»)
};
// Размеры: журнальный столик — 0,94 м (модель 1,44), приставной — 0,48 м, проектор — 35 см (модель 22: настоящий Патэ-Бэби именно такой малый).
const SCALE = { table: .65, side: .65, projector: 1.6 };
// Стороны (знак x), где под балконом продолжается ряд нижних шкафов; на остальных — обшивка.
export const nookBooks = key => VARIANTS[key].books;
const FLOOR = -5, SOFFIT = -.42, TOP = -.44, DADO = 1.05, PBW = .09;   // PBW — ширина рамы панели-экрана
// Панель-экран в мире (для проектора, cinema.js): центр на плоскости штукатурки (стена — на WALL, штукатурка выступает на 1 см), размеры внутри рамы; стена смотрит в −z, взгляд из зала на неё — в +z, вправо для него — −x.
export const panelWorld = wall => ({ c: new THREE.Vector3(0, FLOOR + 2.35, wall - .002 - .008), w: 3.5, h: 1.95, right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, -1) });

// Геометрия и материалы под потолком, стеной и по сторонам. r — зал: scene, RAIL_Z, GAL, HALL, panelling, box, sweep, metricUV, wood (дерево стены, уже с below), damask, plaster, lights.
export function buildNook(r, key) {
  const V = VARIANTS[key], { scene, RAIL_Z, GAL, HALL, panelling, box, sweep, metricUV, wood, damask, plaster, lime } = r;
  const WALL = RAIL_Z + GAL, up = new THREE.Vector3(0, 1, 0), Z3 = new THREE.Vector3(0, 0, 1);
  // Задняя стена тянется до боковой стены, а где стоит шкаф (его лицо — в 0,72 м от стены), — до шкафа.
  const xl = -(HALL.w / 2 - (V.books.includes(-1) ? .72 : .03)), xr = HALL.w / 2 - (V.books.includes(1) ? .72 : .03);
  const woodParts = [];
  // Прямоугольный брус в осях стены (x — вдоль, y — вверх, z — от стены в зал), потом — на место (M).
  const flat = (M, along, w, h, d, x, y, z, grain = along) => { const g = box(w, h, d, x, y, z); g.deleteAttribute('uv'); g.applyMatrix4(M); return metricUV(g.toNonIndexed(), grain); };
  // Один участок стены: низ — панели в рост ~1 м, выше — штоф или высокие филёнки, венчает карниз.
  function run(M, len, { pilasters = [], panel = null, upper = V.wall } = {}) {
    const t = new THREE.Vector3().setFromMatrixColumn(M, 0), along = Math.abs(t.x) > .5 ? 'x' : 'z', y0 = FLOOR + DADO, yTop = TOP - .26;
    const k = Math.max(1, Math.round(len / .9)), xs = Array.from({ length: k + 1 }, (_, i) => len * i / k);
    woodParts.push(...panelling(M, along, len, FLOOR + .14, y0, .03, xs));
    woodParts.push(flat(M, along, len, .14, .05, len / 2, FLOOR + .07, .025), flat(M, along, len, .05, .07, len / 2, y0 + .025, .035));
    woodParts.push(flat(M, along, len, .26, .1, len / 2, TOP - .13, .05), flat(M, along, len, .05, .14, len / 2, TOP - .285, .07));
    if (upper === 'wood') {
      // Высокие филёнки по обе стороны панели-экрана; над и под экраном — гладкая доска (чтобы рамки филёнок не легли на раму экрана).
      const cuts = panel ? [panel.x - panel.w / 2 - PBW, panel.x + panel.w / 2 + PBW] : [len, len];
      const part = (x0, x1) => {
        const L = x1 - x0; if (L < .35) return;
        const n = Math.max(1, Math.round(L / 1.4)), xs2 = Array.from({ length: n + 1 }, (_, i) => L * i / n);
        woodParts.push(...panelling(M.clone().multiply(new THREE.Matrix4().makeTranslation(x0, 0, 0)), along, L, y0 + .05, yTop, .03, xs2));
      };
      part(0, cuts[0]); if (panel) part(cuts[1], len);
      if (panel) woodParts.push(flat(M, along, cuts[1] - cuts[0], yTop - y0 - .05, .03, (cuts[0] + cuts[1]) / 2, (y0 + .05 + yTop) / 2, -.015));
    } else {
      const h = yTop - y0 - .05, g = new THREE.PlaneGeometry(len, h).translate(len / 2, y0 + .05 + h / 2, .004).applyMatrix4(M);
      const m = new THREE.Mesh(metricUV(g, along), damask); m.receiveShadow = true; scene.add(m);
      for (const x of [.045, len - .045]) woodParts.push(flat(M, along, .09, h, .05, x, y0 + .05 + h / 2, .025, 'y'));
    }
    // Пилястры — на границах среднего поля; пьедестал, ствол, капитель.
    for (const x of pilasters) {
      const W = .34, D = .07, capH = .2;
      for (const [w, h, d, y] of [[.46, .06, .085, y0 + .03], [W, yTop - capH - y0, D, (y0 + yTop - capH) / 2], [W + .1, capH, D + .04, yTop - capH / 2]]) woodParts.push(flat(M, along, w, h, d, x, y, d / 2, 'y'));
    }
    // Светлая панель штукатурки в тонкой рамке — будущий экран проекции.
    if (panel) {
      const { x, y, w, h } = panel, bw = PBW, bd = .036, x0 = x - w / 2, x1 = x + w / 2, ya = y - h / 2, yb = y + h / 2;
      const g = new THREE.PlaneGeometry(w, h).translate(x, y, .008).applyMatrix4(M);
      const m = new THREE.Mesh(metricUV(g, along), plaster); m.receiveShadow = true; scene.add(m);
      woodParts.push(flat(M, along, w + 2 * bw, bw, bd, x, yb + bw / 2, bd / 2), flat(M, along, w + 2 * bw, bw, bd, x, ya - bw / 2, bd / 2), flat(M, along, bw, h, bd, x0 - bw / 2, y, bd / 2, 'y'), flat(M, along, bw, h, bd, x1 + bw / 2, y, bd / 2, 'y'));
      const c = (px, py, dx, dy) => { const f = { p: new THREE.Vector3(px, py, 0), n: Z3, b: new THREE.Vector3(dx, dy, 0) }; return [f, f]; };
      const fr = [...c(x0, ya, 1, 1), ...c(x1, ya, -1, 1), ...c(x1, yb, -1, -1), ...c(x0, yb, 1, -1), ...c(x0, ya, 1, 1)];
      woodParts.push(sweep([[0, 0], [.014, 0], [.022, .006], [.03, .012], [.034, .022], [.03, .034], [.022, .042], [.016, .05], [.01, .055], [0, .056]], fr, false, true).toNonIndexed().applyMatrix4(M));
    }
  }
  // Задняя стена: местные оси — как у стены галереи выше (x — к −x мира).
  { const n = new THREE.Vector3(0, 0, -1), t = new THREE.Vector3().crossVectors(up, n), len = xr - xl;
    const M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(new THREE.Vector3(xr, 0, WALL - .002));
    const lx = x => xr - x, ph = 1.95;
    run(M, len, { pilasters: [lx(-3.6), lx(3.6)], panel: { x: lx(0), y: FLOOR + 2.35, w: 3.5, h: ph } });
  }
  // Боковые стены — обшивкой, если по ним не стоят шкафы.
  for (const s of [-1, 1]) if (!V.books.includes(s)) {
    const n = new THREE.Vector3(-s, 0, 0), t = new THREE.Vector3().crossVectors(up, n), len = GAL - .02;
    const M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(new THREE.Vector3(s * (HALL.w / 2 - .002), 0, s > 0 ? RAIL_Z + .01 : WALL - .01));
    run(M, len);
  }
  { const mesh = new THREE.Mesh(mergeGeometries(woodParts), wood); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.sunOnly = true; scene.add(mesh); }
  // Потолок: светлая известь в кессонах, тёмные балки; кессоны — по 1,17 × 1,28 м.
  const beams = [], bx = 12, bz = 3, W = HALL.w;
  for (let i = 1; i < bz; i++) beams.push(box(W, .16, .15, 0, SOFFIT - .08, RAIL_Z + GAL * i / bz));
  for (let i = 0; i <= bx; i++) beams.push(box(.15, .16, GAL, -W / 2 + W * i / bx, SOFFIT - .08, RAIL_Z + GAL / 2));
  beams.push(box(W, .24, .12, 0, SOFFIT - .12, WALL - .06));
  const bg = beams.map(g => { g.deleteAttribute('uv'); return metricUV(g.toNonIndexed()); });
  const bm = new THREE.Mesh(mergeGeometries(bg), wood); bm.castShadow = bm.receiveShadow = true; bm.userData.sunOnly = true; scene.add(bm);
  const cg = metricUV(new THREE.PlaneGeometry(W, GAL).rotateX(Math.PI / 2).translate(0, SOFFIT - .012, RAIL_Z + GAL / 2), 'x');
  const ceil = new THREE.Mesh(cg, lime); ceil.receiveShadow = true; scene.add(ceil);
}

// Модели уголка: имя → сцена или null (не загрузилась — вещи нет, остальное стоит).
export function loadLounge(loadModel, ms = 12000) {
  return Promise.all(Object.entries(LOUNGE_FILES).map(([k, u]) => Promise.race([loadModel(u).catch(e => { console.warn(e); return null; }), new Promise(ok => setTimeout(() => ok(null), ms))]).then(m => [k, m]))).then(Object.fromEntries);
}

// Торшер: абажур — отдельная сетка со свечением (в модели один материал на всё): треугольники выше доли `at` высоты уходят в неё.
function glowShade(lamp, at = .76) {
  lamp.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lamp), cut = box.min.y + (box.max.y - box.min.y) * at, v = new THREE.Vector3(), add = [];
  lamp.traverse(o => {
    if (!o.isMesh || !o.geometry.index) return;
    const g = o.geometry, P = g.attributes.position, I = g.index.array, low = [], high = [];
    for (let i = 0; i < I.length; i += 3) {
      let y = 0; for (let k = 0; k < 3; k++) y += v.fromBufferAttribute(P, I[i + k]).applyMatrix4(o.matrixWorld).y;
      (y / 3 > cut ? high : low).push(I[i], I[i + 1], I[i + 2]);
    }
    if (!high.length) return;
    const part = idx => { const h = new THREE.BufferGeometry(); for (const n of Object.keys(g.attributes)) h.setAttribute(n, g.attributes[n]); h.setIndex(idx); return h; };
    o.geometry = part(low);
    const m = o.material.clone(); m.emissive = new THREE.Color(0xffc080); m.emissiveMap = m.map; m.emissiveIntensity = 1.6; m.side = THREE.DoubleSide;
    const s = new THREE.Mesh(part(high), m); s.matrix.copy(o.matrix); s.matrixAutoUpdate = false; s.position.copy(o.position); s.quaternion.copy(o.quaternion); s.scale.copy(o.scale);
    add.push([o.parent, s]);
  });
  for (const [p, s] of add) { s.matrixAutoUpdate = true; p.add(s); }
  return cut - box.min.y;
}

// Вещи уголка. r.stand(box, margin) — преграда для хождения, r.below(material) — отражённый свет нижнего зала.
export function placeLounge(r, key, M) {
  const V = VARIANTS[key], { scene, below } = r, lights = [], FL = FLOOR, shades = [], halos = [], solids = []; let projectorAt = null, lens = null, projector = null;
  const dress = (obj, [x, z, ry], { y = 0, scale = 1, blocks = 0, shade = false } = {}) => {
    const g = new THREE.Group(); g.add(obj); g.scale.setScalar(scale); g.rotation.y = ry; g.position.set(x, FL + y, z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.sunOnly = true; for (const m of [].concat(o.material)) below(m); } });
    scene.add(g); g.updateMatrixWorld(true); if (blocks) solids.push(g); if (blocks) r.stand(new THREE.Box3().setFromObject(g, true), blocks); return g;
  };
  const copy = k => M[k]?.clone(true);
  if (M.rug) dress(copy('rug'), V.rug, { y: .008 });
  if (M.sofa) dress(copy('sofa'), V.sofa, { blocks: .15 });
  for (const c of V.chairs) if (M.chair) dress(copy('chair'), c, { blocks: .15 });
  if (M.table) dress(copy('table'), V.table, { scale: SCALE.table, blocks: .15 });
  const sideK = V.sideScale ?? SCALE.side;
  if (M.side) dress(copy('side'), V.side, { scale: sideK, blocks: .15 });
  // Угол с шахматами: столик и два кресла друг напротив друга.
  const C = V.corner;
  if (C && M.side) dress(copy('side'), [...C.table, 0], { scale: C.scale, blocks: .15 });
  if (C && M.chair) for (const c of C.chairs) dress(copy('chair'), c, { blocks: .15 });
  // Верхи столиков — по их моделям: высота столика после масштаба.
  const topOf = (k, s) => (M[k] ? new THREE.Box3().setFromObject(M[k]).getSize(new THREE.Vector3()).y * s : 0);
  const [tH, sH] = [topOf('table', SCALE.table), topOf('side', sideK)];
  const on = { table: [V.table[0], V.table[1], tH], side: [V.side[0], V.side[1], sH] };
  if (C) on.corner = [C.table[0], C.table[1], topOf('side', C.scale)];
  if (M.chess) { const [x, z, h] = on[V.chess]; dress(copy('chess'), [x, z, V.chess === 'table' ? V.table[2] + .2 : .9], { y: h, scale: V.chess === 'side' ? .88 : 1 }); }
  if (M.projector) {
    const [x, z, h] = on[V.projector], p = M.projector.clone(true);
    // Объектив — на стену, на середину панели.
    const g = projector = dress(p, [x, z, face(x, z, 0, 2.7)], { y: h, scale: SCALE.projector });
    // Стоит ровно на столешнице (наклон вверх топил основание в стол — пользователь 2026-11-22); луч всё равно идёт от объектива к экрану.
    projectorAt = new THREE.Vector3(x, FL + h + .2, z);
    // Объектив — кольцо на лицевой стенке корпуса (в осях модели: x .017, y .15, z .056; найдено по сетке); нажать на проектор — «Проектор» (userData.projector); зона нажатия чуть больше самого проектора.
    g.userData.projector = true; g.updateMatrixWorld(true); lens = g.localToWorld(new THREE.Vector3(.017, .15, .058));
    const px = new THREE.Mesh(new THREE.BoxGeometry(.11, .26, .16), new THREE.MeshBasicMaterial({ visible: false })); px.position.set(.0, .11, .0); px.visible = false; px.userData.proxy = true; g.add(px);
  }
  if (M.palm && V.palm) dress(copy('palm'), V.palm, { blocks: .25 });
  // Плакаты (Мозан, общественное достояние) в тонкой раме тёмного дерева: на задней стене уголка (z = 2,7, лицом в зал, `x`) или на боковой (`side` — её знак x, `z`).
  for (const P of V.posters ?? []) {
    const { x, y, h, side, z, img, ratio } = P, w = h * ratio, t = new THREE.TextureLoader().load('assets/textures/' + img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const g = new THREE.Group(), paper = new THREE.MeshStandardMaterial({ map: t, roughness: .85 }), wood = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: .55 }), fw = .035, fd = .03;
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), paper));
    for (const [px, py, sx, sy] of [[0, (h + fw) / 2, w + 2 * fw, fw], [0, -(h + fw) / 2, w + 2 * fw, fw], [(w + fw) / 2, 0, fw, h], [-(w + fw) / 2, 0, fw, h]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, fd), wood); b.position.set(px, py, -fd / 2 + .006); g.add(b); }
    if (side) { g.rotation.y = -side * Math.PI / 2; g.position.set(side * (r.hallW / 2 - .045), FL + y, z); } else { g.rotation.y = Math.PI; g.position.set(x, FL + y, 2.7 - .045); }
    g.traverse(o => { if (o.isMesh) { o.receiveShadow = true; for (const m of [].concat(o.material)) below(m); } }); scene.add(g);
  }
  // Коробки с бобинами — на том же столике, сбоку от проектора; нажать — фильмотека (userData.reels), зона нажатия чуть больше стопки.
  let reels = null;
  if (M.reels && projectorAt) {
    const [x, z, h] = on[V.projector];
    reels = dress(copy('reels'), [x - .19, z + .04, Math.PI], { y: h });   // крышкой «PATHÉ 9m/m5» — к залу
    reels.userData.reels = true;
    const px = new THREE.Mesh(new THREE.BoxGeometry(.24, .24, .27), new THREE.MeshBasicMaterial({ visible: false })); px.position.set(0, .11, 0); px.visible = false; px.userData.proxy = true; reels.add(px);
  }
  // Торшеры: абажур светится сам (отдельная сетка), вокруг — ореол.
  const glow = radial([[0, 'rgba(255,214,150,.5)'], [.3, 'rgba(255,190,120,.16)'], [1, 'rgba(255,170,90,0)']]);
  for (const [x, z] of V.lamps) {
    if (!M.lamp) break;
    const lamp = copy('lamp'), cut = glowShade(lamp), g = dress(lamp, [x, z, 0], { blocks: .12 }), H = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y;
    g.traverse(o => { if (o.isMesh && o.material.emissiveIntensity === 1.6) shades.push(o.material); });
    // Ореол у абажура — для глаза; свет настоящей лампы стоит выше (у люстр).
    const at = new THREE.Vector3(x - Math.sign(x) * .3, FL + cut * .98 + (H - cut) * .4, z - .4);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.position.copy(at); sp.scale.setScalar(1.7); scene.add(sp); halos.push(sp.material);
  }
  // Настоящий свет — две лампы, у двух торшеров около дивана: чуть в сторону зала и выше абажура — так освещены лица дивана и кресел и стена с панелью,
  // а не только стена у торшеров. Люстр в уголке нет (пользователь 2026-11-21).
  for (const [x, z] of V.lamps.slice(0, 2)) { const l = new THREE.PointLight(0xffc48a, 0, 7.5, 1.5); l.position.set(x - Math.sign(x) * .3, FL + 1.9, z - 1.2); scene.add(l); r.lights.push({ l, k: 10 }); lights.push(l); }
  // Кино: пока проектор светит, торшеры уходят в полсилы (k от 0 до 1): абажуры и ореолы; настоящие лампы приглушает зал (room.js, dimK).
  const dim = k => { for (const m of shades) m.emissiveIntensity = 1.6 * (1 - .6 * k); for (const m of halos) m.opacity = 1 - .65 * k; };
  return { lights, projectorAt, projector, reels, lens, dim, solids };
}
