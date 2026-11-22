// Старая книга в кожаном переплёте — первый шаг: тело и раскрытие. Сделана по образцу папки (binder.js), но книга толстая, и многое здесь иначе.
// Лежит на столе в трёх положениях (`pose`), как папка: `face` — закрытая лицом вверх (корешок слева), `open` — раскрытая, `back` — закрытая задней крышкой вверх (корешок справа).
// Лист k (с нуля): лицо — страница 2k+1, оборот — 2k+2. Раскрыта на i: слева оборот листа i−1 (страница 2i), справа лицо листа i (страница 2i+1).
// Лист перелистывается сам (`flip`) или рукой (`grab`/`drag`/`release`). `go(i)` на раскрытой книге — пролист: до 3 листов — обычные перелистывания подряд, дальше листы срываются
// один за другим с равным шагом и летят по тому же пути, а толщины половин и сгиб едут непрерывно (`riffle`); за обрез и по номеру страницы — `zone`/`pageAt`/`edgeFromRay`.
// Звуки книга сама не играет: `ctx.sound(name, opts)` — 'turn', 'leaf', 'riffle', 'open', 'close', 'press'.
//
// Модель (сечение поперёк корешка; оси тела `body`: x — вправо, y — вверх от стола, z — к читателю):
//   Три звена на двух петлях: задняя крышка — ПОЛОСА КОРЕШКА БЛОКА — передняя крышка. К полосе приклеены корешки всех листов подряд: первые hr от задней петли —
//   листы правой половины (нижний лист у самой петли), остальные hl до передней петли — левой (hl + hr = толщина блока). Точка между ними — сгиб G.
//   Каждая половина — веер вокруг своей петли H: лист, лежащий в стопке на высоте u над крышкой, выходит из полосы на расстоянии u от H перпендикулярно ей,
//   идёт по дуге радиуса u с центром в H и дальше прямо вдоль крышки. Угол дуги φ − 90°, где φ — угол между полосой и крышкой. φ = 90° (закрыта) — дуги нет,
//   половина — ровный брусок; φ → 180° — у корешка круглое плечо радиуса «толщина половины». Лист постоянной длины Wp, поэтому лист на высоте u короче нижнего
//   на u·(φ − 90°) — наклон обреза получается сам и пропадает у закрытой книги; крышка выступает за нижний лист ровно на кант E.
//   Полоса — два прямых звена длиной hr и hl с изломом в G; G поднят над столом на KG·min(hl, hr): у раскрытой книги φ меньше 180°, провал у сгиба неглубокий,
//   а у тонкой половины и толстой φ разные (тонкая почти плоская, толстая лежит почти плашмя).
//   Кожаный корешок переплёта (снаружи) — отдельная дуга между петлями: закрытая — выпуклая, раскрытая — лежит на столе под блоком, между ней и полосой остаётся просвет.
//   Раскрытие — одна пружина: сначала передняя крышка поднимается и встаёт на полосу (угол φ передней растёт до 180°), потом полоса ложится (G уходит влево вниз).
//   Любой кадр — те же звенья: блок не отрывается от корешка, ничего не висит.
//   Опора (`restS`, k от 0 до 1): у раскрытой неравной книги петля тонкой половины поднята, и её крышка не свисает к столу, а лежит горизонтально на высоте петли — под ней
//   мягкая подкладка (`pad`, один меш: скруглённый брусок с чуть выпуклыми боками, утоплен под крышку на 12 мм с трёх сторон и на 15 мм от петли, но не ближе 3 мм к дуге кожаного корешка), как в читальных залах под старые книги.
//   Наклон крышки умножается на 1 − k: при k = 1 она плоская, при k = 0 — как было (свисает наружным краем на стол, подкладки нет). Угол тонкого звена при k = 1 такой,
//   что верхи стопок обеих половин у обреза на одной высоте при любом i (ступеньки у сгиба нет): sin bt = (hT·sin bT − (hT − ht)) / ht.
//   Каждая половина строится в своей системе (X — от петли вдоль крышки наружу, Y — от крышки к стопке) и ставится в тело матрицей; передняя при раскрытии зеркальна.
import * as THREE from 'three';
import { Spring, clamp, holdSpring, HOLD_MIN, holdSettled } from './util.js';
import { Marks } from './marks.js';

export const BOOK = { h: .26, ratio: .68, ratioMin: .62, ratioMax: .8, cover: .003, over: .003, leaf: .00011, minT: .0015, maxT: .07, gutter: .5 };
export const POSES = ['face', 'open', 'back'];
const C = BOOK.cover, E = BOOK.over, H = BOOK.h, KG = BOOK.gutter, NA = 10, NF = 24, NP = NA + NF + 1, M = 20, PI = Math.PI, NT = 32, STEPS = [768, 1280, 2048, 3072];
// Холст-посредник для загрузки страниц (`Book.commit`); ?stage=0 — загрузка прямо с ImageBitmap, как раньше (для сравнения замеров).
const STAGE = new URLSearchParams(location.search).get('stage') !== '0';   // Book.stage — то же на ходу
// Холстов несколько, по размеру страницы: у холста с меняющимся размером каждый раз выделяется заново вся память (страницы разной ступени идут вперемешку).
// Холст, которым не пользовались 8 с, освобождается (у ступени 3072 это 29 МБ).
const stageCvs = new Map();
const fillCvs = new Map();   // свой запас холстов для малых страниц-«начинки»: чтобы они не вытесняли холсты настоящих страниц
function stage(bmp, cvs = stageCvs) {
  const key = bmp.width + 'x' + bmp.height, now = performance.now(), had = cvs.get(key); cvs.delete(key);
  for (const [k, e] of cvs) if (now - e.t > 8000 || cvs.size >= 4) { e.cv.width = 0; cvs.delete(k); }
  const cv = had?.cv ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height }));
  cvs.set(key, { cv, t: now }); const g = cv.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(bmp, 0, 0); return cv;
}
// Малые страницы-«начинка» для пролиста (см. `Book.startFillers`): сколько штук, какой высоты, во сколько мс после того, как книга раскрылась, и как мало чернил — уже «пустая».
const FILL = { n: 8, h: 384, wait: 1500, gap: 250, blank: .02, dark: .45 }, FILL_ON = new URLSearchParams(location.search).get('fill') !== '0';   // ?fill=0 — белые листы, как было (для сравнения замеров)
// Сколько на странице чернил: средняя глубина тёмного относительно фона (медианы), 0…1. Страница уменьшается до 24×32 — доли миллисекунды.
let inkCv = null;
function inkOf(bmp) {
  try {
    inkCv ??= Object.assign(document.createElement('canvas'), { width: 24, height: 32 });
    const g = inkCv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'low'; g.drawImage(bmp, 0, 0, 24, 32);
    const d = g.getImageData(0, 0, 24, 32).data, n = 768, lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = .2126 * d[i * 4] + .7152 * d[i * 4 + 1] + .0722 * d[i * 4 + 2];
    const med = Float32Array.from(lum).sort()[n >> 1]; let s = 0; for (let i = 0; i < n; i++) s += Math.max(0, med - lum[i]);
    return s / n / Math.max(med, 30);
  } catch { return .1; }
}
const PRE = .0004;      // лист лежит на стопке чуть выше, чтобы они не мерцали
const ss = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// Размеры по числу страниц: листов столько, сколько страниц пополам; лист 0,11 мм, толщина честная; предел — только сверху (7 см, дальше лист считается тоньше)
// и техническая нижняя граница 1,5 мм, чтобы книга из пары листов не вырождалась.
export function bookSize(pages, ratio = BOOK.ratio) {
  const leaves = Math.max(1, Math.ceil(pages / 2)), t = clamp(leaves * BOOK.leaf, BOOK.minT, BOOK.maxT), r = clamp(ratio, BOOK.ratioMin, BOOK.ratioMax);
  const Wp = H * r, th = t + 2 * C, D = th - C, Ls = 1.1 * D;
  return { leaves, t, T: t / leaves, ratio: r, Wp, Bw: Wp + E, Dz: H + 2 * E, th, D, Ls };
}

// ——— Геометрия, которая перестраивается на каждом кадре движения, а устройство у неё постоянно ———
// fn(e, ...args): e.v(x, y, z, u, v) — точка, e.tri(a, b, c) — треугольник, e.group(m) — дальше грани с материалом m. При первом вызове всё записывается,
// потом только обновляются положения и развёртка: число точек и порядок их обхода у fn обязаны быть теми же.
class Dyn {
  constructor(fn) { this.fn = fn; this.geometry = new THREE.BufferGeometry(); this.built = false; }
  fill(...a) {
    const first = !this.built; let n = 0;
    const P = first ? [] : this.pos.array, U = first ? [] : this.uv.array, Nn = first ? [] : this.nor?.array, I = [], G = []; let own = false;
    const e = {
      // nx, ny, nz — готовая нормаль (тогда computeVertexNormals не нужен: у простых форм она известна сразу).
      v(x, y, z, u = 0, w = 0, nx, ny, nz) {
        if (nx !== undefined) own = true;
        if (first) { P.push(x, y, z); U.push(u, w); if (own) Nn.push(nx, ny, nz); } else { P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z; U[n * 2] = u; U[n * 2 + 1] = w; if (own) { Nn[n * 3] = nx; Nn[n * 3 + 1] = ny; Nn[n * 3 + 2] = nz; } }
        return n++;
      },
      tri(p, q, r) { if (first) I.push(p, q, r); },
      group(m) { if (first) { if (G.length) G[G.length - 1].count = I.length - G[G.length - 1].start; G.push({ start: I.length, count: 0, m }); } },
    };
    this.fn(e, ...a);
    const g = this.geometry;
    if (first) {
      if (G.length) G[G.length - 1].count = I.length - G[G.length - 1].start;
      this.pos = new THREE.BufferAttribute(new Float32Array(P), 3); this.uv = new THREE.BufferAttribute(new Float32Array(U), 2);
      g.setAttribute('position', this.pos); g.setAttribute('uv', this.uv); g.setIndex(I);
      if (own) { this.nor = new THREE.BufferAttribute(new Float32Array(Nn), 3); g.setAttribute('normal', this.nor); }
      for (const q of G) g.addGroup(q.start, q.count, q.m);
      this.built = true;
    } else { this.pos.needsUpdate = this.uv.needsUpdate = true; if (this.nor) this.nor.needsUpdate = true; }
    if (!this.nor) g.computeVertexNormals();
    // Рамку луч проверяет раньше треугольников: посчитанная однажды (Box3.setFromObject и т. п.), она отстала бы от формы, и нажатие проходило бы сквозь страницу в крышку.
    g.computeBoundingSphere(); if (g.boundingBox) g.computeBoundingBox();
  }
}
// Полоса поверхности между двумя линиями точек a[i], b[i] (индексы из e.v): два треугольника на каждый шаг.
const band = (e, a, b) => { for (let i = 0; i < a.length - 1; i++) { e.tri(a[i], a[i + 1], b[i]); e.tri(a[i + 1], b[i + 1], b[i]); } };

// ——— Веер половины ———
// Верхний лист половины толщиной h при угле φ между полосой и крышкой — в системе половины (X — вдоль крышки от петли, Y — от крышки): дуга радиуса h от полосы
// до точки (0, h), дальше прямо. Сверху — небольшая собственная дуга бумаги (bump): лист не ложится в сгиб под прямым углом (не выше 4,5 мм).
// Возвращает точки pts (NP штук), длины вдоль листа s (от полосы), докуда доходит лист xe и длину дуги.
function fan(h, phi, Wp) {
  const pts = [], s = [], arcA = Math.max(0, phi - PI / 2), arcL = h * arcA, flat = Wp - arcL, A = Math.min(.0045, .0012 + .1 * h) * clamp(arcA / (PI / 6), 0, 1);   // у закрытой книги (φ = 90°) листы лежат ровно
  for (let i = 0; i <= NA; i++) { const th = phi - arcA * i / NA; pts.push([h * Math.cos(th), h * Math.sin(th)]); s.push(arcL * i / NA); }
  for (let j = 1; j <= NF; j++) { const x = flat * j / NF; pts.push([x, h + A * (1 - Math.exp(-x / .02)) * Math.pow(Math.max(0, 1 - x / Wp), 1.2)]); s.push(arcL + x); }
  return { pts, s, xe: flat, ye: pts[NP - 1][1], h, phi };
}

