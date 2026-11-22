// Общие мелочи зала: пружина, подгонка моделей по размеру, короткие звуки.
import * as THREE from 'three';

export const Y = new THREE.Vector3(0, 1, 0);
export const clamp = THREE.MathUtils.clamp;

// Пружина листа при зажатой стрелке: n-й лист подряд. Первые — ещё неспешно (около 3 в секунду), потом до потолка в 8 в секунду (лист — не быстрее ~0,12 с; HOLD_MIN держит этот потолок).
// Критическое затухание садится долго, поэтому при зажатой стрелке лист считается легшим раньше: 0,06 рад (3,4°) от цели и неспешный ход.
export const holdSettled = (ts, hold) => ts.resting || (Math.abs(ts.t - ts.v) < (hold ? .06 : .02) && Math.abs(ts.vel) < (hold ? 4 : 1.5));
export const HOLD_MIN = 120;   // мс: лист при зажатой стрелке не оборачивается быстрее — не больше 8 листов в секунду
export const holdSpring = n => { const u = Math.min(1, n / 10), k = 290 + 1750 * u * u; return [k, 1.9 * Math.sqrt(k)]; };
export class Spring {
  constructor(v, k = 120, c = 16) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  step(dt) { const n = Math.ceil(dt / .01), h = dt / n; for (let i = 0; i < n; i++) { this.vel += (this.k * (this.t - this.v) - this.c * this.vel) * h; this.v += this.vel * h; } return this.v; }
  set(v) { this.v = this.t = v; this.vel = 0; }
  get resting() { return Math.abs(this.t - this.v) < 1e-4 && Math.abs(this.vel) < 1e-4; }
}

// Модель в метрах: высота h (или ширина w), стоит на y = 0, центр по x и z.
export function fit(obj, { h, w } = {}) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = h ? h / size.y : w ? w / size.x : 1;
  const g = new THREE.Group(); obj.position.set(-c.x, -box.min.y, -c.z); g.add(obj); g.scale.setScalar(k); return g;
}
// Развёртка в метрах по нормали грани: у бруса любой длины текстура дерева одного масштаба, а не растянута на всю длину.
// grain — ось волокон ('x', 'y' или 'z'); по умолчанию — вдоль самой длинной стороны. Волокна текстуры идут по u.
export function metricUV(geo, grain) {
  geo.computeBoundingBox(); const s = geo.boundingBox.getSize(new THREE.Vector3());
  grain ??= s.x >= s.y && s.x >= s.z ? 'x' : s.z >= s.y ? 'z' : 'y';
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2), get = (a, i) => a === 'x' ? p.getX(i) : a === 'y' ? p.getY(i) : p.getZ(i);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const axes = ax >= ay && ax >= az ? ['z', 'y'] : ay >= az ? ['x', 'z'] : ['x', 'y'];
    if (axes[1] === grain) axes.reverse();
    uv[i * 2] = get(axes[0], i); uv[i * 2 + 1] = get(axes[1], i);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}
// Картинки внутри моделей — через обычную <img>, а не ImageBitmapLoader: у того в Chrome декодирование blob иногда срывается,
// и модель (шкаф, машинка) остаётся без текстур. GLTFLoader всё равно переворачивает их как надо (flipY = false).
export function plainImages(loader) {
  return loader.register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin); return { name: 'reading_room_plain_images' }; });
}
export const shadows = (o, cast = true, receive = true) => o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } });

export function radial(stops, size = 128) {
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size }), g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Запись звука по адресу. Сорвавшийся запрос повторяется: иначе звук молчал бы до следующего открытия зала.
export async function fetchSound(ctx, url, tries = 3) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return await ctx.decodeAudioData(await r.arrayBuffer()); }
    catch (e) { if (i >= tries) throw e; await new Promise(done => setTimeout(done, 400 * i)); }
  }
}

// Короткие записанные звуки зала: ящики, страницы, выключатель лампы.
export const sfx = (() => {
  let ctx = null, on = true; const bufs = {};
  return {
    load(base, names) {
      ctx ??= new AudioContext();
      for (const n of names) fetchSound(ctx, `${base}${n}.wav`).then(b => { bufs[n] = b; }).catch(e => console.warn(e));
    },
    wake() { if (ctx?.state === 'suspended') ctx.resume(); },
    get on() { return on; }, set on(v) { on = v; },
    play(n, { gain = 1, rate = 1 } = {}) {
      if (!on || !ctx || !bufs[n]) return;
      this.wake();
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = bufs[n]; s.playbackRate.value = rate; g.gain.value = gain;
      s.connect(g).connect(ctx.destination); s.start();
    },
  };
})();
