// Письменный стол с выдвижными ящиками и банкирская лампа с цепочкой-выключателем.
// Модель стола (Matthew Collings, CC BY) сама умеет открывать три верхних ящика; ящики тумб в ней — нарисованные.
// Для тумб берём верхний ящик той же стороны, вытягиваем по высоте ячейки и ставим перед нарисованным фасадом.
import * as THREE from 'three';
import { Spring, clamp, fit, shadows, sfx } from './util.js';

// Ячейки ящиков в тумбах — доли высоты стола, снизу вверх по фасаду.
const PEDESTAL = [[.598, .759], [.411, .571], [.165, .384]];

// Рамка объекта в координатах стола.
function localBox(obj, station) {
  obj.updateWorldMatrix(true, false); station.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4().copy(station.matrixWorld).invert().multiply(obj.matrixWorld);
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
  return obj.geometry.boundingBox.clone().applyMatrix4(m);
}

export class Drawer {
  constructor(group, tray, travel) {
    this.group = group; this.tray = tray; this.travel = travel; this.base = group.position.z;
    this.open = new Spring(0, 55, 13);
  }
  get isOpen() { return this.open.t > .5; }
  get offset() { return this.group.position.z - this.base; }
  // Ящик открыт хоть немного — то, что в нём лежит, видно.
  get shown() { return this.open.v > .03; }
  toggle(v = !this.isOpen) { if (v === this.isOpen) return; this.open.t = v ? 1 : 0; sfx.play(v ? 'drawer-open' : 'drawer-close', { gain: .7 }); }
  // Возвращает true, пока ящик едет.
  update(dt) { const moving = !this.open.resting; this.group.position.z = this.base + this.open.step(dt) * this.travel; if (this.hole) this.hole.visible = this.shown; return moving; }
  // Точка на дне ящика под лучом (в координатах стола), если ящик открыт и луч попал внутрь.
  hit(ray, station, margin = 0) {
    if (!this.isOpen || this.open.v < .6) return null;
    const t = this.tray, plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0).applyQuaternion(station.getWorldQuaternion(new THREE.Quaternion())), station.localToWorld(new THREE.Vector3(0, t.y + .06, 0)));
    const p = ray.intersectPlane(plane, new THREE.Vector3()); if (!p) return null;
    const q = station.worldToLocal(p), dz = this.offset;
    // Только выдвинутая часть: то, что под столешницей, не видно и не достать.
    if (q.z < this.front - .02) return null;
    return q.x > t.x0 - margin && q.x < t.x1 + margin && q.z > t.z0 + dz - margin && q.z < t.z1 + dz + margin ? q : null;
  }
}

// Насколько уходит вниз цепочка, когда её тянут до щелчка.
export const PULL = .038;
// Свет настольной лампы — прежнего цвета и силы; шире только занимаемый им объём: луч раскрыт сильнее (angle), гаснет мягче к краю
// (penumbra) и достаёт дальше (reach) — освещён весь стол с подшивками, а бумага у лампы не ярче прежнего.
// (Проба «теплее и сильнее», 0xffb060 силой 7,5, отвергнута: «бумагу некрасиво высвечивает», 2026-11-14.)
const LIGHT = { color: 0xffc68c, k: 5.5, reach: 7, angle: 1.32, penumbra: .9, bounceColor: 0xffb878, bounce: .5, bounceReach: 5 };
// Выключатель на цепочке — общий для лампы на письменном столе и ламп на столах зала (tablelamps.js).
export class PullSwitch {
  constructor(on = true) {
    this.on = on; this.level = new Spring(on ? 1 : 0, 60, 14);
    // pullS: 0 — цепочка висит, 1 — вытянута до щелчка. swing — покачивание после рывка.
    this.pullS = new Spring(0, 150, 15); this.swing = new Spring(0, 38, 2.6); this.armed = true; this.auto = 0;
  }
  // Нажали на цепочку: она уходит вниз, внизу щёлкает выключатель, цепочка возвращается и покачивается.
  pull() { this.auto = .16; this.pullS.t = 1; }
  // Тянут рукой на m метров вниз. Щелчок — когда дотянули почти до упора; чтобы щёлкнуть снова — отпустить.
  hold(m) {
    const d = m / PULL; this.auto = 0; this.pullS.t = clamp(d, 0, 1.12);
    if (this.armed && d > .8) { this.armed = false; this.toggle(); }
  }
  release() { this.pullS.t = 0; this.armed = true; this.swing.vel += .9; }
  toggle() { this.set(!this.on); this.click(); }
  click() { sfx.play('lamp-click', { gain: .9 }); }
  set(on) { this.on = on; this.level.t = on ? 1 : 0; }
  // Шаг пружин. Возвращает true, пока что-то движется (еле заметное покачивание — уже нет).
  step(dt) {
    if (this.auto > 0 && (this.auto -= dt) <= 0) { this.toggle(); this.release(); }
    const moving = !(this.level.resting && this.pullS.resting && Math.abs(this.swing.v) < .004 && Math.abs(this.swing.vel) < .01);
    this.level.step(dt); this.pullS.step(dt); this.swing.step(dt);
    return moving;
  }
}
export class Lamp extends PullSwitch {
  constructor(group, { chain, beads, len, proxy, glass, light, bounce }) {
    super();
    Object.assign(this, { group, chain, beads, len, proxy, glass, light, bounce });
    this.uOn = { value: 1 };
    for (const o of glass) o.material.userData.uOn = this.uOn;
  }
  update(dt) {
    // Еле заметное покачивание тени не меняет — не перерисовываем их зря.
    const moving = this.step(dt), k = Math.max(0, this.level.v);
    this.light.intensity = LIGHT.k * k; this.bounce.intensity = LIGHT.bounce * k; this.uOn.value = k;
    // Верхнее звено держится в лампе, остальные расходятся вниз: нижняя бусина уходит на PULL.
    const s = Math.max(0, this.pullS.v) * PULL / this.len;
    for (const b of this.beads) b.obj.position.y = b.y + b.c * s;
    this.chain.rotation.x = this.swing.v * .22;
    return moving;
  }
}

