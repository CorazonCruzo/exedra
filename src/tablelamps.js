// Лампы на столах нижнего зала — та же банкирская лампа, что на письменном столе (desk.js), на каждом месте: с цепочкой,
// включается и гаснет. Настоящего света у них нет (каждая настоящая лампа — около миллисекунды кадра): горит стекло абажура,
// на столе — пятно света (его считает шейдер стола), вокруг — ореол, а общий свет нижнего зала идёт за горящими лампами (glow → hallGlow в room.js).
// Ламп шестьдесят четыре, в модели 134 тыс. треугольников — поэтому три степени подробности по расстоянию от глаза:
// вплотную — модель как есть, дальше — её упрощённые копии (bankers-lamp-mid.glb и -far.glb: 11 тыс. и 1,2 тыс. треугольников;
// дальше трёх метров — ещё и с простым матовым материалом;
// сделаны tools/models/lamp_lod.py). Каждая степень — три сетки сразу на все свои лампы: корпус, стекло, цепочка.
// (Проба четвёртой, в 400 треугольников для самых дальних, кадр не ускорила — замер 2026-11-14.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PullSwitch, PULL } from './desk.js';
import { radial, sfx } from './util.js';

// До какого расстояния от глаза (м) лампа рисуется как есть, до какого — упрощённой копией mid с тем же материалом, до какого — той же
// копией с простым материалом; дальше — копией far с простым. Простой материал — матовый, без отражений зала в латуни: почти вся цена
// ламп в кадре была в закраске (около миллисекунды на 64 лампы), а не в треугольниках, и дальше трёх метров разницу почти не видно
// («а мы можем реально чуть упростить? не прям до безобразия», 2026-11-14). BRASS — тон латуни для простого материала: без отражений
// она вышла бы рыжей и светлой, а с ним — той же тёмной бронзой, что вблизи.
// STICK — запас, чтобы на границе лампа не мигала. Смена копии — не скачком: FADE секунд новая проступает сквозь прежнюю
// (точка экрана рисуется либо той, либо другой — по мелкому узору, без прозрачности), поэтому на глазах ничего не «достраивается».
const RANGE = [1.05, 3, 5.6], STICK = .25, FADE = .7, BRASS = [.3, .26, .2];
// Лампа на столе зала меньше той, что на письменном столе (та — 46 см, крупная): здесь 37 см, как у настоящих банкирских, —
// на длинном столе четыре большие лампы теснили места («лампы для тех столов не крупноваты вышли?», 2026-11-14).
// Все мерки ниже даны для лампы в полный размер и уменьшаются вместе с ней.
const SIZE = .8;
// Какая доля ламп горит в зале обычно (поздний вечер: не каждая) — и на неё рассчитан общий свет нижнего зала.
export const USUAL = .62;
// Свет лампы на своём столе и на самой лампе считается в их шейдерах (не настоящая лампа сцены: без тени и только для этих вещей):
// цвет — как у лампы на письменном столе; table — сила света на сукне и дереве стола, self — на подставке, стойке и цепочке;
// пятно на столе кончается в along метрах от лампочки вдоль абажура и в across — поперёк; спад к краю начинается с доли from этого пути.
// SHADOW — тень подставки на сукне: какая доля света остаётся у самой подставки и на сколько метров от её края тень сходит на нет —
// для общего света зала (dark, wide: широкая, мягкая) и для света самой лампы (own, tight: узкая и слабая — он падает почти отвесно).
// Без этой тени лампа будто висит над столом; гуще нельзя: сукно само тёмное, и затемнённое вдвое-втрое оно на экране уже чёрное,
// а настоящая тень чёрной не бывает — в неё светит всё вокруг («почему тень ЧЕРНАЯ, её такой никогда не бывает», 2026-11-14).
const LAMP = { color: 0xffc68c, table: 3.4, self: .16, along: .8, across: .6, from: .2 };
const SHADOW = { dark: .72, wide: .07, own: .72, tight: .025 };
// Ореол: размер плоскости и на сколько метров она ближе к глазу, чем середина абажура (дальше любого края лампы — иначе лампа
// протыкает ореол, и на абажуре остаётся тёмный клин: часть перед плоскостью не светлеет).
const HALO = { size: .75, near: .26 };
// Насколько сукно светлеет под скользящим взглядом (ворс).
const NAP = 1.2;
// Цепочка тонкая — нажатие ловится в стольких метрах от неё.
const GRIP = .02;