// Очерк крышки: у корешка углы почти прямые, у обреза скруглены. От x = 0 до w. Как у папки.
const RS = .002, RF = .008;
function outline(w, d) {
  const s = new THREE.Shape();
  s.moveTo(RS, -d / 2); s.lineTo(w - RF, -d / 2); s.quadraticCurveTo(w, -d / 2, w, -d / 2 + RF); s.lineTo(w, d / 2 - RF); s.quadraticCurveTo(w, d / 2, w - RF, d / 2);
  s.lineTo(RS, d / 2); s.quadraticCurveTo(0, d / 2, 0, d / 2 - RS); s.lineTo(0, -d / 2 + RS); s.quadraticCurveTo(0, -d / 2, RS, -d / 2);
  return s;
}
const BEV = .0008;
// Снимок ложится на крышку сверху вниз: верх снимка — дальний край (−z). flip — снимок зеркален по x (на задней крышке корешок справа).
// k — во сколько раз снимок занимает ширину крышки уже (k < 1) или шире (k > 1) по сравнению с растяжением во всю ширину: см. `fitK`.
function photoUV(g, w, d, flip, k = 1) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const u = .5 + (clamp(p.getX(i) / w, 0, 1) - .5) * k; uv.setXY(i, flip ? 1 - u : u, .5 - p.getZ(i) / d); }
  return g;
}
// Снимок переплёта (отношение сторон a — ширина к высоте) на поверхности с отношением сторон b: растягивается по ширине не больше чем в `hi` раз, сжимается не больше чем в `1/lo` раз (у настоящей книги
// пропорции свои, у PDF — свои), остальное — обрезка по краям (k < 1) или продолжение крайним столбцом кожи (k > 1: у снимка тогда зажим по краю, текстура ClampToEdge).
// Возвращает долю снимка по ширине (для u = 0,5 + (x − 0,5)·k), 1 — просто на всю ширину.
export function fitK(a, b, hi = 1.2, lo = 1 / hi) { if (!(a > 0) || !(b > 0)) return 1; const r = b / a, m = clamp(r, lo, hi); return r / m; }
// Картон в коже с мягкой фаской: x от 0 до Bw, внутренняя сторона на Y = 0 (к стопке), наружная на Y = −C.
function boardGeometry(w, d) {
  const g = new THREE.ExtrudeGeometry(outline(w - 2 * BEV, d - 2 * BEV), { depth: C - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 5 });
  g.rotateX(-Math.PI / 2); g.translate(BEV, BEV - C, 0); g.computeVertexNormals();
  // Бока — кожа с повторяющимся рисунком: развёртка в метрах.
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 6, p.getZ(i) * 6 + p.getY(i) * 6);
  return g;
}
// Накладка на лицо крышки: up — лицом вверх (по Y), y — на какой высоте; flip — зеркально по x.
function capGeometry(w, d, up, flip, y, k = 1) {
  const g = new THREE.ShapeGeometry(outline(w - 2 * BEV, d - 2 * BEV), 6);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(BEV, y, 0);
  return photoUV(g, w, d, flip, k);
}

// Белая точка вместо страницы, которая ещё не пришла: бумага остаётся одной бумагой.
let white = null;
const WHITE = () => white ??= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { colorSpace: THREE.SRGBColorSpace, needsUpdate: true });
// Материал листа: картинка страницы умножается на снимок старой бумаги — белое становится бумагой, чёрное остаётся краской. Двусторонний: map — лицо, uBack — оборот.
// У ImageBitmap three.js не переворачивает картинку, поэтому у листа верх — v = 0, а бумага (обычная текстура) читается с v перевёрнутым.
// Тон страницы решает материал: фон белый — «печать на нашей бумаге» (картинка × бумага), фон уже не белый (скан старой книги) — страница своего цвета, от нашей бумаги только рельеф;
// между ними плавно. Вес w, цвет фона c и выравнивание яркости k считаются на странице один раз (`look` у книги) и передаются числами — без ветвлений по текстуре.
// Сдвиг уровня mip к более подробному (?mipbias=-.6): при показе чуть мельче картинки видеокарта наполовину подмешивает копию вдвое меньше. Был включён для pdf.js;
// с MuPDF по умолчанию выключен (пользователь 2026-11-21: «можешь даже свою правку недавнюю отменить (возможно вернем)»).
const MIP_Q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mipbias') : null;
const MIP_BIAS = (MIP_Q === null || MIP_Q === '' || isNaN(+MIP_Q) ? 0 : +MIP_Q).toFixed(2);   // строкой с точкой — для GLSL
function pageMaterial(mats, fit, look) {
  const uBack = { value: WHITE() }, uPaper = { value: mats.paper ?? WHITE() }, uFit = { value: fit };
  const u = { Cf: { value: new THREE.Color(1, 1, 1) }, Cb: { value: new THREE.Color(1, 1, 1) }, Wf: { value: 1 }, Wb: { value: 1 }, Kf: { value: 1 }, Kb: { value: 1 } };
  const m = new THREE.MeshStandardMaterial({ map: WHITE(), normalMap: mats.paperNormal ?? null, normalScale: new THREE.Vector2(.45, .45), roughness: .93, side: THREE.DoubleSide });
  m.userData.back = uBack; m.userData.u = u;
  m.onBeforeCompile = sh => {
    sh.uniforms.uPaper = uPaper; sh.uniforms.uBack = uBack; sh.uniforms.uFit = uFit; sh.uniforms.uMul = look.mul; sh.uniforms.uFile = look.file; sh.uniforms.uInk = look.ink;
    if (mats.squash) sh.uniforms.uSq = mats.squash;
    sh.uniforms.uCf = u.Cf; sh.uniforms.uCb = u.Cb; sh.uniforms.uWf = u.Wf; sh.uniforms.uWb = u.Wb; sh.uniforms.uKf = u.Kf; sh.uniforms.uKb = u.Kb;
    // Бумага просвечивает: рассеянный свет считается и для обратной нормали, с весом 0,35 (лист в воздухе с теневой стороны не чёрный).
    const C0 = THREE.ShaderChunk;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', C0.lights_physical_pars_fragment.replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;', 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) ) + .35 * saturate( dot( - geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;'))
      .replace('#include <lights_fragment_begin>', C0.lights_fragment_begin.replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) + .35 * getHemisphereLightIrradiance( hemisphereLights[ i ], - geometryNormal );'));
    sh.fragmentShader = 'uniform sampler2D uPaper, uBack;\nuniform vec2 uFit;\nuniform vec3 uCf, uCb, uMul;\nuniform float uWf, uWb, uKf, uKb, uFile, uInk;\n' + (mats.squash ? 'uniform vec4 uSq;\n' : '') + sh.fragmentShader.replace('#include <map_fragment>', `
      // Все три снимка берутся всегда (до ветвления): производные для mip-уровней должны считаться в однородном коде.
      // Страница вписана в лист целиком (uFit — какую долю листа она занимает), поля — цвета фона страницы.
      float ff = gl_FrontFacing ? 1. : 0.;
      vec3 bg = mix(uCb, uCf, ff); float w = mix(uWb, uWf, ff), k = mix(uKb, uKf, ff);
      vec2 q = (vMapUv - .5) / uFit + .5; float ins = step(0., q.x) * step(q.x, 1.) * step(0., q.y) * step(q.y, 1.);
      vec3 imF = mix(bg, texture2D(map, q, ${MIP_BIAS}).rgb, ins), imB = mix(bg, texture2D(uBack, vec2(1. - q.x, q.y), ${MIP_BIAS}).rgb, ins), im = mix(imB, imF, ff);
      vec3 pap = texture2D(uPaper, vec2(vMapUv.x, 1. - vMapUv.y)).rgb * uMul;
      // Белое — печать на нашей бумаге; не белое — страница своего цвета с выровненной яркостью; «как в файле» — без всего этого.
      // Издали тонкие штрихи размываются в серое: у белых страниц тёмное чуть сгущаем (белое остаётся белым), чтобы буквы были плотными, как краска.
      vec3 inked = pow(max(im, vec3(1e-4)), vec3(mix(1., uInk, w)));
      vec3 col = mix(mix(im * k, inked * pap, w), im, uFile);
      vec4 sampledDiffuseColor = vec4(col, 1.);
      diffuseColor *= sampledDiffuseColor;
      vec3 inkK = clamp(im / max(bg, vec3(.03)), 0., 1.);`);
    // Зал (mats.squash — вектор сжатия яркости, как у листов): бумага под самой лампой не выгорает добела — яркость сжимается целиком, вместе с буквами.
    if (mats.squash) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float lit = dot(outgoingLight / max(inkK, vec3(.05)), vec3(.2126, .7152, .0722));
      if (lit > uSq.z) outgoingLight *= (uSq.z + uSq.w * (1. - exp(-(lit - uSq.z) / uSq.w))) / lit;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => mats.squash ? 'bookpage-sq' : 'bookpage';
  return m;
}

// Стопка половины — сплошное тело в сечении: петля H = (0,0), полоса до P_h, верхний лист (веер), косой обрез к нижнему листу Q = (Wp, 0), нижний лист до петли.
// Грани: верх (группа 3), косой обрез (0), головной (1) и хвостовой (2) торцы, тыл — полоса корешка (4). Ts — шаг полосок обреза; в торцах они идут кругами вокруг петли.
function stackFn(e, f, Wp, zz, Ts) {
  const top = [[], []], zs = [-zz, zz], pts = f.pts, v = f.h / Ts;
  e.group(3);
  for (let r = 0; r < 2; r++) for (let i = 0; i < NP; i++) top[r].push(e.v(pts[i][0], pts[i][1], zs[r], i / NP, r));
  band(e, top[1], top[0]);
  e.group(0);
  const xe = pts[NP - 1][0], ye = pts[NP - 1][1], s = [e.v(xe, ye, -zz, 0, v), e.v(xe, ye, zz, zz * 16, v), e.v(Wp, 0, -zz, 0, 0), e.v(Wp, 0, zz, zz * 16, 0)];
  e.tri(s[0], s[1], s[2]); e.tri(s[1], s[3], s[2]);
  for (let r = 0; r < 2; r++) {
    e.group(1 + r);
    const c = e.v(0, 0, zs[r], 0, 0), a = pts.map((q, i) => e.v(q[0], q[1], zs[r], q[0] * 16, v)), q = e.v(Wp, 0, zs[r], Wp * 16, 0);
    // Порядок обхода — так, чтобы геометрическая нормаль смотрела наружу (у двусторонних граней от неё зависит и смещение для теней): у головного торца (z−) — по часовой стрелке, у хвостового наоборот.
    const o = r ? (x, y, z) => e.tri(x, z, y) : (x, y, z) => e.tri(x, y, z);
    for (let i = 0; i < NP - 1; i++) o(c, a[i], a[i + 1]);
    o(c, a[NP - 1], q);
  }
  e.group(4);
  const p0 = pts[0], b = [e.v(0, 0, -zz), e.v(0, 0, zz), e.v(p0[0], p0[1], -zz), e.v(p0[0], p0[1], zz)];
  e.tri(b[0], b[1], b[2]); e.tri(b[1], b[3], b[2]);
}
// Верхний лист: полосы вдоль веера, v = 0 — верх страницы. left — лист левой половины: край у корешка у него справа, картинка зеркальна.
function pageFn(e, f, Wp, left, hz) {
  const a = [], b = [];
  for (let i = 0; i < NP; i++) { const u = f.s[i] / Wp, y = f.pts[i][1] + PRE; a.push(e.v(f.pts[i][0], y, -hz, left ? 1 - u : u, 0)); b.push(e.v(f.pts[i][0], y, hz, left ? 1 - u : u, 1)); }
  band(e, b, a);
}

// Подкладка под приподнятой крышкой: скруглённый брусок (радиус не больше 6 мм) с чуть выпуклыми боками, стоит на столе. Решётка вершин постоянна: PM шагов по скруглению,
// PF ступеней по прямой части высоты; каждый раз переставляются только вершины. q: x0…x1, z0…z1 — план в осях тела, h — высота. Развёртка в метрах, линейная по положению
// (u = x − y, v = y − z: ни одна грань не вырождается), чтобы сукно ложилось тем же размером, что на столах.
const PM = 3, PF = 5, PAD = { r: .006, bulge: .0015, inX: .015, outX: .012, sideZ: .012, gap: .0002, min: .001 };
function padFn(e, q) {
  const { x0, x1, z0, z1, h } = q, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, hy = h / 2, r = Math.max(1e-4, Math.min(PAD.r, hx, hz, hy)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bl = Math.min(PAD.bulge, h * .06);
  const st = (half, nf) => { const I = Math.max(0, half - r), a = []; for (let j = PM; j >= 0; j--) a.push(-(I + r * j / PM)); for (let j = 1; j <= nf; j++) a.push(-I + 2 * I * j / (nf + 1)); for (let j = 0; j <= PM; j++) a.push(I + r * j / PM); return a; };
  const T = [st(hx, 0), st(hy, PF), st(hz, 0)], I = [hx - r, hy - r, hz - r].map(v => Math.max(0, v)), N = T.map(a => a.length), id = new Int32Array(N[0] * N[1] * N[2]).fill(-1);
  for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let c = 0; c < N[2]; c++) {
    if (a && a < N[0] - 1 && b && b < N[1] - 1 && c && c < N[2] - 1) continue;
    const t = [T[0][a], T[1][b], T[2][c]], d = t.map((v, k) => v - clamp(v, -I[k], I[k])), l = Math.hypot(d[0], d[1], d[2]) || 1, n = d.map(v => v / l);
    const px = clamp(t[0], -I[0], I[0]) + n[0] * r, py = clamp(t[1], -I[1], I[1]) + n[1] * r + hy, pz = clamp(t[2], -I[2], I[2]) + n[2] * r, bu = bl * Math.sin(PI * clamp(py / h, 0, 1));
    const x = cx + px + n[0] * bu, y = py, z = cz + pz + n[2] * bu;
    id[(a * N[1] + b) * N[2] + c] = e.v(x, y, z, x - y, y - z, n[0], n[1], n[2]);
  }
  const V = (a, b, c) => id[(a * N[1] + b) * N[2] + c];
  for (let ax = 0; ax < 3; ax++) for (const side of [0, 1]) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3, ix = [0, 0, 0], at = (iu, iw) => { ix[ax] = side ? N[ax] - 1 : 0; ix[u] = iu; ix[w] = iw; return V(ix[0], ix[1], ix[2]); };
    for (let i = 0; i < N[u] - 1; i++) for (let j = 0; j < N[w] - 1; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (side) { e.tri(a, b, c); e.tri(a, c, d); } else { e.tri(a, c, b); e.tri(a, d, c); }
    }
  }
}
const PAD0 = { x0: -.05, x1: .05, z0: -.05, z1: .05, h: .02 };
let restMat = null;
const REST = () => restMat ??= new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: .96 });

