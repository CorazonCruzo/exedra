// «Читальный зал»: стол на галерее старой библиотеки, зелёная лампа, пишущая машинка.
// Внизу — длинный зал с рядами столов и тёплыми пятнами ламп, по стенам — книжные шкафы в два яруса.
// Стол стоит на галерее у балюстрады лицом в зал (по умолчанию) или у стены со шкафами (?desk=wall).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTypewriter, sound, BOOK } from './typewriter.js';
import { makePdf, download } from './pdf.js';
import { Spring, Y, clamp, fit, radial, sfx, metricUV, shadows, plainImages } from './util.js';
import { bookSound, loadBookSounds } from './booksound.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { A4, setPaper, paintPaper, drawPage, blankPage, inkLater, inkPages, pageMaterial, inkPaper, INK, disposeMaterial, PAGE_LIGHTS } from './paper.js';
import { openShuffle, shuffleOpen } from './shuffle-screen.js';
import { buildDesk } from './desk.js';
import { buildTableLamps, lampLit, tableLight, USUAL } from './tablelamps.js';
import { Binder, BINDER, CX, PERK } from './binder.js';
import { LABEL_KEY } from './label.js';
import { Book, bookSize } from './book.js';
import { MARK_MAX } from './marks.js';
import { buildStand, bookPlace, NOTCH, NOTCHES, STAND_URL } from './stand.js';
import { BINDINGS, bindingMats, bindingOf, bindingRatio } from './bindings.js';
import { saveBook, openBook as openFile, removeBook, listBooks } from './bookfile.js';
import { buildPaperweight, FIGURES, SLAB } from './paperweight.js';
import { fillShelves, liftUpper } from './books.js';
import { buildCeiling, ART_SETS, sweep } from './ceiling.js';
import { sunAt, skyAt, clockFrom, shaftMaterial, shaftGeometry } from './sun.js';
import { settled, stopLoader } from './loader.js';
import { buildCatalog } from './catalog.js';
import { leadedSide, leadedFan, fanPanes } from './glass.js';
import { buildNook, placeLounge, loadLounge, loungeVariant, nookBooks, panelWorld } from './lounge.js';
import { buildCinema } from './cinema.js';
import { parseVideoLink } from './webplayers.js';
import { filmLibrary } from './filmlib.js';
import { makeTour } from './tour.js';
import { deskBlob as packDesk, readDesk, applyDesk, sweepBooksExcept, DeskError, mb } from './deskfile.js';
import { t, tn, lang, LANGS, setLang, applyDom } from './i18n.js';
applyDom();
// Справка, клавиши: что делает клавиша — жирным (до первой скобки, двоеточия, точки с запятой или тире), пояснение — следом, светлее.
for (const el of document.querySelectorAll('#help .legend li > span:last-child')) {
  const txt = el.textContent, i = txt.search(/\s*[(（]|[:：;；]\s?|\s[—–]\s|，|、/);   // до скобки, двоеточия, точки с запятой или тире
  if (i > 0 && i < 70) { const b = document.createElement('b'); b.textContent = txt.slice(0, i); el.replaceChildren(b, txt.slice(i)); }
  else el.replaceChildren(Object.assign(document.createElement('b'), { textContent: txt }));
}

// Отражённый свет нижнего зала: свет ламп, вернувшийся от паркета, столов и шкафов, — в жизни он заполняет любую тень, без него
// всё, что отвёрнуто от ламп (спинки стульев, торцы и ножки столов), уходит в чистый чёрный. Это общий свет сцены (AmbientLight, hallFill
// ниже), но достаётся он только материалам нижнего зала, помеченным below(): стульям, столам, лампам на них и паркету. Остальным он
// выключен при сборке шейдера и ничего не стоит. (Проба «всем материалам, но по высоте точки» стоила 0,7 мс кадра — замер 2026-11-14.)
const FILL = { color: 0xffb880, k: .1 };
const below = m => { m.defines = { ...m.defines, HALL_FILL: 1 }; return m; };
THREE.ShaderChunk.lights_fragment_begin = '#ifndef HALL_FILL\n\t#define HALL_FILL 0\n#endif\n' + THREE.ShaderChunk.lights_fragment_begin.replace('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
  'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * float( HALL_FILL );');
// Тень солнца считается только там, где оно может светить: грань к нему лицом и свет не погашен. Правка — до первой сборки шейдеров.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]',
  'directLight.color *= ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0. && dot( directLight.color, vec3( 1. ) ) > 0. ) ? getShadow( directionalShadowMap[ i ]')
  // Отражение света лампы считается под условием «лампа сюда достаёт» (за пределом дальности и вне конуса её свет и так нулевой).
  // Картинка от этого не меняется, а шейдер видеокарте даётся намного легче: без условия одиннадцатая лампа зала (над дверью) уронила кадр
  // с 27 до 46 мс — пропала плавность при поворотах и ходьбе; с условием — 20 мс, и лишняя лампа стоит меньше миллисекунды.
  // Замерено на MacBook Pro M2 Pro, Chrome, 3456 × 1984. Сами условия работу не экономят (лампа с нулевой силой стоит столько же):
  // дешевле кадр делает только лампа, которой в списке света нет, — а смена этого списка на ходу пересобирает все шейдеры (секунды).
  .replaceAll('RE_Direct( directLight, geometryPosition,', 'if ( directLight.visible ) RE_Direct( directLight, geometryPosition,');
// Лампы по материалам: в шейдер материала попадают только лампы, которые достают до его вещей (lightMasks ниже) — по биту на лампу
// в POINT_MASK и SPOT_MASK, в порядке списка ламп. Без масок — все лампы.
{
  const only = (chunk, kind) => chunk.replace(new RegExp(`(for \\( int i = 0; i < NUM_${kind}_LIGHTS; i \\+\\+ \\) \\{)([\\s\\S]*?)(\\n\\t\\}\\s+#pragma unroll_loop_end)`),
    `$1\n\t\t#if ( ( ${kind}_MASK >> UNROLLED_LOOP_INDEX ) & 1 ) == 1$2\n\t\t#endif$3`);
  THREE.ShaderChunk.lights_fragment_begin = '#ifndef POINT_MASK\n\t#define POINT_MASK 2147483647\n#endif\n#ifndef SPOT_MASK\n\t#define SPOT_MASK 2147483647\n#endif\n'
    + only(only(THREE.ShaderChunk.lights_fragment_begin, 'POINT'), 'SPOT');
}
// Цветокоррекция кадра — «кинематографичный тёплый свет» (просьба пользователя 2026-11-13). Тепло — только в светах: чем светлее место кадра,
// тем оно теплее (лампы, известь, бумага, блики на дереве), а тени и полутона остаются своего цвета — паркет, перила и шкафы не сливаются
// в один янтарный тон (первый вариант грел весь кадр и добавлял насыщенность — «всё одинаковое стало, перебор сильный»).
// Потом лёгкий плёночный изгиб: тени чуть глубже. Всё в одном месте, для всего кадра; ?grade=0 — без неё.
const GRADE = new URLSearchParams(location.search).get('grade') !== '0' && { warm: [1.04, 1, .86], from: .12, to: .65, curve: .14 };
if (GRADE) THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `
vec3 CustomToneMapping( vec3 color ) {
	color = NeutralToneMapping( color );
	color *= mix( vec3( 1. ), vec3( ${GRADE.warm.join(', ')} ), smoothstep( ${GRADE.from.toFixed(3)}, ${GRADE.to.toFixed(3)}, dot( color, vec3( .2126, .7152, .0722 ) ) ) );
	vec3 c = pow( saturate( color ), vec3( 1. / 2.2 ) );
	c = mix( c, c * c * ( 3. - 2. * c ), ${GRADE.curve.toFixed(3)} );
	return pow( c, vec3( 2.2 ) );
}`);
const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const hint = (t, fade) => { const h = $('hint'); h.style.opacity = 0; setTimeout(() => { h.innerHTML = t; h.style.opacity = t ? 1 : 0; if (fade) setTimeout(() => { if (h.innerHTML === t) h.style.opacity = 0; }, fade); }, 300); };

// Зернистость плёнки — шум, нарисованный один раз.
{
  const c = Object.assign(document.createElement('canvas'), { width: 160, height: 160 }), g = c.getContext('2d'), d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); document.documentElement.style.setProperty('--noise', `url(${c.toDataURL()})`);
}

// ——— Рендер ———
// Холст с альфой: в окне экрана уголка зал прозрачен, сквозь него виден плеер YouTube под холстом (cinema.js). Везде остальном фон непрозрачен (scene.background).
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
// Чёткость: в покое — полная (до 2× на ретине), пока взгляд движется — MOVE_PR (`movingPr` в `draw`). ?movepr=2 — не снижать.
const FULL_PR = Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2), MOVE_PR = Math.min(FULL_PR, Number(Q.get('movepr')) || 1.5);
renderer.setPixelRatio(FULL_PR);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Тени перерисовываются, только когда что-то сдвинулось.
renderer.shadowMap.autoUpdate = false;
// Отсечение по плоскости у отдельных материалов (чучела на полке не рисуются ниже неё).
renderer.localClippingEnabled = true;
renderer.toneMapping = GRADE ? THREE.CustomToneMapping : THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.3;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0806);
// Туман только вдали: на столе его нет.
scene.fog = new THREE.Fog(0x0b0806, 5, 34);
scene.environmentIntensity = .35;
const FOV = 50, camera = new THREE.PerspectiveCamera(FOV, 1, .02, 60);
// Угол обзора меняет только щипок — когда подойти ближе или отойти дальше уже некуда.
let fovGoal = FOV;
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
resize(); addEventListener('resize', resize);
const hemi = new THREE.HemisphereLight(0x8a7458, 0x0c0907, .13); scene.add(hemi);
const hallFill = new THREE.AmbientLight(FILL.color, 0); scene.add(hallFill);

const loader = new THREE.TextureLoader(), gltf = plainImages(new GLTFLoader());
const tex = (u, srgb, rep = [1, 1]) => { const t = loader.load(u); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
// Одна и та же карта с разным повтором — текстуры с общим источником: картинка в памяти видеокарты одна.
// Текстура, заведённая до загрузки, узнаёт о ней из onLoad.
const shared = {};
const texShared = (u, srgb, rep) => {
  const s = shared[u] ??= { copies: [] };
  s.base ??= loader.load(u, () => s.copies.forEach(t => { t.needsUpdate = true; }));
  const t = new THREE.Texture(); t.source = s.base.source;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (s.base.image) t.needsUpdate = true; s.copies.push(t); return t;
};
const wood = (name, rep, color = 0xffffff, rough = .7) => new THREE.MeshStandardMaterial({ map: texShared(`assets/textures/${name}-color.jpg`, true, rep), normalMap: texShared(`assets/textures/${name}-normal.jpg`, false, rep), roughnessMap: texShared(`assets/textures/${name}-rough.jpg`, false, rep), color, roughness: rough, envMapIntensity: .5 });
const loadModel = url => gltf.loadAsync(url).then(g => g.scene);

// ——— Зал ———
// Галерея (балкончик) на высоте пяти метров, за балюстрадой — зал.
const HALL = { w: 14, len: 32, depth: 5, top: 5.6 }, RAIL_Z = -1.15;
// Глубина главной галереи от балюстрады до задней стены: стол, стул и за ним почти сразу стена.
const GAL = 3.85;
// Уголок под балконом (lounge.js): вариант из ?lounge=a|b|c (по умолчанию a), null — без уголка (?lounge=0).
const NOOK = loungeVariant(new URLSearchParams(location.search));
// Тона дерева — средний цвет (sRGB), рисунок волокон остаётся: палисандр — обшивка, балюстрады, фриз, карниз и столы;
// шкафы — цвета горького шоколада; паркет — ореховый.
const WOOD_TONE = 0x30140f, SHELF_TONE = 0x2a1a14, FLOOR_TONE = 0x4d280f;
// Паркет: скан ёлочки тонируется к среднему цвету, в зале внизу — на десятую темнее.
const HERRINGBONE_MEAN = [.2946, .1636, .0753];
// Средний цвет скана орехового шпона (линейный) и материалы, которые перекрашиваются.
const WALNUT_MEAN = [.5002, .3261, .2106], woodMats = {};
const tintFor = mean => (hex, k = 1) => { const c = new THREE.Color(hex); return c.setRGB(c.r / mean[0] * k, c.g / mean[1] * k, c.b / mean[2] * k); };
const woodTint = tintFor(WALNUT_MEAN), floorTint = tintFor(HERRINGBONE_MEAN);
// Средняя яркость дерева в текстуре шкафа (линейная) — от неё отсчитываются светлые и тёмные волокна.
const SHELF_LUM = .0242, shelfTone = { value: new THREE.Color(SHELF_TONE) };
function toneShelves(m) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uShelfTone = shelfTone;
    sh.fragmentShader = 'uniform vec3 uShelfTone;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        float shelfLum = dot(sampledDiffuseColor.rgb, vec3(.2126, .7152, .0722)) / ${SHELF_LUM};
        sampledDiffuseColor.rgb = uShelfTone * shelfLum;
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  m.customProgramCacheKey = () => 'shelves';
  return m;
}
// Боковые галереи вдоль шкафов: перила на |x| = rail; пройти можно между перилами и шкафами, до самого дальнего торца.
// Там галерея поворачивает и идёт вдоль торца (перила на z = far): верхний ярус обходится кругом.
const SIDE = { rail: HALL.w / 2 - 1.5, far: RAIL_Z - HALL.len + 1.5 };
// Дальний торец: шкафы стоят от левого угла вплотную (E — до лица боковых шкафов, W — ширина шкафа). Внизу их два, и справа остаётся
// широкий простенок с дверью (bay); вверху три — над дверью тоже шкаф, справа узкая полоса обшивки (strip). F — толща обшивки.
const FAR = (() => { const E = HALL.w / 2 - .72, W = 3.95; return { lower: [-E + W / 2, -E + 1.5 * W], upper: [-E + W / 2, -E + 1.5 * W, -E + 2.5 * W], bay: [-E + 2 * W, E], strip: [-E + 3 * W, E], F: .05 }; })();
// knocker — дверной молоток, по одному на створку: львиная голова с кольцом, скан молотка из Музеев Ватикана (fcloss, CC BY 4.0);
// в модели спина на z = 0, лицо к +z, начало — в середине головы (голова 22 см); y — высота середины головы над полом, k — во сколько раз
// молоток крупнее настоящего: дверь в три с половиной метра, на ней он иначе теряется.
// tone — свой тон дерева створок: тёмный, шоколадный — в семью шкафов по сторонам, а не стен.
// w, h — проём (створки высотой leaf, брус rail и фрамуга); casing — ширина обрамления (наличник и пилястра); frame — его тон: чёрное дерево,
// на тон темнее створок — как шкафы («горький шоколад»).
const DOOR = { x: (FAR.bay[0] + FAR.bay[1]) / 2, w: 1.6, leaf: 2.78, rail: .1, h: 3.5, casing: .32, tone: [0x24140e], frame: 0x1b0f0a, knocker: { url: 'assets/models/door/lion-knocker.glb', y: 1.62, k: 1.3 }, url: 'https://chestnykh.net/' };
// Дверь — выход из зала: нажать на неё — подойти и получить вопрос, выйти ли к другим работам автора (url). doorParts — всё, на что можно нажать.
const doorParts = [];
// Фриз над шкафами: от венца шкафов (y0) до карниза (y1), лицо — в F от стены.
const FRIEZE = { F: .34, y0: 4.42, y1: HALL.top - .36 };
function buildHall(art, casts, mural) {
  // Стены и всё крупное — заслон и приёмник для солнца; sunOnly — тень только для солнца: в тени настольной лампы зал не участвует.
  const shell = o => { o.castShadow = o.receiveShadow = true; o.userData.sunOnly = true; scene.add(o); };
  // Стены, полы и шкафы — одна тёплая древесная семья. Дерево — скан орехового шпона, полы — паркет ёлочкой (Poly Haven);
  // плитки в настоящем размере (1 и 3,4 м): у стен, перил и фриза развёртка в метрах (metricUV), у полов — по их размеру.
  const RW = 1, HB = 1 / 3.4;
  // Полы — развёрткой в мировых координатах (u — x, v — z): ёлочка главной и боковых галерей сходится без шва.
  // Скан — светлый дуб; под морилкой он темнеет до орехового тона шкафов и перил.
  const panel = wood('walnut', [RW, RW], 0xffffff, .6), parquet = wood('herringbone', [HB, HB], 0xffffff, 1.8), mahogany = wood('walnut', [RW, RW], 0xffffff, .5);
  woodMats.panel = panel; woodMats.rail = mahogany; woodMats.floor = parquet; tintWood();
  const gfloor = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, GAL).rotateX(-Math.PI / 2).translate(0, 0, RAIL_Z + GAL / 2), 'x'), parquet); gfloor.receiveShadow = true; scene.add(gfloor);
  // Под галереей — тёмная ниша: потолок из досок и стена; снизу пол галереи не просвечивает.
  const soffit = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, GAL).rotateX(Math.PI / 2)), panel); soffit.position.set(0, -.42, RAIL_Z + GAL / 2); shell(soffit);
  const under = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, HALL.depth - .42).rotateY(Math.PI)), panel); under.position.set(0, -(HALL.depth + .42) / 2, RAIL_Z + GAL);
  // С уголком стена под галереей принимает тень солнца, как остальные стены (иначе днём она горела бы под балконом).
  if (NOOK) shell(under); else scene.add(under);
  // Паркет зала идёт и под галерею — туда, где уголок (nookZ); без уголка (?lounge=0) пола там нет, как раньше.
  const nookZ = NOOK ? GAL : 0;
  const hfloor = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, HALL.len + nookZ).rotateX(-Math.PI / 2).translate(0, -HALL.depth, RAIL_Z - HALL.len / 2 + nookZ / 2), 'x'), woodMats.hall = below(wood('herringbone', [HB, HB], 0xffffff, 1.8))); hfloor.receiveShadow = true; scene.add(hfloor);
  const fascia = new THREE.Mesh(metricUV(new THREE.BoxGeometry(2 * SIDE.rail, .42, .1)), panel); fascia.position.set(0, -.21, RAIL_Z - .05); scene.add(fascia);
  // Под боковыми галереями пол главной закрыт торцами: снизу, из зала, сквозь него не видно (верх торцов ниже пола галерей — не мерцают).
  for (const s of [-1, 1]) { const cap = new THREE.Mesh(metricUV(new THREE.BoxGeometry(HALL.w / 2 - SIDE.rail, .32, .1)), panel); cap.position.set(s * (SIDE.rail + (HALL.w / 2 - SIDE.rail) / 2), -.26, RAIL_Z - .05); shell(cap); }
  // Балюстрада: поручень, нижний брус и точёные балясины. По краям она поворачивает вдоль боковых галерей — туда можно пройти.
  const rail = new THREE.Mesh(metricUV(new THREE.BoxGeometry(2 * SIDE.rail, .07, .12)), mahogany); rail.position.set(0, .96, RAIL_Z); rail.castShadow = true; scene.add(rail);
  const sill = new THREE.Mesh(metricUV(new THREE.BoxGeometry(2 * SIDE.rail, .08, .14)), mahogany); sill.position.set(0, .04, RAIL_Z); scene.add(sill);
  const prof = [[0, 0], [.03, 0], [.032, .05], [.022, .09], [.02, .2], [.034, .36], [.04, .5], [.03, .62], [.018, .72], [.022, .8], [.03, .84], [.03, .88], [0, .88]].map(([r, y]) => new THREE.Vector2(r, y));
  const baluster = new THREE.LatheGeometry(prof, 18); baluster.translate(0, .08, 0);
  const n = Math.floor(2 * SIDE.rail / .16), balusters = new THREE.InstancedMesh(baluster, mahogany, n), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) balusters.setMatrixAt(i, m.makeTranslation((i - (n - 1) / 2) * .16, 0, RAIL_Z));
  balusters.castShadow = true; scene.add(balusters);
  // На углах — точёные тумбы, на них сходятся перила.
  for (const s of [-1, 1]) for (const z of [RAIL_Z, SIDE.far]) {
    const post = new THREE.Mesh(metricUV(new THREE.BoxGeometry(.13, 1.04, .13), 'y'), mahogany); post.position.set(s * SIDE.rail, .52, z); shell(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 10), mahogany); cap.position.set(s * SIDE.rail, 1.085, z); cap.scale.y = .7; shell(cap);
  }
  // Свет солнца входит только в окна.
  for (const s of [-1, 1]) { const wall = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.len + 6, HALL.depth + HALL.top)), panel); wall.geometry.rotateY(-s * Math.PI / 2); wall.position.set(s * HALL.w / 2, (HALL.top - HALL.depth) / 2, RAIL_Z - HALL.len / 2 + 3); shell(wall); }
  const back = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, HALL.depth + HALL.top)), panel); back.position.set(0, (HALL.top - HALL.depth) / 2, RAIL_Z - HALL.len); shell(back);
  // Стена за галереей — под штофом и панелями задней стены (они в 2–4 мм перед ней). С дальнего конца зала, за 36 м, глубина различается
  // шагами в 4 мм, и стена проступала сквозь штоф мерцающими пятнами: её глубина чуть отодвинута (polygonOffset), сама она на месте.
  const behind = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(HALL.w, HALL.top + .42)), woodMats.behind = Object.assign(panel.clone(), { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 6 })); behind.geometry.rotateY(Math.PI); behind.position.set(0, (HALL.top - .42) / 2, RAIL_Z + GAL); shell(behind);
  for (const o of [gfloor, fascia, sill, balusters]) o.castShadow = o.receiveShadow = true;
  fascia.userData.sunOnly = sill.userData.sunOnly = true;
  buildFrieze(mahogany); buildBackWall(mahogany, casts);
  if (NOOK) {
    // Дерево, штоф и штукатурка уголка: те же, что в зале, плюс отражённый свет нижнего зала (below).
    const nookWood = below(mahogany.clone()); (woodMats.extra ??= []).push(nookWood);
    const nookDamask = below(backDamask.clone());
    const lime = o => below(new THREE.MeshStandardMaterial({ map: texShared('assets/textures/plaster-color.jpg', true, [1 / 2.23, 1 / 2.23]), normalMap: texShared('assets/textures/plaster-normal.jpg', false, [1 / 2.23, 1 / 2.23]), roughness: .92, envMapIntensity: .4, ...o }));
    // Известь потолка — темнее и спокойнее панели.
    // Из текстуры штукатурки (плиты со швами через 56 см) на панель берётся один кусок между швами, растянутый на всю ширину: экран без полос.
    // Спокойная матовая панель: без свечения и заметно темнее прежней (та читалась как светящийся экран); проекция ляжет на неё позже.
    const plaster = lime({ color: new THREE.Color(.46, .44, .38) }); plaster.roughness = 1; plaster.envMapIntensity = .15;
    for (const k of ['map', 'normalMap']) plaster[k].repeat.set(.2 / 3.5, 1 / 2.23), plaster[k].offset.set(.13, 0);
    buildNook({ scene, RAIL_Z, GAL, HALL, panelling, box, sweep, metricUV, wood: nookWood, damask: nookDamask, plaster, lime: lime({ color: 0x8a826f }) }, NOOK);
  }
  // Над стенами — своды и купол (ceiling.js). Карниз лежит на фризе.
  ceiling = buildCeiling(scene, { w: HALL.w, z0: RAIL_Z + GAL, z1: RAIL_Z - HALL.len, y0: HALL.top, art, cornice: FRIEZE.F, wood: mahogany, casts, mural, limeMaps: { map: tex('assets/textures/plaster-color.jpg', true), normalMap: tex('assets/textures/plaster-normal.jpg', false) } });
  // Свет люстр — сразу, вместе с залом: позже новые лампы заставили бы пересобрать все шейдеры.
  const hk = ceiling.hooks;
  for (const i of [0, Math.floor(hk.length / 2), hk.length - 1]) { const l = new THREE.PointLight(0xffc98a, 10, 21, 1.4); l.position.set(hk[i].x, ceiling.chandelierY, hk[i].z); scene.add(l); chandelierLights.push(l); }
  // Солнце: одна тень на весь зал, перерисовывается, только когда солнце сдвинулось. Лучи в воздухе — от каждого освещённого окна.
  sun = new THREE.DirectionalLight(0xffffff, 0); sun.castShadow = true; sun.shadow.autoUpdate = false;
  sun.shadow.mapSize.setScalar(matchMedia('(pointer: coarse)').matches ? 2048 : 4096); sun.shadow.bias = -.0003; sun.shadow.normalBias = .018;
  scene.add(sun, sun.target);
  shafts = new THREE.Mesh(new THREE.BufferGeometry(), shaftMaterial()); shafts.frustumCulled = false; shafts.renderOrder = 2; scene.add(shafts);
  // Боковые галереи — от главной до дальнего торца: пол, кромка, перила.
  // Паркет боковых галерей — в том же масштабе, что на главной.
  // Перила боковых галерей кончаются у дальней (sideLen), пол идёт до самой стены.
  const sideW = HALL.w / 2 - SIDE.rail, sideLen = RAIL_Z - SIDE.far, sideZ = RAIL_Z - sideLen / 2;
  for (const s of [-1, 1]) {
    const ledge = new THREE.Mesh(metricUV(new THREE.BoxGeometry(sideW, .1, HALL.len).translate(s * (SIDE.rail + sideW / 2), -.05, RAIL_Z - HALL.len / 2), 'x'), parquet); shell(ledge);
    const edge = new THREE.Mesh(metricUV(new THREE.BoxGeometry(.1, .42, sideLen)), panel); edge.position.set(s * (SIDE.rail - .05), -.21, sideZ); shell(edge);
    for (const [y, h, d] of [[.96, .07, .12], [.04, .08, .14]]) { const lr = new THREE.Mesh(metricUV(new THREE.BoxGeometry(d, h, sideLen)), mahogany); lr.position.set(s * SIDE.rail, y, sideZ); shell(lr); }
    const k = Math.floor(sideLen / .16) - 1, bs = new THREE.InstancedMesh(baluster, mahogany, k);
    for (let i = 0; i < k; i++) bs.setMatrixAt(i, m.makeTranslation(s * SIDE.rail, 0, RAIL_Z - .16 - i * .16));
    bs.castShadow = true; bs.userData.sunOnly = true; scene.add(bs);
  }
  // Галерея вдоль дальнего торца: такой же пол, кромка и перила — от одной боковой до другой.
  {
    const W = 2 * SIDE.rail, zf = SIDE.far;
    const ledge = new THREE.Mesh(metricUV(new THREE.BoxGeometry(W, .1, sideW).translate(0, -.05, zf - sideW / 2), 'x'), parquet); shell(ledge);
    const edge = new THREE.Mesh(metricUV(new THREE.BoxGeometry(W, .42, .1)), panel); edge.position.set(0, -.21, zf + .05); shell(edge);
    for (const [y, h, d] of [[.96, .07, .12], [.04, .08, .14]]) { const lr = new THREE.Mesh(metricUV(new THREE.BoxGeometry(W, h, d)), mahogany); lr.position.set(0, y, zf); shell(lr); }
    const bs = new THREE.InstancedMesh(baluster, mahogany, n);
    for (let i = 0; i < n; i++) bs.setMatrixAt(i, m.makeTranslation((i - (n - 1) / 2) * .16, 0, zf));
    bs.castShadow = true; bs.userData.sunOnly = true; scene.add(bs);
  }
  buildFarEnd(mahogany, casts);
  buildReadingTables(mahogany);
}
// Обшивка филёнками в местных осях стены (x — вдоль, y — вверх, z — в зал), потом — на место (M): толща F за лицом,
// обвязка снизу и сверху, стойки в xs, между ними — выпуклые филёнки с фаской. Развёртка — в метрах, волокна вдоль обвязки и стоек.
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z), Z3 = new THREE.Vector3(0, 0, 1);
function panelling(M, along, len, y0, y1, F, xs) {
  const H = y1 - y0, local = [];
  local.push([box(len, H, F, len / 2, y0 + H / 2, -F / 2), along]);
  local.push([box(len, .1, .03, len / 2, y0 + .05, .015), along], [box(len, .08, .03, len / 2, y1 - .04, .015), along]);
  for (const x of xs) local.push([box(.1, H - .18, .03, clamp(x, .05, len - .05), y0 + .1 + (H - .18) / 2, .015), 'y']);
  // Филёнка в раме: плоское поле, по краю проёма — профилированная накладка (валик с полочкой), углы на ус: в каждом углу два кадра.
  const framed = [], c = (x, y, dx, dy) => { const f = { p: new THREE.Vector3(x, y, 0), n: Z3, b: new THREE.Vector3(dx, dy, 0) }; return [f, f]; };
  for (let i = 0; i + 1 < xs.length; i++) {
    if (xs[i + 1] - xs[i] < .32) continue;
    const x0 = clamp(xs[i], .05, len - .05) + .05, x1 = clamp(xs[i + 1], .05, len - .05) - .05, ya = y0 + .1, yb = y1 - .08;
    const fr = [...c(x0, ya, 1, 1), ...c(x1, ya, -1, 1), ...c(x1, yb, -1, -1), ...c(x0, yb, 1, -1), ...c(x0, ya, 1, 1)];
    framed.push(sweep([[0, 0], [.014, 0], [.022, .006], [.03, .012], [.034, .022], [.03, .034], [.022, .042], [.016, .05], [.01, .055], [0, .056]], fr, false, true));
  }
  return [...local.map(([g, grain]) => { g.deleteAttribute('uv'); g.applyMatrix4(M); return metricUV(g.index ? g.toNonIndexed() : g, grain); }),
    ...framed.map(g => g.toNonIndexed().applyMatrix4(M))];
}
// Простенки дальнего торца — обшивка филёнками (низкая панель и высокое поле): внизу — по сторонам двери, за дверью — гладкая доска;
// вверху — узкая полоса у правого угла. Дверь освещена своей лампой (как лампы задней стены — горит всегда): бра по сторонам ставятся позже.
function buildFarEnd(wood, casts) {
  const z = RAIL_Z - HALL.len, up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(0, 0, 1), t = new THREE.Vector3(1, 0, 0), parts = [];
  const wall = (x0, x1, y0, y1) => {
    const M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(x0, 0, z + FAR.F), len = x1 - x0, xs = [0, len];
    parts.push(...panelling(M, 'x', len, y0, y0 + 1, FAR.F, xs), ...panelling(M, 'x', len, y0 + 1, y1, FAR.F, xs));
  };
  const [b0, b1] = FAR.bay, m = DOOR.x - DOOR.w / 2 - DOOR.casing - b0, y0 = -HALL.depth, y1 = -.42;
  wall(b0, b0 + m, y0, y1); wall(b1 - m, b1, y0, y1); wall(...FAR.strip, 0, FRIEZE.y0);
  parts.push(metricUV(box(b1 - b0 - 2 * m, y1 - y0, FAR.F, DOOR.x, (y0 + y1) / 2, z + FAR.F / 2).toNonIndexed(), 'x'));
  const mesh = new THREE.Mesh(mergeGeometries(parts), wood); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.sunOnly = true; scene.add(mesh);
  const l = new THREE.PointLight(0xffc48a, 0, 7, 1.5); l.position.set(DOOR.x, y0 + 2.7, z + 1.5); scene.add(l); wallLights.push({ l, k: 4 });
  FAR.sconces = [b0 + m / 2, b1 - m / 2].map(x => [x, y0 + 2.45, z + FAR.F + .03]);
  buildDoor(wood, casts);
}
// Дверь в правом нижнем углу дальнего торца — по образцам дверей Ватикана и Буэнос-Айреса (docs/back-wall/2026-11-13-door/refs).
// Вторая сборка (2026-11-15): прежняя — рыжие створки в чёрной ступенчатой раме с плоскими оливковыми стёклами — «так себе» и фактурой,
// и цветами, и тем, как дверь сидит в обрамлении («нет вопросов только к львам»). Теперь дверь и обрамление — одна столярная вещь
// на языке зала: по сторонам пилястры с узкой филёнкой и золочёной капителью, как у задней стены; на них антаблемент — архитрав,
// фриз с золочёной гирляндой, карниз с сухариками; створки — тёмное красное дерево под матовым лаком, филёнки с фигареей в той же
// профилированной раме, что у обшивки стен; фрамуга — веерное окно с золочёным переплётом и стеклом из отдельных зелёных стёклышек, понизу створок — латунные пластины с заклёпками.
// Цвета — только те, что уже есть в зале: дерево, чёрное дерево, латунь и старое золото, зелень стёкол.
// Местные оси: x — от середины двери, y — от пола, z — в зал.
// Веер фрамуги: сколько лучей (долей) во внутреннем поясе и где дуги — в долях полуоси: у полукруга в середине низа и между поясами.
const FANLIGHT = { rays: 10, hub: .2, mid: .6 };
const doorGlass = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .13, roughness: .07, metalness: 0, envMapIntensity: 1.6 });
function buildDoor(wood, casts = {}) {
  const { x: cx, w, leaf, rail, h, casing: c } = DOOR, z = RAIL_Z - HALL.len, y0 = -HALL.depth, lw = w / 2, up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(0, 0, 1), t = new THREE.Vector3(1, 0, 0);
  const at = new THREE.Matrix4().makeTranslation(cx, y0, z), parts = [], brass = [], around = [], gilt = [], glassParts = [];
  // Угол протяжки: точка, нормаль (в зал) и вторая ось профиля; по два кадра на угол — рёбра остаются чёткими.
  const fr = (x, y, dx, dy, pz = 0) => { const f = { p: new THREE.Vector3(x, y, pz), n, b: new THREE.Vector3(dx, dy, 0) }; return [f, f]; };
  const ring = (xa, xb, ya, yb, pz) => [...fr(xa, ya, 1, 1, pz), ...fr(xb, ya, -1, 1, pz), ...fr(xb, yb, -1, -1, pz), ...fr(xa, yb, 1, -1, pz), ...fr(xa, ya, 1, 1, pz)];
  const swept = (profile, frames) => sweep(profile, frames, false, true).toNonIndexed().applyMatrix4(at);
  const add = (g, grain) => parts.push(metricUV(g.toNonIndexed().applyMatrix4(at), grain)), gold = g => brass.push((g.index ? g.toNonIndexed() : g).applyMatrix4(at));
  const frame = (g, grain) => around.push(metricUV(g.toNonIndexed().applyMatrix4(at), grain));
  // Створки: лицо в 6 см от стены, три филёнки — малая, высокая (на ней лев) и малая. Поле филёнки поднято, по краю — скос (фигарея).
  // Понизу — глухой брус в 26 см (на нём латунная пластина), выше — три филёнки.
  const rows = [[.16, .8], [.8, 2.16], [2.16, leaf]];
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -lw : 0, M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(cx + x0, y0, z + .06);
    for (const [a, b] of rows) {
      parts.push(...panelling(M, 'x', lw, a, b, .06, [0, lw]));
      const xa = x0 + .15, xb = x0 + lw - .15, ya = a + .15, yb = b - .13, k = .045;
      parts.push(swept([[0, 0], [.016, k]], ring(xa, xb, ya, yb, .06)));
      add(box(xb - xa - 2 * k, yb - ya - 2 * k, .016, (xa + xb) / 2, (ya + yb) / 2, .068), 'y');
    }
    add(box(lw, .16, .09, x0 + lw / 2, .08, .045), 'x');
    // Латунная отбойная пластина понизу: лист со скошенной кромкой, по краю — ряд заклёпок.
    { const ka = x0 + .08, kb = x0 + lw - .08, ky0 = .06, ky1 = .22, kz = .09;
      brass.push(swept([[0, 0], [.004, .006]], ring(ka, kb, ky0, ky1, kz))); gold(box(kb - ka - .012, ky1 - ky0 - .012, .004, (ka + kb) / 2, (ky0 + ky1) / 2, kz + .002));
      const stud = (x, y) => gold(new THREE.SphereGeometry(.0065, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, .6).translate(x, y, kz + .004));
      const nx = Math.round((kb - ka - .05) / .065); for (let i = 0; i <= nx; i++) for (const y of [ky0 + .025, ky1 - .025]) stud(ka + .025 + i * (kb - ka - .05) / nx, y);
      for (const x of [ka + .025, kb - .025]) stud(x, (ky0 + ky1) / 2); }
    // Ручка: длинная накладка, шейка и шар — у притвора.
    const kx = s * .075, ky = 1.12;
    gold(box(.05, .3, .008, kx, ky, .094));
    gold(new THREE.LatheGeometry([[0, 0], [.014, 0], [.012, .02], [.016, .03], [.03, .036], [.036, .05], [.034, .064], [.024, .074], [0, .078]].map(([r, y]) => new THREE.Vector2(r, y)), 24).rotateX(Math.PI / 2).translate(kx, ky + .05, .098));
    // Крайние стойки фрамуги (сама фрамуга — ниже, одна на обе створки).
    add(box(.07, h - leaf - rail, .09, s * (lw - .035), (leaf + rail + h) / 2, .045), 'y');
  }
  // Притворная планка, брус под фрамугой с полочкой, верхний брус фрамуги, ключевина.
  add(box(.045, leaf, .03, 0, leaf / 2, .105), 'y');
  add(box(w, rail + .02, .1, 0, leaf + rail / 2 + .01, .05), 'x'); add(box(w, .03, .125, 0, leaf + rail - .015, .0625), 'x');
  add(box(w, .07, .09, 0, h - .035, .045), 'x');
  // Фрамуга — веерное окно, младшая сестра веерного окна над этой же стеной: в деревянном поле вырезан полуовал, в нём стекло,
  // набранное из отдельных стёклышек — в середине низа полукруг, от него два пояса: лучи и дуги (FANLIGHT); переплёт золочёный,
  // как у большого окна. Решётка ромбами тут была «негармонична»: в зале всюду дуги — окна, своды, куполки.
  { const W = w - .14, H = h - leaf - rail - .09, Y0 = leaf + rail + .02, a = W / 2 - .05, b = H - .06, { rays, hub, mid } = FANLIGHT, N = 48, zb = .07;
    const at2 = (rho, th) => [a * rho * Math.cos(th), Y0 + b * rho * Math.sin(th)];
    // Путь по дуге (против часовой стрелки), вторая ось профиля — к середине веера.
    const arc = (rho, pz) => Array.from({ length: N + 1 }, (_, k) => { const th = Math.PI * k / N, [x, y] = at2(rho, th), nb = new THREE.Vector3(-Math.cos(th) / a, -Math.sin(th) / b, 0).normalize(); return { p: new THREE.Vector3(x, y, pz), n, b: nb }; });
    // Деревянное поле с вырезом и профиль по краю выреза; по дереву вдоль выреза — золочёная бусина.
    const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(-a, 0); for (let k = 0; k <= N; k++) { const th = Math.PI * (1 - k / N); sh.lineTo(a * Math.cos(th), b * Math.sin(th)); } sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H); sh.lineTo(-W / 2, H); sh.closePath();
    parts.push(metricUV(new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: false, curveSegments: 1 }).translate(0, Y0, .06).applyMatrix4(at), 'x'));
    parts.push(swept([[0, 0], [-.01, .004], [-.016, .012], [-.02, .016], [-.028, .018]], arc(1, .09)));
    const bar = (profile, frames) => gilt.push(sweep(profile, frames).toNonIndexed().applyMatrix4(at));
    bar([[0, -.016], [.006, -.016], [.006, -.008], [0, -.008]], arc(1, .09));
    // Переплёт: дуги и лучи (во внешнем поясе лучей вдвое больше).
    for (const [rho, bw] of [[hub, .009], [mid, .008]]) bar([[0, -bw / 2], [.004, -bw / 2], [.004, bw / 2], [0, bw / 2]], arc(rho, zb));
    const ray = (th, r0, r1, bw) => { const [x0, y0] = at2(r0, th), [x1, y1] = at2(r1, th); gilt.push(new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0), bw, .004).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, zb + .002).toNonIndexed().applyMatrix4(at)); };
    for (let i = 1; i < rays; i++) ray(Math.PI * i / rays, hub, 1, .008);
    for (let i = 0; i < rays; i++) ray(Math.PI * (i + .5) / rays, mid, 1, .006);
    glassParts.push(new THREE.PlaneGeometry(W, H).translate(0, Y0 + H / 2, .062).applyMatrix4(at));
    Object.assign(doorGlass, fanPanes({ w: W, h: H, a, b, ...FANLIGHT })); }
  gold(new THREE.CylinderGeometry(.014, .014, .006, 16).rotateX(Math.PI / 2).scale(1, 2.2, 1).translate(.075, 1.02, .099));
  // Обрамление. Вокруг проёма — узкий наличник с латунной бусиной в желобке (как на карнизе зала).
  const casing = profile => swept(profile, [...fr(-lw, 0, -1, 0), ...fr(-lw, h, -1, 1), ...fr(lw, h, 1, 1), ...fr(lw, 0, 1, 0)]);
  around.push(casing([[0, 0], [.1, 0], [.1, .03], [.088, .038], [.088, .062], [.11, .072], [.11, .09], [0, .09]]));
  brass.push(casing([[.088, .044], [.097, .047], [.097, .055], [.088, .058]]));
  // Пилястры: цоколь, база, ствол с узкой филёнкой в профилированной раме, капитель — отливка, что у задней стены и под сводом, в старой позолоте.
  const P = { w: .2, d: .06, x: lw + .09 + .1, cap: casts.capital ? .27 : .12 }, yCap = h + .12, yShaft = .385;
  for (const s of [-1, 1]) {
    const px = s * P.x;
    frame(box(P.w + .06, .3, .1, px, .15, .05), 'y');
    frame(box(P.w + .05, .05, .085, px, .325, .0425), 'x'); frame(box(P.w + .025, .035, .07, px, .3675, .035), 'x');
    frame(box(P.w, yCap - P.cap - yShaft, P.d, px, (yShaft + yCap - P.cap) / 2, P.d / 2), 'y');
    around.push(swept([[0, 0], [.008, 0], [.013, .004], [.016, .01], [.013, .018], [.008, .023], [0, .025]], ring(px - P.w / 2 + .045, px + P.w / 2 - .045, yShaft + .14, yCap - P.cap - .1, P.d)));
    if (casts.capital) { const g = casts.capital.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); gilt.push(g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(px, yCap - P.cap / 2, 0), new THREE.Quaternion(), new THREE.Vector3(.68, P.cap / .43, .45))).applyMatrix4(at)); }
    else frame(box(P.w + .06, P.cap, P.d + .03, px, yCap - P.cap / 2, (P.d + .03) / 2), 'x');
  }
  // Антаблемент на пилястрах: архитрав с полочкой, фриз (на нём гирлянда), карниз с сухариками.
  const E = lw + c, ya = yCap, yf = ya + .12, yc = yf + .2;
  frame(box(2 * E - .04, .1, .085, 0, ya + .05, .0425), 'x'); frame(box(2 * E - .02, .02, .1, 0, ya + .11, .05), 'x');
  frame(box(2 * E - .06, .2, .07, 0, yf + .1, .035), 'x');
  frame(box(2 * E - .02, .035, .1, 0, yc + .0175, .05), 'x'); frame(box(2 * E - .04, .045, .095, 0, yc + .0575, .0475), 'x');
  { const step = .048, k = Math.floor((2 * E - .06) / step); for (let i = 0; i < k; i++) frame(box(.03, .04, .03, (i - (k - 1) / 2) * step, yc + .058, .11), 'x'); }
  frame(box(2 * E + .1, .05, .19, 0, yc + .105, .095), 'x'); frame(box(2 * E + .14, .03, .21, 0, yc + .145, .105), 'x');
  brass.push(box(2 * E - .02, .012, .012, 0, yc + .006, .104).toNonIndexed().applyMatrix4(at));
  // Створки и обрамление — одно дерево (свой скан, doorWood): створки светлее, обрамление на тон темнее.
  const own = doorWood(DOOR.tone, .78), dark = doorWood([DOOR.frame], .85);
  const door = new THREE.Mesh(mergeGeometries(parts), own); door.castShadow = door.receiveShadow = true; door.userData.sunOnly = true; scene.add(door);
  const metal = new THREE.Mesh(mergeGeometries(brass.map(g => { g.deleteAttribute('uv'); return g; })), BRASS); metal.castShadow = true; metal.userData.sunOnly = true; scene.add(metal);
  const surround = new THREE.Mesh(mergeGeometries(around), dark); surround.castShadow = surround.receiveShadow = true; surround.userData.sunOnly = true; scene.add(surround);
  // Гирлянда с раковиной (отливка из лепнины зала) — во фризе, по его середине; она и капители — старое золото, как у задней стены.
  if (casts.crest) { const k = .3; gilt.push(casts.crest.clone().applyMatrix4(new THREE.Matrix4().makeScale(k, k, .6)).applyMatrix4(new THREE.Matrix4().makeTranslation(0, yf + .1, .07)).applyMatrix4(at)); }
  if (gilt.length) {
    for (const g of gilt) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const gilded = new THREE.Mesh(mergeGeometries(gilt.map(g => g.index ? g.toNonIndexed() : g)), new THREE.MeshStandardMaterial({ color: 0xa9853f, metalness: .8, roughness: .42 }));
    gilded.castShadow = gilded.receiveShadow = true; gilded.userData.sunOnly = true; scene.add(gilded);
  }
  // Стекло фрамуги — зелень ламп и сукна зала, дополнительная к дереву; набрано из отдельных стёклышек (glass.js, fanPanes): у каждого
  // свой оттенок и свой наклон, у переплёта фацет, за стеклом — свет вестибюля. Прежде: кружки в свинце, как в окнах, — «не очень»;
  // ровное тёмное стекло за латунной решёткой — «ещё поработать»; ромбы в решётке — «сеточка» и «темнота стекла» не понравились,
  // а «чуть разный цвет для каждого стёклышка» — да.
  const glass = new THREE.Mesh(mergeGeometries(glassParts), doorGlass); scene.add(glass);
  for (const o of [door, metal, glass, surround]) { o.userData.door = true; doorParts.push(o); }
}
// Дерево двери — свой скан: красное дерево с мелким прямым рисунком и матовым лаком (Poly Haven, Dark Wood; из плитки 2 × 2 м взята
// полоса 2 × 1 м — два метра вдоль волокон, метр поперёк; поперёк она повторяется зеркально, без шва). Прежде на створках был скан
// шпона стен, подкрашенный в рыжий: рисунок крупный, под лампой — «ламинат». Карты общие у створок и обрамления, тон у каждого свой.
const MAHOGANY_MEAN = [.1122, .0247, .0092], doorTint = tintFor(MAHOGANY_MEAN), doorMaps = {};
function doorWood(tone, rough) {
  for (const [k, kind, srgb] of [['map', 'color', true], ['normalMap', 'normal', false], ['roughnessMap', 'rough', false]])
    if (!doorMaps[k]) { const t = doorMaps[k] = tex(`assets/textures/mahogany-${kind}.jpg`, srgb, [.5, 1]); t.wrapT = THREE.MirroredRepeatWrapping; }
  return new THREE.MeshStandardMaterial({ ...doorMaps, color: doorTint(...tone), roughness: rough, envMapIntensity: .5 });
}
// Фриз над шкафами — обшивка филёнками до самого карниза, из того же красного дерева.
// Над каждым шкафом четыре филёнки, стойки — над его колонками; где шкафа нет, филёнки той же ширины делят стену поровну.
// Вверху дерево светлее, как и верхний ярус шкафов.
function buildFrieze(wood) {
  const { F, y0, y1 } = FRIEZE, a = HALL.w / 2, z0 = RAIL_Z + GAL, z1 = RAIL_Z - HALL.len, H = y1 - y0, HALF = 3.95 / 2, COL = 1.87 / 2;
  const upper = bookcaseSpots().filter(s => s[1] === 0), up = new THREE.Vector3(0, 1, 0), parts = [];
  // Стены: середина лица фриза, нормаль в зал, длина; шкафы — их середины на этой стене.
  const walls = [
    ...[-1, 1].map(s => ({ c: new THREE.Vector3(s * (a - F), 0, (z0 + z1) / 2), n: new THREE.Vector3(-s, 0, 0), len: z0 - z1 - 2 * F, cases: upper.filter(p => Math.sign(p[0]) === s && p[3] !== 0) })),
    { c: new THREE.Vector3(0, 0, z1 + F), n: new THREE.Vector3(0, 0, 1), len: 2 * (a - F), cases: upper.filter(p => p[3] === 0) },
    { c: new THREE.Vector3(0, 0, z0 - F), n: new THREE.Vector3(0, 0, -1), len: 2 * (a - F), cases: [] },
  ];
  for (const { c, n, len, cases } of walls) {
    // Местные оси: x — вдоль стены, y — вверх, z — в зал; так грани не выворачиваются.
    const t = new THREE.Vector3().crossVectors(up, n), o = c.clone().addScaledVector(t, -len / 2), M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(o);
    const along = Math.abs(t.x) > .5 ? 'x' : 'z', at = p => new THREE.Vector3(p[0], 0, p[2]).sub(o).dot(t);
    const stiles = [0, len];
    const taken = cases.map(p => at(p)).sort((p, q) => p - q);
    for (const u of taken) for (let k = -2; k <= 2; k++) stiles.push(u + k * COL);
    // Свободные места — поровну, филёнками около метра.
    let from = 0;
    for (const u of [...taken, len + HALF]) {
      const u0 = from, u1 = Math.min(len, u - HALF); from = u + HALF;
      if (u1 - u0 < .3) continue;
      const k = Math.max(1, Math.round((u1 - u0) / .95));
      for (let i = 0; i <= k; i++) stiles.push(u0 + (u1 - u0) * i / k);
    }
    const xs = stiles.filter(u => u >= 0 && u <= len).sort((p, q) => p - q).reduce((acc, u) => (acc.length && u - acc[acc.length - 1] < .2 ? acc : [...acc, u]), []);
    parts.push(...panelling(M, along, len, y0, y1, F, xs));
  }
  // Углы: квадрат между боковым и торцевым фризом — сплошной, снизу в него не заглянуть.
  for (const x of [-1, 1]) for (const z of [z0 - F / 2, z1 + F / 2]) parts.push(metricUV(box(F, H, F, x * (a - F / 2), y0 + H / 2, z).toNonIndexed(), 'y'));
  const mesh = new THREE.Mesh(mergeGeometries(parts), woodMats.frieze = liftUpper(wood.clone(), .35));
  mesh.castShadow = mesh.receiveShadow = true; mesh.userData.sunOnly = true; scene.add(mesh);
}
// Задняя стена галереи — почти сразу за стулом: внизу деревянная панель с филёнками, плинтус и поручень, выше — оливковый штоф до фриза.
// Пилястры делят её на три поля; на ней — картины в рамах, часы и зеркало, бра, перед ней — глобусы и каталожные шкафы;
// модели ставятся позже, когда загрузятся (placeBackWall).
const BACK = { z: RAIL_Z + GAL, half: HALL.w / 2 - .7, dado: 1.0, pil: 3.6 }, SCONCE = { y: 2.72, at: [], url: 'assets/models/sconce/wall-lamp.glb', k: .48 }, wallLights = [], CATALOG = { at: [4.95, -4.95] }, catalogs = [];
function buildBackWall(wood, casts = {}) {
  const { z, half, dado } = BACK, len = 2 * half, n = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3().crossVectors(up, n);
  // На 2 мм от стены — чтобы утопленные поля филёнок не мерцали вместе с ней.
  const M = new THREE.Matrix4().makeBasis(t, up, n).setPosition(new THREE.Vector3(0, 0, z - .002).addScaledVector(t, -half));
  const k = Math.round(len / .9), xs = Array.from({ length: k + 1 }, (_, i) => len * i / k);
  const parts = panelling(M, 'x', len, .14, dado, .03, xs);
  // Плинтус и поручень — тоже дерево.
  for (const [h, d, y] of [[.14, .05, .07], [.05, .07, dado + .025]]) { const g = box(len, h, d, len / 2, y, d / 2); g.deleteAttribute('uv'); g.applyMatrix4(M); parts.push(metricUV(g.toNonIndexed(), 'x')); }
  const panelMesh = new THREE.Mesh(mergeGeometries(parts), wood); panelMesh.castShadow = panelMesh.receiveShadow = true; scene.add(panelMesh);
  // Выше — штоф: шёлковый жаккард с цветочным узором (скан 25 × 38 см) в зелени кессонов свода, в деревянной раме — брус по верху и по бокам.
  const h = FRIEZE.y0 - dado - .05, R = [1 / .253, 1 / .384];
  const damask = new THREE.MeshStandardMaterial({ map: tex('assets/textures/damask-color.jpg', true, R), normalMap: tex('assets/textures/damask-normal.jpg', false, R), roughnessMap: tex('assets/textures/damask-rough.jpg', false, R), color: new THREE.Color().setRGB(1.5, 2.1, 1.05), roughness: .8, envMapIntensity: .5 });
  backDamask = damask;
  const wall = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(len, h).translate(0, dado + .05 + h / 2, 0)), damask);
  wall.geometry.rotateY(Math.PI); wall.position.z = z - .004; wall.receiveShadow = true; scene.add(wall);
  const fr = [box(len, .09, .05, len / 2, FRIEZE.y0 - .045, .025), box(.09, h, .05, .045, dado + .05 + h / 2, .025), box(.09, h, .05, len - .045, dado + .05 + h / 2, .025)];
  const frame = fr.map((g, i) => { g.deleteAttribute('uv'); g.applyMatrix4(M); return metricUV(g.toNonIndexed(), i ? 'y' : 'x'); });
  // Пилястры делят штоф на три поля: середина в 7,2 м и два боковых по 2,7 м. Стоят на стойках нижней панели (её шаг — 0,9 м):
  // пьедестал в высоту панели, база, ствол с узкой филёнкой в той же профилированной раме, капитель — отливка, что и под сводом, в старой позолоте.
  const gilded = [], y0 = dado + .05, y1 = FRIEZE.y0, W = .34, D = .07, capH = casts.capital ? .43 : .2;
  for (const x of [-BACK.pil, BACK.pil]) {
    const lx = half - x, wooden = [box(.46, y0, .085, lx, y0 / 2, .0425), box(.52, .16, .11, lx, .08, .055), box(.52, .05, .115, lx, y0 - .025, .0575),
      box(W + .1, .1, D + .035, lx, y0 + .05, (D + .035) / 2), box(W + .05, .045, D + .018, lx, y0 + .1225, (D + .018) / 2), box(W, y1 - capH - y0, D, lx, (y0 + y1 - capH) / 2, D / 2)];
    if (!casts.capital) wooden.push(box(W + .1, capH, D + .04, lx, y1 - capH / 2, (D + .04) / 2));
    for (const g of wooden) { g.deleteAttribute('uv'); g.applyMatrix4(M); frame.push(metricUV(g.toNonIndexed(), 'y')); }
    const xa = lx - W / 2 + .07, xb = lx + W / 2 - .07, ya = y0 + .3, yb = y1 - capH - .12;
    const c = (px, py, dx, dy) => { const f = { p: new THREE.Vector3(px, py, D), n: Z3, b: new THREE.Vector3(dx, dy, 0) }; return [f, f]; };
    frame.push(sweep([[0, 0], [.01, 0], [.016, .005], [.02, .012], [.016, .022], [.01, .028], [0, .03]], [...c(xa, ya, 1, 1), ...c(xb, ya, -1, 1), ...c(xb, yb, -1, -1), ...c(xa, yb, 1, -1), ...c(xa, ya, 1, 1)], false, true).toNonIndexed().applyMatrix4(M));
    if (casts.capital) { const g = casts.capital.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); gilded.push(g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(lx, y1 - capH / 2, 0), new THREE.Quaternion(), new THREE.Vector3(1.12, 1, .6))).applyMatrix4(M)); }
  }
  const m3 = new THREE.Mesh(mergeGeometries(frame), wood); m3.castShadow = m3.receiveShadow = true; scene.add(m3);
  // Свет у стены — сразу, вместе с залом (новые лампы позже заставили бы пересобрать все шейдеры): лампа над «Идиллией» светит вниз,
  // на картину, бра на пилястрах — тёплыми пятнами на штоф. Сами лампы ставятся позже (placeBackWall); сила — от света в зале (setLight).
  const pic = new THREE.SpotLight(0xffd6a0, 0, 5, 1.0, .85, 1.3); pic.position.set(0, FRIEZE.y0 - .4, z - .42); pic.target.position.set(0, 2.5, z - .02); scene.add(pic, pic.target);
  wallLights.push({ l: pic, k: 16 });
  for (const x of [-BACK.pil, BACK.pil]) { const l = new THREE.PointLight(0xffc48a, 0, 4.6, 1.5); l.position.set(x, SCONCE.y + .13, z - D - .27); scene.add(l); wallLights.push({ l, k: 3.2 }); SCONCE.at.push([x, SCONCE.y, z - D]); }
  // Каталожные шкафы (catalog.js) — в боковых полях: ящики выдвигаются нажатием. На левом — гипсовый вепрь, над правым — картина.
  for (const x of CATALOG.at) { const c = buildCatalog({ wood, brass: BRASS }); stand(c.group, x, z - .025, Math.PI, .2); catalogs.push(c); (woodMats.extra ??= []).push(...c.woods); }
  if (gilded.length) { const caps = new THREE.Mesh(mergeGeometries(gilded), new THREE.MeshStandardMaterial({ color: 0xa9853f, metalness: .8, roughness: .42 })); caps.castShadow = caps.receiveShadow = true; scene.add(caps); }
}
// Рамы — сканы старых рам (Poly Haven): золочёная с бусиной и арочная. canvas — меш холста в модели
// (его картинку заменяем), aperture — видимое поле холста в метрах модели, front — куда смотрит лицо (+z или −z).
// У арочной холста нет (это зеркало): поле картины в форме арки кладётся поверх стекла.
const FRAMES = {
  gilt: { url: 'assets/models/frame-gilt/fancy_picture_frame_01_1k.gltf', canvas: 'fancy_picture_frame_01_canvas', aperture: [.539, .4], front: 1 },
  arch: { url: 'assets/models/frame-arch/ornate_mirror_01_1k.gltf', arch: { w: .5, y0: -.4, y1: .322, z: .008 }, aperture: [.5, .722], front: 1 },
};
// Развеска задней стены: рама, картина (файл в assets/art и кусок [x, y, w, h] в долях), ширина рамы снаружи (м), середина на стене (x, y).
// Картин две — больше превращают кабинет учёного в купеческую гостиную: крупная «Идиллия» Хофмана — в середине среднего поля, под лампой (lamp — её длина в долях ширины рамы),
// в правом поле, над каталожным шкафом, — «Весной» Бёклина (1873) в арочной раме.
const HANG = [
  { frame: 'gilt', art: 'hofmann-idyll', crop: [0, 0, 1, 1], width: 2.9, x: 0, y: 2.75, lamp: .5 },
  { frame: 'arch', art: 'boecklin-im-fruehling', crop: [.03, .005, .872, .99], width: 1.0, x: -4.95, y: 2.75 },
];
// Часы — круглые настенные. Висят над земным глобусом, между «Идиллией» и левой пилястрой; d — диаметр в метрах.
// Стрелки — отдельные детали: показывают время зала (то же, что солнце в окнах; ?time= — другое).
// Модель Reloj Antiguo (Crea, CC BY 4.0): мраморный циферблат с бронзовыми римскими цифрами, латунный обод, ажурные стрелки;
// hub — середина оси стрелок в координатах модели, стрелки в модели стоят на шести часах.
const CLOCK = { d: 1.0, x: 2.45, y: 2.85, url: 'assets/models/clock/round.glb', hub: [.91, 552.42, -246], size: 400 };
// Место справа от «Идиллии», в пару часам (там висит выпуклое зеркало): середина на стене и поперечник.
const DIAL = { d: 1.0, x: -2.45, y: 2.85 };
// Пара глобусов Иоганна Габриэля Доппельмайра — земной (Нюрнберг, 1728) и небесный (после 1744) из Collegium Maius (сканы Muzea Małopolski, CC0) —
// стоят на постаментах по сторонам от «Идиллии», под часами и зеркалом. В жизни они настольные, с шаром в 32 см; здесь — крупнее, чтобы их было видно и удобно крутить.
// Небесный в скане меньше — выравниваем по высоте: пара одного размера, как у мастера.
// Шар крутится вокруг оси вдоль шпеньков меридианного кольца: ball — материал шара в скане, poles — северный и южный шпенёк (координаты скана).
// Карты на шарах — свои: старые карты, перепроецированные в развёртку «долгота — широта» (земной — де Йоде, 1593; небесный — Целлариус, 1660),
// север сверху; у небесного по ширине — прямое восхождение, звёзды как на глобусе, то есть зеркально небу. По умолчанию грузится 4096 px,
// а когда подходишь рассмотреть — 8192 px. map: file — имя развёртки, front — какое место (доля ширины) смотрит в зал.
const GLOBES = [
  { url: 'assets/models/globes/earth.glb', x: 2.45, turn: -.5, ball: 'sphere', poles: [[-.072, .816, -.041], [.039, .221, .010]], map: { file: 'earth-dejode', front: .53 } },
  { url: 'assets/models/globes/celestial.glb', x: -2.45, turn: .5, ball: 'sphere.001', poles: [[.057, .661, -.013], [.008, .183, -.009]], map: { file: 'sky-cellarius', front: .25 } },
];
// Глобусы — метровые, как большие библиотечные (такими они были и на полу; уменьшали их только под маленькие столики), и стоят на низких
// широких постаментах из дерева зала (globePlinth): восьмигранник, как горизонтальное кольцо самого глобуса, — плита-цоколь, выкружка, ствол
// с лёгким сужением кверху, латунная бусина под карнизом, плита. Верх шире кольца глобуса: ножки стоят далеко от края — вещь устойчива.
// Тон — свой: чёрное дерево, почти чёрный тёплый коричневый, как тёмные ножки и меридиан самого глобуса, — постамент темнее и стены, и пола
// и не сливается с обшивкой (оливково-серый «как стол» рядом с красным деревом выглядел пыльным); r — радиус по углам плиты (между гранями — 0,92 от поперечника; кольцо глобуса — 1,1 м, ножки — в 20 см от края), h — высота.
const GLOBE = { h: 1.0, z: BACK.z - .82, plinth: { h: .48, r: .62, tone: 0x1e1511 } };
let plinthWood = null;
function globePlinth(wood) {
  const { h, r } = GLOBE.plinth, P = [[0, 0], [.98, 0], [.98, .06], [.95, .075], [.9, .1], [.8, .115], [.7, .14], [.655, .18], [.62, h - .19], [.625, h - .16], [.68, h - .135], [.82, h - .095], [.95, h - .065], [1, h - .05], [1, h], [0, h]];
  // Восемь граней, грани плоские (у каждой свои нормали), волокна — вверх; одна из граней смотрит в зал.
  const body = new THREE.LatheGeometry(P.map(([k, y]) => new THREE.Vector2(k * r, y)), 8).toNonIndexed(); body.deleteAttribute('uv'); body.deleteAttribute('normal'); body.computeVertexNormals();
  const g = new THREE.Group(), bead = new THREE.Mesh(new THREE.TorusGeometry(.63 * r, .011, 8, 8).rotateX(Math.PI / 2).translate(0, h - .175, 0), BRASS);
  const dark = plinthWood ??= Object.assign(wood.clone(), { color: woodTint(GLOBE.plinth.tone), roughness: .62 });
  g.add(new THREE.Mesh(metricUV(body, 'y'), dark), bead); g.rotation.y = Math.PI / 8;
  const turned = new THREE.Group(); turned.add(g); return turned;
}
// На левом каталожном шкафу — скульптура, на выбор в «убранстве»: не портреты и не правители.
// boar — «Вепрь», гипсовый слепок античной фигуры (флорентийский «Поросёнок»), музейный скан (Muzea Małopolski, CC0), упрощён до 44 тыс. треугольников;
// owl — сова Афины с буквами ΑΘΕ на подставке, как на афинских монетах (скан, Danzer, CC BY 4.0), упрощена до 31 тыс. треугольников.
// w или h — длина или высота фигуры в метрах (чтобы уместилась на крышке шкафа), turn — поворот: лицом в зал.
const SCULPTS = {
  boar: { title: t('decor.sculpt.boar'), url: 'assets/models/sculpture/boar.glb', w: .72, turn: Math.PI },
  owl: { title: t('decor.sculpt.owl'), url: 'assets/models/sculpture/owl.glb', h: .62, turn: Math.PI },
};
const SCULPT = { x: 4.95 }, sculptBuilt = {}, sculptModels = {};
let sculpt = null;
const loadSculpt = k => sculptModels[k] ??= loadModel(SCULPTS[k].url).catch(e => { console.warn(e); delete sculptModels[k]; return null; });
// Поставить скульптуру k (прежнюю убрать) на крышку шкафа, посередине.
function placeSculpture(k, model) {
  const cat = catalogs.find(c => Math.abs(c.group.position.x - SCULPT.x) < .01); if (!cat || sculpt?.k === k) return;
  if (sculpt) { scene.remove(sculpt.group); standing.splice(standing.indexOf(sculpt.entry), 1); sculpt.group.traverse(o => { const i = sunOnly.indexOf(o); if (i >= 0) sunOnly.splice(i, 1); }); }
  const S = SCULPTS[k], g = sculptBuilt[k] ??= fit(model, S.h ? { h: S.h } : { w: S.w });
  stand(g, SCULPT.x, cat.group.position.z - cat.depth / 2 + .005, S.turn, .1, cat.height);
  // Поставлена после того, как зал собрал список теней «только от солнца», — дописать её туда.
  g.traverse(o => { if (o.isMesh && sunOnly.length && !sunOnly.includes(o)) sunOnly.push(o); });
  sculpt = { k, group: g, entry: standing[standing.length - 1] };
  if (sun) sun.shadow.needsUpdate = true; shadowDirty = true;
}
// Выбор в «убранстве»: модель грузится, когда её выбрали. Не загрузилась — остаётся прежняя.
async function chooseSculpt(k) {
  decor.sculpt = savedSculpt = k; markDecor(); save();
  const m = await loadSculpt(k); if (decor.sculpt !== k) return;
  if (m) return placeSculpture(k, m);
  decor.sculpt = savedSculpt = sculpt?.k ?? 'boar'; markDecor(); save(); hint(t('hint.sculpt.fail'), 5000);
}
// Фигурка на пресс-папье: модель грузится, когда её выбрали; не загрузилась — остаётся прежняя (только в консоль).
const weightModels = {};
const loadWeight = k => weightModels[k] ??= loadModel(FIGURES[k].url).catch(e => { console.warn(e); delete weightModels[k]; return null; });
async function chooseWeight(k) {
  decor.weight = savedWeight = k; markDecor(); markPick(); save();
  const m = await loadWeight(k); if (decor.weight !== k || !m || !weight) return;
  weight.setFigure(k, m); shadowDirty = true;
}
// Птица на стене — чучело на резной полке-консоли из дерева зала: плита с выносом и гнутый кронштейн под ней.
// S: h — высота чучела в метрах, turn — поворот (клювом к середине стены), x, y — середина и высота полки, shelf — её ширина, sink — на сколько чучело утоплено в полку.
const PERCH = { d: .34 };
function buildBird(model, S) {
  const G = new THREE.Group(), { d } = PERCH, x = S.x, w = S.shelf, y = S.y, z = BACK.z, wood = woodMats.rail;
  const arm = new THREE.Shape().moveTo(0, 0).lineTo(d - .06, 0).quadraticCurveTo(d - .1, -.2, .05, -.26).quadraticCurveTo(.02, -.33, 0, -.36).closePath();
  const corbel = new THREE.ExtrudeGeometry(arm, { depth: .07, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2 }).translate(0, 0, -.035).rotateY(Math.PI / 2).translate(x, y - .04, z);
  const shelf = [box(w, .03, d, x, y - .015, z - d / 2), box(w - .05, .02, d - .03, x, y - .04, z - (d - .03) / 2)].map(g => metricUV(g.toNonIndexed(), 'x'));
  for (const geo of [mergeGeometries(shelf), corbel]) { const m = new THREE.Mesh(geo, wood); m.castShadow = m.receiveShadow = m.userData.sunOnly = true; G.add(m); }
  // Сканы, снятые «без света» (свет запечён в текстуру), в зале светились бы сами: им — обычный матовый материал с той же текстурой.
  // Ниже полки чучело не рисуется (cut): у музейных чучел ветка стоит на тонком штыре — он уходит в полку. tint — затемнить оперение
  // (сканы чёрных птиц серее, чем птица в жизни).
  const cut = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y - .002))];
  model.traverse(o => { if (!o.isMesh) return; if (o.material.isMeshBasicMaterial) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: .85, side: THREE.DoubleSide }); if (S.tint) o.material.color.setScalar(S.tint); o.material.clippingPlanes = cut; o.castShadow = o.receiveShadow = o.userData.sunOnly = true; });
  // Размер и опора — по самим вершинам (рамка по углам у повёрнутого скана шире, и птица висела бы над полкой).
  model.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(model, true), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), k = S.h / size.y;
  const bird = new THREE.Group(); model.position.set(-c.x, -b.min.y, -c.z); bird.add(model); bird.scale.setScalar(k);
  bird.rotation.y = S.turn ?? 0; bird.position.set(x, y - S.sink * size.y * k, z - d / 2); G.add(bird);
  return { group: G };
}
// Барометр-«банджо» — настенный, красного дерева: навершие с латунным шишаком, шейка с термометром, круглый корпус с посеребрённым циферблатом
// (шкала в миллиметрах, слова «буря — дождь — переменно — ясно — сушь») в латунном ободке, воронёная стрелка и латунная стрелка-метка.
// Построен программно: годных готовых моделей под открытой лицензией не нашлось. S: x, y — середина циферблата на стене, k — масштаб (1 — метр в высоту).
function buildBarometer(_, S) {
  const G = new THREE.Group(), k = S.k ?? 1, wood = woodMats.rail, steel = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: .7, roughness: .35 });
  // Корпус: правая половина контура (x, y от середины циферблата), левая — зеркально.
  const half = [[0, -.335], [.05, -.33], [.078, -.3], [.074, -.255], [.05, -.225], [.062, -.19], [.12, -.155], [.172, -.09], [.192, 0], [.172, .09], [.12, .155], [.07, .2], [.058, .25], [.058, .57], [.066, .6], [.088, .615], [.088, .632], [.06, .65], [.03, .69], [.018, .675], [0, .655]];
  const sh = new THREE.Shape(); sh.moveTo(...half[0]); sh.splineThru(half.slice(1, 12).map(p => new THREE.Vector2(...p))); for (const p of half.slice(12)) sh.lineTo(...p);
  for (const p of half.slice(12, -1).reverse()) sh.lineTo(-p[0], p[1]); sh.splineThru(half.slice(0, 12).reverse().map(p => new THREE.Vector2(-p[0], p[1])));
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .034, bevelEnabled: true, bevelThickness: .007, bevelSize: .007, bevelSegments: 3, curveSegments: 20 }), wood);
  const mesh = (geo, m) => { const o = new THREE.Mesh(geo, m); G.add(o); return o; }; G.add(body);
  // Циферблат: шкала на дуге в 270°, 710–790 мм.
  const C = 1024, cv = Object.assign(document.createElement('canvas'), { width: C, height: C }), g = cv.getContext('2d'), R = C / 2, ink = '#1d1a16';
  const gr = g.createRadialGradient(R, R * .9, 0, R, R, R); gr.addColorStop(0, '#f1eee4'); gr.addColorStop(1, '#cfc9ba'); g.fillStyle = gr; g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
  const ang = mm => (mm - 750) / 40 * (Math.PI * .75), at = (r, t) => [R + Math.sin(t) * r * R, R - Math.cos(t) * r * R];
  g.strokeStyle = g.fillStyle = ink; for (const [r, w] of [[.94, 5], [.9, 2], [.72, 2]]) { g.lineWidth = w; g.beginPath(); g.arc(R, R, r * R, 0, Math.PI * 2); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let mm = 710; mm <= 790; mm++) { const t = ang(mm), long = mm % 10 === 0, mid = mm % 5 === 0; g.lineWidth = long ? 4 : 2; g.beginPath(); g.moveTo(...at(.9, t)); g.lineTo(...at(long ? .8 : mid ? .835 : .86, t)); g.stroke();
    if (long) { const [x, y] = at(.765, t); g.save(); g.translate(x, y); g.rotate(t); g.font = '600 34px "Old Standard TT", serif'; g.fillText(String(mm), 0, 8); g.restore(); } }
  const arc = (text, r, mid, size, sp = 1) => { g.font = `${size}px "Old Standard TT", serif`; const ws = [...text].map(ch => g.measureText(ch).width + size * .12 * sp), tot = ws.reduce((p, q) => p + q, 0); let t = mid - tot / 2 / (r * R);
    for (const [i, ch] of [...text].entries()) { const w = ws[i] / (r * R); t += w / 2; const [x, y] = at(r, t); g.save(); g.translate(x, y); g.rotate(t); g.fillText(ch, 0, 0); g.restore(); t += w / 2; } };
  for (const [word, mm] of [['БУРЯ', 718], ['ДОЖДЬ', 734], ['ПЕРЕМЕННО', 750], ['ЯСНО', 766], ['СУШЬ', 782]]) arc(word, .62, ang(mm), 40);
  g.font = 'italic 34px "Old Standard TT", serif'; g.fillText('Барометръ', R, R * 1.42); g.font = '22px "Old Standard TT", serif'; g.fillText('миллиметры ртутнаго столба', R, R * 1.54);
  const dialTex = new THREE.CanvasTexture(cv); dialTex.colorSpace = THREE.SRGBColorSpace; dialTex.anisotropy = 16;
  mesh(new THREE.CircleGeometry(.15, 64).translate(0, 0, .043), new THREE.MeshStandardMaterial({ map: dialTex, roughness: .5, metalness: .15 }));
  mesh(new THREE.TorusGeometry(.156, .011, 12, 64).translate(0, 0, .046), BRASS);
  // Стрелки: воронёная — давление («ясно»), латунная метка — где стояло вчера.
  const hand = (len, m, w, tail) => { const s2 = new THREE.Shape().moveTo(-w, 0).lineTo(-w * .45, len * .8).lineTo(-w * 1.6, len * .82).lineTo(0, len).lineTo(w * 1.6, len * .82).lineTo(w * .45, len * .8).lineTo(w, 0).lineTo(w * .5, -tail).lineTo(-w * .5, -tail).closePath(); return new THREE.Mesh(new THREE.ExtrudeGeometry(s2, { depth: .002, bevelEnabled: false }), m); };
  const set = hand(.118, BRASS, .0035, .02); set.position.z = .047; set.rotation.z = -ang(757); G.add(set);
  const main = hand(.128, steel, .0045, .035); main.position.z = .051; main.rotation.z = -ang(764); G.add(main);
  mesh(new THREE.CylinderGeometry(.011, .011, .014, 20).rotateX(Math.PI / 2).translate(0, 0, .05), BRASS);
  // Термометр на шейке: посеребрённая пластина со шкалой, стеклянная трубка со спиртом, латунные скобы.
  const tc = Object.assign(document.createElement('canvas'), { width: 128, height: 768 }), tg = tc.getContext('2d'); tg.fillStyle = '#ded9cc'; tg.fillRect(0, 0, 128, 768); tg.strokeStyle = tg.fillStyle = ink; tg.textAlign = 'right'; tg.textBaseline = 'middle'; tg.font = '22px "Old Standard TT", serif';
  for (let d = -20; d <= 50; d += 2) { const y = 700 - (d + 20) / 70 * 640; tg.lineWidth = d % 10 ? 1.5 : 3; tg.beginPath(); tg.moveTo(d % 10 ? 84 : 72, y); tg.lineTo(100, y); tg.stroke(); if (d % 10 === 0) tg.fillText(String(d), 62, y); }
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace; tt.anisotropy = 8;
  mesh(new THREE.PlaneGeometry(.052, .3).translate(0, .4, .0425), new THREE.MeshStandardMaterial({ map: tt, roughness: .55, metalness: .1 }));
  mesh(new THREE.CylinderGeometry(.0042, .0042, .27, 10).translate(.017, .4, .047), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .35, roughness: .1 }));
  mesh(new THREE.CylinderGeometry(.002, .002, .13, 8).translate(.017, .335, .047), new THREE.MeshStandardMaterial({ color: 0x9c1f1a, roughness: .4 }));
  mesh(new THREE.SphereGeometry(.007, 12, 8).translate(.017, .262, .047), new THREE.MeshStandardMaterial({ color: 0x9c1f1a, roughness: .4 }));
  mesh(mergeGeometries([box(.064, .008, .006, 0, .555, .044), box(.064, .008, .006, 0, .245, .044), new THREE.SphereGeometry(.02, 16, 12).translate(0, .684, .02).toNonIndexed(), new THREE.CylinderGeometry(.008, .014, .024, 12).translate(0, .662, .02).toNonIndexed(), new THREE.CylinderGeometry(.016, .016, .012, 20).rotateX(Math.PI / 2).translate(0, -.285, .046).toNonIndexed()].map(q => q.index ? q.toNonIndexed() : q)), BRASS);
  G.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = o.userData.sunOnly = true; });
  // Лицом в зал, спинкой к стене.
  G.scale.setScalar(k); G.rotation.y = Math.PI; G.position.set(S.x, S.y, BACK.z - .012);
  return { group: G };
}
// Выпуклое зеркало в золочёной раме с шариками (такие вешали в библиотеках и клубах): в нём весь зал — маленький и круглый.
// Отражение — настоящий вид зала из точки зеркала (шесть снимков по сторонам куба); переснимается, когда в зале меняется свет.
// Первый раз — все стороны разом (под уходящей заставкой), дальше — по стороне за кадр: шесть сторон разом — ещё один полный кадр
// работы, зал на этом запинался (а свет меняется и сам: солнце идёт). Сторона, глядящая в стену за зеркалом, не переснимается вовсе.
const MIRROR = { d: 1.0, a: .355, bulge: .075 };
let mirror = null, mirrorDirty = false, mirrorAt = 0, mirrorBusy = false;
function buildMirror() {
  const G = new THREE.Group(), { d, a, bulge } = MIRROR, R = d / 2, z = BACK.z, gold = new THREE.MeshStandardMaterial({ color: 0xb8904a, metalness: .85, roughness: .38 }), black = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: .5 });
  // Рама: наружный валик, выкружка с шариками, чёрная рейка у стекла. Профиль [радиус, вынос от стены] вращается вокруг оси зеркала.
  const lathe = (pts, m) => { const o = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 72).rotateX(-Math.PI / 2), m); o.castShadow = o.receiveShadow = o.userData.sunOnly = true; G.add(o); };
  lathe([[R, 0], [R, .03], [R - .012, .055], [R - .04, .07], [R - .065, .06], [R - .075, .04], [R - .095, .03], [R - .115, .035], [R - .125, .05], [a + .022, .05], [a + .022, 0]], gold);
  lathe([[a + .022, .05], [a + .016, .058], [a + .004, .058], [a, .05], [a, .02]], black);
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(.017, 12, 8), gold, 36), m4 = new THREE.Matrix4();
  for (let i = 0; i < 36; i++) { const t = i / 36 * Math.PI * 2; balls.setMatrixAt(i, m4.makeTranslation(Math.cos(t) * (R - .085), Math.sin(t) * (R - .085), -.04)); } G.add(balls);
  // Стекло — шапочка шара: радиус a, выпуклость bulge.
  const Rs = (a * a + bulge * bulge) / (2 * bulge), glassGeo = new THREE.SphereGeometry(Rs, 64, 24, 0, Math.PI * 2, 0, Math.asin(a / Rs)).rotateX(-Math.PI / 2).translate(0, 0, Rs - bulge - .02);
  // Снимок — 1024 px на сторону куба: зеркало отражает угол чуть шире одной стороны, вблизи оно почти во весь экран — при 256 px отражение было в крупных точках.
  const target = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, anisotropy: 8 });
  // Материал — простой зеркальный: берёт снимок как есть. Со «стандартным» материалом three.js сам пересчитывает снимок в размытые копии
  // посреди кадра и оставляет рисование направленным в свою текстуру — экран замирает.
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({ color: 0xcfcac0, envMap: target.texture, reflectivity: 1 })); G.add(glass);
  const cam = new THREE.CubeCamera(.15, 60, target); cam.position.set(0, 0, -.12); G.add(cam);
  G.position.set(DIAL.x, DIAL.y, z - .012);
  // Порядок сторон куба: +x, −x, +y, −y, +z, −z; зеркало смотрит в зал, к −z. shoot() делает один шаг и отвечает, остались ли ещё.
  const order = [5, 0, 1, 2, 3]; let step = -1;
  const api = { group: G, shoot() {
    G.visible = false;
    if (step < 0) { cam.update(renderer, scene); step = 0; }
    else {
      // Уменьшенные копии снимка пересчитываются один раз, после последней стороны.
      target.texture.generateMipmaps = step === order.length - 1;
      renderer.setRenderTarget(target, order[step]); renderer.render(scene, cam.children[order[step]]);
      target.texture.generateMipmaps = true; step = (step + 1) % order.length;
    }
    G.visible = true; renderer.setRenderTarget(null); return step > 0;
  }, on() { mirror = api; mirrorDirty = true; } };
  return api;
}
// Задняя стена: над левым каталожным шкафом (в пару картине в правом поле) — ворон на полке и барометр вместе: ворон поменьше (один он был «крупноват») —
// ближе к шкафам, барометр — у пилястры, под бра; справа от «Идиллии», в пару часам, — выпуклое зеркало.
const RAVEN = { url: 'assets/models/birds/raven.glb', x: 5.5, y: 2.55, h: .92, turn: Math.PI, sink: .27, tint: .5, shelf: .42 };
const BAROMETER = { x: 4.4, y: 2.8, k: 1.25 };
// Повесить вещь built ({ group, on? }) на стену. Модель ворона не загрузилась — над шкафом пусто.
function hangOnWall(built) {
  scene.add(built.group); built.group.updateMatrixWorld(true);
  built.group.traverse(o => { if (o.isMesh) { o.receiveShadow = true; if (o.userData.sunOnly && sunOnly.length && !sunOnly.includes(o)) sunOnly.push(o); } });
  built.entry = { box: new THREE.Box3().setFromObject(built.group, true), margin: .2, wall: true }; standing.push(built.entry);
  built.on?.(); mirrorDirty = true;
  if (sun) sun.shadow.needsUpdate = true; shadowDirty = true;
}
async function hangWall() {
  hangOnWall(buildMirror());
  const model = await loadModel(RAVEN.url).catch(e => { console.warn(e); return null; });
  if (!model) return;
  const G = new THREE.Group();
  G.add(buildBird(model, RAVEN).group, buildBarometer(null, BAROMETER).group);
  hangOnWall({ group: G });
}
// Что стоит на полу или висит на стене: рамка вещи и сколько к ней можно подойти (margin) — для хождения (solid).
// У висящих (wall) — и снизу: под часами пройти можно. Мебель уголка (low) мешает только ниже своего верха: над диваном и креслами взгляд проходит, сквозь торшеры и пальму — нет.
const standing = [];
function stand(obj, x, z, turn = 0, margin = .25, y = 0) {
  obj.rotation.y = turn; obj.position.set(x, y, z); shadows(obj); obj.traverse(o => { o.userData.sunOnly = true; }); scene.add(obj);
  obj.updateMatrixWorld(true); standing.push({ box: new THREE.Box3().setFromObject(obj, true), margin });
}
// Глобусы: шар на своей оси (pivot), угол поворота и скорость — крутится, пока не остановит трение.
const globes = [];
function mountGlobe(model, G) {
  let ball = null; model.traverse(o => { if (o.isMesh && o.material.name === G.ball) ball = o; });
  if (!ball) return null;
  model.updateMatrixWorld(true);
  const [n, s] = G.poles.map(p => new THREE.Vector3(...p)), axis = n.clone().sub(s).normalize();
  const box = new THREE.Box3().setFromObject(ball, true), c = model.worldToLocal(box.getCenter(new THREE.Vector3()));
  // Ось — направление между шпеньками, но через центр шара: прямая через сами шпеньки скана проходит в 2–3 см от него, и шар бы качался.
  const pivot = new THREE.Object3D(); pivot.position.copy(c);
  pivot.quaternion.setFromUnitVectors(Y, axis); model.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(ball);
  return { ball, pivot, base: pivot.quaternion.clone(), angle: 0, vel: 0, r0: box.getSize(new THREE.Vector3()).x / 2 / model.matrixWorld.getMaxScaleOnAxis(), G };
}
// Карта глобуса: текстура по имени файла (4K, потом 8K — 4K на шаре забывается: раскодированная 8K держит в памяти 128 МБ). Не загрузилась — в следующий раз спросим снова.
// Картинка раскодируется вне главного потока (ImageBitmap, уже перевёрнутая) и сразу уходит в видеокарту: зал останавливается
// вдвое короче, чем с обычной картинкой (на 8K — около 0,3 с). Где ImageBitmap не умеет переворачивать — обычная картинка.
const globeMaps = new Map();
let bitmaps = null;
const globeMap = name => {
  if (!globeMaps.has(name)) globeMaps.set(name, new Promise(ok => {
    const url = `assets/globes/${name}.jpg`, done = t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.userData.name = name; renderer.initTexture(t); ok(t); };
    const plain = () => loader.load(url, done, undefined, () => { globeMaps.delete(name); ok(null); });
    if (typeof createImageBitmap === 'undefined') return plain();
    bitmaps ??= new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    bitmaps.load(url, b => { const t = new THREE.Texture(b); t.flipY = false; t.needsUpdate = true; done(t); }, undefined, plain);
  }));
  return globeMaps.get(name);
};
// 8K — только с мышью: на телефоне две такие карты (по 170 МБ в видеопамяти) могут уронить вкладку.
const bigMaps = () => !touchFirst && renderer.capabilities.maxTextureSize >= 8192;
// Одеть шар в карту: свой гладкий шар на той же оси вместо скана (у скана своя развёртка, карту на неё не положить).
// hi — подошли рассмотреть: 8192 px, если это компьютер с мышью и видеокарта такое держит; дальше этот глобус так и остаётся чётким
// (не загрузилась 8K — остаётся 4K до следующего раза).
async function dressGlobe(g, hi = false) {
  if (hi && bigMaps()) g.hi = true;
  const m = g.G.map, name = `${m.file}-${g.hi ? '8k' : '4k'}`;
  if (g.want === name) return; g.want = name;
  const t = await globeMap(name);
  // Не загрузилась — забыть, чтобы спросить снова; крупная — остаться на 4K.
  if (!t) { if (g.want === name) { g.want = null; if (name.endsWith('8k')) { g.hi = false; dressGlobe(g); } } return; }
  // Пришла не та, что ждём сейчас (4K, пока ждут 8K): годится, только если на шаре пока ещё нет никакой карты (скан).
  if (g.want !== name && g.shown) return;
  if (!g.sphere) {
    // Скан шара больше не нужен: убрать совсем (спрятанный, он перехватывал бы указатель).
    g.sphere = new THREE.Mesh(new THREE.SphereGeometry(g.r0 * .99, 128, 64), new THREE.MeshStandardMaterial({ roughness: .42, metalness: 0 }));
    g.sphere.castShadow = g.sphere.receiveShadow = true; g.sphere.userData = { sunOnly: true, globe: g }; g.pivot.add(g.sphere);
    if (sunOnly.length) sunOnly.push(g.sphere);
    const old = g.ball; old.removeFromParent(); old.geometry.dispose();
    for (const v of Object.values(old.material)) if (v?.isTexture) v.dispose();
    old.material.dispose();
  }
  // Повернуть шар на оси так, чтобы место front смотрело в зал (при нулевом угле прокрутки).
  const q = g.pivot.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(g.base).invert();
  const v = new THREE.Vector3(-Math.sign(g.G.x) * .35, 0, -1).applyQuaternion(q), phi = m.front * Math.PI * 2;
  g.sphere.rotation.y = Math.atan2(Math.sin(phi), -Math.cos(phi)) - Math.atan2(v.z, v.x);
  const was = g.sphere.material.map; g.sphere.material.map = t; g.sphere.material.needsUpdate = !was;
  if (was && was !== t) { was.dispose(); globeMaps.delete(was.userData.name); was.image?.close?.(); }
  g.shown = name; g.ball = g.sphere; g.R = g.r0 * .99 * g.group.matrixWorld.getMaxScaleOnAxis();
}
const spinQ = new THREE.Quaternion();
function spinGlobes(dt) {
  for (const g of globes) {
    if (g.held || Math.abs(g.vel) < 1e-3) continue;
    g.angle += g.vel * dt; g.vel *= Math.exp(-dt * .9);
    g.pivot.quaternion.copy(g.base).multiply(spinQ.setFromAxisAngle(Y, g.angle));
  }
}
let clockHands = null, hungClock = null;
// Собрать часы: группа с осью стрелок в начале (y часов — высота оси), лицом к −z, и узлы стрелок.
// Тень солнца (sunOnly) отбрасывает корпус; стрелки и стекло — нет: тень стекла легла бы на весь циферблат.
function buildClock(model) {
  const C = CLOCK, k0 = C.d / C.size, c = new THREE.Group(); model.position.set(-C.hub[0], -C.hub[1], -C.hub[2]); c.add(model); c.scale.setScalar(k0);
  // Крючок торчит за корпусом на 11 см: без него часы прижаты к штофу задней крышкой.
  model.traverse(o => { if (o.isMesh && o.name.startsWith('gancho')) o.visible = false; });
  model.updateMatrixWorld(true);
  // Стрелки — на свою ось: узел в центре втулки, стрелка к нему пристёгнута; поворот вокруг z (лицо часов — к −z, в зал).
  const pivots = {};
  for (const [key, name] of [['h', 'Aguja_Horas'], ['m', 'Aguja_Minutos']]) {
    let hand = null; model.traverse(o => { if (!hand && o.name.startsWith(name)) hand = o; });
    if (!hand) continue;
    const p = new THREE.Object3D(); model.add(p); p.position.set(...C.hub); p.updateMatrixWorld(true); p.attach(hand);
    pivots[key] = p;
  }
  // Стекло — простое прозрачное с бликами (у модели оно голубоватое и заметно мутнит циферблат).
  model.traverse(o => { if (o.isMesh && o.name.startsWith('cristal')) { o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .1, roughness: .04, metalness: 0, envMapIntensity: 1.6, depthWrite: false }); o.raycast = () => {}; } });
  model.traverse(o => { if (o.isMesh && o.visible && !o.name.startsWith('cristal') && !o.name.startsWith('Aguja')) o.castShadow = o.userData.sunOnly = true; });
  return { c, pivots };
}
// Повесить часы: спиной — к штофу; model — загруженная модель.
function hangClock(model) {
  const built = buildClock(model), { c } = built;
  c.position.set(0, 0, 0); c.updateMatrixWorld(true);
  const b = new THREE.Box3(); c.traverse(o => { if (o.isMesh && o.visible) b.expandByObject(o, true); });
  c.position.set(CLOCK.x, CLOCK.y, BACK.z - .012 - b.max.z);
  c.traverse(o => { if (o.isMesh) { o.receiveShadow = true; if (o.userData.sunOnly && sunOnly.length) sunOnly.push(o); } }); scene.add(c);
  c.updateMatrixWorld(true); b.translate(c.position); built.entry = { box: b, margin: .25, wall: true }; standing.push(built.entry);
  c.userData.clock = true; hungClock = built; clockHands = built.pivots; shownMinute = -1; setClockHands();
  if (sun) sun.shadow.needsUpdate = true; shadowDirty = true;
}
// Модель часов грузится один раз: не успела к развеске — часы повесятся, когда догрузится; не загрузилась — часов нет.
let clockModel = null;
const loadClockModel = () => clockModel ??= loadModel(CLOCK.url).catch(e => { console.warn(e); clockModel = null; return null; });
// Стрелки — на время зала. Часовая в модели смотрит вниз (на шесть), минутная — вверх. Положительный поворот вокруг z
// (против часовой, если смотреть с +z) тому, кто смотрит на циферблат с −z, виден по часовой.
let shownMinute = -1;
function setClockHands() {
  if (!clockHands) return;
  const t = roomTime(), m = t.getMinutes() + t.getSeconds() / 60, h = t.getHours() % 12 + m / 60;
  if (Math.abs(h * 60 - shownMinute) < .05) return; shownMinute = h * 60;
  if (clockHands.h) clockHands.h.rotation.z = h / 12 * Math.PI * 2 - Math.PI;
  if (clockHands.m) clockHands.m.rotation.z = m / 60 * Math.PI * 2;
}
function placeStanding(models) {
  hangWall();
  if (models.sculpt) placeSculpture(decor.sculpt, sculptModels[decor.sculpt] = models.sculpt);
  if (models.clock) hangClock(models.clock);
  else loadClockModel().then(m => { if (m && !hungClock) hangClock(m); });
  GLOBES.forEach((G, i) => {
    const m = models[`globe${i}`]; if (!m) return;
    let y = 0;
    if (woodMats.rail) { stand(globePlinth(woodMats.rail), G.x, GLOBE.z, 0, .15); y = GLOBE.plinth.h; }
    const g = mountGlobe(m, G), obj = fit(m, { h: GLOBE.h });
    stand(obj, G.x, GLOBE.z, G.turn, .15, y);
    if (g) { g.group = obj; g.ball.userData.globe = g; g.R = new THREE.Box3().setFromObject(g.ball, true).getSize(new THREE.Vector3()).x / 2; globes.push(g); dressGlobe(g); }
  });
}
// Уголок под балконом: мебель и лампы (lounge.js) и бра по бокам панели — до первой раздачи ламп (lightMasks), как у всего зала.
function placeNook(models, sconceModel) {
  nook = placeLounge({ scene, below, lights: wallLights, hallW: HALL.w, stand: (box, margin) => standing.push({ box, margin, low: true }) }, NOOK, models);
  // Проектор уголка светит на панель: кино (cinema.js) строится здесь же, до первой раздачи ламп и сборки шейдеров.
  if (nook.lens) { cinemaPanel = panelWorld(BACK.z); cinema = buildCinema({ scene, panel: cinemaPanel, lens: nook.lens, camera, renderer }); cinema.onEnd = cinemaEnded; for (const { l } of wallLights) if (nook.lights.includes(l)) nookLights.add(l); }
  for (const x of [-2.6, 2.6]) sconce(x, -HALL.depth + 2.3, BACK.z - .012, sconceModel);
}
// Картина в поле рамы: кусок, подрезанный под пропорции поля (как у куполков); flipY — для своих мешей, у мешей модели (glTF) — без переворота.
function framedArt(img, [cx, cy, cw, ch], aspect, flipY) {
  const W = 1024, H = Math.round(W / aspect), c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
  let sx = cx * img.width, sy = cy * img.height, sw = cw * img.width, sh = ch * img.height;
  if (sw / sh > aspect) { const n = sh * aspect; sx += (sw - n) / 2; sw = n; } else { const n = sw / aspect; sy += (sh - n) / 2; sh = n; }
  g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = flipY; t.anisotropy = 8; return t;
}
// Развесить и расставить: models — загруженные модели (рамы по ключам FRAMES, clock, globe0, globe1), arts — картины по именам файлов.
function placeBackWall(models, arts) {
  const { z } = BACK;
  placeStanding(models);
  for (const at of SCONCE.at) sconce(...at, models.sconce);
  // И по сторонам двери в дальнем торце: по бра посреди поля обшивки, лицом в зал.
  for (const at of FAR.sconces ?? []) sconce(...at, models.sconce, Math.PI);
  // Молотки — на выпуклом поле средней филёнки каждой створки.
  if (models.knocker) for (const s of [-1, 1]) { const k = models.knocker.clone(true); k.scale.setScalar(DOOR.knocker.k); k.position.set(DOOR.x + s * DOOR.w / 4, -HALL.depth + DOOR.knocker.y, RAIL_Z - HALL.len + .076); k.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.sunOnly = true; } }); k.userData.door = true; doorParts.push(k); scene.add(k); }
  for (const h of HANG) {
    const F = FRAMES[h.frame], src = models[h.frame], img = arts[h.art]; if (!src || !img) continue;
    const model = src.clone(true), box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), k = h.width / size.x;
    const tex = framedArt(img, h.crop, F.aperture[0] / F.aperture[1], !F.canvas);
    // Холст модели берёт из своей текстуры только часть (поле картины в квадрате): нашу картину растягиваем ровно на эту часть.
    if (F.canvas) model.traverse(o => {
      if (!o.isMesh || o.material.name !== F.canvas) return;
      const uv = o.geometry.attributes.uv; let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
      tex.repeat.set(1 / (u1 - u0), 1 / (v1 - v0)); tex.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0));
      o.material = o.material.clone(); o.material.map = tex; o.material.color?.set(0xffffff);
      // Холст матовый: с глянцем из текстуры модели лампа над картиной давала на ней яркий блик (виден снизу, от стола).
      o.material.roughnessMap = o.material.metalnessMap = null; o.material.roughness = 1; o.material.metalness = 0;
    });
    else {
      // Поле в форме арки: прямая часть и полукруг сверху, чуть шире проёма — край уходит под раму.
      const { w, y0, y1, z: az } = F.arch, r = w / 2, sh = new THREE.Shape().moveTo(-r, y0).lineTo(r, y0).lineTo(r, y1 - r).absarc(0, y1 - r, r, 0, Math.PI, false).lineTo(-r, y0);
      const g = new THREE.ShapeGeometry(sh, 32), p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + r) / w, (p.getY(i) - y0) / (y1 - y0));
      // Чуть ближе по глубине (polygonOffset): с дальнего конца зала зеркало под картиной иначе проступает сквозь неё пятнами.
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: .85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); m.position.z = az; model.add(m);
    }
    const c = box.getCenter(new THREE.Vector3()), group = new THREE.Group(); model.position.set(-c.x, -c.y, -(F.front > 0 ? box.min.z : box.max.z)); group.add(model);
    group.scale.setScalar(k); if (F.front > 0) group.rotation.y = Math.PI;
    group.position.set(h.x, h.y, z - .01); group.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.sunOnly = true; } }); scene.add(group);
    if (h.lamp) pictureLamp(h.x, new THREE.Box3().setFromObject(group).max.y, h.width * h.lamp);
  }
}
// Бра на пилястре: овальная латунная розетка, гнутый рожок, чашечка и колокольчик матового стекла — светится сам, вокруг — мягкий ореол.
// Модель — «Victorian Wall Lamp» (Javier Carceller, CC BY 4.0): в ней розетка в начале координат, рожок вдоль +z, высота 67 см — уменьшена
// до 32 см (SCONCE.k) и повёрнута в зал; стекло светится по карте свечения модели. Не загрузилась — такой же бра из простых форм.
// (x, y, z) — середина розетки на лице пилястры; рожок смотрит в зал (−z).
function sconce(x, y, z, model, turn = 0) {
  const g = new THREE.Group(), halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sconceGlow ??= radial([[0, 'rgba(255,214,150,.5)'], [.3, 'rgba(255,190,120,.16)'], [1, 'rgba(255,170,90,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(.7); g.add(halo); g.position.set(x, y, z); g.rotation.y = turn; scene.add(g);
  if (model) {
    const m = model.clone(true), k = SCONCE.k; m.scale.setScalar(k); m.rotation.y = Math.PI; m.position.z = -.008;
    m.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.userData.sunOnly = true; o.material.emissive.set(0xffd49a); o.material.emissiveIntensity = 1.5; });
    halo.position.set(0, .31 * k, -.2 * k); g.add(m); return;
  }
  const brassParts = [new THREE.CylinderGeometry(.05, .05, .012, 28).rotateX(Math.PI / 2).scale(1, 1.55, 1).translate(0, 0, -.006), new THREE.CylinderGeometry(.03, .036, .01, 24).rotateX(Math.PI / 2).scale(1, 1.55, 1).translate(0, 0, -.016),
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.01, -.015), new THREE.Vector3(0, -.075, -.085), new THREE.Vector3(0, -.06, -.17), new THREE.Vector3(0, .0, -.2), new THREE.Vector3(0, .035, -.2)]), 28, .0075, 10),
    new THREE.SphereGeometry(.014, 12, 8).translate(0, -.078, -.1), new THREE.CylinderGeometry(.03, .014, .03, 20).translate(0, .05, -.2), new THREE.CylinderGeometry(.034, .034, .006, 20).translate(0, .067, -.2)];
  const body = new THREE.Mesh(mergeGeometries(brassParts.map(p => p.toNonIndexed())), BRASS); body.castShadow = true; body.userData.sunOnly = true;
  const profile = [[.026, 0], [.04, .012], [.052, .04], [.056, .075], [.05, .11], [.047, .135], [.056, .16]].map(([r, h]) => new THREE.Vector2(r, h));
  const shade = new THREE.Mesh(new THREE.LatheGeometry(profile, 28).translate(0, .066, -.2), new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: 0xffd49a, emissiveIntensity: 1.5, roughness: .45, side: THREE.DoubleSide }));
  halo.position.set(0, .15, -.2); g.add(body, shade);
}
let sconceGlow = null, backDamask = null;
// Лампа над картиной: латунный кожух-трубка на двух гнутых ножках от стены, снизу — светящаяся щель. Светит сама картина — от прожектора стены (wallLights).
const BRASS = new THREE.MeshStandardMaterial({ color: 0xb08d4f, metalness: .85, roughness: .34 });
function pictureLamp(x, top, len) {
  const { z } = BACK, y = top + .13, zt = z - .3, g = new THREE.Group(), parts = [new THREE.CylinderGeometry(.03, .03, len, 20).rotateZ(Math.PI / 2).translate(x, y, zt)];
  for (const s of [-1, 1]) {
    parts.push(new THREE.SphereGeometry(.03, 16, 10).translate(x + s * len / 2, y, zt));
    const ax = x + s * len * .3, arm = new THREE.CatmullRomCurve3([new THREE.Vector3(ax, top + .05, z - .01), new THREE.Vector3(ax, top + .2, z - .1), new THREE.Vector3(ax, top + .21, z - .22), new THREE.Vector3(ax, y + .02, zt)]);
    parts.push(new THREE.TubeGeometry(arm, 20, .009, 8), new THREE.CylinderGeometry(.03, .03, .012, 16).rotateX(Math.PI / 2).translate(ax, top + .05, z - .006));
  }
  const body = new THREE.Mesh(mergeGeometries(parts.map(p => p.toNonIndexed())), BRASS); body.castShadow = true; body.userData.sunOnly = true;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(len * .92, .004, .028).translate(x, y - .03, zt + .006), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  g.add(body, slit); scene.add(g);
}
function instanceAll(model, spots) {
  model.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), lifted = new Set();
  model.traverse(o => {
    // Нарисованные в модели ряды книг заменяем настоящими томами (books.js).
    if (!o.isMesh || o.name.includes('book-stacks')) return;
    if (!lifted.has(o.material)) { lifted.add(o.material); liftUpper(toneShelves(o.material), 1); }
    const im = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
    spots.forEach(([x, y, z, r], i) => { q.setFromAxisAngle(Y, r); im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, one).multiply(o.matrixWorld)); });
    im.receiveShadow = im.castShadow = true; im.userData.sunOnly = true; scene.add(im);
  });
}
function bookcaseSpots() {
  const spots = [];
  for (const s of [-1, 1]) for (const y of [-HALL.depth, 0]) for (let z = RAIL_Z - 2.2; z > RAIL_Z - HALL.len + 1; z -= 3.95) spots.push([s * (HALL.w / 2 - .36), y, z, -s * Math.PI / 2]);
  for (const s of [-1, 1]) for (let z = RAIL_Z + 1.9; z + 1.92 <= RAIL_Z + GAL; z += 3.95) spots.push([s * (HALL.w / 2 - .36), 0, z, -s * Math.PI / 2]);
  for (const [y, xs] of [[-HALL.depth, FAR.lower], [0, FAR.upper]]) for (const x of xs) spots.push([x, y, RAIL_Z - HALL.len + .36, 0]);
  // Ряд нижних шкафов продолжается под балконом (в конце списка — чтобы книги прежних шкафов не сдвинулись).
  if (NOOK) for (const s of nookBooks(NOOK)) spots.push([s * (HALL.w / 2 - .36), -HALL.depth, RAIL_Z - 2.2 + 3.95, -s * Math.PI / 2]);
  return spots;
}
// Внизу — ряды читальных столов с зелёными лампами. Поздний вечер: горит не каждая. Сами лампы встают позже, когда загрузится
// их модель (tablelamps.js), — здесь только их места; какие горят — как их оставили в прошлый раз, а до первого щелчка — как выпадет.
const lampSpots = [];
// Где стоят столы (середины) и их размер — по ним же стулья не заезжают в стол.
const readingTables = { at: [], L: 3.4, D: 1.15 };
function buildReadingTables(mahogany) {
  // Сукно — снимок настоящего: мелкий ворс в рельефе и неровность войлока в цвете (сам цвет — зелень зала). Свет ламп на сукне
  // и на дереве столешницы считают их шейдеры (lampLit), поэтому у столешницы свой материал — цвет ему даёт tintWood, как прочему дереву;
  // свой материал и у ножек: дереву столов достаётся отражённый свет нижнего зала (below), а перилам галереи из того же дерева — нет.
  const cloth = below(lampLit(new THREE.MeshStandardMaterial({ map: texShared('assets/textures/baize-color.jpg', true, [1 / BAIZE.mottle, 1 / BAIZE.mottle]), normalMap: texShared('assets/textures/baize-normal.jpg', false, [1 / BAIZE.nap, 1 / BAIZE.nap]), normalScale: new THREE.Vector2(BAIZE.relief, BAIZE.relief), color: BAIZE.color, roughness: .95 }), true));
  const topWood = below(lampLit(mahogany.clone())), legWood = below(mahogany.clone()); (woodMats.extra ??= []).push(topWood, legWood);
  const tables = readingTables.at;
  for (let z = RAIL_Z - 3.2; z > RAIL_Z - HALL.len + 3; z -= 3.6) for (const x of [-2.6, 2.6]) tables.push([x, z]);
  const { L, D } = readingTables, H = TABLE_H, y0 = -HALL.depth;
  // Стол — не доска на брусках: рядом с подробной лампой голые коробки смотрелись чужими («рассинхрон между тем, какие детализированные
  // лампы и какие недетализированные столы», 2026-11-14). Столешница с калёвкой по краю, сукно вровень с её полем, под ней царга с валиком,
  // шесть точёных ножек (средняя пара — под серединой длинных сторон). Всё дерево стола — две сетки на все столы.
  const up = new THREE.Vector3(0, 1, 0), edge = [[1, 1], [-1, 1], [-1, -1], [1, -1]].flatMap(([a, b]) => { const f = { p: new THREE.Vector3(a * L / 2, 0, b * D / 2), n: new THREE.Vector3(a, 0, b), b: up }; return [f, f]; });
  const top = new THREE.InstancedMesh(mergeGeometries([sweep(TABLE.edge, edge, true, true), metricUV(new THREE.PlaneGeometry(L - .04, D - .04).rotateX(Math.PI / 2).translate(0, TABLE.edge.at(-1)[1], 0))]), topWood, tables.length);
  const baize = new THREE.InstancedMesh(metricUV(new THREE.BoxGeometry(L - .16, .052, D - .16)), cloth, tables.length);
  tableLit = tableLight(tables.length); top.geometry.setAttribute('aLamps', tableLit); baize.geometry.setAttribute('aLamps', tableLit);
  const [bw, bh] = TABLE.block, turned = new THREE.LatheGeometry(TABLE.leg.map(([r, y]) => new THREE.Vector2(r, y)), 16), under = [sweep(TABLE.apron, edge, true, true)];
  // Волокна — вдоль ножки.
  { const p = turned.attributes.position, uv = turned.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getY(i), Math.atan2(p.getZ(i), p.getX(i)) * .03); }
  for (const a of [-1, 0, 1]) for (const b of [-1, 1]) { const x = a * (L / 2 - TABLE.inset), z = b * (D / 2 - TABLE.inset); under.push(turned.clone().translate(x, -H, z), metricUV(new THREE.BoxGeometry(bw, bh, bw), 'y').translate(x, TABLE.apron[0][1] - bh / 2, z)); }
  const legs = new THREE.InstancedMesh(mergeGeometries(under), legWood, tables.length);
  // Два места у каждой длинной стороны стола — по Фибоначчи: поля у торцов относятся как соседние числа ряда,
  // промежуток между местами — их сумма. Какое отношение у какой стороны — по золотому сечению, без повторов подряд.
  const RHYTHM = [[1, 1], [1, 2], [2, 1], [2, 3], [3, 2], [3, 5], [5, 3]];
  const was = typeof stored.hallLamps === 'string' ? stored.hallLamps : '';
  let n = 0;
  tables.forEach(([x, z]) => { for (const b of [-1, 1]) {
    const [m1, m2] = RHYTHM[Math.floor(((n++ * .6180339887) % 1) * RHYTHM.length)], u = L / 2 / (m1 + m2);
    for (const a of [-L / 2 + m1 * u, L / 2 - m2 * u]) { const i = lampSpots.length, lit = was.length === tables.length * 4 ? was[i] === '1' : Math.random() < USUAL; lampSpots.push({ x: x + a, z: z + b * .18, side: b, lit }); seats.push([x + a, z, b, lit]); }
  } });
  const m = new THREE.Matrix4();
  tables.forEach(([x, z], i) => {
    top.setMatrixAt(i, m.makeTranslation(x, y0 + H, z)); baize.setMatrixAt(i, m.makeTranslation(x, y0 + H + .002, z)); legs.setMatrixAt(i, m.makeTranslation(x, y0 + H, z));
  });
  for (const im of [top, baize, legs]) { im.castShadow = im.receiveShadow = true; im.userData.sunOnly = true; scene.add(im); }
  // Общий свет нижнего зала — четыре невидимых источника над проходом: свет всех ламп на столах разом (hallGlow).
  for (let z = RAIL_Z - 4; z > RAIL_Z - HALL.len + 2; z -= 7) { const l = new THREE.PointLight(0xffb878, 6, 12, 1.6); l.position.set(0, -HALL.depth + 3.6, z); scene.add(l); hallLights.push(l); }
}
const TABLE_H = .76;
// Дерево стола, в метрах от TABLE_H (верх сукна — на .028 выше). edge — профиль края столешницы [наружу от края, вверх]: поле вровень
// с сукном, скругление, полочка, выкружка, низ; apron — царга под ней: лицо, валик по низу, изнанка. Ножка: block — брусок под
// столешницей [сторона, высота], inset — её середина от края стола; leg — точёная часть [радиус, высота от пола].
const TABLE = {
  edge: [[-.08, .02], [-.08, .0285], [-.012, .0285], [-.006, .0267], [-.002, .022], [0, .0155], [0, .004], [-.003, -.002], [-.009, -.007], [-.016, -.0105], [-.02, -.016], [-.02, -.03]],
  apron: [[-.07, -.03], [-.07, -.118], [-.066, -.121], [-.064, -.126], [-.066, -.131], [-.07, -.134], [-.092, -.134], [-.092, -.03]],
  block: [.095, .12], inset: .1095,
  leg: [[0, 0], [.022, 0], [.027, .006], [.027, .022], [.022, .028], [.031, .034], [.035, .046], [.031, .058], [.021, .064], [.0235, .07], [.026, .12], [.032, .3], [.039, .47], [.0425, .5], [.047, .512], [.047, .522], [.04, .53], [.0355, .545], [.0425, .56], [.0495, .575], [.0495, .59], [.0425, .6], [.0475, .61]],
};
// Сукно: цвет (со снимком неровностей выходит прежняя зелень 0x2e3d2a); сколько метров стола покрывает один снимок ворса (nap, рельеф)
// и один снимок неровностей (mottle, цвет); сила рельефа.
const BAIZE = { color: 0x3c4e37, nap: .27, mottle: .7, relief: 1 };
let tableLamps = null, tableLit = null;
let ceiling = null;
// Места внизу: у каждой лампы — стул. [x, z стола, сторона, горит ли лампа]
const seats = [];
// Стулья — акцент зала. Зал держат тёплое дерево (оранжево-коричневое) и зелень ламп и сукна; обивка — три цвета против них:
// — кобальтовый бархат: дополнительный к дереву и паркету — сильнее всего отделяет стул от пола;
// — малиновый (сливово-розовый) бархат: дополнительный к зелени ламп и сукна, от дерева отличается холодным оттенком;
// — старое золото: светлее пола и дерева по тону, перекликается с латунью ламп и розеток.
// Вместе — почти триада по кругу цветов; доли — 4 : 3 : 2 (золото — реже, как блик). Соседние стулья у стола — разного цвета.
// Беспорядок — по золотому сечению: у каждого свой отступ и поворот, без повторов и без строя.
// У горящей лампы стул отодвинут и повёрнут, будто человек только что встал; у погашенной — задвинут.
const UPHOLSTERY = [['#2a4a92', 4], ['#7e2452', 3], ['#b4852c', 2]];
// Люстры висят на крюках в замке свода, между куполками: бронза, хрустальные чаши, свечи-лампы.
// Хрусталь — простой прозрачный материал (преломление в модели дорого и здесь не нужно); светятся только свечи —
// их в текстуре видно по светлому нейтральному серому.
function hangChandeliers(model, hooks) {
  // У модели сверху — чашечка и витой стержень до шишки над рожками (до 0,45 м от верха модели в её мерках): их убираем,
  // от потолка до шишки идёт наша цепь. STEM — высота шишки от верха люстры в метрах зала.
  const SIZE = 2.4, DROP = 1.1, fitted = fit(model, { h: SIZE }); fitted.updateMatrixWorld(true);
  let topY = -Infinity, lowY = Infinity;
  fitted.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); topY = Math.max(topY, o.geometry.boundingBox.max.y); lowY = Math.min(lowY, o.geometry.boundingBox.min.y); } });
  const CUT = topY - .441, STEM = .441 * SIZE / (topY - lowY);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  candle = { value: 1 };
  fitted.traverse(o => {
    if (!o.isMesh) return;
    let mat;
    if (o.material.transmission > 0 || o.material.transparent) mat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, transparent: true, opacity: .32, roughness: .06, metalness: .1, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
    else {
      mat = o.material.clone();
      mat.onBeforeCompile = sh => {
        sh.uniforms.uCandle = candle;
        sh.fragmentShader = 'uniform float uCandle;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 cTex = texture2D(map, vMapUv).rgb;
          float cLum = dot(cTex, vec3(.3333)), cSat = max(max(cTex.r, cTex.g), cTex.b) - min(min(cTex.r, cTex.g), cTex.b);
          totalEmissiveRadiance += vec3(1., .74, .42) * uCandle * 3. * smoothstep(.4, .5, cLum) * (1. - smoothstep(.02, .06, cSat));`);
      };
      mat.customProgramCacheKey = () => 'chandelier';
    }
    let geo = o.geometry;
    if (!mat.transparent) {
      // Треугольники выше шишки — прочь.
      geo = geo.clone(); const P = geo.attributes.position, src = geo.index.array, keep = [];
      for (let t = 0; t < src.length; t += 3) if (Math.max(P.getY(src[t]), P.getY(src[t + 1]), P.getY(src[t + 2])) < CUT) keep.push(src[t], src[t + 1], src[t + 2]);
      geo.setIndex(keep);
    }
    const im = new THREE.InstancedMesh(geo, mat, hooks.length);
    hooks.forEach((h, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y - DROP - SIZE, h.z), q.setFromAxisAngle(Y, i * .7), one).multiply(o.matrixWorld)));
    scene.add(im);
  });
  // Подвес из латуни: на ребре свода — точёная чаша-розетка с бусиной и шишечкой, из неё — кольцо и цепь до чаши самой люстры.
  // Всё в местных осях крюка: y = 0 — нижняя грань ребра (ребро свода выступает на 0,26 м, крюк — на 0,02 м ниже замка).
  const brassMount = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: .32, envMapIntensity: 1.3 });
  const mount = (() => {
    const parts = [], v = (r, y) => new THREE.Vector2(r, y);
    // Чаша: широкий край у ребра, валик, впалая шейка, бусина внизу.
    // Точки профиля — снизу вверх: так грани точёного тела смотрят наружу.
    // Чаша — между золочёными бусинами ребра: поле между ними — 0,22 м, чаша — 0,19 м в поперечнике.
    parts.push(new THREE.LatheGeometry([v(0, 0), v(.092, 0), v(.095, -.01), v(.088, -.02), v(.078, -.026), v(.07, -.044), v(.053, -.074), v(.038, -.094), v(.031, -.103), v(.034, -.112), v(.031, -.122), v(.019, -.129), v(.016, -.146), v(.02, -.155), v(.017, -.163), v(0, -.165)].reverse(), 40));
    // Кольцо под чашей и цепь: звенья вытянутые, каждое следующее повёрнуто на четверть оборота.
    const top = -.172, bottom = -(DROP - .24) - STEM + .03, link = new THREE.TorusGeometry(.02, .0055, 8, 18).scale(1, 1.5, 1), pitch = .052;
    parts.push(new THREE.TorusGeometry(.022, .007, 8, 20).translate(0, top + .005, 0));
    const n = Math.max(1, Math.round((top - bottom) / pitch));
    for (let k = 0; k < n; k++) parts.push(link.clone().rotateY(k % 2 ? Math.PI / 2 : 0).translate(0, top - .03 - k * (top - bottom - .03) / n, 0));
    parts.push(new THREE.TorusGeometry(.026, .008, 8, 20).rotateY(Math.PI / 2).translate(0, bottom + .01, 0));
    return mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
  })();
  const mounts = new THREE.InstancedMesh(mount, brassMount, hooks.length);
  hooks.forEach((h, i) => mounts.setMatrixAt(i, m.makeTranslation(h.x, h.y - .24, h.z)));
  mounts.castShadow = true; scene.add(mounts);
  // Ореол вокруг каждой — тёплое свечение в воздухе (свет — от трёх, см. buildHall).
  const halo = new THREE.SpriteMaterial({ map: radial([[0, 'rgba(255,214,150,.55)'], [.3, 'rgba(255,190,120,.18)'], [1, 'rgba(255,170,90,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  chandelierHalo = halo;
  for (const h of hooks) { const sp = new THREE.Sprite(halo); sp.position.set(h.x, ceiling.chandelierY, h.z); sp.scale.setScalar(3.2); scene.add(sp); }
}
// Из кресла — стул. Подлокотник со своей стойкой — одна трубка в сетке каркаса: она снимается целиком, от середины до двух своих стыков —
// на раме сиденья и на стойке спинки. Резать по рамке в пространстве нельзя: от стоек остаются пеньки («колышки» по бокам сиденья),
// а у спинки срезаются грани её стоек и края обивки. У сиденья под стойкой в боку подушки — треугольная дыра: она закрывается тканью.
// У спинки подлокотник входил в утолщение её стойки: оно прижимается к стойке и закрывается её деревом. Следы подлокотника в самих
// текстурах (дерево стойки на боку и верху подушки, пустое место на стойке спинки) закрашены в файлах — tools/models/chair_retouch.html.
// seed — заведомо подлокотник; part — докуда от него идти по сетке (у сиденья — до самой рамы); cloth — выше этого у сиденья только подушка;
// stile — лицо стойки спинки (куда прижать край), lean — его нормаль, joint — докуда вокруг стыка выпрямлять нормали; wood — место
// этого лица в текстуре (метры модели).
const ARM = {
  seed: (x, y, z) => Math.abs(x) > .26 && y > .52 && z > -.2,
  part: (x, y, z) => Math.abs(x) > .2 && z >= -.26 && (y >= .437 || (y > .375 && z > .12 && z < .2)),
  cloth: .378, joint: .065, lean: [0, .187, .982],
  stile: (x, y) => [Math.sign(x) * Math.min(Math.max(Math.abs(x), .215), .248 - (y - .596) * .06), y, -.264 - (y - .6) * .19],
  wood: (x, y) => [(x > 0 ? 766.5 + (x - .215) * 560 : 810.5 - (-x - .214) * 560) / 1024, (909.5 - (y - .5965) * 518) / 1024],
};
function withoutArms(source) {
  const geo = source.clone(), P = geo.attributes.position, N = geo.attributes.normal, src = geo.index.array, n = src.length / 3;
  // Вершины в одном месте — одна точка (в файле они разведены по швам развёртки).
  const ids = new Map(), w = new Uint32Array(P.count);
  for (let i = 0; i < P.count; i++) { const k = `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`; if (!ids.has(k)) ids.set(k, ids.size); w[i] = ids.get(k); }
  const at = Array.from({ length: ids.size }, () => []);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) at[w[src[t * 3 + k]]].push(t);
  const all = (t, f) => [0, 1, 2].every(k => { const i = src[t * 3 + k]; return f(P.getX(i), P.getY(i), P.getZ(i)); });
  const gone = new Uint8Array(n), stack = [];
  for (let t = 0; t < n; t++) if (all(t, ARM.seed)) { gone[t] = 1; stack.push(t); }
  while (stack.length) { const t = stack.pop(); for (let k = 0; k < 3; k++) for (const u of at[w[src[t * 3 + k]]]) if (!gone[u] && all(u, ARM.part)) { gone[u] = 1; stack.push(u); } }
  // Края отверстий: открытые рёбра оставшейся сетки, по кругу от тех, за которыми был подлокотник.
  const cut = new Set(), have = new Set(), next = new Map(), keep = [];
  const edges = (t, f) => { for (let k = 0; k < 3; k++) f(src[t * 3 + k], src[t * 3 + (k + 1) % 3]); };
  for (let t = 0; t < n; t++) edges(t, (a, b) => (gone[t] ? cut : have).add(w[a] + '>' + w[b]));
  for (let t = 0; t < n; t++) if (!gone[t]) { keep.push(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]); edges(t, (a, b) => { if (!have.has(w[b] + '>' + w[a])) next.set(w[a], [a, b]); }); }
  const loops = [];
  for (const k of cut) { const loop = []; for (let e = next.get(+k.split('>')[1]); e && next.delete(w[e[0]]); e = next.get(w[e[1]])) loop.push(e[0]); if (loop.length > 2) loops.push(loop); }
  const extra = [], p = i => new THREE.Vector3().fromBufferAttribute(P, i), mean = list => list.reduce((c, i) => c.add(p(i)), new THREE.Vector3()).divideScalar(list.length);
  const steep = t => { const a = p(src[t * 3]); return Math.abs(p(src[t * 3 + 1]).sub(a).cross(p(src[t * 3 + 2]).sub(a)).normalize().y) < .7; };
  for (const loop of loops) {
    if (mean(loop).y < .55) {
      // У сиденья: углы дыры берутся у боковых треугольников подушки — с их местом в текстуре и нормалями.
      const corner = loop.map(i => { const t = at[w[i]].find(t => !gone[t] && steep(t) && all(t, (x, y) => y > ARM.cloth)); return t === undefined ? i : [0, 1, 2].map(k => src[t * 3 + k]).find(j => w[j] === w[i]); });
      for (let k = 2; k < corner.length; k++) keep.push(corner[0], corner[k], corner[k - 1]);
      continue;
    }
    // У спинки: край ложится на лицо стойки; он, крышка и треугольники утолщения получают свои вершины — с деревом стойки и её нормалью.
    const ring = new Set(loop.map(i => w[i])), twins = new Map(), twin = i => twins.get(i) ?? twins.set(i, P.count + extra.push([i]) - 1).get(i);
    for (let i = 0; i < P.count; i++) if (ring.has(w[i])) P.setXYZ(i, ...ARM.stile(P.getX(i), P.getY(i)));
    const mid = mean(loop);
    for (let i = 0; i < P.count; i++) if (N.getZ(i) > .5 && p(i).distanceTo(mid) < ARM.joint) N.setXYZ(i, ...ARM.lean);
    for (let k = 0; k < keep.length; k += 3) if ([0, 1, 2].some(c => keep[k + c] < P.count && ring.has(w[keep[k + c]]))) for (let c = 0; c < 3; c++) keep[k + c] = twin(keep[k + c]);
    const centre = P.count + extra.push(loop) - 1;
    loop.forEach((i, k) => keep.push(twin(loop[(k + 1) % loop.length]), twin(i), centre));
  }
  for (const [name, a] of Object.entries(geo.attributes)) {
    const size = a.itemSize, arr = new a.array.constructor((a.count + extra.length) * size); arr.set(a.array);
    extra.forEach((from, j) => { const q = mean(from); arr.set(name === 'normal' ? ARM.lean : name === 'uv' ? ARM.wood(q.x, q.y) : q.toArray(), (a.count + j) * size); });
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  geo.setIndex(keep);
  return geo;
}
// Стулья можно переставлять («могут найтись педанты, которых наш творческий беспорядок расположения стульев может не устроить»,
// 2026-11-14). Взяли за сиденье или ножки — стул едет по полу, не поворачиваясь; взяли за спинку — едет за рукой, как
// настоящий, которого тянут за спинку: разворачивается следом (так его и крутят — без колеса и пальцем на экране). Колесо, пока
// держите, тоже поворачивает. Отпустили почти ровно — встаёт ровно. Берутся только снизу, из зала: с галереи стул не утащить.
// x и z — докуда стулу можно по полу зала (до шкафов и торцов); gap — ближе этого середины двух стульев не сходятся; hold — ближе
// этого к оси стула и за спинку его не развернуть; leg — радиус ножки стола с запасом (стул её не проходит); snap — на сколько радиан от прямого угла стул, который поворачивали, доводится.
// «Вернуть как было» — в «убранстве».
const CHAIR = { x: HALL.w / 2 - 1.15, z: [RAIL_Z - HALL.len + 1.15, RAIL_Z - .5], gap: .5, hold: .13, snap: .09, leg: .06 };
let chairs = null;
function placeChairs(model) {
  let mesh = null; model.updateMatrixWorld(true); model.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return;
  const geo = withoutArms(mesh.geometry), narrow = new THREE.Vector3(.82, 1, .94);
  // Обивка в текстуре — серо-зелёная (зелёный выше красного), дерево — красно-коричневое: перекрашивается только ткань, узор её остаётся.
  const mat = below(mesh.material.clone());
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 aTint;\nvarying vec3 vTint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTint = aTint;');
    sh.fragmentShader = 'varying vec3 vTint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        float cloth = smoothstep(-.005, .02, sampledDiffuseColor.g - sampledDiffuseColor.r);
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vTint * dot(sampledDiffuseColor.rgb, vec3(.2126, .7152, .0722)) / .14, cloth);
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'chair';
  const im = new THREE.InstancedMesh(mesh.geometry, mat, seats.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), at = new THREE.Vector3();
  const g1 = .6180339887, g2 = .7548776662, g3 = .5698402910, tint = new Float32Array(seats.length * 3), c = new THREE.Color();
  const bag = UPHOLSTERY.flatMap((_, k) => Array(UPHOLSTERY[k][1]).fill(k));
  const colour = [];
  const list = seats.map(([x, z, side, lit], i) => {
    // Места у стола — по четыре: двое с одной стороны, двое напротив. Соседний и сидящий напротив — другого цвета.
    let k = bag[Math.floor(((i * g3) % 1) * bag.length)];
    while ((i % 2 && k === colour[i - 1]) || (i % 4 >= 2 && k === colour[i - 2])) k = (k + 1) % UPHOLSTERY.length;
    colour.push(k);
    c.set(UPHOLSTERY[k][0]).multiplyScalar(.9 + ((i * g1 + .3) % 1) * .2); c.toArray(tint, i * 3);
    const u = (i * g1) % 1, v = (i * g2) % 1, pull = lit ? .3 + u * .32 : .04 + u * .1;
    return { x: x + (v - .5) * (lit ? .2 : .05), z: z + side * (.575 + pull), rot: (side > 0 ? Math.PI : 0) + (v - .5) * (lit ? .8 : .1) };
  });
  // Стулья, которые переставляли, стоят там, где их оставили; home — как их расставил зал.
  const home = list.map(s => ({ ...s })), kept = Array.isArray(stored.hallChairs) && stored.hallChairs.length === list.length;
  if (kept) stored.hallChairs.forEach(([x, z, rot], i) => Object.assign(list[i], { x, z, rot }));
  const put = i => { const s = list[i]; im.setMatrixAt(i, m.compose(at.set(s.x, -HALL.depth, s.z), q.setFromAxisAngle(Y, s.rot), narrow).multiply(mesh.matrixWorld)); im.instanceMatrix.needsUpdate = true; };
  list.forEach((_, i) => put(i));
  im.geometry = geo; geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  // Рамка — весь пол зала: куда бы стул ни переставили, он не выпадет из кадра и из своих ламп (lightMasks).
  im.boundingBox = new THREE.Box3(new THREE.Vector3(-CHAIR.x - .5, -HALL.depth, CHAIR.z[0] - .5), new THREE.Vector3(CHAIR.x + .5, -HALL.depth + 1.1, CHAIR.z[1] + .5)); im.boundingSphere = im.boundingBox.getBoundingSphere(new THREE.Sphere());
  im.receiveShadow = im.castShadow = true; im.userData.sunOnly = true; scene.add(im);
  // Стул под лучом: сиденье с ножками и спинка — две коробки в осях стула (ширина, высота от пола, глубина — уже суженного).
  const local = new THREE.Ray(), turn = new THREE.Matrix4(), hit = new THREE.Vector3(), boxes = [new THREE.Box3(new THREE.Vector3(-.28, 0, -.36), new THREE.Vector3(.28, .5, .27)), new THREE.Box3(new THREE.Vector3(-.24, .5, -.36), new THREE.Vector3(.24, 1.06, -.2))];
  chairs = {
    list, touched: false,
    at(ray) {
      let best = null;
      list.forEach((s, i) => {
        local.copy(ray).applyMatrix4(turn.makeRotationY(-s.rot).multiply(m.makeTranslation(-s.x, HALL.depth, -s.z)));
        for (const b of boxes) if (local.intersectBox(b, hit)) { const d = local.origin.distanceTo(hit); if (!best || d < best.d) best = { i, d, point: ray.at(d, new THREE.Vector3()), back: b === boxes[1] }; }
      });
      return best;
    },
    // Поставить стул: в пределах пола зала, не в соседний стул и не спинкой в стол. Сиденье под стол уходит (оно ниже царги),
    // спинка — нет: стул, повёрнутый к столу лицом, задвигается, пока спинка не дойдёт до края столешницы, а боком или спиной
    // в стол не входит вовсе («в стол проходит», 2026-11-14 — раньше снаружи держалась только середина стула). И ножки стола стул
    // не проходит («сделай, чтобы и ножки стола стул не проходил»).
    move(i, x, z) {
      const s = list[i], { at: tables, L, D } = readingTables, hx = L / 2 + .01, hz = D / 2 + .01, cos = Math.cos(s.rot), sin = Math.sin(s.rot), [seat, b] = boxes;
      const legs = [-1, 0, 1].flatMap(a => [-1, 1].map(c => [a * (L / 2 - TABLE.inset), c * (D / 2 - TABLE.inset)]));
      // Спинка сверху — прямоугольник; берётся его рамка по осям зала относительно середины стула.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const lx of [b.min.x, b.max.x]) for (const lz of [b.min.z, b.max.z]) { const wx = lx * cos + lz * sin, wz = lz * cos - lx * sin; x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz); }
      x = clamp(x, -CHAIR.x, CHAIR.x); z = clamp(z, CHAIR.z[0], CHAIR.z[1]);
      for (let pass = 0; pass < 3; pass++) {
        for (const [tx, tz] of tables) {
          // На сколько спинке выходить из стола в каждую из четырёх сторон; выходит туда, куда ближе.
          const left = x + x1 - (tx - hx), right = tx + hx - (x + x0), near = z + z1 - (tz - hz), far = tz + hz - (z + z0), out = Math.min(left, right, near, far);
          if (out > 0) { if (out === left) x -= left; else if (out === right) x += right; else if (out === near) z -= near; else z += far; }
          // Ножки стола — круги, стул сверху — прямоугольник сиденья с ножками: ножка стола в него не входит.
          for (const [ax, az] of legs) {
            const lx = tx + ax - x, lz = tz + az - z; if (lx * lx + lz * lz > 1) continue;
            // Ножка в осях стула и ближайшая к ней точка сиденья.
            const px = lx * cos - lz * sin, pz = lx * sin + lz * cos, qx = clamp(px, seat.min.x, seat.max.x), qz = clamp(pz, seat.min.z, seat.max.z), d = Math.hypot(px - qx, pz - qz);
            if (d >= CHAIR.leg) continue;
            // Куда и на сколько отойти стулу (в его осях): от ножки, а если она уже под сиденьем — в ту сторону, где до края ближе.
            let mx, mz;
            if (d > 1e-6) { mx = (qx - px) / d * (CHAIR.leg - d); mz = (qz - pz) / d * (CHAIR.leg - d); }
            else { const e = [px - seat.min.x, seat.max.x - px, pz - seat.min.z, seat.max.z - pz], m = Math.min(...e), k = e.indexOf(m); mx = k === 0 ? m + CHAIR.leg : k === 1 ? -m - CHAIR.leg : 0; mz = k === 2 ? m + CHAIR.leg : k === 3 ? -m - CHAIR.leg : 0; }
            x += mx * cos + mz * sin; z += mz * cos - mx * sin;
          }
        }
        list.forEach((o, j) => { const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz); if (j !== i && d < CHAIR.gap && d > 1e-4) { x = o.x + dx / d * CHAIR.gap; z = o.z + dz / d * CHAIR.gap; } });
      }
      s.x = x; s.z = z; put(i);
    },
    turn(i, by) { list[i].rot += by; chairs.move(i, list[i].x, list[i].z); },
    // Стул, который поворачивали и оставили почти ровно, встаёт ровно.
    straighten(i) { const s = list[i], even = Math.round(s.rot / (Math.PI / 2)) * Math.PI / 2; if (Math.abs(s.rot - even) < CHAIR.snap) { s.rot = even; put(i); } },
    reset() { home.forEach((h, i) => { Object.assign(list[i], h); put(i); }); chairs.touched = false; },
    data: () => list.map(s => [+s.x.toFixed(3), +s.z.toFixed(3), +s.rot.toFixed(3)]),
  };
  // Оставленные по прежним правилам (спинкой в столе) — встают по нынешним.
  if (kept) list.forEach((s, i) => chairs.move(i, s.x, s.z));
}

// Люстры: свет — у трёх из них (у первой, средней и дальней); свечи и ореолы — у всех.
const chandelierLights = [];
let candle = null, chandelierHalo = null, sun = null, shafts = null, sky = null;
const HEMI = new THREE.Color(0x8a7458), wallClock = clockFrom(Q), sunCentre = new THREE.Vector3(0, 0, RAIL_Z - HALL.len / 2 + 2.5);
// Время зала — настоящее (или из ?time=) со сдвигом: его ставят, переводя стрелки часов на задней стене, и солнце идёт за ними.
// Сдвиг живёт до перезагрузки: по умолчанию в зале местное время. timeBack — стрелки бегут обратно к настоящему.
let timeShift = 0, timeBack = false, timeDirty = false, sunAt0 = 0;
const roomTime = () => new Date(wallClock().getTime() + timeShift);
// Внутренность зала: до неё идут лучи из окон и её охватывает тень солнца.
const HALLBOX = new THREE.Box3(new THREE.Vector3(-HALL.w / 2, -HALL.depth, RAIL_Z - HALL.len), new THREE.Vector3(HALL.w / 2, HALL.top + 7.6, RAIL_Z + GAL));
// Солнце сдвинулось — новое направление, цвет, тень и лучи. Раз в 20 секунд (при ускоренном времени — чаще).
// Сдвиг — по направлению, а не по высоте: в полдень высота почти не меняется, а солнце идёт. Ночью тень и лучи не пересчитываются.
const sunDir = new THREE.Vector3();
function updateSun(force = false) {
  if (!sun || !ceiling) return;
  const s = sunAt(roomTime()), was = sky?.sun ?? 0; if (!force && sunDir.lengthSq() && s.dir.dot(sunDir) > Math.cos(.1 * Math.PI / 180)) return;
  sunDir.copy(s.dir); sky = skyAt(s.elev);
  ceiling.setSky(sky, s.dir); setLight(lightLevel);
  shafts.visible = sky.rays > .005; sunThroughGlass();
  if (!force && sky.sun === 0 && was === 0) return;
  sun.position.copy(sunCentre).addScaledVector(s.dir, 60); sun.target.position.copy(sunCentre); sun.target.updateMatrixWorld();
  // Тень — ровно на зал: рамка камеры солнца по углам зала.
  const cam = sun.shadow.camera; cam.position.copy(sun.position); cam.lookAt(sunCentre); cam.updateMatrixWorld();
  const inv = cam.matrixWorld.clone().invert(), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate(), c = new THREE.Vector3();
  for (let i = 0; i < 8; i++) { c.set(i & 1 ? HALLBOX.max.x : HALLBOX.min.x, i & 2 ? HALLBOX.max.y : HALLBOX.min.y, i & 4 ? HALLBOX.max.z : HALLBOX.min.z).applyMatrix4(inv); lo.min(c); hi.max(c); }
  Object.assign(cam, { left: lo.x - .5, right: hi.x + .5, bottom: lo.y - .5, top: hi.y + .5, near: Math.max(.1, -hi.z - 1), far: -lo.z + 1 }); cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true; shadowDirty = true;
  shafts.geometry.dispose(); shafts.geometry = shaftGeometry(ceiling.windows, s.dir.clone().negate(), HALLBOX);
  shafts.material.uniforms.uStrength.value = sky.rays * .26;
}
// Солнце в зале — уже прошедшее сквозь стёкла: его красит и приглушает стекло тех окон, в которые оно светит (ceiling.sunPass).
// Пятна на стенах и лучи в воздухе — того же цвета: за бутылочным стеклом свет зеленоватый и слабее, за светлым витражом — почти как есть.
const glassPass = new THREE.Color(1, 1, 1);
function sunThroughGlass() {
  if (!sun || !sky || !ceiling) return;
  const k = ceiling.sunPass(sunDir, glassPass);
  sun.color.copy(sky.sunColor).multiply(glassPass); sun.intensity = sky.sun * k;
  shafts.material.uniforms.uColor.value.copy(sun.color); mirrorDirty = true;
}
// Кино (проектор уголка, cinema.js): пока он светит, нижний зал приглушён — `lit` (0…1) убавляет лампы, что уже есть (новых не добавляется): общий свет зала, отражённый свет, лампы уголка.
let cinema = null, cinemaPanel = null, nook = null, lightV = 0;
const nookLights = new Set();
const dimK = k => 1 - k * (cinema?.lit ?? 0);
const hallLights = [], DARK = new THREE.Color(0x0b0806), HAZE = new THREE.Color(0x2b2119), DAYLIGHT = new THREE.Color(0xfff2e0);
// Отсвет от пола и столов (свет снизу): ночью его почти нет, днём паркет возвращает свет на шкафы. LAMPLIGHT — чем лампы красят известь и росписи.
const GROUND = new THREE.Color(0x0c0907), BOUNCE = new THREE.Color(0x5a4430), LAMPLIGHT = new THREE.Color(1, .9, .8), dayColor = new THREE.Color(), glowColor = new THREE.Color();
// Густота краски на листах в зале (на холсте и в PDF она не меняется): 0 — как на холсте, 1 — жирно и черно.
const setInk = v => { INK.value.x = 2 * v; INK.value.y = .4 + 2 * v; };
// Свет в зале: 0 — горят только лампы на столах, как поздним вечером; 1 — светло, видно весь зал.
// Свет в зале — лампы (бегунок) и день за окнами (солнце) вместе: небо подсвечивает зал рассеянно, свод — сильнее всего.
// Свет нижнего зала: лампы на столах (каждый источник — по накалу ближайших к нему ламп: погасили их — под ним темнеет) и общий свет бегунка.
let hallV = 0;
function hallGlow(v = hallV) {
  hallV = v;
  const g = tableLamps?.glow(hallLights.map(l => l.position.z));
  hallLights.forEach((l, i) => { l.intensity = 6 * ((g ? g[i] : 1) + v * 3) * dimK(.7); });
  // Отражённый свет — от того же света: сколько горит ламп и сколько даёт бегунок; малая доля остаётся и в темноте.
  hallFill.intensity = FILL.k * (.3 + (g ? g.reduce((a, b) => a + b, 0) / g.length : 1) + v * 3) * dimK(.6);
}
function setLight(v) {
  mirrorDirty = true; lightV = v;
  const day = sky?.day ?? 0, over = Math.max(0, v - 1);   // over — сверх прежнего максимума: общий свет и выдержка растут быстрее, лампы — как на полном свете
  // Днём зал наполняет свет из поясов окон: рассеянный, сверху — светлый, от пола — тёмный (небесный свет зала), без лишних ламп.
  // Цвет дневного света — тёплый белый, а при солнце — с его цветом: низкое солнце золотит зал. (Прежде к нему подмешивалась синева неба — зал холодел.)
  dayColor.copy(DAYLIGHT).lerp(sky?.sunColor ?? DAYLIGHT, Math.min(1, (sky?.sun ?? 0) / 2.2) * .4);
  hemi.intensity = (.13 + v * 1.1 + over * 2.4 + day * 1.9) * dimK(.3); hemi.color.copy(HEMI).lerp(dayColor, day * .8); hemi.groundColor.copy(GROUND).lerp(BOUNCE, day * .4);
  hallGlow(v);
  // Известь, дерево карниза и росписи светятся цветом того света, что на них падает: от ламп — тёплым, днём — дневным.
  const lamps = .35 + v * 2.2, days = day * 2.4;
  ceiling?.setLight(v, day, glowColor.copy(LAMPLIGHT).lerp(dayColor, days / (lamps + days)));
  // Люстры не гаснут совсем: вечером горят вполнакала.
  for (const l of chandelierLights) l.intensity = 4 + v * 26;
  // Лампы у задней стены горят всегда, как настольные; при полном свете — чуть ярче.
  for (const { l, k } of wallLights) l.intensity = k * (.8 + v * .5) * (nookLights.has(l) ? dimK(.8) : 1);
  if (candle) candle.value = .5 + v * 1.3;
  if (chandelierHalo) chandelierHalo.opacity = .35 + v * .5;
  scene.environmentIntensity = .35 + v * .5 + over * .9 + day * .4;
  renderer.toneMappingExposure = 1.3 + v * .3 + over * 1.1;
  // Воздух в освещённом зале — тёплая дымка, а не чернота; днём — светлее и прозрачнее.
  const lit = Math.min(1, Math.max(v, day * .85));
  scene.fog.color.copy(DARK).lerp(HAZE, lit); scene.background.copy(scene.fog.color); scene.fog.far = 34 + lit * 30;
  document.documentElement.style.setProperty('--vignette', (.55 - lit * .3).toFixed(2));
}

const CASTS = ['rosette', 'keystone', 'capital', 'ovolo', 'drops', 'tulips', 'crest'];

// ——— Рабочее место ———
const DESK_MODE = Q.get('desk') === 'wall' ? 'wall' : 'hall';
// Картинки — каждая грузится один раз, сколько бы мест её ни просили; wait — сколько ждать, прежде чем обойтись без неё.
const images = new Map();
function imageOnce(src, wait = 0) {
  // Не загрузилась — забыть: в следующий раз попробовать снова.
  if (!images.has(src)) images.set(src, new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => { console.warn('не загрузилось:', src); images.delete(src); ok(null); }; im.src = src; }));
  return wait ? Promise.race([images.get(src), new Promise(ok => setTimeout(() => ok(null), wait))]) : images.get(src);
}
// Набор росписей с загруженными картинами или null.
const loadSet = (key, wait = 6000) => Promise.all(ART_SETS[key].files.map(n => imageOnce(`assets/art/${n}.jpg`, wait))).then(a => a.every(Boolean) ? { ...ART_SETS[key], images: a } : null);
// Стёкла — снимки настоящих витражей модерна (assets/glass), такими, как их сняли: в музее против света или изнутри; поправлены только
// перспектива, кадр и общий тон. Пока не загрузились или если не загрузятся — нарисованные. Боковые окна и веерное окно в торце — на выбор.
// gain — сколько света пропускает стекло снимка: снятые на световом столе светлее, их белое днём выгорало бы.
// Стекло окон — бутылочное: простое (leaded), собирается из куска снимка настоящего остекления (glass.js): crop — кусок в долях кадра, span — сколько метров
// он занимает в жизни, tint — общий тон поверх (бледная олива, в семью зелени кессонов свода #55634a, на тон светлее её), calm — насколько рисунок сведён
// к ровному тону: стекло «много внимания на себя забирало» (2026-11-13). Окна: боковые и веерное в торце; gain — сколько света пропускает стекло.
// Веерное окно смотрит на юг, солнце днём стоит прямо за ним: то же стекло здесь пропускает вдвое меньше света — иначе оно ярко-зелёное, а не тусклое.
const GLASS = { file: 'plain-butzen', leaded: { crop: [0, 0, 1, 1], span: .46, tint: '#a8a26a', calm: .5 }, sideGain: .26, fanGain: .13 };
// Снимок отдаётся, только когда загрузился; до того (и если не загрузился) — null, и в окне нарисованное стекло.
// Загрузился — окна перекрашиваются сами; не загрузился — забыть, в следующий раз попробовать снова.
let glassTex = null;
const leadedTex = {};
const glassOf = fan => {
  if (!glassTex) {
    const t = glassTex = loader.load(`assets/glass/${GLASS.file}.jpg`, () => { t.userData.ready = true; applyGlass(); }, undefined, () => { glassTex = null; });
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  if (!glassTex.userData.ready || !ceiling) return null;
  // Окно собирается из куска снимка (glass.js): своё для боковых окон и для веерного. Прутья веерного — золочёные, настоящие (ceiling.js), в стекле их нет.
  const id = fan ? 'fan' : 'side';
  return leadedTex[id] ??= fan ? leadedFan(glassTex.image, { ...ceiling.glassDims.fan, ...GLASS.leaded }) : leadedSide(glassTex.image, { ...ceiling.glassDims.side, ...GLASS.leaded });
};
const station = new THREE.Group(); scene.add(station);
if (DESK_MODE === 'wall') { station.position.set(-HALL.w / 2 + 1.45, 0, RAIL_Z + 2.15); station.rotation.y = Math.PI / 2; }
let deskTop = .78, DESK = { hw: .95, hd: .39 }, drawers = [], lamp = null, tw = null, deskBody = null, shadowDirty = true;
const sheetNormal = tex('assets/textures/paper-normal.jpg', false, [1.2, 2.9]);
const leather = new THREE.MeshStandardMaterial({ map: tex('assets/textures/leather-color.jpg', true, [1.2, 1.6]), normalMap: tex('assets/textures/leather-normal.jpg', false, [1.2, 1.6]), color: 0x6e4c38, roughness: .62, envMapIntensity: .6 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb8924e, metalness: 1, roughness: .32 });
// Папка для листов: крышка с тиснёным грифоном и изнанка — со снимков папки Георга Хульбе 1902 года (binder.js).
const photo = (u, srgb, wrap = THREE.ClampToEdgeWrapping, rep = [1, 1]) => { const t = tex(u, srgb, rep); t.wrapS = t.wrapT = wrap; return t; };
// Снимки сняты при ровном музейном свете и под лампой выгорали бы — у каждого свой приглушающий тон.
const folderMats = {
  // Задняя крышка и корешок — скан кожи в тон снимку.
  leather,
  cover: new THREE.MeshStandardMaterial({ map: photo('assets/textures/portfolio-cover.jpg', true), normalMap: photo('assets/textures/portfolio-cover-normal.jpg', false), color: 0x80726a, roughness: .56, envMapIntensity: .5 }),
  inside: new THREE.MeshStandardMaterial({ map: photo('assets/textures/portfolio-inside.jpg', true), color: 0xa89c94, roughness: .8 }),
  // Гладкая кожа под листами — чистый кусок той же изнанки зеркальными повторами, без швов.
  lining: new THREE.MeshStandardMaterial({ map: photo('assets/textures/portfolio-lining.jpg', true, THREE.MirroredRepeatWrapping, [1, 2.6]), color: 0xa89c94, roughness: .8 }),
  normal: sheetNormal,
};

// Книга: переплёт — снимки настоящих книг (src/bindings.js, оригиналы и авторы в CREDITS.md). Бумага страниц — тот же снимок, что у листов, и общее сжатие яркости под лампой
// (INK, см. inkPaper): страницы не выгорают добела. У книги на столе номер переплёта `bind` (0, 1, 2): k-й берёт `bindingOf(k)`, первому `?binding=<id>` ставит любой (id — из BINDINGS).
// Материалы собираются лениво и кэшируются по id; общие (бумага, подкладка) — одни на всех.
const BOOK_MAX = 3;   // сколько книг может быть в зале разом (решение пользователя 2026-11-21)
const BIND_START = BINDINGS[Q.get('binding')] ? Q.get('binding') : bindingOf(0);
const bindId = k => (k | 0) === 0 ? BIND_START : bindingOf(k | 0);
const bookShared = {
  paper: tex('assets/textures/paper-bunin.jpg?v=2', true), paperNormal: sheetNormal, squash: INK, pageTone: null,
  // Подкладка под приподнятой крышкой раскрытой книги — то же сукно, что на столах (снимок общий, texShared), чуть темнее; развёртка подкладки — в метрах, повтор как у стола.
  rest: new THREE.MeshStandardMaterial({ map: texShared('assets/textures/baize-color.jpg', true, [1 / BAIZE.mottle, 1 / BAIZE.mottle]), normalMap: texShared('assets/textures/baize-normal.jpg', false, [1 / BAIZE.nap, 1 / BAIZE.nap]), normalScale: new THREE.Vector2(BAIZE.relief, BAIZE.relief), color: new THREE.Color(BAIZE.color).multiplyScalar(.8), roughness: .95 }),
};
const matsOf = id => bindingMats(id, { loader, anisotropy: renderer.capabilities.getMaxAnisotropy(), grain: rep => texShared('assets/textures/leather-normal.jpg', false, rep), shared: bookShared });
// Материалы переплёта книги номер k — единственное место, которое знает о материалах книг. После новой книги нужен `lightMasks()` (новые материалы — новые лампы в шейдере).
const bookMatsFor = k => matsOf(bindId(k));
// Снимки переплёта — дождаться и отправить на видеокарту: на каждый уходит до 0,25 с (разбор и уровни уменьшения), поэтому все переплёты греются под заставкой, а не при первом показе.
async function warmBinding(id) { const m = matsOf(id); await Promise.race([m.ready, new Promise(ok => setTimeout(ok, 8000))]); for (const t of m.textures) renderer.initTexture(t); }
// Пока страниц нет, они — чистая бумага; звуки книги — записи (booksound.js).

// Переставляемый предмет на столе: машинка, лампа. Поднимается, едет за рукой, ставится пружиной.
class Mover {
  constructor(obj, { x, z, rot }, r) { this.obj = obj; this.r = r; this.x = new Spring(x, 70, 14); this.z = new Spring(z, 70, 14); this.rot = new Spring(rot, 60, 13); this.lift = new Spring(0, 90, 12); this.up = new Spring(0, 120, 18); this.on = null; this.cy = null; this.update(0); }
  // Опора — то, на чём предмет лежит: on(x, z) говорит, на сколько выше стола его поднимает то, что под ним. Пружина сглаживает ступеньки.
  rest(on) { this.on = on; this.up.set(on(this.x.v, this.z.v)); }
  update(dt) {
    if (this.on) this.up.t = this.on(this.x.v, this.z.v);
    const moving = !(this.x.resting && this.z.resting && this.rot.resting && this.lift.resting && this.up.resting) || this.cy !== null;
    // cy — высота низа над столом, пока вещь несут над всем (`carryStep`): её ведёт своя пружина руки, а не опора с подъёмом.
    const up = this.up.step(dt), lf = Math.max(0, this.lift.step(dt));
    this.obj.position.set(this.x.step(dt), deskTop + (this.cy ?? up + lf), this.z.step(dt)); this.obj.rotation.y = this.rot.step(dt);
    return moving;
  }
  get data() { return { x: this.x.t, z: this.z.t, rot: this.rot.t }; }
}
let twM = null, lampM = null, weightM = null, weight = null;
// Книги (до BOOK_MAX): `books` — все, `bookM` — «своя»: та, которой касались последней (с ней работают строка книги, режим чтения, клавиши).
const books = []; let bookM = null;

// ——— Что во что не входит: пресс-папье, машинка, лампа и листы ———
// Основание машинки — прямоугольник, подставка лампы — круг; центр и размеры — в осях самой вещи (измерено по моделям: у машинки — всё до высоты
// пресс-папье, 12 см, у лампы — подставка со стойкой). Плита пресс-папье — SLAB; запас GAP со всех сторон — чтобы не касались.
// TW_TOP — высота машинки над столом (с валиком и бумагодержателем, замер по рамке): вынутый из каретки лист идёт над ней.
const TW_TOP = .32, TW_BASE = { x: -.0015, z: .0065, hw: .1875, hd: .1785 }, LAMP_BASE = { x: 0, z: -.0345, R: .102 }, GAP = .002;
const wrapPi = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
// Центр вещи в осях стола: pose — { x, z, r } самой вещи, c — центр рамки в её осях. Поворот — тот же, что у obj.rotation.y.
const toTable = (p, c) => { const s = Math.sin(p.r), k = Math.cos(p.r); return { x: p.x + c.x * k + c.z * s, z: p.z - c.x * s + c.z * k, r: p.r }; };
// Прямоугольник a (x, z, r, hw, hd) входит в прямоугольник b: на сколько и куда сдвинуть a, чтобы вышел (по самой короткой из четырёх осей); null — не пересекаются.
function rectShift(a, b) {
  const ax = [Math.cos(a.r), -Math.sin(a.r)], az = [Math.sin(a.r), Math.cos(a.r)], bx = [Math.cos(b.r), -Math.sin(b.r)], bz = [Math.sin(b.r), Math.cos(b.r)];
  const dot = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1]), dx = a.x - b.x, dz = a.z - b.z;
  let best = Infinity, out = null;
  for (const n of [ax, az, bx, bz]) {
    const pen = a.hw * dot(n, ax) + a.hd * dot(n, az) + b.hw * dot(n, bx) + b.hd * dot(n, bz) - Math.abs(dx * n[0] + dz * n[1]);
    if (pen <= 0) return null;
    if (pen < best) { best = pen; const sg = dx * n[0] + dz * n[1] >= 0 ? 1 : -1; out = [n[0] * pen * sg, n[1] * pen * sg]; }
  }
  return out;
}
// То же для круга c (x, z, R): на сколько сдвинуть прямоугольник a, чтобы он вышел из круга.
function circleShift(a, c) {
  const ex = c.x - a.x, ez = c.z - a.z, co = Math.cos(a.r), si = Math.sin(a.r), lx = ex * co - ez * si, lz = ex * si + ez * co;
  const ox = lx - clamp(lx, -a.hw, a.hw), oz = lz - clamp(lz, -a.hd, a.hd), d = Math.hypot(ox, oz);
  if (d >= c.R) return null;
  let sx, sz;
  if (d > 1e-6) { const k = (c.R - d) / d; sx = -ox * k; sz = -oz * k; }
  else { const px = a.hw + c.R - Math.abs(lx), pz = a.hd + c.R - Math.abs(lz); if (px < pz) { sx = -Math.sign(lx || 1) * px; sz = 0; } else { sx = 0; sz = -Math.sign(lz || 1) * pz; } }
  return [sx * co + sz * si, -sx * si + sz * co];
}
// Пересекаются ли прямоугольник a и вещь o (прямоугольник или круг), если вещь раздута на m.
const hitsSolid = (a, o, m = 0) => o.R !== undefined ? !!circleShift(a, { ...o, R: o.R + m }) : !!rectShift(a, { ...o, hw: o.hw + m, hd: o.hd + m });
// Фигура a (рамка или круг) входит в фигуру b (рамка или круг): на сколько и куда сдвинуть a, чтобы вышла; null — не пересекаются. Круг и рамка — оба порядка (`circleShift` — рамка из круга).
function circleOutOfRect(c, b) {
  const ex = c.x - b.x, ez = c.z - b.z, co = Math.cos(b.r), si = Math.sin(b.r), lx = ex * co - ez * si, lz = ex * si + ez * co;
  const ox = lx - clamp(lx, -b.hw, b.hw), oz = lz - clamp(lz, -b.hd, b.hd), d = Math.hypot(ox, oz);
  if (d >= c.R) return null;
  let sx, sz;
  if (d > 1e-6) { const k = (c.R - d) / d; sx = ox * k; sz = oz * k; }
  else { const px = b.hw + c.R - Math.abs(lx), pz = b.hd + c.R - Math.abs(lz); if (px < pz) { sx = Math.sign(lx || 1) * px; sz = 0; } else { sx = 0; sz = Math.sign(lz || 1) * pz; } }
  return [sx * co + sz * si, -sx * si + sz * co];
}
function shiftOut(a, b) {
  if (a.R === undefined) return b.R !== undefined ? circleShift(a, b) : rectShift(a, b);
  if (b.R === undefined) return circleOutOfRect(a, b);
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), pen = a.R + b.R - d;
  if (pen <= 0) return null;
  return d > 1e-6 ? [dx / d * pen, dz / d * pen] : [pen, 0];
}
// Машинка и лампа как рамки в осях стола: pose — где они стоят (или встанут).
// Книга — тоже твёрдая вещь: её рамка зависит от положения (закрытая, раскрытая), поэтому берётся при каждом обращении (`bookRect`).
const bodies = () => [twM && { m: twM, c: TW_BASE }, lampM && { m: lampM, c: LAMP_BASE }, ...books.filter(b => b.drawer === null && b.holder.visible).map(b => ({ m: b, get c() { return bookRect(b); } }))].filter(Boolean);
const bodyShape = (b, p) => { const t = toTable(p, b.c); return b.c.R !== undefined ? { x: t.x, z: t.z, R: b.c.R } : { ...t, hw: b.c.hw, hd: b.c.hd }; };
const slabBox = (x, z, r, m = GAP) => ({ x, z, r, hw: SLAB.w / 2 + m, hd: SLAB.d / 2 + m });
// Куда встанет пресс-папье, если его поставить в (x, z, r): выталкивается из машинки и из круга лампы, остаётся на столе. over — вещь (машинка или
// лампа), которую как раз двигают, и её новое место. ok: false — не вышло (некуда, край стола).
function weightPose(x, z, r, over = null) {
  const at = b => over?.m === b.m ? over : { x: b.m.x.t, z: b.m.z.t, r: b.m.rot.t };
  const away = () => { for (const b of bodies()) { const sh = bodyShape(b, at(b)), a = slabBox(x, z, r); const s = sh.R !== undefined ? circleShift(a, sh) : rectShift(a, sh); if (s) return s; } return null; };
  const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r)), ex = SLAB.w / 2 * c + SLAB.d / 2 * sn, ez = SLAB.w / 2 * sn + SLAB.d / 2 * c;
  for (let i = 0; i < 6; i++) {
    const s = away(); if (!s) break;
    x += s[0] * 1.001 + Math.sign(s[0]) * 1e-4; z += s[1] * 1.001 + Math.sign(s[1]) * 1e-4;
    [x, z] = keepOnDesk(x, z, ex, ez);
  }
  [x, z] = keepOnDesk(x, z, ex, ez);
  return { x, z, r, ok: !away() };
}
// Пресс-папье ведут к (x, z, r): короткими шагами, чтобы не перескочить через машинку; упираясь, оно скользит вдоль неё.
function steerWeight(x, z, r) {
  const m = weightM; r = m.rot.t + wrapPi(r - m.rot.t);
  for (let i = 0; i < 80; i++) {
    const dx = x - m.x.t, dz = z - m.z.t, dr = r - m.rot.t, d = Math.hypot(dx, dz);
    if (d < 1e-5 && Math.abs(dr) < 1e-5) break;
    const k = Math.min(1, .012 / (d || 1e-9), .12 / (Math.abs(dr) || 1e-9)), p = weightPose(m.x.t + dx * k, m.z.t + dz * k, m.rot.t + dr * k);
    const moved = Math.hypot(p.x - m.x.t, p.z - m.z.t) + Math.abs(dr * k);
    m.x.t = p.x; m.z.t = p.z; m.rot.t += dr * k;
    if (k >= 1 || moved < 1e-5) break;
  }
}
// Машинка толкает всё, что стоит на столе, в любом количестве (пользователь 2026-11-21: «машинка должна просто все что угодно сдвигать»): папки, книги, пресс-папье и лампу,
// и они толкают друг друга цепочкой (лампа — книгу, книга — папку…). Расчёт — по проходам: вещь, задетая машинкой или уже сдвинутой вещью, выталкивается из неё по самой короткой оси
// (сама с запасом GAP), сдвинутая — толкает следующих; так до тех пор, пока ничто ни во что не входит. Пресс-папье на папке едет с ней. Если кому-то некуда (край стола, зажало), всё
// не сходится и ответ null: машинка дальше не идёт. Листы, что лежат на столе, не трогаются. Ответ — как у `pushAll` ({ moves, w, bk }) и ещё lamp: { x, z } или null.
function shoveAll(over) {
  const T = bodyShape({ c: TW_BASE }, over), items = [];
  const put = (kind, ref, p, shape, keep) => { const o = { kind, ref, p, p0: { ...p }, shape, keep, moved: false }; items.push(o); return o; };
  const base = weightM && baseOf(weightM.x.t, weightM.z.t);
  for (const f of folders) if (f.drawer === null && f.b.group.visible && !f.held) put('f', f, { x: f.px.t, z: f.pz.t, r: f.pr.t }, (p, m) => folderRect(p.x, p.z, p.r, f.pose, m), p => keepFolder(f.pose, p.x, p.z, p.r));
  const wi = weightM && put('w', weightM, { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t }, (p, m) => slabBox(p.x, p.z, p.r, m), p => { const [ex, ez] = slabExt(p.r); return keepOnDesk(p.x, p.z, ex, ez); });
  if (lampM && lampM !== over.m) {
    // Для машинки лампа — ещё и абажур: он выше низа верха машинки (рамка, `lampShade`), и в машинку входить не должен.
    const o = put('l', lampM, { x: lampM.x.t, z: lampM.z.t, r: lampM.rot.t }, (p, m) => { const c = bodyShape({ c: LAMP_BASE }, p); return { ...c, R: c.R + m }; },
      p => { const c = bodyShape({ c: LAMP_BASE }, p), [kx, kz] = keepOnDesk(c.x, c.z, c.R, c.R); return [p.x + kx - c.x, p.z + kz - c.z]; });
    o.alt = (p, m) => { const sh = lampShade(p); return { ...sh, hw: sh.hw + m, hd: sh.hd + m }; };
  }
  for (const b of books) if (b.drawer === null && !b.held && b.holder.visible && b !== over.m) put('b', b, { x: b.x.t, z: b.z.t, r: b.rot.t }, (p, m) => { const c = bookRect(b), t = toTable(p, c); return { x: t.x, z: t.z, r: p.r, hw: c.hw + m, hd: c.hd + m }; }, p => keepBook(b, b.book.pose, p.x, p.z, p.r));
  const rd = wi && base && items.find(o => o.ref === base) && rideRel(base, wi.p);   // пресс-папье на папке едет с ней
  const bf = rd && items.find(o => o.ref === base);
  // Пресс-папье и папки друг другу не преграда (пресс-папье можно ставить на папку, хоть краем): не толкаются; толкнули пресс-папье, что стоит на папке, — двигается папка, а оно едет на ней.
  const skip = (A, B) => (A === wi && B.kind === 'f') || (B === wi && A.kind === 'f');
  const shove = (B, sh) => {
    const T0 = B === wi && bf ? bf : B;
    [T0.p.x, T0.p.z] = T0.keep({ ...T0.p, x: T0.p.x + sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4, z: T0.p.z + sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4 }); T0.moved = true;
    if (T0 === bf) { Object.assign(wi.p, ridePose(rd, bf.p.x, bf.p.z, bf.p.r)); wi.moved = true; }
  };
  let rest = true;
  for (let pass = 0; pass < 40 && rest; pass++) {
    rest = false;
    for (const B of items) {
      const pushers = [{ shape: T }, ...items.filter(o => o !== B && o.moved && !skip(o, B)).map(o => ({ shape: o.shape(o.p, 0) }))];
      for (const A of pushers) { const sh = shiftOut(B.shape(B.p, GAP), A.shape) || (A.shape === T && B.alt && shiftOut(B.alt(B.p, GAP), T)); if (sh) { shove(B, sh); rest = true; } }
    }
  }
  // Сошлось ли: ничто не входит ни в машинку, ни в сдвинутые вещи.
  for (const B of items) for (const A of [{ shape: T }, ...items.filter(o => o !== B && o.moved && !skip(o, B)).map(o => ({ shape: o.shape(o.p, 0) }))]) if (shiftOut(B.shape(B.p, GAP * .5), A.shape) || (A.shape === T && B.alt && shiftOut(B.alt(B.p, GAP * .5), T))) return null;
  const out = { moves: [], bk: [], w: wi ? { ...wi.p } : null, lamp: null };
  for (const o of items) {
    if (o.kind === 'f' && (o.p.x !== o.p0.x || o.p.z !== o.p0.z)) out.moves.push([o.ref, o.p.x, o.p.z]);
    else if (o.kind === 'b' && (o.p.x !== o.p0.x || o.p.z !== o.p0.z)) out.bk.push([o.ref, o.p.x, o.p.z]);
    else if (o.kind === 'l') out.lamp = o.moved ? { x: o.p.x, z: o.p.z } : null;
  }
  return out;
}
// Машинку ведут к (x, z): каждый шаг проверяется — всё перед ней отъезжает (`shoveAll`); если кому-то некуда, она дальше не идёт (но скользит вдоль).
function steerBody(m, x, z) {
  const tryAt = (nx, nz) => { const s = shoveAll({ m, x: nx, z: nz, r: m.rot.t }); if (!s) return false; m.x.t = nx; m.z.t = nz; commit(s); return true; };
  for (let i = 0; i < 80; i++) {
    const dx = x - m.x.t, dz = z - m.z.t, d = Math.hypot(dx, dz); if (d < 1e-5) break;
    const k = Math.min(1, .012 / d), nx = m.x.t + dx * k, nz = m.z.t + dz * k;
    if (!tryAt(nx, nz) && !tryAt(nx, m.z.t) && !tryAt(m.x.t, nz)) break;
    if (k >= 1) break;
  }
}
// Повернули машинку колесом: если задетому ею некуда, поворот отменяется.
function turnBody(m, by) {
  const to = m.rot.t + by, s = shoveAll({ m, x: m.x.t, z: m.z.t, r: to });
  if (s) { m.rot.t = to; commit(s); }
}
// Машинку или лампу сдвинули не рукой (отодвинули назад, вернули, открыли зал): пресс-папье и папки, если они задеты, выталкиваются. snap — сразу, без пружины.
let weightSeen = '';
const shoveKey = () => [twM?.x.t, twM?.z.t, twM?.rot.t, lampM?.x.t, lampM?.z.t, lampM?.rot.t, weightM?.x.t, weightM?.z.t, weightM?.rot.t, ...books.flatMap(b => [b.x.t, b.z.t, b.rot.t, b.book.pose, b.drawer, b.stand]), ...folders.flatMap(f => [f.px.t, f.pz.t, f.pr.t, f.held, f.drawer])].join();
let bookWarm = false;   // книга на миг раскрыта для сборки шейдеров (init): положения она не меняет, вещи вокруг не трогаются
function shoveWeight(snap = false) {
  if (!weightM || bookWarm) return;
  if (shoveKey() === weightSeen && !snap) return;
  const s = pushAll(null, true); if (s) commit(s, snap);
  weightSeen = shoveKey();
}

// ——— Папки — твёрдые вещи: упираются в машинку и лампу, толкают пресс-папье, возят его на себе ———
// Рамка папки — по её положению: раскрытая вдвое шире. Закрытая может чуть свисать со стола спереди, раскрытая — нет.
const footOf = pose => [pose === 'open' ? 2 * BINDER.w : BINDER.w, BINDER.d];
const folderRect = (x, z, r, pose, m = GAP) => { const [w, d] = footOf(pose); return { x, z, r, hw: w / 2 + m, hd: d / 2 + m }; };
const keepFolder = (pose, x, z, r) => { const [w, d] = footOf(pose), c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r)); return keepOnDesk(x, z, (w * c + d * s) / 2, (w * s + d * c) / 2, pose === 'open' ? 0 : .02); };
const slabExt = r => [SLAB.w / 2 * Math.abs(Math.cos(r)) + SLAB.d / 2 * Math.abs(Math.sin(r)), SLAB.w / 2 * Math.abs(Math.sin(r)) + SLAB.d / 2 * Math.abs(Math.cos(r))];
const setWeight = w => { weightM.x.t = w.x; weightM.z.t = w.z; weightM.rot.t = w.r; };
// Пресс-папье стоит на папке, если середина плиты над её рамкой (по тому, куда папки поставлены); из нескольких — на самой высокой. base — какая это папка (или null).
function baseOf(x, z) {
  let best = null, top = -1;
  for (const f of folders) {
    if (f.drawer !== null || !f.b.group.visible) continue;
    const dx = x - f.px.t, dz = z - f.pz.t, c = Math.cos(f.pr.t), s = Math.sin(f.pr.t), [w, d] = f.foot;
    if (Math.abs(dx * c - dz * s) < w / 2 && Math.abs(dx * s + dz * c) < d / 2 && (f.rest ?? f.floor) + f.thick > top) { top = (f.rest ?? f.floor) + f.thick; best = f; }
  }
  return best;
}
// Где пресс-папье на папке (в её осях: lx, lz, и на сколько повёрнуто) — чтобы везти его с ней; ridePose ставит его по новому месту папки.
const rideRel = (f, w) => { const dx = w.x - f.px.t, dz = w.z - f.pz.t, c = Math.cos(f.pr.t), s = Math.sin(f.pr.t); return { lx: dx * c - dz * s, lz: dx * s + dz * c, dr: w.r - f.pr.t }; };
const ridePose = (rel, x, z, r) => { const c = Math.cos(r), s = Math.sin(r); return { x: x + rel.lx * c + rel.lz * s, z: z - rel.lx * s + rel.lz * c, r: r + rel.dr }; };
// Куда встанет папка в положении pose, если поставить её серединой в (x, z) под углом r: выталкивается из машинки и круга лампы (вместе с пресс-папье на ней — rel)
// и остаётся на столе. over — машинка или лампа, которую как раз двигают, и её новое место. ok: false — места нет.
// deep — застряла глубоко (открыли зал, а папка в машинке): если выталкивание не вышло, ищется ближайшее свободное место кольцами.
function folderSpot(f, x, z, r, pose, rel, over, deep = false, skip = null) {
  const at = b => over?.m === b.m ? over : { x: b.m.x.t, z: b.m.z.t, r: b.m.rot.t }, solids = bodies().filter(b => !skip?.includes(b.m)).map(b => bodyShape(b, at(b)));
  const hit = a => { for (const o of solids) { const s = o.R !== undefined ? circleShift(a, o) : rectShift(a, o); if (s) return s; } return null; };
  const away = () => hit(folderRect(x, z, r, pose)) || (rel && (w => hit(slabBox(w.x, w.z, w.r)))(ridePose(rel, x, z, r)));
  const keep = () => {
    [x, z] = keepFolder(pose, x, z, r);
    if (rel) { const w = ridePose(rel, x, z, r), [ex, ez] = slabExt(w.r), [kx, kz] = keepOnDesk(w.x, w.z, ex, ez); x += kx - w.x; z += kz - w.z; }
  };
  for (let i = 0; i < 6; i++) {
    const s = away(); if (!s) break;
    x += s[0] * 1.001 + Math.sign(s[0]) * 1e-4; z += s[1] * 1.001 + Math.sign(s[1]) * 1e-4; keep();
  }
  keep();
  if (deep && away()) {
    const x0 = x, z0 = z;
    for (let d = .02; d < .9; d += .02) for (let k = 0; k < 24; k++) { x = x0 + Math.cos(k / 24 * Math.PI * 2) * d; z = z0 + Math.sin(k / 24 * Math.PI * 2) * d; keep(); if (!away()) return { x, z, ok: true }; }
    x = x0; z = z0;
  }
  return { x, z, ok: !away() };
}
// Папку f ставят серединой в (x, z) под углом r (в положении pose): { x, z, w } — где она встанет и где окажется пресс-папье (w; null — на месте), или null — места нет.
// rel: undefined — пресс-папье едет с папкой, если стоит на ней; null — не едет; объект — едет, как сказано. Стоящее на любой папке толкать нечем — оно лишь едет или стоит;
// стоящее на столе отодвигается, если папка сдвинулась и задела его (отодвинуть некуда — папка не идёт). over — как у folderSpot.
function folderFit(f, x, z, r, pose = f.pose, rel, over = null, w0 = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t }, deep = false, skip = null) {
  const base = w0 && baseOf(w0.x, w0.z);
  if (rel === undefined) rel = base === f ? rideRel(f, w0) : null;
  const s = folderSpot(f, x, z, r, pose, rel, over, deep, skip); if (!s.ok) return null;
  const out = { x: s.x, z: s.z, w: null };
  if (rel) out.w = ridePose(rel, s.x, s.z, r);
  else if (w0 && !base && (s.x !== f.px.t || s.z !== f.pz.t || r !== f.pr.t || pose !== f.pose)) {
    const box = folderRect(s.x, s.z, r, pose), sh = rectShift(slabBox(w0.x, w0.z, w0.r), box);
    if (sh) {
      const p = weightPose(w0.x + sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4, w0.z + sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4, w0.r, over);
      if (!p.ok || rectShift(slabBox(p.x, p.z, p.r), box)) return null;
      out.w = { x: p.x, z: p.z, r: p.r };
    }
  }
  return out;
}
// Папку ведут к (x, z) под углом r: короткими шагами, как пресс-папье; упираясь в машинку или лампу, скользит вдоль них, пресс-папье рядом толкает, а то, что на ней, везёт (rel).
function steerFolder(f, x, z, r, rel) {
  r = f.pr.t + wrapPi(r - f.pr.t);
  const put = (nx, nz, nr) => { const s = folderFit(f, nx, nz, nr, f.pose, rel); if (!s) return false; f.px.t = s.x; f.pz.t = s.z; f.pr.t = nr; if (s.w) setWeight(s.w); return true; };
  for (let i = 0; i < 80; i++) {
    const dx = x - f.px.t, dz = z - f.pz.t, dr = r - f.pr.t, d = Math.hypot(dx, dz);
    if (d < 1e-5 && Math.abs(dr) < 1e-5) break;
    const k = Math.min(1, .012 / (d || 1e-9), .12 / (Math.abs(dr) || 1e-9)), ox = f.px.t, oz = f.pz.t, or = f.pr.t, nx = ox + dx * k, nz = oz + dz * k, nr = or + dr * k;
    if (!put(nx, nz, nr) && !put(nx, oz, nr) && !put(ox, nz, nr) && !put(ox, oz, nr)) break;
    if (k >= 1 || Math.hypot(f.px.t - ox, f.pz.t - oz) + Math.abs(f.pr.t - or) < 1e-5) break;
  }
}
// ——— Книга — твёрдая вещь: упирается в машинку, лампу, пресс-папье и папки, а машинка и лампа её толкают ———
// Рамка книги в осях самой вещи (начало — середина той части, что вышла вперёд, как у папки: `Folder.px`); берётся по положению (`Book.footprint`).
// На подставке раскрытая книга занимает ещё и её основание (33 × 30 см): рамка не уже подставки (`STAND_FOOT`).
const STAND_FOOT = { hw: .166, hd: .152 };
function bookRect(bt, pose = bt.book.pose) {
  const f = bt.book.footprint(pose), st = bt.stand > 0 && pose === 'open', hw = Math.max((f.x1 - f.x0) / 2, st ? STAND_FOOT.hw : 0);
  return { x: st ? 0 : (f.x0 + f.x1) / 2, z: 0, hw, hd: Math.max(f.hd, st ? STAND_FOOT.hd : 0) };
}
// Середину книги (x, z) — туда, где её рамка целиком на столе.
function keepBook(bt, pose, x, z, r) {
  const c = bookRect(bt, pose), t = toTable({ x, z, r }, c), ca = Math.abs(Math.cos(r)), sa = Math.abs(Math.sin(r)), [kx, kz] = keepOnDesk(t.x, t.z, c.hw * ca + c.hd * sa, c.hw * sa + c.hd * ca);
  return [x + kx - t.x, z + kz - t.z];
}
// Куда встанет книга в положении pose, если поставить её в (x, z) под углом r: выталкивается из машинки, лампы, пресс-папье (w — где оно, по умолчанию там, где стоит)
// и папок (fl — новые места тех, что сдвинули) и остаётся на столе. over — машинка или лампа, которую двигают, и её новое место. deep — застряла (раскрываться некуда):
// ищется ближайшее свободное место кольцами до 55 см. ok: false — места нет.
function bookSpot(bt, x, z, r, pose, over = null, w = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t }, fl = null, deep = false, skip = null) {
  const at = b => over?.m === b.m ? over : { x: b.m.x.t, z: b.m.z.t, r: b.m.rot.t }, solids = bodies().filter(b => b.m !== bt && !skip?.includes(b.m)).map(b => bodyShape(b, at(b)));
  if (w) solids.push(slabBox(w.x, w.z, w.r, 0));
  for (const f of folders) if (f.drawer === null && f.b.group.visible && !f.held) { const p = fl?.get(f) ?? { x: f.px.t, z: f.pz.t }; solids.push({ x: p.x, z: p.z, r: f.pr.t, hw: f.foot[0] / 2, hd: f.foot[1] / 2 }); }
  const away = () => {
    const c = bookRect(bt, pose), t = toTable({ x, z, r }, c), a = { x: t.x, z: t.z, r, hw: c.hw + GAP, hd: c.hd + GAP };
    for (const o of solids) { const s = o.R !== undefined ? circleShift(a, o) : rectShift(a, o); if (s) return s; }
    return null;
  };
  const keep = () => { [x, z] = keepBook(bt, pose, x, z, r); };
  for (let i = 0; i < 6; i++) { const s = away(); if (!s) break; x += s[0] * 1.001 + Math.sign(s[0]) * 1e-4; z += s[1] * 1.001 + Math.sign(s[1]) * 1e-4; keep(); }
  keep();
  if (deep && away()) {
    const x0 = x, z0 = z;
    for (let d = .02; d <= .55; d += .02) for (let k = 0; k < 24; k++) { x = x0 + Math.cos(k / 24 * Math.PI * 2) * d; z = z0 + Math.sin(k / 24 * Math.PI * 2) * d; keep(); if (!away()) return { x, z, r, ok: true }; }
    x = x0; z = z0;
  }
  return { x, z, r, ok: !away() };
}
// Книгу ведут к (x, z) под углом r: короткими шагами, как пресс-папье; упираясь, скользит вдоль того, во что упёрлась.
function steerBook(m, x, z, r) {
  const pose = m.book.pose; r = m.rot.t + wrapPi(r - m.rot.t);
  for (let i = 0; i < 80; i++) {
    const dx = x - m.x.t, dz = z - m.z.t, dr = r - m.rot.t, d = Math.hypot(dx, dz);
    if (d < 1e-5 && Math.abs(dr) < 1e-5) break;
    const k = Math.min(1, .012 / (d || 1e-9), .12 / (Math.abs(dr) || 1e-9)), p = bookSpot(m, m.x.t + dx * k, m.z.t + dz * k, m.rot.t + dr * k, pose);
    if (!p.ok) break;
    const moved = Math.hypot(p.x - m.x.t, p.z - m.z.t) + Math.abs(dr * k);
    m.x.t = p.x; m.z.t = p.z; m.rot.t += dr * k;
    if (k >= 1 || moved < 1e-5) break;
  }
}
// Что получится, если машинку или лампу поставить в over (null — как стоят): папки на столе отъезжают перед ней, пресс-папье — тоже, а на папке — едет с ней.
// null — кому-то некуда (soft: тому, кому некуда, ничего не делают, остальные выталкиваются). Иначе { moves: [[папка, x, z]], w }.
function pushAll(over, soft = false) {
  let w = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t };
  const moves = [], base = w && baseOf(w.x, w.z); let carried = false;
  for (const f of folders) {
    if (f.drawer !== null || !f.b.group.visible || f.held) continue;
    const s = folderFit(f, f.px.t, f.pz.t, f.pr.t, f.pose, base === f ? rideRel(f, w) : null, over, carried ? null : w, soft);
    if (!s) { if (soft) continue; return null; }
    if (s.x !== f.px.t || s.z !== f.pz.t) moves.push([f, s.x, s.z]);
    if (s.w) { w = s.w; if (base === f) carried = true; }
  }
  if (w) { const p = weightPose(w.x, w.z, w.r, over); if (!p.ok && !soft) return null; w = p; }
  // Книгу машинка и лампа толкают так же; некуда (её место занято пресс-папье или папкой, которые уже на новых местах) — дальше не идут.
  const bk = [];
  for (const b of books) {
    if (over?.m === b || b.drawer !== null || b.held) continue;
    const fl = new Map(moves.map(([f, x, z]) => [f, { x, z }])), p = bookSpot(b, b.x.t, b.z.t, b.rot.t, b.book.pose, over, w, fl);
    if (!p.ok) { if (!soft) return null; } else if (p.x !== b.x.t || p.z !== b.z.t) bk.push([b, p.x, p.z]);
  }
  return { moves, w, bk };
}
function commit(s, snap = false) {
  for (const [b, x, z] of s.bk) { b.x.t = x; b.z.t = z; if (snap) { b.x.set(x); b.z.set(z); } }
  for (const [f, x, z] of s.moves) { f.px.t = x; f.pz.t = z; if (snap) { f.px.set(x); f.pz.set(z); } }
  if (s.w) { setWeight(s.w); if (snap) { weightM.x.set(s.w.x); weightM.z.set(s.w.z); } }
  if (s.lamp) { lampM.x.t = s.lamp.x; lampM.z.t = s.lamp.z; if (snap) { lampM.x.set(s.lamp.x); lampM.z.set(s.lamp.z); } }
  if (s.moves.length) restack(snap);
}
// Пресс-папье, которое везут на папке в руке, поднимается вместе с ней, а пока папка оседает, остаётся на ней (ride — на какой папке).
let ride = null;
function rideStep() {
  if (!ride) return;
  const f = ride.f;
  if (!weightM || drag?.weight || f.drawer !== null) { ride = null; return; }
  weightM.lift.set(Math.max(0, f.lift.v));
  if (!f.held && f.px.resting && f.pz.resting && f.pr.resting && f.lift.resting) { weightM.lift.t = 0; ride = null; }
}

// ——— Место для раскрывающегося ———
// Папке или книге, которую раскрывают (и книге, вставшей на подставку), может не хватить места: рядом лежат закрытые книги и папки. Тогда они отъезжают на свободные места
// по всему столу, по обе стороны машинки (сквозь неё они проходят — это расстановка, не перетаскивание), а если и так тесно, раскрывающаяся сама сдвигается на ближайшее место,
// где ей хватает (`makeRoom`). Раскрытые книги и папки, машинка, лампа не двигаются. Свободное место для закрытой вещи (`freeSpotFor`) выбирается ближайшее, но тесные места
// дороже, и там, где вещей уже много (в 32 см), тоже: вещи не жмутся в одну кучу, а занимают весь стол.
const ASIDE = { stay: 4, step: .03, far: .45, crowd: .2, area: .06, reach: .4, clear: .01, hop: .2, tries: 200, budget: 6 };
const ELSEWHERE = { x: 99, z: 99 };
const isBook = it => it instanceof BookThing;
const onTable = it => it.drawer === null && !it.held && !it.dd && (isBook(it) ? it.holder.visible : it.b.group.visible);
// Рамка вещи в осях стола, если поставить её (x, z, r) в положении pose; m — запас со всех сторон.
function framedAt(it, x, z, r, pose, m = 0) {
  if (isBook(it)) { const c = bookRect(it, pose), t = toTable({ x, z, r }, c); return { x: t.x, z: t.z, r, hw: c.hw + m, hd: c.hd + m }; }
  return folderRect(x, z, r, pose, m);
}
const keepAt = (it, x, z, r, pose) => isBook(it) ? keepBook(it, pose, x, z, r) : keepFolder(pose, x, z, r);
// Всё, во что вещь it упирается на столе (рамки): машинка, лампа, пресс-папье, книги и папки; ignore — вещи, которые не в счёт.
function solidsFor(it, ignore = []) {
  const out = [];
  for (const b of bodies()) if (b.m !== it && !ignore.includes(b.m)) out.push(bodyShape(b, { x: b.m.x.t, z: b.m.z.t, r: b.m.rot.t }));
  if (weightM) out.push(slabBox(weightM.x.t, weightM.z.t, weightM.rot.t, 0));
  for (const f of folders) if (f !== it && !ignore.includes(f) && onTable(f)) out.push(folderRect(f.px.t, f.pz.t, f.pr.t, f.pose, 0));
  return out;
}
const hitsAny = (a, solids) => solids.some(o => hitsSolid(a, o));
// Куда вещь на самом деле встанет, если поставить её в (x, z, r) в положении pose — как решают `bookSpot` и `folderFit` (выталкивание из машинки и лампы, пресс-папье рядом);
// ignore — вещи, которых пока не видно (они вот-вот отъедут). { x, z, w } или null — места нет.
function fitAt(it, x, z, r, pose, ignore = []) {
  const bk = ignore.filter(isBook);
  if (isBook(it)) { const p = bookSpot(it, x, z, r, pose, null, undefined, new Map(ignore.filter(o => !isBook(o)).map(o => [o, ELSEWHERE])), false, bk); return p.ok ? { x: p.x, z: p.z } : null; }
  return folderFit(it, x, z, r, pose, undefined, null, undefined, false, bk);
}
// Ближайшее свободное место вещи it (закрытой, в положении pose) — { x, z, w } или null. Смотрит всё вокруг по расширяющимся кольцам (`OFFSETS`) на весь стол, у края стола вещь
// придвигается к краю; extra — рамки, куда нельзя. Место в тесноте (ближе 3 и 7 см к соседям, много вещей вокруг) дороже.
let OFFSETS = null;
const offsets = () => OFFSETS ||= (() => { const o = []; for (let x = -2; x <= 2; x += ASIDE.step) for (let z = -.9; z <= .9; z += ASIDE.step) o.push([x, z, Math.hypot(x, z)]); return o.sort((a, b) => a[2] - b[2]); })();
function freeSpotFor(it, extra = [], ignore = [], pose = it.pose) {
  const r = it.pr.t, x0 = it.px.t, z0 = it.pz.t, solids = [...solidsFor(it, ignore), ...extra];
  const near = [...books, ...folders].filter(o => o !== it && !ignore.includes(o) && onTable(o)).map(o => ({ x: o.px.t, z: o.pz.t })).concat(extra);
  let best = null, cost = Infinity;
  for (const [ox, oz, rad] of offsets()) {
    if ((rad - .03) * ASIDE.far >= cost) break;
    const [x, z] = keepAt(it, x0 + ox, z0 + oz, r, pose), d = Math.hypot(x - x0, z - z0) * ASIDE.far;
    if (Math.hypot(x - x0 - ox, z - z0 - oz) > .03 || d >= cost) continue;
    if (hitsAny(framedAt(it, x, z, r, pose, GAP), solids)) continue;
    const F = framedAt(it, x, z, r, pose), pen = (hitsAny(framedAt(it, x, z, r, pose, .03), solids) ? ASIDE.crowd : 0) + (hitsAny(framedAt(it, x, z, r, pose, .07), solids) ? ASIDE.crowd : 0)
      + ASIDE.area * Math.min(4, near.filter(o => Math.hypot(o.x - F.x, o.z - F.z) < ASIDE.reach).length);
    if (d + pen >= cost) continue;
    const fit = fitAt(it, x, z, r, pose, ignore); if (!fit || Math.hypot(fit.x - x, fit.z - z) > .002) continue;
    best = { x, z, w: fit.w }; cost = d + pen;
  }
  return best;
}
// Листы, лежащие на столе (не в руке, не в папке, не в ящике), которые раскрывающаяся вещь (рамка F) накрыла бы: сдвигаются на ближайшее свободное место, как их сдвинул бы человек.
// Стопка (листы друг на друге) едет вместе. Нет места — лист остаётся (он окажется под вещью, как и раньше).
function sheetsAside(F, it) {
  const hw = A4.w / 2, hd = A4.h / 2, box = s => ({ x: s.px.t, z: s.pz.t, r: s.pr.t, hw, hd });
  const loose = sheets.filter(s => s.binder === null && s.drawer === null && s.mesh?.visible && !s.carry && !s.landing && !s.held && s.lift.v < .012);
  const left = loose.filter(s => hitsSolid(box(s), F, -.004));
  if (!left.length) return;
  const solids = [...solidsFor(it), F];
  while (left.length) {
    const s = left.shift(), stack = [s, ...left.filter(o => Math.hypot(o.px.t - s.px.t, o.pz.t - s.pz.t) < .03)]; for (const o of stack.slice(1)) left.splice(left.indexOf(o), 1);
    let best = null;
    for (const [ox, oz, rad] of offsets()) {
      if (best && rad - .03 >= best.d) break;
      const c = Math.abs(Math.cos(s.pr.t)), sn = Math.abs(Math.sin(s.pr.t)), [x, z] = keepOnDesk(s.px.t + ox, s.pz.t + oz, hw * c + hd * sn, hw * sn + hd * c);
      const d = Math.hypot(x - s.px.t, z - s.pz.t); if (best && d >= best.d) continue;
      const a = { x, z, r: s.pr.t, hw: hw + .01, hd: hd + .01 };
      if (hitsAny(a, solids)) continue;
      best = { x, z, d };
    }
    if (!best) continue;
    const dx = best.x - s.px.t, dz = best.z - s.pz.t;
    for (const o of stack) { o.px.t += dx; o.pz.t += dz; liftToTop(o); }
  }
}
// Положения других вещей меняются «в долг»: цели пружин и пресс-папье запоминаются, undo всё возвращает.
function tentative() {
  const saved = new Map(), w = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t };
  return {
    move(o, x, z, wt) { if (!saved.has(o)) saved.set(o, [o.px.t, o.pz.t]); o.px.t = x; o.pz.t = z; if (wt) setWeight(wt); },
    undo() { for (const [o, [x, z]] of saved) { o.px.t = x; o.pz.t = z; } if (w) setWeight(w); saved.clear(); },
  };
}
// Место вещи it, которую кладут в положение pose (раскрывают; или книгу ставят на подставку — тогда pose то же, а рамка уже новая). Закрытые вещи, которые мешают, уезжают на свободные
// места сразу (пружинами, с подскоком), и возвращается, где встанет сама: { x, z, w } — середина (как у `go`) и пресс-папье; null — места нет совсем, тогда ничего не сдвинуто.
// Из всех мест на столе берётся то, где дешевле всего: сдвиг самой вещи от того, где она раскрылась бы (вчетверо дороже, `ASIDE.stay`: вещь остаётся на месте, а соседи отъезжают),
// плюс по 10 см за каждую отодвинутую вещь и полсдвига её самой.
function makeRoom(it, pose) {
  const t0 = performance.now();
  const r = it.pr.t, d = isBook(it) ? it.book.cx(pose) - it.book.cx() : CX[pose] - CX[it.pose], nx = it.px.t + Math.cos(r) * d, nz = it.pz.t - Math.sin(r) * d;
  const movers = [...books, ...folders].filter(o => o !== it && onTable(o) && o.pose !== 'open');
  const near = (x, z, F) => ASIDE.stay * Math.hypot(x - nx, z - nz) + .05 * Math.abs(F.x);   // сама вещь сдвигается неохотно: дешевле отодвинуть соседей (решение пользователя 2026-11-21)
  const cands = [];
  cands.push({ x: nx, z: nz, lb: 0 });
  for (let x = -DESK.hw; x <= DESK.hw; x += ASIDE.step) for (let z = -DESK.hd; z <= DESK.hd; z += ASIDE.step) {
    const [kx, kz] = keepAt(it, x, z, r, pose); if (Math.abs(kx - x) > 5e-4 || Math.abs(kz - z) > 5e-4) continue;
    cands.push({ x, z, lb: near(x, z, framedAt(it, x, z, r, pose)) });
  }
  cands.sort((a, b) => a.lb - b.lb);
  let best = null, bestCost = Infinity, tries = 0;
  for (const c of cands) {
    if (c.lb >= bestCost || tries >= ASIDE.tries || (best && performance.now() - t0 > ASIDE.budget)) break;
    const fit = fitAt(it, c.x, c.z, r, pose, movers); if (!fit) continue;
    tries++;
    const F = framedAt(it, fit.x, fit.z, r, pose, ASIDE.clear), blockers = movers.filter(o => hitsSolid(framedAt(o, o.px.t, o.pz.t, o.pr.t, o.pose), F));
    let cost = near(fit.x, fit.z, F) + .1 * blockers.length; if (cost >= bestCost) continue;
    blockers.sort((a, b) => Math.hypot(a.px.t - F.x, a.pz.t - F.z) - Math.hypot(b.px.t - F.x, b.pz.t - F.z));
    const tx = tentative(), moves = []; let ok = true, fin = null;
    for (const o of blockers) {
      const sp = freeSpotFor(o, [F], [it]); if (!sp) { ok = false; break; }
      cost += .5 * Math.hypot(sp.x - o.px.t, sp.z - o.pz.t); if (cost >= bestCost) { ok = false; break; }
      tx.move(o, sp.x, sp.z, sp.w); moves.push([o, sp.x, sp.z, sp.w]);
    }
    if (ok) { fin = fitAt(it, c.x, c.z, r, pose); ok = !!fin && Math.hypot(fin.x - fit.x, fin.z - fit.z) < .02; }
    tx.undo();
    if (ok) { best = { fit: fin, moves }; bestCost = cost; }
  }
  if (!best) return null;
  for (const [o, x, z, w] of best.moves) { o.px.t = x; o.pz.t = z; if (w) setWeight(w); o.lift.vel += ASIDE.hop; }
  sheetsAside(framedAt(it, best.fit.x, best.fit.z, r, pose, ASIDE.clear), it);
  if (best.moves.length) { if (best.moves.some(m => !isBook(m[0]))) restack(); shadowDirty = true; }
  return best.fit;
}
// Лист в руке — константы (подробно — «Лист в руке» ниже). Сюда же — те, что нужны самому листу.
const CARRY = {
  lift: .025, room: .02, ahead: .04, sag: .012,         // нижняя точка листа над тем, что под ним; запас по краям при выборе высоты; он растёт со скоростью руки (секунд); провис краёв
  fit: 30, step: .01, near: .005, catchUp: 30,          // частота пружины высоты (1/с); самый длинный шаг по пути; запас вокруг преград; как быстро лист догоняет руку после преграды
  lean: .035, leanMax: .052, peek: .07,                 // наклон листа на скорость руки (рад на м/с) и самый большой (3°); на сколько закрытая папка приоткрывает крышку, когда над ней лист (4°)
  stepMax: .025, skin: .0003, hover: .01, reach: .3, reachMax: .25,                       // самый долгий кадр для пружин листа в руке; на сколько выше вещи под листом он не опускается; на сколько выше всего под собой несут лампу, книгу, папку и пресс-папье; смотрят они вперёд по ходу руки на `reach` секунд (но не дальше `reachMax`) — подняться на 30 см надо заранее
  grip: 3, gripTouch: 8, under: .008, tear: .035, hold: .25, edge: .03, // «под» — край листа заходит под вещь глубже этого; срыв: путь руки и доля, которую лист за него проходит; хват крышки снаружи
};
const tiltQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), tmp = new THREE.Vector3(), q0 = new THREE.Vector3();
const CORNERS = [[-A4.w / 2, -A4.h / 2], [A4.w / 2, -A4.h / 2], [A4.w / 2, A4.h / 2], [-A4.w / 2, A4.h / 2]];
const CORNER_IDX = [0, 12, 16 * 13, 16 * 13 + 12];   // углы сетки листа (12 × 16 клеток)

// ——— Листы, подшивки и где они лежат ———
// Положение — в координатах стола. В ящике: drawer — номер ящика, dx/dz — место на его дне.
class Placed {
  place(d, k = 80) {
    this.px = new Spring(d.x ?? 0, k, 14); this.pz = new Spring(d.z ?? 0, k, 14); this.pr = new Spring(d.rot ?? 0, k - 10, 13); this.lift = new Spring(0, 120, 13);
    this.drawer = d.drawer ?? null; this.dx = d.dx ?? 0; this.dz = d.dz ?? 0; this.floor = deskTop + .002; this.layer = d.layer ?? 0;
  }
  get dr() { return this.drawer === null ? null : drawers[this.drawer] || null; }
  get shown() { const d = this.dr; return !d || d.shown; }
  // Лежащее в ящике едет вместе с ним.
  follow() { const d = this.dr; if (!d || this.held || this.dd) return; this.px.t = this.dx; this.pz.t = this.dz + d.offset; if (!d.open.resting) { this.px.set(this.px.t); this.pz.set(this.pz.t); } this.floor = d.tray.y + .002 + (this.base ?? 0); }
  springs(dt) {
    const moving = !(this.px.resting && this.pz.resting && this.pr.resting && this.lift.resting);
    this.follow(); this.px.step(dt); this.pz.step(dt); this.pr.step(dt);
    return [moving, Math.max(0, this.lift.step(dt))];
  }
  pdata() { return { x: this.px.t, z: this.pz.t, rot: this.pr.t, drawer: this.drawer, dx: this.dx, dz: this.dz, layer: this.layer }; }
}
// Лист: сетка и холст — только пока он лежит на виду; подшитые хранят лишь строки.
class Sheet extends Placed {
  constructor(data, canvas) {
    super(); Object.assign(this, { id: data.id, lines: data.lines, fmt: data.fmt, binder: data.binder ?? null, order: data.order ?? Date.now() });
    this.seed = data.seed ?? ((Math.random() * 1e6) | 0); this.at = data.at ?? new Date().toISOString();
    this.place(data); this.mesh = null; this.canvas = canvas || null; this.grab = { x: 0, z: 0 }; this.bent = false; this.bendDrawn = 0; this.bendGrab = 0;
    // Лист в руке: отклик на скорость руки — наклон вокруг горизонтальной оси tiltAx через точку хвата; carry — где эта точка (станция, метры), пока лист несут;
    // low — он ещё выезжает из-под вещи и лежит плашмя; pushed — на сколько жёсткий предел поднял его в прошлом кадре.
    this.tilt = new Spring(0, 140, 18); this.tiltAx = { x: 1, z: 0 }; this.carry = null; this.landing = 0; this.bendNow = 0; this.low = false; this.pushed = 0;
    if (this.binder === null) this.show(); else this.canvas = null;
  }
  show() {
    if (this.mesh) return;
    this.geo = new THREE.PlaneGeometry(A4.w, A4.h, 12, 16).rotateX(-Math.PI / 2); this.flat0 = this.geo.attributes.position.array.slice();
    const c = this.canvas || blankPage(512, this.seed), fresh = !this.canvas;
    this.canvas = c; const m = pageMaterial(c, null, sheetNormal);
    this.mesh = new THREE.Mesh(this.geo, m); this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.userData.sheet = this;
    if (fresh) inkLater(this, c, () => this.canvas === c, () => { m.map.needsUpdate = true; });
    station.add(this.mesh); this.bent = false; this.bendDrawn = 0; shadowDirty = true; this.update(0);
  }
  hide() {
    if (!this.mesh) return;
    station.remove(this.mesh); this.geo.dispose(); disposeMaterial(this.mesh.material);
    this.canvas.width = this.canvas.height = 0; this.canvas = null; this.mesh = null; shadowDirty = true;
  }
  // Пружины листа в руке (поворот, провис) — шаг кадра; `carrySheet` делает его до расчёта высоты, чтобы считать лист таким, каким его нарисуют.
  // В руке пружины считают кадр не длиннее `CARRY.stepMax`: долгий кадр (лист только что показали) не должен скакнуть на десять сантиметров. Наклон в руке задан рукой, пружины у него нет.
  advance(dt) {
    const h = Math.min(dt, CARRY.stepMax);
    this.pr.step(h);
    this.bendNow += ((this.flat || this.low ? 0 : CARRY.sag) - this.bendNow) * (dt > 0 ? 1 - Math.exp(-h * 14) : 1);
    this.advanced = true;
  }
  // Поворот листа: наклон вокруг горизонтальной оси через середину (в руке — отклик на скорость), потом поворот вокруг вертикали.
  orient() { tiltQ.setFromAxisAngle(tmp.set(this.tiltAx.x, 0, this.tiltAx.z), this.tilt.v); this.mesh.quaternion.multiplyQuaternions(tiltQ, yawQ.setFromAxisAngle(Y, this.pr.v)); }
  update(dt) {
    if (!this.mesh) return;
    if (this.landing && !this.carry && this.px.resting && this.pz.resting && this.pr.resting && this.lift.resting && this.tilt.resting) { this.landing = 0; this.tilt.set(0); this.lift.set(0); calmSheet(this); }
    const c = this.carry, m = this.mesh; let moving0 = false, lift0 = 0;
    if (c) { if (!this.advanced) this.advance(dt); }
    else {
      [moving0, lift0] = this.springs(dt); this.tilt.step(dt);
      // Провис: к нужному приходит плавно; bendNow — нынешний. flat — лист ложится на стопку плашмя: в руке он провисает, а тут нет;
      // опускаясь, лист выпрямляется вместе с высотой (провис — доля высоты), чтобы края не коснулись стола раньше середины.
      this.bendNow += ((this.flat ? 0 : this.landing ? Math.min(CARRY.sag, lift0 * .6) : this.tilt.v > .02 ? CARRY.sag : Math.min(lift0, .08)) - this.bendNow) * (dt > 0 ? 1 - Math.exp(-dt * 14) : 1);
      if (this.landing) this.bendNow = Math.min(this.bendNow, lift0 * .6);   // провис не отстаёт от высоты: иначе края упёрлись бы в стол раньше середины и задержали посадку
    }
    this.advanced = false;
    const th = this.tilt.v, bend = this.bendNow, gk = this.grab.x * 31 + this.grab.z * 17;
    // Провис пересчитывается, только когда он или хват изменились: 221 вершина и нормали — не на каждый кадр.
    if ((bend >= .0005 || this.bent) && (Math.abs(bend - this.bendDrawn) > 5e-5 || gk !== this.bendGrab || !this.bent !== !(bend >= .0005))) {
      const p = this.geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = this.flat0[i * 3], z = this.flat0[i * 3 + 2], d2 = (x - this.grab.x) ** 2 + (z - this.grab.z) ** 2; p.setY(i, bend < .0005 ? 0 : -bend * (1 - Math.exp(-3 * d2 / bend))); }
      p.needsUpdate = true; this.geo.computeVertexNormals(); this.bent = bend >= .0005; this.bendDrawn = bend; this.bendGrab = gk;
    }
    if (c || Math.abs(th) > 1e-3) {
      // Наклон — вокруг оси через точку хвата: в руке середина листа вычисляется от неё (хват не уходит из-под указателя), отпущенный выравнивается вокруг середины.
      this.orient();
      if (c) { tmp.set(this.grab.x, 0, this.grab.z).applyQuaternion(m.quaternion); m.position.set(c.x - tmp.x, c.y - tmp.y, c.z - tmp.z); }
      else m.position.set(this.px.v, this.floor + lift0, this.pz.v);
    } else { m.position.set(this.px.v, this.floor + lift0, this.pz.v); m.rotation.y = this.pr.v; }
    // Жёсткий нижний предел — одно место для листа в руке и для опускающегося: ни одна точка листа не ниже того, что под ней. Выезжающий из-под вещи (low) лежит под ней — ему не нужен.
    if ((c && !this.low) || this.landing) this.keepAbove();
    else this.pushed = 0;
    if (c) { this.px.set(m.position.x); this.pz.set(m.position.z); this.lift.set(Math.max(0, m.position.y - this.floor)); }
    const moving = moving0 || !!c || !this.tilt.resting;
    const vis = this.shown; if (vis !== m.visible) { m.visible = vis; shadowDirty = true; }
    if (moving) shadowDirty = true;
  }
  // Сколько надо поднять лист, у которого середина в (ox, oy, oz), чтобы ни одна его точка не была ниже того, что под ней (F — `carryTops`): стол, свой слой, лежащие листы, папки
  // по настоящей поверхности. Сначала по углам — самой низкой точке; если и она выше всего, что под листом, вершины не перебираются.
  needLift(ox, oy, oz, F) {
    const p = this.geo.attributes.position, q = this.mesh.quaternion, floor = this.floor;
    const lim0 = Math.max(floor, deskTop + F.under({ x: ox, z: oz, r: this.pr.v, hw: A4.w / 2 + .01, hd: A4.h / 2 + .01 }) + CARRY.skin);
    let lo = Infinity;
    for (const i of CORNER_IDX) { tmp.set(p.getX(i), p.getY(i), p.getZ(i)).applyQuaternion(q); lo = Math.min(lo, oy + tmp.y); }
    if (lo - .0015 > lim0) return 0;
    let need = 0;
    for (let i = 0; i < p.count; i++) {
      tmp.set(p.getX(i), p.getY(i), p.getZ(i)).applyQuaternion(q);
      const t = F.top(ox + tmp.x, oz + tmp.z); need = Math.max(need, Math.max(floor, t > 0 ? deskTop + t + CARRY.skin : 0) - (oy + tmp.y));
    }
    return need;
  }
  keepAbove() {
    const m = this.mesh, need = this.needLift(m.position.x, m.position.y, m.position.z, topsOf(this));
    this.pushed = need > 1e-6 ? need : 0; m.position.y += this.pushed;
  }
  get data() { return { id: this.id, lines: this.lines, fmt: this.fmt, seed: this.seed, at: this.at, binder: this.binder, order: this.order, ...this.pdata() }; }
  get thick() { return .0008; }
  get foot() { return [A4.w, A4.h]; }
}
// Папка на столе: своё положение плюс то, что внутри (binder.js). Положение (`px`, `pz`, `pr`) — середина того, что лежит на столе:
// закрытой — её самой, раскрытой — разворота; поэтому колесо в руке крутит её вокруг середины, а рамка (`foot`) сидит на ней ровно.
// Меняется положение (`go`) — середина переезжает, а корешок остаётся на месте.
class Folder extends Placed {
  constructor(data) {
    super(); this.place(data, 70);
    this.b = new Binder({ id: data.id, name: data.name ?? null, pose: data.drawer == null ? data.pose : 'face', i: data.i }, { mats: folderMats, sheets: () => sheetsOf(this.id) });
    this.id = data.id; this.b.group.userData.folder = this; this.b.group.traverse(o => { o.userData.folder = this; if (o.isMesh) o.receiveShadow = true; });
    this.b.onTurn = () => { if (this === ownF) updateReadCount(); save(); }; this.b.jam = () => pressedHalves(this).length > 0;
    station.add(this.b.group); this.update(0);
  }
  update(dt) {
    const [moving, lift] = this.springs(dt);
    this.b.group.position.set(this.px.v, this.floor + lift, this.pz.v); this.b.group.rotation.y = this.pr.v;
    this.b.group.visible = this.shown;
    if (this.sz) { this.b.group.scale.setScalar(Math.max(.001, this.sz.step(dt))); shadowDirty = true; }   // уходящая папка уменьшается (`removeFolder`)
    if (this.b.update(dt) || moving) shadowDirty = true;
  }
  // Положить в другое положение: 'face', 'open' или 'back'. Середина переезжает на столе (и поворачивается вместе с папкой), а корешок остаётся на месте;
  // раскрытая не свешивается со стола — если места не хватает, её середина плавно сдвигается.
  go(pose, given = null) {
    const b = this.b, was = b.pose; if (pose === was) return;
    const d = CX[pose] - CX[was], by = r => [Math.cos(r) * d, -Math.sin(r) * d], [vx, vz] = by(this.pr.v), [tx, tz] = by(this.pr.t);
    const fit = given || this.room(pose);
    this.px.v += vx; this.pz.v += vz; this.px.t += tx; this.pz.t += tz;
    b.setPose(pose);
    if (fit) { this.px.t = fit.x; this.pz.t = fit.z; if (fit.w) setWeight(fit.w); } else [this.px.t, this.pz.t] = folderKeep(this, this.px.t, this.pz.t);
    this.stamp = ++stamps; restack(); shadowDirty = true;
  }
  get pose() { return this.b.pose; }
  get data() { return { id: this.id, name: this.b.name, pose: this.b.pose, i: this.b.i, ...this.pdata() }; }
  get thick() { const b = this.b; return (b.pose === 'open' ? Math.max(b.openHeight(-1), b.openHeight(1)) : b.thickness) + .001; }
  get foot() { return footOf(this.b.pose); }
  // Куда встанет папка, если положить её в pose ('open', 'face', 'back'): середина переезжает, как у go, и выталкивается из машинки и лампы, пресс-папье рядом отодвигается; null — места нет.
  room(pose) {
    const d = CX[pose] - CX[this.b.pose], r = this.pr.t;
    return folderFit(this, this.px.t + Math.cos(r) * d, this.pz.t - Math.sin(r) * d, r, pose, null);
  }
  // Настоящая поверхность папки над столешницей в точке стола (x, z) — дуга листа своей половины или крышка (`Binder.surfaceAt`); null — папки там нет.
  surface(x, z) {
    const dx = x - this.px.v, dz = z - this.pz.v, c = Math.cos(this.pr.v), s = Math.sin(this.pr.v), lx = dx * c - dz * s, lz = dx * s + dz * c, [w, d] = this.foot;
    if (Math.abs(lx) >= w / 2 || Math.abs(lz) >= d / 2) return null;
    return this.floor - deskTop + Math.max(0, this.lift.v) + this.b.surfaceAt(lx + CX[this.b.pose], lz);
  }
  // Высота верха над столешницей в точке стола (x, z) — или null, если папка там не лежит; у раскрытой — своя у каждой половины.
  under(x, z) {
    const dx = x - this.px.v, dz = z - this.pz.v, c = Math.cos(this.pr.v), s = Math.sin(this.pr.v), lx = dx * c - dz * s, lz = dx * s + dz * c, [w, d] = this.foot;
    if (Math.abs(lx) >= w / 2 || Math.abs(lz) >= d / 2) return null;
    return (this.b.pose === 'open' ? this.b.openHeight(lx < 0 ? -1 : 1) : this.b.thickness) + .001;
  }
}
// Середину папки (x, z) — туда, где её рамка целиком на столе (закрытая может чуть свисать спереди, раскрытая — нет).
const folderKeep = (f, x, z) => keepFolder(f.pose, x, z, f.pr.t);
// Книга на столе (book.js — тело, здесь положение): как у папки, x, z, rot — середина того, что лежит на столе; при смене положения корешок остаётся на месте
// (`go`), раскрытая не свешивается со стола и не лезет в машинку и лампу (`room`). Одна пружина-вещь (`Mover`): рука её поднимает, а `bodies()` знает как твёрдую.
// Закрытая книга ведёт себя в ящиках как папка (тот же путь: `drawerGate`, `drawerStep`, `settleDrawers`): у неё те же поля, что у `Placed` (`px`, `pz`, `pr`, `floor`,
// `drawer`, `dx`, `dz`, `layer`, `base`, `thick`, `foot`, `dd`, `held`), только пружины — `x`, `z`, `rot`.
const BOOK_DEFAULT = { x: .747, z: -.2385, rot: .1, pose: 'face', pages: 300, ratio: .68 };
const ss = u => u * u * (3 - 2 * u);
const STAND_LIFT = .04, STAND_T = { on: 1.15, off: 1.0 };   // зависание книги над рамкой (м, по нормали), отъезд подставки вбок (м), длительность хода (с)
// Куда подставка уходит из-под книги: вбок или к читателю — на столько, чтобы целиком выйти из-под развёрнутой книги (книга 36 × 27 см, подставка 33 × 30), — в первое из четырёх мест,
// где она остаётся на столе и ни во что не упирается (машинка, лампа, пресс-папье, другие книги, папки); к читателю — первым (подставку тянут на себя). Нигде нет места — к середине стола.
const STAND_OUT = [[0, 1, .34], [-1, 0, .40], [1, 0, .40], [0, -1, .34]];
function standSide(bt) {
  const solids = solidsFor(bt), c = bookRect(bt, 'open');
  for (const [dx, dz, d] of STAND_OUT) {
    const t = toTable({ x: bt.x.t, z: bt.z.t, r: bt.rot.t }, { x: dx * d, z: dz * d }), hw = STAND_FOOT.hw + .03, hd = STAND_FOOT.hd + .03;
    const ca = Math.abs(Math.cos(bt.rot.t)), sa = Math.abs(Math.sin(bt.rot.t)), [kx, kz] = keepOnDesk(t.x, t.z, hw * ca + hd * sa, hw * sa + hd * ca);
    if (Math.hypot(kx - t.x, kz - t.z) > .004) continue;
    if (!solids.some(o => hitsSolid({ x: t.x, z: t.z, r: bt.rot.t, hw, hd }, o))) return [dx * d, dz * d];
  }
  return [Math.cos(station.rotation.y + bt.rot.t) * bt.x.t > 0 ? -.4 : .4, 0];
}
const STAND_DEFAULT = 3;   // ступень подставки, на которую книга встаёт в первый раз (49°)
const BOOK_H = .26;   // высота страницы (book.js, BOOK.h)
const BOOK_RATIO = { min: .62, max: .8 };
// Закладки: сколько метров от точки тела книги (lx, lz) вдоль «головы» (z−) до края стола (стол — прямоугольник DESK в осях зала); за краем пола под лентой нет.
const tePt = new THREE.Vector3(), teQ = new THREE.Vector3();
function tableEdgeAhead(bk, lx, lz, dir = 1) {
  bk.body.updateWorldMatrix(true, false); tePt.set(lx, 0, lz).applyMatrix4(bk.body.matrixWorld); station.worldToLocal(tePt);
  teQ.set(lx, 0, lz + dir).applyMatrix4(bk.body.matrixWorld); station.worldToLocal(teQ); teQ.sub(tePt);
  let t = Infinity; const l = Math.hypot(teQ.x, teQ.z) || 1, dx = teQ.x / l, dz = teQ.z / l;
  if (dx > 1e-6) t = Math.min(t, (DESK.hw - tePt.x) / dx); else if (dx < -1e-6) t = Math.min(t, (-DESK.hw - tePt.x) / dx);
  if (dz > 1e-6) t = Math.min(t, (DESK.hd - tePt.z) / dz); else if (dz < -1e-6) t = Math.min(t, (-DESK.hd - tePt.z) / dz);
  return t;
}
class BookThing extends Mover {
  constructor(d) {
    const holder = new THREE.Group(), n = (v, def) => Number.isFinite(v) ? v : def;
    super(holder, { x: n(d.x, BOOK_DEFAULT.x), z: n(d.z, BOOK_DEFAULT.z), rot: n(d.rot, BOOK_DEFAULT.rot) }, .2);
    // file — PDF, лежащий в книге (сведения о нём; сам файл — в хранилище браузера, bookfile.js); bf — открытый файл (открывается позже, когда книгу раскрывают).
    this.file = d.file?.id ? d.file : null; this.trail = []; this.bf = null; this.src = null; this.loading = false; this.failed = null;
    // bind — номер переплёта (`bookMatsFor`); pad — подкладка под приподнятой крышкой (настройка книги).
    this.bind = Number.isFinite(d.bind) ? d.bind : 0; this.pad = d.rest !== 0;
    // Подставка: stand — ступень (1…NOTCHES), на которой книга стоит, пока раскрыта (0 — лежит); notch — последняя выбранная ступень; закрытая книга лежит на столе, а выбор остаётся.
    // rig — своя подставка книги (копия одной модели, `buildStand`); sk — насколько она разложена (раскрывается и складывается вместе с книгой); tilt — угол, на который наклонено тело книги (рад).
    const sn = v => Number.isInteger(v) && v >= 1 && v <= NOTCHES ? v : 0; this.stand = sn(d.stand); this.notch = this.stand || sn(d.notch) || STAND_DEFAULT; this.tilt = 0; this.mt = 0; this.side = [.4, 0];
    this.rig = standModel ? buildStand(standModel, this) : null; if (this.rig) { this.rig.set(this.notch); this.rig.onNotch = () => bookSound('notch'); }
    this.drawer = Number.isInteger(d.drawer) ? d.drawer : null; this.dx = d.dx ?? 0; this.dz = d.dz ?? 0; this.layer = d.layer ?? 0; this.floor = deskTop + .002; this.base = 0; this.held = false; this.dd = null; this.idle = 0;
    const pages = n(d.pages, BOOK_DEFAULT.pages);
    this.holder = holder; holder.userData.bookThing = this; station.add(holder); if (this.rig) holder.add(this.rig.group);
    this.book = this.make({ pages, ratio: !this.file && Q.get('binding') && this.bind === 0 ? bindingRatio(bindId(0)) : n(d.ratio, BOOK_DEFAULT.ratio), marks: this.file ? d.marks : [], i: n(d.i, Math.ceil(pages / 4)), pose: this.drawer === null && ['face', 'open', 'back'].includes(d.pose) ? d.pose : this.drawer !== null && d.pose === 'back' ? 'back' : 'face', flat: d.flat ? 1 : 0 });
    if (this.drawer === null) { [this.x.t, this.z.t] = keepBook(this, this.book.pose, this.x.t, this.z.t, this.rot.t); this.x.set(this.x.t); this.z.set(this.z.t); }
    if (this.standing) this.mt = 1;   // раскрытая на подставке книга из хранилища сразу стоит
    this.update(0);
  }
  get px() { return this.x; } get pz() { return this.z; } get pr() { return this.rot; }
  get pose() { return this.book.pose; }
  get thick() { return this.book.thickness + .001; }
  get foot() { const f = this.book.footprint(this.book.pose === 'back' ? 'back' : 'face'); return [2 * Math.max(-f.x0, f.x1), 2 * f.hd]; }
  get dr() { return this.drawer === null ? null : drawers[this.drawer] || null; }
  get shown() { const d = this.dr; return !d || d.shown; }
  // Лежащее в ящике едет вместе с ним (как `Placed.follow`).
  follow() { const d = this.dr; if (!d || this.held || this.dd) return; this.x.t = this.dx; this.z.t = this.dz + d.offset; if (!d.open.resting) { this.x.set(this.x.t); this.z.set(this.z.t); } this.floor = d.tray.y + .002 + this.base; }
  // Тело книги по данным; страницы берутся из файла (src), пока файла нет — чистая бумага.
  make(d) {
    const f = this.file, bk = new Book(d, { mats: bookMatsFor(this.bind), sound: bookSound, init: t => renderer.initTexture(t), source: this.src, aspect: f ? f.w / f.h : undefined, rest: this.pad });
    bk.tableEdge = (lx, lz, dir) => tableEdgeAhead(bk, lx, lz, dir); bk.group.traverse(o => o.layers.enable(1)); bk.setPaperMode(decor.bookPaper === 'file'); bk.thing = this; bk.onTurn = () => { save(); bookBarDirty = true; }; this.holder.add(bk.group); this.applyStand(this.mt, bk); return bk;
  }
  // Стоит на подставке (по выбору, пока раскрыта и лежит на столе).
  get standing() { return !!this.rig && this.stand > 0 && this.book.pose === 'open' && this.drawer === null; }
  // Подставка и книга — один ход с ходу `m` от 0 (книга плашмя на столе, подставки нет) до 1 (книга на рамке). Ни один кадр не пускает вещи друг в друга:
  // 0 → .25 книга приподнимается и наклоняется, как на рамке, подставки рядом нет (она отодвинута вбок); .25 → .52 сложенная подставка заезжает под зависшую книгу (она выше сложенной
  // подставки); .45 → .8 рамка раскладывается (всё, что у неё выше книжной плоскости, — полочка, и до неё книге ≥ 4 см); .78 → 1 книга опускается по нормали рамки на полочку.
  // Снимают книгу с подставки тем же ходом назад. Книга везде выше плоскости рамки (всё её тело — по одну сторону плоскости низа), нижний край ведёт по прямой, угол растёт от нуля.
  applyStand(m, bk = this.book) {
    const rig = this.rig, g = bk.group; this.mt = m;
    if (!rig || m <= 0) { if (rig) rig.group.visible = false; g.position.set(0, .002, 0); g.rotation.x = 0; this.tilt = 0; bk.setTilt(0); return; }
    const th = rig.angle, Dz = bk.s.Dz, p = bookPlace(th, Dz), sn = Math.sin(th), cs = Math.cos(th);
    const fy = p.y - Dz / 2 * sn, fz = p.z + Dz / 2 * cs, L = STAND_LIFT;
    const lift = m < .78 ? L : L * (1 - ss(clamp((m - .78) / .22, 0, 1)));
    const e = ss(clamp(m / .25, 0, 1)), t = th * e;
    const y = (m < .25 ? .002 + (fy + lift * cs - .002) * e : fy + lift * cs), z = m < .25 ? Dz / 2 + (fz + lift * sn - Dz / 2) * e : fz + lift * sn;
    g.position.set(0, y + Dz / 2 * Math.sin(t), z - Dz / 2 * Math.cos(t)); g.rotation.x = t; this.tilt = t; bk.setTilt(t);
    rig.k = ss(clamp((m - .45) / .35, 0, 1)); rig.apply(); rig.group.visible = true; rig.group.scale.y = 1;
    const out = 1 - ss(clamp((m - .25) / .27, 0, 1)); rig.group.position.set(this.side[0] * out, 0, this.side[1] * out);
  }
  // Стоит на подставке (по выбору, пока раскрыта и лежит на столе).
  get standing() { return !!this.rig && this.stand > 0 && this.book.pose === 'open' && this.drawer === null; }
  // Подставка каждый кадр: ход к 1, когда книга раскрылась до конца, и назад, когда её закрывают или кладут на стол; рамка идёт к ступени. true — что-то движется (тени, вид).
  updateStand(dt) {
    const rig = this.rig, bk = this.book; if (!rig) return false;
    if (this.scrub != null) { this.applyStand(this.scrub, bk); return true; }   // отладка: ход остановлен на нужном кадре (`__rr.bookThing.scrub = .6`)
    const want = this.standing && bk.openS.v > .97 && bk.backS.v < .03 ? 1 : 0;
    if (want === 0 && this.mt === 0 && !rig.group.visible) return false;
    if ((this.mt === 0 || this.mt === 1) && want !== this.mt) this.side = standSide(this);   // сторона, куда подставка уходит, выбирается перед ходом: пока она в ходу, не меняется
    const T = want ? STAND_T.on : STAND_T.off, m = want > this.mt ? Math.min(1, this.mt + dt / T) : want < this.mt ? Math.max(0, this.mt - dt / T) : this.mt;
    const moved = rig.step(dt);
    if (m === this.mt && !moved && !(dt === 0 && want === 1)) { if (m === 0) rig.group.visible = false; return false; }
    this.applyStand(m, bk);
    return m !== want || moved;
  }
  update(dt) {
    if (!this.book) return super.update(dt);   // Mover зовёт update из конструктора, пока книги ещё нет
    let m;
    if (this.drawer !== null || this.dd) {
      this.follow();
      m = !(this.x.resting && this.z.resting && this.rot.resting && this.lift.resting);
      this.obj.position.set(this.x.step(dt), this.floor - .002 + Math.max(0, this.lift.step(dt)), this.z.step(dt)); this.obj.rotation.y = this.rot.step(dt);
      this.holder.visible = this.shown;
    } else { m = super.update(dt); this.holder.visible = true; }
    const b = this.book?.update(dt), sm = this.updateStand(dt);
    // Закладки зависят от того, где край стола относительно головы книги: переставили — пересчитать.
    this.book.marks.setAway(this.drawer !== null);
    if (this.book.marks.count) { const k = this.x.v + this.z.v * 7.3 + this.rot.v * 3.1; if (Math.abs(k - (this.markPos ?? 1e9)) > 1e-5) { this.markPos = k; this.book.marks.layout(); } }
    // Файл открывается не при загрузке зала, а когда книгу впервые раскрывают (или в покое через несколько секунд, `idleOpen`): закрытой книге страницы не нужны.
    if (this.book && ready && this.file && !this.bf && !this.loading && this.failed !== this.file.id && this.book.paged) this.ensureFile();
    // Закрытая книга, которой давно не касались, отпускает файл (поток pdf.js): откроется снова, когда её раскроют.
    if (this.bf && !this.book.paged && !this.book.moving && this !== bookM) { if ((this.idle += dt) > 25) this.release(); } else this.idle = 0;
    return m || !!b || sm;
  }
  release() { this.idle = 0; this.bf?.close(); this.bf = null; this.src = null; if (this.book) { this.book.source = null; this.book.syncPages(); } }
  // Название в строке книги: из PDF, а нет его — имя файла без «.pdf».
  get title() { const f = this.file; return f ? (f.title || '').trim() || (f.name || '').replace(/\.pdf$/i, '') : ''; }
  get data() {
    const b = this.book, d = { x: this.x.t, z: this.z.t, rot: this.rot.t, pose: b.pose, i: b.i, flat: b.pressed > .5 ? 1 : 0, pages: b.pages, ratio: b.ratio, file: this.file, bind: this.bind, rest: this.pad ? 1 : 0, act: this === bookM ? 1 : 0, stand: this.stand, notch: this.notch, marks: b.marks.data() };
    if (this.drawer !== null) Object.assign(d, { drawer: this.drawer, dx: this.dx, dz: this.dz, layer: this.layer });
    return d;
  }
  // Куда встанет книга, если положить её в pose: середина переезжает, как у папки (корешок остаётся), и выталкивается из машинки, лампы, пресс-папье и папок; null — места нет.
  // Закрытые книги рядом раскрывающейся не мешают: они потом уйдут с дороги (`makeRoom`).
  room(pose) {
    const d = this.book.cx(pose) - this.book.cx(), r = this.rot.t, x = this.x.t + Math.cos(r) * d, z = this.z.t - Math.sin(r) * d;
    let p = bookSpot(this, x, z, r, pose, null, undefined, null, pose === 'open');
    if (!p.ok && pose === 'open') p = bookSpot(this, x, z, r, pose, null, undefined, null, true, books.filter(o => o !== this && o.book.pose !== 'open'));
    return p.ok ? p : null;
  }
  // Положить в другое положение ('face', 'open', 'back'). Раскрыться некуда — false, ничего не изменилось.
  go(pose, given = null) {
    const bk = this.book, was = bk.pose; if (pose === was) return true;
    const fit = given || this.room(pose); if (!fit && pose === 'open') return false;
    this.shiftHinge(bk.cx(pose) - bk.cx(was));
    bk.setPose(pose);
    if (fit) { this.x.t = fit.x; this.z.t = fit.z; } else [this.x.t, this.z.t] = keepBook(this, pose, this.x.t, this.z.t, this.rot.t);
    shadowDirty = true; return true;
  }
  // Середина переехала на d вдоль книги: корешок остаётся на месте.
  shiftHinge(d) {
    const by = r => [Math.cos(r) * d, -Math.sin(r) * d], [vx, vz] = by(this.rot.v), [tx, tz] = by(this.rot.t);
    this.x.v += vx; this.z.v += vz; this.x.t += tx; this.z.t += tz;
  }
  // Не раскрылась — вздрагивает.
  shudder() { this.rot.vel += 2.2; this.lift.vel += .25; }
  // Страницы из открытого файла.
  attach() {
    const bf = this.bf, bk = this.book; if (!bf) return;
    this.src = { aspect: bf.info.w / bf.info.h, tones: bf.tones, render: (n, h, o) => bf.render(n, h, o) };
    bf.onstat = st => bk.noteCost(st.height, st.ms);
    bk.source = this.src; bk.setAspect(this.src.aspect); bk.settled = false; bk.syncPages(); if (this === bookM) bookDetailDirty = true;
  }
  async ensureFile() {
    const f = this.file; if (!f || this.bf || this.loading) return; this.loading = true;
    try {
      const bf = await openFile(f.id);
      if (this.file !== f || this.dead) { bf.close(); return; }
      this.bf = bf; this.attach();
    } catch (e) {
      if (this.file !== f) return;
      if (e?.name === 'NotFound') { this.rebuild(null, null); hint(t('hint.book.fileMissing'), 9000); save(); }
      else { this.failed = f.id; console.warn(e); hint(e?.message || t('hint.book.openFail'), 8000); }
    } finally { this.loading = false; }
  }
  // Заменить файл (info — сведения о нём, bf — открытый файл) или убрать (null): книга перестраивается под число страниц и пропорции страницы, корешок остаётся на месте.
  rebuild(info, bf) {
    const old = this.book, pose = old.pose, cx0 = old.cx(), pages = info ? Math.max(2, info.pages) : BOOK_DEFAULT.pages, ratio = info ? clamp(info.w / info.h, BOOK_RATIO.min, BOOK_RATIO.max) : Q.get('binding') && this.bind === 0 ? bindingRatio(bindId(0)) : BOOK_DEFAULT.ratio;
    this.bf?.close(); this.bf = bf; this.file = info; this.src = null; this.failed = null; this.trail = []; this.holder.remove(old.group); old.dispose(true);
    this.book = this.make({ pages, ratio, i: 0, pose, flat: 0 });
    if (reading && this === bookM) readLayers();
    this.shiftHinge(this.book.cx() - cx0);
    const p = bookSpot(this, this.x.t, this.z.t, this.rot.t, pose, null, undefined, null, true);
    if (p.ok) { this.x.t = p.x; this.z.t = p.z; } else [this.x.t, this.z.t] = keepBook(this, pose, this.x.t, this.z.t, this.rot.t);
    if (bf) this.attach();
    lightMasks(); shadowDirty = true; bookBarDirty = bookDetailDirty = true;
  }
  // Книга уходит из зала: тело и файл в памяти освобождаются.
  dispose() { this.dead = true; this.bf?.close(); this.bf = null; this.holder.parent?.remove(this.holder); this.book.dispose(true); }
}
const sheets = [], folders = [];
// Папки на столе, которые пересекаются (раскрытая занимает вдвое больше места), лежат одна на другой: та, что положена позже, — выше (`stamp`).
// Пересчитывается, когда папку положили, раскрыли или закрыли; высота (`rest`) подтягивается плавно (кадр).
let stamps = 0;
function restack(now = false) {
  const on = folders.filter(f => f.drawer === null && !f.held).sort((a, b) => (a.stamp || 0) - (b.stamp || 0)), base = deskTop + .002;
  const box = f => ({ x: f.px.t, z: f.pz.t, r: f.pr.t, hw: f.foot[0] / 2, hd: f.foot[1] / 2 });
  on.forEach((f, i) => {
    let top = 0;
    for (let j = 0; j < i; j++) if (hitsSolid(box(f), box(on[j]), -.003)) top = Math.max(top, on[j].rest - base + on[j].thick);
    f.rest = base + top; if (now) f.floor = f.rest;
  });
}
const sheetsOf = id => sheets.filter(s => s.binder === id).sort((a, b) => a.order - b.order);
// Что лежит под точкой (x, z) на столе: высота верха самой высокой вещи над столешницей (0 — голый стол). Берётся середина пресс-папье.
// Лист в руке и опускающийся не в счёт; лежащий (в том числе зажатый под плитой, пока его тянут из-под неё) — в счёт.
// Точка переводится в рамку вещи — как она сама поставлена: поворот вокруг вертикали на px.v, pz.v, pr.v.
function underAt(x, z) {
  let top = 0;
  const inside = (it, hw, hd) => { const dx = x - it.px.v, dz = z - it.pz.v, c = Math.cos(it.pr.v), s = Math.sin(it.pr.v); return Math.abs(dx * c - dz * s) < hw && Math.abs(dx * s + dz * c) < hd; };
  for (const s of sheets) if (s.mesh?.visible && s.drawer === null && s.binder === null && !s.carry && !s.landing && s.lift.v < .012 && inside(s, A4.w / 2, A4.h / 2)) top = Math.max(top, s.floor - deskTop + .0006 + Math.max(0, s.lift.v));
  for (const f of folders) if (f.b.group.visible && f.drawer === null && (!f.held || f === ride?.f)) { const h = f.under(x, z); if (h !== null) top = Math.max(top, f.floor - deskTop + h); }
  return top;
}
// Взятое ложится поверх остальных; слои уплотняются — только среди листов на виду.
let topFloor = 0;
function liftToTop(s) {
  if (s.drawer !== null) { s.layer = Math.max(0, ...[...sheets, ...folders, ...books].filter(x => x.drawer === s.drawer && x !== s).map(x => x.layer)) + 1; return; }
  topFloor += .0008; s.floor = deskTop + .002 + topFloor; s.layer = topFloor;
  if (topFloor > .02) { const loose = sheets.filter(x => !x.binder && x.drawer === null).sort((a, b) => a.floor - b.floor); loose.forEach((x, i) => { x.floor = deskTop + .002 + i * .0008; x.layer = i * .0008; }); topFloor = loose.length * .0008; }
}
// В ящике вещи ложатся друг на друга: каждая — поверх тех, что легли раньше и лежат под ней.
function settleDrawers() {
  const all = [];
  for (const s of sheets) if (s.drawer !== null && s.binder === null && !s.held) all.push(s);
  for (const f of [...folders, ...books]) if (f.drawer !== null && !f.held) all.push(f);
  if (!all.length) return;
  for (let k = 0; k < drawers.length; k++) {
    const items = all.filter(it => it.drawer === k);
    if (!items.length) continue;
    items.sort((a, b) => a.layer - b.layer);
    items.forEach((it, i) => {
      const [w, d] = it.foot; let base = 0;
      for (let j = 0; j < i; j++) { const o = items[j], [w2, d2] = o.foot; if (Math.abs(o.dx - it.dx) < (w + w2) / 2 && Math.abs(o.dz - it.dz) < (d + d2) / 2) base = Math.max(base, o.base + o.thick); }
      it.base = base;
    });
  }
}
// ——— Вещь и ящик ———
// Ящики выдвигаются к сидящему, и под столешницей, тумбой и верхними ящиками вещи не пройти. Поэтому вещь в руке идёт к выдвинутому ящику над столом (`DR.out` над столешницей),
// выходит за передний край стола и опускается в ящик сверху, а из ящика выходит так же — вдоль дна к краю стола, вверх и дальше над столешницей. Это `drawerStep` (каждый кадр,
// пока у вещи есть `dd`): высота — своя пружина, вещь опускается только когда она вся за краем стола и дальше выдвинутых выше ящиков (`entryZ`) и пока не ниже `ySlide`
// не заезжает под стол; ниже — едет по дну к месту (под столешницу уходит только внутри ящика). Не помещается вдоль — ложится боком (`drawerGate`), не помещается и так, или мешает
// верхний выдвинутый ящик, — ящик вещь не берёт (она остаётся в руке над ним). Отпущенная вещь довершает путь сама, брошенная на выходе — падает обратно в свой ящик.
const DR = { clear: .005, out: .03, omega: 30, wall: .002 };
const rotExt = (it, r) => { const [w, d] = it.foot, c = Math.abs(Math.cos(r)), n = Math.abs(Math.sin(r)); return [(w * c + d * n) / 2, (w * n + d * c) / 2]; };
// Ближе всего к сидящему — тот край, мимо которого вещь опускается: передний край стола и дальний конец выдвинутых выше ящиков в той же тумбе (с запасом).
function entryZ(D) {
  const t = D.tray; let z = D.front;
  for (const U of drawers) if (U !== D && U.shown && U.box.min.y >= D.box.max.y - .004 && U.box.max.x > t.x0 && U.box.min.x < t.x1) z = Math.max(z, U.box.max.z + U.offset);
  return z + DR.clear;
}
// Берёт ли ящик вещь: помещается ли она вся между краем стола и передней доской ящика, прямо (b = 0) или боком (b = π/2); b — поворот, при котором помещается.
function drawerGate(D, it) {
  const t = D.tray, zE = entryZ(D), zMax = t.z1 + D.offset, r0 = it.pr.t, k0 = Math.round(r0 / Math.PI) * Math.PI, k1 = Math.round((r0 - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
  if (it.thick + .02 > D.box.max.y - t.y) return { ok: false };   // толстая книга в ящик не войдёт
  for (const b of Math.abs(r0 - k0) <= Math.abs(r0 - k1) ? [k0, k1] : [k1, k0]) {
    const [ex, ez] = rotExt(it, b);
    if (zE + 2 * ez + 2 * DR.wall <= zMax && 2 * ex + 2 * DR.wall <= t.x1 - t.x0) return { ok: true, b, ex, ez };
  }
  return { ok: false };
}
// Высота, на которую вещь ложится на дно, если на нём уже что-то лежит под ней (те же правила, что в `settleDrawers`).
function stackUnder(it, D, dx, dz) {
  const k = drawers.indexOf(D), [w, d] = it.foot; let base = 0;
  for (const o of [...sheets, ...folders, ...books]) {
    if (o === it || o.drawer !== k || o.held) continue;
    const [w2, d2] = o.foot; if (Math.abs(o.dx - dx) < (w + w2) / 2 && Math.abs(o.dz - dz) < (d + d2) / 2) base = Math.max(base, (o.base || 0) + o.thick);
  }
  return base;
}
function startDD(it, D) {
  if (it.cy !== null && it.cy !== undefined) dropHeight(it);   // несли над всем — высота руки уходит в пружины
  it.dd = { d: D, y: new Spring(it.floor + Math.max(0, it.lift.v), DR.omega ** 2, 2 * DR.omega), want: null, goal: null, leave: false, then: null };
  delete it.floorGoal; it.lift.t = 0; it.lift.vel = 0;
  if (it instanceof Sheet) { it.carry = null; it.low = false; it.tilt.t = 0; }
}
const calmItem = it => { if (it instanceof Sheet) calmSheet(it); else { for (const k of [it.px, it.pz]) { k.k = 70; k.c = 14; } } };
// Вещь, которую только что вынули из ящика или не взяли в него, — снова обычная: она на столе, на своей высоте над ним.
function endDD(it) {
  const base = deskTop + .002;
  it.dd = null; it.drawer = null; it.dz = 0; it.floor = base; calmItem(it); it.lift.vel = 0;
}
function drawerStep(it, dt) {
  const dd = it.dd, D = dd.d, t = D.tray, held = it.held, up = held ? dd.want !== D : dd.leave;
  const [ax, az] = rotExt(it, it.pr.v), [bx, bz] = rotExt(it, it.pr.t), ex = Math.max(ax, bx), ez = Math.max(az, bz);
  const zE = entryZ(D), y = dd.y.v, ySlide = D.box.max.y - it.thick - .012, yOut = deskTop + DR.out, x = it.px.v, z = it.pz.v;
  const column = x - ex >= t.x0 - .003 && x + ex <= t.x1 + .003 && z - ez >= zE - .002, inside = y <= ySlide + .001;
  for (const k of [it.px, it.pz]) { k.k = 300; k.c = 2 * Math.sqrt(300); }
  let tx, tz, ty;
  if (up) {
    // Из ящика: сначала вдоль дна к краю стола (боком, если иначе упрётся в доску), потом вверх.
    if (inside) { const g = drawerGate(D, it); if (g.ok) it.pr.t = g.b + clamp(it.pr.t - g.b, -.03, .03); }
    tx = x; tz = Math.max(z, zE + ez); ty = column ? yOut : y;
    if (column && y >= yOut - .004) {
      const want = held ? dd.want : null;
      if (want) { it.dd = { d: want, y: dd.y, want, goal: dd.goal, leave: false, then: null }; it.drawer = null; return; }
      const d0 = dd.then; endDD(it); it.lift.set(Math.max(0, y - it.floor));
      if (held) { it.lift.t = it instanceof Sheet ? 0 : .05; it.floorGoal = deskTop + .002; } else it.lift.t = 0;
      if (d0) d0(); return;
    }
  } else {
    const goal = held ? dd.goal : { x: it.dx, z: it.dz + D.offset };
    tx = goal.x; tz = goal.z; if (!inside) tz = Math.max(tz, zE + ez);
    ty = inside || column ? t.y + .002 + stackUnder(it, D, x, z - D.offset) : yOut;
    if (!held && inside && Math.abs(y - ty) < 6e-4 && Math.abs(x - tx) < 1.5e-3 && Math.abs(z - tz) < 1.5e-3 && it.pr.resting) { it.dd = null; calmItem(it); it.lift.set(0); return; }
  }
  it.px.t = tx; it.pz.t = tz; dd.y.t = ty; dd.y.step(Math.min(dt, .033));
  it.floor = dd.y.v; it.lift.set(0); it.lift.t = 0; if (it instanceof Sheet) it.tilt.t = 0;
  shadowDirty = true;
}
// Вещь в ящике подняли и тащат/положили на стол: ей надо выйти (папке — раскрыться на столе, `unfold`).
// Вещь, отпущенная на выходе из ящика, ложится на стол: лист — как отпущенный в воздухе (`landSpot`), папка — как отпущенная на столе.
function settleOnDesk(it, q, d) {
  if (q) {
    if (it instanceof Sheet) {
      const g = it.grab, c = Math.cos(it.pr.v), n = Math.sin(it.pr.v), y = it.floor + it.lift.v, [x, z] = landSpot(it, { x: q.x - (g.x * c + g.z * n), z: q.z - (-g.x * n + g.z * c) });
      it.floor = deskTop + .002; liftToTop(it); it.lift.v = Math.max(0, y - it.floor); landSheet(it, x, z);
    } else { if (it instanceof BookThing) steerBook(it, q.x - d.off.x, q.z - d.off.z, it.rot.t); else steerFolder(it, q.x - d.off.x, q.z - d.off.z, it.pr.t, null); it.stamp = ++stamps; restack(); }
  }
  save();
}
function leaveDrawer(it, then) { if (it.dd) return; startDD(it, it.dr); it.dd.leave = true; it.dd.then = then; it.held = false; }
function addSheet(data, canvas) { const s = new Sheet(data, canvas); sheets.push(s); if (s.binder === null && s.drawer === null) { if (data.layer != null) { s.floor = deskTop + .002 + data.layer; topFloor = Math.max(topFloor, data.layer); } else liftToTop(s); } return s; }
function addFolder(data) { const f = new Folder(data); folders.push(f); if (ready) lightMasks(); return f; }

// ——— Хранение ———
const KEY = 'reading-room-v1';
const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
// Книги: раньше в столе лежала одна (`book`), теперь список (`books`, до BOOK_MAX); прежняя читается как первая и при следующем сохранении уходит в список.
const storedBooks = (Array.isArray(stored.books) ? stored.books : stored.book ? [stored.book] : []).filter(b => b && typeof b === 'object').slice(0, BOOK_MAX);
// В первой версии слой листа был высотой над столом — такие слои не годятся, раскладываем заново.
if (stored.v !== 2) for (const s of stored.sheets || []) delete s.layer;
const LIGHT = .45;
// Убранство зала — росписи куполков, скульптура на каталоге, фигурка на пресс-папье и бумага книги: выбирается кнопкой «убранство», хранится вместе со столом;
// ?art=, ?sculpt=, ?weight= — на этот раз другое. Остальное (дерево, шкафы, паркет, окна, глобусы, часы, вещи задней стены) выбрано раз и навсегда;
// ключи этого в старых сохранениях игнорируются.
const choice = (list, key, def) => Object.hasOwn(list, key ?? '') ? key : def;
// savedArt — набор, выбранный в карточке: его и хранить, даже если на этот раз открыт другой по ?art=.
let savedArt = choice(ART_SETS, stored.decor?.art, 'hofmann');
// savedSculpt — скульптура, выбранная в карточке; ?sculpt= — другая на этот раз.
let savedSculpt = choice(SCULPTS, stored.decor?.sculpt, 'boar');
// savedWeight — фигурка на пресс-папье, выбранная в карточке; ?weight= — другая на этот раз.
let savedWeight = choice(FIGURES, stored.decor?.weight, 'mouse');
const BOOK_PAPER = { old: { title: t('decor.paper.old') }, file: { title: t('decor.paper.file') } };
const decor = { bookPaper: choice(BOOK_PAPER, stored.decor?.bookPaper, 'old'), sculpt: choice(SCULPTS, Q.get('sculpt'), savedSculpt), weight: choice(FIGURES, Q.get('weight'), savedWeight), art: choice(ART_SETS, Q.get('art'), savedArt) };
// Свет зала — 0…1,6: выше единицы — «ещё светлее» (её просьба 2026-11-22: «возможность ещё больше света добавить»).
const LIGHT_MAX = 1.6;
let lightLevel = clamp(stored.light ?? LIGHT, 0, LIGHT_MAX), inkLevel = clamp(stored.ink ?? .35, 0, 1);
let stale = false, nextId = stored.nextId || 1, saveT, ready = false, typeFace = stored.face === 'book' ? 'book' : 'mono', draft = stored.draft || null, warned = false;
const saveNow = () => {
  clearTimeout(saveT); if (!ready || stale) return;
  if (tw) draft = tw.draft;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, nextId, face: typeFace, light: lightLevel, ink: inkLevel, decor: { ...decor, sculpt: savedSculpt, weight: savedWeight, art: savedArt }, draft, tw: twM ? twM.data : stored.tw, lamp: lampM ? { ...lampM.data, on: lamp.on } : stored.lamp, weight: weightM ? weightM.data : stored.weight, books: books.length ? books.map(b => b.data) : storedBooks, hallLamps: tableLamps?.touched ? tableLamps.bits() : stored.hallLamps, hallChairs: chairs?.touched ? chairs.data() : stored.hallChairs, sheets: sheets.map(s => s.data), binders: folders.filter(f => !f.gone).map(f => f.data) }));
  } catch { if (!warned) { warned = true; hint(t('hint.save.noSpace'), 9000); } }
};
const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); };
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
navigator.storage?.persist?.().catch(() => {});
addEventListener('storage', e => { if (e.key === KEY && e.newValue) { stale = true; hint(t('hint.save.staleTab'), 0); } });

// ——— Взгляд от первого лица: голова поворачивается, можно встать, пройтись, наклониться к столу ———
const eye = new THREE.Vector3(), eyeGoal = new THREE.Vector3(), dir = new THREE.Vector3();
const yaw = new Spring(0, 40, 12), pitch = new Spring(0, 40, 12);
let state = 'loading';
// Где можно быть: весь зал — над галереями, над залом и внизу между столами (на высоте глаз стоящего), до самого свода.
// Нельзя: сквозь стены и шкафы, пол галерей и пространство под главной, балюстраду ниже поручня, вещи у задней стены, стол (keepEye).
// (Недолго всё, кроме стен, было проходимым — пользователь передумала: «давай проход через текстуры уберём всё же», 2026-11-13.)
const EYE = { y0: .3, hall: -HALL.depth + 1.6, y1: HALL.top + 1.5 };
const VOL = { x: HALL.w / 2 - .85, z0: RAIL_Z - HALL.len + .95, z1: RAIL_Z + GAL - .35 };
// Без границ (для проверки): ещё ниже, у самого пола; твёрдого нет.
let free = false;
// Верх — под сводом, в 70 см от него (рёбра и кессоны выступают вниз): у стен он ниже, по оси зала — под куполками (пока потолка нет — над поясом окон).
const yMin = () => free ? -HALL.depth + .3 : EYE.hall, yMax = x => ceiling ? ceiling.roof(x, .7) : EYE.y1;
const inVol = (x, y, z) => Math.abs(x) <= VOL.x + 1e-6 && z >= VOL.z0 - 1e-6 && z <= VOL.z1 + 1e-6 && y >= yMin() - 1e-6 && y <= yMax(x) + 1e-6;
// Балюстрада ниже поручня — главная и дальняя (вдоль x) и боковые (вдоль z): 'x' и 'z' — ось, поперёк которой она стоит.
const RAIL_TOP = 1.15;
// Ответ — [ось, отметка балюстрады на ней] или null.
const railAt = (x, y, z) => !(y > -.7 && y < RAIL_TOP) ? null : Math.abs(x) < SIDE.rail + .15 && Math.abs(z - RAIL_Z) < .15 ? ['z', RAIL_Z] : Math.abs(x) < SIDE.rail + .15 && Math.abs(z - SIDE.far) < .15 ? ['z', SIDE.far]
  : Math.abs(Math.abs(x) - SIDE.rail) < .15 && z < RAIL_Z + .15 && z > SIDE.far - .15 ? ['x', Math.sign(x) * SIDE.rail] : null;
function solid(x, y, z) {
  if (free) return false;
  const overMain = z > RAIL_Z - .15, overSide = Math.abs(x) > SIDE.rail - .15 || z < SIDE.far + .15, slab = y > -.7 && y < EYE.y0;
  if ((overMain || overSide) && slab) return true;
  // Под главной галереей раньше было не пройти; уголок открывает её нижний зал — внутри него ходят (мебель — преграды, `standing`).
  if (overMain && y <= -.7 && !(NOOK && Math.abs(x) < VOL.x + .01)) return true;
  // Часы и глобусы у задней стены: вплотную к ним не подойти, и над глобусом на высоте глаз (и от стула) не пролететь; под часами — можно.
  for (const { box: b, margin: m, wall, low } of standing) if (x > b.min.x - m && x < b.max.x + m && z > b.min.z - m && y < (wall || low ? b.max.y + m : Math.max(b.max.y + m, 2.4)) && (!wall || y > b.min.y - m)) return true;
  return !!railAt(x, y, z);
}
const standable = (x, y, z) => inVol(x, y, z) && !solid(x, y, z);
const keepEye = v => {
  v.set(clamp(v.x, -VOL.x, VOL.x), v.y, clamp(v.z, VOL.z0, VOL.z1)); v.y = clamp(v.y, yMin(), yMax(v.x));
  // Фриз и карниз над задней стеной выступают из неё: на их высоте взгляд держится чуть дальше от стены и обходит их.
  if (v.y > FRIEZE.y0 - .15 && v.y < HALL.top + .3) v.z = Math.min(v.z, BACK.z - .7);
  // Над столом — не ниже ладони над столешницей: голова не проходит сквозь стол.
  const l = station.worldToLocal(v.clone());
  // (Только над галереей: под ней, в уголке, голова стола не задевает.)
  if (v.y > -.5 && Math.abs(l.x) < DESK.hw + .06 && Math.abs(l.z) < DESK.hd + .06 && l.y < deskTop + .14) { l.y = deskTop + .14; v.copy(station.localToWorld(l)); }
  return v;
};
const W = (x, y, z) => station.localToWorld(new THREE.Vector3(x, y, z));
// «За столом» — из-за стула, чуть сверху: в центре стол с машинкой, за балюстрадой — зал с рядами ламп.
const VIEWS = {
  seat: () => ({ pos: W(0, deskTop + SEAT.pos[1], DESK.hd + SEAT.pos[2]), at: W(0, deskTop + SEAT.at[1], SEAT.at[2]) }),
  hall: () => DESK_MODE === 'wall'
    ? { pos: new THREE.Vector3(-HALL.w / 2 + 2.6, 1.6, RAIL_Z + .9), at: new THREE.Vector3(.5, -3.2, RAIL_Z - 12) }
    : { pos: new THREE.Vector3(.9, 1.55, RAIL_Z + .5), at: new THREE.Vector3(.3, -3.4, RAIL_Z - 12) },
  type: () => typeView(),
  // Киноуголок под балконом: из зала, между рядами столов — экран около четверти кадра, видно весь уголок: пальма, оба плаката, проектор, шахматы (по снимку пользователя 2026-11-22).
  nook: () => ({ pos: new THREE.Vector3(0, -3.15, -5.5), at: new THREE.Vector3(0, -3.4, 2.7) }),
  // Задняя стена целиком — из зала, над балюстрадой: с этой точки сравниваются её варианты (?view=wall).
  wall: () => ({ pos: new THREE.Vector3(-4.2, 3.2, RAIL_Z - 4.85), at: new THREE.Vector3(-.3, 1.9, BACK.z) }),
};
const SEAT = { pos: [0, 1.12, 1.12], at: [0, .02, -1.3] };
const aimAt = (pos, at, snap = false) => {
  fovGoal = FOV; eyeGoal.copy(pos); keepEye(eyeGoal); const d = at.clone().sub(pos).normalize();
  const y = Math.atan2(-d.x, -d.z), p = Math.asin(clamp(d.y, -1, 1));
  yaw.t = yaw.v + (THREE.MathUtils.euclideanModulo(y - yaw.v + Math.PI, Math.PI * 2) - Math.PI); pitch.t = p;
  if (snap) { eye.copy(eyeGoal); yaw.set(yaw.t); pitch.set(p); camera.fov = FOV; camera.updateProjectionMatrix(); }
};
let lookBack = null;
const viewOn = name => {
  lookBack = null;
  document.querySelectorAll('#views button').forEach(b => {
    b.classList.toggle('on', reading ? b.dataset.v === 'read' : b.dataset.v === name);
    if (b.dataset.v === 'read') { b.dataset.tip = reading ? t('views.readOff') : t('views.read'); b.setAttribute('aria-label', b.dataset.tip); b.querySelector('use').setAttribute('href', reading ? '#i-read-off' : '#i-read'); }
  });
};
// Взялись за кино (проектор, коробки, экран, вид «к киноуголку») — Esc больше не уводит к столу; другой вид — снова уводит.
let atCinema = false;
function goView(name, snap) { const v = VIEWS[name](); aimAt(v.pos, v.at, snap); viewOn(name); atCinema = name === 'nook'; }
// Клавиша «читать книгу» — режим чтения (ниже); любая другая клавиша вида сперва выводит из него.
if (!NOOK) { document.querySelector('#views [data-v="nook"]')?.remove(); document.querySelector('li:has(use[href="#i-nook"])')?.remove(); }
document.querySelectorAll('#views button[data-v]').forEach(b => b.onclick = () => {
  b.blur();
  if (b.dataset.v === 'read') return reading ? exitRead() : enterRead();
  if (reading) return exitRead(() => goView(b.dataset.v));
  if (state === 'idle' || (state === 'typing' && tw)) goView(b.dataset.v);
});
// Машинка целиком: сверху-спереди, видно и строку, и все клавиши. Считается по тому, куда машинку поставили.
function typeView() {
  const k = TW_WIDTH / 4.6, r = twM.rot.t, R = station.rotation.y + r;
  const P = station.localToWorld(tw.printAt.clone().multiplyScalar(k).applyAxisAngle(Y, r).add(new THREE.Vector3(twM.x.t, deskTop, twM.z.t)));
  return { pos: P.clone().add(new THREE.Vector3(0, TYPE_VIEW.pos[1] * k, TYPE_VIEW.pos[2] * k).applyAxisAngle(Y, R)), at: P.clone().add(new THREE.Vector3(0, TYPE_VIEW.at[1] * k, TYPE_VIEW.at[2] * k).applyAxisAngle(Y, R)) };
}
const TYPE_VIEW = { pos: [0, 4.75, 6.1], at: [0, -.75, .6] };
const forward = () => dir.set(-Math.sin(yaw.v) * Math.cos(pitch.v), Math.sin(pitch.v), -Math.cos(yaw.v) * Math.cos(pitch.v)).clone();
// Шаг: куда можно — туда целиком; упёрся — скользит вдоль преграды (по каждой оси отдельно). Застрял в твёрдом — выпускает.
// Длинный шаг делится на кусочки по 10 см: тоньше преград (30 см) — сквозь балюстраду не проскочить и на долгом кадре.
const stepEye = d => {
  const from = eyeGoal.clone(), to = keepEye(from.clone().add(d));
  if (standable(...to.toArray()) || !standable(...from.toArray())) eyeGoal.copy(to);
  else for (const a of ['y', 'x', 'z']) { const t = eyeGoal.clone(); t[a] += d[a]; keepEye(t); if (standable(...t.toArray())) eyeGoal.copy(t); }
};
const moveEye = (d, snapNow = false) => {
  const n = Math.max(1, Math.ceil(d.length() / .1)), part = d.clone().divideScalar(n);
  for (let i = 0; i < n; i++) stepEye(part);
  if (snapNow) eye.copy(eyeGoal); viewOn(null);
};
// Колесо и щипок — шаг вперёд и назад, туда, куда смотришь. Пока держишь предмет — колесо его поворачивает.
// Страницу увеличили щипком (так бывало над поднятым плеером YouTube: жесты в нём — его, зал их не гасит) — щипок обратно отдаётся браузеру, иначе
// зал, который гасит все щипки, не давал бы вернуть масштаб (а Chrome помнит его и после перезагрузки). Пока страница увеличена, плеер не поднимается.
const pageZoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;
window.visualViewport?.addEventListener('resize', () => { if (pageZoomed()) { cinema?.lift(false); hintNow(t('hint.zoom.pinched')); } });
addEventListener('wheel', e => {
  if (e.ctrlKey && pageZoomed()) return;
  if (e.ctrlKey) e.preventDefault();
  if (state === 'loading' || e.target !== renderer.domElement) return;
  // Колесо над залом — всегда наше: иначе жест двумя пальцами вбок листает историю браузера.
  e.preventDefault();
  // Пошли по залу — полоска с бегунком закрывается: пока она открыта, стрелки двигают бегунок, а не взгляд.
  closeSliders();
  if (reading) { if (!drag) readWheel(e); return; }
  if (drag?.kind === 'chair') { const by = e.deltaY * .0025; chairs.turn(drag.i, by); if (drag.tow) drag.tow.rot += by; drag.turned = true; chairMoved(); return; }
  // Несомую над всем вещь колесо просто поворачивает (за ней идёт `carryStep`); пока её не подняли — как раньше.
  if (drag?.carry?.on) { const by = e.deltaY * .0025; if (drag.tow) drag.tow.rot += by; springsOf(drag.carry.T)[2].t += by; return; }
  if (drag?.kind === 'book') { steerBook(drag.thing, drag.thing.x.t, drag.thing.z.t, drag.thing.rot.t + e.deltaY * .0025); return; }
  if (drag?.mover) {
    const by = e.deltaY * .0025;
    if (drag.weight) { if (drag.tow) drag.tow.rot += by; steerWeight(weightM.x.t, weightM.z.t, weightM.rot.t + by); } else if (drag.tw) turnBody(drag.mover, by); else drag.mover.rot.t += by;
    return;
  }
  if (drag?.item) {
    const it = drag.item, s = it.pr;
    // Папка на столе крутится, упираясь в машинку и лампу (steerFolder), лист и всё над ящиком — просто.
    if (!(it instanceof Sheet) && !overDrawer && !it.dd) { if (it instanceof BookThing) steerBook(it, it.x.t, it.z.t, s.t + e.deltaY * .0025); else steerFolder(it, it.px.t, it.pz.t, s.t + e.deltaY * .0025, drag.rel); } else s.t += e.deltaY * .0025;
    // В ящике — ровно вдоль стенок (прямо или боком, как его берёт ящик).
    if (drag.item && overDrawer) { const b = drag.dgate?.b ?? 0; s.t = b + clamp(s.t - b, -.03, .03); }
    return;
  }
  const line = e.deltaMode === 1 ? 16 : 1;
  // Щипок на тачпаде (Chrome шлёт его колесом с Ctrl) — ближе к тому, что под пальцами, и дальше.
  if (e.ctrlKey) return zoomAt(e.clientX, e.clientY, clamp(-e.deltaY * line * .011, -.6, .6));
  // Два пальца на тачпаде: вверх-вниз — шаг вперёд и назад, вбок — шаг в сторону.
  const f = forward(), r = new THREE.Vector3().crossVectors(f, Y).normalize();
  stride(f.multiplyScalar(-clamp(e.deltaY * line, -160, 160) * .0008).addScaledVector(r, clamp(e.deltaX * line, -160, 160) * .0008));
}, { passive: false });
// Докуда видно через точку экрана: стол и то, что на нём, полы, стены. Зал — плоскостями, без перебора его мешей.
// Балюстрада взгляду не преграда: между балясинами виден зал — цель там, за ней.
const ROOM = new THREE.Box3(new THREE.Vector3(-HALL.w / 2 + .75, -HALL.depth, RAIL_Z - HALL.len + .75), new THREE.Vector3(HALL.w / 2 - .75, HALL.top + 6.6, RAIL_Z + GAL));
const zray = new THREE.Raycaster();
function reach(o, d) {
  let t = Infinity;
  for (const a of ['x', 'y', 'z']) if (Math.abs(d[a]) > 1e-6) t = Math.min(t, ((d[a] > 0 ? ROOM.max[a] : ROOM.min[a]) - o[a]) / d[a]);
  // Пол галерей — до балюстрады.
  if (d.y < 0 && o.y > 0) { const s = -o.y / d.y; if (o.z + d.z * s > RAIL_Z || o.z + d.z * s < SIDE.far || Math.abs(o.x + d.x * s) > SIDE.rail) t = Math.min(t, s); }
  zray.set(o, d); zray.far = Math.max(t, .01);
  const solids = [deskBody, tw?.group, lamp?.group, ...drawers.map(dr => dr.group), ...folders.map(f => f.b.group)].filter(Boolean);
  for (const h of zray.intersectObjects(solids, true)) if (!h.object.userData.proxy && shown(h.object)) { t = Math.min(t, h.distance); break; }
  return Math.max(t, .01);
}
// Сколько можно пройти от o вдоль d и не выйти туда, куда взгляду нельзя: шагами по 5 см, у края — точнее.
function inBounds(o, d) {
  const ok = t => standable(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  if (!ok(0)) return 0;
  let t = 0;
  while (t < 40 && ok(t + .05)) t += .05;
  let hi = t + .05; for (let i = 0; i < 6; i++) { const m = (t + hi) / 2; if (ok(m)) t = m; else hi = m; }
  return t;
}
// Ближе и дальше — к точке под пальцами, долей расстояния до неё: у стола шаг мелкий, через зал — большой.
// Цель — то, что под пальцами сейчас; идём к ней оттуда, куда взгляд уже направляется. k > 0 — ближе: расстояние делится на e^k.
function zoomAt(x, y, k) {
  if (state === 'loading') return;
  setRay({ clientX: x, clientY: y });
  const d0 = ray.ray.direction.clone(), P = ray.ray.at(reach(camera.position, d0), new THREE.Vector3());
  const to = P.sub(eyeGoal), D = to.length(); if (D < 1e-3) return;
  to.divideScalar(D);
  // Объектив сначала возвращается к обычному углу, и только потом взгляд снова идёт.
  if ((k < 0 && fovGoal < FOV) || (k > 0 && fovGoal > FOV)) return lens(k, d0, FOV);
  // Вперёд — не ближе двадцати сантиметров к цели; назад — не больше трёх метров за раз.
  let step = k > 0 ? Math.max(0, Math.min(D * (1 - Math.exp(-k)), D - .2)) : -Math.min(3, Math.max(D, .3) * (Math.exp(-k) - 1));
  if (step < 0) { to.negate(); step = -step; }
  const clear = inBounds(eyeGoal, to), want = k > 0 ? D * (1 - Math.exp(-k)) : step;
  // На пути балюстрада, а цель за ней: она не мешает — взгляд переходит над поручнем (до него, над ним, за него) и идёт дальше.
  const B = eyeGoal.clone().addScaledVector(to, clear + .06), a = clear < step && (k < 0 || D > clear + .5) && railAt(B.x, B.y, B.z);
  if (a && Math.abs(to[a[0]]) > .02) return overRail(...a, to, step);
  const can = Math.min(step, clear);
  moveEye(to.multiplyScalar(can));
  // Дальше идти некуда — дальше работает объектив: ближе — уже, как в бинокль; дальше — шире.
  if (want > 1e-6 && can < want * .5) lens(k * (1 - can / want), d0);
}
// Через балюстраду, что стоит поперёк оси a на отметке mid: вдоль d до её края на высоте над поручнем, потом над ней; всего не дальше шага step.
function overRail(a, mid, d, step) {
  const s = Math.sign(d[a]), y = RAIL_TOP + .06;
  for (const edge of [mid - s * .16, mid + s * .16]) {
    if ((edge - eyeGoal[a]) * s <= 0) continue;
    const leg = d.clone().multiplyScalar((edge - eyeGoal[a]) / d[a]); leg.y = Math.max(leg.y, y - eyeGoal.y);
    const L = leg.length(), go = Math.min(L, step);
    moveEye(leg.multiplyScalar(go / L)); step -= go;
    if (step < 1e-4) return;
  }
}
// Шаг колесом или стрелками: упирается в балюстраду — взгляд не проходит сквозь неё, а переходит над поручнем, как и при щипке
// («стрелкам перила не должны мешать»).
function stride(d) {
  const L = d.length(); if (L < 1e-6) return;
  const to = eyeGoal.clone().add(d), a = railAt(to.x, to.y, to.z);
  if (a && Math.abs(d[a[0]]) > .02 * L) overRail(...a, d.clone().divideScalar(L), L); else moveEye(d);
}
// Сменить угол обзора так, чтобы точка под пальцами осталась под пальцами: взгляд чуть поворачивается к ней.
function lens(k, d0, stop) {
  const was = fovGoal;
  fovGoal = clamp(was * Math.exp(-k * .7), 18, 75);
  if (stop !== undefined) fovGoal = k > 0 ? Math.max(stop, fovGoal) : Math.min(stop, fovGoal);
  const r = Math.tan(fovGoal * Math.PI / 360) / Math.tan(was * Math.PI / 360), turn = a => a - Math.atan(Math.tan(a) * r);
  const y = Math.atan2(-d0.x, -d0.z), p = Math.asin(clamp(d0.y, -1, 1));
  yaw.t += turn(THREE.MathUtils.euclideanModulo(y - yaw.t + Math.PI, Math.PI * 2) - Math.PI); pitch.t = clamp(pitch.t + turn(p - pitch.t), -1.35, .9);
}
// Safari на Mac присылает щипок не колесом, а жестом: тоже ближе и дальше, а не масштаб страницы.
let gestureScale = 1, gestureAt = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('gesturestart', e => { e.preventDefault(); gestureScale = e.scale || 1; if (e.clientX != null) gestureAt = { x: e.clientX, y: e.clientY }; });
addEventListener('gesturechange', e => {
  // На iPhone и iPad щипок приходит ещё и касаниями — его уже ведёт обработчик пальцев.
  e.preventDefault(); if (state === 'loading' || touches.size) return;
  const k = (e.scale || 1) / gestureScale; gestureScale = e.scale || 1;
  if (reading) return readZoomBy(k);
  zoomAt(gestureAt.x, gestureAt.y, Math.log(k) * 1.6);
});
addEventListener('gestureend', e => e.preventDefault());
// Стрелки — пройтись куда угодно: ↑↓ вперёд-назад, ←→ вбок; с Shift ←→ — повернуться, ↑↓ — выше и ниже (над балюстрадой — в зал и вниз).
// Чем дольше держать, тем быстрее: шаг до 4 м/с — через весь зал секунд за десять; поворот до полуоборота в секунду.
const keys = new Set();
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
addEventListener('keyup', e => { keys.delete(e.code); keys.shift = e.shiftKey; if (e.key === 'Meta') keys.clear(); });
// Пока зажат Cmd, macOS не сообщает, что другую клавишу отпустили: стрелка «залипла» бы и вела взгляд сама
// (а встречная ей — гасилась бы). С Cmd шаг просто останавливается.
addEventListener('keydown', e => { keys.shift = e.shiftKey; if (e.metaKey) keys.clear(); });
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => keys.clear());
let walkT = 0, walkShift = false;
function walk(dt) {
  // Стрелки ходят всегда, и когда в машинке лист (ей они не нужны): раньше за машинкой они молчали, а взгляд и щипок
  // слушались — «перестаёт работать навигация стрелками» (2026-11-15).
  if (reading) { walkT = 0; return readLevel(dt); }
  if (!keys.size || state === 'loading') { walkT = 0; return; }
  // Сменился режим (поворот с Shift ↔ шаг) — разгон заново.
  if (walkShift !== !!keys.shift) { walkShift = !!keys.shift; walkT = 0; }
  walkT += dt;
  const f = forward().setY(0).normalize(), r = new THREE.Vector3().crossVectors(f, Y), up = keys.has('ArrowUp') - keys.has('ArrowDown'), side = keys.has('ArrowRight') - keys.has('ArrowLeft');
  const ramp = THREE.MathUtils.smoothstep(walkT, .4, 2.4), v = (.9 + 3.1 * ramp) * dt, d = new THREE.Vector3();
  if (keys.shift) { d.y = up * (.9 + 1.8 * ramp) * dt; yaw.t -= side * (1.6 + 1.6 * ramp) * dt; } else d.addScaledVector(f, up * v).addScaledVector(r, side * v);
  if (d.lengthSq()) stride(d);
}

// ——— Печать ———
// Машинка создаётся в своём размере (внутри у неё свои мерки) и уменьшается до настоящих 43 см.
const TW_WIDTH = .43;
let typedCount = 0, viewBefore = null, beginT = 0;
function beginTyping() {
  if (!tw || state !== 'idle') return;
  state = 'typing'; document.body.classList.add('typing'); typeRef = 0; typeAwayT = 0; typeKeep = false;
  viewBefore = { pos: eyeGoal.clone(), yaw: yaw.t, pitch: pitch.t, fov: fovGoal };
  goView('type'); $('typeTools').style.display = 'flex'; reveal($('typeTools'), 8000);
  hint(t(tw.loaded ? 'hint.typing.loaded' : 'hint.typing.start'), 8000);
  typedCount = 0; sound.wake?.(); sfx.wake();
  // Лист уже в каретке — печатаем сразу, с того же места; иначе чистый заправляется, пока взгляд подходит.
  if (tw.loaded) tw.begin(leaveTyping, dropSheet);
  else beginT = setTimeout(() => { if (state === 'typing') tw.begin(leaveTyping, dropSheet); }, 900);
}
// Esc раньше, чем лист заправился, — просто вернуться к столу.
function cancelTyping() {
  const keep = typeKeep; typeKeep = false;
  clearTimeout(beginT); state = 'idle'; document.body.classList.remove('typing'); $('typeTools').style.display = 'none';
  if (viewBefore && !keep) { eyeGoal.copy(viewBefore.pos); yaw.t = viewBefore.yaw; pitch.t = viewBefore.pitch; fovGoal = viewBefore.fov; }
}
// Отошли от машинки (пользователь 2026-11-21: «отошли довольно далеко, значит вышли из режима печати») — печать кончается сама, взгляд остаётся, где он есть, лист — в каретке,
// и зал снова слушается. Мера, как у книги, — строка на листе в каретке на экране, но не порог в пикселях: в виде печати строка машинописи (12 пт) — около 12 физ. пикс. на экране 2×
// и 6 на 1×, рядом с порогом книги (LINE_MIN), и печать гасла бы от лёгкого отдаления. Поэтому — относительно вида печати: строка стала вдвое мельче, чем когда взгляд подошёл
// к машинке (`typeRef`, после прихода взгляда), или лист ушёл из кадра; не короче 0,3 с.
// Так же печать кончается, когда берут лист, папку или книгу (`typeLetGo`): раньше в печати их было не взять — «бумажки даже никуда не отложить».
const TYPE_LINE = .00423, TYPE_AWAY = .5;   // строка машинописи (12 пт, шесть строк на дюйм), м; во сколько раз мельче вида печати — «отошли»
let typeRef = 0, typeAwayT = 0, typeKeep = false;
function typeLine() {
  const p = tw.group.localToWorld(pa.copy(tw.printAt)), d = p.distanceTo(camera.position); pb.copy(p).project(camera);
  if (pb.z > 1 || Math.abs(pb.x) > 1 || Math.abs(pb.y) > 1) return 0;
  return TYPE_LINE / (2 * d * Math.tan(camera.fov * Math.PI / 360)) * innerHeight * (window.devicePixelRatio || 1);
}
function typeWatch(dt) {
  const px = typeLine();
  if (!typeRef) { if (camera.position.distanceTo(eyeGoal) < .005 && px > 0) typeRef = px; return; }
  if (px >= TYPE_AWAY * typeRef) { typeAwayT = 0; return; }
  if ((typeAwayT += dt) > .3) typeLetGo();
}
function typeLetGo() {
  if (state !== 'typing') return;
  typeKeep = true; if (tw?.active) tw.leave(); else cancelTyping();
}
// Вынутые листы ложатся аккуратной стопкой справа от машинки, новый — сверху.
function dropSheet(img, lines, fmt, seed) {
  typedCount++;
  const off = new THREE.Vector3(.34, 0, .06).applyAxisAngle(Y, twM.rot.t);
  const [x, z] = keepOnDesk(twM.x.t + off.x + (Math.random() - .5) * .006, twM.z.t + off.z + (Math.random() - .5) * .006, .1, .14, .1);
  const s = addSheet({ id: nextId++, lines, fmt, seed, x, z, rot: twM.rot.t - .06 + (Math.random() - .5) * .05 }, img);
  // Справа может лежать раскрытая папка, книга, пресс-папье — лист ложится рядом с ними, как опущенный рукой (`landSpot`), а не под их страницы (пользователь 2026-11-21: «утопает»).
  const [lx, lz] = landSpot(s, { x, z }); s.px.set(lx); s.pz.set(lz);
  s.lift.set(.25); s.lift.t = 0; save(); return s;
}
// Отошли от машинки (Esc): взгляд возвращается и зал снова слушается; лист остаётся в каретке — с текстом, каретка там же, где стояла.
function leaveTyping() {
  $('typeTools').style.display = 'none'; document.body.classList.remove('typing'); renderer.domElement.style.cursor = '';
  state = 'idle'; twBusyUntil = performance.now() + 1800; const keep = typeKeep; typeKeep = false;
  if (viewBefore && !keep) { eyeGoal.copy(viewBefore.pos); yaw.t = viewBefore.yaw; pitch.t = viewBefore.pitch; fovGoal = viewBefore.fov; }
  draft = tw.draft; saveNow();
  if (draft) hint(t('hint.typing.left'), 6000);
}
// Клавиша с галочкой: лист вынимается и ложится на стол справа, взгляд остаётся у машинки, в каретке — чистый лист.
function takeOutSheet() {
  const out = tw.eject({ refill: true });
  if (!out) return hint(t('hint.sheet.empty'), 3000);
  dropSheet(out.img, out.lines, out.fmt, out.seed); saveNow(); twBusyUntil = performance.now() + 1800;
  hint(typedCount > 1 ? t('hint.typing.sheetsDown') : t('hint.typing.sheetDown'), 6000);
}
$('doneBtn').onclick = () => { $('doneBtn').blur(); if (tw?.active) takeOutSheet(); else if (state === 'typing') cancelTyping(); };
// У клавиши подпись (всплывает при наведении) и знак меняются вместе с состоянием.
const tip = (b, t) => { b.dataset.tip = t; b.setAttribute('aria-label', t); };
const setSound = on => {
  sound.on = sfx.on = on;
  for (const id of ['soundBtn', 'soundRoomBtn']) { const b = $(id); tip(b, on ? t('tools.soundOn') : t('tools.soundOff')); b.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute'); }
};
$('soundBtn').onclick = $('soundRoomBtn').onclick = e => { e.currentTarget.blur(); setSound(!sound.on); };
const showFace = () => { const book = typeFace === 'book'; tip($('faceBtn'), book ? t('type.faceBook') : t('type.faceTypewriter')); $('faceBtn').querySelector('.glyph').classList.toggle('book', book); };
$('faceBtn').onclick = async () => {
  typeFace = typeFace === 'book' ? 'mono' : 'book'; showFace(); $('faceBtn').blur(); save();
  if (typeFace === 'book') await document.fonts.load(`400 ${BOOK.px}px "${BOOK.family}"`, 'АаЙйЁё').catch(() => {});
  if (tw) tw.face = typeFace;
};
setInterval(() => { if (tw?.active) saveNow(); }, 4000);

// ——— Клавиши прячутся: проступают, когда к ним подходит указатель; на телефоне первое касание их только показывает ———
const bars = ['views', 'tools', 'typeTools', 'readTools', 'bookBar', 'standKeys'].map($);
// Видна — пока рядом указатель, пока не вышло время после показа, а открытая полоска с бегунком держит видимыми свои клавиши.
const settle = b => b.classList.toggle('near', b.hover || performance.now() < (b.until || 0) || sliders.some(s => s.open() && b.contains(s.from)));
function reveal(b, ms = 4000) { b.until = performance.now() + ms; settle(b); setTimeout(() => settle(b), ms + 30); }
const revealAll = ms => bars.forEach(b => reveal(b, ms));
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || drag) return;
  const rs = bars.map(b => b.getBoundingClientRect());
  bars.forEach((b, i) => { const r = rs[i]; b.hover = r.width > 0 && Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom)) < 110; settle(b); });
});
addEventListener('mouseout', e => { if (!e.relatedTarget) for (const b of bars) { b.hover = false; settle(b); } });
for (const b of bars) {
  b.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; b.swallow = !b.classList.contains('near'); reveal(b); }, true);
  b.addEventListener('click', e => { if (b.swallow) { b.swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
}

// Сенсорный экран: наведения нет, поэтому подпись клавиши показывает долгое касание (около полсекунды); нажатия при этом нет.
{
  let t = 0, held = null;
  addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return; const k = e.target.closest?.('.key[data-tip]'); if (!k) return;
    clearTimeout(t); t = setTimeout(() => { k.classList.add('tipping'); held = k; setTimeout(() => { k.classList.remove('tipping'); if (held === k) held = null; }, 2500); }, 450);
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => clearTimeout(t), true);
  addEventListener('click', e => { if (held && e.target.closest?.('.key') === held) { held = null; e.preventDefault(); e.stopPropagation(); } }, true);
}

// ——— Полоски с бегунком под клавишей: свет в зале и густота краски ———
const sliders = [];
function slider(panel, keys, get, set) {
  const p = $(panel), range = p.querySelector('input'), s = { p, keys: keys.map($), from: null, open: () => !p.hidden };
  s.show = (on, key = s.from, keepFocus = false) => {
    if (!on && p.contains(document.activeElement)) document.activeElement.blur();
    p.hidden = !on;
    for (const k of s.keys) { k.classList.toggle('on', on && k === key); k.setAttribute('aria-expanded', on && k === key); }
    if (!on) { if (s.from) reveal(s.from.closest('.bar'), 1500); return; }
    s.from = key; range.value = Math.round(get() * 100);
    // Под клавишей наверху, над клавишей внизу.
    const r = key.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    p.style.top = (r.top < innerHeight / 2 ? r.bottom + 14 : r.top - 14 - h) + 'px'; p.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px';
    if (!keepFocus) range.focus({ preventScroll: true });
  };
  for (const k of s.keys) k.onclick = e => { e.currentTarget.blur(); const again = s.open() && s.from === k; for (const o of sliders) o.show(false); showPick(false); s.show(!again, k); };
  range.oninput = () => { set(range.value / 100); save(); };
  sliders.push(s); return s;
}
slider('lightPanel', ['lightBtn', 'lightReadBtn'], () => lightLevel, v => { lightLevel = v; setLight(v); });
// Густота краски — только у машинки, в режиме печати (пользователь 2026-11-21); в ряду клавиш зала её нет.
slider('inkPanel', ['inkBtn'], () => inkLevel, v => { inkLevel = v; setInk(v); });
const openSlider = () => sliders.find(s => s.open());
const closeSliders = () => { for (const s of sliders) if (s.open()) s.show(false); showPick(false); };
addEventListener('resize', () => openSlider()?.show(true, undefined, true));
// Выбор фигурки у самого пресс-папье: нажали на него без сдвига — внизу три кнопки. Закрывается через 3 с после выбора, по Esc, по нажатию мимо и сама
// через 8 с; пока над ней указатель — остаётся (после ухода — ещё 3 с). Другие полоски (свет, краска) её закрывают, она их — тоже.
const weightPick = $('weightPick'); let pickT = 0, pickHover = false;
const markPick = () => { for (const b of weightPick.children) b.classList.toggle('on', b.dataset.k === decor.weight); };
const armPick = ms => { clearTimeout(pickT); pickT = setTimeout(() => { if (!pickHover) showPick(false); }, ms); };
function showPick(on) {
  if (on) { for (const s of sliders) if (s.open()) s.show(false); markPick(); armPick(8000); } else { clearTimeout(pickT); pickHover = false; }
  weightPick.hidden = !on;
}
for (const k of ['mouse', 'terrier', 'donkey']) {
  const b = document.createElement('button'); b.textContent = FIGURES[k].title; b.dataset.k = k;
  b.onclick = () => { b.blur(); chooseWeight(k); armPick(3000); };
  weightPick.append(b);
}
weightPick.addEventListener('pointerenter', () => { pickHover = true; clearTimeout(pickT); });
weightPick.addEventListener('pointerleave', () => { pickHover = false; armPick(3000); });
// Звук видео на экране, который браузер не дал включить при запуске, включается любым нажатием (`unlockSound`).
addEventListener('pointerdown', () => cinema?.unlockSound(), true);
addEventListener('pointerdown', e => { if (!weightPick.hidden && !e.target.closest('#weightPick')) showPick(false); }, true);
addEventListener('pointerdown', e => { const s = openSlider(); if (s && !e.target.closest('.slider') && !s.keys.includes(e.target.closest('.key'))) s.show(false); }, true);

// ——— Памятка по управлению: сама открывается при первом входе, потом — по кнопке ———
const HELP_KEY = 'reading-room-help';
const touchFirst = matchMedia('(pointer: coarse)').matches;
for (const dd of document.querySelectorAll('#help [data-mouse]')) dd.textContent = touchFirst ? dd.dataset.touch : dd.dataset.mouse;
const helpOpen = () => !$('help').hidden;
function showHelp(on) { if (on) closeSliders(); $('help').hidden = !on; if (!on) { revealAll(4000); try { localStorage.setItem(HELP_KEY, '1'); } catch {} } }
$('helpBtn').onclick = e => { e.currentTarget.blur(); showHelp(true); };
$('helpClose').onclick = () => showHelp(false);
$('help').addEventListener('pointerdown', e => { if (e.target === $('help')) showHelp(false); });

// ——— Убранство: росписи куполков, скульптура, пресс-папье, бумага книги — кому что по душе ———
const applyGlass = () => { ceiling?.setGlass({ side: glassOf(false), fan: glassOf(true), sideGain: GLASS.sideGain, fanGain: GLASS.fanGain }); sunThroughGlass(); };
const decorOpen = () => !$('decor').hidden;
// Кнопки вариантов заводятся один раз; выбор только переставляет ободок — фокус остаётся на нажатой.
const DECOR_ROWS = [['decorArt', ART_SETS, 'art'], ['decorSculpt', SCULPTS, 'sculpt'], ['decorWeight', FIGURES, 'weight'], ['decorPaper', BOOK_PAPER, 'bookPaper']];
const markDecor = () => { for (const [id, , key] of DECOR_ROWS) for (const b of $(id).children) b.classList.toggle('on', b.dataset.k === decor[key]); };
let shownArt = null, shownSaved = null;
async function chooseArt(k) {
  // Тот же набор — только если он и правда в куполках (а не небо вместо незагрузившихся картин).
  if (k === decor.art && shownArt === k) return;
  const was = decor.art, wasSaved = savedArt; decor.art = savedArt = k; markDecor(); save();
  // Картины набора грузятся, когда его выбрали; пока грузятся — в куполках прежние. Не загрузились — выбор возвращается.
  const set = await loadSet(k, 0);
  if (decor.art !== k || shownArt === k) return;
  // Не загрузились — назад к тому, что сейчас в куполках (а если там ещё небо — к прежнему выбору).
  if (!set) { decor.art = shownArt ?? was; savedArt = shownSaved ?? wasSaved; markDecor(); save(); hint(t('hint.art.fail'), 5000); return; }
  ceiling.setArt(set); shownArt = k; shownSaved = savedArt; shadowDirty = true;
}
// Бумага книги: «старая» — страница печатается на нашей бумаге, «как в файле» — цвета файла как есть (белое остаётся белым).
const chooseBookPaper = k => { decor.bookPaper = k; markDecor(); for (const b of books) b.book.setPaperMode(k === 'file'); shadowDirty = true; save(); };
// Тон дерева — цвет материалов: обшивка, перила и столы, фриз (с ними), карниз на своде; и паркет галерей и зала.
function tintWood() {
  woodMats.panel?.color.copy(woodTint(WOOD_TONE)); woodMats.behind?.color.copy(woodMats.panel.color); woodMats.rail?.color.copy(woodTint(WOOD_TONE, 1.31)); woodMats.frieze?.color.copy(woodTint(WOOD_TONE, 1.31));
  if (woodMats.rail) ceiling?.setWoodTone(woodMats.rail.color);
  for (const m of woodMats.extra ?? []) m.color.copy(woodMats.rail.color);
  woodMats.floor?.color.copy(floorTint(FLOOR_TONE)); woodMats.hall?.color.copy(floorTint(FLOOR_TONE, .9));
}
function showDecor(on) {
  if (on) {
    closeSliders();
    for (const [id, list, key] of DECOR_ROWS) if (!$(id).children.length) $(id).append(...Object.entries(list).map(([k, v]) => {
      const b = document.createElement('button'); b.textContent = v.title; b.dataset.k = k; b.onclick = () => (key === 'art' ? chooseArt(k) : key === 'sculpt' ? chooseSculpt(k) : key === 'weight' ? chooseWeight(k) : chooseBookPaper(k)); return b;
    }));
    if (!$('decorLang').children.length) $('decorLang').append(...LANGS.map(([code, name]) => { const b = document.createElement('button'); b.textContent = name; b.dataset.k = code; b.classList.toggle('on', code === lang); b.onclick = () => setLang(code); return b; }));
    markDecor(); $('chairsBack').disabled = !(chairs && (chairs.touched || stored.hallChairs));
  }
  $('decor').hidden = !on; if (!on) revealAll(4000);
}
// Пока зал не собран, выбирать не из чего.
$('decorBtn').onclick = e => { e.currentTarget.blur(); if (ready) showDecor(true); };
$('decorClose').onclick = () => showDecor(false);
// Стулья — как их расставил зал.
$('chairsBack').onclick = () => { if (!chairs) return; chairs.reset(); delete stored.hallChairs; chairShade = 0; chairMoved(); save(); $('chairsBack').disabled = true; };
$('decor').addEventListener('pointerdown', e => { if (e.target === $('decor')) showDecor(false); });

// ——— Авторы и лицензии: тот же CREDITS.md, показанный карточкой (сам файл браузер открыл бы без кодировки) ———
const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const inline = t => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => /^https?:/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${a}</a>` : a)
  // Длинные адреса в карточке — коротко, именем сайта; сам адрес — в ссылке.
  // Знак препинания в конце — уже текст, а не ссылка; запятые и скобки внутри адресов Викисклада остаются.
  .replace(/(^|[\s(])(https?:\/\/(?:[^\s<()]|\([^\s<()]*\))+?)([.,;:]*)(?=$|[\s<)])/g, (m, pre, u, tail) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</a>${tail}`);
function markdown(md) {
  const out = []; let table = null, list = null;
  const flush = () => { if (table) { out.push('<table>' + table.map((r, i) => '<tr>' + r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('') + '</tr>').join('') + '</table>'); table = null; } if (list) { out.push('<ul>' + list.map(l => `<li>${inline(l)}</li>`).join('') + '</ul>'); list = null; } };
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t.startsWith('|')) { if (/^\|[\s|:-]+\|$/.test(t)) continue; (table ??= []).push(t.slice(1, -1).split('|').map(c => c.trim())); continue; }
    if (t.startsWith('- ')) { if (table) flush(); (list ??= []).push(t.slice(2)); continue; }
    flush();
    if (!t) continue;
    const h = t.match(/^(#+)\s+(.*)$/);
    out.push(h ? (h[1].length === 1 ? `<h2>${inline(h[2])}</h2>` : `<h3>${inline(h[2])}</h3>`) : `<p>${inline(t)}</p>`);
  }
  flush(); return out.join('');
}
const aboutOpen = () => !$('about').hidden;
async function showAbout(on) {
  $('about').hidden = !on; if (!on) return;
  // Авторы и лицензии: по-русски — CREDITS.md, на остальных языках — английский CREDITS.en.md (имена, ссылки и лицензии те же); его нет — русский.
  const get = async f => { const r = await fetch(f); if (!r.ok) throw new Error(r.status); return r.text(); };
  try { $('aboutText').innerHTML = markdown(lang === 'ru' ? await get('CREDITS.md') : await get('CREDITS.en.md').catch(() => get('CREDITS.md'))); } catch { $('aboutText').textContent = t('about.loadFail'); }
}
$('aboutLink').onclick = e => { e.preventDefault(); showAbout(true); };
$('aboutClose').onclick = () => showAbout(false);
$('about').addEventListener('pointerdown', e => { if (e.target === $('about')) showAbout(false); });

// ——— Папки ———
$('folderBtn').onclick = () => {
  $('folderBtn').blur();
  if (state !== 'idle') return;
  const n = folders.filter(f => f.drawer === null).length;
  const [x, z] = keepOnDesk(.6 - n * .03, .02 + n * .04, .14, .18);
  const f = addFolder({ id: nextId++, x, z, rot: -.08 });
  // Новая папка — на свободное место (не под другую папку или книгу: там она мерцала и лежала снизу); листы под ней — она ложится поверх них.
  const spot = freeSpotFor(f); if (spot) { f.px.set(spot.x); f.pz.set(spot.z); }
  const F = framedAt(f, f.px.t, f.pz.t, f.pr.t, f.pose), under = sheets.filter(x => x.binder === null && x.drawer === null && hitsSolid({ x: x.px.t, z: x.pz.t, r: x.pr.t, hw: A4.w / 2, hd: A4.h / 2 }, F, -.004));
  if (under.length) f.floor = Math.max(...under.map(x => x.floor)) + .0012;
  f.lift.set(.2); f.lift.t = 0; save();
  hint(t('hint.folder.new'), 5000);
};
const wait = ms => new Promise(ok => setTimeout(ok, ms));
// Середина стопки на половине раскрытой папки (side = 1 — справа, −1 — слева) в осях самой папки и точка в осях стола на расстоянии x вдоль неё.
const halfX = side => BINDER.axis - BINDER.hinge + side * A4.w / 2;
const alongF = (f, x) => [f.px.t + Math.cos(f.pr.t) * x, f.pz.t - Math.sin(f.pr.t) * x];
// Какая половина раскрытой папки под листом: 1 — правая, −1 — левая (закрытая — 0).
const sideOver = (s, f, p = { x: s.px.t, z: s.pz.t }) => f.pose === 'open' ? (f.b.group.worldToLocal(W(p.x, deskTop, p.z)).x < 0 ? -1 : 1) : 0;
// Лист отпустили над папкой. Он ничего не продавливает: из руки опускается сверху на стопку — на правую или левую половину раскрытой папки; закрытая принимает его так:
// лист поднимается над её крышкой, крышка встаёт почти на ребро (`LID`) — лист не должен пройти сквозь неё, — лист опускается на стопку, потом крышка закрывается.
// Листы друг друга ждут (`queue`): порядок — как отпущены.
const LID = 1.6;
function fileInto(s, f) {
  const side = sideOver(s, f);
  s.held = true; s.flat = true; s.low = false; s.lift.v += s.floor - f.floor; s.floor = f.floor; s.carry = null; s.landing = 0; s.tilt.t = 0; s.tilt.k = 200; s.tilt.c = 26;
  f.filing = (f.filing || 0) + 1;
  f.queue = (f.queue || Promise.resolve()).then(() => land(s, f, side)).catch(err => console.error(err)).finally(() => { if (--f.filing === 0) f.b.peek(0, true); });
}
async function land(s, f, side) {
  const b = f.b, spot = (x, up) => { [s.px.t, s.pz.t] = alongF(f, x); s.lift.t = f.floor + up - s.floor; };
  for (const k of [s.px, s.pz]) { k.k = 170; k.c = 26; } s.pr.k = 150; s.pr.c = 24; s.lift.k = 200; s.lift.c = 26;
  s.pr.t += wrapPi(f.pr.t - s.pr.t);
  sfx.play('page', { gain: .5, rate: 1.1 });
  if (side) {
    // Раскрытая: над своей половиной выше стопок, потом вниз на неё.
    spot(halfX(side), Math.max(b.openHeight(-1), b.openHeight(1)) + .03); await wait(170);
    spot(halfX(side), b.openHeight(side) + .0004); await wait(230);
  } else {
    // Закрытая: лист — выше того, докуда дойдёт крышка, чуть в сторону от корешка; крышка поднимается; лист опускается на стопку мимо неё.
    const x = f.pose === 'face' ? .016 : -.016;
    spot(x, b.thickness + BINDER.w + .04); await wait(180);
    b.peek(LID, true); await wait(330);
    spot(0, BINDER.cover + (f.pose === 'face' ? b.nr : b.nl) * BINDER.sheet + .0006); await wait(260);
  }
  shelve(f, s, side);
  s.held = false; s.flat = false; calmSheet(s);
}
// Положить лист в папку: side = 1 — верхним в правую стопку (его сразу видно справа), −1 — верхним в левую, 0 — в конец. Порядок — подряд, без дыр.
function shelve(f, s, side) {
  const b = f.b; b.finishTurn();
  const list = sheetsOf(f.id), at = side ? b.i : list.length;
  list.splice(at, 0, s); list.forEach((x, k) => x.order = k + 1);
  s.binder = f.id; s.drawer = null; if (side < 0) b.i = at + 1;
  s.lift.set(0); s.hide(); b.refresh();
  if (side) ownF = f;
  updateReadCount(); save();
}
// Вынуть верхний лист правой (side = 1) или левой (−1) стопки раскрытой папки: он становится свободным листом (его надо показать и поставить).
function unshelve(f, side) {
  const b = f.b; b.finishTurn();
  const list = sheetsOf(f.id), k = side > 0 ? b.i : b.i - 1, s = list[k]; if (!s) return null;
  list.splice(k, 1); list.forEach((x, j) => x.order = j + 1);
  if (side < 0) b.i -= 1;
  s.binder = null; s.drawer = null; s.show(); b.refresh(); updateReadCount(); save();
  return s;
}

// ——— Убрать папку ———
// Клавиша с корзиной в строке папки спрашивает, что делать с листами: «листы — на стол» (папка уходит, листы ложатся стопкой на её месте; из ящика — стопкой в тот же ящик)
// или «вместе с листами» (насовсем). Папка раскрытая закрывается, потом поднимается над столом и уменьшается до нуля; листы по одному опускаются на её место (первый — сверху).
// Данные меняются сразу после закрытия (`gone` — папка уже не сохраняется, листы свободны и хранят место), остальное — только показ.
let askF = null;
const foAskOpen = () => !$('folderAsk').hidden;
function showFolderAsk(on) {
  const el = $('folderAsk'); if (!on) { el.hidden = true; askF = null; return; }
  const f = ownF; if (!f || f.leaving || !folders.includes(f)) return;
  closeSliders(); askF = f; el.hidden = false;
  const n = f.b.count, ti = f.b.title, many = tn('n.sheets', n);
  $('folderAskTitle').textContent = ti === t('folder.untitled') ? t('folderAsk.title') : t('folderAsk.titleNamed', { name: ti.length > 34 ? ti.slice(0, 33) + '…' : ti });
  $('foAsk2').hidden = !n;
  if (n) {
    $('foAsk1b').textContent = f.drawer !== null ? t('folderAsk.toDrawer') : t('folderAsk.toDesk');
    $('foAsk1s').textContent = f.drawer !== null ? t('folderAsk.toDrawerSub', { many }) : t('folderAsk.toDeskSub', { many });
    $('foAsk2s').textContent = t('folderAsk.withSheetsSub', { many });
  } else { $('foAsk1b').textContent = t('folderAsk.remove'); $('foAsk1s').textContent = t('folderAsk.emptySub'); }
  $('foAsk1').focus({ preventScroll: true });
}
$('folderOut').onclick = e => { e.currentTarget.blur(); if (state === 'idle' && ownF) showFolderAsk(true); };
$('folderAsk').addEventListener('pointerdown', e => { if (e.target === $('folderAsk')) showFolderAsk(false); });
$('foAsk1').onclick = () => { const f = askF; showFolderAsk(false); if (f) removeFolder(f, true); };
$('foAsk2').onclick = () => { const f = askF; showFolderAsk(false); if (f) removeFolder(f, false); };
async function removeFolder(f, keep) {
  if (f.leaving || !folders.includes(f)) return;
  if (f.filing) return hint(t('hint.folder.filing'), 3000);
  if (drag || f.held) return;
  if (f.drawer === null && weightM && baseOf(weightM.x.t, weightM.z.t) === f) return squeeze(f, 'weight');
  f.leaving = true; f.held = true;   // для остальных вещей её уже нет: не преграда, не берётся
  if (ownF === f) { ownF = null; syncBar(); }
  if (hov === f) hov = null; if (ride?.f === f) ride = null;
  const list = sheetsOf(f.id), n = list.length, inDrawer = f.drawer !== null;
  if (f.pose === 'open') { f.go('face'); sfx.play('page', { gain: .5, rate: .8 }); await wait(480); }
  // Данные: листы свободны и хранят место (на столе — там, где лежала папка), папки в списке сохранения больше нет.
  const r = f.pr.t; if (n && keep && !inDrawer) list[0].pr.t = r;
  const spot = n && keep && !inDrawer ? landSpot(list[0], { x: f.px.t, z: f.pz.t }) : null;
  const order = list.slice().reverse();   // нижний — последний лист: первый ляжет сверху
  if (keep) {
    for (const s of order) {
      const j = Math.sin(s.id * 12.9898) * 43758.5453 % 1, k = Math.sin(s.id * 78.233) * 12345.6789 % 1;
      s.binder = null;
      if (inDrawer) { s.drawer = f.drawer; s.dx = f.dx + j * .002; s.dz = f.dz + k * .002; liftToTop(s); s.pr.set(r + j * .008); }
      else { s.drawer = null; s.floor = deskTop + .002; liftToTop(s); s.px.set(spot[0] + j * .003); s.pz.set(spot[1] + k * .003); s.pr.set(r + k * .012); s.lift.set(.06); }
    }
  } else {
    for (const s of list) { const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1); s.hide(); }
  }
  f.gone = true; saveNow();
  // Показ: папка поднимается; листы опускаются по одному на её место.
  const step = Math.min(80, 600 / Math.max(1, n));
  f.lift.k = 120; f.lift.c = 13; f.lift.t = .18; f.sz = new Spring(1, 200, 22); sfx.play('page', { gain: .45, rate: 1.15 });
  if (keep) for (let i = 0; i < order.length; i++) {
    await wait(i ? step : 60); const s = order[i]; if (!sheets.includes(s)) continue;
    s.show(); if (!inDrawer) landSheet(s, s.px.t, s.pz.t); else s.lift.set(0);
    if (i < 5) sfx.play('page', { gain: .22, rate: 1 + i * .03 });
    if (i === 0) setTimeout(() => { f.sz.t = 0; }, 260);
  } else { await wait(260); f.sz.t = 0; }
  if (f.sz.t) f.sz.t = 0;
  await wait(380);
  // Папка совсем ушла: сетки, обрез и ляссе освобождаются.
  const i = folders.indexOf(f); if (i >= 0) folders.splice(i, 1);
  station.remove(f.b.group); f.b.dispose();
  restack(); lightMasks(); shadowDirty = true; saveNow();
  hint(keep ? (n ? t(inDrawer ? 'hint.folder.goneDrawer' : 'hint.folder.goneDesk', { many: tn('n.sheets', n) }) : t('hint.folder.gone')) : t('hint.folder.deleted', { many: tn('n.sheets', n) }), 5000);
}

// ——— Взгляд подходит к вещи ———
// Папка и лист не переключают зал в особый режим: взгляд просто подходит сверху на расстояние, с которого вещь видна целиком, её верх — вверх кадра.
// Esc возвращает прежний вид (тот, что был до первого подхода); пошли куда-то сами — возвращать уже нечего (`viewOn`).
const fitDist = (w, min) => Math.max(min, w / 2 / Math.tan(Math.atan(Math.tan(FOV * Math.PI / 360) * camera.aspect)) * 1.15);
function approach(key, c, rot, width, min) {
  if (lookBack?.key === key && lookBack.c.distanceTo(c) < .02 && eyeGoal.distanceTo(lookBack.to) < .08) return;
  const before = lookBack?.before || { pos: eyeGoal.clone(), yaw: yaw.t, pitch: pitch.t, fov: fovGoal };
  const d = fitDist(width, min), o = new THREE.Vector3(0, d * .85, d * .55).applyAxisAngle(Y, rot);
  aimAt(W(c.x + o.x, c.y + o.y, c.z + o.z), W(c.x, c.y, c.z)); viewOn(null);
  lookBack = { before, key, c: c.clone(), to: eyeGoal.clone() };
}
function lookBackNow() {
  const b = lookBack.before; lookBack = null;
  eyeGoal.copy(b.pos); yaw.t = b.yaw; pitch.t = b.pitch; fovGoal = b.fov;
}
// Закрытая папка целиком в кадре, обложка читается (нажали на ярлык издалека): папка остаётся закрытой.
const lookAtCover = f => approach(f, new THREE.Vector3(f.px.t, deskTop, f.pz.t), f.pr.t, BINDER.w + .1, .34);
const lookAtSheet = s => approach(s, new THREE.Vector3(s.px.t, s.floor, s.pz.t), s.pr.t, A4.w + .03, .42);
const lookAtFolder = f => approach(f, new THREE.Vector3(f.px.t, deskTop, f.pz.t).add(new THREE.Vector3(0, 0, -.03).applyAxisAngle(Y, f.pr.t)), f.pr.t, 2 * BINDER.w + .04, .5);
// Взгляд подходит к раскрытой книге так, что разворот занимает почти весь кадр: так её читают за столом (щипок и колесо приближают дальше).
const lookAtBook = b => reading ? readRefit() : approach(b, new THREE.Vector3(b.x.t, deskTop + (b.stand ? .09 : 0), b.z.t), b.rot.t, Math.max(2 * b.book.s.Bw + .12, (BOOK_H + .1) * camera.aspect * .62) * (b.stand ? 1.2 : 1), .3);
// «Книгу читают отсюда» — одно правило для всего: страницы и буквы на экране ещё можно разобрать. Считается по взгляду, куда он идёт (цели `eyeGoal`, `yaw.t`, `pitch.t`, `fovGoal`), а не по тому,
// где он сейчас, — нажали на книгу издалека, и она уже «своя»: нажатие на страницу листает, а не только подводит взгляд. Мера — высота обычной строки на экране в физических пикселях:
// высота страницы на экране (две точки на её середине, верх и низ; наклон и косой взгляд сплющивают её и потому тоже учтены) × доля строки в странице × devicePixelRatio.
// Доля строки — 0,0135 (основной текст 11 пт на странице А4 или Letter: 11/842 и 11/792). Порог — 9 физических пикселей: меньше — мелкая печать расплывается (проверено глазами на этом зале,
// на экране 2× это 4,5 пикселя CSS). У открытой книги в обычном виде с места за столом после нажатия страница — около 40 пикселей строки на экране 2× и 20 на 1×; раскрытая, но далёкая — меньше порога.
// Режим чтения — всегда «читают». Выход из этого состояния («отошли») — то же, что уход от книги: плашка «Читать книгу?» прячется и забывает «остаться так», стрелки ← → снова двигают взгляд.
const LINE = .0135, LINE_MIN = 9;
const probe = new THREE.PerspectiveCamera(), pq = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
function lineApprox(x, z, rot, len, th = 0) {
  const R = station.rotation.y + rot, sn = Math.sin(R), cs = Math.cos(R), ct = Math.cos(th), st = Math.sin(th);
  const o = th ? bookPlace(th, len + 2 * .003) : { y: .002, z: 0 };
  const c = W(x, deskTop + o.y, z).addScaledVector(pq.set(sn, 0, cs), o.z + 0), h = len / 2;
  const ex = pq.set(sn * ct, -st, cs * ct);   // вдоль страницы к читателю
  pa.copy(c).addScaledVector(ex, h); pb.copy(c).addScaledVector(ex, -h);
  probe.fov = fovGoal; probe.aspect = camera.aspect; probe.near = camera.near; probe.far = camera.far; probe.updateProjectionMatrix();
  probe.position.copy(eyeGoal); const pv = pitch.t, yv = yaw.t;
  probe.lookAt(eyeGoal.x - Math.sin(yv) * Math.cos(pv), eyeGoal.y + Math.sin(pv), eyeGoal.z - Math.cos(yv) * Math.cos(pv)); probe.updateMatrixWorld(true);
  if (pa.clone().applyMatrix4(probe.matrixWorldInverse).z > -.02 || pb.clone().applyMatrix4(probe.matrixWorldInverse).z > -.02) return 0;   // за спиной
  pa.project(probe); pb.project(probe);
  if (Math.abs(pa.x + pb.x) > 2 || Math.abs(pa.y + pb.y) > 2) return 0;   // середина страницы не в кадре: на неё не смотрят
  const px = Math.hypot((pa.x - pb.x) * innerWidth / 2, (pa.y - pb.y) * innerHeight / 2);
  return px * (window.devicePixelRatio || 1) * LINE;
}
const legibleBook = b => !!b && b.book.pose === 'open' && lineApprox(b.x.t, b.z.t, b.rot.t, BOOK_H, b.tilt) >= LINE_MIN;
const nearB = b => !!b && (reading || legibleBook(b));
// Нажали на закрытую книгу (на обрез — leaf: лист, на котором она раскроется): она раскрывается на месте (на запомненном листе), взгляд подходит. Некуда — вздрагивает.
// «Своя» книга — та, которой коснулись: строка внизу, режим чтения и клавиши работают с ней.
function setActive(b) { if (!b || bookM === b) return; bookM = b; bookBarDirty = bookDetailDirty = true; if (reading) readLayers(); save(); }
function unfoldBook(b, leaf = null, quiet = false) {
  // Из ящика книга сперва выходит на стол (как папка: поднимается над краем стола, ящик закрывается).
  if (b.drawer !== null) { const D = b.dr; leaveDrawer(b, () => { D.toggle(false); b.rot.t += wrapPi(BOOK_DEFAULT.rot - b.rot.t); [b.x.t, b.z.t] = keepBook(b, b.book.pose, b.x.t, b.z.t, b.rot.t); unfoldBook(b, leaf, quiet); }); return; }
  setActive(b);
  // Читают одну книгу: остальные раскрытые закрываются (иначе им не хватило бы места на столе).
  const others = books.filter(o => o !== b && o.book.pose === 'open'); for (const o of others) o.go('face');
  if (leaf !== null) b.book.go(leaf, true);
  // Тесно — закрытые книги и папки рядом уезжают на свободные места, а нет и так — она сама сдвигается (`makeRoom`).
  const fit = makeRoom(b, 'open');
  if (!fit) {
    for (const o of others) o.go('open');   // не раскрылась — прежняя книга раскрывается обратно
    b.shudder(); hint(t('hint.book.noRoom'), 6000); sfx.play('page', { gain: .3, rate: .7 }); return false;
  }
  b.go('open', fit);
  // Книга с PDF раскрывается на месте, взгляд не подходит — внизу лишь предложение читать (пользователь 2026-11-21: «не приближать так нагло книгу»); к пустой — подходит: в неё кладут PDF.
  readOwn = 'book'; if (!b.file) lookAtBook(b); bookBarDirty = true; offerRead(b);
  if (!b.file) hint(t('hint.book.empty'), 9000);
  else if (!quiet) try { if (!localStorage.getItem(BOOK_HINT)) { localStorage.setItem(BOOK_HINT, '1'); hint(t('hint.book.pageTip'), 9000); } } catch {}
  save(); return true;
}
const BOOK_HINT = 'reading-room-bookhint';
// Нажали на раскрытую книгу издалека: книга с PDF — только предложение читать, взгляд на месте; пустая или «остаться так» уже сказано — взгляд подходит, как раньше.
function bookFar(bt) { if (bt.file && !bt.stayed && !reading && bt.book.pose === 'open') offerRead(bt); else lookAtBook(bt); }
// Нажали на поле крышки раскрытой книги: она закрывается этой крышкой (левой — лицом вверх, правой — задней крышкой вверх).
function closeBook(b, side) { b.go(side < 0 ? 'face' : 'back'); bookBarDirty = true; save(); if (reading) exitRead(); }
// ——— Режим чтения: только книга и стол, разворот виден целиком, листать — нажатием по половинам экрана ———
// Взгляд стоит над серединой разворота и смотрит почти отвесно (на 1° от отвеса: ровно вниз камера yaw/pitch не держит), верх страниц — вверх экрана;
// угол зрения узкий (боковины толстого блока почти не видны), расстояние подбирается так, чтобы разворот с крышками встал в окно с полем 5 % со всех сторон
// при любом отношении сторон (`readFit`; пересчитывается при смене окна и книги — `readStep`). Колесо и щипок приближают до ×3 к точке под указателем (`readZoomBy`),
// сдвиг вида — только пока крупно и не дальше книги. Всё, кроме книги и стола, не рисуется: слои three.js — у книги, стола и ВСЕХ ламп включён слой 1 (лампы обязательно:
// иначе поменялось бы их число и шейдеры собрались бы заново), камера в режиме смотрит только на слой 1. Тени спрятанных вещей уходят вместе с ними (`shadowDirty`).
// Режим — флаг `reading`, а не значение `state`: десятки обработчиков проверяют `state === 'idle'`. В хранилище он не пишется.
const TILT_PX = 46, TILT_BAND_Z = -BOOK_H / 2 + .035;   // подставка: пикселей на ступень, когда тянут верх книги; верхние 3,5 см страницы — «верхний край» (тянется)
const READ = { markReach: .035, fov: 25, margin: .05, lean: Math.PI / 180, zoom: 3, hint: 'reading-room-readhint', idle: 'reading-room-idlehint', exitCap: 'reading-room-exitcap', stand: { margin: .09, lean: -10 * Math.PI / 180 } };
let swapUntil = 0;   // пока книгу меняют на другую (`addBook`), режим чтения не выключается оттого, что прежняя закрылась
let reading = false, readOnly = false, readBusy = false, readBack = null, readZ = 1, readD0 = .7, readKey0 = '';
const readOrb = { az: 0, del: 0, lift: 0 }, rcam = new THREE.PerspectiveCamera(READ.fov, 1, .02, 10), rv = new THREE.Vector3();
// Что под взглядом: середина раскрытой книги на половине её высоты, оси книги в мире (ex — вдоль разворота, ez — вдоль страницы к читателю, ey — от страницы к взгляду), размеры
// разворота (с крышками) и наибольшая высота блока. Книга на подставке наклонена на `tilt`, и взгляд стоит вдоль её нормали — страницы заполняют окно так же, как у лежащей.
// Считается по целям (`x.t`, `z.t`, `rot.t`), а не по тому, где книга сейчас: пока она ещё едет, вид уже знает, куда смотреть.
// Угол, под которым книга будет лежать, когда доедет (стоит на подставке — по ступени, иначе 0): не тот, что сейчас, пока она едет (`BookThing.tilt`).
const tiltGoal = bt => bt.standing ? Math.PI / 3 + NOTCH[bt.notch - 1].f : 0;
function readGeom() {
  const bt = bookM, bk = bt.book, fp = bk.footprint('open'), R = station.rotation.y + bt.rot.t, th = tiltGoal(bt), top = bk.s.th;
  const sn = Math.sin(R), cs = Math.cos(R), f = new THREE.Vector3(sn, 0, cs), ex = new THREE.Vector3(cs, 0, -sn);
  const ey = Y.clone().multiplyScalar(Math.cos(th)).addScaledVector(f, Math.sin(th)), ez = f.clone().multiplyScalar(Math.cos(th)).addScaledVector(Y, -Math.sin(th));
  const o = th ? bookPlace(th, bk.s.Dz) : { y: .002, z: 0 };
  const c0 = W(bt.x.t, deskTop + o.y, bt.z.t).addScaledVector(f, o.z).addScaledVector(ey, top / 2);
  return { bk, R, th, hw: fp.x1, hd: fp.hd, top, c0, ex, ey, ez, ext: bk.marks.count ? READ.markReach : 0 };
}
// Куда смотрит взгляд: вдоль нормали страницы к книге, на 1° в сторону верха страниц (ровно вниз камера yaw/pitch не держит); верх страниц — вверх экрана.
// На подставке — чуть шире и сверху: вокруг книги видны рама и полочка. Переход от лёжа к подставке плавный по углу (`readMix`): скачок наклона взгляда через отвес разворачивал вид
// на 180° (горизонтальная часть направления взгляда — sin(наклон книги + lean) в сторону верха страниц — на малых углах меняла знак, и камера вертелась вокруг отвеса, см. записи 2026-11-21).
// Книга едет на подставку и обратно секунду, а взгляд смотрит на её конечное положение (`tiltGoal`) и плывёт к нему пружинами: ни разворота вбок, ни погони за каждым кадром.
const readMix = th => { const u = clamp(th / (NOTCH[NOTCHES - 1].deg * Math.PI / 180), 0, 1); return u * u * (3 - 2 * u); };
const readLean = g => READ.lean + (READ.stand.lean - READ.lean) * readMix(g.th), readMargin = g => READ.margin + (READ.stand.margin - READ.margin) * readMix(g.th);
const readDir = g => { const l = readLean(g); return g.ey.clone().multiplyScalar(-Math.cos(l)).addScaledVector(g.ez, -Math.sin(l)); };
// Расстояние до середины разворота, при котором углы разворота (и крышек на столе, и блока сверху) не выходят за поле: считается пробной камерой, пока не сойдётся.
function readFit(g) {
  rcam.aspect = camera.aspect; rcam.fov = READ.fov; rcam.updateProjectionMatrix();
  const dir = readDir(g), pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-g.top / 2, g.top / 2]) pts.push(g.c0.clone().addScaledVector(g.ex, sx * g.hw).addScaledVector(g.ez, sz * (g.hd + (sz > 0 ? g.ext : 0))).addScaledVector(g.ey, y));   // хвосты закладок лежат за нижним обрезом: с ними в поле — на 3,5 см ниже
  let d = .7;
  for (let i = 0; i < 5; i++) {
    rcam.position.copy(g.c0).addScaledVector(dir, -d); rcam.lookAt(rcam.position.clone().add(dir)); rcam.updateMatrixWorld();
    let m = 0; for (const p of pts) { rv.copy(p).project(rcam); m = Math.max(m, Math.abs(rv.x), Math.abs(rv.y)); }
    d *= m / (1 - 2 * readMargin(g));
  }
  return d;
}
// Поставить цель взгляда по приближению и сдвигу; сдвиг не уводит видимое окно за книгу.
// Свобода взгляда при чтении (пользователь 2026-11-21: «камеру не только на зум использовать, но и на смену угла. максимум свободы»; «управление вверх/вниз… как по шифту + стрелке»):
// угол — обход книги вокруг её нормали (`readOrb.az`) и наклон к странице (`del`, от отвеса почти до 10° над ней), тянуть мышью; уровень — Shift + ↑↓ (`lift`, по отвесу, взгляд
// смотрит туда же); сдвига вида нет (убран по её слову). Esc сперва возвращает вид по умолчанию (`readReset`).
const READ_EL = [10 * Math.PI / 180, 89.5 * Math.PI / 180], READ_LIFT = [-.3, .8];
const readMoved = () => Math.abs(readZ - 1) > .001 || readOrb.az || readOrb.del || readOrb.lift;
function readPose() {
  const g = readGeom(), dist = readD0 / readZ;
  let dir = readDir(g);
  if (readOrb.az || readOrb.del) {
    const u = dir.clone().negate(), s0 = clamp(u.dot(g.ey), -1, 1), h = u.clone().addScaledVector(g.ey, -s0);
    if (h.lengthSq() < 1e-8) h.copy(g.ez); h.normalize().applyAxisAngle(g.ey, readOrb.az);
    const el = clamp(Math.asin(s0) + readOrb.del, READ_EL[0], READ_EL[1]); readOrb.del = el - Math.asin(s0);
    dir = g.ey.clone().multiplyScalar(-Math.sin(el)).addScaledVector(h, -Math.cos(el));
  }
  const pos = g.c0.clone().addScaledVector(dir, -dist);
  pos.y = Math.max(pos.y + readOrb.lift, W(0, deskTop, 0).y + .04);   // не ниже столешницы
  aimAt(pos, pos.clone().add(dir)); fovGoal = READ.fov;
}
function readOrbitBy(dx, dy) {
  if (!reading || readBusy) return;
  readOrb.az -= dx * .006; readOrb.del += dy * .006; readPose();
}
// Shift + ↑↓, пока держат: уровень взгляда, всё быстрее (как шаг в зале, `walk`).
let readLvlT = 0;
function readLevel(dt) {
  const up = keys.has('ArrowUp') - keys.has('ArrowDown');
  if (!keys.shift || !up || readBusy) { readLvlT = 0; return; }
  readLvlT += dt; const v = .15 + .45 * THREE.MathUtils.smoothstep(readLvlT, .3, 1.5);
  const l = clamp(readOrb.lift + up * v * dt, READ_LIFT[0], READ_LIFT[1]); if (l !== readOrb.lift) { readOrb.lift = l; readPose(); }
}
function readRefit() { if (!reading || !readOnly || !bookM) return; readD0 = readFit(readGeom()); readPose(); }
// Каждый кадр: книга закрылась (в том числе клавишей в строке) — выход; книга или окно сменили размеры — вписать заново.
function readStep() {
  const bt = bookM, bk = bt?.book; if (performance.now() < swapUntil) return;
  if (!bk || bk.pose !== 'open') return exitRead();
  const key = [bk.marks.count, bk.s.Bw, bk.s.t, bk.s.th, bk.s.Dz, camera.aspect, bt.x.t, bt.z.t, bt.rot.t, tiltGoal(bt)].join('|') + (bk.dead ? 'x' : '');
  if (key !== readKey0 || bk !== readBook) { readKey0 = key; readBook = bk; readRefit(); }
}
let readBook = null;
function readReset() { readZ = 1; readOrb.az = readOrb.del = readOrb.lift = 0; readPose(); }
// Приблизить в k раз — к середине разворота: сдвига вида при чтении нет (пользователь 2026-11-21: «сдвиг камеры ужасно работает в режиме чтения. лучше убрать вообще»).
function readZoomBy(k) {
  if (!reading || readBusy) return;
  const z1 = clamp(readZ * k, .6, READ.zoom); if (Math.abs(z1 - readZ) < 1e-5) return;
  readZ = z1; readPose();
}
// Два пальца по горизонтали на тачпаде: один лист за жест. Накопление до порога, потом пауза: инерция жеста (затухающие значения) не листает пачкой.
const swipe = { acc: 0, last: 0, prev: 0, fired: false, lock: 0 };
function readSwipe(dx) {
  const now = performance.now(); if (now - swipe.last > 150) Object.assign(swipe, { acc: 0, prev: 0, fired: false });
  swipe.last = now; const grow = Math.abs(dx) > swipe.prev * 1.15 + 2; swipe.prev = Math.abs(dx);
  if (swipe.fired) { if (!(grow && now > swipe.lock)) return; swipe.fired = false; swipe.acc = 0; }
  swipe.acc += dx; if (Math.abs(swipe.acc) < 50) return;
  readFlip(Math.sign(swipe.acc)); swipe.acc = 0; swipe.fired = true; swipe.lock = now + 350;
}
const readFlip = dir => { if (putting) return busyNote(); bookM.book.flip(dir); bookBarDirty = true; };
function readWheel(e) {
  if (readBusy) return;
  const line = e.deltaMode === 1 ? 16 : 1;
  if (e.ctrlKey) return readZoomBy(Math.exp(clamp(-e.deltaY * line * .012, -.5, .5)));
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return readSwipe(e.deltaX * line);
  readZoomBy(Math.exp(clamp(-e.deltaY * line * .0016, -.5, .5)));
}
// Зажатая ← / →: после первого листа и короткой паузы листы идут один за другим (книга и папка — `holdFlip`), всё быстрее, не чаще 8 в секунду.
// Считаем сами по keydown/keyup, а не по повторам клавиши: задержку повтора задаёт система. Отпустили (или окно потеряло фокус) — лист в воздухе долетает, дальше стоим.
const HOLD_DELAY = 350;
let held = null;   // { code, dir, obj, t0, on }
function heldEnd() { if (held?.on) held.obj.endHold(); held = null; }
function heldStart(e, obj, dir) { heldEnd(); if (!e.shiftKey && !putting) held = { code: e.code, dir, obj, t0: performance.now(), on: false }; }
function heldStep(now) { if (held && !held.on && now - held.t0 >= HOLD_DELAY) { held.on = true; if (putting || !held.obj.holdFlip(held.dir)) held = null; } }
addEventListener('keyup', e => { if (held && e.code === held.code) heldEnd(); });
addEventListener('blur', heldEnd);
document.addEventListener('visibilitychange', heldEnd);
// Клавиши режима. true — клавиша обработана. Ходьба в режиме молчит: взгляд закреплён; ↑ ↓ меняют ступень подставки (если книга на ней).
function readKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || !bookM) return false;
  const bk = bookM.book, jump = to => { if (!putting) bookJump(bookM, to); else busyNote(); }, at = bk.rif ? Math.round(bk.rif.to) : bk.i;
  switch (e.code) {
    case 'ArrowLeft': case 'ArrowRight': { const dir = e.code === 'ArrowRight' ? 1 : -1; if (!e.repeat) { if (e.shiftKey) jump(at + dir * 10); else { readFlip(dir); heldStart(e, bk, dir); } } break; }
    case 'ArrowUp': case 'ArrowDown': if (e.shiftKey) return false; if (!e.repeat) standStep(bookM, e.code === 'ArrowUp' ? -1 : 1); break;   // на подставке: ↑ круче, ↓ площе; с Shift — уровень взгляда (`readLevel`)
    case 'Space': if (e.target.closest?.('button, input, select, textarea')) return false; if (!e.repeat) readFlip(e.shiftKey ? -1 : 1); break;
    case 'PageDown': if (!e.repeat) readFlip(1); break;
    case 'PageUp': if (!e.repeat) readFlip(-1); break;
    case 'Home': jump(0); break;
    case 'End': jump(bk.leaves); break;
    case 'Backspace': if (e.target.closest?.('input, textarea')) return false; if (!bookM.trail.length) return false; if (!e.repeat) bookBack(); break;   // назад — к странице, с которой ушли
    default: return false;
  }
  e.preventDefault(); return true;
}
// Слои: книга (в том числе то, что строится позже, — `BookThing.make`), стол с ящиками и все лампы — ещё и на слое 1.
function markReadLayers() {
  scene.traverse(o => { if (o.isLight) o.layers.enable(1); });
  for (const o of [deskBody, ...books.map(b => b.holder), ...drawers.flatMap(d => [d.group, d.hole])]) o?.traverse(m => m.layers.enable(1));
}
// В режиме чтения видна только «своя» книга: у остальных слой 1 снимается (вместе с ним уходят и их тени). Вне режима слой 1 никто не смотрит — у всех книг он включён (`BookThing.make`).
// Заодно: разворот читаемой книги рисуется чище (`Book.sharp` — вдвое крупнее с уменьшением, только две страницы).
function readLayers() { for (const b of books) { b.holder.traverse(m => { if (b === bookM) m.layers.enable(1); else m.layers.disable(1); }); setSharp(b, reading && b === bookM); } shadowDirty = true; }
function setSharp(b, on) { if (!!b.book.sharp === on) return; b.book.sharp = on; b.book.syncPages(); }
// ——— Подставка ———
// У каждой книги своя (`BookThing.rig`, src/stand.js; модель одна на всех, шейдеров не прибавляется): раскрытая книга, у которой выбрана ступень (`stand`), стоит на ней на столе —
// и в зале, и при чтении. Закрыли книгу — она ложится закрытой на стол, подставка складывается и исчезает, ступень помнится. Слои 0 и 1 (подставка — в держателе книги, и у «чужих» книг
// в режиме чтения слой 1 снимается вместе с книгой). Книга и подставка — одна вещь: ведут её за кожу книги или за основание подставки, а рама вокруг книги и верхний край книги тянутся
// вверх-вниз — меняется ступень. Включают и выключают клавиши у строки книги, ступень — ещё ↑ ↓ (в режиме чтения; в зале стрелки — ходьба).
let standModel = null;
// Ступень на k шагов: +1 — площе (угол меньше), −1 — круче; выбор запоминается за книгой. false — дальше некуда.
function standStep(bt, k) {
  if (!bt?.rig || !bt.stand) return false;
  const n = clamp(bt.notch + k, 1, NOTCHES); if (n === bt.notch) return false;
  bt.notch = bt.stand = n; bt.rig.go(n); bookBarDirty = true; save(); return true;
}
// Поставить книгу на подставку (on) или положить на стол. Подставке нужно место: упёрлась — книгу сдвигают, не вышло — остаётся лежать.
function setStand(bt, on = !bt.stand) {
  if (!bt?.rig || bt.book.pose !== 'open' || !!bt.stand === on) return false;
  if (on) {
    bt.stand = bt.notch; bt.rig.set(bt.notch);
    // Закрытые книги и папки рядом уйдут с дороги, как при раскрытии, а нет — сама книга сдвинется (`makeRoom`).
    const fit = makeRoom(bt, 'open');
    if (fit) { bt.x.t = fit.x; bt.z.t = fit.z; }
    else { bt.stand = 0; hint(t('hint.stand.noRoom'), 6000); bt.shudder(); return false; }
  } else bt.stand = 0;
  shadowDirty = true; bookBarDirty = true; save();
  if (!reading && nearB(bt)) lookAtBook(bt);   // взгляд идёт за книгой: она встала выше и могла сдвинуться
  return true;
}
// Взгляд сразу на месте: без этого он плыл бы к новому виду.
const snapView = () => { eye.copy(eyeGoal); yaw.set(yaw.t); pitch.set(pitch.t); camera.fov = fovGoal; camera.updateProjectionMatrix(); };
// Шторка: затемнить на 150 мс, при тёмном экране переключить набор рисуемого и поменять взгляд, и открыть: вещи не исчезают щелчком. Полоски клавиш — поверх шторки.
function readSwitch(fn) {
  readBusy = true; const c = $('curtain'); c.classList.add('shut');
  setTimeout(() => {
    try { fn(); } catch (e) { console.error(e); }
    shadowDirty = true; if (sun) sun.shadow.needsUpdate = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { c.classList.remove('shut'); readBusy = false; }));
  }, 160);
}
const viewNow = () => document.querySelector('#views button.on')?.dataset.v ?? null;
function enterRead() {
  if (reading || readBusy || state !== 'idle' || !bookM) return;
  const bt = bookM, back = { pos: eyeGoal.clone(), yaw: yaw.t, pitch: pitch.t, fov: fovGoal, view: viewNow(), bt, bx: bt.x.t, bz: bt.z.t, st: !!bt.stand };
  if (bt.book.pose !== 'open') {
    if (putting) return busyNote();
    reading = true; unfoldBook(bt, null, true);   // раскрывается там, где лежит, без обычного подхода взгляда; некуда — вздрагивает
    if (bt.book.pose !== 'open') { reading = false; return; }
  }
  reading = true; readBack = back; readOwn = 'book'; bookBarDirty = true; readZ = 1; readOrb.az = readOrb.del = readOrb.lift = 0; readKey0 = ''; readBook = null;
  viewOn('read'); hintNow(''); curShow();
  try {
    const seen = localStorage.getItem(READ.hint), idleSeen = localStorage.getItem(READ.idle);
    if (!idleSeen || (bt.file && !seen)) {
      localStorage.setItem(READ.idle, '1'); if (bt.file) localStorage.setItem(READ.hint, '1');
      hint((bt.file && !seen ? t('hint.read.first') : '') + t('hint.read.tail'), 11000);
    }
  } catch {}
  readSwitch(() => { markReadLayers(); readLayers(); camera.layers.set(1); readOnly = true; document.body.classList.add('reading'); readRefit(); });
  // Клавиша выхода — единственная видимая; в первое чтение её подпись стоит несколько секунд, потом — по наведению.
  try { if (!localStorage.getItem(READ.exitCap)) { localStorage.setItem(READ.exitCap, '1'); const x = document.querySelector('#views [data-v=read]'); x.classList.add('cap'); setTimeout(() => x.classList.remove('cap'), 7000); } } catch {}
}
// Тишина в режиме чтения: через 2,2 с без движения мыши или пальца по тачпаду указатель прячется (вместе с ним — подписи по наведению) и все клавиши, подсказки и строка книги плавно гаснут (.4 с, `body.idleui`) —
// остаётся чистая страница. Вернуть всё (за .15 с) может только настоящий сдвиг (хотя бы на пиксель от прошлого места: браузер сам шлёт «движение» на том же месте, когда под указателем меняется картинка —
// после листа или смены вида), колесо и щипок, нажатие. Клавиши не возвращают ничего, Esc выходит как всегда. Не гаснет: пока указатель над клавишей или полем ввода, пока в поле номера страницы есть фокус,
// пока открыта плашка (вопрос, справка). Угасшее не ловит нажатий (`pointer-events: none`), нажатие по странице листает как обычно. Вышли из чтения — всё сразу обычное.
// Так же — во время показа в киноуголке (файл или плеер сайта идёт, не на паузе, плашка закрыта): гаснут указатель, клавиши, подсказки и строка авторов.
let curTimer = 0, curX = -1, curY = -1;
const watching = () => !!cinema && (cinema.mode === 'file' || cinema.mode === 'web') && !cinema.paused && !cinemaAskOpen() && state === 'idle' && !reading;
const quiet = () => reading || watching();
function curBack() { clearTimeout(curTimer); curTimer = 0; const b = document.body.classList; if (b.contains('nocursor') || b.contains('idleui')) { b.remove('nocursor', 'idleui'); if (!drag) canvasEl.style.cursor = ''; } }
const CUR_MS = 2200;
function curArm() {
  clearTimeout(curTimer);
  curTimer = setTimeout(() => {
    curTimer = 0; if (!quiet()) return;
    const busy = document.elementFromPoint(curX, curY)?.closest('.bar, .ui.key, #readOffer, #bookAsk, #folderAsk, .slider') || document.activeElement?.matches?.('input, textarea') || document.querySelector('.sheet:not([hidden]), #bookAsk:not([hidden]), #folderAsk:not([hidden]), #readOffer:not([hidden]), #cinemaAsk:not([hidden])') || drag;
    if (busy) return curArm();
    document.body.classList.add('nocursor', 'idleui');
  }, CUR_MS);
}
function curShow() { curBack(); if (quiet()) curArm(); }
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const moved = Math.abs(e.clientX - curX) + Math.abs(e.clientY - curY) >= 1; curX = e.clientX; curY = e.clientY;
  if (moved && quiet()) curShow();
}, true);
addEventListener('pointerdown', e => { if (quiet() && e.pointerType !== 'touch') curShow(); }, true);
addEventListener('wheel', () => { if (quiet()) curShow(); }, { capture: true, passive: true });
// Показ: клавиши тоже возвращают всё (пробел — пауза, стрелки — ходьба); пошёл показ или кончилась пауза — отсчёт тишины заново, встал на паузу или открылась плашка — всё видно.
addEventListener('keydown', () => { if (watching()) curShow(); }, true);
let wasWatching = false;
function watchQuiet() {
  const w = watching(); if (w === wasWatching) return; wasWatching = w;
  if (w) curArm(); else if (!reading) curBack();
}
// Во весь экран (клавиша рядом с выходом из чтения): Fullscreen API на всей странице, только по нажатию (нужен жест пользователя); вид перестраивается сам (`resize`). Esc в полном экране
// забирает браузер — выходит из него; нашему слою Esc при этом не должен выйти и из чтения: нажатие, которым вышли из полного экрана (оно либо не доходит, либо приходит рядом с
// `fullscreenchange`), съедается; следующее выходит из чтения. Вышли из чтения — выходим и из полного экрана, если вошли мы.
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
let fsOwn = false, fsGone = -1e9;
function fsSync() {
  const on = !!fsEl(); if (!on && $('fsBtn').dataset.on) fsGone = performance.now();
  for (const k of [$('fsBtn'), $('fsHallBtn')]) { k.dataset.on = on ? '1' : ''; k.dataset.tip = on ? t('tools.fullscreenOff') : t('tools.fullscreen'); k.setAttribute('aria-label', k.dataset.tip); k.querySelector('use').setAttribute('href', on ? '#i-fs-off' : '#i-fs'); }
  if (!on) fsOwn = false;
}
function fsLeave() { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); }
document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
// Во весь экран — и в зале (последняя клавиша видов слева), и в чтении (рядом с выходом); в зале полный экран остаётся и после чтения.
$('fsBtn').onclick = $('fsHallBtn').onclick = e => {
  e.currentTarget.blur();
  if (fsEl()) return fsLeave();
  const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen; if (!req) return hint(t('hint.fs.unsupported'), 3000);
  fsOwn = !!reading; try { const p = req.call(d); p?.catch?.(() => { fsOwn = false; hint(t('hint.fs.denied'), 3500); }); } catch { fsOwn = false; }
};
// Выйти: к прежнему виду или туда, куда ведёт then (другая клавиша вида).
function exitRead(then) {
  if (!reading || readBusy) return;
  curBack(); if (fsOwn) fsLeave();
  readSwitch(() => {
    camera.layers.set(0); bookBarDirty = true; readOnly = false; reading = false; readZ = 1; document.body.classList.remove('reading'); for (const b of books) setSharp(b, false);
    if (then) return then();
    const b = readBack; eyeGoal.copy(b.pos); yaw.t = b.yaw; pitch.t = b.pitch; fovGoal = b.fov; viewOn(b.view);
    // Пока читали, книга переехала или встала на подставку (сошла с неё): взгляд идёт к ней, как она теперь стоит, а не к прежнему месту.
    if (b.bt && b.bt === bookM && bookM.book.pose === 'open' && (Math.hypot(bookM.x.t - b.bx, bookM.z.t - b.bz) > .05 || !!bookM.stand !== b.st)) lookAtBook(bookM);
  });
}

// Нажали на закрытую папку: она раскрывается на месте, взгляд подходит.
function unfold(f) {
  // Из ящика папка сначала выходит на стол (поднимается над краем стола и ложится на него; ящик закрывается) — обратно сама не вернётся.
  if (f.drawer !== null) { const D = f.dr; leaveDrawer(f, () => { D.toggle(false); [f.px.t, f.pz.t] = folderKeep(f, f.px.t, f.pz.t); unfold(f); }); return; }
  // Тесно — закрытые книги и папки рядом уезжают на свободные места, а нет и так — она сама сдвигается (`makeRoom`). Совсем некуда: крышка вздрагивает, внизу — что делать.
  const fit = makeRoom(f, 'open');
  if (!fit) { f.b.jolt(); hint(t('hint.folder.noRoom'), 6000); sfx.play('page', { gain: .3, rate: .7 }); return; }
  f.go('open', fit); ownF = f; readOwn = 'folder'; updateReadCount();
  lookAtFolder(f); sfx.play('page', { gain: .5, rate: .8 });
  hint(t('hint.folder.tip'), 8000);
  save();
}

// ——— Своя папка: раскрытая, которой касались последней. Для неё — счётчик листов и PDF, пока взгляд рядом ———
let ownF = null, barOn = false, readOwn = 'folder';   // readOwn — что «своё», когда ← → листают: то, чего касались последним (папка или книга)
// Рядом — взгляд не дальше полутора метров от папки: тогда ← → листают её, а нажатие на лист перелистывает; дальше — только подойти.
const nearF = f => !!f && (f.pose === 'open' ? lineApprox(f.px.t, f.pz.t, f.pr.t, A4.h) >= LINE_MIN : eyeGoal.distanceTo(W(f.px.t, deskTop, f.pz.t)) < 1.6);   // у раскрытой папки — то же правило «текст читается», что у книги (`lineApprox`); у закрытой (ярлык) — расстояние
function updateReadCount() { $('readCount').textContent = ownF?.b.count ? t('folder.sheetOf', { i: Math.min(ownF.b.i + 1, ownF.b.count), n: ownF.b.count }) : ''; $('shuffleBtn').hidden = !(ownF?.b.count > 1); }
function syncBar() {
  if (ownF && ownF.pose !== 'open') ownF = null;
  const on = !reading && state === 'idle' && nearF(ownF); if (on === barOn) return;
  barOn = on; $('readTools').style.display = on ? 'flex' : 'none';
  if (on) { updateReadCount(); reveal($('readTools'), 5000); }
}
// ——— Ярлык папки: название ———
// Нажали на ярлык закрытой папки (взгляд рядом) — поле для названия ложится прямо на ярлык, буквами машинки: Enter записывает, Esc отменяет, нажатие мимо записывает.
// У раскрытой папки ярлык лежит снизу, зато в строке папки есть клавиша «подписать»: поле появляется в самой строке. Пустое название — снова без названия
// (на ярлыке тогда бледно первая строка первого листа). Название хранится вместе с папкой (`data.name`), в PDF и в вопросе об уборке папки оно же (`title`).
const nameEl = $('labelEdit'), barNameEl = $('folderName');
let editF = null, barF = null;
const labelEditing = () => !!editF;
function renameFolder(f, v) {
  const was = f.b.name || '', name = (v || '').trim().slice(0, 60);
  if (name === was) return;
  f.b.setName(name); save(); sfx.play('page', { gain: .22, rate: 1.35 });
}
// Поле ложится на ярлык, как он виден с места: тот же поворот и размер (но не мельче, чем в него можно попасть и что-то прочесть).
function placeLabelEdit() {
  const f = editF; if (!f) return;
  const L = f.b.label;
  if (!L || f.pose !== 'face' || f.leaving || f.held || !folders.includes(f) || state !== 'idle' || !f.b.group.visible || !nearF(f)) return closeLabelEdit(false);
  const cs = L.corners().map(p => { p.project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight, p.z]; });
  if (cs.some(c => c[2] > 1)) return closeLabelEdit(false);
  const cx = (cs[0][0] + cs[2][0]) / 2, cy = (cs[0][1] + cs[2][1]) / 2, ang = Math.atan2(cs[1][1] - cs[0][1], cs[1][0] - cs[0][0]);
  const w = Math.max(210, Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]) * 1.05), h = Math.max(32, Math.hypot(cs[3][0] - cs[0][0], cs[3][1] - cs[0][1]) * 1.1);
  Object.assign(nameEl.style, { left: cx + 'px', top: cy + 'px', width: w + 'px', height: h + 'px', fontSize: clamp(h * .46, 14, 26) + 'px', transform: `translate(-50%,-50%) rotate(${ang}rad)` });
}
function openLabelEdit(f) {
  if (!f.b.label) return;
  closeLabelEdit(true); hideBarName(true);
  editF = f; nameEl.value = f.b.name || ''; nameEl.placeholder = f.b.labelText.text ? f.b.labelText.text : t('folder.namePlaceholder'); nameEl.hidden = false;
  placeLabelEdit(); if (!editF) return;
  nameEl.focus({ preventScroll: true }); nameEl.select();
}
function closeLabelEdit(save) {
  const f = editF; if (!f) return; editF = null; const v = nameEl.value; nameEl.hidden = true; nameEl.blur();
  if (save) renameFolder(f, v);
}
for (const el of [nameEl, barNameEl]) for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, e => e.stopPropagation());
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') closeLabelEdit(true); else if (e.key === 'Escape') closeLabelEdit(false); });
nameEl.addEventListener('blur', () => { if (editF) closeLabelEdit(true); });
addEventListener('pointerdown', e => { if (editF && e.target !== nameEl) closeLabelEdit(true); }, true);
// Над ярлыком закрытой папки (взгляд рядом) курсор — «писать».
let labelHov = false;
function hoverLabel(e) {
  let on = false;
  if (LABEL_KEY && e && state === 'idle' && !e.buttons && e.pointerType === 'mouse' && e.target === canvasEl && !editF && folders.some(f => f.pose === 'face' && nearF(f))) {
    const hit = pick(e); on = !!hit?.u.folder && !!hit.h.object.userData.label && hit.u.folder.pose === 'face' && nearF(hit.u.folder);
  }
  if (on) canvasEl.style.cursor = 'text'; else if (labelHov) canvasEl.style.cursor = '';
  labelHov = on;
}
// Клавиша «подписать» в строке раскрытой папки: поле названия — прямо в строке.
function showBarName() {
  const f = ownF; if (!f) return;
  closeLabelEdit(true); barF = f; barNameEl.value = f.b.name || ''; barNameEl.placeholder = f.b.labelText.text || t('folder.namePlaceholder'); barNameEl.hidden = false; $('labelBtn').classList.add('on');
  barNameEl.focus({ preventScroll: true }); barNameEl.select();
}
function hideBarName(save) {
  const f = barF; if (!f) return; barF = null; const v = barNameEl.value; barNameEl.hidden = true; $('labelBtn').classList.remove('on'); barNameEl.blur();
  if (save && folders.includes(f)) renameFolder(f, v);
}
$('labelBtn').onclick = e => { e.currentTarget.blur(); if (barF) hideBarName(true); else if (state === 'idle' && ownF) showBarName(); };
barNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') hideBarName(true); else if (e.key === 'Escape') hideBarName(false); });
barNameEl.addEventListener('blur', () => { if (barF) hideBarName(true); });
// Книга: строка внизу, пока она раскрыта и взгляд рядом, — «стр. 312–313 из 600» и поле номера: ввели страницу, Enter — пролист туда.
// Клавиши подставки: «на подставку» / «положить на стол» (подсвечена, пока стоит), «круче», угол и «площе» — когда стоит.
function syncStandKeys(bt) {
  const has = !!bt.rig, on = has && !!bt.stand, k = $('bookStand');
  $('standKeys').hidden = !has; k.classList.toggle('on', on); k.dataset.tip = on ? t('stand.off') : t('stand.on'); k.setAttribute('aria-label', k.dataset.tip);
  for (const id of ['tiltUp', 'tiltDown', 'tiltAng']) $(id).hidden = !on;
  if (on) { $('tiltAng').textContent = Math.round(NOTCH[bt.notch - 1].deg) + '°'; $('tiltUp').disabled = bt.notch <= 1; $('tiltDown').disabled = bt.notch >= NOTCHES; }
}
// «Читать книгу?»: крупная плашка в нижней трети появляется на любое нажатие на книгу вне режима чтения (закрытую — раскроет и спросит; раскрытую издалека — подведёт взгляд и спросит; близкую —
// спросит, а страницу всё равно перелистнёт) и держится, пока не выберут: «читать» (режим чтения как есть — на подставке или лёжа), «остаться так», Esc, Enter («читать»), книгу не закроют или не отойдут
// от неё (текст перестал читаться, `legibleBook`). Листы плашку не прячут. После «остаться так» книга больше не спрашивает (`stayed`), пока её не закроют или не отойдут и не вернутся.
// Стоит под книгой, на столе, если там хватает места, а нет — внизу, над страницей лишь краем. Остальной экран чуть темнее (`#readDim`, нажатий не ловит).
let offerBook = null;
// Предложение висит, пока взгляд стоит там, где его показали: повели взглядом, пошли, приблизились — оно уходит (раньше уходило, когда книга переставала «читаться»,
// и потому взгляд сперва подводили к книге). «Остаться так» — больше не спрашивает, пока книгу не закроют.
let offerView = null;
const offerMoved = () => !offerView || eyeGoal.distanceTo(offerView.eye) > .03 || Math.abs(yaw.t - offerView.yaw) > .03 || Math.abs(pitch.t - offerView.pitch) > .03 || Math.abs(fovGoal - offerView.fov) > .5;
function offerRead(bt) {
  if (reading || !bt?.file || bt.book.pose !== 'open' || bt.stayed || offerBook === bt) return;
  offerBook = bt; offerView = { eye: eyeGoal.clone(), yaw: yaw.t, pitch: pitch.t, fov: fovGoal }; $('readOffer').hidden = $('readDim').hidden = false; offerPlace(); requestAnimationFrame(() => $('readDim').classList.add('on'));
}
function offerHide() { if (!offerBook) return; offerBook = null; $('readOffer').hidden = true; $('readDim').hidden = true; $('readDim').classList.remove('on'); }
// Под книгой: нижняя кромка разворота на экране (по сегодняшнему взгляду); не помещается — внизу окна, над клавишами.
function offerPlace() {
  const bt = offerBook, el = $('readOffer'); if (!bt) return;
  const R = station.rotation.y + bt.rot.t, f = new THREE.Vector3(Math.sin(R), 0, Math.cos(R)), ex = new THREE.Vector3(Math.cos(R), 0, -Math.sin(R)), hw = bt.book.s.Bw;
  let low = 0; for (const sx of [-1, 1]) { const v = W(bt.x.t, deskTop + .002 + (bt.stand ? .02 : 0), bt.z.t).addScaledVector(f, BOOK_H / 2 + .003).addScaledVector(ex, sx * hw).project(camera); low = Math.max(low, (1 - v.y) / 2 * innerHeight); }
  const h = el.offsetHeight || 150, floor = innerHeight - h - Math.max(70, innerHeight * .12), top = low + 22 + h <= innerHeight - 24 ? low + 22 : floor;
  el.style.top = Math.round(Math.min(Math.max(top, 80), innerHeight - h - 24)) + 'px';
}
function offerStep() {
  for (const b of books) if (b.stayed && b.book.pose !== 'open') b.stayed = false;   // закрыли — раскроют снова, спросит снова
  if (!offerBook) return;
  if (reading || bookM !== offerBook || offerBook.book.pose !== 'open' || state !== 'idle' || offerMoved()) offerHide(); else offerPlace();
}
$('offerRead').onclick = e => { e.currentTarget.blur(); offerHide(); enterRead(); };
$('offerStay').onclick = e => { e.currentTarget.blur(); if (offerBook) offerBook.stayed = true; offerHide(); };
// Закрыть книгу одним нажатием — из предложения и клавишей в строке книги (пользователь 2026-11-21: «как ее теперь закрыть вообще? я не хочу вручную пролистывать в начало»).
$('offerClose').onclick = e => { e.currentTarget.blur(); const bt = offerBook; offerHide(); if (bt) closeBook(bt, -1); };
$('bookClose').onclick = e => { e.currentTarget.blur(); if (bookM?.book.pose === 'open') closeBook(bookM, -1); };
let bookBarOn = false, bookBarDirty = true, bookBarText = '';
const bookBar = () => $('bookBar');
function syncBookBar() {
  offerStep();
  const bt = bookM, bk = bt?.book, on = state === 'idle' && !!bk && bk.pose === 'open' && readOwn === 'book' && nearB(bt);
  if (on !== bookBarOn) { bookBarOn = on; bookBar().style.display = on ? 'flex' : 'none'; $('standKeys').style.display = on ? 'flex' : 'none'; if (on) reveal($('standKeys'), 6000); document.body.classList.toggle('bookread', on); bookBarDirty = true; if (on) reveal(bookBar(), bt.file ? 5000 : 9000); }
  if (!on) return;
  const i = bk.rif ? clamp(Math.round(bk.iS.v), 0, bk.leaves) : bk.i, pg = [i > 0 ? 2 * i : 0, i < bk.leaves ? 2 * i + 1 : 0].filter(x => x && x <= bk.pages);
  const text = bt.file ? t('book.pages', { pg: pg.join('–'), n: bk.pages }) : t('book.blank'), key = text + '|' + (bt.file?.id ?? '') + '|' + books.length + '|' + bt.pad + bk.pressed + '|' + bt.stand + bt.notch + '|' + !!bt.rig + '|' + bk.marks.count + '|' + bt.trail.join(',');
  if (key === bookBarText && !bookBarDirty) return;
  bookBarDirty = false; bookBarText = key; $('bookCount').textContent = text;
  const has = !!bt.file, few = books.length < BOOK_MAX; $('bookNo').hidden = !has; $('bookOut').hidden = !has && books.length < 2; $('bookTitle').hidden = !has;
  // Клавиши строки: подпись говорит, что будет по нажатию; у подкладки ещё и «горит», пока она подложена.
  tip($('bookPut'), has ? (few ? t('book.putOther') : t('book.putInstead')) : t('book.put')); $('bookPut').querySelector('use').setAttribute('href', has ? '#i-bookswap' : '#i-bookput'); bookBar().classList.toggle('empty', !has);
  // Закладки: «заложить» / «убрать» — у книги с файлом; «назад» — после перехода (по закладке, номеру страницы, обрезу, Home/End), до десяти шагов.
  { const g = markGap(bk), m = g ? bk.marks.at(g) : null; $('bookMark').hidden = !has || !g; tip($('bookMark'), m ? t('book.markRemove') : t('book.markAdd')); $('bookMark').classList.toggle('on', !!m);
    const back = bt.trail[bt.trail.length - 1]; $('bookBack').hidden = back === undefined; if (back !== undefined) tip($('bookBack'), t('book.backTo', { p: back > 0 ? 2 * back : 1 })); }
  tip($('bookPad'), padShown(bt) ? t('book.padOff') : t('book.padOn')); $('bookPad').classList.toggle('on', padShown(bt));
  // Клавиши подставки (отдельная колонка у строки): включить / выключить, круче, площе и угол — у раскрытой книги.
  syncStandKeys(bt);
  tip($('bookOut'), books.length > 1 ? (has ? t('book.outRoom') : t('book.outEmpty')) : t('book.outPdf')); $('bookOut').querySelector('use').setAttribute('href', books.length > 1 ? '#i-bin' : '#i-bookout');
  if (has) { $('bookTitle').textContent = bt.title; $('bookTitle').title = bt.title; }
  if (has && document.activeElement !== $('bookNo')) $('bookNo').value = pg[0] ?? '';
}
// ——— Закладки и «назад» ———
// Закладка лежит в зазоре g между листами g−1 и g (1…листов−1); на первом и последнем развороте — в ближайшем зазоре. Спрашивает у книги, где лента на этой странице.
const spreadOf = bk => bk.rif ? clamp(Math.round(bk.rif.to), 0, bk.leaves) : bk.i;
const markGap = bk => bk.leaves >= 2 ? clamp(spreadOf(bk), 1, bk.leaves - 1) : 0;
// Запомнить, откуда ушли (не больше десяти шагов, одинаковые подряд не повторяются), и перейти. Закрытая книга раскрывается на этом листе.
function trailPush(bt, from) { const tr = bt.trail; if (tr[tr.length - 1] !== from) tr.push(from); if (tr.length > 10) tr.shift(); bookBarDirty = true; }
function bookJump(bt, to, go = null) {
  const bk = bt.book; to = clamp(Math.round(to), 0, bk.leaves);
  if (bk.pose !== 'open') { unfoldBook(bt, to); return; }
  const from = spreadOf(bk); if (to !== from) trailPush(bt, from);
  bk.go(to, go ?? undefined); bookBarDirty = true; save();
}
function bookBack() {
  const bt = bookM, bk = bt?.book; if (!bk || bk.pose !== 'open') return; if (putting) return busyNote();
  const tr = bt.trail; while (tr.length && tr[tr.length - 1] === spreadOf(bk)) tr.pop();
  if (!tr.length) { bookBarDirty = true; return; }
  bk.go(tr.pop()); bookBarDirty = true; save();
}
function toggleMark(bt) {
  const bk = bt?.book; if (!bk || bk.pose !== 'open' || !bt.file) return; if (putting) return busyNote();
  const g = markGap(bk); if (!g) return; const m = bk.marks.at(g);
  if (m) { bk.marks.remove(m); bk.snd('turn', { dir: 1, fast: true, hold: true }); }
  else if (bk.marks.add(g)) bk.snd('turn', { dir: -1, fast: true, hold: true });
  else hint(t('hint.mark.max', { max: MARK_MAX }), 5000);
  bookBarDirty = true; shadowDirty = true; save();
}
$('bookMark').onclick = e => { e.currentTarget.blur(); toggleMark(bookM); };
$('bookBack').onclick = e => { e.currentTarget.blur(); bookBack(); };
{
  const no = $('bookNo');
  // Клавиши в поле не уходят в зал (стрелки, буквы, Esc): иначе набор номера двигал бы взгляд.
  for (const t of ['keydown', 'keyup', 'keypress']) no.addEventListener(t, e => e.stopPropagation());
  no.addEventListener('keydown', e => {
    if (e.key === 'Escape') { no.blur(); return; }
    if (e.key !== 'Enter') return;
    const bk = bookM?.book, p = Math.round(+no.value); no.blur(); if (!bk || !(p >= 1)) return;
    bookJump(bookM, Math.floor(clamp(p, 1, bk.pages) / 2));
  });
}
// Сколько точек по высоте нужно странице книги на экране (с учётом плотности экрана): по этому `setDetail` выбирает качество картинок страниц.
// Пересчитывается, когда взгляд и книга остановились на четверть секунды (`bookDetailStep` в кадре).
const bpv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], bsz = new THREE.Vector2();
function bookPx() {
  const bk = bookM.book, { Wp } = bk.s, pr = FULL_PR; renderer.getSize(bsz);   // полная чёткость, а не та, что сейчас (на ходу она ниже, `movingPr`)
  const P3 = (x, z, o) => { o.set(x, .02, z); bk.body.localToWorld(o); o.project(camera); o.x = (o.x + 1) * bsz.x / 2; o.y = (1 - o.y) * bsz.y / 2; };
  P3(.06, -.13, bpv[0]); P3(.06, .13, bpv[1]); P3(.06 + Wp, 0, bpv[2]); P3(.06, 0, bpv[3]);
  return Math.max(Math.hypot(bpv[0].x - bpv[1].x, bpv[0].y - bpv[1].y), Math.hypot(bpv[2].x - bpv[3].x, bpv[2].y - bpv[3].y) / bk.ratio) * pr;
}
let bookDetailDirty = true, bdAt = 0, bdPending = true;
const bdKey = [];
function bookDetailStep() {
  const bt = bookM; if (!bt) return;
  if (!bt.book.paged) { bdPending = true; return; }
  const k = [camera.position.x, camera.position.y, camera.position.z, camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.fov, bt.x.v, bt.z.v, bt.rot.v], now = performance.now();
  let ch = bookDetailDirty || bdPending && !bdKey.length; for (let i = 0; i < k.length; i++) if (!(Math.abs(k[i] - (bdKey[i] ?? 1e9)) < 1e-4)) ch = true;
  if (ch) { bdKey.splice(0, bdKey.length, ...k); bdAt = now; bookDetailDirty = false; bdPending = true; }
  if (bdPending && now - bdAt > 250) { bdPending = false; bt.book.setDetail(bookPx()); }
}
// Положить PDF в книгу (клавиша и надпись в строке книги, нажатие на страницу пустой книги, файл, перетащенный в окно; для проверок — `__rr.putPdf(url)`): файл копируется в хранилище браузера (ход — подсказкой
// внизу), книга перестраивается под число страниц и пропорции страницы и раскрывается на первом листе; прежний файл книги удаляется из хранилища.
const hintNow = t => { const h = $('hint'); h.innerHTML = t; h.style.opacity = t ? 1 : 0; };
let putting = false, putNote = '', putNoteUntil = 0;
const isPdf = f => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
const busyNote = () => { if (!putting) return; putNote = t('hint.put.busyNote'); putNoteUntil = performance.now() + 4000; };
// mode: 'replace' — вместо книги, которая «своя» (пустая книга просто принимает файл); 'new' — в новую книгу рядом (если книг меньше BOOK_MAX): прежняя закрывается и уезжает
// на свободное место, новая ложится там, где читали, и раскрывается (`addBook`).
async function putPdf(file, mode = 'replace') {
  if (!bookM) { hint(t('hint.put.noBook'), 3000); return false; }
  if (putting) { busyNote(); return false; }
  if (!isPdf(file)) { hint(t('hint.put.notPdf'), 5000); return false; }
  const target = bookM; if (mode === 'new' && (!target.file || books.length >= BOOK_MAX || target.drawer !== null)) mode = 'replace';
  if (mode === 'new' && !asideSpot(target)) { hint(t('hint.put.noSpot'), 7000); return false; }
  putting = true; let info = null, bf = null, last = -1;
  const say = f => { const p = Math.round(f * 100), note = performance.now() < putNoteUntil ? putNote : ''; if (p !== last || note) { last = p; hintNow(note + t('hint.put.progress', { p })); } };
  try {
    say(0); info = await saveBook(file, say); hintNow(t('hint.put.opening')); bf = await openFile(info.id);
  } catch (e) {
    if (info && !bf) removeBook(info.id).catch(() => {});
    hint(e?.message || t('hint.put.fail'), 9000); console.warn(e); putting = false; return false;
  }
  const meta = { id: info.id, name: info.name ?? file.name, pages: info.pages, w: info.w, h: info.h, title: info.title ?? '', author: info.author ?? '' };
  if (mode === 'new') { if (addBook(target, meta, bf)) return true; bf.close(); removeBook(info.id).catch(() => {}); putting = false; return false; }
  const bt = books.includes(target) ? target : bookM, old = bt.file, pose = bt.book.pose;
  bt.rebuild(meta, bf);
  if (old && old.id !== info.id) removeBook(old.id).catch(e => console.warn(e));
  setActive(bt); readOwn = 'book'; bookBarDirty = true; save();
  if (pose !== 'open' && unfoldBook(bt) === false) hint(t('hint.put.noRoomOpen'), 9000);
  else { if (pose === 'open') { lookAtBook(bt); offerRead(bt); } hint(tn('hint.put.done', info.pages, { n: info.pages }), 4000); }
  putting = false; return true;
}
// Куда прежняя книга уйдёт, когда рядом ляжет новая: ближайшее к ней свободное место для закрытой книги, не под раскрытием новой (оно встанет там, где корешок прежней).
// Ищется по сетке стола; машинка, лампа, пресс-папье, папки и другие книги — преграды (`bookSpot`). null — места нет.
function newBookHinge(old) { const r = old.rot.t, d = -old.book.cx(); return { x: old.x.t + Math.cos(r) * d, z: old.z.t - Math.sin(r) * d, r }; }
function asideSpot(old, meta = null) {
  const h = newBookHinge(old), sz = bookSize(meta?.pages ?? BOOK_DEFAULT.pages, meta ? clamp(meta.w / meta.h, BOOK_RATIO.min, BOOK_RATIO.max) : BOOK_DEFAULT.ratio);
  return findSpot(old, { x: h.x, z: h.z, r: h.r, hw: sz.Bw + sz.t / 2 + .012, hd: sz.Dz / 2 + .012 });
}
// Ближайшее к книге свободное место для неё закрытой (keepOut — рамка, куда нельзя): весь стол, преграды — машинка, лампа, пресс-папье, папки и другие книги; тесные места
// дороже (`freeSpotFor`). null — места нет.
function findSpot(bt, keepOut = null) { const p = freeSpotFor(bt, keepOut ? [{ ...keepOut, hw: keepOut.hw + .01, hd: keepOut.hd + .01 }] : [], [], 'face'); return p && { x: p.x, z: p.z }; }
const freeBind = () => { for (let k = 0; k < BOOK_MAX; k++) if (!books.some(b => b.bind === k)) return k; return books.length % BOOK_MAX; };
function addBook(old, meta, bf) {
  const spot = asideSpot(old, meta); if (!spot) { hint(t('hint.put.noSpot2'), 6000); return false; }
  const h = newBookHinge(old); swapUntil = performance.now() + 3000;
  old.go('face'); old.x.t = spot.x; old.z.t = spot.z;
  setTimeout(() => {
    try {
      const sz = bookSize(meta.pages, clamp(meta.w / meta.h, BOOK_RATIO.min, BOOK_RATIO.max)), nb = new BookThing({ x: h.x + Math.cos(h.r) * sz.Bw / 2, z: h.z - Math.sin(h.r) * sz.Bw / 2, rot: h.r, pose: 'face', i: 0, pages: meta.pages, ratio: sz.ratio, file: meta, bind: freeBind() });
      books.push(nb); nb.bf = bf; nb.attach(); nb.lift.v = .16; nb.lift.t = 0; lightMasks(); shadowDirty = true; sfx.play('page', { gain: .5, rate: .7 });
      setActive(nb); if (reading) readLayers();
      setTimeout(() => { unfoldBook(nb, null, true); hint(tn('hint.put.newBook', meta.pages, { n: meta.pages }), 5000); putting = false; save(); }, 380);
    } catch (e) { console.error(e); putting = false; }
  }, 700);
  save(); return true;
}
// Вынуть книгу: первое нажатие предупреждает, второе (в течение 5 с) — книга закрывается; последняя книга в зале остаётся пустой (файл удаляется из хранилища браузера, на диске
// пользователя он остаётся), а если книг больше одной — уходит из зала вся (пустая — без вопросов о файле).
let outUntil = 0;
function pdfOut() {
  const bt = bookM; if (!bt) return;
  if (putting) return busyNote();
  const gone = books.length > 1, now = performance.now();
  if (now > outUntil) { outUntil = now + 5000; $('bookOut').classList.add('armed'); setTimeout(() => $('bookOut').classList.remove('armed'), 5000); hint(t(gone ? 'hint.out.againBook' : 'hint.out.againPdf'), 5000); return; }
  if (!bt.file && !gone) return;
  outUntil = 0; $('bookOut').classList.remove('armed'); const old = bt.file; bt.go(bt.book.pose === 'open' ? 'face' : bt.book.pose); bookBarDirty = true;
  setTimeout(() => {
    if (gone) { removeBookThing(bt); hint(t('hint.out.goneBook'), 5000); return; }
    if (bt.file !== old) return;
    bt.rebuild(null, null); removeBook(old.id).catch(e => console.warn(e)); save(); hint(t('hint.out.gonePdf'), 5000);
  }, 900);
}
function removeBookThing(bt) {
  const i = books.indexOf(bt); if (i < 0) return;
  books.splice(i, 1); const id = bt.file?.id; bt.dispose();
  if (bookM === bt) { bookM = books.find(b => b.book.pose === 'open') ?? books[0] ?? null; bookBarDirty = bookDetailDirty = true; if (reading) readLayers(); }
  if (id) removeBook(id).catch(e => console.warn(e));
  lightMasks(); shadowDirty = true; save();
}
// Файл — в окно: пока он над окном, подсказка; отпустили — PDF ложится в книгу. Браузер не должен открыть файл вместо зала: dragover и drop гасятся на всём окне.
let dropHintOn = false, dropTimer = 0;
const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
function dropHint(on, text = t('hint.drop.pdf')) {
  clearTimeout(dropTimer);
  if (on) { if (!dropHintOn) { dropHintOn = true; hintNow(text); } dropTimer = setTimeout(() => dropHint(false), 400); }
  else if (dropHintOn) { dropHintOn = false; hintNow(''); }
}
addEventListener('dragover', e => { e.preventDefault(); if (hasFiles(e)) { e.dataTransfer.dropEffect = 'copy'; if (state !== 'loading' && !shuffleOpen()) dropHint(true, [...e.dataTransfer.items].some(i => /zip/.test(i.type)) ? t('hint.drop.desk') : undefined); } });
addEventListener('drop', e => {
  e.preventDefault(); dropHint(false);
  if (!hasFiles(e) || state === 'loading') return;
  const files = [...e.dataTransfer.files], zip = files.find(isZip); if (zip) return void openDesk(zip);   // архив стола (src/deskfile.js)
  const f = files.find(isPdf);
  if (f) givePdf(f); else if (files.length) hint(t('hint.put.notPdf'), 5000);
});
// Файл есть (перетащили в окно): у книги с PDF, пока их меньше BOOK_MAX, спрашиваем — в новую или вместо этой; иначе сразу в «свою» книгу.
function givePdf(f) { if (bookM?.file && books.length < BOOK_MAX && !putting) showAsk(true, f); else putPdf(f); }
let pickMode = 'replace';
$('bookFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; const m = pickMode; pickMode = 'replace'; if (f) putPdf(f, m); };
// Окно выбора файла: клавиша с книгой (у пустой — «положить PDF в книгу», у книги с файлом — «другой PDF…»), а у пустой книги — ещё и нажатие на страницу.
// У книги с файлом и свободным местом сперва вопрос «Куда положить PDF?» (`showAsk`); окно выбора открывается по нажатию на его кнопку — это тоже нажатие пользователя.
const pickPdf = () => { if (putting) return busyNote(); if (bookM?.file && books.length < BOOK_MAX) return showAsk(true, null); pickMode = 'replace'; $('bookFile').click(); };
$('bookPut').onclick = e => { e.currentTarget.blur(); pickPdf(); };
$('bookOut').onclick = e => { e.currentTarget.blur(); pdfOut(); };
$('bookStand').onclick = e => { e.currentTarget.blur(); setStand(bookM); };
$('tiltUp').onclick = e => { e.currentTarget.blur(); standStep(bookM, -1); };
$('tiltDown').onclick = e => { e.currentTarget.blur(); standStep(bookM, 1); };
// Подкладка: «убрать» — настройка книги выключается; «подложить» — включается, а если книга сейчас расправлена (подкладка из-за этого убрана), расправленность снимается, и подкладка возвращается.
const padShown = bt => bt.pad && bt.book.pressed < .5;
$('bookPad').onclick = e => {
  e.currentTarget.blur(); const bt = bookM; if (!bt) return;
  if (padShown(bt)) { bt.pad = false; bt.book.setRest(false); } else { bt.pad = true; bt.book.setRest(true); if (bt.book.pressed > 0) bt.book.press(0); }
  bookBarDirty = true; shadowDirty = true; save();
};
// Вопрос «Куда положить PDF?»: тёмная плашка у строки книги; Esc и нажатие мимо — отмена.
let askFile = null;
const askOpen = () => !$('bookAsk').hidden;
function showAsk(on, file = null) {
  const el = $('bookAsk'); if (!on) { el.hidden = true; askFile = null; return; }
  if (!bookM) return; closeSliders(); askFile = file; el.hidden = false;
  $('askRepSub').textContent = t('bookAsk.repSub', { title: bookM.title.length > 34 ? bookM.title.slice(0, 33) + '…' : bookM.title });
  $('askNew').focus({ preventScroll: true });
}
$('bookAsk').addEventListener('pointerdown', e => { if (e.target === $('bookAsk')) showAsk(false); });
$('askNew').onclick = () => {
  const f = askFile; if (bookM && !asideSpot(bookM)) { hint(t('hint.put.noSpot'), 7000); return; }
  showAsk(false); if (f) putPdf(f, 'new'); else { pickMode = 'new'; $('bookFile').click(); }
};
$('askRep').onclick = () => { const f = askFile; showAsk(false); if (f) putPdf(f); else { pickMode = 'replace'; $('bookFile').click(); } };
// Осиротевшие файлы (не файлы нынешних книг, в том числе недописанные) удаляются в свободное время после открытия зала; пока кладётся новый — не трогаются.
async function sweepFiles() {
  if (!books.length || putting) return;
  try {
    const keep = new Set(books.map(b => b.file?.id)); try { const st = JSON.parse(localStorage.getItem(KEY)); for (const b of st?.books ?? [st?.book]) keep.add(b?.file?.id); } catch {}
    for (const b of await listBooks()) if (!putting && !keep.has(b.id)) await removeBook(b.id);
  } catch (e) { console.warn(e); }
}
// ——— Стол — в файл и из файла (устройство архива и проверка — src/deskfile.js) ———
// «Сохранить»: localStorage стола (ключ KEY) и файлы книг из OPFS → один ZIP `читальный-зал-ГГГГ-ММ-ДД.zip`. «Открыть»: файл целиком проверяется, спрашиваем, заменяем стол (PDF — в хранилище под новыми номерами,
// state — в localStorage), лишние книги прежнего стола убираем, страница перезагружается. Пока идёт запись, `stale` не даёт saveNow() затереть новый стол прежним, а `putting` не пускает чужую книгу в хранилище.
const isZip = f => !!f && (/zip/.test(f.type || '') || /\.zip$/i.test(f.name || ''));
const deskDate = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const deskWords = ({ sheets: s, folders: f, books: b }) => [s && tn('n.sheets', s), f && tn('n.folders', f), b && tn('n.books', b)].filter(Boolean).join(', ') || t('desk.nothing');
let deskBusy = false;
const progressSay = () => { let last = -1; return (text, f) => { const p = Math.round(f * 100); if (p !== last) { last = p; hintNow(t('hint.progress', { text, p })); } }; };
async function deskBlobNow(onProgress) {
  saveNow();   // в файл идёт то, что на столе сейчас
  let st; try { st = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!st || typeof st !== 'object') throw new DeskError(t('desk.err.unsaved'));
  return packDesk(st, onProgress);
}
$('deskSaveBtn').onclick = async e => {
  const btn = e.currentTarget; btn.blur();
  if (deskBusy) return; if (putting) return hint(t('hint.put.busyFile'), 4000);
  deskBusy = true; btn.disabled = true; const say = progressSay();
  try {
    hintNow(t('hint.desk.packing'));
    const r = await deskBlobNow((f, name) => say(name.startsWith('books/') ? t('hint.desk.packBook') : t('hint.desk.packing'), f));
    const name = t('desk.fileName', { date: deskDate() }); download(r.blob, name);
    hint(t('hint.desk.saved', { name, size: mb(r.bytes), books: r.books ? tn('hint.desk.savedBooks', r.books) : '', missing: r.missing ? tn('hint.desk.missing', r.missing) : '' }), r.missing ? 12000 : 7000);
  } catch (err) { hint(err instanceof DeskError ? err.message : t('hint.desk.packFail'), 10000); console.warn(err); }
  finally { deskBusy = false; btn.disabled = false; }
};
// Вопрос «Открыть стол из файла?»: плашка у клавиш вверху; Enter — заменить, Esc, нажатие мимо и «оставить как есть» — отмена. Возвращает Promise<boolean>.
let deskAskRes = null;
const deskAskOpen = () => !$('deskAsk').hidden;
function deskAnswer(yes) { const r = deskAskRes; deskAskRes = null; $('deskAsk').hidden = true; r?.(yes); }
function askDesk(plan) {
  closeSliders(); deskAskRes?.(false);
  const now = { sheets: sheets.length, folders: folders.filter(f => !f.gone).length, books: books.filter(b => b.file).length };
  $('deskAskNow').textContent = t('deskAsk.now', { words: deskWords(now) });
  const when = plan.saved && !isNaN(Date.parse(plan.saved)) ? t('deskAsk.saved', { date: new Date(plan.saved).toLocaleDateString(lang) }) : '';
  $('deskAskGoS').textContent = t('deskAsk.goSub', { words: deskWords(plan.counts), when, missing: plan.missing ? tn('deskAsk.missing', plan.missing) : '' });
  $('deskAsk').hidden = false; $('deskAskGo').focus({ preventScroll: true });
  return new Promise(ok => { deskAskRes = ok; });
}
$('deskAskGo').onclick = () => deskAnswer(true);
$('deskAskKeep').onclick = () => deskAnswer(false);
$('deskAsk').addEventListener('pointerdown', e => { if (e.target === $('deskAsk')) deskAnswer(false); });
// Пока плашка открыта, Esc и Enter — только её (в захвате: раньше зала и машинки).
addEventListener('keydown', e => {
  if (!deskAskOpen() || (e.key !== 'Escape' && e.key !== 'Enter')) return;
  e.stopImmediatePropagation(); e.preventDefault();
  if (e.key === 'Escape') return deskAnswer(false);
  (document.activeElement?.closest?.('#deskAsk .opt') ?? $('deskAskGo')).click();
}, true);
// file — выбранный .zip; confirm: false — без вопроса (для проверок); reload: false — не перезагружать (для проверок). Возвращает false (отказ, стол прежний) или { counts, missing }.
async function openDesk(file, { confirm = true, reload = true } = {}) {
  if (deskBusy) return false;
  if (state === 'loading') return false;
  if (putting) { hint(t('hint.put.busyFile'), 4000); return false; }
  if (confirm && state !== 'idle') { hint(t('hint.desk.stepAway'), 5000); return false; }
  deskBusy = true; $('deskOpenBtn').disabled = true; let plan;
  try {
    hintNow(t('hint.desk.reading'));
    try { plan = await readDesk(file); } catch (err) { hint(err instanceof DeskError ? err.message : t('hint.desk.badFile'), 10000); console.warn(err); return false; }
    if (confirm) { hintNow(''); if (!await askDesk(plan)) { hint(t('hint.desk.kept'), 3000); return false; } }
    putting = true; const say = progressSay(); let res;
    try { res = await applyDesk(plan, (k, n, f) => say(t('hint.desk.placing', { k, n }), f)); }
    catch (err) { putting = false; hint(err?.message || t('hint.desk.storeFail'), 10000); console.warn(err); return false; }
    // Точка невозврата: новый стол записывается поверх прежнего. stale — чтобы saveNow() (pagehide, таймер) не вернул старое.
    stale = true; clearTimeout(saveT);
    try { localStorage.setItem(KEY, JSON.stringify(res.state)); }
    catch (err) { stale = false; putting = false; await res.undo(); hint(t('hint.desk.writeFail'), 10000); console.warn(err); return false; }
    hintNow(t('hint.desk.sweeping')); const swept = await sweepBooksExcept(res.ids).catch(() => 0);
    hint(t('hint.desk.opened'), 0);
    if (reload) setTimeout(() => location.reload(), 500); else { stale = false; putting = false; }
    return { counts: plan.counts, missing: plan.missing, books: [...res.ids], swept };
  } finally { deskBusy = false; $('deskOpenBtn').disabled = false; }
}
$('deskOpenBtn').onclick = e => { e.currentTarget.blur(); if (!deskBusy) $('deskFile').click(); };
$('deskFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openDesk(f); };
// PDF: каждая страница печатается заново в 150 dpi тем же оттиском, по одной — чтобы не держать в памяти все холсты.
$('pdfBtn').onclick = async () => {
  const btn = $('pdfBtn'); btn.blur();
  if (!ownF || btn.disabled) return;
  const f = ownF, pages = sheetsOf(f.id), title = f.b.title;
  if (!pages.length) return;
  btn.disabled = true; tip(btn, t('folder.binding')); hint(t('hint.pdf.binding'), 2500);
  try {
    const imgs = [], c = document.createElement('canvas');
    for (const s of pages) { drawPage(c, s, 1240); const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', .86)); imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height }); }
    c.width = c.height = 0;
    download(makePdf(imgs, { title }), `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || t('pdf.defaultName')}.pdf`);
  } finally { btn.disabled = false; tip(btn, t('folder.pdf')); }
};
// Перетасовка: экран поверх зала (shuffle-screen.js); «готово» записывает порядок подряд, а верхний справа лист остаётся верхним справа.
$('shuffleBtn').onclick = () => {
  $('shuffleBtn').blur();
  const f = ownF; if (!f || f.b.count < 2) return;
  openShuffle({ sheets: sheetsOf(f.id), onDrop: () => sfx.play('page', { gain: .3 }), onApply: ids => {
    const b = f.b, list = sheetsOf(f.id), next = [...ids.map(id => list.find(s => s.id === id)).filter(Boolean), ...list.filter(s => !ids.includes(s.id))];
    if (next.every((s, k) => s === list[k])) return;
    b.finishTurn();
    const top = list[b.i];
    next.forEach((s, k) => s.order = k + 1);
    if (top) b.i = next.indexOf(top);
    b.refresh(); updateReadCount(); save();
  } });
};

// ——— Указатель ———
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const setRay = e => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); };
// Точка на высоте y (в координатах стола).
const onDesk = (e, y) => { setRay(e); const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0).applyQuaternion(station.quaternion), 0).translate(W(0, y, 0)), new THREE.Vector3()); return p && station.worldToLocal(p); };
// Всё остаётся на столешнице; лист может чуть свисать спереди, как настоящий.
const keepOnDesk = (x, z, mx, mz, front = 0) => [clamp(x, -DESK.hw + mx, DESK.hw - mx), clamp(z, -DESK.hd + mz, DESK.hd - mz + front)];
const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const owner = o => { for (; o; o = o.parent) { const u = o.userData; if (u.stand || u.sheet || u.folder || u.book || u.drawer || u.lamp || u.tw || u.weight || u.globe || u.clock || u.catalog || u.door || u.projector || u.reels) return u; } return null; };
// Видно ли точку у задней стены от глаза: путь не идёт сквозь пол галереи (снизу, из зала) и не сквозь балюстраду.
function clearTo(p) {
  const e = camera.position, d = p.clone().sub(e);
  if (e.y < 0 && p.y > 0) { const t = -e.y / d.y, x = e.x + d.x * t, z = e.z + d.z * t; if (z > RAIL_Z - .15 || Math.abs(x) > SIDE.rail - .15) return false; }
  if (e.z < RAIL_Z && p.z > RAIL_Z) { const t = (RAIL_Z - e.z) / d.z; if (e.y + d.y * t < 1.15) return false; }
  return true;
}
// Шар глобуса под указателем (то, что впереди него, — кольцо, подставка — заслоняет).
const globeAt = () => { const h = ray.intersectObjects(globes.map(g => g.group), true)[0], g = h && owner(h.object)?.globe; return g && clearTo(h.point) ? { g, h } : null; };
const clockAt = () => { const h = hungClock && ray.intersectObject(hungClock.c, true)[0]; return h && clearTo(h.point) ? h : null; };
const catalogAt = () => { const h = catalogs.length && ray.intersectObjects(catalogs.map(c => c.group), true)[0]; return h && h.object.userData.catalog && clearTo(h.point) ? h : null; };
// Лампа на столе нижнего зала под указателем (луч уже наведён): её не заслоняют ни вещь на письменном столе (hit), ни пол галерей.
// Стул под указателем — если глаз внизу, в зале, и ничто из вещей его не заслоняет.
const chairAt = hit => { const c = camera.position.y < -.7 && chairs?.at(ray.ray); return c && !(hit && hit.h.distance < c.d) ? c : null; };
// Стул сдвинули: его тень от солнца (днём) и отражение в зеркале — следом.
let chairShade = 0, chairHinted = false;
const chairMoved = () => { mirrorDirty = true; if (sky?.sun > 0 && performance.now() - chairShade > 120) { chairShade = performance.now(); sun.shadow.needsUpdate = shadowDirty = true; } };
const tableLampAt = hit => { const t = !reading && tableLamps?.at(ray.ray); return t && doorClear(t.point) && !(hit && hit.h.distance < t.d) ? t : null; };
const doorAt = () => { const h = doorParts.length && ray.intersectObjects(doorParts, true)[0]; return h && doorClear(h.point) ? h : null; };
// Видно ли точку двери от глаза: с галерей путь не идёт сквозь их пол (дверь — внизу, под дальней галереей).
function doorClear(p) {
  const e = camera.position; if (e.y <= 0) return true;
  const d = p.clone().sub(e), t = -e.y / d.y, x = e.x + d.x * t, z = e.z + d.z * t;
  return z < RAIL_Z - .15 && z > SIDE.far + .15 && Math.abs(x) < SIDE.rail - .15;
}
// Угол точки на циферблате под указателем — от двенадцати по часовой, как видно из зала; у самой оси — null (там угол скачет).
const dialPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
function clockAngle(e) {
  setRay(e); const c = hungClock.c.getWorldPosition(new THREE.Vector3()); dialPlane.constant = -c.z;
  const p = ray.ray.intersectPlane(dialPlane, new THREE.Vector3());
  return p && Math.hypot(p.x - c.x, p.y - c.y) > .05 ? Math.atan2(c.x - p.x, p.y - c.y) : null;
}
// Нажали на голый стол вплотную к внешнему краю крышки раскрытой книги (не дальше 3 см, как у папки — `coverEdge`): это нажатие на эту крышку, книга закроется ею.
// Расстояние — от луча указателя до самого края крышки (отрезок вдоль книги), а не до точки на столе: у толстой книги стопка закрывает от глаза стол у края, и по столу зона оказалась бы за ней.
const cvA = new THREE.Vector3(), cvB = new THREE.Vector3();
function bookCoverEdge(e) {
  const bt = bookM, bk = bt?.book; if (!bk || state !== 'idle' || bk.pose !== 'open' || bk.moving) return null;
  setRay(e); bk.body.updateWorldMatrix(true, false);
  let best = null, bestD = CARRY.edge ** 2;
  for (const k of [0, 1]) {
    const w = bk.halves[k].w(bk.s.Bw, -.0015); cvA.set(w[0], w[1], -bk.s.Dz / 2).applyMatrix4(bk.body.matrixWorld); cvB.set(w[0], w[1], bk.s.Dz / 2).applyMatrix4(bk.body.matrixWorld);
    const d = ray.ray.distanceSqToSegment(cvA, cvB); if (d <= bestD) { bestD = d; best = { side: k ? 1 : -1 }; }
  }
  return best;
}
// Над книгой (луч уже наведён): закрытую и кожу раскрытой берут рукой; поле крышки раскрытой — нажатие закроет; обрез — «стр. N» и пролист;
// у сгиба (ближе NEAR_FOLD) страницу берут рукой — расправить; остальная страница листает нажатием.
const NEAR_FOLD = .06;
// Какой лист под указателем на обрезе половины k: пока он на самом обрезе — тот, что под ним на деле (так же, как у подписи при наведении); ушёл с обреза — по плоскости поля за ним.
function bookEdgeAt(e, bk, k) {
  setRay(e); const hit = ray.intersectObject(bk.group, true)[0], z = hit && bk.zone(hit);
  return z && z.part === 'edge' && z.k === k ? z : bk.edgeFromRay(ray.ray, k);
}
let bookTipOn = false;
function bookTip(e, page, text) {
  const el = $('bookTip'); if (page == null) { if (bookTipOn) { el.style.display = 'none'; bookTipOn = false; } return; }
  bookTipOn = true; el.style.display = 'block'; el.style.left = e.clientX + 16 + 'px'; el.style.top = e.clientY + 12 + 'px'; el.textContent = text ?? t('book.pageShort', { p: page });
}
const markPages = (bk, g) => 2 * g + 1 <= bk.pages ? `${2 * g}–${2 * g + 1}` : `${2 * g}`;
const bookHolders = () => books.filter(b => b.holder.visible).map(b => b.holder);
function bookCursor(e) {
  if (!bookM || state !== 'idle') { bookTip(e, null); return ''; }
  if (!ray.intersectObjects(bookHolders(), true).length) { bookTip(e, null); return bookM.book.pose === 'open' && !pick(e) && bookCoverEdge(e) ? 'pointer' : ''; }
  const h = pick(e), bk = h?.u.book;
  if (h?.u.stand) { bookTip(e, null); return h.h.object.name === 'frame' ? 'ns-resize' : reading ? '' : 'grab'; }   // рама — тянуть вверх-вниз (ступень), основание — переставить
  if (!bk || !h) { bookTip(e, null); return ''; }
  if (bk.moving) { bookTip(e, null); return bk.pose !== 'open' ? 'grab' : ''; }
  const z = bk.zone(h.h);
  if (z.part === 'mark') { bookTip(e, z.page, t('book.pageShort', { p: markPages(bk, z.g) })); return 'pointer'; }   // закладка: подпись, нажать — перейти, потянуть — вытащить
  if (bk.thing.standing && z.part !== 'edge' && z.z < TILT_BAND_Z) { bookTip(e, null); return 'ns-resize'; }
  if (z.part === 'edge') { bookTip(e, z.page); return 'pointer'; }
  // Пустая раскрытая книга: нажатие на страницу — выбрать PDF (у самого сгиба страницу по-прежнему берут рукой).
  if (bk.pose === 'open' && z.part === 'page' && !bk.thing.file && !putting && nearB(bk.thing) && Math.abs(z.x - bk.G[0]) >= NEAR_FOLD) { bookTip(e, 0, t('book.tipPut')); return 'pointer'; }
  bookTip(e, null);
  if (bk.pose !== 'open') return 'grab';
  return z.part === 'skin' ? 'grab' : z.part === 'cover' ? 'pointer' : z.part === 'page' && Math.abs(z.x - bk.G[0]) < NEAR_FOLD ? 'grab' : '';
}
const bkN = new THREE.Vector3();
let drag = null;
// Книгу берут рукой. Закрытая — как папка (`kind: 'item'`: на столе и в ящиках, в ящик её можно положить), раскрытую за кожу только переставляют (`kind: 'book'`).
function grabBook(bt, e, id, from, touch, hp = null) {
  const p = onDesk(e, bt.drawer !== null ? bt.floor : deskTop) || { x: bt.x.v, z: bt.z.v }; canvasEl.style.cursor = 'grabbing';
  const gp = hp ? station.worldToLocal(hp.clone()).y - deskTop : bookTopH(bt);   // высота хвата над столом (без точки касания — верх книги)
  if (bt.book.pose === 'open') { bt.lift.t = .03; return { kind: 'book', id, from, touch, thing: bt, off: { x: p.x - bt.x.v, z: p.z - bt.z.v }, start: { x: bt.x.t, z: bt.z.t, rot: bt.rot.t }, gp }; }
  bt.lift.t = .05; bt.held = true;
  return { kind: 'item', item: bt, id, from, touch, off: { x: p.x - bt.x.v, z: p.z - bt.z.v }, start: { x: bt.x.t, z: bt.z.t }, y: bt.floor, rel: null, w0: null, gp };
}
// Нажали на голый стол рядом с внешним краем раскрытой папки (не дальше `CARRY.edge`; слева — от края передней крышки, справа — от края задней): это тоже хват крышки,
// если повести к корешку. Листы и пресс-папье ближе к лучу — их pick() находит раньше, сюда дело не доходит.
function coverEdge(e) {
  const p = onDesk(e, deskTop + .01); if (!p) return null;
  for (const f of folders) {
    if (f.pose !== 'open' || !f.b.group.visible || f.drawer !== null || f.filing) continue;
    const lp = f.b.body.worldToLocal(W(p.x, p.y, p.z)), out = Math.abs(lp.x - BINDER.hinge) - BINDER.w;
    if (Math.abs(lp.z) < BINDER.d / 2 && out > 0 && out <= CARRY.edge) return { f, side: lp.x < BINDER.hinge ? -1 : 1, x: lp.x, z: lp.z };
  }
  return null;
}
// Что под указателем. Сам стол заслоняет то, что за ним: сквозь столешницу ящик не достать.
function pick(e) {
  // Луч ищет по матрицам вещей, а их обновляет только рисование кадра: без этой строки вещь, переставленная после
  // последнего кадра (загрузка, скрытая вкладка, экран перетасовки), ловилась бы на прежнем месте.
  station.updateMatrixWorld(true);
  setRay(e);
  // В режиме чтения нарисованы только книга и стол: остальное под указателем не ловится.
  const targets = reading ? [bookM?.holder, deskBody].filter(Boolean) : [...sheets.filter(s => s.mesh?.visible && !s.held).map(s => s.mesh), ...folders.filter(f => f.b.group.visible && !f.filing && !f.held).map(f => f.b.group), ...drawers.map(d => d.group), lamp?.group, tw?.group, weight?.group, ...bookHolders(), deskBody, ...globes.map(g => g.group), hungClock?.c, ...catalogs.map(c => c.group), ...doorParts, nook?.projector, nook?.reels].filter(Boolean);
  let wall = Infinity;
  for (const h of ray.intersectObjects(targets, true)) {
    if (h.distance > wall + .004) break;
    if (!shown(h.object) && !h.object.userData.proxy) continue;
    const u = owner(h.object); if (!u || ((u.globe || u.clock || u.catalog) && !clearTo(h.point)) || (u.door && !doorClear(h.point)) || ((u.projector || u.reels) && !nookClear(h.point))) { wall = Math.min(wall, h.distance); continue; }
    return { h, u };
  }
  return null;
}
// Пресс-папье под указателем (ничто его не заслоняет) — его можно взять, а нажать — выбрать фигурку.
// Лист в каретке под указателем (ничто его не заслоняет) — его можно взять и вынуть.
const twPaperAt = e => { if (!tw?.loaded) return false; const h = pick(e); return !!h?.u.tw && !!tw.paperAt(h.h); };
const weightAt = e => !!weight && !!ray.intersectObject(weight.group, true)[0] && !!pick(e)?.u.weight;
const WEIGHT_HOLD = .025;
const canvasEl = renderer.domElement, chairPlane = new THREE.Plane(), chairTo = new THREE.Vector3();
canvasEl.addEventListener('contextmenu', e => e.preventDefault());
// Пальцы на экране: двумя — щипок (ближе-дальше) и сдвиг.
const touches = new Map();
const pinchNow = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
// Во сколько раз уже обычного виден мир: сдвиг под рукой должен идти вровень с картинкой.
const narrow = () => Math.tan(camera.fov * Math.PI / 360) / Math.tan(FOV * Math.PI / 360);
const screenAxes = () => { const f = forward(), r = new THREE.Vector3().crossVectors(f, Y).normalize(); return { f, r, up: new THREE.Vector3().crossVectors(r, f).normalize() }; };
canvasEl.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && state !== 'loading' && (!drag || ['look', 'pan', 'rtap', 'rtilt'].includes(drag.kind))) { canvasEl.setPointerCapture(e.pointerId); drag = { kind: 'pinch', last: pinchNow() }; return; }
  }
  if (!e.isPrimary) return;
  // Застрявший перенос (кнопку отпустили где-то за окном) — отменяем, а не блокируем всё.
  if (drag) cancel();
  if (state === 'loading') return;
  hoverLeaf(null); if (document.activeElement === $('bookNo')) $('bookNo').blur();
  sfx.wake(); sound.wake?.();
  canvasEl.setPointerCapture(e.pointerId);
  const from = { x: e.clientX, y: e.clientY }, id = e.pointerId, touch = e.pointerType === 'touch', look = () => { drag = reading ? { kind: 'rtap', id, from, touch } : { kind: 'look', id, from, last: from, touch }; };
  if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) { if (!reading) drag = { kind: 'pan', id, from, last: from, touch }; return; }   // при чтении сдвига нет
  if (e.button !== 0) return;
  if (state === 'typing' && tw?.active) { setRay(e); const code = tw.keyAt(ray); if (code) { tw.tap(code); drag = { kind: 'key', id, from, touch }; return; } }
  const hit = pick(e), tl = tableLampAt(hit);
  // Проектор (нажать — «Проектор») и экран на стене (идёт файл — пауза, иначе — «Проектор»): ничто их не заслоняет.
  if (cinema && !reading && state !== 'loading' && !tl && (hit?.u.projector || hit?.u.reels || (!hit?.u.stand && panelAt(hit)))) { drag = { kind: hit?.u.projector ? 'proj' : hit?.u.reels ? 'reels' : 'panel', id, from, touch }; return; }
  // Лампа на столе в зале: за цепочку тянут, как у своей; нажали на саму лампу — она дёргает цепочку сама (повели — это уже взгляд).
  if (tl) { drag = { kind: 'tlamp', lamp: tl.lamp, chain: tl.chain, id, from, touch }; return; }
  const ch = state === 'idle' && chairAt(hit);
  if (ch) {
    const s = chairs.list[ch.i], off = { x: ch.point.x - s.x, z: ch.point.z - s.z }, r = Math.hypot(off.x, off.z);
    // tow — взяли за спинку: на каком расстоянии от середины стула и под каким углом к нему держит рука.
    canvasEl.style.cursor = 'grabbing'; drag = { kind: 'chair', i: ch.i, id, from, touch, y: ch.point.y, off, start: { ...s }, tow: ch.back && r > CHAIR.hold ? { r, a: Math.atan2(off.x, off.z), rot: s.rot } : null };
    return;
  }
  if (!hit) { const bc = bookCoverEdge(e); if (bc) { readOwn = 'book'; bookBarDirty = true; drag = putting ? { kind: 'deny', id, from, touch } : { kind: 'bookcap', id, from, touch, thing: bookM, side: bc.side, cover: true }; return; } const c = state === 'idle' && coverEdge(e); if (c) { ownF = c.f; readOwn = 'folder'; updateReadCount(); drag = { kind: 'edge', id, from, touch, f: c.f, side: c.side, x: c.x, z0: c.z }; return; } return look(); }
  const { h, u } = hit;
  // Лист, торчащий из каретки: потянули дальше пары сантиметров — он вынут и в руке (`pullFromMachine`), нажали без сдвига — как нажатие на машинку.
  if (u.tw && tw?.loaded) { const at = tw.paperAt(h); if (at) { drag = { kind: 'tpaper', id, from, touch, at, point: h.point.clone(), need: Math.max(touch ? 12 : 6, .02 / (2 * camera.position.distanceTo(h.point) * Math.tan(camera.fov * Math.PI / 360) / innerHeight)) }; return; } }
  // Взяли лист, папку или книгу, пока взгляд у машинки, — печать кончается (взгляд остаётся, лист в каретке), и вещь берётся как обычно.
  if (state === 'typing' && (u.sheet || u.folder || u.book)) typeLetGo();
  if (u.globe) {
    // Шар под пальцем: на сколько радиан повернуть за пиксель — чтобы точка под рукой шла вместе с ней; знак — с какой стороны смотрим.
    // Точка касания идёт по кругу радиусом в своё расстояние от оси (у полюса — меньше), но не меньше трети радиуса шара.
    const g = u.globe, c = g.pivot.getWorldPosition(new THREE.Vector3());
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(g.pivot.getWorldQuaternion(new THREE.Quaternion())), toEye = camera.position.clone().sub(c).normalize();
    const r = Math.max(g.R / 3, h.point.clone().sub(c).cross(ax).length());
    const px = 2 * camera.position.distanceTo(h.point) * Math.tan(camera.fov * Math.PI / 360) / innerHeight, { r: right } = screenAxes();
    g.held = true; g.vel = 0; canvasEl.style.cursor = 'grabbing';
    drag = { kind: 'globe', g, id, from, touch, k: px / r * Math.sign(new THREE.Vector3().crossVectors(ax, toEye).dot(right) || 1), t: performance.now() };
    return;
  }
  if (u.clock) {
    // Часы: вести по циферблату по кругу — минутная стрелка идёт за рукой (круг — час), с ней солнце и свет в зале.
    canvasEl.style.cursor = 'grabbing';
    drag = { kind: 'clock', id, from, touch, a: clockAngle(e) };
    return;
  }
  if (u.catalog) { drag = { kind: 'cat', id, from, touch, cat: u.catalog, i: h.instanceId }; return; }
  // Подставка: за раму потянули вверх-вниз — ступень (нажатие без движения: при чтении — лист по половинам экрана); за основание — переставить книгу вместе с ней (при чтении — как нажатие мимо книги).
  if (u.stand) {
    const bt = u.thing; readOwn = 'book'; bookBarDirty = true; setActive(bt);
    if (h.object.name === 'frame') { drag = { kind: 'rtilt', id, from, y0: from.y, touch, thing: bt, half: reading, n: 0, moved: false }; return; }
    drag = reading ? { kind: 'rtap', id, from, touch } : putting ? { kind: 'deny', id, from, touch } : grabBook(bt, e, id, from, touch, h.point); return;
  }
  if (u.book) {
    // Закрытую тянут (едет) или нажимают (раскроется; нажали на обрез — на этом листе). У раскрытой: за кожу — перенести; нажатие на поле крышки — закрыть этой крышкой;
    // страница — нажать (перелистнётся), потянуть к корешку (рукой), у сгиба провести от корешка (расправить); обрез — пролистать к листу.
    const bt = u.book.thing, bk = bt.book, open = bk.pose === 'open', z = bk.zone(h); readOwn = 'book'; bookBarDirty = true; bookTip(e, null); if (open) setActive(bt);
    // Закладка: нажали — перейти к ней, потянули — вытащить из книги (на сколько вытянули — по движению руки, в метрах у книги).
    if (z.part === 'mark' && !putting) { setRay(e); drag = { kind: 'bmark', id, from, touch, thing: bt, mark: z.mark, moved: false, mpp: 2 * camera.position.distanceTo(h.point) * Math.tan(camera.fov * Math.PI / 360) / innerHeight }; return; }
    // Пока файл копируется и открывается, страницы, обрез и крышки не слушаются (переставить книгу за кожу можно).
    if (putting && (z.part === 'edge' || z.part === 'cover' || z.part === 'page') && (open || z.part === 'edge')) { busyNote(); drag = { kind: 'deny', id, from, touch }; return; }
    // Книга на подставке: верхний край (3,5 см сверху) тянут вверх и вниз — меняется ступень; нажатие без движения листает, как нажатие на страницу.
    if (bt.standing && z.part !== 'edge' && z.z < TILT_BAND_Z) { drag = { kind: 'rtilt', id, from, y0: from.y, touch, thing: bt, flip: bt.file && z.part === 'page' ? (z.side > 0 ? 1 : -1) : 0, n: 0, moved: false }; return; }
    if (z.part === 'edge') { drag = { kind: 'bedge', id, from, touch, thing: bt, k: z.k, last: z, moved: false, i0: open ? spreadOf(bk) : null }; return; }
    if (open && z.part === 'cover') { drag = { kind: 'bookcap', id, from, touch, thing: bt, side: z.side, cover: true }; return; }
    if (open && z.part === 'page') {
      setRay(e); drag = { kind: 'bpage', id, from, touch, thing: bt, dir: z.side > 0 ? 1 : -1, y: h.point.y, pt: h.point.clone(), hx0: z.x, near: Math.abs(z.x - bk.G[0]) < NEAR_FOLD, p0: bk.pressed, mode: null };
      if (drag.near && !touch) canvasEl.style.cursor = 'grabbing';
      return;
    }
    if (reading) { drag = { kind: 'rtap', id, from, touch }; return; }   // в режиме чтения книгу не переносят: нажатие листает по половинам экрана
    drag = grabBook(bt, e, id, from, touch, h.point);
    return;
  }
  if (u.door) { drag = { kind: 'door', id, from, touch }; return; }

  if (u.sheet) {
    const s = u.sheet, local = s.mesh.worldToLocal(h.point.clone()), p = onDesk(e, s.floor) || { x: s.px.v, z: s.pz.v };
    s.grab = { x: local.x, z: local.z }; s.held = true; s.carry = null; s.landing = 0; s.low = false; s.tilt.t = 0;
    // Лежащий под плитой пресс-папье, основанием машинки, подставкой лампы или папкой сперва «держится» (срыв), потом выезжает плашмя и только тогда поднимается в руку.
    const pin = s.drawer === null ? holders().filter(o => hitsSolid(sheetBox(s), o.shape(), -CARRY.under)) : [];
    // Лист поднимается, только когда его повели: нажатие без сдвига оставляет его лежать (к нему подходит взгляд).
    drag = { kind: 'item', item: s, id, from, touch, start: { x: s.px.t, z: s.pz.t }, y: s.floor, pin, pinF: pin.filter(o => o.f).map(o => o.f), H0: { x: p.x, z: p.z }, hand: { clientX: e.clientX, clientY: e.clientY }, stage: null, lifted: false };
  } else if (u.folder) {
    const f = u.folder, b = f.b;
    if (b.pose === 'open') {
      // Раскрытая: по тому, во что попал луч, — лист (перелистнуть, листать рукой или вынуть), поле крышки (закрыть ею) или кожа (перенести папку).
      ownF = f; readOwn = 'folder'; updateReadCount();
      const z = b.zone(h);
      // Лист взяли, но ещё не повели: он приподнят (чуть сильнее, чем под указателем) и ждёт — к корешку, наружу или отпустят.
      // Придавленный пресс-папье лист не поднимается и не вынимается: нажатие и движение лишь говорят об этом.
      if (z.part === 'page') {
        const locked = pressedHalves(f).includes(z.side);
        if (!locked && nearF(f)) b.perk(z.side, PERK.held);
        drag = { kind: 'leaf', f, side: z.side, id, from, touch, at: z, y: station.worldToLocal(h.point.clone()).y, locked }; if (!touch && !locked) canvasEl.style.cursor = 'grabbing'; return;
      }
      // Крышка: потянули — закрывается ею; нажали на голую (на первом листе — переднюю, после последнего — заднюю) — закрывается сразу, и издали тоже.
      if (z.part === 'cover') {
        if (coverBlocked(f, z.side)) { drag = { kind: 'deny', id, from, touch }; return; }
        b.grabCover(z.side, z.x); drag = { kind: 'cover', f, side: z.side, id, from, touch, bare: !b.turn && (z.side < 0 ? b.nl === 0 : b.nr === 0) }; return;
      }
    }
    const p = onDesk(e, f.floor) || { x: f.px.v, z: f.pz.v }; f.lift.t = .05; f.held = true;
    // Пресс-папье на этой папке едет с ней (rel — где оно на ней); w0 — пресс-папье до переноса: нажатие без сдвига возвращает всё на место.
    const w0 = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t }, rel = w0 && baseOf(w0.x, w0.z) === f ? rideRel(f, w0) : null; ride = rel ? { f } : null;
    drag = { kind: 'item', item: f, id, from, touch, off: { x: p.x - f.px.v, z: p.z - f.pz.v }, start: { x: f.px.t, z: f.pz.t }, y: f.floor, rel, w0, label: !!h.object.userData.label, gp: station.worldToLocal(h.point.clone()).y - deskTop };
  } else if (u.drawer) drag = { kind: 'drawer', d: u.drawer, id, from, touch, start: u.drawer.open.t };
  else if (u.lamp) {
    if (h.object.userData.proxy || lamp.chain.children.includes(h.object)) { drag = { kind: 'chain', id, from, touch }; return; }
    const p = onDesk(e, deskTop) || { x: lampM.x.v, z: lampM.z.v }; lampM.lift.t = .03;
    drag = { kind: 'mover', mover: lampM, r: .14, id, from, touch, off: { x: p.x - lampM.x.v, z: p.z - lampM.z.v }, start: { x: lampM.x.t, z: lampM.z.t, rot: lampM.rot.t }, gp: station.worldToLocal(h.point.clone()).y - deskTop };
  } else if (u.weight) {
    // Плоскость — на высоте точки, за которую взяли. За фигурку и у середины плиты (ближе 2,5 см) пресс-папье едет ровно, за край и угол плиты —
    // разворачивается следом за рукой, как стул за спинку (tow: на каком расстоянии от середины и под каким углом к ней рука).
    const wy = station.worldToLocal(h.point.clone()).y, p = onDesk(e, wy) || { x: weightM.x.t, z: weightM.z.t }, off = { x: p.x - weightM.x.t, z: p.z - weightM.z.t }, r = Math.hypot(off.x, off.z);
    weightM.lift.t = .02; canvasEl.style.cursor = 'grabbing';
    drag = { kind: 'mover', mover: weightM, r: .07, id, from, touch, off, weight: true, y: wy, gp: wy - deskTop, start: { x: weightM.x.t, z: weightM.z.t, rot: weightM.rot.t }, tow: h.object === weight.slab && r > WEIGHT_HOLD ? { r, a: Math.atan2(off.x, off.z), rot: weightM.rot.t } : null };
  } else if (u.tw) {
    const p = onDesk(e, deskTop) || { x: twM.x.v, z: twM.z.v }; twM.lift.t = .02;
    drag = { kind: 'mover', mover: twM, r: .22, id, from, touch, off: { x: p.x - twM.x.v, z: p.z - twM.z.v }, tw: true };
  }
}, true);
// Над открытым ящиком предмет ложится на его дно.
let overDrawer = null;
const chainAt = new THREE.Vector3();
addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag?.kind === 'pinch') {
    if (touches.size < 2) return;
    const now = pinchNow(), l = drag.last, { r, up } = screenAxes();
    if (reading) { if (now.d > 0 && l.d > 0) readZoomBy(now.d / l.d); drag.last = now; return; }
    const g = .0016 * narrow(); moveEye(r.multiplyScalar(-(now.x - l.x) * g).addScaledVector(up, (now.y - l.y) * g), true);
    if (now.d > 0 && l.d > 0) zoomAt(now.x, now.y, Math.log(now.d / l.d) * 1.6);
    drag.last = now; return;
  }
  if (state === 'typing' && tw?.active && !e.buttons) { setRay(e); canvasEl.style.cursor = tw.keyAt(ray) ? 'pointer' : twPaperAt(e) ? 'grab' : ''; return; }
  // Над глобусом — ладонь: его можно крутить.
  if (reading && state === 'idle' && !drag && !e.buttons && e.pointerType === 'mouse') { setRay(e); canvasEl.style.cursor = bookCursor(e) || (bookM.file ? 'pointer' : ''); }
  else if (state === 'idle' && !drag && !e.buttons && e.pointerType === 'mouse' && (globes.length || hungClock || catalogs.length || doorParts.length || tableLamps || chairs || cinema)) { setRay(e); canvasEl.style.cursor = globeAt() || clockAt() ? 'grab' : catalogAt() || doorAt() || cinemaAt(e) || (tableLampAt(null) && tableLampAt(pick(e))) ? 'pointer' : chairAt(null) && chairAt(pick(e)) ? 'grab' : weightAt(e) || twPaperAt(e) ? 'grab' : bookCursor(e); }
  ytHover(cinema?.mode === 'web' && state === 'idle' && !reading && !drag && !e.buttons && e.pointerType === 'mouse' && !cinemaAskOpen() && (setRay(e), panelAt(pick(e))));
  if (!drag) { hoverLeaf(e); hoverLabel(e); }
  if (!drag || e.pointerId !== drag.id) return;
  if (e.pointerType === 'mouse' && !e.buttons) return endDrag(e);
  const dx = e.clientX - (drag.last || drag.from).x, dy = e.clientY - (drag.last || drag.from).y;
  if (drag.kind === 'look') { const g = .005 * camera.fov / FOV; yaw.t += dx * g; pitch.t = clamp(pitch.t + dy * g, -1.35, .9); drag.last = { x: e.clientX, y: e.clientY }; viewOn(null); }
  else if (drag.kind === 'pan') {
    const { r, up } = screenAxes();
    const g = .0016 * narrow(); moveEye(r.multiplyScalar(-dx * g).addScaledVector(up, dy * g), true); drag.last = { x: e.clientX, y: e.clientY };
  } else if (drag.kind === 'rtap') {
    // Тянут мышью при чтении — меняется угол взгляда (обход книги и наклон); короткое нажатие по-прежнему листает.
    if (!drag.orb && Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) < (drag.touch ? 12 : 6)) return;
    drag.orb = true; readOrbitBy(dx, dy); drag.last = { x: e.clientX, y: e.clientY };
  } else if (drag.kind === 'rtilt') {
    // Верх книги вверх — круче, вниз — площе: ступень на каждые TILT_PX пикселей; упёрлись в край хода — отсчёт идёт от места, где упёрлись.
    const d = drag, want = Math.round((d.from.y - e.clientY) / TILT_PX); if (Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    while (d.n !== want) { const k = want > d.n ? 1 : -1; if (!standStep(d.thing, -k)) { d.from = { x: d.from.x, y: e.clientY + d.n * TILT_PX }; break; } d.n += k; }
  } else if (drag.kind === 'item') {
    const it = drag.item, isSheet = it instanceof Sheet;
    drag.hand = { clientX: e.clientX, clientY: e.clientY };
    if (isSheet && !drag.lifted) {
      // Лист идёт за рукой, как только указатель с нажатой кнопкой сдвинулся на 3–4 точки (на пальце — чуть больше); взгляд при этом не трогается.
      if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) < (drag.touch ? CARRY.gripTouch : CARRY.grip)) return;
      drag.lifted = true; drag.stage = drag.pin.length ? 'break' : it.drawer !== null ? 'drawer' : 'carry'; if (drag.stage === 'carry') enterCarry(drag, it); else if (it.drawer !== null) startDD(it, it.dr);
    }
    setRay(e);
    // Папку из ящика поднимают: тот же путь, что и листу (повели дальше нажатия — вещь выходит из ящика).
    if (!isSheet && it.drawer !== null && !it.dd && Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= (drag.touch ? 12 : 6)) startDD(it, it.dr);
    // Раскрытую папку в ящик не положить: сначала закрыть. Ящик, который вещь не возьмёт (`drawerGate`), для неё — не ящик: она остаётся в руке над ним.
    const hit = !isSheet && it.pose === 'open' ? null : drawers.find(dr => dr.hit(ray.ray, station, .03)), gate = hit && drawerGate(hit, it), d = gate?.ok ? hit : null;
    overDrawer = d || null;
    if (d) {
      // Место на дне — целиком внутри, ровно вдоль стенок; а путь к нему — `drawerStep`. Пресс-папье, что ехало на папке, остаётся на столе.
      if (ride?.f === it) { ride = null; drag.rel = null; }
      const q = d.hit(ray.ray, station, .03), t = d.tray, mx = Math.min(gate.ex + .004, (t.x1 - t.x0) / 2), mz = Math.min(gate.ez + .004, (t.z1 - t.z0) / 2);
      it.pr.t = gate.b + clamp(it.pr.t - gate.b, -.03, .03);
      if (!it.dd) startDD(it, d);
      it.dd.want = d; it.dd.goal = { x: clamp(q.x, t.x0 + mx, t.x1 - mx), z: clamp(q.z, t.z0 + d.offset + mz, t.z1 + d.offset - mz) }; drag.dgate = gate;
    } else if (it.dd) it.dd.want = null;
    else {
      // Лист несёт carrySheet каждый кадр; папку и книгу — carryStep (над всем).
      if (!isSheet && !drag.carry && it.drawer === null && gripFar(drag, e)) startCarry(drag, it);
      it.floorGoal = deskTop + .002;
    }
  } else if (drag.kind === 'chair') {
    // Стул едет по полу за точкой, за которую его взяли.
    setRay(e); const p = ray.ray.intersectPlane(chairPlane.set(Y, -drag.y), chairTo);
    if (p) {
      const s = chairs.list[drag.i], t = drag.tow, dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
      // За спинку: середина стула идёт за рукой на прежнем расстоянии, а сам он разворачивается так, чтобы рука осталась на своём месте.
      if (!t) chairs.move(drag.i, p.x - drag.off.x, p.z - drag.off.z);
      else if (d > 1e-4) { s.rot = t.rot + Math.atan2(dx, dz) - t.a; drag.turned = true; chairs.move(drag.i, p.x - dx / d * t.r, p.z - dz / d * t.r); }
      chairMoved();
    }
  } else if (drag.kind === 'book') {
    drag.hand = { clientX: e.clientX, clientY: e.clientY }; if (!drag.carry && gripFar(drag, e)) startCarry(drag, drag.thing);
  } else if (drag.kind === 'bedge') {
    // Обрез: повели — пролист вслед за рукой (у закрытой повели — её просто двигают), у указателя «стр. N».
    const d = drag, bk = d.thing.book, far = Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y);
    if (bk.pose !== 'open') {
      if (far >= (d.touch ? 12 : 6)) { bookTip(e, null); drag = grabBook(d.thing, e, d.id, d.from, d.touch); }
      return;
    }
    if (!d.moved && far > 5) d.moved = true;
    // Пока не повели, остаётся лист из нажатия (тот же, что в подписи при наведении): нажатие и подпись не расходятся.
    const z = d.moved ? bookEdgeAt(e, bk, d.k) : null; if (z) d.last = z;
    if (z) bk.go(z.target, { follow: true });
    bookTip(e, d.last.page);
  } else if (drag.kind === 'bmark') {
    const d = drag, far = Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y);
    if (!d.moved && far > (d.touch ? 12 : 6)) { d.moved = true; canvasEl.style.cursor = 'grabbing'; }
    if (d.moved && d.thing.book.marks.list.includes(d.mark)) { d.mark.pull.set(far * d.mpp); d.thing.book.marks.layout(); shadowDirty = true; }
  } else if (drag.kind === 'bpage') {
    // Страница: потянули к корешку — листаем рукой; у сгиба повели от корешка наружу — расправляем (4 см пути — полностью); иначе нажатие.
    const d = drag, bk = d.thing.book; setRay(e);
    // Плоскость — страницы (у книги на подставке она наклонена), через ту точку, за которую взяли.
    const P = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(bkN.set(0, 1, 0).transformDirection(bk.body.matrixWorld), d.pt), new THREE.Vector3()); if (!P) return;
    const x = bk.body.worldToLocal(P).x;
    if (!d.mode && Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) > (d.touch ? 12 : 6)) {
      const out = (x - d.hx0) * d.dir;
      if (d.near && out > 0) d.mode = 'press'; else if (bk.grab(d.dir, x)) d.mode = 'grab'; else d.mode = 'dead';
    }
    if (d.mode === 'press') bk.press(clamp(d.p0 + (x - d.hx0) * d.dir / .04, 0, 1)); else if (d.mode === 'grab') bk.drag(x);
  } else if (drag.kind === 'mover') {
    const m = drag.mover;
    // Лампу и пресс-папье несут над всем (`carryStep`); машинка идёт по столу и толкает всё перед собой (`steerBody`).
    if (!drag.tw) { drag.hand = { clientX: e.clientX, clientY: e.clientY }; if (!drag.carry && gripFar(drag, e)) startCarry(drag, m); return; }
    const q = onDesk(e, deskTop); if (!q) return;
    const [x, z] = keepOnDesk(q.x - drag.off.x, q.z - drag.off.z, drag.r * .8, drag.r * .6); steerBody(m, x, z);
  } else if (drag.kind === 'tpaper') {
    if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= drag.need) pullFromMachine(drag, e);
  } else if (drag.kind === 'leaf') {
    // Лист раскрытой папки: потянули к корешку — листаем рукой; наружу (от корешка или вдоль него) на `PULL` от точки хвата — лист отделяется и идёт в руке.
    // Пока рука не ушла ни туда ни сюда, лист лишь приподнят и ждёт; отпустили на месте — это нажатие.
    const d = drag, f = d.f, b = f.b, q = onDesk(e, d.y); if (!q) return;
    const lp = b.body.worldToLocal(W(q.x, q.y, q.z)), dx = (lp.x - d.at.x) * d.side, dz = lp.z - d.at.z, far = Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) >= (d.touch ? 12 : 6);
    if (d.locked) { if (far && Math.max(dx, Math.abs(dz)) >= PULL) { flipBlocked(f); drag = { kind: 'deny', id: d.id, from: d.from, touch: d.touch }; } return; }
    if (dx < 0 && -dx > Math.abs(dz) * .5) { if (far && !flipBlocked(f) && b.grab(d.side, d.at.x)) { drag = { kind: 'page', id: d.id, from: d.from, f, dir: d.side, touch: d.touch }; b.drag(lp.x); } else if (far) { b.perk(0); drag = { kind: 'deny', id: d.id, from: d.from, touch: d.touch }; } }
    else if (Math.max(dx, Math.abs(dz)) >= PULL) pullOut(d, q, e);
  } else if (drag.kind === 'edge') {
    // Нажали на стол рядом с внешним краем раскрытой папки: повели к корешку — крышка идёт за рукой, в другую сторону — это взгляд, как раньше.
    const d = drag, q = onDesk(e, deskTop + .01); if (!q || Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < (d.touch ? 12 : 6)) return;
    const lp = d.f.b.body.worldToLocal(W(q.x, q.y, q.z)), dx = (lp.x - d.x) * -d.side, dz = lp.z - d.z0;
    if (dx > 0 && dx > Math.abs(dz) * .5) { if (coverBlocked(d.f, d.side)) { drag = { kind: 'deny', id: d.id, from: d.from, touch: d.touch }; return; } d.f.b.grabCover(d.side, d.x); drag = { kind: 'cover', f: d.f, side: d.side, id: d.id, from: d.from, touch: d.touch }; d.f.b.dragCover(lp.x); }
    else drag = { kind: 'look', id: d.id, from: d.from, last: d.from, touch: d.touch };
  } else if (drag.kind === 'cover') {
    const q = onDesk(e, deskTop + .01); if (q) drag.f.b.dragCover(drag.f.b.body.worldToLocal(W(q.x, q.y, q.z)).x);
  } else if (drag.kind === 'drawer') drag.d.open.t = clamp(drag.start + (e.clientY - drag.from.y) / 160, 0, 1);
  else if (drag.kind === 'globe') {
    // Скорость — по последним движениям: отпустили на ходу — шар докручивается сам.
    const g = drag.g, now = performance.now(), da = dx * drag.k, dts = Math.max(1, now - drag.t) / 1000;
    g.angle += da; g.vel = clamp(g.vel * .5 + .5 * da / dts, -12, 12); drag.t = now; drag.last = { x: e.clientX, y: e.clientY };
    if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= (drag.touch ? 12 : 6)) drag.moved = true;
    g.pivot.quaternion.copy(g.base).multiply(spinQ.setFromAxisAngle(Y, g.angle));
  } else if (drag.kind === 'clock') {
    const a = clockAngle(e); if (a === null) return;
    // Повели — возврат к настоящему (если шёл) останавливается: стрелки снова в руке.
    if (drag.a !== null) { const da = THREE.MathUtils.euclideanModulo(a - drag.a + Math.PI, Math.PI * 2) - Math.PI; timeShift += da / (Math.PI * 2) * 3600e3; timeDirty = true; timeBack = false; }
    drag.a = a; if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= (drag.touch ? 12 : 6)) drag.moved = true;
  }
  else if (drag.kind === 'tlamp') {
    if (drag.chain) { const perPx = 2 * camera.position.distanceTo(drag.lamp.head) * Math.tan(camera.fov * Math.PI / 360) / innerHeight; drag.lamp.hold(Math.max(0, e.clientY - drag.from.y) * perPx); }
    else if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= (drag.touch ? 12 : 6)) drag = { kind: 'look', id: drag.id, from: drag.from, last: { x: e.clientX, y: e.clientY }, touch: drag.touch };
  }
  // Нажали на дверь или на ящик каталога и повели — это уже взгляд, а не нажатие: дверь с обрамлением занимает полстены,
  // и взгляд, начатый с неё, раньше не поворачивался вовсе.
  else if (drag.kind === 'door' || drag.kind === 'cat' || drag.kind === 'proj' || drag.kind === 'panel') {
    if (Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= (drag.touch ? 12 : 6)) drag = { kind: 'look', id: drag.id, from: drag.from, last: { x: e.clientX, y: e.clientY }, touch: drag.touch };
  }
  else if (drag.kind === 'chain') {
    // Цепочка идёт за рукой вниз — столько же сантиметров, сколько прошла рука на экране.
    const dist = camera.position.distanceTo(lamp.chain.getWorldPosition(chainAt)), perPx = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / innerHeight;
    lamp.hold(Math.max(0, e.clientY - drag.from.y) * perPx);
  } else if (drag.kind === 'page') {
    const f = drag.f, p = onDesk(e, deskTop + .01);
    if (p) f.b.drag(f.b.group.worldToLocal(W(p.x, p.y, p.z)).x);
  }
});
// Лист вытянули из раскрытой папки: он отделяется, становится свободным листом в руке и догоняет её (дальше — обычный перенос листа).
// Лист появляется там, где лежала страница, а рука держит его за ту же точку.
const PULL = .015;
function pullOut(d, q, e) {
  const f = d.f, b = f.b; b.perk(0, 0, true); const s = unshelve(f, d.side); if (!s) { drag = null; return; }
  const at = (x, z) => station.worldToLocal(b.body.localToWorld(new THREE.Vector3(x, 0, z))), c = at(BINDER.axis + d.side * A4.w / 2, 0), press = at(d.at.x, d.at.z);
  liftToTop(s); s.px.set(c.x); s.pz.set(c.z); s.pr.set(f.pr.v); s.lift.set(f.floor - s.floor + b.openHeight(d.side));
  const off = { x: press.x - c.x, z: press.z - c.z }, co = Math.cos(s.pr.v), si = Math.sin(s.pr.v);
  s.grab = { x: off.x * co - off.z * si, z: off.x * si + off.z * co }; s.held = true; calmSheet(s);
  drag = { kind: 'item', item: s, id: d.id, from: d.from, touch: d.touch, start: { x: c.x, z: c.z }, y: s.floor, pin: [], pinF: [], hand: { clientX: e.clientX, clientY: e.clientY }, lifted: true };
  enterCarry(drag, s, true); drag.snap = true;
  sfx.play('page', { gain: .6, rate: 1 });
}
// Лист вынули из каретки рукой: он сразу обычный лист в руке (его несёт тот же `carrySheet`, что любой другой) и висит там, где торчал; пока он над основанием машинки,
// она ему не преграда (`drag.over`), он идёт выше неё и опускается к столу, выйдя за её край. В машинке при печати встаёт чистый лист, иначе каретка пустая.
function pullFromMachine(d, e) {
  if (!tw.draft) { drag = null; return hint(t('hint.sheet.empty'), 3000); }
  const out = tw.eject({ refill: true, quick: true }); if (!out) { drag = null; return; }
  const P = station.worldToLocal(d.point.clone()), r = twM.rot.t, cy = Math.cos(r), sy = Math.sin(r), gx = (d.at.u - .5) * A4.w, gz = (.5 - d.at.v) * A4.h;
  const s = addSheet({ id: nextId++, lines: out.lines, fmt: out.fmt, seed: out.seed, x: 0, z: 0, rot: r }, out.img);
  s.grab = { x: gx, z: gz }; s.px.set(P.x - (gx * cy + gz * sy)); s.pz.set(P.z - (-gx * sy + gz * cy)); s.pr.set(r); s.lift.set(Math.max(0, P.y - s.floor));
  s.held = true; calmSheet(s);
  drag = { kind: 'item', item: s, id: d.id, from: d.from, touch: d.touch, start: { x: s.px.v, z: s.pz.v }, y: s.floor, pin: [], pinF: [], hand: { clientX: e.clientX, clientY: e.clientY }, lifted: true, over: twM };
  enterCarry(drag, s, true); canvasEl.style.cursor = 'grabbing';
  sfx.play('page', { gain: .6, rate: 1 }); saveNow(); twBusyUntil = performance.now() + 1800;
}
// Указатель (мышь, без нажатия) над верхним листом своей раскрытой папки, пока взгляд рядом (`nearF`): лист «оживает» — наружный край приподнимается пружиной,
// курсор — ладонь. Ушёл — лист ложится. Пересчитывается, только когда поменялся лист под указателем.
let hov = null;
function hoverLeaf(e) {
  let f = null, side = 0;
  if (e && state === 'idle' && !e.buttons && e.pointerType === 'mouse' && e.target === canvasEl && ownF?.pose === 'open' && ownF.b.paged && nearF(ownF)) {
    const hit = pick(e);
    // Лист под плитой пресс-папье не приподнимается (он придавлен).
    if (hit?.u.folder === ownF) { const z = ownF.b.zone(hit.h); if (z.part === 'page' && !pressedHalves(ownF).includes(z.side)) { f = ownF; side = z.side; } }
  }
  if (hov && hov !== f) hov.b.perk(0);
  if (f && f.b.perkSide !== side) f.b.perk(side);
  hov = f; if (f) canvasEl.style.cursor = 'grab';
}
canvasEl.addEventListener('pointerleave', () => hoverLeaf(null));
// Папка, над которой держат лист, подсказывает, что сюда можно положить: закрытая чуть приоткрывает верхнюю крышку, у раскрытой на стопке, куда лист ляжет,
// появляется его бледный призрак (side — на какой половине). Крышка приоткрывается не больше чем на 4°, лист при этом идёт выше её края (`carryTops`).
let lit = null, litSide = 0;
function highlight(f, side = 0) {
  if (f === lit && side === litSide) return;
  if (lit && lit !== f) { if (lit.pose === 'open') lit.b.ghost(0); else lit.b.peek(0); }
  lit = f; litSide = side;
  if (f) { if (f.pose === 'open') f.b.ghost(side); else f.b.peek(CARRY.peek); }
}
// Папка под листом: у раскрытой — обе половины.
const folderUnder = (s, skip = [], at = { x: s.px.t, z: s.pz.t }) => folders.find(f => { if (!f.b.group.visible || f.drawer !== null || skip.includes(f)) return false; const p = f.b.group.worldToLocal(W(at.x, deskTop, at.z)); return Math.abs(p.x) < f.foot[0] * .6 && Math.abs(p.z) < BINDER.d * .6; });
// ——— Лист в руке ———
// Взятый лист несут над столом плашмя и невысоко (`carrySheet` — каждый кадр): нижняя точка листа в `CARRY.lift` над тем, что под ним (стол, лежащие листы, папка с поднятой
// крышкой), — берётся самое высокое под всем листом с запасом `CARRY.room` по краям (`carryTops`: прямоугольники вещей). Высота — критически затухающая пружина,
// поэтому лист поднимается быстро и вниз не проваливается. Точка, за которую взяли, лежит на луче указателя на высоте листа — лист всегда под указателем.
// Высокие вещи — преграды: основание машинки, круг подставки лампы, плита пресс-папье (с запасом `CARRY.near`); книги — нет, над ними лист проносят (`carryTops`, `bookTopH`). К указателю лист идёт шагами не длиннее `CARRY.step`;
// задев преграду, выталкивается из неё и скользит вдоль, упёрся — стоит; когда путь свободен, догоняет руку плавно (`CARRY.catchUp`). Свеситься за край стола в руке
// можно, на стол лист ложится при отпускании (`landSpot`). Наклон только отклик на скорость руки, до 3°.
// Лист, лежащий под плитой пресс-папье, основанием машинки, подставкой лампы или папкой, сперва «держится»: пока рука не прошла `CARRY.tear`, он сдвигается
// лишь на `CARRY.hold` её пути и лежит плашмя (срыв, `break`), потом идёт за рукой плашмя по столу, пока не выйдет из-под того, что его держало (она ему не преграда), и поднимается.
const sheetBox = s => ({ x: s.px.v, z: s.pz.v, r: s.pr.v, hw: A4.w / 2, hd: A4.h / 2 });
const folderBox = f => ({ x: f.px.v, z: f.pz.v, r: f.pr.v, hw: f.foot[0] / 2, hd: f.foot[1] / 2 });
// То, что может лежать на листе: пресс-папье, основание машинки, подставка лампы, папки — каждая с рамкой (`shape`); у папки — она сама (`f`); key — чья вещь.
const holders = () => [
  weightM && { key: weightM, shape: () => slabBox(weightM.x.v, weightM.z.v, weightM.rot.v, 0) },
  ...bodies().map(b => ({ key: b.m, shape: () => bodyShape(b, { x: b.m.x.v, z: b.m.z.v, r: b.m.rot.v }) })),
  ...folders.filter(f => f.b.group.visible && f.drawer === null && !f.filing && !f.held).map(f => ({ key: f, f, shape: () => folderBox(f) })),
].filter(Boolean);
const grow = (o, m) => o.R !== undefined ? { ...o, R: o.R + m } : { ...o, hw: o.hw + m, hd: o.hd + m };
// Что лежит на столе под листом: лежащие листы и папки, у каждой вещи — рамка и высота верха над столешницей; у раскрытой папки — две рамки, по половине.
// top(x, z) — настоящая высота под точкой (у папки — по её поверхности с крышкой, `Folder.surface`), under(рамка) — самая большая высота под рамкой.
// Пресс-папье, машинка и лампа листу не нужны: на них он не заходит (`carryWalk`); вещи, которые несут над всем (`carryStep`), берут их тоже (`all`). Для одного листа считается раз в кадр (`topsOf`).
function carryTops(skip, all = false) {
  // h — высота верха над столешницей (hf — считается, когда понадобится: у книги, лампы и пресс-папье это обход всех их частей); R — круг вместо рамки; bot — высота низа:
  // под вещью, что висит выше (абажур лампы), можно пройти низко.
  const items = [], add = (x, z, r, hw, hd, h, f, extra) => items.push({ x, z, r, c: Math.cos(r), s: Math.sin(r), hw, hd, h, f, ...extra });
  for (const s of sheets) if (s !== skip && s.mesh?.visible && s.drawer === null && s.binder === null) add(s.px.v, s.pz.v, s.pr.v, A4.w / 2, A4.h / 2, s.floor - deskTop + .0006 + Math.max(0, s.lift.v));
  for (const f of folders) {
    if (f === skip || !f.b.group.visible || f.drawer !== null || f.held) continue;
    const base = f.floor - deskTop + Math.max(0, f.lift.v) + f.b.lidRise() + .001, [w, d] = f.foot;
    if (f.pose === 'open') for (const side of [-1, 1]) { const t = toTable({ x: f.px.v, z: f.pz.v, r: f.pr.v }, { x: side * w / 4, z: 0 }); add(t.x, t.z, f.pr.v, w / 4, d / 2, base + f.b.openHeight(side), f); }
    else add(f.px.v, f.pz.v, f.pr.v, w / 2, d / 2, base + f.b.thickness, f);
  }
  // Книги (с подставкой) — не преграда, лист проносят над ними (пользователь 2026-11-21: «книги не дают пройти… можно именно над книгами сверху проносить»): рамка книги
  // и высота её верха; отпущенный над книгой лист ложится рядом (`landSpot`).
  for (const b of books) if (b !== skip && b.drawer === null && b.holder.visible) { const o = bodyShape({ c: bookRect(b) }, { x: b.x.v, z: b.z.v, r: b.rot.v }); add(o.x, o.z, o.r, o.hw, o.hd, undefined, null, { hf: () => bookTopH(b) }); }
  // Для вещи в руке (`carryStep`) ещё и пресс-папье: над ним её проносят; пресс-папье, что едет на несомой папке, ей не преграда. Машинка и лампа сюда не входят:
  // над ними не проносят, они — стены (`carryStep`, `walk`).
  if (all) {
    if (weightM && weightM !== skip && ride?.f !== skip) { const o = slabBox(weightM.x.v, weightM.z.v, weightM.rot.v, 0); add(o.x, o.z, o.r, o.hw, o.hd, undefined, null, { hf: () => topAbove(weight.group) }); }
  }
  const hOf = it => it.h ??= it.hf();
  return {
    top(x, z) {
      let m = 0;
      for (const it of items) { if (it.R !== undefined || it.bot !== undefined) continue; const dx = x - it.x, dz = z - it.z; if (Math.abs(dx * it.c - dz * it.s) < it.hw && Math.abs(dx * it.s + dz * it.c) < it.hd) { const v = it.f ? it.f.surface(x, z) ?? hOf(it) : hOf(it); if (v > m) m = v; } }
      return m;
    },
    // Самая большая высота под фигурой a (рамка или круг); top — высота верха того, что над ней (низкое проходит под абажуром).
    under(a, top) { let m = 0; for (const it of items) if (!(it.bot !== undefined && top < it.bot) && shiftOut(a, it) && hOf(it) > m) m = hOf(it); return m; },
  };
}
// Высота верха предмета над столешницей — по видимым его частям (у невидимых листов в запасе поза осталась от последнего полёта).
const bookBox = new THREE.Box3(), bookPart = new THREE.Box3();
function topAbove(obj) {
  bookBox.makeEmpty();
  obj.traverseVisible(o => {
    const g = o.isMesh && o.geometry; if (!g?.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox(); if (g.boundingBox.isEmpty()) return;
    bookBox.union(bookPart.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return bookBox.isEmpty() ? .03 : Math.max(0, bookBox.max.y - W(0, deskTop, 0).y);
}
const bookTopH = b => topAbove(b.holder);
// Лампа в своих осях: высота (над низом подставки) и абажур — рамка и высота его низа (меряется один раз по видимым частям: всё, что начинается выше 25 см). Остальное — подставка.
let lampProf = null;
function lampProfile() {
  if (lampProf) return lampProf;
  const g = lamp.group, inv = new THREE.Matrix4(), m = new THREE.Matrix4(), all = new THREE.Box3(), sh = new THREE.Box3(), b = new THREE.Box3();
  g.updateWorldMatrix(true, true); inv.copy(g.matrixWorld).invert();
  g.traverseVisible(o => {
    const gm = o.isMesh && o.geometry; if (!gm?.attributes.position) return;
    if (!gm.boundingBox) gm.computeBoundingBox(); if (gm.boundingBox.isEmpty()) return;
    b.copy(gm.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)); all.union(b); if (b.min.y >= .25) sh.union(b);
  });
  return lampProf = { H: all.max.y, shade: sh.isEmpty() ? { x: 0, z: 0, hw: .1, hd: .1, y0: .3 } : { x: (sh.min.x + sh.max.x) / 2, z: (sh.min.z + sh.max.z) / 2, hw: (sh.max.x - sh.min.x) / 2, hd: (sh.max.z - sh.min.z) / 2, y0: sh.min.y } };
}
let topsSheet = null, topsFrame = -1, topsNow = null, frameNo = 0;
function topsOf(s) {
  if (topsSheet !== s || topsFrame !== frameNo) { topsNow = carryTops(s); topsSheet = s; topsFrame = frameNo; }
  return topsNow;
}
// Самая низкая из четырёх углов листа точка относительно хвата (≤ 0): провис краёв и наклон. От неё и считается высота хвата над тем, что под листом.
function lowRel(s) {
  const g = s.grab, cy = Math.cos(s.pr.v), sy = Math.sin(s.pr.v), th = s.tilt.v, sn = Math.sin(th), cs = Math.cos(th), ax = s.tiltAx.x, az = s.tiltAx.z, b = Math.max(s.bendNow, 1e-4);
  let low = 0;
  for (const [x, z] of CORNERS) {
    const dx = x - g.x, dz = z - g.z, x1 = dx * cy + dz * sy, z1 = -dx * sy + dz * cy, y0 = -b * (1 - Math.exp(-3 * (dx * dx + dz * dz) / b));
    low = Math.min(low, y0 * cs + (az * x1 - ax * z1) * sn);
  }
  return low;
}
// Луч указателя в осях стола; at(y) — где он на высоте y (null — указатель выше горизонта).
const rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), stInv = new THREE.Quaternion();
function handRay(e) {
  setRay(e); stInv.copy(station.quaternion).invert(); rayO.copy(ray.ray.origin); station.worldToLocal(rayO); rayD.copy(ray.ray.direction).applyQuaternion(stInv);
  const r = { ox: rayO.x, oy: rayO.y, oz: rayO.z, dx: rayD.x, dy: rayD.y, dz: rayD.z };
  r.at = y => { if (r.dy > -1e-3) return null; const t = (y - r.oy) / r.dy; return t < 0 ? null : { x: r.ox + r.dx * t, z: r.oz + r.dz * t }; };
  return r;
}
// Середина листа (x, z, поворот r) идёт к (tx, tz) шагами не длиннее `CARRY.step`; walls — преграды (рамки и круги, уже с запасом). Задев преграду, лист выталкивается из неё
// по самой короткой оси — остальное движение идёт вдоль неё; упёрся — стоит. Через преграду шаг в сантиметр не перескочит: лист больше любой из них. Отвечает [x, z].
function carryWalk(x, z, r, tx, tz, walls) {
  const a = { x, z, r, hw: A4.w / 2, hd: A4.h / 2 };
  const out = () => {
    for (let pass = 0; pass < 4; pass++) {
      let hit = false;
      for (const o of walls) { const sh = o.R !== undefined ? circleShift(a, o) : rectShift(a, o); if (sh) { a.x += sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4; a.z += sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4; hit = true; } }
      if (!hit) break;
    }
  };
  out();
  const dist = Math.hypot(tx - a.x, tz - a.z), n = Math.min(60, Math.max(1, Math.ceil(dist / CARRY.step))), k = Math.min(1, n * CARRY.step / (dist || 1)), gx = a.x + (tx - a.x) * k, gz = a.z + (tz - a.z) * k;
  for (let i = 1; i <= n; i++) { a.x += (gx - a.x) / (n - i + 1); a.z += (gz - a.z) / (n - i + 1); out(); }
  return [a.x, a.z];
}
// Лист поднимается в руку: хват там, где он сейчас; высота — пружина. smooth — лист догоняет руку плавно (вынутый из папки, вышедший из срыва): они не в одной точке.
function enterCarry(d, s, smooth = false) {
  const g = s.grab, cy = Math.cos(s.pr.v), sy = Math.sin(s.pr.v);
  d.stage = 'carry'; d.hv = { x: 0, z: 0 }; d.prevH = null; d.off = smooth ? null : { x: 0, z: 0 };   // off — сколько лист не дошёл до руки: сходит на нет за `CARRY.catchUp`
  d.pos = { x: s.px.v + g.x * cy + g.z * sy, z: s.pz.v - g.x * sy + g.z * cy };
  d.gy = new Spring(s.floor + Math.max(0, s.lift.v) - deskTop, CARRY.fit ** 2, 2 * CARRY.fit); d.y0 = d.gy.v;   // y0 — высота, на которой хват идёт по лучу (см. `carrySheet`)
  s.low = d.pin.length > 0; s.tilt.set(0); s.carry = { x: d.pos.x, y: deskTop + d.gy.v, z: d.pos.z };
}
function carrySheet(dt) {
  const d = drag; if (d?.kind !== 'item' || !(d.item instanceof Sheet) || !d.lifted) return;
  const s = d.item;
  // Над открытым ящиком и в нём лист ведёт `drawerStep`.
  if (s.dd || overDrawer) { if (s.carry || d.stage !== 'drawer') { s.carry = null; d.stage = 'drawer'; } s.tilt.t = 0; highlight(null); return; }
  if (d.stage === 'drawer') enterCarry(d, s, true);
  const g = s.grab;
  if (d.stage !== 'carry') {
    // Срыв: лист лежит под вещью — первые `CARRY.tear` пути руки он проходит `CARRY.hold` от них.
    const H = onDesk(d.hand, s.floor); if (!H) return;
    const cy = Math.cos(s.pr.v), sy = Math.sin(s.pr.v), cx = H.x + (1 - CARRY.hold) * (d.H0.x - H.x) - (g.x * cy + g.z * sy), cz = H.z + (1 - CARRY.hold) * (d.H0.z - H.z) - (-g.x * sy + g.z * cy);
    s.px.t = cx; s.pz.t = cz; s.px.k = s.pz.k = 260; s.px.c = s.pz.c = 26; s.lift.t = 0; s.tilt.t = 0;
    for (let i = d.pin.length; i--;) if (!hitsSolid(sheetBox(s), d.pin[i].shape(), GAP)) d.pin.splice(i, 1);
    d.pinF = d.pin.filter(o => o.f).map(o => o.f);
    highlight(null);
    if (!d.pin.length || Math.hypot(H.x - d.H0.x, H.z - d.H0.z) >= CARRY.tear) { calmSheet(s); enterCarry(d, s, true); }
    return;
  }
  s.advance(dt);
  const ray = handRay(d.hand), cr = Math.cos(s.pr.v), sr = Math.sin(s.pr.v), rgx = g.x * cr + g.z * sr, rgz = -g.x * sr + g.z * cr, bx = d.pos.x - rgx, bz = d.pos.z - rgz;
  // Из-под вещи листу выходить плашмя; вышел — поднимается. Вещь, из-под которой он едет, ему не преграда.
  const box = { x: bx, z: bz, r: s.pr.v, hw: A4.w / 2, hd: A4.h / 2 };
  for (let i = d.pin.length; i--;) if (!hitsSolid(box, d.pin[i].shape(), CARRY.near)) d.pin.splice(i, 1);
  d.pinF = d.pin.filter(o => o.f).map(o => o.f);
  const low = s.low = d.pin.length > 0;
  // Вынутый из каретки лист, пока он над основанием машинки, идёт выше неё и она ему не преграда.
  if (d.over) { const o = holders().find(h => h.key === d.over); if (!o || !hitsSolid(box, o.shape(), CARRY.near)) d.over = null; }
  // Скорость руки (по столешнице) и наклон на неё: лист чуть встаёт передним краем вверх, до 3°.
  const Hd = ray.at(deskTop), pH = d.prevH; d.prevH = Hd && { x: Hd.x, z: Hd.z };
  if (pH && Hd && dt > 0) { const a = 1 - Math.exp(-dt * 12); d.hv.x += ((Hd.x - pH.x) / dt - d.hv.x) * a; d.hv.z += ((Hd.z - pH.z) / dt - d.hv.z) * a; }
  const sp = Math.hypot(d.hv.x, d.hv.z);
  if (sp > 1e-3) { s.tiltAx.x = -d.hv.z / sp; s.tiltAx.z = d.hv.x / sp; }
  s.tilt.set(low ? 0 : Math.min(sp * CARRY.lean, CARRY.leanMax)); s.orient();
  // Высота хвата: нижняя точка листа — в `CARRY.lift` над самым высоким под ним (запас по краям растёт со скоростью руки, чтобы подняться заранее).
  const F = topsOf(s), room = CARRY.room + Math.min(.12, sp * CARRY.ahead);
  d.gy.t = low ? s.floor - deskTop : F.under({ x: bx, z: bz, r: s.pr.v, hw: A4.w / 2 + room, hd: A4.h / 2 + room }) + CARRY.lift - lowRel(s);
  if (d.over) d.gy.t = Math.max(d.gy.t, TW_TOP + CARRY.lift - lowRel(s));
  if (d.snap) { d.gy.set(d.gy.t); d.snap = false; }   // вынутый из папки лист сразу на своей высоте над ней
  // Лист, поднятый жёстким пределом (`Sheet.keepAbove`) в прошлом кадре, не должен вернуться обратно: хват берёт это в счёт.
  if (Math.abs(s.pushed) > 1e-6) { d.gy.v += s.pushed; d.gy.vel = s.pushed > 0 ? Math.max(0, d.gy.vel) : Math.min(0, d.gy.vel); s.pushed = 0; }
  d.gy.step(Math.min(dt, CARRY.stepMax));
  const walls = holders().filter(o => !o.f && !(o.key instanceof BookThing) && o.key !== d.over && !d.pin.some(p => p.key === o.key)).map(o => grow(o.shape(), CARRY.near));
  q0.set(g.x, 0, g.z).applyQuaternion(s.mesh.quaternion);
  let cx = bx, cz = bz, y = deskTop + d.gy.v, tx = bx, tz = bz;
  const keep = d.off ? Math.exp(-dt * CARRY.catchUp) : 0;
  // Хват — на луче указателя на высоте листа, в том же кадре. Ниже вещей лист не уходит ни на кадр: если на новом месте он задел бы вещь, хват поднимается и луч считается заново.
  for (let pass = 0; pass < 3; pass++) {
    // Хват — на луче на самой низкой высоте, на которой лист был в руке (`y0`): поднимаясь над высоким (книга на подставке), лист уходит вверх, а не к зрителю вдоль луча;
    // вынутый из каретки опускается — и плоскость хвата опускается с ним.
    d.y0 = Math.min(d.y0, d.gy.v); y = deskTop + d.gy.v; const H = ray.at(deskTop + d.y0);
    if (H) {
      tx = clamp(H.x - rgx, -DESK.hw - .3, DESK.hw + .3); tz = clamp(H.z - rgz, -DESK.hd - .3, DESK.hd + .6);
      // Упёрся в преграду или только что вышел из срыва — лист отстаёт от руки на off и догоняет её плавно, а не прыжком.
      if (!d.off) d.off = { x: bx - tx, z: bz - tz }; else if (pass === 0) { d.off.x *= keep; d.off.z *= keep; }
      [cx, cz] = carryWalk(bx, bz, s.pr.v, tx + d.off.x, tz + d.off.z, walls);
    }
    if (low || !s.mesh) break;
    const need = s.needLift(cx, y - q0.y, cz, F);
    if (need <= 1e-6) break;
    d.gy.v += need; d.gy.vel = Math.max(0, d.gy.vel);
  }
  if (d.off) { d.off.x = cx - tx; d.off.z = cz - tz; }
  d.pos.x = cx + rgx; d.pos.z = cz + rgz; s.carry = { x: d.pos.x, y, z: d.pos.z };
  const at = { x: cx, z: cz }, fo = low ? null : folderUnder(s, d.pinF, at), why = fo && pressedBy(fo); highlight(why ? null : fo, fo ? sideOver(s, fo, at) : 0);
}
// Папка придавлена: на закрытой стоит пресс-папье или лежит другая папка — раскрыться она не может.
function pressedBy(f) {
  if (f.pose === 'open' || f.drawer !== null) return null;
  const me = folderBox(f);
  if (weightM && hitsSolid(slabBox(weightM.x.v, weightM.z.v, weightM.rot.v, 0), me, -.004)) return 'weight';
  if (folders.some(g => g !== f && !g.held && g.drawer === null && g.b.group.visible && (g.stamp || 0) > (f.stamp || 0) && hitsSolid(folderBox(g), me, -.004))) return 'folder';
  return null;
}
// Крышка лишь вздрагивает, внизу — почему.
const squeezed = f => { const why = pressedBy(f); if (why) squeeze(f, why); return !!why; };
function squeeze(f, why) { f.b.jolt(); hint(t(`hint.pressed.${why}`), 3500); sfx.play('page', { gain: .3, rate: .7 }); }
// Пресс-папье стоит на раскрытой папке (середина плиты над ней, `baseOf`) — под ним придавленные листы: те половины, чьего листа плита касается (даже пустой половины:
// лист, перелистнутый туда, лёг бы на плиту). Пока придавлена хоть одна, ничего не перелистывается (лист ушёл бы из-под плиты или лёг бы на неё), придавленный лист не вынимается
// и не приподнимается под указателем, а обложками папка не закрывается (крышка прошла бы сквозь плиту).
const weightOn = f => f.pose === 'open' && !!weightM && f.drawer === null && baseOf(weightM.x.t, weightM.z.t) === f;
function pressedHalves(f) {
  if (!weightOn(f)) return [];
  const slab = slabBox(weightM.x.t, weightM.z.t, weightM.rot.t, 0);
  return [-1, 1].filter(side => { const t = toTable({ x: f.px.t, z: f.pz.t, r: f.pr.t }, { x: halfX(side), z: 0 }); return hitsSolid(slab, { x: t.x, z: t.z, r: f.pr.t, hw: A4.w / 2, hd: A4.h / 2 }, -.003); });
}
// Нельзя ли сейчас перелистнуть (листы идут с одной половины на другую)? Нет — подсказка внизу.
function flipBlocked(f) {
  if (!pressedHalves(f).length) return false;
  hint(t('hint.pressed.sheet'), 3000); sfx.play('page', { gain: .3, rate: .7 }); return true;
}
// Нельзя ли закрыть раскрытую папку крышкой side (−1 передняя, 1 задняя)? Нет — крышка вздрагивает (та, что не под плитой) и подсказка.
function coverBlocked(f, side) {
  if (!weightOn(f)) return false;
  const under = pressedHalves(f), shake = under.includes(side) ? (under.includes(-side) ? 0 : -side) : side;
  if (shake) f.b.shake(shake);
  hint(t(under.length ? 'hint.pressed.sheetRemove' : 'hint.pressed.folderRemove'), 3500); sfx.play('page', { gain: .3, rate: .7 }); return true;
}
// Отпущенный лист опускается прямо вниз, туда, где он висит. Место сдвигается только в двух случаях: чтобы лист лёг на стол целиком (в руке он мог свисать за край)
// и чтобы не лежать на том, на что нельзя класть, — основании машинки, подставке лампы, плите пресс-папье и любой папке: тогда вплотную рядом, не под ними и не на них
// (под папку лист попадает, только если папку положили на него; в раскрытую или закрытую он вкладывается — это решается раньше, `folderUnder`). Сдвиг — наименьший.
function landSpot(s, at) {
  const r = s.pr.t, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r)), ex = A4.w / 2 * c + A4.h / 2 * sn, ez = A4.w / 2 * sn + A4.h / 2 * c, hw = A4.w / 2 + GAP, hd = A4.h / 2 + GAP;
  const solids = [...bodies().map(b => bodyShape(b, { x: b.m.x.v, z: b.m.z.v, r: b.m.rot.v })), weightM && slabBox(weightM.x.v, weightM.z.v, weightM.rot.v, 0), ...folders.filter(f => f.b.group.visible && f.drawer === null && !f.held).map(folderBox)].filter(Boolean);
  const shiftOf = (x, z) => { const a = { x, z, r, hw, hd }; for (const o of solids) { const sh = o.R !== undefined ? circleShift(a, o) : rectShift(a, o); if (sh) return sh; } return null; };
  // Лист ставят у (at) и выталкивают из вещей по самой короткой оси, оставляя на столе целиком; front — на сколько он всё же может свесить передний край.
  // Перед машинкой на столе листу бывает тесно (между ней и краем стола меньше его высоты): тогда он свисает ровно настолько, насколько надо, чтобы не лечь на машинку.
  const settle = front => {
    let [x, z] = keepOnDesk(at.x, at.z, ex, ez, front);
    for (let i = 0; i < 8; i++) {
      const sh = shiftOf(x, z); if (!sh) return [x, z];
      x += sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4; z += sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4; [x, z] = keepOnDesk(x, z, ex, ez, front);
    }
    return shiftOf(x, z) ? null : [x, z];
  };
  for (let front = 0; front <= .2; front += front < .02 ? .02 : .01) { const p = settle(front); if (p) return p; }
  // Вещи стоят друг у друга (пресс-папье на папке): ближайшее свободное место — кольцами вокруг того, где отпустили.
  for (let d = .01; d < .9; d += .01) for (let k = 0; k < 40; k++) {
    const t = k / 40 * Math.PI * 2, [cx, cz] = keepOnDesk(at.x + Math.cos(t) * d, at.z + Math.sin(t) * d, ex, ez, .2);
    if (!shiftOf(cx, cz)) return [cx, cz];
  }
  return keepOnDesk(at.x, at.z, ex, ez, .2);
}
// Посадка отпущенного листа — одно движение: положение, поворот, высота и наклон идут к месту посадки критически затухающими пружинами (без отскока и паузы),
// ниже стола и вещей лист не уходит — это держит `Sheet.keepAbove`. LAND — частота пружины, 1/с: лист опускается за ~0,15 с и ложится совсем за ~0,2 с.
const LAND = 36;
function landSheet(s, x, z) {
  s.px.t = x; s.pz.t = z; s.lift.t = 0; s.tilt.t = 0; s.landing = 1;
  for (const k of [s.px, s.pz, s.pr, s.lift, s.tilt]) { k.k = LAND * LAND; k.c = 2 * LAND; }
  s.lift.vel = 0; s.tilt.vel = 0; s.px.vel = 0; s.pz.vel = 0;
}
// Отпустили (или нажали без сдвига): пружины листа обычные.
function calmSheet(s) { s.px.k = s.pz.k = 80; s.px.c = s.pz.c = 14; s.lift.k = 120; s.lift.c = 13; s.pr.k = 70; s.pr.c = 13; s.tilt.k = 140; s.tilt.c = 18; }
// ——— Вещь в руке — над всем ———
// Лампу, пресс-папье, книгу и папку несут так же, как лист (пользователь 2026-11-21: «над всем проходить»): вещь идёт за рукой свободно (не упирается ни в что и ничего не толкает) и
// поднимается так, чтобы её низ был на `CARRY.hover` выше самого высокого под ней (`carryTops(…, true)`: листы, папки, книги, пресс-папье, машинка, подставка лампы и абажур) —
// с запасом по краям, растущим со скоростью руки, чтобы подняться заранее (`CARRY.room`, `CARRY.ahead`). Высота — критически затухающая пружина (`gy`), ниже вещей она не уходит
// ни на кадр (жёсткий предел после выбора места). Точка, за которую взяли, остаётся на луче указателя на высоте этой точки. Отпущенная вещь ложится на ближайшее свободное место
// (`landCarried`) и опускается пружиной. Нажатие без сдвига (меньше `CARRY.grip`) ничего не начинает — вещь ведёт себя, как раньше.
const springsOf = T => T.px ? [T.px, T.pz, T.pr] : [T.x, T.z, T.rot];
// Высота низа над столешницей: у папки — над её нижним слоем (`floor`), у остальных — высота руки, пока несут (`cy`), иначе опора плюс подъём.
const bottomOf = T => T instanceof Folder ? T.floor - deskTop + Math.max(0, T.lift.v) : T.cy ?? T.up.v + Math.max(0, T.lift.v);
const restOf = T => T instanceof Folder ? T.floor - deskTop : T.up.v;
function setBottom(T, y) { if (T instanceof Folder) T.lift.set(Math.max(0, y - (T.floor - deskTop))); else T.cy = y; }
// Из чего вещь состоит для высоты: фигуры и высота низа каждой над низом вещи (у лампы подставка и абажур — абажур висит на 31 см); m — запас по краям.
function partsOf(T, x, z, r, m) {
  if (T instanceof Folder) return [{ shape: folderRect(x, z, r, T.pose, m), rel: 0 }];
  if (T instanceof BookThing) { const c = bookRect(T), t = toTable({ x, z, r }, c); return [{ shape: { x: t.x, z: t.z, r, hw: c.hw + m, hd: c.hd + m }, rel: 0 }]; }
  if (T === weightM) return [{ shape: slabBox(x, z, r, m), rel: 0 }];
  const pr = lampProfile(), o = bodyShape({ c: LAMP_BASE }, { x, z, r }), t = toTable({ x, z, r }, pr.shade);
  return [{ shape: { ...o, R: o.R + m }, rel: 0 }, { shape: { x: t.x, z: t.z, r, hw: pr.shade.hw + m, hd: pr.shade.hd + m }, rel: pr.shade.y0 }];
}
// Сколько надо поднять низ вещи, чтобы он был не ниже ничего под ней (F — `carryTops`); gy — высота низа сейчас (от неё зависит, пройдёт ли вещь под абажуром).
function needOver(F, c, x, z, r, m, gy) {
  let need = 0;
  for (const p of partsOf(c.T, x, z, r, m)) need = Math.max(need, F.under(p.shape, gy + c.hT) - p.rel);
  return need;
}
// Середину вещи — туда, где она целиком на столе (у папки — вместе с пресс-папье, что едет на ней).
function keepCarried(T, x, z, r, rel) {
  if (T instanceof Folder) {
    [x, z] = keepFolder(T.pose, x, z, r);
    if (rel) { const w = ridePose(rel, x, z, r), [ex, ez] = slabExt(w.r), [kx, kz] = keepOnDesk(w.x, w.z, ex, ez); x += kx - w.x; z += kz - w.z; }
    return [x, z];
  }
  if (T instanceof BookThing) return keepBook(T, T.book.pose, x, z, r);
  if (T === weightM) { const [ex, ez] = slabExt(r); return keepOnDesk(x, z, ex, ez); }
  return keepOnDesk(x, z, .112, .084);   // лампа — как раньше (`drag.r * .8`, `* .6`)
}
let topsAllT = null, topsAllFrame = -1, topsAllNow = null;
function topsAll(T) {
  if (topsAllT !== T || topsAllFrame !== frameNo) { topsAllNow = carryTops(T, true); topsAllT = T; topsAllFrame = frameNo; }
  return topsAllNow;
}
const gripFar = (d, e) => Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) >= (d.touch ? CARRY.gripTouch : CARRY.grip);
// Вещь поднимается в руку: она остаётся там, где была, высота — пружина от её нынешней высоты; точка хвата — на луче, на той высоте над низом, где взяли (gp — высота хвата над столом).
function startCarry(d, T) {
  const bottom = bottomOf(T), hT = T instanceof Folder ? T.thick + .002 : Math.max(.02, topAbove(T.obj) - bottom), gh = clamp((d.gp ?? 0) - bottom, 0, hT);
  const [sx, sz] = springsOf(T), H = handRay(d.hand).at(deskTop + bottom + gh);
  d.carry = { T, on: true, gy: new Spring(bottom, CARRY.fit ** 2, 2 * CARRY.fit), hT, gh, y0: bottom, lo: T.lift.t, off: H ? { x: H.x - sx.v, z: H.z - sz.v } : { x: 0, z: 0 }, hv: { x: 0, z: 0 }, prevH: null };
  setBottom(T, bottom);
}
function carryStep(dt) {
  const d = drag, c = d?.carry; if (!c) return;
  const T = c.T, [sx, sz, sr] = springsOf(T);
  if (T.dd) { c.on = false; return; }   // в ящик и из него ведёт `drawerStep`
  if (!c.on) { c.on = true; c.gy.set(bottomOf(T)); c.prevH = null; }
  const ray = handRay(d.hand), rel = T instanceof Folder ? d.rel : null;
  const F = topsAll(T), t = d.tow;
  // Где вещь окажется: хват на луче указателя на самой низкой высоте, на которой вещь была в руке (`y0`), — подъём над препятствием только вверх и место по столу не меняет.
  // Раньше хват держался под указателем на нынешней высоте: поднявшись над машинкой, вещь уезжала вдоль луча к зрителю, за машинку не попадала и проходила перед ней
  // (лампа, взятая за абажур, — на передний край стола). Теперь, проходя над высоким, вещь поднимается над указателем.
  // Машинка и лампа — преграды: над ними не проносят ничего (пользователь 2026-11-21: «книги… на неадекватную высоту подскакивают. над машинкой не проносим ничего», «и НАД лампой
  // тоже»). Вещь идёт к руке шагами не длиннее сантиметра, задев преграду, выталкивается по самой короткой оси и скользит вдоль (как лист, `carryWalk`). Преграды — основание машинки
  // (абажуру несомой лампы, он выше, — нет), подставка лампы и её абажур — для того, что выше его низа (под абажур задвигают лежащее).
  const walls = [];
  if (twM && twM !== T) walls.push({ o: grow(bodyShape({ c: TW_BASE }, { x: twM.x.v, z: twM.z.v, r: twM.rot.v }), GAP), below: TW_TOP });
  if (lampM && lampM !== T) {
    const p = { x: lampM.x.v, z: lampM.z.v, r: lampM.rot.v }, pr = lampProfile(), y0 = lampM.obj.position.y - deskTop;
    walls.push({ o: grow(bodyShape({ c: LAMP_BASE }, p), GAP), below: Infinity });
    if (restOf(T) + c.hT > y0 + pr.shade.y0) { const t = toTable(p, pr.shade); walls.push({ o: { x: t.x, z: t.z, r: p.r, hw: pr.shade.hw + GAP, hd: pr.shade.hd + GAP }, below: Infinity }); }
  }
  // Шаг за шагом: вытолкнуть из преград, удержать на столе; если и после этого вещь задевает преграду (у края стола толкать некуда), шаг не делается — вещь стоит.
  const hits = (x, z, r) => partsOf(T, x, z, r, 0).some(p => walls.some(w => p.rel < w.below && shiftOut(p.shape, w.o)));
  const walk = (x, z, r, tx, tz) => {
    const out = () => { for (let pass = 0; pass < 4; pass++) { let hit = false; for (const p of partsOf(T, x, z, r, 0)) for (const w of walls) { if (p.rel >= w.below) continue; const sh = shiftOut(p.shape, w.o); if (sh) { x += sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4; z += sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4; hit = true; } } if (!hit) break; } [x, z] = keepCarried(T, x, z, r, rel); };
    out(); if (hits(x, z, r)) { x = tx; z = tz; out(); return [x, z]; }   // уже внутри и выйти некуда (взяли из-под абажура у края стола и т. п.) — без шагов, только выталкивание
    const n = Math.min(60, Math.max(1, Math.ceil(Math.hypot(tx - x, tz - z) / .01)));
    for (let i = 1; i <= n; i++) { const px = x, pz = z; x += (tx - x) / (n - i + 1); z += (tz - z) / (n - i + 1); out(); if (hits(x, z, r)) { x = px; z = pz; break; } }
    return [x, z];
  };
  let placed = null;
  const placeAt = () => {
    if (placed) return placed;
    const H = ray.at(deskTop + c.y0 + c.gh); let x = sx.v, z = sz.v, r = sr.t;
    if (H) {
      if (t) { const dx = H.x - sx.v, dz = H.z - sz.v, n = Math.hypot(dx, dz); if (n > 1e-4) { x = H.x - dx / n * t.r; z = H.z - dz / n * t.r; r = sr.t + wrapPi(t.rot + Math.atan2(dx, dz) - t.a - sr.t); } }
      else { x = H.x - c.off.x; z = H.z - c.off.z; }
      [x, z] = keepCarried(T, x, z, r, rel);
      if (walls.length) [x, z] = walk(sx.v, sz.v, r, x, z);
    }
    return placed = [x, z, r];
  };
  // Скорость самой вещи по столу (не указателя: подъём сдвигает вещь вдоль луча, и это тоже её путь): вперёд по ней смотрим, что будет на пути.
  // Берётся большая из двух: сглаженная и мгновенная (куда рука хочет вещь в этом кадре) — иначе в первых кадрах и на кадрах без движения указателя вещь не заглядывает вперёд.
  const pH = c.prevH; c.prevH = { x: sx.v, z: sz.v };
  if (pH && dt > 0) { const a = 1 - Math.exp(-dt * 12); c.hv.x += ((sx.v - pH.x) / dt - c.hv.x) * a; c.hv.z += ((sz.v - pH.z) / dt - c.hv.z) * a; }
  const [wx, wz] = dt > 0 ? placeAt(c.gy.v) : [sx.v, sz.v], vi = { x: (wx - sx.v) / dt, z: (wz - sz.v) / dt };
  const hv = Math.hypot(vi.x, vi.z) > Math.hypot(c.hv.x, c.hv.z) ? vi : c.hv;
  const sp = Math.hypot(hv.x, hv.z), reach = Math.min(CARRY.reachMax, sp * CARRY.reach), ux = sp > 1e-3 ? hv.x / sp * reach : 0, uz = sp > 1e-3 ? hv.z / sp * reach : 0;
  // Сколько нужно поднять там, где вещь будет, и впереди неё по ходу руки (четыре точки до `reach` метров): подняться на 30 см надо заранее, а в стороны от пути запас — обычный (`CARRY.room`).
  const needAhead = (x, z, y) => { let n = 0; for (let k = 0; k <= 3; k++) n = Math.max(n, needOver(F, c, x + ux * k / 3, z + uz * k / 3, sr.v, CARRY.room, y)); return n; };
  // Высота-цель. Вверх: пока на нынешней высоте вещь (там, где она окажется на ней) задевала бы что-то, цель — над этим. Вниз: спускаться можно, пока на каждой высоте по пути вниз
  // место под указателем свободно, — подъём и спуск сдвигают вещь вдоль луча, и без этой проверки вещь, спускаясь, попала бы в то, что осталось под ней (поднимать её обратно пришлось бы рывком).
  const lo = restOf(T) + c.lo, ok = y => { const [px, pz] = placeAt(y); return needAhead(px, pz, y) + CARRY.hover <= y + 1e-6; };
  let y = Math.max(c.gy.v, lo);
  for (let i = 0; i < 3 && !ok(y); i++) { const [px, pz] = placeAt(y); y = Math.max(y, needAhead(px, pz, y) + CARRY.hover); }
  for (let step = .04; step > .002; step /= 2) while (y > lo + 1e-6 && ok(Math.max(lo, y - step))) y = Math.max(lo, y - step);
  c.gy.t = y;
  c.gy.step(Math.min(dt, .05)); c.y0 = Math.min(c.y0, c.gy.v);   // плоскость хвата не поднимается вместе с вещью, но опускается (пресс-папье, снятое с папки)
  let x = sx.v, z = sz.v, r = sr.t;
  // Ниже вещей вещь не уходит ни на кадр: если на новом месте она задела бы что-то, высота поднимается и место считается заново.
  for (let pass = 0; pass < 4; pass++) {
    [x, z, r] = placeAt(c.gy.v);
    const hard = needOver(F, c, x, z, sr.v, 0, c.gy.v) + CARRY.skin;
    if (c.gy.v >= hard - 1e-6) break;
    c.pops = (c.pops ?? 0) + 1; c.popMax = Math.max(c.popMax ?? 0, hard - c.gy.v);   // для испытаний: сколько раз и на сколько жёсткий предел поднял вещь, не успевшая подняться сама
    c.gy.v = hard; c.gy.vel = Math.max(0, c.gy.vel);
  }
  sx.set(x); sz.set(z); sr.t = r; setBottom(T, c.gy.v);
  if (rel && weightM) { const w = ridePose(rel, x, z, r); weightM.x.set(w.x); weightM.z.set(w.z); weightM.rot.t = w.r; }
  shadowDirty = true;
}
// Куда встанет пресс-папье: выталкивается из машинки, лампы и книг (`weightPose`), на папку и листы можно; нет места рядом — ближайшее свободное кольцами.
function weightLand() {
  const m = weightM, r = m.rot.t; let p = weightPose(m.x.t, m.z.t, r);
  if (!p.ok) { const x0 = p.x, z0 = p.z; search: for (let d = .02; d < .9; d += .02) for (let k = 0; k < 24; k++) { const q = weightPose(x0 + Math.cos(k / 24 * Math.PI * 2) * d, z0 + Math.sin(k / 24 * Math.PI * 2) * d, r); if (q.ok) { p = q; break search; } } }
  if (p.ok) { m.x.t = p.x; m.z.t = p.z; }
}
// Абажур лампы в осях стола — рамка и высота его низа над столом (под ним низкое проходит, но с высоты туда не опуститься: `landCarried`).
function lampShade(p = { x: lampM.x.t, z: lampM.z.t, r: lampM.rot.t }) {
  const pr = lampProfile(), t = toTable(p, pr.shade);
  return { x: t.x, z: t.z, r: p.r, hw: pr.shade.hw, hd: pr.shade.hd, bot: lampM.obj.position.y - deskTop + pr.shade.y0 };
}
// Куда встанет лампа: подставка (круг) вне машинки, книг, пресс-папье и папок (под лампой могут лежать листы), а абажур — вне всего, что выше его низа (машинка, раскрытая книга на подставке);
// сперва выталкивается, потом — ближайшее свободное кольцами.
function lampLand() {
  const m = lampM, r = m.rot.t, solids = solidsFor(m), bot = lampShade().bot, tall = [];
  if (twM) tall.push(bodyShape({ c: TW_BASE }, { x: twM.x.t, z: twM.z.t, r: twM.rot.t }));
  for (const b of books) if (b.drawer === null && b.holder.visible && topAbove(b.holder) > bot) tall.push(bodyShape({ c: bookRect(b) }, { x: b.x.t, z: b.z.t, r: b.rot.t }));
  if (weightM && topAbove(weight.group) > bot) tall.push(slabBox(weightM.x.t, weightM.z.t, weightM.rot.t, 0));
  const away = (x, z) => {
    const o = bodyShape({ c: LAMP_BASE }, { x, z, r }), a = { ...o, R: o.R + GAP };
    for (const q of solids) { const s = shiftOut(a, q); if (s) return s; }
    const sh = lampShade({ x, z, r }); sh.hw += GAP; sh.hd += GAP;
    for (const q of tall) { const s = shiftOut(sh, q); if (s) return s; }
    return null;
  };
  let x = m.x.t, z = m.z.t;
  for (let i = 0; i < 8; i++) { const s = away(x, z); if (!s) break; x += s[0] * 1.001 + Math.sign(s[0]) * 1e-4; z += s[1] * 1.001 + Math.sign(s[1]) * 1e-4; [x, z] = keepCarried(m, x, z, r); }
  if (away(x, z)) { const x0 = x, z0 = z; let done = false; for (let d = .02; d < .9 && !done; d += .02) for (let k = 0; k < 24; k++) { const [cx, cz] = keepCarried(m, x0 + Math.cos(k / 24 * Math.PI * 2) * d, z0 + Math.sin(k / 24 * Math.PI * 2) * d, r); if (!away(cx, cz)) { x = cx; z = cz; done = true; break; } } }
  m.x.t = x; m.z.t = z;
}
// Отпущенную вещь — на место посадки (книга — `bookSpot` с поиском кольцами; папка — как поставили бы рукой, а некуда — ближайшее свободное; пресс-папье, лампа — выше).
function landOne(d) {
  const c = d.carry, T = c.T, [sx, sz, sr] = springsOf(T);
  if (T instanceof BookThing) {
    const p = bookSpot(T, sx.t, sz.t, sr.t, T.book.pose, null, undefined, null, true);
    const q = p.ok ? p : freeSpotFor(T) || d.start;   // тесно — ближайшее свободное по всему столу, а совсем некуда — на прежнее место
    if (q) { sx.t = q.x; sz.t = q.z; }
  } else if (T === weightM) weightLand();
  else if (T === lampM) lampLand();
  else {
    const w0 = weightM && { x: weightM.x.t, z: weightM.z.t, r: weightM.rot.t};
    let s = folderFit(T, sx.t, sz.t, sr.t, T.pose, d.rel ?? null, null, w0, true) || freeSpotFor(T);
    if (!s && d.start) s = { x: d.start.x, z: d.start.z, w: d.w0 };
    if (s) { sx.t = s.x; sz.t = s.z; if (s.w) setWeight(s.w); }
  }
}
// Вещь, что несли выше низа абажура, с высоты не опустить под него: место посадки — вне абажура (его рамка с запасом), остальное решает то же, что и всегда.
function landCarried(d) {
  const c = d.carry, T = c?.T; if (!c?.on || T.dd) return;
  const [sx, sz, sr] = springsOf(T), high = T !== lampM && lampM && c.gy.v + c.hT > lampShade().bot;
  for (let i = 0; i < 4; i++) {
    landOne(d);
    const sh = high && shiftOut(partsOf(T, sx.t, sz.t, sr.t, GAP)[0].shape, lampShade());
    if (!sh) break;
    [sx.t, sz.t] = keepCarried(T, sx.t + sh[0] * 1.001 + Math.sign(sh[0]) * 1e-4, sz.t + sh[1] * 1.001 + Math.sign(sh[1]) * 1e-4, sr.t, T instanceof Folder ? d.rel : null);
  }
}
// Высота руки переходит в пружину подъёма (`lift`, критическое затухание — без отскока), и вещь «садится» (`landStep`): пока она едет по пружинам на место посадки, она идёт на высоте
// над тем, что на пути (как в руке, смотрит вперёд по скорости), и опускается, когда доехала, — не проваливается в то, что осталось под ней, пока скользит вбок. c — несомая (`startCarry`).
const landing = new Map();
const LAND_W = 24;
function dropHeight(T, c = null) {
  if (T.cy !== null && T.cy !== undefined) {
    if (T === weightM) T.up.set(T.on(T.x.t, T.z.t));
    T.lift.set(Math.max(0, T.cy - T.up.v)); T.cy = null;
  }
  startLanding(T, c);
}
function startLanding(T, c) {
  if (!landing.has(T)) T.lk = [T.lift.k, T.lift.c];
  T.lift.k = LAND_W ** 2; T.lift.c = 2 * LAND_W; T.lift.t = 0; landing.set(T, c);
}
function landStep() {
  for (const [T, c] of landing) {
    if (T.held || T.dd || drag?.carry?.T === T) { [T.lift.k, T.lift.c] = T.lk; landing.delete(T); continue; }   // вещь снова взяли или она ушла в ящик
    const [sx, sz, sr] = springsOf(T), sp = Math.hypot(sx.vel, sz.vel), arrived = Math.abs(sx.t - sx.v) < .004 && Math.abs(sz.t - sz.v) < .004 && sp < .05;
    if (c && !arrived) {
      const F = topsAll(T), rest = restOf(T), reach = Math.min(CARRY.reachMax, sp * CARRY.reach), ux = sp > 1e-3 ? sx.vel / sp * reach : 0, uz = sp > 1e-3 ? sz.vel / sp * reach : 0, y = bottomOf(T);
      let need = 0; for (let k = 0; k <= 3; k++) need = Math.max(need, needOver(F, c, sx.v + ux * k / 3, sz.v + uz * k / 3, sr.v, CARRY.room, y));
      T.lift.t = need > 0 ? Math.max(0, need + CARRY.hover - rest) : 0;
      const hard = needOver(F, c, sx.v, sz.v, sr.v, 0, y) + CARRY.skin;
      if (hard > CARRY.skin && y < hard) { T.lift.v += hard - y; T.lift.vel = Math.max(0, T.lift.vel); }
    } else T.lift.t = 0;
    if (arrived && T.lift.resting) { [T.lift.k, T.lift.c] = T.lk; landing.delete(T); }
  }
}
function endDrag(e) {
  const d = drag; drag = null; highlight(null);
  if (!d) return;
  const tap = e && (d.kind === 'item' && d.item instanceof Sheet ? !d.lifted : Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < (d.touch ? 12 : 6)), car = d.carry;   // car — вещь несли над всем (`carryStep`)
  if (d.kind === 'item') {
    const it = d.item, isSheet = it instanceof Sheet, Y0 = car && it instanceof Folder ? it.floor + Math.max(0, it.lift.v) : null;   // Y0 — где висел низ папки в руке
    it.lift.t = 0; it.held = false; delete it.floorGoal;
    if (isSheet) { it.carry = null; it.low = false; it.tilt.t = 0; calmSheet(it); }
    if (tap) { if (car) dropHeight(it, car); it.px.t = d.start.x; it.pz.t = d.start.z; it.floor = d.y; if (d.w0) setWeight(d.w0); if (isSheet) lookAtSheet(it); else if (it instanceof BookThing) { if (putting) busyNote(); else unfoldBook(it); } else if (it.pose === 'open') { if (!nearF(it)) lookAtFolder(it); } else if (d.label && it.pose === 'face' && it.drawer === null) { if (nearF(it)) openLabelEdit(it); else lookAtCover(it); } else if (!squeezed(it)) unfold(it); return; }
    const dr = e && overDrawer, dd = it.dd || (dr ? (startDD(it, dr), it.dd) : null);
    // Вещь в ящике или на пути в него довершает путь сама (`drawerStep`): отпущенную над ящиком — туда, где указатель, брошенную на выходе — обратно в тот же ящик.
    if (dd && !dr) {
      // Отпустили не над ящиком: вещь доходит до края стола, выходит из ящика и ложится на стол там, где указатель (`settleOnDesk`).
      dd.want = null; dd.leave = true; const q = e && onDesk(e, deskTop); dd.then = () => settleOnDesk(it, q, d);
    } else if (dd) {
      const D = dd.d, t = D.tray, [ex, ez] = rotExt(it, it.pr.t), goal = dd.want === D && dd.goal || { x: clamp(it.px.v, t.x0 + ex, t.x1 - ex), z: clamp(it.pz.v, t.z0 + D.offset + ez, t.z1 + D.offset - ez) };
      dd.want = null; dd.leave = false; it.drawer = drawers.indexOf(D); it.dx = goal.x; it.dz = goal.z - D.offset; liftToTop(it);
    } else if (dr) { it.drawer = drawers.indexOf(dr); it.dx = it.px.t; it.dz = it.pz.t - dr.offset; liftToTop(it); }
    else {
      if (car?.on && !isSheet) landCarried(d);   // несли над всем — ложится на ближайшее свободное место
      it.drawer = null; it.floor = deskTop + .002; if (it instanceof BookThing) bookSound('put');   // закрытую книгу положили на стол — стук
      if (isSheet && (d.stage !== 'carry' || d.pin.length)) it.floor = d.y;   // ещё под вещью, из-под которой тянули: там и лежит
    }
    overDrawer = null;
    if (!isSheet) {
      it.stamp = ++stamps; restack();
      // Высота руки — в обычные пружины: папка опускается с того места, где висела, на свой слой (`rest`), книга — на стол.
      if (car && !dd && !dr) { if (Y0 !== null) { it.floor = it.rest ?? it.floor; it.lift.set(Math.max(0, Y0 - it.floor)); startLanding(it, car); } else dropHeight(it, car); }
    }
    if (isSheet && !dr && !dd && d.stage === 'carry' && !d.pin.length) {
      // Отпущенный в воздухе лист опускается прямо вниз, где висит; над папкой — вкладывается, над придавленной — ложится рядом.
      const y = it.floor + it.lift.v, at = { x: it.px.v, z: it.pz.v }, fo = folderUnder(it, d.pinF, at), why = fo && pressedBy(fo);
      it.floor = deskTop + .002; liftToTop(it); it.lift.v = Math.max(0, y - it.floor);
      if (fo && !why) fileInto(it, fo);
      else { const [x, z] = landSpot(it, at); landSheet(it, x, z); if (why) squeeze(fo, why); }
    }
    save();
  } else if (d.kind === 'mover') {
    d.mover.lift.t = 0;
    if (car) {
      // Несли над всем: нажатие с малым сдвигом — на прежнее место, иначе — на ближайшее свободное (`landCarried`).
      if (tap) { if (d.start) { d.mover.x.t = d.start.x; d.mover.z.t = d.start.z; d.mover.rot.t = d.start.rot; } } else landCarried(d);
      dropHeight(d.mover, car);
    }
    if (d.weight) {
      canvasEl.style.cursor = 'grab';
      // Нажатие без сдвига — на месте, и три кнопки выбора фигурки.
      if (tap) { d.mover.x.t = d.start.x; d.mover.z.t = d.start.z; d.mover.rot.t = d.start.rot; if (state === 'idle') showPick(true); }
    } else if (tap) { if (!d.tw) lamp.pull(); else if (state === 'typing') goView('type'); else beginTyping(); }
    else if (d.tw) {
      // Подвинули машинку во время печати — взгляд за ней.
      if (state === 'typing') goView('type');
    }
    save();
  } else if (d.kind === 'book') {
    // Нажали без сдвига — книга остаётся на месте, а закрытая раскрывается; повели — легла там, куда довели.
    const bt = d.thing; bt.lift.t = 0; canvasEl.style.cursor = 'grab'; if (!tap) bookSound('put');   // книгу переставили — стук о стол
    if (car) { if (tap) { bt.x.t = d.start.x; bt.z.t = d.start.z; bt.rot.t = d.start.rot; } else landCarried(d); dropHeight(bt, car); }
    if (tap) { bt.x.t = d.start.x; bt.z.t = d.start.z; bt.rot.t = d.start.rot; if (bt.book.pose !== 'open') { if (putting) busyNote(); else unfoldBook(bt); } else if (!reading) { if (!nearB(bt)) bookFar(bt); else offerRead(bt); } }
    save();
  } else if (d.kind === 'bedge') {
    // Нажали на обрез: закрытая раскрывается на этом листе, раскрытая пролистывает к нему; вели — пролист шёл за рукой и закончится на последнем листе.
    bookTip(e, null); const bt = d.thing, bk = bt.book, z = d.last;
    if (bk.pose !== 'open') unfoldBook(bt, z.target); else { if (d.i0 !== null && z.target !== d.i0) trailPush(bt, d.i0); if (d.moved) bk.go(z.target, { follow: true }); else bk.go(z.target); }
    bookBarDirty = true; save(); if (bk.pose === 'open' && !reading) offerRead(bt);
  } else if (d.kind === 'bmark') {
    // Нажали на закладку — перейти к ней; вытянули больше чем на 2,5 см — убрана (ленточка уезжает), меньше — вернулась на место.
    const bt = d.thing, bk = bt.book, m = d.mark; canvasEl.style.cursor = ''; bookTip(e, null);
    if (bk.marks.list.includes(m)) {
      if (!d.moved) { bookJump(bt, m.g); if (!reading && bk.pose === 'open') offerRead(bt); }
      else if (m.pull.v >= .025) { bk.marks.remove(m); bk.snd('turn', { dir: 1, fast: true, hold: true }); bookBarDirty = true; save(); }
      else m.pull.t = 0;
    }
  } else if (d.kind === 'bpage') {
    const bt = d.thing, bk = bt.book; canvasEl.style.cursor = '';
    if (d.mode === 'press') { bk.press(bk.pressed >= .5 ? 1 : 0); bookBarDirty = true; save(); }
    else if (d.mode === 'grab') bk.release();
    else if (!d.mode && tap) { if (!nearB(bt)) bookFar(bt); else if (!bt.file && !d.near) pickPdf(); else { bk.flip(d.dir); if (!reading) offerRead(bt); } }   // в пустой книге нажатие на страницу — выбрать PDF
  } else if (d.kind === 'bookcap') {
    // Нажали на поле крышки или форзац — или потянули за них (как крышку папки): книга закрывается этой крышкой.
    if (d.cover && e && (tap || Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) > 20)) closeBook(d.thing, d.side);
  } else if (d.kind === 'rtilt') {
    // Нажали на верхний край или раму и не потянули: лист (по стороне или по половине экрана).
    const dir = d.flip || (d.half && e ? (e.clientX > innerWidth / 2 ? 1 : -1) : 0);
    if (!d.moved && dir && d.thing.file) { if (putting) busyNote(); else { d.thing.book.flip(dir); bookBarDirty = true; if (!reading) offerRead(d.thing); } }
  } else if (d.kind === 'rtap') {
    // Режим чтения: нажатие мимо книги листает по половинам экрана (пустую книгу — нет).
    if (tap && reading && bookM?.file) { if (putting) busyNote(); else { bookM.book.flip(e.clientX > innerWidth / 2 ? 1 : -1); bookBarDirty = true; } }
  } else if (d.kind === 'tpaper') {
    // Нажали на лист в каретке, не вынимая: то же, что нажатие на машинку.
    canvasEl.style.cursor = ''; if (state === 'typing') goView('type'); else beginTyping();
  } else if (d.kind === 'chair') {
    canvasEl.style.cursor = '';
    if (!tap) {
      if (d.turned) chairs.straighten(d.i);
      chairs.touched = true; chairShade = 0; chairMoved(); save();
      if (!chairHinted) { chairHinted = true; hint(t('hint.chair.moved'), 6000); }
    }
  } else if (d.kind === 'chain') { if (tap && lamp.armed) lamp.pull(); else lamp.release(); save(); }
  else if (d.kind === 'tlamp') { if (tap && d.lamp.armed) d.lamp.pull(); else d.lamp.release(); save(); }
  else if (d.kind === 'drawer') {
    if (tap) { d.d.open.t = d.start; d.d.toggle(d.start < .5); }
    else { const v = d.d.open.t > .45; d.d.open.t = d.start; d.d.toggle(v); if (d.d.isOpen === v) d.d.open.t = v ? 1 : 0; }
  } else if (d.kind === 'leaf') {
    // Нажали на лист раскрытой папки без сдвига: перелистнуть, а если взгляд далеко — только подойти.
    d.f.b.perk(0);
    if (tap) { if (!nearF(d.f)) lookAtFolder(d.f); else if (!flipBlocked(d.f)) d.f.b.flip(d.side); }
  } else if (d.kind === 'cover') {
    // Крышку довели за середину — папка закрывается ею, нет — крышка возвращается.
    const f = d.f; let pose = f.b.dropCover();
    if (tap && d.bare) pose = d.side < 0 ? 'face' : 'back';
    if (pose === 'open') f.b.setPose('open'); else { f.go(pose); sfx.play('page', { gain: .6, rate: .85 }); }
    if (tap && !d.bare && !nearF(f)) lookAtFolder(f);
    save();
  } else if (d.kind === 'page') {
    const b = d.f.b;
    if (tap) b.complete(); else b.release();
  } else if (d.kind === 'globe') {
    // Нажали, не крутя, — подойти и рассмотреть (кроме печати: взгляд остаётся у машинки); крутили и замерли — шар стоит.
    const g = d.g; g.held = false; canvasEl.style.cursor = 'grab';
    if (tap && !d.moved) { g.vel = 0; if (state === 'idle') lookAtGlobe(g); } else if (performance.now() - d.t > 80) g.vel = 0;
  } else if (d.kind === 'clock') {
    // Нажали — подойти к часам; нажали дважды — стрелки бегут обратно к настоящему времени. Перевели — сказать, который в зале час.
    canvasEl.style.cursor = 'grab';
    // Подходить — не сразу: вдруг это первое из двух нажатий (камера уехала бы, и второе пришлось бы мимо часов).
    if (tap && !d.moved) {
      if (clockTap) { clearTimeout(clockTap); clockTap = 0; if (timeShift) { timeBack = true; hint(t('hint.clock.back'), 3000); } }
      else clockTap = setTimeout(() => { clockTap = 0; if (state === 'idle') lookAtClock(); }, 400);
    } else if (d.moved) {
      const rt = roomTime(); hint(t(touchFirst ? 'hint.clock.touch' : 'hint.clock.mouse', { time: new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(rt) }), 5000);
    }
  } else if (d.kind === 'cat') {
    // Ящик каталога: нажали — выдвинулся или задвинулся.
    if (tap && d.i !== undefined) d.cat.toggle(d.i);
  } else if (d.kind === 'door') {
    if (tap && state === 'idle') askDoor();
  } else if (d.kind === 'proj') {
    if (tap) { atCinema = true; showCinemaAsk(true); }
  } else if (d.kind === 'reels') {
    if (tap) { atCinema = true; openLib(); }
  } else if (d.kind === 'panel') {
    if (tap) { atCinema = true; if (cinema.mode === 'file' || cinema.mode === 'web') cinemaPause(); else showCinemaAsk(true); }
  }
}
let clockTap = 0;
// Дверь: подойти к ней (если стояли далеко — сначала дойти) и спросить, выйти ли. Выход — в том же окне: это выход из зала;
// стол перед уходом сохраняется, «назад» в браузере возвращает сюда.
let doorT = 0;
function askDoor() {
  const z = RAIL_Z - HALL.len, at = new THREE.Vector3(DOOR.x, -HALL.depth + 2.15, z), pos = new THREE.Vector3(DOOR.x, -HALL.depth + 1.8, z + 5.3), far = eyeGoal.distanceTo(pos) > 3;
  aimAt(pos, at); viewOn(null);
  clearTimeout(doorT); doorT = setTimeout(() => showDoor(true), far ? 1500 : 250);
}
const doorOpen = () => !$('door').hidden;
function showDoor(on) { clearTimeout(doorT); if (on) closeSliders(); $('door').hidden = !on; if (on) $('doorStay').focus(); }
$('doorGo').href = DOOR.url;
// Звезда на GitHub: пока репозиторий не опубликован — ссылка на аккаунт автора; после первой публикации — GITHUB_REPO (так будет назван репозиторий).
const GITHUB_ACCOUNT = 'https://github.com/CorazonCruzo', GITHUB_REPO = 'https://github.com/CorazonCruzo/exedra', REPO_PUBLISHED = true;
$('doorStar').href = REPO_PUBLISHED ? GITHUB_REPO : GITHUB_ACCOUNT;
// Автор и ссылки — не только за дверью: строка в справке и в «подробнее» (сайт автора, GitHub со звёздочкой).
// Почта проекта — пересылка Cloudflare на личный ящик автора (сам личный адрес на сайте не показывается).
const AUTHOR = { name: 'Anastasiia Chestnykh', site: 'https://chestnykh.net/', mail: 'exedra@chestnykh.net' };
for (const id of ['helpAuthor', 'aboutAuthor']) {
  const el = $(id), [pre, post = ''] = t('author.by').split('{name}'), link = (href, text) => { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; return a; };
  const gh = link(REPO_PUBLISHED ? GITHUB_REPO : GITHUB_ACCOUNT, 'GitHub'), st = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  st.setAttribute('viewBox', '0 0 24 24'); st.setAttribute('aria-hidden', 'true'); st.innerHTML = '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>'; gh.append(st);
  const mail = Object.assign(document.createElement('a'), { href: 'mailto:' + AUTHOR.mail, textContent: AUTHOR.mail });
  el.replaceChildren(pre, AUTHOR.name, post, ' · ', link(AUTHOR.site, 'chestnykh.net'), ' · ', gh, ' · ', mail);
}
// Жёлтая звёздочка — прямо в тексте, на месте слова «звезда» ({star} в словаре).
{ const [pre, post = ''] = t('door.star').split('{star}'), star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 24 24'); star.setAttribute('aria-label', '★'); star.innerHTML = '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>';
  $('doorStar').replaceChildren(pre.replace(/\s+$/, '\u00a0'), star, post.replace(/^\s+/, '\u00a0')); }   // неразрывные пробелы: звезда не уезжает на строку одна
$('doorGo').onclick = () => saveNow();
$('doorStay').onclick = () => showDoor(false);
$('door').addEventListener('pointerdown', e => { if (e.target === $('door')) showDoor(false); });
// Подойти к часам: встать напротив циферблата, чуть ниже его середины.
function lookAtClock() {
  const c = hungClock.c.getWorldPosition(new THREE.Vector3());
  aimAt(c.clone().add(new THREE.Vector3(0, -.25, -1.7)), c); viewOn(null);
}
// Рассмотреть глобус: встать перед ним чуть сбоку, со стороны середины галереи, глаз — чуть выше середины шара.
function lookAtGlobe(g) {
  dressGlobe(g, true);
  const c = g.pivot.getWorldPosition(new THREE.Vector3()), side = -Math.sign(c.x) * .35;
  aimAt(c.clone().add(new THREE.Vector3(side, .35, -1.05).normalize().multiplyScalar(g.R * 3.3)), c); viewOn(null);
}
addEventListener('pointerup', e => {
  if (touches.delete(e.pointerId) && drag?.kind === 'pinch') { if (touches.size < 2) drag = null; return; }
  if (drag && e.pointerId === drag.id) endDrag(e);
});
// Перенос прервался (система забрала указатель) — всё возвращается, как было до него.
function cancel(e) {
  if (e?.pointerId !== undefined) touches.delete(e.pointerId);
  if (!drag || (e?.pointerId !== undefined && drag.id !== undefined && e.pointerId !== drag.id)) return;
  const d = drag; drag = null; highlight(null); overDrawer = null;
  if (d.carry) { if (d.carry.on && d.kind === 'mover') landCarried(d); dropHeight(d.carry.T); }
  if (d.item instanceof Sheet) calmSheet(d.item);
  if (d.item?.dd) {
    // Прервали на пути в ящик или из него: вещь довершает путь — в ящик, где лежала или где была над ним.
    const it = d.item, dd = it.dd, D = dd.d, t = D.tray, [ex, ez] = rotExt(it, it.pr.t); it.held = false; delete it.floorGoal; dd.want = null; dd.leave = false;
    if (it.drawer === null) { it.drawer = drawers.indexOf(D); it.dx = clamp(it.px.v, t.x0 + ex, t.x1 - ex); it.dz = clamp(it.pz.v, t.z0 + D.offset + ez, t.z1 + D.offset - ez) - D.offset; liftToTop(it); }
    if (it instanceof Sheet) { it.carry = null; it.low = false; it.tilt.t = 0; it.landing = 0; }
  } else if (d.item) { const it = d.item; it.lift.t = 0; it.held = false; it.px.t = d.start.x; it.pz.t = d.start.z; it.floor = d.y; delete it.floorGoal; if (it instanceof Sheet) { it.carry = null; it.low = false; it.tilt.t = 0; it.landing = 0; } }
  if (d.mover) d.mover.lift.t = 0;
  if (d.kind === 'bedge') { bookTip(null, null); if (d.thing.book.pose === 'open') d.thing.book.go(d.thing.book.i); }
  if (d.kind === 'bmark') { d.mark.pull.t = 0; bookTip(null, null); }
  if (d.kind === 'bpage') { const bk = d.thing.book; if (d.mode === 'grab') bk.release(); else if (d.mode === 'press') bk.press(bk.pressed >= .5 ? 1 : 0); }
  if (d.kind === 'book') { d.thing.lift.t = 0; d.thing.x.t = d.start.x; d.thing.z.t = d.start.z; d.thing.rot.t = d.start.rot; canvasEl.style.cursor = ''; }
  if (d.weight) canvasEl.style.cursor = '';
  if (d.kind === 'page') d.f.b.release();
  if (d.kind === 'leaf') d.f.b.perk(0);
  if (d.kind === 'cover') d.f.b.setPose(d.f.pose);
  if (d.kind === 'chain') lamp.release();
  if (d.kind === 'tlamp') d.lamp.release();
  if (d.kind === 'chair') { Object.assign(chairs.list[d.i], d.start); chairs.move(d.i, d.start.x, d.start.z); canvasEl.style.cursor = ''; }
  if (d.kind === 'drawer') d.d.open.t = d.start >= .5 ? 1 : 0;
  if (d.kind === 'globe') { d.g.held = false; d.g.vel = 0; canvasEl.style.cursor = ''; }
  if (d.kind === 'clock') canvasEl.style.cursor = '';
}
addEventListener('pointercancel', cancel);
canvasEl.addEventListener('lostpointercapture', cancel);

addEventListener('keydown', e => {
  if (e.target.closest?.('.slider') && e.key !== 'Escape') return;
  if (e.key === 'Escape' && reading && (fsEl() || performance.now() - fsGone < 400)) { e.stopImmediatePropagation(); e.preventDefault(); return; }   // этот Esc — только выход из полного экрана
  if (e.key === 'Escape' && offerBook) { e.stopImmediatePropagation(); e.preventDefault(); offerBook.stayed = true; return offerHide(); }
  if (e.key === 'Enter' && offerBook && !e.target.closest?.('input, textarea, button')) { e.preventDefault(); offerHide(); return enterRead(); }
  if (e.key === 'Escape' && tour.asking) { e.stopImmediatePropagation(); e.preventDefault(); return tour.escape(); }
  if (e.key === 'Escape' && cinemaAskOpen()) { e.stopImmediatePropagation(); e.preventDefault(); return showCinemaAsk(false); }
  if (e.key === 'Escape' && lib?.isOpen) { e.stopImmediatePropagation(); e.preventDefault(); return lib.close(); }
  // Пробел — пауза и продолжение показа (файл или плеер сайта), когда идёт показ и зал не занят: в чтении пробел листает, за машинкой — печатает.
  if (e.code === 'Space' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && (cinema?.mode === 'file' || cinema?.mode === 'web') && !reading && state === 'idle' && !e.target.closest?.('button, input, select, textarea, [contenteditable]')) { e.preventDefault(); return cinemaPause(); }
  if (e.key === 'Escape' && foAskOpen()) { e.stopImmediatePropagation(); e.preventDefault(); return showFolderAsk(false); }
  if (e.key === 'Escape' && askOpen()) { e.stopImmediatePropagation(); e.preventDefault(); return showAsk(false); }
  if (reading && e.key !== 'Escape' && state === 'idle' && readKey(e)) return;
  // Backspace у раскрытой книги, на которой видны буквы, — «назад» (после перехода); в поле номера страницы, в машинке и вне книги — как прежде.
  if (e.key === 'Backspace' && !reading && state === 'idle' && readOwn === 'book' && bookM?.book.pose === 'open' && nearB(bookM) && bookM.trail.length && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); return bookBack(); }
  if (ARROWS.includes(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey && state !== 'loading') {
    e.preventDefault();
    // «Своя» раскрытая папка перед глазами: ← → листают её. Любая другая стрелка (и эти, когда от папки отошли или в машинке лист) — шаг.
    // Своя — то, чего касались последним: у книги ← → листают (с Shift — на 10 листов).
    if (state === 'idle' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && readOwn === 'book' && bookM?.book.pose === 'open' && nearB(bookM)) {
      if (!e.repeat) { const bk = bookM.book, dir = e.code === 'ArrowRight' ? 1 : -1; if (e.shiftKey) bookJump(bookM, spreadOf(bk) + dir * 10); else { bk.flip(dir); heldStart(e, bk, dir); } }
      return;
    }
    if (state === 'idle' && !e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && ownF?.pose === 'open' && nearF(ownF)) { if (!e.repeat && !flipBlocked(ownF)) { const dir = e.code === 'ArrowRight' ? 1 : -1; ownF.b.flip(dir); heldStart(e, ownF.b, dir); } return; }
    keys.add(e.code); keys.shift = e.shiftKey; return;
  }
  // Esc, закрывший полоску или карточку, дальше не идёт: иначе машинка заодно вынула бы лист.
  if (e.key === 'Escape' && (openSlider() || !weightPick.hidden || aboutOpen() || helpOpen() || decorOpen() || doorOpen())) { e.stopImmediatePropagation(); return openSlider() || !weightPick.hidden ? closeSliders() : doorOpen() ? showDoor(false) : aboutOpen() ? showAbout(false) : decorOpen() ? showDecor(false) : showHelp(false); }
  if (e.key === 'Escape' && reading) return readMoved() ? readReset() : exitRead();
  if (e.key === 'Escape' && state === 'typing' && !tw?.active) return cancelTyping();
  // В киноуголке (после нажатия на проектор, коробки или экран) Esc только закрывает плашки — к столу не уводит, пока не ушли из уголка клавишей вида.
  if (e.key === 'Escape' && state === 'idle' && !atCinema) { if (lookBack) lookBackNow(); else goView('seat'); }
});

// ——— Кино: проектор «Патэ-Бэби» и экран на стене уголка ———
// Видеофайл (с компьютера или по прямой ссылке) идёт на панель сам (текстура видео, cinema.js); видео с сайтов (YouTube, Rutube, VK Видео, Vimeo) — настоящий плеер под холстом, повёрнутый ровно на панель, а зал в этом месте прозрачен.
// И то и другое видно отовсюду, по залу можно ходить; нижний зал приглушается, зажигается луч.
// Видно ли точку уголка от глаза: с галереи путь к нему идёт сквозь её пол (поэтому сверху, из-за балюстрады, проектор и экран не нажимаются), а из зала — свободно.
function nookClear(p) {
  const e = camera.position; if (e.y <= -.7 || p.y >= -.7) return true;
  const t = (-.7 - e.y) / (p.y - e.y), z = e.z + (p.z - e.z) * t;
  return z < RAIL_Z - .15;
}
// Экран под лучом указателя (луч уже наведён, hit — что ближе из нажимаемого): не заслонён ни им, ни мебелью уголка.
function panelAt(hit) {
  if (!cinema || !cinemaPanel) return false;
  const { c, w, h, right, up, normal } = cinemaPanel, o = ray.ray.origin, d = ray.ray.direction, dn = d.dot(normal);
  if (dn >= -1e-6) return false;
  const t = c.clone().sub(o).dot(normal) / dn; if (t <= 0 || (hit && hit.h.distance < t)) return false;
  const p = o.clone().addScaledVector(d, t), q = p.clone().sub(c);
  if (Math.abs(q.dot(right)) > w / 2 || Math.abs(q.dot(up)) > h / 2 || !nookClear(p)) return false;
  const b = ray.intersectObjects(nook?.solids ?? [], true)[0];
  return !(b && b.distance < t);
}
const cinemaAt = e => { if (!cinema || reading) return false; const h = pick(e); return !!(h?.u.projector || h?.u.reels || panelAt(h)); };

function cinemaStep(dt) {
  if (!cinema) return;
  if (cinema.update(dt, performance.now() / 1000, camera.position, sfx.on)) { setLight(lightV); nook.dim(cinema.lit); }
  if (cinema.mode === 'web') { camera.updateMatrixWorld(); cinema.placeFrame(camera, innerWidth, innerHeight); }
  if (cinemaAskOpen()) seekSync();
  watchQuiet();
  // (Ожидание данных — карточкой на самом экране, cinema.js.)
}
// Ползунок перемотки на плашке: пока плашка открыта, идёт за временем показа (не трогая, пока его тянут); отпустили — перемотка.
const clock = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`; };
let seekHeld = false;
function seekSync() {
  const d = cinema.duration, on = (cinema.mode === 'file' || cinema.mode === 'web') && d > 0, row = $('cinemaSeekRow');
  if (row.hidden === on) row.hidden = !on;
  if (!on) return;
  const el = $('cinemaSeek'), dur = clock(d);
  if ($('cinemaDur').textContent !== dur) $('cinemaDur').textContent = dur;
  const k = seekHeld ? +el.value / 1000 : Math.min(1, cinema.time / d), pos = clock(k * d);
  if (!seekHeld && Math.abs(+el.value - k * 1000) >= 1) el.value = Math.round(k * 1000);
  if ($('cinemaPos').textContent !== pos) $('cinemaPos').textContent = pos;
  el.style.setProperty('--p', (k * 100).toFixed(2) + '%');
}
$('cinemaSeek').addEventListener('input', () => { seekHeld = true; seekSync(); });
$('cinemaSeek').addEventListener('change', e => { seekHeld = false; cinema.seek(+e.target.value / 1000 * cinema.duration); seekSync(); });
// Курсор задержался на экране с плеером сайта (0,3 с) — плеер поднимается над залом, его кнопки доступны (`cinema.lift`); уходит курсор — плеер сам опускается.
let ytLiftT = 0, ytOver = false;
function ytHover(over) {
  ytOver = !!over;
  if (!ytOver) { clearTimeout(ytLiftT); ytLiftT = 0; return; }
  if (!ytLiftT && !cinema.lifted && !pageZoomed()) ytLiftT = setTimeout(() => { ytLiftT = 0; if (ytOver && cinema.mode === 'web' && !pageZoomed()) cinema.lift(true); }, 300);
}
// Ссылка: плеер сайта ложится на стену, видеофайл по прямой ссылке идёт в сцену, как файл; взгляд (если стояли не в уголке) идёт к киноуголку.
function cinemaLink(link) {
  if (!cinema || reading || readBusy || state === 'loading') return false;
  showCinemaAsk(false);
  if (link.site) cinema.playWeb(link.site, link.m, sfx.on);
  else cinemaFile(null, link.direct);
  if (state === 'idle' && camera.position.y > -1.5) goView('nook');
  if (link.site) hint(t('hint.cinema.site'), 7000);
  return true;
}

// Плашка «Проектор»: ссылка на видео (сайт или файл), файл с компьютера, перемотка, пауза, озвучка, субтитры, «выключить».
const cinemaAskOpen = () => !$('cinemaAsk').hidden;
function cinemaSync() {
  const file = cinema?.mode === 'file' || cinema?.mode === 'web';
  $('cinemaNow').hidden = !file; $('cinemaPause').hidden = $('cinemaOff').hidden = !file;
  if (file) { $('cinemaNow').textContent = t(cinema.paused ? 'cinema.nowPaused' : 'cinema.now', { name: cinema.name }); $('cinemaPauseB').textContent = cinema.paused ? t('cinema.resume') : t('cinema.pause'); }
  // Озвучка — если у файла дорожек больше одной (у фильмов их бывает полтора десятка): название, язык, формат.
  const tr = cinema?.mode === 'file' ? cinema.tracks : [], sel = $('cinemaTrack');
  $('cinemaTrackRow').hidden = tr.length < 2;
  // Субтитры: «нет», дорожки файла (картинками — серые: не показываются), свой файл субтитров.
  const subs = cinema?.mode === 'file' ? cinema.subtitles : [], ss = $('cinemaSub'), cur = cinema?.subTrack;
  $('cinemaSubBtn').hidden = cinema?.mode !== 'file'; $('cinemaSubRow').hidden = !subs.length && cur !== 'ext';
  if (!$('cinemaSubRow').hidden) {
    const o = [new Option(t('cinema.subsNone'), -1, false, cur === -1)];
    subs.forEach((s, i) => { const op = new Option(([s.title, s.lang].filter(Boolean).join(' · ') || t('cinema.trackN', { n: i + 1 })) + (s.kind === 'text' ? '' : t('cinema.subImage')), i, false, cur === i); op.disabled = s.kind !== 'text'; o.push(op); });
    if (cur === 'ext') o.push(new Option(t('cinema.subFromFile', { name: cinema.subName }), 'ext', false, true));
    ss.replaceChildren(...o);
  }
  if (tr.length > 1) sel.replaceChildren(...tr.map((s, i) => new Option([s.title, s.lang, [s.codec, s.layout].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || t('cinema.trackN', { n: i + 1 }), i, false, i === cinema.track)));
  // Что идёт из фильмотеки — подпись: лицензия и автор, ссылка на страницу фильма.
  const cr = cinema?.credit ?? '', pg = cinema?.page ?? '';
  $('cinemaCredit').hidden = !cr && !pg;
  if (cr || pg) { $('cinemaCredit').replaceChildren(cr); if (pg) { const a = document.createElement('a'); a.href = pg; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t('cinema.page'); $('cinemaCredit').append(cr ? ' · ' : '', a); } }
  // Ошибка на экране — та же строка на плашке, и «выключить» её убирает.
  const err = cinema?.error ?? '';
  $('cinemaBad').hidden = !err; if (err) { $('cinemaBad').textContent = err; $('cinemaOff').hidden = false; }
}
function showCinemaAsk(on) {
  if (!cinema) return;
  if (on) { if (readBusy) return; closeSliders(); cinemaSync(); $('cinemaAsk').hidden = false; $('cinemaUrl').value = ''; $('cinemaUrl').focus({ preventScroll: true }); }
  else { $('cinemaAsk').hidden = true; $('cinemaUrl').blur(); }
}
function cinemaPause() {
  if (!cinema.togglePause()) return;
  hint(cinema.paused ? t('hint.cinema.paused') : '', cinema.paused ? 5000 : 0);
}
function cinemaOff() { cinema.stop(); showCinemaAsk(false); hint(t('hint.cinema.off'), 3000); }
async function cinemaFile(f, link = null, meta = null) {
  showCinemaAsk(false);
  try {
    if (!await cinema.playFile(f, sfx.on, link, meta)) return; sfx.wake();
    // Одна подсказка сразу: звук не дали включить — как его включить (важнее), иначе — как управлять.
    if (!cinema.soundOk) hint(t('hint.cinema.noSound'), 8000);
    else hint(t('hint.cinema.controls'), 7000);
    // Через три секунды — почему может быть тихо: выключен звук зала, в файле нет звука или его не играет и наш разбор (редкий формат).
    setTimeout(() => {
      if (cinema.mode !== 'file' || cinema.paused) return;
      if (!sfx.on) hint(t('hint.cinema.roomMuted'), 7000);
      else if (cinema.noAudio && !cinema.silent) hint(t('hint.cinema.noAudio'), 5000);
      else if (!cinema.soundOk) hint(t('hint.cinema.soundWaits'), 6000);
      else if (!cinema.ownAudio && !cinema.silent && cinema.video.webkitAudioDecodedByteCount === 0) hint(t('hint.cinema.badAudio'), 7000);
    }, 3000);
  } catch (err) { console.warn(err); if (cinema.mode === 'off') cinemaEnded(f ? 'error' : 'link-error', f?.name ?? decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() ?? link)); }
}
// Конец показа — подсказка; ошибка — карточка на самом экране (как интертитр: проектор светит ею, пока её не выключат) и та же строка на плашке.
const cinemaEnded = (why, name) => {
  const err = why === 'web-error' ? name : why === 'link-error' ? t('cinema.errLink', { name }) : why === 'error' ? t('cinema.errFile', { name }) : '';
  if (err) { cinema.showError(err); hint(t('hint.cinema.errShown'), 7000); }
  else hint(t('hint.cinema.ended'), 6000);
  if (cinemaAskOpen()) cinemaSync();
};
for (const t of ['keydown', 'keyup', 'keypress']) $('cinemaAsk').addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); showCinemaAsk(false); } });
$('cinemaAsk').addEventListener('pointerdown', e => { if (e.target === $('cinemaAsk')) showCinemaAsk(false); });
$('cinemaFileBtn').onclick = () => $('cinemaFile').click();
// Видео — можно вместе с файлом субтитров (выбрать оба): субтитры подключаются, как только видео пошло.
const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
$('cinemaFile').onchange = async e => {
  const fs = [...(e.target.files ?? [])], v = fs.find(f => !SUB_EXT.test(f.name)), sb = fs.find(f => SUB_EXT.test(f.name));
  setTimeout(() => { e.target.value = ''; });
  if (v) { await cinemaFile(v); if (sb && cinema.mode === 'file') subFile(sb); }
  else if (sb && cinema.mode === 'file') { showCinemaAsk(false); subFile(sb); }
};
$('cinemaPause').onclick = () => { cinemaPause(); cinemaSync(); };
$('cinemaSeek').addEventListener('pointerup', () => $('cinemaSeek').blur());
// Назад и вперёд на 10 с (кнопки по краям ползунка).
for (const [id, d] of [['cinemaBack', -10], ['cinemaFwd', 10]]) $(id).onclick = e => { e.currentTarget.blur(); if (cinema.duration) { cinema.seek(cinema.time + d); seekSync(); } };
// Фильмотека немого кино (filmlib.js) — с плашки и от коробки с бобинами; фильм идёт на стену, как файл по ссылке, с подписью (лицензия, автор).
async function cinemaFilm(film) {
  if (!cinema || reading || readBusy || state === 'loading') return;
  showCinemaAsk(false); lib?.close();
  if (state === 'idle' && camera.position.y > -1.5) goView('nook');
  await cinemaFile(null, film.url, { name: film.name, credit: film.credit, page: film.page, silent: film.silent !== false });
  if (film.vtt && cinema.mode === 'file') {
    try { const t = await (await fetch(film.vtt)).blob(); await cinema.loadSubFile(new File([t], film.vtt.split('/').pop())); } catch (e) { console.warn(e); }
  }
}
const lib = filmLibrary({ root: $('filmLib'), play: cinemaFilm });
const openLib = (tab = 'pick') => { if (!cinema || reading) return; showCinemaAsk(false); lib.open(tab); };
$('cinemaLibBtn').onclick = () => openLib();
$('cinemaSub').onchange = e => { const v = e.target.value; if (v !== 'ext') cinema.setSubtitle(+v); e.target.blur(); cinemaSync(); };
$('cinemaSubBtn').onclick = () => $('cinemaSubFile').click();
const subFile = async f => {
  try { const n = await cinema.loadSubFile(f); hint(n ? tn('hint.subs.loaded', n, { name: f.name }) : t('hint.subs.none', { name: f.name }), 5000); }
  catch (err) { console.warn(err); hint(t('hint.subs.fail', { name: f.name }), 6000); }
  if (cinemaAskOpen()) cinemaSync();
};
$('cinemaSubFile').onchange = e => { const f = e.target.files?.[0]; if (f) subFile(f); setTimeout(() => { e.target.value = ''; }); };
$('cinemaTrack').onchange = e => { cinema.setTrack(+e.target.value); e.target.blur(); };
$('cinemaOff').onclick = cinemaOff;
$('cinemaForm').onsubmit = e => {
  e.preventDefault();
  const r = parseVideoLink($('cinemaUrl').value);
  if (!r) {
    const msg = t('hint.link.bad');
    $('cinemaBad').textContent = msg; $('cinemaBad').hidden = false; hint(msg, 6000); return;
  }
  cinemaLink(r);
};

// ——— Запуск ———
// Телефон (маленький экран и сенсорное управление): зал рассчитан минимум на планшет — вместо него предупреждение, зал не грузится
// (её решение: «продолжить кнопки вообще не надо»). Планшеты и компьютеры его не видят. ?phonegate=1 — показать и на компьютере (проверка).
// Порог — 700 точек по короткой стороне (её «лучше не 600, а побольше»): все телефоны и маленькие 7-дюймовые планшеты — нет; iPad mini (744) и больше — да.
const isPhone = () => Math.min(screen.width, screen.height) < 700 && matchMedia('(pointer: coarse)').matches;
function phoneGate() {
  if (!isPhone() && Q.get('phonegate') !== '1') return Promise.resolve();
  $('phoneGate').hidden = false; stopLoader(); $('loading')?.remove();
  return new Promise(() => {});   // дальше не идём
}
async function init() {
  await phoneGate();
  const fonts = ['400 19px "PT Mono"', `400 ${BOOK.px}px "${BOOK.family}"`, 'italic 30px "Old Standard TT"', 'italic 500 17px "Cormorant Garamond"'].map(f => document.fonts.load(f, 'АаЙйЁёЩщ').catch(() => {}));
  // Картинка или null: не загрузилась или не успела за wait мс — зал обходится без неё.
  const image = imageOnce;
  const marksLoad = image(PAPERS.chekhov), paperLoad = PAPER_SRC === PAPERS.chekhov ? marksLoad : image(PAPER_SRC), artLoad = loadSet(decor.art);
  // Роспись под аркой ближнего торца — та же при любом наборе куполков.
  const muralLoad = image('assets/art/puvis-inter-artes.jpg', 6000);
  // Рамы, картины, часы и глобусы задней стены — грузятся, пока строится зал; что не загрузилось — того у стены нет.
  // Не успели за 8 с — стена без них: остальной зал не ждёт.
  const framesLoad = Promise.all([...Object.entries(FRAMES), ['clock', { load: loadClockModel() }], ...GLOBES.map((g, i) => [`globe${i}`, g]), ['sculpt', SCULPTS[decor.sculpt]], ['sconce', SCONCE], ['knocker', DOOR.knocker]].map(([k, F]) => Promise.race([F.load ?? loadModel(F.url).catch(e => { console.warn(e); return null; }), new Promise(ok => setTimeout(() => ok(null), 8000))]).then(m => [k, m]))).then(Object.fromEntries);
  const wallArtLoad = Promise.all([...new Set(HANG.map(h => h.art))].map(n => image(`assets/art/${n}.jpg`, 8000).then(im => [n, im]))).then(Object.fromEntries);
  const caseLoad = loadModel('assets/models/bookcase.glb').catch(e => { console.warn(e); return null; });
  // Лепнина — сканы гипсовых отливок: каждая — одна сетка с положениями, нормалями, затенением складок и индексами. Какая не загрузилась за 6 с
  // или устроена иначе (её не слить с остальной лепниной), ту заменит простая.
  const castOf = g => { let geo = null; g.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; }); if (!geo?.index || !geo.attributes.position || !geo.attributes.normal) return null; for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k); const c = geo.attributes.color; if (c && (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array))) { const f = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { f[i * 3] = c.getX(i); f[i * 3 + 1] = c.getY(i); f[i * 3 + 2] = c.getZ(i); } geo.setAttribute('color', new THREE.Float32BufferAttribute(f, 3)); } return geo; };
  const castsLoad = Promise.all(CASTS.map(n => Promise.race([loadModel(`assets/models/stucco/${n}.glb`).then(castOf).catch(e => { console.warn(e); return null; }), new Promise(ok => setTimeout(() => ok(null), 6000))]).then(g => [n, g])))
    .then(list => Object.fromEntries(list.filter(([, g]) => g)));
  // ?stand=0 — зал без подставки (сравнить скорость и число шейдеров).
  const standLoad = Q.get('stand') === '0' ? Promise.resolve(null) : loadModel(STAND_URL).catch(e => { console.warn(e); return null; });
  const chairLoad = loadModel('assets/models/chair/GreenChair_01.gltf').catch(e => { console.warn(e); return null; });
  const chandelierLoad = loadModel('assets/models/chandelier/Chandelier_03.gltf').catch(e => { console.warn(e); return null; });
  // Уголок под балконом: его модели грузятся вместе с залом (не успели за 12 с — уголок без них).
  const loungeLoad = NOOK ? loadLounge(loadModel) : null;
  // Упрощённые копии настольной лампы — для ламп на столах зала.
  const lampLoad = Promise.all(['mid', 'far'].map(k => loadModel(`assets/models/bankers-lamp-${k}.glb?v=2`).catch(e => { console.warn(e); return null; })));
  sfx.load('assets/sounds/', ['drawer-open', 'drawer-close', 'page', 'lamp-click', 'tw-bell']); loadBookSounds();
  await Promise.all(fonts); const paperImg = await paperLoad; setPaper(paperImg, await marksLoad);
  // Машинка грузится вместе с залом и встаёт на стол под заставкой: зал открывается уже с ней, а не она возникает на столе погодя.
  const twLoad = createTypewriter({ renderer, url: 'assets/models/typewriter-victorian.glb', soundBase: 'assets/sounds/', paperImage: paperImg, paperPaint: paintPaper, face: typeFace }).catch(e => { console.warn(e); return null; });
  // Стол и лампа грузятся, пока догружается роспись для потолка.
  const deskLoad = buildDesk({ station, loadModel });
  // Стёкла — заранее: к сборке зала они уже грузятся, и окна не темнеют.
  glassOf(false);
  const art = await artLoad; shownArt = art ? decor.art : null; shownSaved = art ? savedArt : null;
  // Не успели за 6 с — зал строится с нарисованным небом, а картины встанут, когда догрузятся.
  if (!art) { const k = decor.art; loadSet(k, 0).then(set => { if (set && decor.art === k && shownArt === null && ceiling) { ceiling.setArt(set); shownArt = k; shownSaved = savedArt; shadowDirty = true; } }); }
  buildHall(art, await castsLoad, await muralLoad); setLight(LIGHT); setInk(inkLevel); applyGlass(); tintWood();
  const desk = await deskLoad;
  deskTop = desk.deskTop; DESK = { hw: desk.hw, hd: desk.hd }; drawers = desk.drawers; lamp = desk.lamp; deskBody = desk.desk;
  lamp.group.userData.lamp = true; lamp.proxy.userData.proxy = true;
  const L = stored.lamp || { x: -.62, z: -.17, rot: .3 };
  lampM = new Mover(lamp.group, L, .14); if (stored.lamp && stored.lamp.on === false) { lamp.set(false); lamp.level.set(0); }
  // Пресс-папье: малахитовая плита, на ней фигурка, когда догрузится. Лежит на столе или на том, что под серединой.
  weight = buildPaperweight({ map: photo('assets/textures/malachite.jpg', true) }); weight.group.userData.weight = true; station.add(weight.group);
  weightM = new Mover(weight.group, stored.weight || { x: -.34, z: .2, rot: .4 }, .07); weightM.rest(underAt);
  { const k = decor.weight; loadWeight(k).then(m => { if (m && decor.weight === k) { weight.setFigure(k, m); shadowDirty = true; } }); }
  goView(Q.get('view') === 'wall' ? 'wall' : 'seat', true);
  tableLamps = buildTableLamps({ scene, model: desk.lampModel, copies: await lampLoad, spots: lampSpots, y: -HALL.depth + TABLE_H + .028, light: tableLit, dress: below });
  const chair = await chairLoad; if (chair) placeChairs(chair);
  const chandelier = await chandelierLoad;
  if (chandelier && ceiling) {
    hangChandeliers(chandelier, ceiling.hooks);
    setLight(LIGHT);
  }
  const frames = await framesLoad; placeBackWall(frames, await wallArtLoad);
  if (NOOK) placeNook(await loungeLoad, frames.sconce);
  const bc = await caseLoad;
  if (bc) { const m = fit(bc, { h: 4.5 }), spots = bookcaseSpots(); instanceAll(m, spots); bookDetail = fillShelves(scene, m, spots, station.position); }
  tw = await twLoad;
  if (tw) {
    tw.group.scale.setScalar(TW_WIDTH / 4.6); tw.group.userData.tw = true; station.add(tw.group);
    twM = new Mover(tw.group, stored.tw || { x: .02, z: -.02, rot: 0 }, .22);
    shoveWeight(true);
    Object.assign(tw.paper.material, { normalMap: sheetNormal, normalScale: new THREE.Vector2(.45, .45), roughness: .93, emissive: new THREE.Color(0xffd9a8), emissiveMap: tw.paper.material.map, emissiveIntensity: .3 }); inkPaper(tw.paper.material, tw.page);
    // Недопечатанный лист с прошлого раза уже стоит в каретке: виден за столом, печатать — нажатием на машинку.
    if (draft?.lines?.some(l => l.trim())) tw.show(draft, dropSheet);
  }
  // Все лампы и вся обстановка на месте: каждому материалу — его лампы. До первой сборки шейдеров (она — в отражениях ниже).
  for (let k = 0; k < BOOK_MAX; k++) bookMatsFor(k);   // материалы всех переплётов — под заставкой
  // Подставка для книги: невидима, пока книгу не читают; в сцене с самого начала — её материал получает лампы (`lightMasks`) и собирается вместе со всем (`compileAll`).
  standModel = await standLoad;
  lightMasks();
  // Отражения в лаке и латуни — от самого зала, а не от белой студии.
  // Отражения — при обычном свете, а ярче или темнее их делает уже бегунок.
  // Шейдеры зала собираются заранее и разом (compileAll), а не по одному в первом кадре. Проверка шейдера на ошибки — три запроса к видеокарте,
  // и главный поток ждёт ответ на каждый: когда видеокарта занята (другая вкладка, система), на двухстах шейдерах это секунды
  // (замер 2026-11-16: открытие 9–23 с вместо 4–5). Пока зал собирается, проверка выключена; потом — checkPrograms, одним запросом на шейдер.
  renderer.debug.checkShaderErrors = false;
  await compileAll('target');
  { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(scene, .04, .1, 40).texture; pm.dispose(); }
  // Солнце — после отражений: они запекаются без дневного света, при обычном свете ламп.
  updateSun(true);
  scene.traverse(o => { if (o.userData.sunOnly) sunOnly.push(o); });
  setInterval(updateSun, Number(Q.get('speed')) > 1 ? 1000 : 20000);
  (Array.isArray(stored.binders) ? stored.binders : [{ id: nextId++, x: .6, z: .1, rot: -.08 }]).forEach(addFolder);   // пустой список — папки убраны, новая сама не появляется
  [...(stored.sheets || [])].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0)).forEach(s => addSheet(s));
  for (const f of folders) f.b.refresh();
  // Книга: ?book=0 — без неё (чтобы сравнить скорость кадра).
  if (Q.get('book') !== '0') {
    for (const d of storedBooks.length ? storedBooks : [BOOK_DEFAULT]) {
      const b = new BookThing({ ...d, bind: Number.isFinite(d.bind) ? d.bind : freeBind() }); books.push(b);
      // Прежние книги сохранены вместе с местом; но если в одном столе две книги оказались на одной переплётной «ноте» — не страшно, переплёт только цвет.
      if (d.act) bookM = b;
    }
    bookM ??= books.find(b => b.book.pose === 'open') ?? books[0];
    // Новая книга в старом столе не двигает чужое: если место по умолчанию занято (папкой, пресс-папье), она встаёт на ближайшее свободное.
    if (!storedBooks.length) { const b = bookM, p = bookSpot(b, b.x.t, b.z.t, b.rot.t, b.book.pose, null, undefined, null, true); if (p.ok) { b.x.set(p.x); b.z.set(p.z); } }
  }
  shoveWeight(true);
  restack(true); weightM?.rest(underAt);
  showFace();
  // Подшивки и листы легли на стол после первой раздачи ламп: их материалам — тоже только свои лампы (иначе считают все, кадр медленнее).
  lightMasks();
  // Вещи, разведённые при открытии (shoveWeight, restack), встают на свои места до первого кадра: иначе первое нажатие
  // искало бы их там, где они нарисованы, а не там, где стоят.
  twM?.update(0); lampM?.update(0); weightM?.update(0); for (const b of books) b.update(0); for (const f of folders) f.update(0); for (const sh of sheets) sh.update(0);
  // Шейдеры страниц книги собираются, пока она раскрыта: иначе первое раскрытие стоило бы заминки.
  // Лист в воздухе (перелистывание, пролист) — тот же материал, но его тень — отдельный шейдер: на миг поднимаем лист, чтобы собрался и он.
  // Снимки всех переплётов приходят и уходят на видеокарту здесь же, под заставкой: иначе первый показ книги (или новой книги в другом переплёте) загружал бы их на ходу.
  await Promise.all([...new Set([BIND_START, ...[0, 1, 2].map(bindId), ...books.map(b => bindId(b.bind))])].map(warmBinding));
  // Прогревается книга, которая лежит на столе (из ящика её не видно — шейдеры не собрались бы).
  const realM = bookM; if (bookM?.drawer !== null) bookM = books.find(b => b.drawer === null) ?? bookM;
  const bookWas = bookM?.book.pose; if (bookWas && bookWas !== 'open') { bookWarm = true; bookM.book.setPose('open', true); }
  const warmI = bookM?.book.i; if (bookWarm) bookM.book.flip(1);
  await compileAll(...drawn());
  warmNext = true; shadowDirty = true; draw(true);   // тень — тоже: иначе шейдер тени страниц собирается при первом раскрытии книги   // тень — тоже: иначе шейдер тени страниц собирается при первом раскрытии книги
  if (bookM) warmBookLayouts();
  if (bookWas && bookWas !== 'open') { bookM.book.finishTurn(true); bookM.book.go(warmI, true); bookM.book.setPose(bookWas, true); bookM.update(0); bookWarm = false; }
  bookM = realM;
  renderer.debug.checkShaderErrors = true; checkPrograms();
  // Заставка (loader.js) успевает зажечь свою лампу, даже если зал собрался из кэша раньше; потом растворяется и останавливается совсем.
  await settled();
  state = 'idle'; ready = true;
  if (pageZoomed()) hintNow(t('hint.zoom.pinched'));
  setTimeout(() => bookM?.ensureFile(), 6000);
  (window.requestIdleCallback ?? (f => setTimeout(f, 9000)))(sweepFiles, { timeout: 12000 });   // файл книги открывается в покое, даже если книгу не раскрывали
  $('loading').style.opacity = 0; setTimeout(() => { stopLoader(); $('loading').remove(); }, 1300);
  const firstVisit = !localStorage.getItem(HELP_KEY);
  // Первый вход — предложение пройти обучение (раньше — справка; она теперь в «?» и в конце обучения). Обучения ещё не предлагали — предложить один раз и тем, кто уже бывал.
  if (firstVisit) { try { localStorage.setItem(HELP_KEY, '1'); } catch {} setTimeout(() => tour.welcome(), 1400); }
  else { revealAll(7000); hint(tw?.draft ? t('hint.idle.draft') : t('hint.idle.quiet'), 7000); setTimeout(() => tour.welcome(), 2500); }
  if (tw) saveNow();
}

// Бумага листов — чистый лист из парижского Бунина 1920 года (тон приведён к прежней бумаге): зерно мельче и ровнее («да, тоже так
// показалось» — на моё «ближе всего к „улучшить, не меняя характер“», 2026-11-14). Прежняя — лист из берлинского Чехова — по ссылке
// ?paper=chekhov; с неё же берутся приметы листов (paper.js). Откуда взяты остальные найденные листы — docs/paper/2026-11-14/SOURCES.md.
const PAPERS = { bunin: 'assets/textures/paper-bunin.jpg?v=2', chekhov: 'assets/textures/book-paper.jpg' };
const PAPER_SRC = PAPERS[Q.get('paper')] ?? PAPERS.bunin;

// ——— Лампы по материалам ———
// Шейдер считает каждую лампу в каждой точке, достаёт она туда или нет (условия в шейдере работу не экономят — см. начало файла).
// Поэтому каждому материалу оставлены только лампы, которые достают до его вещей: дальняя дверь не считает лампу на столе, стол — лампу
// над дверью. Картинка та же: за пределом дальности свет лампы и так нулевой. Порядок ламп — как у three.js: обход сцены, сначала те, что
// дают тень. Вещи на столе по нему двигают — для них берётся весь стол с запасом, и лампа со стола — с запасом на перестановку.
// Материалу, появившемуся позже (вещи, догруженные после открытия зала), достаются все лампы — верно, но медленнее; новые листы и подшивки получают маску стола.
// Новая лампа с настоящим светом должна появиться до lightMasks() — или вызвать его снова: иначе биты съедут на чужие лампы.
const DESK_PLAY = 1.3;
function lightMasks() {
  scene.updateMatrixWorld(true);
  const points = [], spots = [], onDesk = o => { for (let p = o; p; p = p.parent) if (p === station) return true; return false; };
  scene.traverseVisible(o => { if (o.isPointLight) points.push(o); else if (o.isSpotLight) spots.push(o); });
  const rank = l => (l.castShadow ? 2 : 0) + (l.map ? 1 : 0);
  for (const list of [points, spots]) list.sort((a, b) => rank(b) - rank(a));
  const reach = l => new THREE.Sphere(l.getWorldPosition(new THREE.Vector3()), l.distance > 0 ? l.distance + (onDesk(l) ? DESK_PLAY : .6) : Infinity);
  // Рамка стола — по самому столу (с запасом вверх под лампу и вещи), а не по всему, что на нём стоит и лежит: стоило одной вещи
  // на миг получить негодное положение (лист в руке), рамка всего стола становилась негодной, ни одна лампа до неё «не доставала» —
  // и стол с вещами оставался чёрным при горящей лампе, пока зал не открыть заново.
  const fine = b => [b.min, b.max].every(v => Number.isFinite(v.x + v.y + v.z));
  let desk = new THREE.Box3().setFromObject(deskBody ?? station); desk.max.y += .6;
  if (!fine(desk)) desk = new THREE.Box3().setFromObject(station);
  desk.expandByScalar(DESK_PLAY);
  for (const c of station.children) if (!fine(new THREE.Box3().setFromObject(c)) && !new THREE.Box3().setFromObject(c).isEmpty()) console.warn('На столе вещь с негодным положением:', Object.keys(c.userData).join(',') || c.type, c.position.toArray());
  const P = points.map(reach), S = spots.map(reach), box = new THREE.Box3(), masks = new Map();
  const bits = list => list.reduce((m, sphere, i) => box.intersectsSphere(sphere) ? m | 1 << i : m, 0);
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (onDesk(o)) box.copy(desk); else box.setFromObject(o);
    const p = box.isEmpty() ? -1 : bits(P), s = box.isEmpty() ? -1 : bits(S);
    // У материала может быть двойник попроще для вида издалека (книги): лампы у них общие — по всем вещам обоих (lightsAs, lightTwins).
    for (const m0 of [].concat(o.material)) if (m0.isMeshStandardMaterial || m0.isMeshLambertMaterial) { const m = m0.userData.lightsAs ?? m0, was = masks.get(m); masks.set(m, was ? [was[0] | p, was[1] | s] : [p, s]); }
  });
  const all = n => 2 ** n - 1;
  // Листы, которые появятся позже, — как всё на столе.
  box.copy(desk); Object.assign(PAGE_LIGHTS, { POINT_MASK: bits(P) & all(points.length), SPOT_MASK: bits(S) & all(spots.length) });
  // До нижнего зала лампа с письменного стола не дотягивается (она в семи метрах выше и светит на стол), но по шару дальности
  // его задевает — и паркет, стулья, столы и лампы внизу считали её вместе с тенью в каждой точке: около полумиллисекунды кадра.
  const far = list => list.reduce((m, l, i) => onDesk(l) ? m | 1 << i : m, 0), farP = far(points), farS = far(spots);
  for (const [m, [p, s]] of masks) {
    const low = m.defines?.HALL_FILL === 1, P1 = p & all(points.length) & (low ? ~farP : -1), S1 = s & all(spots.length) & (low ? ~farS : -1);
    for (const t of [m, ...(m.userData.lightTwins ?? [])]) {
      if (t.defines?.POINT_MASK === P1 && t.defines?.SPOT_MASK === S1) continue;
      t.defines = { ...t.defines, POINT_MASK: P1, SPOT_MASK: S1 }; t.needsUpdate = true;
    }
  }
}

// Вещи, которые догружаются после открытия зала (скульптура, часы, вещи на стенах), получают свои лампы, как только
// появятся: раз в секунду — проверка, нет ли в зале материала, которому лампы ещё не раздавали. (Раньше их подхватывала раздача
// после загрузки машинки — случайно: машинка грузилась последней.)
let maskCheck = 0; const maskSeen = new WeakSet();
function lateMasks(dt) {
  if (!ready || (maskCheck += dt) < 1) return;
  maskCheck = 0; const fresh = [];
  scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if ((m.isMeshStandardMaterial || m.isMeshLambertMaterial) && m.defines?.POINT_MASK === undefined && !maskSeen.has(m)) { maskSeen.add(m); fresh.push(m); } });
  if (!fresh.length) return;
  // После раздачи шейдеры у части зала новые, а новые вещи ещё ни разу не рисовались: шейдеры собираются заранее, потом кадр — прогрев (warmNext ниже).
  lightMasks(); compileAll(...drawn()).finally(() => { warmNext = true; });
}

// ——— Кадр ———
let twBusyUntil = 0, dt = 0, deskMoved = 0, bookDetail = null, carryLog = null;
const sunOnly = [];
function frame() {
  frameNo++;
  heldStep(performance.now());
  cinemaStep(dt);
  inkPages();   // страницы подшивок допечатываются по кадрам
  walk(dt);
  spinGlobes(dt);
  // Стрелки бегут к настоящему времени — всё медленнее к концу пути; солнце — следом (не чаще кадра).
  if (timeBack) { timeShift *= Math.exp(-dt * 2.5); if (Math.abs(timeShift) < 2000) { timeShift = 0; timeBack = false; } timeDirty = true; }
  // Пока стрелки в руке или бегут назад, тени и лучи солнца пересчитываются не чаще десяти раз в секунду: каждый раз — новая карта тени.
  if (timeDirty && (!(timeBack || drag?.kind === 'clock') || performance.now() - sunAt0 > 100)) { timeDirty = false; sunAt0 = performance.now(); updateSun(); }
  setClockHands();
  for (const c of catalogs) if (c.update(dt)) shadowDirty = true;
  settleDrawers(); syncBar(); syncBookBar(); if (editF) placeLabelEdit();
  for (const d of drawers) if (d.update(dt)) shadowDirty = true;
  if (reading && !readBusy) readStep();
  if (lamp?.update(dt)) shadowDirty = true;
  // Лампа в зале разгорается или гаснет — за ней идёт общий свет нижнего зала (и отражение в зеркале).
  if (tableLamps?.update(dt)) { hallGlow(); mirrorDirty = true; }
  lateMasks(dt);
  // Пресс-папье, задетое машинкой или лампой, которые сдвинули не рукой, выталкивается; в руке оно ведёт себя само (steerWeight).
  if (drag?.kind === 'item' || drag?.carry) { placeCamera(); camPlaced = true; }
  { const t = carryLog && drag?.carry && performance.now(); carryStep(dt); if (t) carryLog.push(performance.now() - t); }   // замер расчёта вещи в руке (из `__rr.carryLog = []`)
  landStep();
  // Пока вещь несут над всем или двигают машинку, остальное не толкается тут же (несомое ничего не толкает; машинка толкает сама, `steerBody`).
  if (!drag?.weight && !drag?.carry?.on && !drag?.tw) shoveWeight();
  if (lampM?.update(dt)) shadowDirty = true;
  if (twM?.update(dt)) shadowDirty = true;
  for (const b of books) if (b.update(dt)) shadowDirty = true;
  const t0 = carryLog && performance.now();
  for (const it of [...sheets, ...folders, ...books]) if (it.dd) drawerStep(it, dt);
  carrySheet(dt);
  // Пока предмет в руке, он плавно переходит с высоты стола на дно ящика и обратно.
  for (const s of sheets) { if (s.held && s.floorGoal !== undefined) s.floor += (s.floorGoal - s.floor) * Math.min(1, dt * 10); s.update(dt); }
  if (t0 && drag?.item instanceof Sheet && drag.lifted) carryLog.push(performance.now() - t0);   // замер расчёта листа в руке (из `__rr.carryLog = []`)
  for (const f of folders) {
    if (f.held && f.floorGoal !== undefined) f.floor += (f.floorGoal - f.floor) * Math.min(1, dt * 10);
    else if (!f.held && f.drawer === null && f.rest !== undefined && Math.abs(f.rest - f.floor) > 1e-5) f.floor += (f.rest - f.floor) * Math.min(1, dt * 10);
    f.update(dt);
  }
  // Пресс-папье — после папок: на папке в руке оно поднимается вместе с ней.
  rideStep();
  if (weightM?.update(dt)) shadowDirty = true;
  if (tw) { tw.update(dt); if (tw.active || performance.now() < twBusyUntil) shadowDirty = true; if (state === 'typing' && tw.active) typeWatch(dt); }
}
// Сборка шейдеров всего зала разом. renderer.render собирает их по одному и ждёт каждый — главный поток стоит; здесь все запускаются вместе
// (KHR_parallel_shader_compile), и ждём, пока соберутся. Это renderer.compileAsync, но без его слабого места: у материала, который успели
// выбросить за время ожидания, он падает и не возвращается, а зал так и остался бы под заставкой.
// Шейдеры свои для каждого вида рисования: на экран ('screen') и в цель ('target') — отражения (PMREM) и зеркало рисуют в цель, без тонового
// сжатия и в линейных цветах; с такой пустой целью compile собирает те же шейдеры, что понадобятся им (без неё они собрались бы второй раз).
const drawn = () => mirror ? ['screen', 'target'] : ['screen'];
async function compileAll(...views) {
  const ready = new Set(), target = views.includes('target') ? new THREE.WebGLRenderTarget(1, 1) : null;
  for (const view of views) {
    renderer.setRenderTarget(view === 'target' ? target : null);
    for (const m of renderer.compile(scene, camera)) { const p = renderer.properties.get(m).currentProgram; if (p) ready.add(p); }
  }
  renderer.setRenderTarget(null);
  for (const t0 = performance.now(); ready.size && performance.now() - t0 < 20000; await new Promise(ok => setTimeout(ok, 10)))
    for (const p of ready) if (p.isReady()) ready.delete(p);
  target?.dispose();
}
// Шейдеры, собранные без проверки, всё же проверяются: не собрался — в консоль, как обычно.
function checkPrograms() {
  const gl = renderer.getContext();
  for (const p of renderer.info.programs) if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) console.error('Шейдер не собрался:', p.name, gl.getProgramInfoLog(p.program));
}
// Прогрев. Вещь, которую рисуют в первый раз, заставляет видеокарту готовить для неё шейдер — это заминка от 30 до 200 мс, и без
// прогрева она случалась на ходу: в тот миг, когда к вещи впервые повернулись или подошли (и так после каждого открытия зала;
// замер 2026-11-14 — оборот к задней стене: сова 180 мс, часы 190, каталог 35…). Поэтому один кадр рисуется со всем залом разом,
// вместе с тем, что за спиной и за краем кадра: под заставкой и ещё раз, когда догрузилось убранство и лампы розданы заново.
let warmNext = false;
function warmUp() {
  warmNext = false; const all = [];
  scene.traverse(o => { if (o.frustumCulled && (o.isMesh || o.isSprite || o.isPoints || o.isLine)) { o.frustumCulled = false; all.push(o); } });
  renderer.render(scene, camera);
  for (const o of all) o.frustumCulled = true;
}
// Какие страницы книги непусты, зависит от листа: у начала, у конца и посередине рисуются разные группы граней, и каждая новая раскладка собирала свой шейдер тени
// при первом показе (при первом раскрытии закрытой книги — кадр 100 мс). Поэтому под заставкой книга на миг ставится на эти листы и рисуется только она (слой 1, как в режиме
// чтения): собирается всё, что нужно, а зал при этом не рисуется ещё раз.
function warmBookLayouts() {
  const bk = bookM.book, was = bk.i; if (bk.pose !== 'open') return;
  bk.finishTurn(true); markReadLayers(); camera.layers.set(1);
  // Подставка рисуется тоже (с тенью; шейдер один на все ступени и все подставки): к первому показу новых шейдеров нет.
  const th = bk.thing, rig = th.rig, vis0 = rig?.group.visible, m0 = th.mt;
  if (rig) { rig.set(th.notch); th.applyStand(1); }
  for (const i of [0, bk.leaves, bk.leaves >> 1]) { bk.go(i, true); bk.update(0); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); }
  if (rig) { th.applyStand(m0); rig.group.visible = vis0; }
  camera.layers.set(0); bk.go(was, true); bk.update(0); shadowDirty = true;
}
// Камера встаёт на место до того, как лист в руке считает луч указателя (иначе пока взгляд едет, лист шёл бы за камерой прошлого кадра); draw() не двигает её второй раз.
let camPlaced = false;
function placeCamera() {
  // Пока идёшь стрелками, взгляд почти не отстаёт: иначе он срезал бы углы сквозь перила, обходя их по шагам.
  eye.lerp(eyeGoal, 1 - Math.exp(-dt * (keys.size ? 14 : reading ? 5 : 3.2)));
  const yv = yaw.step(dt), pv = pitch.step(dt);
  dir.set(-Math.sin(yv) * Math.cos(pv), Math.sin(pv), -Math.cos(yv) * Math.cos(pv));
  camera.position.copy(eye); camera.lookAt(eye.x + dir.x, eye.y + dir.y, eye.z + dir.z);
  if (Math.abs(camera.fov - fovGoal) > .01) { camera.fov += (fovGoal - camera.fov) * (1 - Math.exp(-dt * 6)); camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}
// Взгляд и сама картинка — отдельно: даже если в кадре что-то сломалось, зал перерисуется и будет слушаться.
function draw(warm = false) {
  // Пока зал собирается, он закрыт заставкой: рисовать незачем, а каждая новая лампа заставляла бы заново собирать все шейдеры.
  // Один кадр под заставкой всё же рисуется — последним, для прогрева (warm).
  if (state === 'loading' && !warm) return;
  // Пока идёшь стрелками, взгляд почти не отстаёт: иначе он срезал бы углы сквозь перила, обходя их по шагам.
  if (!camPlaced) placeCamera(); camPlaced = false;
  // Подробные тома — только в шкафах рядом со взглядом (books.js).
  stillGrain(); movingPr();
  bookDetail?.(eye); bookDetailStep();
  // И подробные лампы на столах зала — только рядом (tablelamps.js).
  tableLamps?.detail(eye, Math.tan(camera.fov * Math.PI / 360) / Math.tan(FOV * Math.PI / 360));
  if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; if (!sun?.shadow.needsUpdate) deskMoved = performance.now(); }
  if (deskMoved && performance.now() - deskMoved > 300) { deskMoved = 0; if (sky?.sun > 0) { sun.shadow.needsUpdate = renderer.shadowMap.needsUpdate = true; } }
  // Зал бросает тень только для солнца: когда перерисовывается лишь тень лампы, его в ней нет.
  if (renderer.shadowMap.needsUpdate) { const sunPass = !!sun?.shadow.needsUpdate; for (const o of sunOnly) o.castShadow = sunPass; }
  if (warmNext) warmUp(); else renderer.render(scene, camera);
  // Зеркало переснимает зал, когда в нём что-то изменилось, — не чаще раза в две секунды.
  if (mirror && !readOnly && (mirrorBusy || mirrorDirty && performance.now() - mirrorAt > 2000)) { if (!mirrorBusy) { mirrorDirty = false; mirrorAt = performance.now(); } mirrorBusy = mirror.shoot(); }
}
// Пока взгляд движется (вращение, шаги, щипок), зал рисуется в MOVE_PR вместо полной чёткости: на ретине (3456×1984 точек) видеокарта при вращении
// то и дело не успевала к обновлению экрана — каждый десятый кадр дольше 20 мс (замер 2026-11-21; пользователь: «прокручивается с лагами»). В 1,5× точек на 44 % меньше,
// а на ходу разница почти не видна. Встали — через PR_HOLD мс снова полная чёткость. Смена — пересоздание холста, поэтому не чаще, чем взгляд трогается и встаёт.
// «Движется» — только заметно: шаг больше 1 мм или поворот больше 0,03° за кадр (хвост плавной остановки взгляда тянется секундами, и по нему чёткость держалась бы низкой —
// «текст расплывчатый», пользователь 2026-11-21). В режиме чтения — всегда полная чёткость: там читают.
const PR_HOLD = 250, prPos = new THREE.Vector3(), prQ = new THREE.Quaternion();
let prMovedAt = -Infinity;
function movingPr() {
  const now = performance.now();
  if (camera.position.distanceToSquared(prPos) > 1e-6 || 2 * Math.acos(Math.min(1, Math.abs(camera.quaternion.dot(prQ)))) > 5e-4) prMovedAt = now;
  prPos.copy(camera.position); prQ.copy(camera.quaternion);
  const want = !reading && now - prMovedAt < PR_HOLD ? MOVE_PR : FULL_PR;
  if (renderer.getPixelRatio() !== want) renderer.setPixelRatio(want);
}
// Зернистость плёнки шагает, только пока взгляд стоит: её шаг (слой поверх всего кадра) на ходу то и дело стоил пропущенного кадра —
// пять заметных рывков за две секунды движения (замер 2026-11-14). На ходу она замирает; встали — через полсекунды оживает.
const seenAt = new THREE.Vector3(), seenTurn = new THREE.Quaternion();
let movedAt = 0, grainStill = false;
function stillGrain() {
  const now = performance.now();
  if (camera.position.distanceToSquared(seenAt) > 1e-9 || 1 - Math.abs(camera.quaternion.dot(seenTurn)) > 1e-10) { movedAt = now; seenAt.copy(camera.position); seenTurn.copy(camera.quaternion); }
  if (grainStill !== now - movedAt < 500) document.body.classList.toggle('moving', grainStill = !grainStill);
}
// Время кадра берётся у браузера (начало обновления экрана), а не по часам в миг вызова: шаги движения ровнее.
// На экране в 120 Гц зал успевает не к каждому обновлению (внизу — примерно к двум из трёх): кадры идут вперемежку через 8 и 17 мс.
// ?fps=60 — ровный шаг вместо этого: кадр не чаще, чем раз в PACE мс (на таком экране — ровно через обновление, 60 кадров в секунду).
const PACE = Q.get('fps') === '60' ? 12 : 0;
let shownAt = -Infinity;
// Одна ошибка в кадре не должна останавливать весь зал.
let frameErr = 0, lastErr = null;
renderer.setAnimationLoop(time => {
  if (time - shownAt < PACE || shuffleOpen()) return;   // под экраном перетасовки зал не рисуется
  dt = Math.min(.1, (time - shownAt) / 1000); shownAt = time;
  try { frame(); } catch (err) { lastErr = err; if (frameErr++ < 3) console.error(err); }
  finally { try { draw(); } catch (err) { lastErr = err; if (frameErr++ < 3) console.error(err); } }
});
window.__rr = {
  get state() { return state; }, get tw() { return tw; }, get drag() { return drag && { kind: drag.kind, start: drag.start }; },
  sheets, folders, get drawers() { return drawers; }, get ceiling() { return ceiling; }, get lamp() { return lamp; }, get tableLamps() { return tableLamps; }, get chairs() { return chairs; }, hallFill, get twM() { return twM; }, get lampM() { return lampM; }, get weight() { return weight; }, get weightM() { return weightM; }, camera, station,
  project: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; },
  toWorld: (x, y, z) => W(x, y, z).toArray(), get deskTop() { return deskTop; }, get desk() { return DESK; },
  look: (p, a) => aimAt(new THREE.Vector3(...p), new THREE.Vector3(...a), true), SEAT, TYPE_VIEW, goView, INK, setLight, updateSun, get sky() { return sky; }, get shafts() { return shafts; }, get sun() { return sun; },
  unbound: () => { free = true; }, renderer, scene, get frameErr() { return [frameErr, String(lastErr?.stack ?? lastErr).slice(0, 600)]; }, get mirror() { return mirror; }, standable, solid, globes, standing, get eye() { return eye.toArray(); }, get eyeGoal() { return eyeGoal.toArray(); }, keys,
  putPdf: async (url, name) => { const r = await fetch(url); return putPdf(new File([await r.blob()], name || url.split('/').pop(), { type: 'application/pdf' })); }, get bookThing() { return bookM; }, lineApprox, LINE_MIN, legibleBook, standSide, setStand, standStep, READ, bookSpot, steerBook, bookRect, get reading() { return reading; }, aimAt, snapView, readRefit, setActive, unfoldBook,  get books() { return books; }, bookMatsFor, warmBinding, BookThing, asideSpot, listBooks, removeBook, readOwn: () => readOwn,
  underAt, carryTops, topsOf, topsAll, bottomOf, shoveAll, lampProfile, get carry() { return drag?.carry; }, holders, LAMP_BASE, CARRY, TW_BASE, GAP, landSpot, hitsSolid, bodies, get dragFull() { return drag; }, rectShift, circleShift, slabBox, bodyShape, set carryLog(v) { carryLog = v; },
  deskBlob: () => deskBlobNow().then(r => r.blob), openDesk, askDesk, deskAskOpen,
  get cinema() { return cinema; }, cinemaLink, parseVideoLink, showCinemaAsk, cinemaFile, cinemaAskOpen, nookClear, panelAt, nook: () => nook,
  removeFolder, showFolderAsk, unfold, makeRoom, framedAt, solidsFor, freeSpotFor,
  pickAt: (x, y) => { const h = pick({ clientX: x, clientY: y }); return h && { kind: ['sheet', 'folder', 'book', 'drawer', 'lamp', 'tw', 'weight', 'globe', 'clock', 'catalog', 'door', 'projector'].find(k => h.u[k]), name: h.h.object.name, d: +h.h.distance.toFixed(3) }; },
  hitsAt: (x, y) => { setRay({ clientX: x, clientY: y }); return ray.intersectObjects([...drawers.map(d => d.group), deskBody], true).slice(0, 5).map(h => [h.object.name, +h.distance.toFixed(3), !!owner(h.object)]); },
};
init().catch(err => { console.error(err); stopLoader(); const l = $('loading'); if (l) l.textContent = t('room.loadFail'); });

// ——— Обучение (tour.js): «показания» зала — что сделал человек; шаги сверяют их сами. Запуск — при первом входе, из справки и из «убранства».
let tourTyped = 0, tourBase = 0, tourPressed = new Set(), tourLastView = '';
addEventListener('keydown', e => { if (state === 'typing' && e.key.length === 1 && !e.metaKey && !e.ctrlKey) tourTyped++; }, true);
document.querySelectorAll('#views button[data-v]').forEach(b => b.addEventListener('click', () => { tourPressed.add(b.dataset.v); tourLastView = b.dataset.v; }));
const tour = makeTour({
  root: document.body, touch: () => touchFirst, ding: () => sfx.play('tw-bell', { gain: .35 }),
  api: {
    yaw: () => yaw.v, pitch: () => pitch.v, eye: () => eye, fov: () => camera.fov, lastView: () => tourLastView, pressed: v => tourPressed.has(v), clearPressed: () => tourPressed.clear(),
    // Напечатано: знаков на листе в машинке (и с клавиатуры, и нажатиями клавиш самой машинки) или нажатий клавиш, пока печатаешь, — что больше.
    fullscreen: () => !!fsEl(), typed: () => Math.max(tourTyped, (tw?.draft?.lines ?? []).join('').replace(/\s/g, '').length - tourBase), resetTyped: () => { tourTyped = 0; tourBase = (tw?.draft?.lines ?? []).join('').replace(/\s/g, '').length; },
    sheets: () => sheets.length, filed: () => sheets.filter(x => x.binder != null).length, folders: () => folders.length,
    inDrawers: () => folders.filter(f => f.drawer !== null).length + sheets.filter(x => x.drawer != null && x.binder == null).length,
    booksWithFile: () => books.filter(b => b.file).length, reading: () => reading,
    spreadSum: () => books.reduce((n, b) => n + (b.file ? (b.book.i ?? 0) * 7 + (b.book.pose === 'open' ? 1 : 0) : 0), 0),
    onStand: () => books.filter(b => b.stand > 0).length,
    inNook: () => atCinema || (camera.position.y < -1.5 && camera.position.z > -7),
    silentFilm: () => !!cinema && cinema.mode === 'file' && cinema.silent,
  },
});
$('helpTour').onclick = () => { showHelp(false); tour.open(); };
$('decorTour').onclick = () => { $('decor').hidden = true; tour.open(); };

