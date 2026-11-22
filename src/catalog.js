// Каталожный шкаф у задней стены галереи: низкий, на точёных ножках, в две секции узких ящиков; на каждом — латунная рамка с ярлыком
// и кольцо под палец. Ящик выдвигается нажатием: внутри — карточки. Всё построено программно: дерево — тот же скан, что у обшивки зала,
// и перекрашивается вместе с ней («убранство»). Местные оси: x — вдоль шкафа, y — вверх от пола, лицо смотрит в +z, спина — на z = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Spring, metricUV, sfx } from './util.js';

// Размеры ящика каталога — под карточку 12,5 × 7,5 см: лицо 15 × 10,4 см, шаг 15,8 × 11,6 см.
const FW = .15, FH = .104, PX = .158, PY = .116, FT = .016, SIDE = .03, MID = .05, RAIL = .025, OUT = .3, LEN = .4;
const ABC = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ', VOWELS = 'АЕИОУЭЮЯ', AFTER = { vowel: 'бвдклнрст', consonant: 'аеилору' };
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const part = (g, grain) => metricUV(g.toNonIndexed(), grain);

// Ярлыки — машинописные, по алфавиту: «А — Ав», «Ав — Ал»… Все на одном холсте, у каждого ящика — своя клетка.
function labels(cols, rows, font) {
  const cw = 160, ch = 60, c = Object.assign(document.createElement('canvas'), { width: cols * cw, height: rows * ch }), g = c.getContext('2d'), n = cols * rows;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // Диапазоны: буквы алфавита поровну по ящикам, внутри буквы — по вторым буквам.
  const marks = []; for (let i = 0; i <= n; i++) { const t = i / n * ABC.length, L = Math.min(ABC.length - 1, Math.floor(t)), f = t - L; const second = AFTER[VOWELS.includes(ABC[L]) ? 'vowel' : 'consonant']; marks.push(i === n ? 'Яя' : ABC[L] + (f < .08 ? '' : second[Math.min(second.length - 1, Math.floor(f * second.length))])); }
  for (let i = 0; i < n; i++) {
    // Ящики идут столбцами сверху вниз, как в настоящем каталоге.
    const col = Math.floor(i / rows), row = i % rows, x = col * cw, y = row * ch, v = 232 + (i * 37 % 14);
    g.fillStyle = `rgb(${v},${v - 8},${v - 30})`; g.fillRect(x, y, cw, ch);
    g.fillStyle = 'rgba(40,30,22,.86)'; g.font = `28px ${font}`; g.fillText(`${marks[i]} — ${marks[i + 1]}`, x + cw / 2, y + ch / 2 + 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// Своя клетка развёртки у каждого экземпляра: uvo — сдвиг, добавляется к развёртке всех карт материала.
const perInstanceUV = m => {
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec2 uvo;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv += uvo;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv += uvo;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv += uvo;
      #endif`);
  };
  m.customProgramCacheKey = () => 'per-instance-uv';
  return m;
};

// wood — материал дерева зала (общий: шкаф перекрашивается вместе с обшивкой); brass — латунь; cols — ящиков в секции, sections — секций.
export function buildCatalog({ wood, brass, cols = 6, sections = 2, rows = 8, depth = .44, legs = .42, font = '"PT Mono", monospace' }) {
  const n = cols * sections * rows, W = cols * sections * PX + (sections - 1) * MID + 2 * SIDE, H = rows * PY + 2 * RAIL, D = depth - .02, y0 = legs, top = y0 + H;
  const group = new THREE.Group();
  // Корпус: короб, крышка с выносом и полочкой под ней, царга и шесть точёных ножек, сужающихся книзу.
  const body = [part(box(W, H, D, 0, y0 + H / 2, D / 2), 'x'), part(box(W + .06, .03, depth + .03, 0, top + .015, (depth + .03) / 2 - .005), 'x'), part(box(W + .025, .02, depth + .008, 0, top - .01, (depth + .008) / 2), 'x'),
    part(box(W + .02, .035, depth, 0, y0 - .0175, depth / 2), 'x'), part(box(W - .04, .09, D - .03, 0, y0 - .08, D / 2), 'x')];
  for (const x of [-1, 0, 1]) for (const z of [.045, D - .045]) body.push(part(new THREE.CylinderGeometry(.042, .026, legs - .035, 4, 1).rotateY(Math.PI / 4).translate(x * (W / 2 - .05), (legs - .035) / 2, z), 'y'));
  const carcass = new THREE.Mesh(mergeGeometries(body), wood); group.add(carcass);
  // Тёмная глубина за лицами ящиков: в щелях между ними видна не доска корпуса, а тень.
  const dark = new THREE.Mesh(box(W - 2 * SIDE + .004, H - 2 * RAIL + .004, .002, 0, y0 + H / 2, D + .001), new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 1 })); group.add(dark);

  // Ящики — экземплярами: лицо, лоток с карточками, рамка с кольцом, ярлык. Место ящика — середина его лица на плоскости корпуса.
  const at = [], colsAll = cols * sections;
  for (let c = 0; c < colsAll; c++) for (let r = 0; r < rows; r++) at.push(new THREE.Vector3(-W / 2 + SIDE + Math.floor(c / cols) * MID + (c + .5) * PX, top - RAIL - (r + .5) * PY, D));
  const uvo = (f, size = 2) => new THREE.InstancedBufferAttribute(new Float32Array(n * size).map((_, i) => f(Math.floor(i / size), i % size)), size);
  const inst = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, n); group.add(m); return m; };
  // Лицо: доска с фаской по краю (усечённая пирамидка спереди), у каждой — свой кусок шпона.
  const face = (() => { const g = part(box(FW, FH, FT, 0, 0, FT / 2), 'x'), p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) > FT / 2) p.setXY(i, p.getX(i) * (1 - .012 / FW * 2), p.getY(i) * (1 - .012 / FH * 2)); g.computeVertexNormals(); return g; })();
  face.setAttribute('uvo', uvo(() => Math.random()));
  const fronts = inst(face, perInstanceUV(wood.clone()));
  // Лоток: дно, две стенки и задняя, сосна светлее лица; в нём — пачка карточек, чуть ниже бортов.
  const tw = FW - .02, th = FH - .022, tray = mergeGeometries([box(tw, .008, LEN, 0, -th / 2 + .004, -LEN / 2), box(.008, th, LEN, -tw / 2 + .004, 0, -LEN / 2), box(.008, th, LEN, tw / 2 - .004, 0, -LEN / 2), box(tw, th, .008, 0, 0, -LEN + .004)].map(g => g.toNonIndexed()));
  const trays = inst(tray, new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: .8 }));
  const cardTex = (() => { const c = Object.assign(document.createElement('canvas'), { width: 8, height: 256 }), g = c.getContext('2d'); for (let y = 0; y < 256; y++) { const v = 205 + Math.random() * 40; g.fillStyle = `rgb(${v},${v - 9},${v - 34})`; g.fillRect(0, y, 8, 1); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const cards = inst(box(tw - .02, th - .012, LEN - .05, 0, -.004, -LEN / 2 - .005), new THREE.MeshStandardMaterial({ map: cardTex, roughness: .95 }));
  // Рамка ярлыка с кольцом под палец — одна латунная отливка.
  const hw = .074, hh = .034, bar = .005, holder = mergeGeometries([box(hw, bar, .004, 0, hh / 2 - bar / 2, .002), box(hw, bar, .004, 0, -hh / 2 + bar / 2, .002), box(bar, hh, .004, -hw / 2 + bar / 2, 0, .002), box(bar, hh, .004, hw / 2 - bar / 2, 0, .002),
    new THREE.TorusGeometry(.015, .0036, 8, 14, Math.PI).rotateZ(Math.PI).rotateX(-.5).translate(0, -hh / 2 - .002, .006)].map(g => g.toNonIndexed()));
  const holders = inst(holder.translate(0, .012, FT), brass);
  const label = new THREE.PlaneGeometry(hw - bar * 1.2, hh - bar * 1.2).translate(0, .012, FT + .0012), luv = label.attributes.uv;
  for (let i = 0; i < luv.count; i++) luv.setXY(i, luv.getX(i) / colsAll, luv.getY(i) / rows);
  label.setAttribute('uvo', uvo((i, k) => k ? (rows - 1 - i % rows) / rows : Math.floor(i / rows) / colsAll));
  const tags = inst(label, perInstanceUV(new THREE.MeshStandardMaterial({ map: labels(colsAll, rows, font), roughness: .9 })));
  const meshes = [fronts, trays, cards, holders, tags];

  const drawers = at.map(() => ({ open: new Spring(0, 90, 15) })), m4 = new THREE.Matrix4();
  const place = i => { const p = at[i]; m4.makeTranslation(p.x, p.y, p.z + drawers[i].open.v * OUT); for (const m of meshes) m.setMatrixAt(i, m4); };
  for (let i = 0; i < n; i++) place(i);
  for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  let moving = new Set();
  const api = {
    group, drawers, width: W, height: top + .03, depth: depth + .03, woods: [fronts.material],
    toggle(i) { const d = drawers[i], v = d.open.t < .5; d.open.t = v ? 1 : 0; moving.add(i); sfx.play(v ? 'drawer-open' : 'drawer-close', { gain: .45, rate: 1.35 }); return v; },
    // Пружины ящиков; true — что-то сдвинулось (тени пора пересчитать).
    update(dt) {
      if (!moving.size) return false;
      for (const i of [...moving]) { const d = drawers[i]; d.open.step(dt); place(i); if (Math.abs(d.open.t - d.open.v) < 1e-4 && Math.abs(d.open.vel) < 1e-4) { d.open.set(d.open.t); place(i); moving.delete(i); } }
      for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
      return true;
    },
  };
  // Ящик под указателем — экземпляр (instanceId) любой из его деталей.
  for (const m of meshes) m.userData.catalog = api;
  return api;
}