class TableLamp extends PullSwitch {
  constructor(spot, hall) { super(spot.lit); Object.assign(this, spot); this.hall = hall; this.lod = -1; this.was = -1; this.t0 = 0; }
  // Щелчок выключателя — тем тише, чем дальше лампа.
  click() { sfx.play('lamp-click', { gain: .9 * this.hall.loudness(this) }); }
  toggle() { super.toggle(); this.hall.touched = true; }
  set(on) { super.set(on); this.hall.wake(this); }
  pull() { super.pull(); this.hall.wake(this); }
  hold(m) { super.hold(m); this.hall.wake(this); }
  release() { super.release(); this.hall.wake(this); }
}

// Сетка в осях лампы: только положения, нормали и развёртка — так части модели и её упрощённые копии сливаются друг с другом.
function plain(geometry, matrix) {
  const g = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const a = geometry.attributes[k], out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(i, c);
    g.setAttribute(k, new THREE.BufferAttribute(out, n));
  }
  const count = geometry.attributes.position.count;
  g.setIndex(geometry.index ? [...geometry.index.array] : [...Array(count).keys()]);
  return g.applyMatrix4(matrix);
}
const centre = g => { g.computeBoundingBox(); return g.boundingBox.getCenter(new THREE.Vector3()); };

// Лампочка для шейдеров: у стола — vec4( на сколько она впереди места лампы, её высота в зале, радиус подставки, на сколько середина
// подставки позади места лампы ); у самой лампы — место лампочки в её осях.
const bulbAt = { value: new THREE.Vector4() }, bulbIn = { value: new THREE.Vector3() };
const glsl = n => n.toFixed(4), lampColor = () => { const c = new THREE.Color(LAMP.color); return `vec3( ${glsl(c.r)}, ${glsl(c.g)}, ${glsl(c.b)} )`; };
// Материал стола (сукно, дерево столешницы): свет четырёх ламп своего стола. У сетки стола на каждый стол — aLamps: четыре лампы
// по четыре числа — x и z места, поворот, накал (tableLight ниже). cloth — сукно: под подставкой ложится тень, а ворс светлеет
// под скользящим взглядом (как у настоящего сукна: к дальнему краю стола оно будто припылено светом).
export function lampLit(material, cloth = false) {
  material.defines = { ...material.defines, ...(cloth ? { LAMP_CLOTH: '' } : {}) };
  material.onBeforeCompile = sh => {
    sh.uniforms.uBulbAt = bulbAt;
    sh.vertexShader = 'attribute mat4 aLamps;\nvarying mat4 vLamps;\nvarying vec3 vAt;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLamps = aLamps; vAt = ( modelMatrix * instanceMatrix * vec4( transformed, 1. ) ).xyz;');
    sh.fragmentShader = 'uniform vec4 uBulbAt;\nvarying mat4 vLamps;\nvarying vec3 vAt;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	{
		vec3 lampSum = vec3( 0. ); float wide = 1., tight = 1.;
		for ( int i = 0; i < 4; i ++ ) {
			vec4 l = vLamps[ i ];
			vec2 front = vec2( sin( l.z ), cos( l.z ) ), off = vAt.xz - l.xy - front * uBulbAt.x;
			vec3 to = vec3( - off.x, uBulbAt.y - vAt.y, - off.y ); float d2 = dot( to, to );
			// Абажур: вдоль него свет уходит дальше, чем поперёк.
			float edge = length( vec2( dot( off, vec2( front.y, - front.x ) ) / ${glsl(LAMP.along * SIZE)}, dot( off, front ) / ${glsl(LAMP.across * SIZE)} ) );
			lampSum += l.w * ( 1. - smoothstep( ${glsl(LAMP.from)}, 1., edge ) ) * saturate( dot( normal, ( viewMatrix * vec4( to * inversesqrt( d2 ), 0. ) ).xyz ) ) / d2;
			#ifdef LAMP_CLOTH
				float r = distance( vAt.xz, l.xy - front * uBulbAt.w ) - uBulbAt.z;
				wide *= mix( ${glsl(SHADOW.dark)}, 1., smoothstep( -.015, ${glsl(SHADOW.wide * SIZE)}, r ) ); tight *= mix( ${glsl(SHADOW.own)}, 1., smoothstep( -.01, ${glsl(SHADOW.tight * SIZE)}, r ) );
			#endif
		}
		#ifdef LAMP_CLOTH
			float nap = pow( 1. - saturate( dot( normal, normalize( vViewPosition ) ) ), 3. );
			reflectedLight.directDiffuse *= wide * ( 1. + ${glsl(NAP)} * nap ); reflectedLight.indirectDiffuse *= wide; reflectedLight.directSpecular *= wide; reflectedLight.indirectSpecular *= wide;
			lampSum *= tight * ( 1. + ${glsl(NAP)} * nap );
		#endif
		reflectedLight.directDiffuse += lampSum * ${glsl(LAMP.table * SIZE * SIZE)} * ${lampColor()} * BRDF_Lambert( material.diffuseColor );
	}`);
  };
  return material;
}
// Числа ламп для столов: по шестнадцать на стол (четыре лампы).
export const tableLight = tables => new THREE.InstancedBufferAttribute(new Float32Array(tables * 16), 16).setUsage(THREE.DynamicDrawUsage);
// Проступание копии. aShow — когда лампа начала проступать в этой копии (секунды по часам ламп, больше нуля) или, с минусом, — таять
// в ней; 0 — лампа в копии целиком. Долю точек, которые рисуются, считает шейдер по этим часам (uFade): пока копия меняется, сетки
// не переписываются — переписывать их каждый кадр на ходу стоило рывков (замер 2026-11-14). HIDDEN — «ещё не начала»: не рисуется вовсе.
const fadeNow = { value: 0 }, HIDDEN = 1e9, T0 = performance.now() / 1000 - 1, lampClock = () => performance.now() / 1000 - T0;
function fade(sh) {
  sh.uniforms.uFade = fadeNow;
  sh.vertexShader = 'attribute float aShow;\nuniform float uFade;\nvarying float vShow;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
	{ float p = clamp( ( uFade - abs( aShow ) ) / ${glsl(FADE)}, 0., 1. ); vShow = aShow == 0. ? 2. : aShow > 0. ? p : - max( p, 1e-4 ); }`);
  sh.fragmentShader = 'varying float vShow;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	{ float grain = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( .06711056, .00583715 ) ) ) ); if ( vShow >= 0. ? grain >= vShow : grain < - vShow ) discard; }`);
}
// Свет лампочки на самой лампе: подставка, стойка и цепочка под горящим абажуром светлые (латунь — металл, своего рассеянного света
// у неё нет, поэтому берётся её цвет). aOn — накал своей лампы.
function selfLit(sh) {
  sh.uniforms.uBulbIn = bulbIn;
  sh.vertexShader = 'attribute float aOn;\nuniform vec3 uBulbIn;\nvarying float vOn;\nvarying vec3 vBulb;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vOn = aOn; vBulb = ( modelViewMatrix * instanceMatrix * vec4( uBulbIn, 1. ) ).xyz;');
  sh.fragmentShader = 'varying float vOn;\nvarying vec3 vBulb;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	{
		vec3 to = vBulb + vViewPosition; float d2 = max( dot( to, to ), ${glsl(.012 * SIZE * SIZE)} );
		vec3 dir = to * inversesqrt( d2 ); float facing = saturate( dot( normal, dir ) );
		// Матовая доля и блик: латунь под лампой блестит, а не белеет.
		float shine = pow( saturate( dot( normal, normalize( dir + normalize( vViewPosition ) ) ) ), 24. ) * 3.;
		reflectedLight.directDiffuse += vOn * ${glsl(LAMP.self * SIZE * SIZE)} * ${lampColor()} * diffuseColor.rgb * RECIPROCAL_PI * facing * ( 1. + shine ) / d2;
	}`);
}

// model — части лампы со стола (desk.js); copies — её упрощённые копии от подробной к простой (сцены glTF: сетки body, glass и,
// в подробных, chain) или null; spots — места: { x, z, side (с какой стороны стола сидят: ±1), lit }; y — высота сукна;
// light — числа ламп для столов (tableLight): места идут по четыре на стол, в порядке столов; dress — пометка материалов нижнего зала
// (им достаётся его отражённый свет — below в room.js).
export function buildTableLamps({ scene, model, copies, spots, y, light, dress = m => m }) {
  const { top, len } = model, N = spots.length;
  // Звенья цепочки расходятся вниз от подвеса (как у лампы на столе): aC — насколько звено ниже подвеса, aPull — доля вытяжки.
  const hung = (g, c) => g.setAttribute('aC', new THREE.BufferAttribute(c, 1));
  const beads = model.chain.map(p => plain(p.geometry, p.matrix)), centres = beads.map(centre);
  beads.forEach((g, i) => hung(g, new Float32Array(g.attributes.position.count).fill(centres[i].y - top.y)));
  const full = { body: mergeGeometries(model.body.map(p => plain(p.geometry, p.matrix))), glass: mergeGeometries(model.glass.map(p => plain(p.geometry, p.matrix))), chain: mergeGeometries(beads) };
  const from = (file, name) => { let o = null; file.updateMatrixWorld(true); file.traverse(c => { if (c.isMesh && (c.userData.name ?? c.name) === name) o = c; }); return o && plain(o.geometry, new THREE.Matrix4().multiplyMatrices(model.source, o.matrixWorld)); };
  const v = new THREE.Vector3();
  const simple = copies.map(file => {
    const body = file && from(file, 'body'), glass = file && from(file, 'glass'); if (!body || !glass) return null;
    let chain = from(file, 'chain'); const c = [];
    if (chain) {
      // Каждая вершина упрощённой цепочки — при ближайшем звене настоящей.
      const p = chain.attributes.position;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); let best = 0; centres.forEach((q, k) => { if (q.distanceToSquared(v) < centres[best].distanceToSquared(v)) best = k; }); c.push(centres[best].y - top.y); }
    } else {
      // Издалека цепочка — тонкая нить цвета своих звеньев.
      chain = plain(new THREE.CylinderGeometry(.0013, .0013, len, 3, 1, true).translate(top.x, top.y - len / 2, top.z), new THREE.Matrix4());
      const p = chain.attributes.position, uv = full.chain.attributes.uv;
      for (let i = 0; i < p.count; i++) { c.push(p.getY(i) - top.y); chain.attributes.uv.setXY(i, uv.getX(0), uv.getY(0)); }
    }
    hung(chain, new Float32Array(c)); return { body, glass, chain };
  });
  // Не загрузилась копия — вместо неё соседняя попроще, а нет такой — поподробнее.
  const detail = [full, ...simple.map((g, i) => g ?? simple.slice(i).find(Boolean) ?? simple.slice(0, i).findLast(Boolean) ?? full)];

  const bodyMat = dress(model.material.clone()), chainMat = dress(model.material.clone()), glassMat = dress(model.glassMaterial.clone());
  bodyMat.onBeforeCompile = sh => { selfLit(sh); fade(sh); };
  chainMat.onBeforeCompile = sh => { selfLit(sh); fade(sh); sh.vertexShader = 'attribute float aC;\nattribute float aPull;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += aC * aPull;'); };
  // Стекло абажура — как у лампы на столе: снаружи приглушённый зелёный, изнутри — тёплый свет лампочки; aOn — накал своей лампы.
  glassMat.onBeforeCompile = sh => {
    fade(sh);
    sh.vertexShader = 'attribute float aOn;\nvarying float vOn;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOn = aOn;');
    sh.fragmentShader = 'varying float vOn;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += (gl_FrontFacing ? diffuseColor.rgb * .28 : vec3(1., .84, .6) * 1.3) * vOn;');
  };

  const hall = { lamps: [], active: new Set(), touched: false, seen: new THREE.Vector3(Infinity, 0, 0), range: [...RANGE], bulb: bulbAt.value };
  // Свет — к своему месту за столом; чуть вразнобой, как ставят люди.
  const q = new THREE.Quaternion(), Yv = new THREE.Vector3(0, 1, 0), scale = new THREE.Vector3(SIZE, SIZE, SIZE);
  full.body.computeBoundingBox(); full.glass.computeBoundingBox();
  const size = full.body.boundingBox.clone().union(full.glass.boundingBox);
  spots.forEach((s, i) => {
    const l = new TableLamp({ ...s, i }, hall), turn = (s.side > 0 ? 0 : Math.PI) + (((i * .6180339887) % 1) - .5) * .3;
    l.matrix = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), q.setFromAxisAngle(Yv, turn), scale);
    l.box = size.clone().applyMatrix4(l.matrix); l.head = new THREE.Vector3(s.x, y + .3 * SIZE, s.z);
    light.array.set([s.x, s.z, turn, 0], i * 4);
    hall.lamps.push(l);
  });
  // Лампочка — в середине абажура; подставка — круг под стойкой (стойка у модели позади её середины): низ лампы в рамке.
  const foot = new THREE.Box2(); { const p = full.body.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < .03) foot.expandByPoint(new THREE.Vector2(p.getX(i), p.getZ(i))); }
  bulbIn.value.copy(model.shade); bulbAt.value.set(model.shade.z * SIZE, y + model.shade.y * SIZE, (foot.max.x - foot.min.x) / 2 * SIZE, -(foot.min.y + foot.max.y) / 2 * SIZE);
  // Все лампы — в одной рамке: по ней сетки отсекаются от кадра и получают свои лампы зала (lightMasks в room.js),
  // сколько бы ламп ни было в каждой сейчас.
  const frame = new THREE.Box3(); for (const l of hall.lamps) frame.union(l.box);
  const sphere = frame.getBoundingSphere(new THREE.Sphere());
  // Простые материалы дальних ламп: те же правки шейдера, тот же рисунок, но без блеска.
  const plainMat = (m, patch, color = m.color) => { const p = dress(new THREE.MeshLambertMaterial({ map: m.map, color, side: m.side })); p.onBeforeCompile = patch; return p; };
  const brass = new THREE.Color(...BRASS), cheap = { body: plainMat(model.material, bodyMat.onBeforeCompile, brass), glass: plainMat(model.glassMaterial, glassMat.onBeforeCompile), chain: plainMat(model.material, chainMat.onBeforeCompile, brass) };
  const inst = (geo, mat, cast, ...extra) => {
    const im = new THREE.InstancedMesh(geo, mat, N); im.count = 0; im.boundingBox = frame; im.boundingSphere = sphere;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const k of extra) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    im.castShadow = cast; im.receiveShadow = true; im.userData.sunOnly = cast; scene.add(im); return im;
  };
  // Степени: копия и материал (полный или простой). У второй степени с той же копией — свои сетки: числа ламп лежат в самой сетке.
  const levels = [], levelOf = [[detail[0], false], [detail[1], false], [detail[1], true], [detail[2], true]].map(([g, matte]) => {
    let L = levels.find(L => L.g === g && L.matte === matte);
    if (!L) {
      const own = levels.some(L => L.g === g) ? { body: g.body.clone(), glass: g.glass.clone(), chain: g.chain.clone() } : g, m = matte ? cheap : { body: bodyMat, glass: glassMat, chain: chainMat };
      levels.push(L = { g, matte, body: inst(own.body, m.body, true, 'aOn', 'aShow'), glass: inst(own.glass, m.glass, true, 'aOn', 'aShow'), chain: inst(own.chain, m.chain, false, 'aPull', 'aOn', 'aShow'), n: 0 });
    }
    return L;
  });

  // Ореол вокруг абажура (плоскость лицом к глазу — вместо дорогого свечения на весь экран): яркость — по накалу лампы.
  // Пятно света на столе и тень под подставкой рисует сам стол (lampLit).
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(HALO.size * SIZE, HALO.size * SIZE), new THREE.MeshBasicMaterial({ map: radial([[0, 'rgba(255,214,150,.75)'], [.25, 'rgba(255,190,110,.22)'], [1, 'rgba(255,170,90,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), N);
  const m = new THREE.Matrix4(), grey = new THREE.Color();
  halos.boundingSphere = new THREE.Sphere(sphere.center, sphere.radius + .6);
  halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Плоскость всегда повёрнута к глазу и стоит перед лампой; размер — из матрицы своей лампы (у погашенной — ноль).
  halos.material.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0., 0., 0., 1. );
 mvPosition.xy += position.xy * instanceMatrix[ 0 ].x; mvPosition.z += ${glsl(HALO.near * SIZE)};
 gl_Position = projectionMatrix * mvPosition;`); };
  scene.add(halos);

  // Разложить лампы по сеткам их степеней: место, накал, вытяжка и качание цепочки, яркость ореола; накал — и столу.
  // Пока лампа меняет копию, она лежит в двух сетках сразу: в новой проступает, в прежней тает.
  const swing = new THREE.Matrix4();
  let warm = 3;
  function put(L, l, show) {
    const i = L.n++, on = Math.max(0, l.level.v);
    L.body.setMatrixAt(i, l.matrix); L.glass.setMatrixAt(i, l.matrix);
    for (const im of [L.body, L.glass, L.chain]) { im.geometry.attributes.aOn.array[i] = on; im.geometry.attributes.aShow.array[i] = show; }
    // Цепочка качается вокруг подвеса.
    swing.makeRotationX(l.swing.v * .22); v.copy(top).applyMatrix4(swing); swing.setPosition(top.x - v.x, top.y - v.y, top.z - v.z);
    L.chain.setMatrixAt(i, m.multiplyMatrices(l.matrix, swing)); L.chain.geometry.attributes.aPull.array[i] = Math.max(0, l.pullS.v) * PULL / len;
  }
  function write() {
    for (const L of levels) L.n = 0;
    for (const l of hall.lamps) {
      const L = levelOf[l.lod], old = l.was >= 0 ? levelOf[l.was] : L, on = Math.max(0, l.level.v);
      put(L, l, old === L ? 0 : l.t0); if (old !== L) put(old, l, -l.t0);
      light.array[l.i * 4 + 3] = on;
      // У погашенной лампы ореола нет вовсе (плоскость нулевого размера): не закрашивать зря экран.
      const k = on > .002 ? 1 : 0; grey.setScalar(on); halos.setColorAt(l.i, grey);
      halos.setMatrixAt(l.i, m.makeScale(k, k, k).setPosition(l.x, y + (model.shade.y - .05) * SIZE, l.z));
    }
    // В первых кадрах каждая копия рисуется хотя бы одной невидимой лампой: её сетка и шейдер готовятся под заставкой,
    // а не в тот миг, когда к лампе подошли.
    if (warm > 0) { warm--; dirty = true; for (const L of levels) if (!L.n) put(L, hall.lamps[0], HIDDEN); }
    for (const L of levels) {
      for (const im of [L.body, L.glass, L.chain]) { im.count = L.n; im.instanceMatrix.needsUpdate = true; for (const k of ['aOn', 'aShow', 'aPull']) if (im.geometry.attributes[k]) im.geometry.attributes[k].needsUpdate = true; }
    }
    halos.instanceColor.needsUpdate = halos.instanceMatrix.needsUpdate = light.needsUpdate = true;
  }
  let dirty = true;
  const fading = new Set();
  const box = new THREE.Box3(), a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
  Object.assign(hall, {
    wake(l) { hall.active.add(l); },
    loudness(l) { const d = hall.seen.distanceTo(l.head); return isFinite(d) ? Math.max(.15, 1 / (1 + (d / 2.5) ** 2)) : .15; },
    // Шаг цепочек и накала. Возвращает true, пока какая-то лампа разгорается или гаснет.
    update(dt) {
      let glowing = false;
      for (const l of hall.active) {
        if (!l.level.resting) glowing = true;
        if (!l.step(dt) && l.auto <= 0) hall.active.delete(l);
        dirty = true;
      }
      // Копия сменилась. Из прежней сетки лампа уйдёт при следующей переписи (до тех пор она там невидима: все её точки отброшены);
      // сразу переписывается только подробная сетка — в ней и невидимая лампа стоит 134 тыс. треугольников.
      fadeNow.value = lampClock();
      for (const l of fading) if (fadeNow.value - l.t0 >= FADE) { if (levelOf[l.was] === levels[0]) dirty = true; l.was = -1; fading.delete(l); }
      return glowing;
    },
    // Подробные лампы — только рядом со взглядом; zoom — во сколько раз приближено (узкий угол зрения — как подойти ближе).
    detail(eye, zoom = 1) {
      if (dirty || eye.distanceToSquared(hall.seen) > .0004 || zoom !== hall.zoom) {
        hall.seen.copy(eye); hall.zoom = zoom;
        for (const l of hall.lamps) {
          // Перейти на степень подробнее — подойти чуть ближе её границы, на проще — отойти чуть дальше.
          const d = eye.distanceTo(l.head) * zoom; let lod = hall.range.findIndex((r, k) => d < r + (l.lod >= 0 && l.lod <= k ? STICK : -STICK));
          if (lod < 0) lod = hall.range.length;
          if (lod === l.lod) continue;
          // Первая расстановка — сразу; дальше новая копия проступает сквозь прежнюю (вернулись к прежней на полпути — обратно тем же ходом).
          if (l.lod >= 0) { const now = lampClock(), done = l.was >= 0 ? Math.min(1, (now - l.t0) / FADE) : 1, back = lod === l.was; l.was = l.lod; l.t0 = now - (back ? 1 - done : 0) * FADE; fading.add(l); }
          l.lod = lod; dirty = true;
        }
      }
      if (dirty) { dirty = false; write(); }
    },
    // Лампа под лучом: вблизи — сама цепочка (её можно тянуть), иначе — лампа целиком (нажать — дёрнуть за цепочку).
    at(ray) {
      let best = null;
      for (const l of hall.lamps) {
        if (ray.origin.distanceToSquared(l.head) > 16) continue;
        a.copy(top).applyMatrix4(l.matrix); b.copy(a); b.y -= (len + .015) * SIZE;
        if (ray.distanceSqToSegment(a, b, p) > GRIP * GRIP) continue;
        const d = ray.origin.distanceTo(p); if (!best || d < best.d) best = { lamp: l, d, point: p.clone(), chain: true };
      }
      if (best) return best;
      for (const l of hall.lamps) {
        if (!ray.intersectBox(box.copy(l.box), p)) continue;
        const d = ray.origin.distanceTo(p); if (!best || d < best.d) best = { lamp: l, d, point: p.clone(), chain: false };
      }
      return best;
    },
    // Сколько света дают лампы возле каждой из точек zs (ближайшей к лампе вдоль зала): 1 — как при обычной доле горящих.
    glow(zs) {
      const sum = zs.map(() => 0), n = zs.map(() => 0);
      for (const l of hall.lamps) { let k = 0; zs.forEach((z, i) => { if (Math.abs(z - l.z) < Math.abs(zs[k] - l.z)) k = i; }); sum[k] += Math.max(0, l.level.v); n[k]++; }
      return sum.map((s, i) => n[i] ? s / n[i] / USUAL : 1);
    },
    // Какие лампы горят — строкой из 0 и 1, по порядку мест.
    bits() { return hall.lamps.map(l => l.on ? 1 : 0).join(''); },
  });
  return hall;
}
