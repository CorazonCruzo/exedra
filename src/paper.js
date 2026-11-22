// Бумага: листы печатаются заново по строкам тем же оттиском, что и в машинке (seed у листа свой).
import * as THREE from 'three';
import { printLine, lineInks } from './typewriter.js';
import { paintPaperWith } from './typeink.js';
import { PagePool } from './pagepool.js';

export const A4 = { w: .21, h: .297 };
// Бумага — снимок настоящей страницы 1920 года, один на все листы, поэтому заметные приметы страницы оказывались бы на каждом листе
// в одном и том же месте («у нас на бумаге пятнышко всегда в одном месте… как будто нужен рандом и даже не на всякий лист», 2026-11-14).
// Приметы — отдельно от бумаги: это штампы, снятые с прежнего снимка (чистый лист из берлинского Чехова, book-paper.jpg: серое пятнышко
// и рыжие крапины). На лист они ложатся не всегда и где придётся — по числу листа (seed), так что в машинке, на столе, в подшивке и в PDF
// лист один и тот же. MARKS — приметы на том снимке шириной 1024: середина, радиус, откуда взять чистую бумагу взамен, на какой доле
// листов бывает.
const MARKS = [{ x: 338, y: 274, r: 15, from: [44, 30], chance: .3 }, { x: 729, y: 1224, r: 36, from: [-84, -30], chance: .25 }];
// Краска на листе сгущается шейдером (inkPaper), а примета для него — тоже «не бумага»: штамп заранее настолько же бледнее.
const MARK_FADE = .6;
let paper = null, stamps = [], stampScale = 1;
// im — снимок бумаги листов; marks — снимок, с которого берутся приметы (book-paper.jpg). Если это один и тот же снимок, приметы с него
// заодно сняты: на их месте — бумага по соседству.
export function setPaper(im, marks = null) {
  paper = im; stamps = []; dropPool();
  if (!im || !marks) return;
  const k = marks.width / 1024, c = Object.assign(document.createElement('canvas'), { width: marks.width, height: marks.height }), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(marks, 0, 0); stampScale = 1 / marks.width;
  for (const { x, y, r, from, chance } of MARKS) {
    const R = Math.round(r * k), n = R * 2, x0 = Math.round(x * k) - R, y0 = Math.round(y * k) - R;
    const was = g.getImageData(x0, y0, n, n), src = g.getImageData(x0 + Math.round(from[0] * k), y0 + Math.round(from[1] * k), n, n).data;
    const stamp = Object.assign(document.createElement('canvas'), { width: n, height: n }), sg = stamp.getContext('2d'), mark = sg.createImageData(n, n), d = was.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      // m — насколько точка внутри приметы: середина целиком, к краю круга сходит на нет.
      const t = Math.min(1, Math.max(0, (1 - Math.hypot(i + .5 - R, j + .5 - R) / R) / .35)), m = t * t * (3 - 2 * t), o = (j * n + i) * 4;
      for (let q = 0; q < 3; q++) {
        const clean = d[o + q] * (1 - m) + src[o + q] * m, dark = Math.max(0, 1 - d[o + q] / Math.max(clean, 1) - .04) * m;
        mark.data[o + q] = 255 * Math.pow(1 - dark, MARK_FADE); d[o + q] = clean;
      }
      mark.data[o + 3] = 255;
    }
    g.putImageData(was, x0, y0); sg.putImageData(mark, 0, 0); stamps.push({ stamp, R, chance });
  }
  if (im === marks) paper = c;
}
// Снимок бумаги листов (холст или картинка) — ярлыкам на папках нужен кусок настоящей бумаги.
export const paperSource = () => paper;
// seed — число листа: по нему на бумагу ложатся приметы; без него — чистая бумага (оборот листа).
export function paintPaper(g, W, H, seed = null) { paintPaperWith(g, W, H, seed, paper, stamps, stampScale); }
const size = (c, width) => { c.width = width; c.height = Math.round(width * 1448 / 1024); };
export function drawPage(c, s, width) {
  size(c, width);
  const g = c.getContext('2d'), scale = width / 1024; paintPaper(g, c.width, c.height, s.seed);
  s.lines.forEach((l, i) => printLine(g, l, i, { scale, fmt: s.fmt?.[i], seed: s.seed }));
  return c;
}
// Оборот листа: чистая бумага, сквозь неё чуть проступают буквы с лица — зеркально.
// Рисуется так, как его видно, когда лист перевёрнут налево: край у корешка справа.
const inkC = document.createElement('canvas');
export function drawBack(c, s, width) {
  size(c, width);
  const g = c.getContext('2d'), scale = width / 1024; paintPaper(g, c.width, c.height);
  size(inkC, width); const ig = inkC.getContext('2d'); ig.clearRect(0, 0, inkC.width, inkC.height);
  s.lines.forEach((l, i) => printLine(ig, l, i, { scale, fmt: s.fmt?.[i], seed: s.seed }));
  g.save(); g.globalAlpha = .1; g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(inkC, 0, 0); g.restore();
  return c;
}
export function blankPage(width = 512, seed = null) { const c = document.createElement('canvas'); size(c, width); paintPaper(c.getContext('2d'), c.width, c.height, seed); return c; }