// Луч (Raycaster) не смотрит на `visible`: скрытые сетки (пустая половина, лист не в воздухе, спинка раскрытой) иначе загораживали бы настоящие.
function visibleOnly(rc, hits) { if (this.visible) THREE.Mesh.prototype.raycast.call(this, rc, hits); }

// Невидимое поле за передним обрезом (для попадания лучом): тонкий брусок, который не рисуется, но луч его находит.
let proxyMat = null;
const PROXY = () => proxyMat ??= new THREE.MeshBasicMaterial({ visible: false });
const proxyMesh = bk => { const o = new THREE.Mesh(new THREE.BoxGeometry(.002, 1, 1), PROXY()); o.visible = false; o.raycast = visibleOnly; o.userData.part = 'edge'; o.userData.book = bk; return o; };

// Половина книги: крышка, стопка и верхний лист. Построена в своей системе (X — вдоль крышки от петли, Y — от крышки к стопке; крышка на −C…0) и ставится матрицей.
class Half {
  constructor(bk, front) {
    this.bk = bk; this.front = front; const { Bw, Dz } = bk.s, m = bk.mats;
    this.g = new THREE.Group(); this.g.matrixAutoUpdate = false;
    const mesh = (g, mat, shadow = true) => { const o = new THREE.Mesh(g, mat); o.castShadow = shadow; o.receiveShadow = true; o.userData.book = bk; o.raycast = visibleOnly; return o; };
    this.board = mesh(boardGeometry(Bw, Dz), m.rim ?? m.front); this.board.userData.part = 'cover';
    // Снаружи — снимок крышки; изнутри — форзац (передний повёрнут к корешку другим краем).
    const kc = fitK(m.coverAspect, Bw / Dz, m.stretch);   // у настоящего переплёта свои пропорции крышки
    this.outer = mesh(capGeometry(Bw, Dz, false, !front, -C - .0002, kc), front ? m.front : m.back, false); this.inner = mesh(capGeometry(Bw, Dz, true, front, .0002), m.endpaper, false);
    this.outer.userData.part = this.inner.userData.part = 'cover';
    this.stack = new Dyn(stackFn); this.stackMesh = mesh(this.stack.geometry, [bk.edge.fore, bk.edge.head, bk.edge.tail, bk.topMat, bk.backMat]); this.stackMesh.userData.part = 'page';
    this.page = new Dyn(pageFn); this.pageMat = pageMaterial(m, bk.fit, bk.look); this.pageMesh = mesh(this.page.geometry, this.pageMat); this.pageMesh.userData.part = 'page';
    this.pageMesh.frustumCulled = this.stackMesh.frustumCulled = false;
    this.proxy = proxyMesh(bk); this.g.add(this.board, this.outer, this.inner, this.stackMesh, this.pageMesh, this.proxy);
    this.f = null; this.h = 0; this.H = [0, 0]; this.ex = [1, 0]; this.ey = [0, 1]; this.world = [];
  }
  // Поставить половину: петля в (hx, hy), ось X — ex, ось Y — ey (в плоскости x, y тела).
  place(H0, ex, ey) {
    this.H = H0; this.ex = ex; this.ey = ey;
    this.g.matrix.makeBasis(new THREE.Vector3(ex[0], ex[1], 0), new THREE.Vector3(ey[0], ey[1], 0), new THREE.Vector3(0, 0, 1)).setPosition(H0[0], H0[1], 0);
    this.g.matrixWorldNeedsUpdate = true;
  }
  loc(x, y) { const dx = x - this.H[0], dy = y - this.H[1]; return [dx * this.ex[0] + dy * this.ex[1], dx * this.ey[0] + dy * this.ey[1]]; }   // точка тела — в осях половины
  w(X, Y) { return [this.H[0] + X * this.ex[0] + Y * this.ey[0], this.H[1] + X * this.ex[1] + Y * this.ey[1]]; }   // точка половины — в осях тела
  dispose(keepMats = false) { for (const o of [this.board, this.outer, this.inner, this.stackMesh, this.pageMesh]) o.geometry.dispose(); if (!keepMats) this.pageMat.dispose(); }
}

// Корешок переплёта: лента толщиной C вдоль дуги от петли задней крышки до петли передней. Группы: 0 — снаружи (снимок корешка), 1 — изнутри (форзац), 2 — торцы.
// kk — доля снимка корешка по ширине (u = 0,5 + (s/Ls − 0,5)·kk): тонкая книга показывает середину снимка, толстая — снимок целиком и края кожи по бокам (см. `fitK`).
function spineFn(e, pts, nrm, Z, kk = 1) {
  const o = [[], []], n = pts.length;
  for (let r = 0; r < 2; r++) for (let j = 0; j < n; j++) {
    const k = r ? -C / 2 : C / 2;
    o[r].push([pts[j][0] + nrm[j][0] * k, pts[j][1] + nrm[j][1] * k]);
  }
  for (const side of [0, 1]) {
    e.group(side);
    const a = [], b = [];
    for (let j = 0; j < n; j++) { const q = o[side][j], u = side ? j / (n - 1) : .5 + (j / (n - 1) - .5) * kk; a.push(e.v(q[0], q[1], -Z, u, 1)); b.push(e.v(q[0], q[1], Z, u, 0)); }
    if (side) band(e, a, b); else band(e, b, a);   // нормали наружу: у внешней стороны — от центра дуги, у внутренней — к нему
  }
  e.group(2);
  for (const z of [-Z, Z]) { const a = [], b = []; for (let j = 0; j < n; j++) { a.push(e.v(o[0][j][0], o[0][j][1], z, j, 0)); b.push(e.v(o[1][j][0], o[1][j][1], z, j, 1)); } if (z < 0) band(e, a, b); else band(e, b, a); }
}
// Спинка блока у закрытой книги: сегмент между дугой корешка и хордой, виден с головы и с хвоста (иначе там дыра). Веер от середины хорды.
function fillFn(e, pts, mid, zz) {
  for (let r = 0; r < 2; r++) {
    e.group(r); const z = r ? zz : -zz, c = e.v(mid[0], mid[1], z, 0, 0), a = pts.map(q => e.v(q[0], q[1], z, q[0] * 16, q[1] * 16));
    for (let j = 0; j < a.length - 1; j++) { if (r) e.tri(c, a[j + 1], a[j]); else e.tri(c, a[j], a[j + 1]); }
  }
}

// Углы и петли в «канонической» раскладке: неподвижная половина (hs; как задняя) справа, подвижная (hm; как передняя) — слева или сверху.
// p — раскрытие от 0 (закрыта) до 1 (раскрыта), q — «расправлена» от 0 (как лежит сама) до 1.
// Раскрытая: звенья полосы стоят под углами к столу (elevation) — у толстой половины βT, у тонкой βt. Чем неравнее половины, тем круче стоит толстая:
// s = smoothstep(0,25…0,9) от |hr − hl| / T; βT = lerp(asin(KG·ht/hT), 85°, s), βt = lerp(30°, −85°, s). При s = 0 — прежняя раскладка (обе петли на столе, сгиб поднят
// на KG·min); при s = 1 — прямая стоящая полоса: толстая половина — брусок, а петля тонкой поднята над столом и её крышка лежит наклонно (от петли к столу).
// Опора k: наклон приподнятой крышки (её наружный край лежал бы на столе) умножается на 1 − k — и у неподвижной (dl), и у подвижной (dlm, rho).
// «Расправлена»: оба звена стоят «шалашом» (βT → не меньше 68°, βt → 68°). Петля (и крышка) той половины, чья петля выше, поднята на разность высот звеньев.
// Сгиб G и обе петли — по цепочке звеньев; расстояние между петлями — hT·cos βT + ht·cos βt, крышки стоят симметрично вокруг середины между ними.
const lerp = (a, b, k) => a + (b - a) * k, D2R = PI / 180;
// Угол наклона крышки (вокруг петли, поднятой на y над столом), при котором её наружный край лежит на столе.
function tiltOf(y, bw) { let d = 0; for (let k = 0; k < 5; k++) d = Math.asin(clamp((y + C * (1 - Math.cos(d))) / bw, 0, 1)); return d; }
function config(hs, hm, p, q, bw, k = 0) {
  const hT = Math.max(hs, hm), ht = Math.min(hs, hm), tot = hs + hm, s = ss(((tot > 1e-9 ? Math.abs(hs - hm) / tot : 0) - .25) / .65);
  let bT = lerp(hT > 1e-9 ? Math.asin(Math.min(1, KG * ht / hT)) : 0, 85 * D2R, s), bt = lerp(30 * D2R, -85 * D2R, s);
  // Опора k: верхи обеих стопок у обреза на одной высоте. Из замыкания цепочки: петля тонкой половины над петлёй толстой на hT·sin bT − ht·sin bt, а нужно hT − ht,
  // откуда sin bt = (hT·sin bT − (hT − ht)) / ht (зажим в [−1, 1] — только у самых крайних листов; у пустой половины, ht → 0, угол прежний). bt = lerp(прежний, этот, k).
  if (k > 0 && ht > 1e-9) bt = lerp(bt, Math.asin(clamp((hT * Math.sin(bT) - (hT - ht)) / ht, -1, 1)), k);
  bT = lerp(bT, Math.max(bT, 68 * D2R), q); bt = lerp(bt, 68 * D2R, q);
  const thickStatic = hs >= hm, bs = thickStatic ? bT : bt, bm = thickStatic ? bt : bT;
  const delta = hs * Math.sin(bs) - hm * Math.sin(bm), ys = Math.max(0, -delta), ym = Math.max(0, delta), tk = 1 - k, dlm = tk * tiltOf(ym, bw);
  const d = hs * Math.cos(bs) + hm * Math.cos(bm), fmo = PI - bm + dlm;
  // Сначала передняя крышка встаёт на полосу (a), потом полоса ложится, петли расходятся, наклоняется поднятая крышка (b).
  const a = ss(p / .55), b = ss((p - .4) / .6);
  const al = PI / 2 + b * (PI / 2 - bs), beta = -PI / 2 + b * (bm + PI / 2); let fm = PI / 2 + a * PI / 2 - b * (PI - fmo);
  // Если по пути петля подвижной половины опускается ниже стола (толстая половина ложится на стол), поднимаем всю цепочку целиком: неподвижная петля чуть приподнимется и крышка на ней наклонится.
  const xs = d / 2 * b, drop = Math.max(0, hm * Math.sin(beta) - hs * Math.sin(al) - ys * b), raise = ys * b + drop;
  const dl = tk * tiltOf(raise, bw), fs = al + dl, Hs = [xs, C + raise], G = [Hs[0] + hs * Math.cos(al), Hs[1] + hs * Math.sin(al)], Hm = [G[0] - hm * Math.cos(beta), G[1] - hm * Math.sin(beta)];
  // Поворот подвижной половины (её система — зеркальная, как передняя). Крышка не уходит под стол: если по пути она наклонилась круче, чем позволяет высота петли, — остаётся на столе.
  let rho = beta - (PI - fm); if (rho > 0) rho = Math.min(rho, tk * tiltOf(Math.max(0, Hm[1] - C), bw)); fm = rho - beta + PI;
  return { fs, fm, beta, xs, Hs, G, Hm, d, bT, bt, s, ys, ym, tilt: dl, exs: [Math.cos(dl), -Math.sin(dl)], eys: [Math.sin(dl), Math.cos(dl)], exm: [-Math.cos(rho), -Math.sin(rho)], eym: [-Math.sin(rho), Math.cos(rho)], p, a, b };
}