export async function buildDesk({ station, loadModel }) {
  const [deskModel, lampModel] = await Promise.all([loadModel('assets/models/antique-desk.glb'), loadModel('assets/models/bankers-lamp.glb')]);
  const d = fit(deskModel), box = new THREE.Box3().setFromObject(d), S = box.getSize(new THREE.Vector3()), H = S.y;
  shadows(d); station.add(d); station.updateMatrixWorld(true);
  const parts = {}; d.traverse(o => { if (o.isMesh) { const m = o.name.match(/^(Draw|Handle)_(\d+)/); if (m) parts[m[1] + m[2]] = o; } });
  const rel = (xr, yr, zr) => new THREE.Vector3(-S.x / 2 + xr * H, yr * H, -S.z / 2 + zr * H);
  const drawers = [];
  const make = (meshes, body, reach = .72) => {
    const g = new THREE.Group(); station.add(g); station.updateMatrixWorld(true);
    const b = localBox(body, station);
    for (const m of meshes) g.attach(m);
    // Дно — чуть выше низа ящика, стенки и передняя доска — со своей толщиной.
    const tray = { x0: b.min.x + .02, x1: b.max.x - .02, z0: b.min.z + .02, z1: b.max.z - .035, y: b.min.y + .012 };
    const dr = new Drawer(g, tray, (b.max.z - b.min.z) * reach); dr.front = S.z / 2;
    g.traverse(o => { if (o.isMesh) o.userData.drawer = dr; });
    drawers.push(dr); return dr;
  };
  // Тумбы — сначала, пока исходные ящики ещё на своих местах.
  const left = parts.Draw1, right = parts.Draw3, srcBox = { l: localBox(left, station), r: localBox(right, station) };
  const cavity = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1 });
  const pedestal = [];
  PEDESTAL.forEach(([y0, y1], row) => [['l', left], ['r', right]].forEach(([side, src], k) => {
    const sb = srcBox[side], sy = (y1 - y0) * H / (sb.max.y - sb.min.y);
    const holder = new THREE.Group(); holder.scale.y = sy; holder.position.y = y0 * H - sb.min.y * sy;
    const c = new THREE.Mesh(src.geometry, src.material);
    new THREE.Matrix4().copy(station.matrixWorld).invert().multiply(src.matrixWorld).decompose(c.position, c.quaternion, c.scale);
    holder.add(c); station.add(holder); station.updateMatrixWorld(true);
    // На месте выдвинутого ящика — тёмная глубина. Она закрывает и нарисованный фасад с крепежом ручек,
    // поэтому стоит чуть впереди него и видна, только пока ящик выдвинут.
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(sb.max.x - sb.min.x - .01, (y1 - y0) * H - .01), cavity);
    hole.position.set((sb.min.x + sb.max.x) / 2, (y0 + y1) / 2 * H, rel(0, 0, .796).z); hole.visible = false; station.add(hole);
    const handle = parts['Handle' + (5 + row * 2 + k)];
    pedestal.push({ holder, clone: c, handle, hole });
  }));
  make([parts.Draw1, parts.Handle1], parts.Draw1);
  make([parts.Draw2, parts.Handle2, parts.Handle3], parts.Draw2);
  make([parts.Draw3, parts.Handle4], parts.Draw3);
  for (const p of pedestal) {
    const dr = make([p.holder], p.clone, .95); dr.hole = p.hole;
    // Ручка стояла на нарисованном фасаде — переносим её на выдвижной, чуть вперёд.
    if (p.handle) { dr.group.attach(p.handle); p.handle.position.z += .009; p.handle.userData.drawer = dr; }
  }
  for (const dr of drawers) dr.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Рамка каждого ящика, пока он задвинут (в координатах стола): по ней вещь в руке обходит выдвинутые ящики.
  for (const dr of drawers) { dr.box = new THREE.Box3(); dr.group.traverse(o => { if (o.isMesh) dr.box.union(localBox(o, station)); }); }

  // ——— Лампа ———
  const L = fit(lampModel, { h: .46 }), group = new THREE.Group(); group.add(L); station.add(group); shadows(L);
  group.updateMatrixWorld(true);
  const lb = new THREE.Box3().setFromObject(L), lh = lb.max.y - lb.min.y, lw = Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z);
  // Абажур — две сетки высоко и во всю ширину лампы: стекло (оно доходит до самого верха) и латунная дужка, в которой оно висит.
  const shade = [], glass = [], chainParts = [];
  L.traverse(o => {
    if (!o.isMesh) return;
    const n = +(o.name.match(/^defaultMaterial_(\d+)$/)?.[1] ?? -1);
    if (n >= 4 && n <= 34) { chainParts.push(o); return; }
    const b = new THREE.Box3().setFromObject(o), w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (b.min.y > lb.min.y + lh * .62 && w > lw * .5) { shade.push(o); if (b.max.y > lb.max.y - lh * .05) glass.push(o); else o.castShadow = false; }
  });
  // Стекло абажура: снаружи приглушённый зелёный, изнутри — тёплый свет лампочки. Гаснет вместе с лампой.
  for (const o of glass) {
    o.material = o.material.clone(); o.material.side = THREE.DoubleSide; o.material.color.set(0x5a9a64); o.castShadow = false;
    o.material.onBeforeCompile = sh => {
      sh.uniforms.uOn = o.material.userData.uOn;
      sh.fragmentShader = 'uniform float uOn;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += (gl_FrontFacing ? diffuseColor.rgb * .28 : vec3(1., .84, .6) * 1.3) * uOn;');
    };
  }
  // Цепочка подвешена за верхнее звено: вокруг него она качается и от него вытягивается.
  const cb = new THREE.Box3(); chainParts.forEach(o => cb.expandByObject(o));
  const top = group.worldToLocal(new THREE.Vector3((cb.min.x + cb.max.x) / 2, cb.max.y, (cb.min.z + cb.max.z) / 2));
  const chain = new THREE.Group(); chain.position.copy(top); group.add(chain); group.updateMatrixWorld(true);
  for (const o of chainParts) chain.attach(o);
  chain.updateMatrixWorld(true);
  const len = cb.max.y - cb.min.y;
  // c — насколько звено ниже крепления (в метрах, в координатах цепочки).
  const beads = chainParts.map(o => { const c = chain.worldToLocal(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())).y; return { obj: o, y: o.position.y, c }; });
  // Цепочка тонкая — ловим нажатие по невидимому цилиндру вокруг неё.
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, len + .03, 8), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(0, -len / 2, 0); chain.add(proxy);
  const sb = new THREE.Box3(); shade.forEach(o => sb.expandByObject(o));
  const sc = group.worldToLocal(sb.getCenter(new THREE.Vector3())), sy = group.worldToLocal(sb.min.clone()).y;
  // Затухание мягче физического: иначе шнурок у самого абажура выгорает добела, а машинка в полутени.
  const light = new THREE.SpotLight(LIGHT.color, LIGHT.k, LIGHT.reach, LIGHT.angle, LIGHT.penumbra, 1);
  light.castShadow = true; light.shadow.mapSize.set(2048, 2048); light.shadow.bias = -.0002; light.shadow.normalBias = .01; light.shadow.radius = 4;
  light.shadow.camera.near = .05; light.shadow.camera.far = 5;
  light.position.set(sc.x, sy - .01, sc.z);
  // Свет падает вперёд и вправо от лампы — на рабочее место.
  light.target.position.set(sc.x + .53, -.02, sc.z + .55);
  const bounce = new THREE.PointLight(LIGHT.bounceColor, LIGHT.bounce, LIGHT.bounceReach, 2); bounce.position.set(sc.x + .62, .35, sc.z + .2);
  group.add(light, light.target, bounce);
  const lamp = new Lamp(group, { chain, beads, len, proxy, glass, light, bounce });
  // Та же лампа — для столов нижнего зала (tablelamps.js): части в осях лампы (метры, низ на y = 0, свет — к +z), подвес и длина цепочки,
  // середина абажура; source переводит в эти оси упрощённые сетки той же модели (они — в осях исходного файла).
  const inLamp = o => new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(o.matrixWorld), part = o => ({ geometry: o.geometry, matrix: inLamp(o) });
  const body = []; L.traverse(o => { if (o.isMesh && !glass.includes(o)) body.push(o); });
  const model = { body: body.map(part), glass: glass.map(part), chain: chainParts.map(part), top, len, shade: sc, material: body[0].material, glassMaterial: glass[0].material, source: inLamp(lampModel) };
  return { desk: d, deskTop: H, hw: S.x / 2, hd: S.z / 2, drawers, lamp, lampModel: model };
}
