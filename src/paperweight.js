// Пресс-папье: плита полированного малахита и бронзовая фигурка зверя на ней. Малахит — снимок настоящего набора (CC0),
// фигурки — модели из assets/models/paperweight (запечённые цвет и рельеф), выбираются в «убранстве».
import * as THREE from 'three';
import { fit } from './util.js';
import { t } from './i18n.js';

// Плита, в метрах: w — по x, d — по z, h — толщина.
export const SLAB = { w: .118, d: .085, h: .016 };
// Фигурки: h — высота в метрах, turn — поворот вокруг вертикали (куда смотрит зверь), metal и rough — как блестит бронза,
// env — сколько в ней отражается зал, tint — на что умножается карта цвета (красное, зелёное, синее; больше единицы —
// светлее), gray — сперва обесцветить карту (у мыши она сине-серая, а нужна бронза).
// Подобрано на глаз под лампой: совсем «металлическая» фигурка в тёмном зале выходит чёрной — ей нечего отражать.
export const FIGURES = {
  mouse: { title: t('decor.weight.mouse'), url: 'assets/models/paperweight/mouse.glb', h: .07, turn: Math.PI, gray: true, tint: [.55, .32, .11], metal: .7, rough: .45, env: 1.5 },
  donkey: { title: t('decor.weight.donkey'), url: 'assets/models/paperweight/donkey.glb', h: .062, turn: 0, tint: [1.7, 1.55, 1.25], metal: .65, rough: .4, env: 1.6 },
  terrier: { title: t('decor.weight.terrier'), url: 'assets/models/paperweight/terrier.glb', h: .07, turn: 0, tint: [1.15, 1, .8], metal: .7, rough: .4, env: 1.5 },
};
const R = .004, BEV = .0015;

// Очерк плиты: прямоугольник со скруглёнными углами; фаска расширит его на BEV, поэтому очерк уже на BEV с каждой стороны.
function outline(w, d, r) {
  const hw = w / 2, hd = d / 2, s = new THREE.Shape();
  s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0);
  s.lineTo(hw, hd - r); s.absarc(hw - r, hd - r, r, 0, Math.PI / 2);
  s.lineTo(-hw + r, hd); s.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-hw, -hd + r); s.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
// Плита лежит низом на y = 0. Снимок ложится сверху вниз и повёрнут на четверть оборота (он портретный, плита — вдоль x).
// Чтобы на боках не тянулись полосы, развёртка каждой вершины сдвигается внутрь по её нормали на глубину от верха:
// у верхней грани нормаль вверх — сдвига нет, на боку рисунок «заворачивается» зеркально.
function slabGeometry() {
  const { w, d, h } = SLAB;
  const g = new THREE.ExtrudeGeometry(outline(w - 2 * BEV, d - 2 * BEV, R - BEV), { depth: h - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 4, curveSegments: 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, BEV, 0); g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const shift = h - p.getY(i);
    uv.setXY(i, p.getZ(i) / d + .5 - n.getZ(i) * shift / d, p.getX(i) / w + .5 - n.getX(i) * shift / w);
  }
  return g;
}

// Карта цвета в серую: яркость по точкам, остальные свойства те же.
function grayMap(map) {
  const img = map.image, w = img?.width, h = img?.height; if (!w || !h) return map;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d');
  x.drawImage(img, 0, 0); const px = x.getImageData(0, 0, w, h), a = px.data;
  for (let i = 0; i < a.length; i += 4) a[i] = a[i + 1] = a[i + 2] = .299 * a[i] + .587 * a[i + 1] + .114 * a[i + 2];
  x.putImageData(px, 0, 0);
  const t = new THREE.CanvasTexture(c);
  Object.assign(t, { flipY: map.flipY, colorSpace: map.colorSpace, wrapS: map.wrapS, wrapT: map.wrapT, anisotropy: map.anisotropy }); return t;
}
// Материалы модели — один раз: бронзовый блеск вместо того, что запекли; карты цвета и рельефа остаются.
function dress(model, F) {
  if (model.userData.bronzed) return; model.userData.bronzed = true;
  const done = new Set();
  model.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (done.has(m)) continue; done.add(m);
      Object.assign(m, { metalness: F.metal, roughness: F.rough, envMapIntensity: F.env });
      if (F.gray && m.map) m.map = grayMap(m.map);
      if (F.tint) m.color.setRGB(...F.tint);
      m.needsUpdate = true;
    }
  });
}

export function buildPaperweight({ map }) {
  const group = new THREE.Group();
  const slab = new THREE.Mesh(slabGeometry(), new THREE.MeshStandardMaterial({ map, color: 0x76827a, roughness: .2, envMapIntensity: 1 }));
  slab.castShadow = slab.receiveShadow = group.castShadow = group.receiveShadow = true; group.add(slab);
  // Готовая фигурка на модель: fit переставляет модель в новую обёртку, второй раз его звать нельзя.
  const built = new WeakMap(); let cur = null;
  function setFigure(k, model) {
    const F = FIGURES[k]; if (!F || !model) return;
    if (cur) group.remove(cur.obj);
    dress(model, F);
    let obj = built.get(model);
    if (!obj) { obj = fit(model, { h: F.h }); obj.rotation.y = F.turn; obj.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); built.set(model, obj); }
    obj.position.y = SLAB.h; group.add(obj); cur = { k, obj };
  }
  return { group, slab, setFigure, get figure() { return cur; } };
}