// Лист в полёте: точки по равным шагам вдоль листа (длина Wp) и их наклон; ломаная (world, s) — верхний лист половины.
function resample(world, s, Wp, N) {
  const out = []; let k = 0;
  for (let j = 0; j <= N; j++) {
    const t = Wp * j / N; while (k < s.length - 2 && s[k + 1] < t) k++;
    const a = world[k], b = world[k + 1], ds = s[k + 1] - s[k], f = ds > 1e-9 ? clamp((t - s[k]) / ds, 0, 1) : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
// Как у папки: край, за который тянут, опережает корешок, и лист выгибается. p — ход листа (0 — на месте, 1 — на другой стороне), u — доля длины от сгиба; результат — «насколько полоса уже левая».
const lead = p => 1 - Math.pow(1 - p, 1.7), lag = p => Math.pow(p, 1.7);
const turnShape = (p, dir) => u => { const q = lag(p) + (lead(p) - lag(p)) * Math.pow(u, .8); return dir > 0 ? q : 1 - q; };
// Лист в воздухе: полосы поперёк, v = 0 — верх страницы; лицо — вверх, пока лист справа.
function turnFn(e, pts, hz) {
  const a = [], b = [];
  for (let i = 0; i <= NT; i++) { a.push(e.v(pts[i][0], pts[i][1], -hz, i / NT, 0)); b.push(e.v(pts[i][0], pts[i][1], hz, i / NT, 1)); }
  band(e, b, a);
}

export class Book {
  // data: { pages, ratio, i, pose }; ctx: { mats: { front, back, spine, endpaper, edge, paperNormal, paper?, rim?, coverAspect?, spineAspect?, stretch? }, source }.
  // coverAspect / spineAspect — отношение сторон снимков крышки и корешка (src/bindings.js): снимок ложится на крышку растянутым не больше чем в stretch раз (по ширине), на корешок — по `fitK`.
  // edge — один материал или { fore, head, tail }. source.render(n, height) → Promise<ImageBitmap> (страница n с 1, верх картинки — верх страницы).
  constructor(data = {}, ctx = {}) {
    this.ctx = ctx; this.mats = ctx.mats ?? {}; this.source = ctx.source ?? null;
    this.pages = Math.max(2, data.pages | 0 || 100); this.s = bookSize(this.pages, data.ratio); this.leaves = this.s.leaves; this.ratio = this.s.ratio;
    this.pose = POSES.includes(data.pose) ? data.pose : 'face'; this.i = clamp(data.i | 0, 0, this.leaves);
    const edge = this.mats.edge, one = edge?.isMaterial ? edge : null;
    this.edge = { fore: one ?? edge.fore, head: one ?? edge.head, tail: one ?? edge.tail };
    for (const m of [...Object.values(this.edge), this.mats.spine, this.mats.endpaper, this.mats.rim]) if (m) m.side = THREE.DoubleSide;
    this.topMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: .95 });
    this.backMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: .95, side: THREE.DoubleSide });
    this.fit = new THREE.Vector2(1, 1); this.setAspect(ctx.aspect ?? this.source?.aspect);
    // Тон бумаги снаружи: снимок бумаги делится на свой средний цвет и умножается на тон (ctx.mats.pageTone, по умолчанию тёплый светлый крем).
    this.look = { mul: { value: new THREE.Vector3(1, 1, 1) }, file: { value: 0 }, ink: { value: 1.7 } }; this.paperOk = false; this.tone = this.mats.pageTone === undefined ? new THREE.Color(0xefe6d2) : this.mats.pageTone === null ? null : new THREE.Color(this.mats.pageTone);
    this.group = new THREE.Group(); this.group.userData.book = this;
    this.body = new THREE.Group(); this.body.position.x = -this.cx(this.pose); this.group.add(this.body);
    this.halves = [new Half(this, true), new Half(this, false)];
    const mk = (fn, mats) => { const d = new Dyn(fn), o = new THREE.Mesh(d.geometry, mats); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; o.userData.book = this; o.raycast = visibleOnly; return { d, o }; };   // двусторонняя лента отбрасывала бы тень на саму себя — не отбрасывает
    // Снимок корешка по ширине: у настоящего корешка своя толщина, у нашего — по числу страниц; ширина снимка в метрах — отношение сторон на высоту корешка (книга + кант).
    this.spineK = this.mats.spineAspect > 0 ? fitK(this.mats.spineAspect * (H + 2 * E), this.s.Ls, 1.5, .55) : 1;
    this.spine = mk(spineFn, [this.mats.spine, this.mats.endpaper ?? this.mats.spine, this.mats.rim ?? this.mats.spine]); this.spine.o.userData.part = 'skin';
    this.fillm = mk(fillFn, [this.edge.head, this.edge.tail]);
    // Лист в воздухе — третья сетка из полос; материал двусторонний: лицо — страница 2k+1, оборот — 2k+2.
    this.turnMat = pageMaterial(this.mats, this.fit, this.look); this.turning = mk(turnFn, this.turnMat); this.turning.o.castShadow = true; this.turning.o.receiveShadow = false; this.turning.o.visible = false; this.turning.o.userData.part = 'page';   // у тонкого двустороннего листа тень на себя даёт чёрную обратную сторону
    // Подкладка под приподнятой крышкой (см. шапку): один меш в теле, не ловит луч; мат — mats.rest или простой тёмно-зелёный.
    this.pad = mk(padFn, this.mats.rest ?? REST()); this.pad.o.castShadow = true; this.pad.o.raycast = () => {}; this.padKey = null; this.pad.d.fill(PAD0); this.pad.o.scale.setScalar(0);   // всегда «видим» (шейдер собирается вместе с книгой), когда не нужна — сжат в точку
    this.turn = null; this.turnS = new Spring(0, 70, 13); this.onTurn = null;
    // Запас летящих листов для пролиста: та же сетка из полос; чистая бумага с обеих сторон.
    this.flyMat = pageMaterial(this.mats, this.fit, this.look);
    // У каждого места в запасе свой материал: у каждого летящего листа свои страницы на лице и обороте; шейдер тот же (customProgramCacheKey). Материалы — сразу, а не по первому листу:
    // зал раздаёт материалам лампы (`lightMasks`) по тем, что есть в сцене, и поздний материал без этого собрал бы свой шейдер со всеми лампами прямо во время пролиста (замер: кадр 50 мс).
    this.pool = Array.from({ length: 10 }, (_, j) => { const mat = j ? pageMaterial(this.mats, this.fit, this.look) : this.flyMat, f = mk(turnFn, mat); f.mat = mat; f.o.castShadow = true; f.o.receiveShadow = false; f.o.visible = false; f.o.userData.part = 'page'; this.fillPool?.push(f); return f; });
    this.rif = null; this.chain = null; this.pendingGo = null; this.shapes = null; this.halves.forEach((h, k) => { h.proxy.userData.k = k; });
    this.proxyC = proxyMesh(this); this.proxyC.userData.k = -1;
    // Закладки (marks.js): ленточки между листами, одна сетка на книгу; floorY — стол под книгой в осях тела (null — книга на подставке, пола нет), grav — «вниз» в осях тела.
    this.headZ = H / 2 - .0003; this.floorY = -.0013; this.grav = [-1, 0]; this.marks = new Marks(this, fan, data.marks);
    this.body.add(this.halves[0].g, this.halves[1].g, this.pad.o, this.spine.o, this.fillm.o, this.turning.o, this.proxyC, this.marks.mesh, ...this.pool.map(f => f.o));
    this.pressS = new Spring(data.flat ? 1 : 0, 50, 12); this.padWant = ctx.rest !== false; this.restS = new Spring(this.padWant && !data.flat ? 1 : 0, 50, 12); this.openS = new Spring(this.pose === 'face' ? 0 : 1, 34, 10); this.backS = new Spring(this.pose === 'back' ? 1 : 0, 34, 10); this.iS = new Spring(this.i, 60, 12);
    this.fill = { src: null, list: [], todo: [], timer: 0, ctl: null }; this.leafSeq = 0;
    this.imgs = new Map(); this.clock = 0; this.fresh = false; this.dead = false; this.uploads = []; this.timer = 0;
    this.detail = 1280; this.settled = false; this.cost = {}; this.stat = { req: 0, abort: 0, done: 0, upload: 0 };
    this.layout(); this.syncPages();
  }
  // Где середина книги в осях тела при данном положении: закрытая лицом вверх лежит вправо от петли, раскрытая — вокруг неё, задней — влево.
  // Тот, кто ставит книгу, сдвигает `group` так, чтобы корешок остался на месте: group.x = x корешка + cx.
  cx(pose = this.pose) { return { face: this.s.Bw / 2, open: 0, back: -this.s.Bw / 2 }[pose]; }
  // Что книга занимает на столе в положении pose (по x — в осях группы, где середина закрытой лежит в нуле, а корешок раскрытой — в нуле; по z — полуглубина). Ничего не двигает;
  // не зависит от места раскрытия: у раскрытой берётся запас на толщину блока, у закрытой — выпуклость кожаного корешка.
  footprint(pose = this.pose) {
    const { Bw, Dz, t, D } = this.s, hd = Dz / 2, bulge = .2 * D + C;
    if (pose === 'open') { const w = Bw + t / 2; return { x0: -w, x1: w, hd }; }
    return pose === 'face' ? { x0: -Bw / 2 - bulge, x1: Bw / 2, hd } : { x0: -Bw / 2, x1: Bw / 2 + bulge, hd };
  }
  get thickness() { return this.s.th; }
  get leafThickness() { return this.s.T; }
  get covering() { return !this.openS.resting || !this.backS.resting || !this.pressS.resting || !this.restS.resting || (!this.rif && !this.iS.resting); }
  get moving() { return this.covering || !!this.turn || !!this.rif; }
  snd(name, opts) { this.ctx.sound?.(name, opts); }

  // ——— Положение ———
  // Крышки двигаются по очереди: передняя открылась — потом задняя закроется; задняя поднялась — передняя ждёт. Иначе половины прошли бы друг через друга.
  retarget() {
    const want = this.pose, back = this.backS, open = this.openS;
    open.t = want !== 'face' || back.v > .01 ? 1 : 0;
    back.t = want === 'back' && open.v > .96 ? 1 : 0;
  }
  setPose(pose, snap = false) {
    if (!POSES.includes(pose)) return;
    this.chain = null; this.pendingGo = null; this.stopRiffle(); this.finishTurn();
    if (!snap && pose === 'open' && this.pose !== 'open') this.snd('open', {});
    this.pose = pose; this.body.position.x = -this.cx(pose);
    if (pose !== 'open') { this.pressS.t = 0; if (snap) this.pressS.set(0); this.syncRest(snap); }
    this.openS.t = pose === 'face' ? 0 : 1; this.backS.t = pose === 'back' ? 1 : 0;
    if (snap) { this.openS.set(this.openS.t); this.backS.set(this.backS.t); } else this.retarget();
    if (snap) this.marks.snapNow();
    this.layout(); this.syncPages();
  }
  // Раскрытая книга переходит на лист i. До 3 листов — обычные перелистывания подряд, быстрее обычного; дальше — пролист: листы срываются один за другим
  // (каждые 45–70 мс, летят 0,25–0,35 с), толщины половин и сгиб едут непрерывно, длительность D = clamp(0,35 + 0,3·log10 N, 0,45, 1,4) с.
  // opts: { snap } — сразу; { follow } — цель идёт за рукой (пружина), листы сыплются вслед. Новый go во время пролиста меняет цель без рывка.
  go(i, opts = {}) {
    if (typeof opts === 'boolean') opts = { snap: opts };
    i = clamp(Math.round(i), 0, this.leaves);
    if (opts.snap || this.pose !== 'open') { this.chain = null; this.pendingGo = null; this.stopRiffle(); this.finishTurn(); this.i = i; this.iS.set(i); this.marks.snapNow(); this.layout(); this.syncPages(); return; }
    if (this.turn || this.chain) { if (!this.turn?.held) this.pendingGo = [i, opts]; return; }
    if (this.rif) { this.retargetRiffle(i, opts); return; }
    const N = Math.abs(i - this.i); if (!N) return;
    if (N <= 3 && !opts.follow) { this.chain = { dir: Math.sign(i - this.i), left: N }; if (!this.flip(this.chain.dir)) this.chain = null; return; }
    this.startRiffle(i, opts);
  }
  startRiffle(i, opts) {
    const from = this.iS.v, N = Math.abs(i - from), dir = Math.sign(i - from) || 1, D = clamp(.35 + .3 * Math.log10(Math.max(1, N)), .45, 1.4);
    const r = this.rif = { dir, from, to: i, follow: !!opts.follow, t: 0, D, flyers: [], k: 0, acc: 0, sched: [], pending: null };
    if (r.follow) { this.iS.t = i; this.iS.vel = 0; }
    // Каждый следующий лист ложится позже предыдущего: не обгоняют друг друга и не пересекаются.
    else { let s = 0, end = 0; for (;;) { const F = Math.max(.25 + Math.random() * .1, end - s + .02); if (s + F > D) break; r.sched.push({ s, F, dir }); end = s + F; s += .045 + Math.random() * .025; } if (!r.sched.length) r.sched.push({ s: 0, F: Math.min(.3, D), dir }); }
    // Страницы промежуточных мест не рисуем вовсе: то, что ждёт ответа, отменяем.
    clearTimeout(this.timer); for (const e of this.imgs.values()) if (e.req) { e.req.ctl.abort(); this.stat.abort++; e.req = null; }
    // Вместо них на листах — «начинка» (малые страницы этой же книги), а страницы цели просим сразу, чтобы к посадке они были готовы.
    r.seq = this.leafSeq++; r.live = false; r.pf = []; r.pfAge = 0; r.pfTo = null;
    if (!r.follow) this.prefetch(r);
    this.settled = false; this.applyPages(); this.snd('riffle', { dur: r.follow ? 0 : D, n: Math.round(N), follow: r.follow, dir });
  }
  retargetRiffle(i, opts) {
    const r = this.rif, dir = Math.sign(i - this.iS.v) || r.dir;
    if (!r.follow) {
      if (dir !== r.dir && !opts.follow) { r.pending = [i, opts]; return; }
      // Из заданной по времени дорожки — в пружину, с той же скоростью: рывка нет.
      const u = clamp(r.t / r.D, 0, 1); this.iS.vel = (r.to - r.from) * 6 * u * (1 - u) / r.D; r.follow = true; r.sched = [];
    }
    r.to = i; r.dir = dir; this.iS.t = i; r.pfAge = 0;
  }
  // Страницы цели пролёта (разворот на r.to) — сразу, как при посадке, и держим вместе с остальными: syncPages после посадки найдёт их готовыми. У пролёта за рукой цель
  // меняется — просим, когда она постояла на месте (см. stepRiffle); предыдущие просьбы, которых нет в новой, снимаем.
  prefetch(r) {
    if (!this.source) return; const to = clamp(Math.round(r.to), 0, this.leaves), P = this.pages, two = this.twoPass, h = !two ? this.detail : Math.min(768, this.detail);
    const pages = [[2 * to, 100], [2 * to + 1, 99]].filter(([n]) => n >= 1 && n <= P);
    for (const n of r.pf) if (!pages.some(q => q[0] === n) && !this.spread().includes(n)) { const e = this.imgs.get(n); if (e) this.drop(n, e); }
    r.pf = pages.map(q => q[0]); r.pfTo = r.to;
    for (const [n, pri] of pages) this.request(n, h, pri);
  }
  stopRiffle() { const r = this.rif; if (!r) return; this.rif = null; for (const f of this.pool) f.o.visible = false; this.iS.set(clamp(Math.round(this.iS.v), 0, this.leaves)); }
  spawnLeaf(F, dir, rate, age = 0) {
    const r = this.rif; if (r.flyers.length >= this.pool.length) return;
    const used = new Set(r.flyers.map(f => f.slot)); let slot = 0; while (used.has(slot)) slot++;
    this.dressLeaf(slot); r.flyers.push({ age, F, dir, slot }); this.snd('leaf', { rate, follow: r.follow, dir });
  }
  // Одеть лист в месте slot: лицо и оборот — две разные «начинки», по порядковому номеру листа (лист в полёте не мигает, соседние различаются). Пока «начинки» нет — чистая бумага.
  dressLeaf(slot) {
    const mat = this.pool[slot].mat;
    const rd = this.fill.list, s = this.leafSeq++, a = rd.length ? rd[s * 3 % rd.length] : null, b = rd.length ? rd[(s * 3 + (rd.length >> 1)) % rd.length] : null;
    mat.map = a?.tex ?? WHITE(); mat.userData.back.value = b?.tex ?? WHITE(); this.setLook(mat, 'f', a?.n ?? 0); this.setLook(mat, 'b', b?.n ?? 0);
  }
  stepRiffle(dt) {
    const r = this.rif; r.t += dt;
    if (!r.follow) {
      const u = clamp(r.t / r.D, 0, 1); this.iS.set(r.from + (r.to - r.from) * ss(u));
      while (r.k < r.sched.length && r.sched[r.k].s <= r.t) { const q = r.sched[r.k++]; this.spawnLeaf(q.F, q.dir, 1 / .058, r.t - q.s); }
    } else {
      this.iS.step(dt); r.acc += dt; const d = Math.sign(r.to - this.iS.v) || r.dir;
      if (r.pfTo !== r.to && (r.pfAge += dt) > .15) this.prefetch(r);
      if (r.acc >= .06 && Math.abs(r.to - this.iS.v) > 1.5 && Math.abs(this.iS.vel) > 3 && r.flyers.every(f => f.dir === d)) { r.acc = 0; const F = Math.max(.25 + Math.random() * .1, (r.end ?? 0) - r.t + .02); r.end = r.t + F; this.spawnLeaf(F, d, 1 / .06); }
    }
    this.layout(); this.shapes = this.makeShapes();
    // Верхние листы половин: к концу пролёта (последняя четверть времени; у пролёта за рукой — когда осталось немного) вместо «начинки» — настоящие страницы цели, если они уже пришли.
    const live = r.follow ? Math.abs(r.to - this.iS.v) < Math.max(2, .2 * Math.abs(r.to - r.from)) : r.t >= .75 * r.D; if (live !== r.live) { r.live = live; this.applyPages(); }
    // Летящие листы: каждый в своей фазе и в своём месте запаса (место не меняется, пока лист летит); у каждой сетки свои нормали (сетки небольшие).
    const alive = r.flyers = r.flyers.filter(f => f.age < f.F); this.flyPts = [];
    for (const m of this.pool) m.o.visible = false;
    for (const f of alive) { const m = this.pool[f.slot]; m.o.visible = true; const pts = this.leafPts(ss(f.age / f.F), f.dir, this.shapes); m.d.fill(pts, H / 2); this.flyPts.push(pts); }
    for (const f of alive) f.age += dt;
    const done = r.follow ? Math.abs(r.to - this.iS.v) < .4 && Math.abs(this.iS.vel) < 3 : r.t >= r.D;
    if (done && !alive.length) this.finishRiffle();
  }
  finishRiffle() {
    const r = this.rif; this.rif = null; for (const f of this.pool) f.o.visible = false;
    this.i = clamp(Math.round(r.to), 0, this.leaves); this.iS.set(this.i); this.settled = false;
    this.layout(); this.syncPages(); this.onTurn?.({ riffle: true, dir: r.dir });
    const pg = r.pending ?? this.pendingGo; this.pendingGo = null; if (pg) this.go(pg[0], pg[1]);
  }

  // «Расправить»: p от 0 (книга лежит сама) до 1 (звенья стоят шалашом, строки у корешка ровные). Пружина; держится при перелистывании и `go`, сбрасывается при закрытии.
  press(p) { const was = this.pressS.t > .5; this.pressS.t = clamp(p, 0, 1); this.syncRest(); if (was !== this.pressS.t > .5 && this.pose === 'open') this.snd('press', { on: this.pressS.t > .5 }); }
  get pressed() { return this.pressS.t; }
  // Опора под приподнятой крышкой: true — крышка лежит горизонтально на подкладке, false — свисает наружным краем на стол (как было). snap — сразу.
  // Подкладка — настройка книги (`padWant`): включена она или нет. Пока книгу «расправляют», подкладка уходит сама (чем сильнее расправлена, тем меньше её) и возвращается, когда отпустили.
  setRest(on, snap = false) { this.padWant = !!on; this.syncRest(snap); this.layout(); }
  syncRest(snap = false) { this.restS.t = this.padWant ? 1 - clamp(this.pressS.t, 0, 1) : 0; if (snap) this.restS.set(this.restS.t); }
  get rested() { return this.restS.t; }
  get padOn() { return this.pad.o.scale.x > 0; }   // подкладка сейчас есть (под приподнятой крышкой)

  // Закладки: наклон тела книги (на подставке; рад) — «вниз» в осях тела и есть ли пол; пересчитывается, только если наклон изменился.
  setTilt(t) {
    const g = [-Math.cos(t), Math.sin(t)], fl = t > .02 ? null : -.0013;
    if (Math.abs(g[0] - this.grav[0]) < 1e-4 && Math.abs(g[1] - this.grav[1]) < 1e-4 && fl === this.floorY) return;
    this.grav = g; this.floorY = fl; this.marks.layout();
  }

  // ——— Раскладка ———
  layout() {
    const { s } = this, { Wp, T, t, leaves, Ls } = s;
    const kf = clamp(this.openS.v, 0, 1), kb = clamp(this.backS.v, 0, 1);
    const iv = clamp(this.iS.v, 0, leaves), tn = this.turn;
    // Пока лист в воздухе, он не входит ни в одну половину: стопка с той стороны, откуда он ушёл, тоньше на лист.
    const hl = iv * T - (tn?.dir < 0 ? T : 0), hr = t - iv * T - (tn?.dir > 0 ? T : 0);
    // Кто двигается: передняя (пока не раскрыта до конца), иначе задняя; у раскрытой — всё равно, раскладки совпадают.
    const front = kf < 1 - 1e-4 || kb < 1e-4, m = front ? 1 : -1, p = front ? kf : 1 - kb;
    const hs = front ? hr : hl, hm = front ? hl : hr, kr = clamp(this.restS.v, 0, 1), cfg = this.cfg = config(hs, hm, p, clamp(this.pressS.v, 0, 1), s.Bw, kr), hz = H / 2;
    const sH = this.halves[front ? 1 : 0], mH = this.halves[front ? 0 : 1];
    sH.place([m * cfg.Hs[0], cfg.Hs[1]], [m * cfg.exs[0], cfg.exs[1]], [m * cfg.eys[0], cfg.eys[1]]);
    mH.place([m * cfg.Hm[0], cfg.Hm[1]], [m * cfg.exm[0], cfg.exm[1]], [m * cfg.eym[0], cfg.eym[1]]);
    this.G = [m * cfg.G[0], cfg.G[1]]; this.hl = hl; this.hr = hr;
    sH.phi = cfg.fs; mH.phi = cfg.fm; sH.h = hs; mH.h = hm; this.mover = mH; this.mdir = m;
    for (const h of this.halves) {
      const vis = h.h > T * .5; h.stackMesh.visible = vis; h.world = [];
      if (!vis) { h.f = null; continue; }
      const f = h.f = fan(h.h, h.phi, Wp);
      h.stack.fill(f, Wp, hz - .0003, Math.max(T, .0005)); h.page.fill(f, Wp, h.front, hz);
      // Верх в осях тела: веер и косой обрез до нижнего листа — для surfaceAt и проверок.
      h.world = [...f.pts.map(q => h.w(q[0], q[1])), h.w(Wp, 0)];
    }
    // Кожаный корешок — дуга постоянной длины между петлями (по середине толщины крышек): закрытая — выпуклая наружу, раскрытая — плоская на столе.
    const jf = this.halves[0].w(0, -C / 2), jb = this.halves[1].w(0, -C / 2);
    const dx = jf[0] - jb[0], dy = jf[1] - jb[1], len = Math.hypot(dx, dy), dir = [dx / len, dy / len], mid = [(jf[0] + jb[0]) / 2, (jf[1] + jb[1]) / 2];
    const side = kf < 1 - 1e-3 ? -1 : kb > 1e-3 ? 1 : 0, pref = [side, -.3];
    // Закрытая и в движении — наружу по старому правилу; раскрытая — от сгиба G (наружу от блока), чтобы дуга не лезла под звенья полосы.
    let ref = pref; if (!side) { const rx = mid[0] - this.G[0], ry = mid[1] - this.G[1]; if (Math.hypot(rx, ry) > 1e-4) ref = [rx, ry]; }
    // С опорой звенья полосы почти прямые, сгиб G лежит на хорде, и «от сгиба» меняет сторону при малейшей разнице (дуга перескакивала бы сквозь блок): пока хорда не крутая, дуга — вниз, под блок.
    if (!side && kr > .5 && Math.abs(dir[1]) < .7) ref = [0, -1];
    let pp = [-dir[1], dir[0]]; if (pp[0] * ref[0] + pp[1] * ref[1] < 0) pp = [-pp[0], -pp[1]];
    const pts = [], nrm = [], r = len / Ls;
    if (r >= .9995) for (let j = 0; j <= M; j++) { pts.push([jb[0] + dx * j / M, jb[1] + dy * j / M]); nrm.push(pp); }
    else {
      let lo = 1e-5, hi = PI; for (let k = 0; k < 40; k++) { const th2 = (lo + hi) / 2; if (Math.sin(th2) / th2 > r) lo = th2; else hi = th2; }
      const th2 = (lo + hi) / 2, R = Ls / (2 * th2), cth = Math.cos(th2);
      for (let j = 0; j <= M; j++) {
        const f = -th2 + 2 * th2 * j / M, n = [dir[0] * Math.sin(f) + pp[0] * Math.cos(f), dir[1] * Math.sin(f) + pp[1] * Math.cos(f)];
        pts.push([mid[0] + dir[0] * R * Math.sin(f) + pp[0] * R * (Math.cos(f) - cth), mid[1] + dir[1] * R * Math.sin(f) + pp[1] * R * (Math.cos(f) - cth)]); nrm.push(n);
      }
    }
    for (const q of pts) q[1] = Math.max(q[1], C / 2);
    this.spine.d.fill(pts, nrm, hz + E, this.spineK);
    // Спинка блока нужна, пока полоса стоит: у закрытой книги иначе с головы и хвоста дыра. Раскрытая — просвет под блоком так и должен быть.
    const inner = pts.map((q, j) => [q[0] - nrm[j][0] * C / 2, q[1] - nrm[j][1] * C / 2]);
    this.fillm.d.fill(inner, mid, hz - .0003); this.fillm.o.visible = r < .9995 && cfg.b < .01;
    this.joints = { front: jf, back: jb, pts, sag: r < .9995 ? Math.max(...pts.map(q => Math.abs((q[0] - mid[0]) * pp[0] + (q[1] - mid[1]) * pp[1]))) : 0 };
    // Поля за передним обрезом (невидимые бруски для луча): у раскрытой — у каждой половины, у закрытой — один; пока что-то движется — нет.
    const idle = !this.moving, Wp2 = s.Wp + .007;
    for (const h of this.halves) { const on = idle && this.pose === 'open' && h.stackMesh.visible; h.proxy.visible = on; if (on) { const ph = Math.max(h.h + .004, .014); h.proxy.position.set(Wp2, ph / 2, 0); h.proxy.scale.set(3, ph, H + .004); } }   // обрез тонкой половины тоже легко поймать: не ниже 14 мм, 6 мм в ширину
    const onC = idle && this.pose !== 'open', sg = this.pose === 'back' ? -1 : 1; this.proxyC.visible = onC;
    if (onC) { this.proxyC.position.set(sg * (s.Bw + .007), s.th / 2, 0); this.proxyC.scale.set(1, s.th + .002, H + .004); }
    this.paged = this.pose === 'open' || this.moving && (this.openS.v > .02 || this.backS.v > .02);
    for (const h of this.halves) h.pageMesh.visible = this.paged && h.stackMesh.visible;
    this.updatePad(kr); this.marks?.layout();
    // Самая высокая точка книги (для surfaceAt, пока что-то движется).
    let top = s.th; for (const h of this.halves) { for (const q of h.world) top = Math.max(top, q[1]); top = Math.max(top, h.w(s.Bw, 0)[1], h.w(0, 0)[1]); } this.topY = top;
  }

  // Подкладка: у той половины, у которой петля в конце раскрытия окажется выше (cfg.ys — у неподвижной, cfg.ym — у подвижной): иначе при раскрытии у конца книги подкладка
  // прыгала бы с одной крышки на другую. Верх подкладки — низ крышки у её более низкого края (у плоской крышки — вся), чуть ниже;
  // пока крышка в воздухе (поднята наружным краем, например при раскрытии), подкладка не нужна — высота плавно гаснет к 50° над горизонтом; ниже 1,5–4 мм она сходит на нет.
  updatePad(kr) {
    const { Bw, Dz } = this.s, o = this.pad.o; let best = null;
    const mine = this.cfg.ym > this.cfg.ys ? this.mover : this.halves[this.mover === this.halves[0] ? 1 : 0];
    if (kr > 1e-3) for (const h of [mine]) {
      if (h.ey[1] <= 0) continue;
      const a = h.w(PAD.inX, -C), b = h.w(Bw - PAD.outX, -C), top = Math.min(a[1], b[1]) - PAD.gap, ang = Math.asin(clamp(-h.ex[1], -1, 1));
      // Дуга кожаного корешка выгибается наружу (у толстых книг на сантиметры): подкладка начинается не ближе чем на 3 мм от неё.
      const sg = h.ex[0] < 0 ? -1 : 1; let ext = -1e9; for (const q of this.joints.pts) ext = Math.max(ext, sg * q[0]); a[0] = sg * Math.max(sg * a[0], ext + .003);
      const he = top * ss(1 + ang / .9) * ss((top - PAD.min) / .0025);
      if (he > .0003 && (!best || he > best.h)) best = { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: -Dz / 2 + PAD.sideZ, z1: Dz / 2 - PAD.sideZ, h: he };
    }
    o.scale.setScalar(best ? 1 : 0); if (!best) return;
    const key = [best.x0, best.x1, best.h], was = this.padKey; if (was && key.every((v, i) => Math.abs(v - was[i]) < 1e-6)) return;
    this.padKey = key; this.pad.d.fill(best);
  }

  // ——— Страницы ———
  // Что видно: справа лицо листа i (страница 2i+1), слева оборот листа i−1 (2i); пока лист в воздухе, под ним справа уже следующий (2i+3), слева — прежний (2i−2).
  spread() {
    const i = this.i, L = this.leaves, d = this.turn?.dir ?? 0;
    return [i > 0 ? (d < 0 ? 2 * i - 2 : 2 * i) : 0, i < L ? (d > 0 ? 2 * i + 3 : 2 * i + 1) : 0];
  }
  // Страница вписана в лист целиком (картинка шире или уже листа — поля остаются бумагой): a — отношение ширины к высоте страницы.
  setAspect(a) { const r = this.ratio, k = a > 0 ? a : r; if (k > r) this.fit.set(1, r / k); else this.fit.set(k / r, 1); }
  // Высота картинки — по тому, сколько точек страница занимает на экране: ступени 768 / 1280 / 2048 / 3072. Книга ничего не перерисовывает, если ступень та же.
  setDetail(px) { const d = STEPS.find(v => v >= px) ?? STEPS[STEPS.length - 1]; if (d !== this.detail) { this.detail = d; this.syncPages(); } }
  // Сколько мс рисуется страница высотой h (даёт стенд из `onstat` движка): у сканов время от высоты не зависит — тогда соседей сразу рисуем в нужном качестве.
  noteCost(h, ms) { const k = h <= 900 ? 'small' : 'large'; this.cost[k] = this.cost[k] ? this.cost[k] * .7 + ms * .3 : ms; }
  get twoPass() { const { small, large } = this.cost; return !(small && large) || small < .7 * large; }
  // Что держать: страница → [высота, приоритет]. Разворот первым; потом следующий лист (обе стороны), прежний, ещё лист вперёд и назад — соседей сначала в малом качестве.
  plan() {
    const i = this.i, P = this.pages, m = new Map(), hi = this.detail, two = this.twoPass, low = Math.min(768, hi), near = two ? low : hi, spr = this.settled || !two ? hi : low;
    const add = (n, h, pri) => { if (n >= 1 && n <= P && !(m.has(n) && m.get(n)[1] >= pri)) m.set(n, [h, pri]); };
    add(2 * i, spr, 100); add(2 * i + 1, spr, 99);
    add(2 * i + 2, near, 80); add(2 * i + 3, near, 79);
    add(2 * i - 1, near, 60); add(2 * i - 2, near, 59);
    add(2 * i + 4, near, 40); add(2 * i + 5, near, 39);
    add(2 * i - 3, near, 30); add(2 * i - 4, near, 29);
    return m;
  }
  // Просим страницу n высотой h (если такой ещё нет и не просили); картинка придёт в `uploads`.
  // ss — рисовать вдвое крупнее и уменьшать (bookfile-worker, `render`): качество страницы — h·ss, той же высоты, но чище.
  request(n, h, pri, ss = 1) {
    let e = this.imgs.get(n); if (!e) this.imgs.set(n, e = { n, tex: null, h: 0, q: 0, req: null, t: 0 });
    e.t = ++this.clock;
    const q = h * ss;
    if (e.q >= q * .99 || (e.req && e.req.q >= q * .99)) return;
    if (e.req) { e.req.ctl.abort(); this.stat.abort++; e.req = null; }
    const ctl = new AbortController(), req = e.req = { h, q, ctl }; this.stat.req++;
    this.source.render(n, h, { priority: pri, signal: ctl.signal, ss }).then(bmp => {
      if (this.dead || e.req !== req || this.imgs.get(n) !== e) { bmp.close?.(); return; }
      e.req = null; this.stat.done++; this.uploads.push({ e, bmp, h, q }); this.fresh = true;
    }).catch(err => { if (err?.name !== 'AbortError' && err?.name !== 'Closed') console.warn('page', n, err); });
  }
  syncPages() {
    if (!this.source || this.rif) return;
    if (this.paged && this.fill.src !== this.source) this.startFillers();
    clearTimeout(this.timer);
    const want = this.paged ? this.plan() : new Map();
    for (const [n, e] of [...this.imgs]) if (!want.has(n)) this.drop(n, e);
    // При чтении (`sharp`) разворот, когда книга успокоилась, — вдвое крупнее с уменьшением; соседи и запас — как обычно.
    for (const [n, [h, pri]] of want) {
      this.request(n, h, pri, this.sharp && this.settled && pri >= 99 ? 2 : 1);
    }
    this.applyPages();
    // Книга успокоилась — разворот просим в нужном качестве.
    if (!this.settled && this.paged) this.timer = setTimeout(() => { this.settled = true; this.syncPages(); }, 250);
  }
  // Картинка идёт на видеокарту заранее, в своём кадре и не больше одной за кадр (ctx.init — например renderer.initTexture): иначе первый показ добавил бы эту работу в кадр рисования.
  // Сама ImageBitmap в текстуру sRGB уходит медленным путём (замер 2026-11-21: страница 1583×2048 — 4–9 мс на главном потоке и ещё 22–30 мс видеокарты, у RGBA8 — 3 + 3 мс; в зале это кадры в 40–50 мс
  // на каждый лист): поэтому с ctx.init страница сперва рисуется на холст (drawImage — копия на видеокарте), а текстура грузится с холста — этим путём то же самое занимает доли миллисекунды.
  commit() {
    const u = this.uploads.shift(); if (!u) return;
    if (u.fill) { this.commitFill(u); return; }
    if (this.dead || this.imgs.get(u.e.n) !== u.e) { u.bmp.close?.(); return; }
    const via = this.ctx.init && Book.stage ? stage(u.bmp) : null, tex = new THREE.Texture(via ?? u.bmp); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
    if (this.ctx.init) { const t0 = performance.now(); this.ctx.init(tex); this.lastUpload = { h: u.h, ms: performance.now() - t0 }; tex.onUpdate = () => {}; u.bmp.close?.(); }
    else tex.onUpdate = () => u.bmp.close?.();
    this.stat.upload++; const old = u.e.tex; u.e.tex = tex; u.e.h = u.h; u.e.q = u.q ?? u.h; old?.dispose(); this.applyPages();
  }
  // ——— «Начинка» пролиста ———
  // Пролистывая, видишь не чистую бумагу, а страницы с текстом: после раскрытия, в тихое время, из этой же книги рисуется несколько малых страниц (FILL.n штук высотой FILL.h,
  // равномерно по книге, без первых и последних страниц; почти пустые отбрасываются по `inkOf`). Они живут, пока живёт книга (малые: ~3–4 МБ на всё), и ложатся на летящие листы
  // (`dressLeaf`) и на верхние листы половин во время пролёта (`applyPages`). Идут обычным путём страниц (`render` с самым низким приоритетом, загрузка по одной за кадр через холст).
  startFillers() {
    const f = this.fill; this.stopFillers(); f.src = this.source;
    const P = this.pages, skip = clamp(Math.round(P * .03), 3, 8), lo = skip + 1, hi = P - skip, K = Math.min(FILL.n, hi - lo + 1);
    if (!FILL_ON || K < 3) return;
    f.todo = Array.from({ length: K }, (_, j) => ({ base: lo + Math.floor((hi - lo) * (j + .5) / K), k: 0 })); f.hi = hi; this.pumpFill(FILL.wait);
  }
  stopFillers() {
    const f = this.fill; clearTimeout(f.timer); f.ctl?.abort(); f.ctl = null; f.todo = []; for (const e of f.list) e.tex?.dispose(); f.list = [];
    for (let i = this.uploads.length - 1; i >= 0; i--) if (this.uploads[i].fill) { this.uploads[i].bmp.close?.(); this.uploads.splice(i, 1); }
  }
  pumpFill(ms) { const f = this.fill; clearTimeout(f.timer); f.timer = setTimeout(() => this.fillStep(), ms); }
  fillStep() {
    const f = this.fill, src = f.src; if (this.dead || src !== this.source || !f.todo.length) return;
    // Только в тишине: пока что-то листается, ждёт ответа или грузится — отложить.
    if (this.rif || this.turn || this.uploads.length || [...this.imgs.values()].some(e => e.req)) { this.pumpFill(500); return; }
    const s = f.todo[0], n = Math.min(f.hi, s.base + s.k), ctl = f.ctl = new AbortController(), next = ms => { if (f.src === src) this.pumpFill(ms); };
    this.source.render(n, FILL.h, { priority: -10, signal: ctl.signal }).then(bmp => {
      if (this.dead || f.src !== src || ctl.signal.aborted) { bmp.close?.(); return; }
      const ink = inkOf(bmp);
      if (ink >= FILL.blank && ink <= FILL.dark) { f.todo.shift(); this.uploads.push({ fill: { n, tex: null, ink }, bmp, src }); this.fresh = true; }
      else { bmp.close?.(); if (++s.k > 2) f.todo.shift(); }   // пустая (или чёрная) — пробуем следующую; трёх подряд хватит
      next(FILL.gap);
    }).catch(err => { if (err?.name === 'AbortError' || err?.name === 'Closed') return; console.warn('fill', n, err); f.todo.shift(); next(500); });
  }
  commitFill(u) {
    const f = this.fill; if (this.dead || u.src !== f.src) { u.bmp.close?.(); return; }
    const via = this.ctx.init && Book.stage ? stage(u.bmp, fillCvs) : null, tex = new THREE.Texture(via ?? u.bmp); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
    if (this.ctx.init) { this.ctx.init(tex); tex.onUpdate = () => {}; u.bmp.close?.(); } else tex.onUpdate = () => u.bmp.close?.();
    u.fill.tex = tex; f.list.push(u.fill); f.list.sort((a, b) => a.n - b.n); this.stat.fill = f.list.length;
  }
  drop(n, e) { if (e.req) { e.req.ctl.abort(); this.stat.abort++; e.req = null; } e.tex?.dispose(); this.imgs.delete(n); }
  // Средний цвет снимка бумаги (линейный): по нему бумага нормируется и умножается на тон. Снимок грузится позже книги — считаем, когда он есть.
  ensurePaper() {
    if (this.paperOk) return true; const im = this.mats.paper?.image; if (!im?.width) return false;
    try { const c = Object.assign(document.createElement('canvas'), { width: 16, height: 16 }), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0;
      for (let i = 0; i < 256; i++) { r += d[i * 4]; gg += d[i * 4 + 1]; b += d[i * 4 + 2]; }
      const m = new THREE.Color().setRGB(r / 256 / 255, gg / 256 / 255, b / 256 / 255, THREE.SRGBColorSpace); this.paperMean = m; } catch { this.paperMean = new THREE.Color(.6, .5, .3); }
    this.paperOk = true; this.setTone(this.tone); return true;
  }
  // Тон бумаги (цвет или null — «как в снимке», без нормировки) и режим «как в файле» (без бумаги вовсе).
  setTone(c) { this.tone = c ? new THREE.Color(c) : null; const m = this.paperMean ?? new THREE.Color(1, 1, 1), t = this.tone ?? m; this.look.mul.value.set(t.r / m.r, t.g / m.g, t.b / m.b); this.paperLum = this.tone ? .2126 * this.tone.r + .7152 * this.tone.g + .0722 * this.tone.b : .2126 * m.r + .7152 * m.g + .0722 * m.b; this.applyPages(); }
  setPaperMode(file) { this.look.file.value = file ? 1 : 0; }
  // Вид страницы n: w — насколько фон белый (0…1), c — цвет фона (линейный), k — выравнивание яркости (у не белых; у тёмных — 1).
  pageLook(n) {
    const t = this.source?.tones?.get(n); if (!t) return { w: 1, c: new THREE.Color(1, 1, 1), k: 1 };
    const [r, g, b] = t, mn = Math.min(r, g, b), mx = Math.max(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    const sm = (a, bb, x) => { x = clamp((x - a) / (bb - a), 0, 1); return x * x * (3 - 2 * x); };
    const w = sm(.8, .92, mn) * (1 - sm(.04, .1, sat)), c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    const lumS = .2126 * r + .7152 * g + .0722 * b, lumL = .2126 * c.r + .7152 * c.g + .0722 * c.b;
    const k = lumS < .35 ? 1 : clamp((this.paperLum ?? .8) / Math.max(lumL, 1e-3), .8, 1.5);
    return { w, c, k };
  }
  setLook(mat, side, n) { const L = n ? this.pageLook(n) : { w: 1, c: new THREE.Color(1, 1, 1), k: 1 }, u = mat.userData.u; u['C' + side].value.copy(L.c); u['W' + side].value = L.w; u['K' + side].value = L.k; }
  applyPages() {
    this.ensurePaper();
    const [l, r] = this.spread(), tx = n => this.imgs.get(n)?.tex ?? WHITE();
    // Во время пролиста страницы между не рисуются: верхние листы половин — «начинка» (одна на пролёт), а к концу — настоящие страницы цели, если уже пришли; нет «начинки» — чистая бумага.
    const rf = this.rif, rd = this.fill.list, L = this.leaves, to = rf ? clamp(Math.round(rf.to), 0, L) : 0;
    const face = (side, n) => {
      if (!rf) return [tx(n), n];
      const e = rf.live && n ? this.imgs.get(n) : null; if (e?.tex) return [e.tex, n];
      const q = rd.length ? rd[(rf.seq * 3 + side * 3 + 1) % rd.length] : null; return q ? [q.tex, q.n] : [WHITE(), 0];
    };
    const fl = face(0, rf ? (to > 0 ? 2 * to : 0) : l), fr = face(1, rf ? (to < L ? 2 * to + 1 : 0) : r);
    this.halves[0].pageMat.map = fl[0]; this.halves[1].pageMat.map = fr[0];
    this.setLook(this.halves[0].pageMat, 'f', fl[1]); this.setLook(this.halves[1].pageMat, 'f', fr[1]);
    const t = this.turn; if (t) { this.turnMat.map = tx(2 * t.k + 1); this.turnMat.userData.back.value = tx(2 * t.k + 2); this.setLook(this.turnMat, 'f', 2 * t.k + 1); this.setLook(this.turnMat, 'b', 2 * t.k + 2); }
  }
  // Сколько страниц сейчас в памяти (для проверки).
  get held() { return [...this.imgs.values()].filter(e => e.tex).length; }

  // ——— Перелистывание ———
  // Как у папки. dir = 1 — верхний правый лист уходит налево, −1 — левый возвращается направо. Возвращает false, если некуда или нельзя.
  flip(dir) {
    if (this.pose !== 'open' || this.openS.v < .98 || this.backS.v > .02 || !this.iS.resting || !this.pressS.resting || this.rif || (dir !== 1 && dir !== -1)) return false;
    if (this.turn) { if (this.turn.held || this.turn.dir !== dir) return false; this.finishTurn(true); }
    const k = dir > 0 ? this.i : this.i - 1; if (k < 0 || k >= this.leaves) return false;
    this.turn = { dir, k, held: false, back: false, t0: performance.now() };
    this.turnS.set(dir > 0 ? 0 : PI); this.turnS.t = dir > 0 ? PI : 0;
    const ch = this.chain, hk = ch?.hold ? holdSpring(ch.n++) : null;
    this.turnS.k = hk ? hk[0] : ch ? 170 : 70; this.turnS.c = hk ? hk[1] : ch ? 25 : 13;   // подряд — быстрее обычного; зажатая стрелка — всё быстрее
    this.layout(); this.setupTurn(); this.bendTurning(); this.applyPages(); this.snd('turn', { dir, fast: !!ch, hold: !!hk }); return true;
  }
  // Зажатая стрелка: листы идут один за другим и понемногу ускоряются (до 8 в секунду); пока лист в воздухе, следующий ждёт — доходит до конца и останавливается там, где кончились листы.
  holdFlip(dir) {
    if (this.pose !== 'open' || this.rif || (dir !== 1 && dir !== -1)) return false;
    this.chain = { dir, left: Infinity, hold: true, n: 0 };
    if (!this.turn && !this.flip(dir)) { this.chain = null; return false; }
    return true;
  }
  // Отпустили: лист, что в воздухе, долетает, и книга замирает.
  endHold() { const c = this.chain; if (c?.hold) { if (this.turn) c.left = 1; else this.chain = null; } }
  get holding() { return !!this.chain?.hold; }
  // Взять лист за точку на расстоянии r от сгиба; x — где указатель в осях тела. Дальше точка идёт за указателем по дуге вокруг сгиба.
  grab(dir, x) {
    if (!this.flip(dir)) return false;
    const t = this.turn; t.held = true; t.r = Math.max(.05, Math.abs(x - this.G[0])); t.vel = 0; t.at = performance.now();
    this.turnS.t = dir > 0 ? .07 : PI - .07; return true;
  }
  drag(x) {
    const t = this.turn; if (!t?.held) return;
    const th = clamp(Math.acos(clamp((x - this.G[0]) / t.r, -1, 1)), .07, PI - .07), now = performance.now(), dt = Math.max(.008, (now - t.at) / 1000);
    t.vel = t.vel * .5 + (th - this.turnS.t) / dt * .5; t.at = now; this.turnS.t = th;
  }
  // Отпустили: лист ложится туда, куда ближе, с учётом того, как быстро его вели.
  release() {
    const t = this.turn; if (!t?.held) return;
    t.held = false;
    const fresh = performance.now() - t.at < 120, p = this.turnS.t + (fresh ? clamp(t.vel, -12, 12) * .12 : 0), go = t.dir > 0 ? p > PI * .5 : p < PI * .5;
    if (go) this.turnS.t = t.dir > 0 ? PI : 0; else { this.turnS.t = t.dir > 0 ? 0 : PI; t.back = true; }
  }
  // Дойти до конца сразу (касание без перетаскивания).
  complete() { const t = this.turn; if (!t) return; t.held = false; this.turnS.t = t.dir > 0 ? PI : 0; }
  finishTurn(quiet = false) {
    const t = this.turn; if (!t) return;
    if (!t.back) { this.i += t.dir; this.iS.set(this.i); }
    this.turn = null; this.turning.o.visible = false; this.settled = false;
    this.layout(); this.syncPages(); this.onTurn?.(t);
    if (quiet) return;
    if (this.chain) { if (--this.chain.left > 0 && this.flip(this.chain.dir)) return; this.chain = null; }
    const pg = this.pendingGo; if (pg) { this.pendingGo = null; this.go(pg[0], pg[1]); }
  }
  // Начальная и конечная форма листа: верхний лист правой и левой половины (с учётом самого листа сверху), как нарисованы, — в равных шагах и с наклоном каждого шага.
  makeShapes() {
    const { Wp, T } = this.s;
    const shape = (h, left) => {
      const f = fan(h.h + T, h.phi, Wp), pts = resample(f.pts.map(q => h.w(q[0], q[1])), f.s, Wp, NT), ang = [];
      for (let j = 0; j < NT; j++) { let a = Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]); if (left && a < -PI / 2) a += 2 * PI; ang.push(a); }
      return { p0: pts[0], ang };
    };
    return { R: shape(this.halves[1], false), L: shape(this.halves[0], true) };
  }
  setupTurn() { this.shapes = this.makeShapes(); this.turning.o.visible = true; }
  // Высота верха под листом в точке x: верхний лист той половины, над которой он (по своим ломаным), за обрезом — крышка.
  surfX(x) {
    let y = C;
    for (const h of this.halves) {
      if (!h.stackMesh.visible) continue; const w = h.world;
      for (let k = 0; k < w.length - 1; k++) { const a = w[k], b = w[k + 1]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) y = Math.max(y, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); }
    }
    return y;
  }
  // Точки листа в воздухе при ходе p (0 — на месте, 1 — на другой стороне): равные шаги от сгиба, наклон каждого шага — между наклоном «справа» и «слева».
  leafPts(p, dir, sh) {
    const wf = turnShape(p, dir), du = this.s.Wp / NT, w0 = wf(0), R = sh.R, L = sh.L;
    const pts = [[R.p0[0] + (L.p0[0] - R.p0[0]) * w0, R.p0[1] + (L.p0[1] - R.p0[1]) * w0]];
    for (let j = 0; j < NT; j++) {
      const w = wf((j + .5) / NT), a = R.ang[j] * (1 - w) + L.ang[j] * w, q = pts[j];
      pts.push([q[0] + Math.cos(a) * du, q[1] + Math.sin(a) * du]);
    }
    // Лист не уходит ниже верха обеих половин: где задел бы — приподнимается (у сгиба — нет, он растёт из него).
    const off = pts.map(q => Math.max(0, this.surfX(q[0]) + .0003 - q[1])); off[0] = 0;
    for (let j = 1; j <= NT; j++) off[j] = Math.max(off[j], off[j - 1] * .85, j < NT ? off[j + 1] * .85 : 0);
    for (let j = 0; j <= NT; j++) pts[j][1] += off[j] + PRE;
    return pts;
  }
  bendTurning() {
    const t = this.turn, k = clamp(this.turnS.v / PI, 0, 1), pts = this.leafPts(t.dir > 0 ? k : 1 - k, t.dir, this.shapes);
    this.turning.d.fill(pts, H / 2); this.turnPts = pts;
  }

  // ——— Поверхность и зоны ———
  // Высота верха над столом в точке (lx, lz) в осях тела: по тому же вееру, что нарисован (верхний лист своей половины и косой обрез), за обрезом — крышка;
  // у закрытой — вся толщина; пока что-то движется — с запасом.
  surfaceAt(lx, lz) {
    const { Bw, Dz, th } = this.s, inZ = Math.abs(lz) < Dz / 2;
    if (this.moving) return inZ && Math.abs(lx) < this.s.t + Bw + .02 ? this.topY + .001 : 0;
    if (this.pose !== 'open') {
      const sgn = this.pose === 'face' ? 1 : -1, x = lx * sgn;
      return inZ && x > -(this.joints.sag + C) && x < Bw ? th : 0;
    }
    if (!inZ) return 0;
    let y = -1;
    if (Math.abs(lz) < H / 2) for (const h of this.halves) { const w = h.world; for (let k = 0; k < w.length - 1; k++) { const a = w[k], b = w[k + 1]; if ((a[0] - lx) * (b[0] - lx) <= 0 && a[0] !== b[0]) y = Math.max(y, a[1] + (b[1] - a[1]) * (lx - a[0]) / (b[0] - a[0]) + (k < w.length - 2 ? PRE : 0)); } }
    if (y >= 0) return y;
    // Крышка (может быть наклонена): высота её верха в точке.
    for (const h of this.halves) { const a = h.w(0, 0), b = h.w(Bw, 0); if ((a[0] - lx) * (b[0] - lx) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (lx - a[0]) / (b[0] - a[0]) + .0002; }
    return Math.abs(lx) < this.cfg.d / 2 ? C : 0;
  }
  // Что под лучом на обрезе: lз половины k (0 — левая, 1 — правая; −1 — закрытая) и точки p в осях тела. frac — доля высоты блока от низа (от стола),
  // leaf — лист (с нуля), на который пришёлся луч, target — на какой i перейти (у правой половины — этот лист, у левой — следующий), page — номер страницы, куда попадёшь.
  edgeInfo(p, k) {
    const { t, T } = this.s, L = this.leaves, P = this.pages;
    if (this.pose !== 'open' || k < 0) {
      const f = clamp((p.y - C) / t, 0, 1), leaf = clamp(this.pose === 'back' ? Math.floor(f * L) : Math.floor((1 - f) * L), 0, L - 1);
      return { part: 'edge', side: this.pose === 'back' ? -1 : 1, k: -1, frac: f, leaf, target: leaf, page: Math.min(P, 2 * leaf + 1), closed: true, x: p.x, z: p.z };
    }
    const h = this.halves[k], left = k === 0, f = clamp(h.loc(p.x, p.y)[1] / Math.max(h.h, 1e-6), 0, 1), n = Math.max(1, Math.round(h.h / T));
    const i = this.rif ? clamp(Math.round(this.iS.v), 0, L) : this.i;
    const leaf = left ? clamp(Math.floor(f * n), 0, n - 1) : clamp(i + Math.floor((1 - f) * n), 0, L - 1), target = left ? leaf + 1 : leaf;
    return { part: 'edge', side: left ? -1 : 1, k, frac: f, leaf, target, page: Math.min(P, left ? 2 * target : 2 * target + 1), closed: false, x: p.x, z: p.z };
  }
  pageAt(hit) { return this.zone(hit).page ?? null; }
  // Обрез по лучу (рука ведёт по обрезу и выходит за его поле): пересечение с плоскостью поля у половины k (−1 — закрытая).
  edgeFromRay(ray, k) {
    const inv = this.body.matrixWorld.clone().invert(), o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv), s = this.s;
    let pt, n;
    if (k < 0) { const sg = this.pose === 'back' ? -1 : 1; pt = new THREE.Vector3(sg * (s.Bw + .007), 0, 0); n = new THREE.Vector3(1, 0, 0); }
    else { const h = this.halves[k], q = h.w(s.Wp + .007, 0); pt = new THREE.Vector3(q[0], q[1], 0); n = new THREE.Vector3(h.ex[0], h.ex[1], 0); }
    const dn = d.dot(n); if (Math.abs(dn) < 1e-6) return null;
    const tt = pt.clone().sub(o).dot(n) / dn; if (tt < 0) return null;
    return this.edgeInfo(o.add(d.multiplyScalar(tt)), k);
  }
  // Во что попал луч у раскрытой книги: лист (side — правая или левая половина), крышка, кожа (корешок, поля у головы и хвоста: их тянут целиком), обрез (передний край стопки или поле за ним). x, z — в осях тела.
  zone(hit) {
    const o = hit.object, p = this.body.worldToLocal(hit.point.clone()), part = o.userData.part, side = p.x >= this.G[0] ? 1 : -1;
    if (part === 'edge') return this.edgeInfo(p, o.userData.k ?? -1);
    if ((o === this.halves[0].stackMesh || o === this.halves[1].stackMesh) && hit.face?.materialIndex === 0) return this.edgeInfo(p, o === this.halves[0].stackMesh ? 0 : 1);
    if (part === 'mark') { const m = this.marks.fromHit(hit); return m ? { part: 'mark', mark: m, g: m.g, page: Math.min(this.pages, 2 * m.g), side, x: p.x, z: p.z } : { part: 'skin', side, x: p.x, z: p.z }; }
    if (part === 'skin') return { part: 'skin', side, x: p.x, z: p.z };
    const gutter = Math.abs(p.z) > H / 2 - .012 || Math.abs(p.x - this.G[0]) < .012;
    if (part === 'page') return { part: gutter ? 'skin' : 'page', side, x: p.x, z: p.z };
    return { part: Math.abs(p.z) > H / 2 + E - .004 ? 'skin' : 'cover', side, x: p.x, z: p.z };
  }

  // Возвращает true, пока что-то движется или пришла страница (нужно перерисовать кадр и тени); в покое ничего не пересчитывает.
  update(dt) {
    let moving = false;
    this.retarget();
    if (!this.paperOk && this.ensurePaper()) moving = true;
    if (this.rif) { this.stepRiffle(dt); moving = true; }
    if (this.covering) {
      const cm = !this.openS.resting || !this.backS.resting;
      this.openS.step(dt); this.backS.step(dt); this.pressS.step(dt); this.restS.step(dt); if (!this.rif) this.iS.step(dt);
      for (const q of this.rif ? [this.openS, this.backS, this.pressS, this.restS] : [this.openS, this.backS, this.pressS, this.restS, this.iS]) if (q.resting) q.set(q.t);
      const was = this.paged; this.layout(); if (this.paged !== was) this.syncPages();
      if (cm && this.openS.resting && this.backS.resting && this.pose !== 'open') this.snd('close', {});   // крышка легла
      moving = true;
    }
    const t = this.turn;
    if (t) {
      this.turnS.step(dt); this.bendTurning(); moving = true;
      // Лист лёг на глаз — угол в двух сотых радиана от цели и почти стоит: дальше пружина дрожит незаметно, ждать её покоя незачем.
      const ts = this.turnS; const hold = !!this.chain?.hold; if (!t.held && holdSettled(ts, hold) && (!hold || performance.now() - t.t0 >= HOLD_MIN)) this.finishTurn();
    }
    if (this.marks.update(dt)) moving = true;
    if (this.uploads.length) { this.commit(); moving = true; }
    if (this.fresh && !this.uploads.length) { this.fresh = false; moving = true; }
    return moving;
  }
  // keepMats: материалы не освобождать — когда книгу тут же заменяют такой же (другой PDF), их шейдеры (и тени) не собираются заново при первом показе новой.
  dispose(keepMats = false) {
    this.dead = true; clearTimeout(this.timer); this.stopFillers(); for (const u of this.uploads) u.bmp.close?.(); this.uploads = []; for (const [n, e] of [...this.imgs]) this.drop(n, e);
    for (const h of this.halves) h.dispose(keepMats);
    for (const m of [this.spine, this.fillm, this.turning, this.pad, ...this.pool]) m.d.geometry.dispose();
    this.marks.dispose();
    if (!keepMats) { this.turnMat.dispose(); this.flyMat.dispose(); for (const p of this.pool) if (p.mat !== this.flyMat) p.mat.dispose(); this.topMat.dispose(); this.backMat.dispose(); }
  }
}
Book.stage = STAGE;