// Листы на столе допечатываются по строке, когда браузер свободен: стол открывается сразу.
const queue = [];
let busy = false;
const idle = f => window.requestIdleCallback ? requestIdleCallback(f, { timeout: 300 }) : setTimeout(() => { const end = performance.now() + 8; f({ timeRemaining: () => end - performance.now() }); }, 30);
function drain(deadline) {
  try { do queue.shift()?.(); while (queue.length && deadline.timeRemaining() > 2); }
  finally { if (queue.length) idle(drain); else busy = false; }
}
// alive() — лист всё ещё на этом холсте; done() — строка готова.
export function inkLater(s, c, alive, done) {
  const g = c.getContext('2d'), scale = c.width / 1024;
  s.lines.forEach((l, i) => queue.push(() => { if (!alive()) return; printLine(g, l, i, { scale, fmt: s.fmt?.[i], seed: s.seed }); done(); }));
  if (queue.length && !busy) { busy = true; idle(drain); }
}

// Страницы подшивки печатает рабочий поток (`pagepool.js`, `pagework.js`): лист целиком (24 строки — около тысячи знаков, у каждого свой оттиск) стоил 0,3–0,5 с растеризации
// на каждый новый лист (замер 2026-11-21: рисование 20 мс, но холст досчитывался 290 мс, и экран вставал на 400–550 мс; оборот — ещё 240). Подшивка сперва кладёт чистую бумагу,
// а готовая страница (лицо и оборот) подменяет её, когда придёт; видимые страницы печатаются первыми, потом соседние листы вперёд и назад (`pri`).
// Не вышло завести поток (нет OffscreenCanvas, не загрузились шрифты) — запасной путь: те же буквы печатаются в главном потоке понемногу, по кадрам (`inkPages`): не больше
// INKING.glyphs знаков за кадр (каждый — около 0,2–0,3 мс видеокарты); число подстраивается по самому кадру: кадр дольше 17,5 мс — вдвое меньше, короче 9 мс — на один больше.
// Оборот там — зеркальный бледный отпечаток готового лица (одной печати хватает на обе стороны).
export const INKING = { glyphs: 6, min: 4, max: 24, upload: 90, last: 0 };
const pageJobs = new Set();
let pool = null;
// Новая бумага (`setPaper`) — потоки с прежней не нужны.
const dropPool = () => { pool?.close(); pool = null; };
export function pageJob(m, front, back, s) {
  const g = front.getContext('2d'), scale = front.width / 1024, job = { m, front, back, s, g, scale, row: 0, todo: [], pri: 0, dead: false, upAt: 0, dirty: false };
  job.local = () => { if (!job.dead) pageJobs.add(job); };
  job.finish = (fb, bb) => {
    front.getContext('2d').drawImage(fb, 0, 0, front.width, front.height); back.getContext('2d').drawImage(bb, 0, 0, back.width, back.height); fb.close(); bb.close();
    m.map.needsUpdate = true; if (m.userData.back?.value) m.userData.back.value.needsUpdate = true; m.userData.job = null;
  };
  m.userData.job = job;
  (pool ??= new PagePool({ paper, stamps, stampScale })).add(job);
  return job;
}
function jobDone(job) {
  const { back, front, m } = job, g = back.getContext('2d');
  g.save(); g.globalAlpha = .1; g.translate(back.width, 0); g.scale(-1, 1); g.drawImage(front, 0, 0, back.width, back.height); g.restore();
  m.map.needsUpdate = true; if (m.userData.back?.value) m.userData.back.value.needsUpdate = true; pageJobs.delete(job); m.userData.job = null;
}
export function inkPages(now = performance.now()) {
  const dt = INKING.last ? now - INKING.last : 0; INKING.last = now;
  if (!pageJobs.size) return false;
  if (dt > 17.5) INKING.glyphs = Math.max(INKING.min, INKING.glyphs * .5); else if (dt && dt < 9) INKING.glyphs = Math.min(INKING.max, INKING.glyphs + 1);
  let job = null; for (const j of pageJobs) if (!job || j.pri < job.pri) job = j;
  let n = Math.round(INKING.glyphs);
  while (n > 0) {
    if (!job.todo.length) {
      if (job.row >= job.s.lines.length) { jobDone(job); return true; }
      const i = job.row++; job.todo = lineInks(job.g, job.s.lines[i], i, { scale: job.scale, fmt: job.s.fmt?.[i], seed: job.s.seed }).reverse(); continue;
    }
    job.todo.pop()(); job.dirty = true; n--;
  }
  if (job.dirty && now - job.upAt > INKING.upload) { job.upAt = now; job.dirty = false; job.m.map.needsUpdate = true; }
  return true;
}
// Бумага без букв — общая текстура: по ней видно, где на листе краска, а где сама бумага.
let paperTex = null;
function paperTexture() {
  if (paperTex) return paperTex;
  // Скан не загрузился — листы залиты ровным цветом (paintPaper), такой же и «бумага без букв».
  let src = paper;
  if (!src) { src = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }); const g = src.getContext('2d'); g.fillStyle = '#e8dcbc'; g.fillRect(0, 0, 1, 1); }
  paperTex = new THREE.Texture(src); paperTex.colorSpace = THREE.SRGBColorSpace; paperTex.anisotropy = 8; paperTex.needsUpdate = true;
  return paperTex;
}
// Краска на листе. Издалека тонкие штрихи сливаются с бумагой и бледнеют — там её понемногу сгущаем, вблизи всё как напечатано.
// Оборот: свой холст (back), если он есть; иначе чистая бумага, сквозь которую чуть проступают буквы с лица — зеркально и размыто.
// Печатали на одной стороне листа, и с оборота видно лишь это.
// Насколько краска на листе в зале гуще, чем на холсте (и в PDF; задаёт бегунок «краска»); сгущение вдали; с какой яркости бумага начинает сжиматься и сколько ей ещё можно светлеть.
export const INK = { value: new THREE.Vector4(.7, 1.1, .6, .4) };
export function inkPaper(m, size, back = null) {
  const uBack = { value: back }, u = { uPaper: { value: paperTexture() }, uSize: { value: new THREE.Vector2(size.width, size.height) }, uBack, uInk: INK };
  m.userData.back = uBack;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = 'uniform sampler2D uPaper, uBack;\nuniform vec2 uSize;\nuniform vec4 uInk;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      // inkK — сколько света пропускает краска в этой точке; inkThick — во сколько раз она здесь гуще, чем на холсте.
      vec3 inkK = vec3(1.), inkThick = vec3(1.);
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec3 pap = texture2D(uPaper, vMapUv).rgb;
        vec3 ink = clamp(sampledDiffuseColor.rgb / max(pap, vec3(.03)), 0., 1.);
        if (gl_FrontFacing) {
          // Насколько лист меньше своей текстуры на экране — по площади: лист под углом (вдоль одной оси) сжат, но не далёк.
          vec2 fw = fwidth(vMapUv) * uSize;
          float far = clamp(log2(max(sqrt(fw.x * fw.y), 1.)), 0., 3.);
          inkThick = pow(max(ink, vec3(1e-4)), vec3(uInk.x + far * uInk.y));
          inkK = ink * inkThick; sampledDiffuseColor.rgb *= inkThick;
        } else {
          ${back ? 'sampledDiffuseColor = texture2D(uBack, vec2(1. - vMapUv.x, vMapUv.y));' : `
          vec3 soft = clamp(texture2D(map, vMapUv, 2.).rgb / max(texture2D(uPaper, vMapUv, 2.).rgb, vec3(.03)), 0., 1.);
          vec3 show = mix(vec3(1.), soft, .14);
          inkThick = show / max(ink, vec3(1e-3)); sampledDiffuseColor.rgb = pap * show;`}
        }
        diffuseColor *= sampledDiffuseColor;
      #endif`).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      // Свечение листа в машинке — от бумаги, а не от букв: краска в нём так же густа, а на обороте её нет.
      totalEmissiveRadiance *= inkThick;`).replace('#include <opaque_fragment>', `
      // Бумага под самой лампой не выгорает добела: яркость листа сжимаем целиком, вместе с буквами, — и буквы видны.
      float lit = dot(outgoingLight / max(inkK, vec3(.05)), vec3(.2126, .7152, .0722));
      if (lit > uInk.z) outgoingLight *= (uInk.z + uInk.w * (1. - exp(-(lit - uInk.z) / uInk.w))) / lit;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => back ? 'page2' : 'page1';
  m.needsUpdate = true;
  return m;
}
// Какие лампы достают до листов на столе (маски ламп из room.js, lightMasks): новый лист получает их сразу, как остальные листы.
export const PAGE_LIGHTS = {};
// Материал листа: лицо — свой холст, оборот — другой (с проступающим текстом) или посчитанный по лицу. Рельеф волокон общий.
export function pageMaterial(front, back, normalMap) {
  const tf = new THREE.CanvasTexture(front); tf.colorSpace = THREE.SRGBColorSpace; tf.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tf, normalMap, normalScale: new THREE.Vector2(.45, .45), roughness: .93, side: THREE.DoubleSide });
  Object.assign(m.defines, PAGE_LIGHTS);
  let tb = null;
  if (back) { tb = new THREE.CanvasTexture(back); tb.colorSpace = THREE.SRGBColorSpace; tb.anisotropy = 8; }
  return inkPaper(m, front, tb);
}
export function disposeMaterial(m) { const job = m.userData.job; if (job) { pageJobs.delete(job); job.dead = true; m.userData.job = null; } m.map?.dispose(); m.userData.back?.value?.dispose(); m.dispose(); }
