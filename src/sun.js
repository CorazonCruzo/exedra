// Солнце по местному времени: где оно сейчас над залом и каким светом светит в окна.
// Зал стоит длинной осью с севера на юг: −z — юг (дальний торец с веерным окном); лицом на юг восток слева (−x), запад справа (+x).
// Широта — московская: где пользователь, страница не знает и не спрашивает. Солнечный полдень — около 12:30 по часам.
import * as THREE from 'three';

const LAT = 55.75 * Math.PI / 180, NOON = 12.5, rad = Math.PI / 180;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Положение солнца на дату и время: высота над горизонтом (градусы) и направление на солнце в координатах зала.
export function sunAt(date) {
  const start = new Date(date.getFullYear(), 0, 0), n = Math.floor((date - start) / 864e5);
  const decl = 23.44 * rad * Math.sin(2 * Math.PI * (284 + n) / 365);
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600, ha = (hour - NOON) * 15 * rad;
  const sinE = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha), e = Math.asin(sinE);
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(decl) - sinE * Math.sin(LAT)) / (Math.cos(e) * Math.cos(LAT)))));
  if (ha > 0) az = 2 * Math.PI - az;
  // Азимут — от севера по часовой: север — +z, восток — −x.
  return { elev: e / rad, dir: new THREE.Vector3(-Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)) };
}

const C = h => new THREE.Color(h);
const SUN_LOW = C(0xff7a2e), SUN_GOLD = C(0xffc27a), SUN_HIGH = C(0xfff1dc);
const SKY_NIGHT = C(0x0e1830), SKY_BLUE = C(0x2c3f72), SKY_DUSK = C(0x8a6a8e), SKY_DAY = C(0xd4dde4);
// Свет по высоте солнца: день (0 ночью — 1 днём), цвет и сила солнца, видимость лучей в воздухе, небо в окнах.
// Ночь — ниже −6°, сумерки — до 0°, «золотой час» — до 10°, дальше день.
export function skyAt(elev) {
  const day = ss(-6, 18, elev), up = ss(-1, 6, elev);
  const sunColor = SUN_LOW.clone().lerp(SUN_GOLD, ss(0, 12, elev)).lerp(SUN_HIGH, ss(12, 40, elev));
  const sky = SKY_NIGHT.clone().lerp(SKY_BLUE, ss(-12, -5, elev)).lerp(SKY_DUSK, ss(-5, 0, elev) * (1 - ss(2, 12, elev))).lerp(SKY_DAY, ss(4, 25, elev));
  return {
    elev, day, sky, sunColor,
    sun: up * (2.2 + 3.3 * ss(5, 40, elev)),
    // Лучи в воздухе виднее всего на низком солнце: в пыльном воздухе зала оно светит вдоль, а не сверху.
    rays: up * (1 - .65 * ss(15, 45, elev)),
  };
}

// Время: по часам устройства; ?time=18:40 и ?date=2026-06-21 — посмотреть другое, ?speed=60 — время идёт в 60 раз быстрее.
export function clockFrom(q) {
  const t0 = Date.now(), base = new Date();
  const d = q.get('date'); if (d && /^\d{4}-\d\d-\d\d$/.test(d)) { const [y, m, dd] = d.split('-').map(Number); base.setFullYear(y, m - 1, dd); }
  const tm = q.get('time'); if (tm && /^\d{1,2}:\d\d$/.test(tm)) { const [h, mi] = tm.split(':').map(Number); base.setHours(h, mi, 0, 0); }
  const speed = Math.max(1, Math.min(3600, Number(q.get('speed')) || 1)), at = base.getTime();
  return () => new Date(at + (Date.now() - t0) * speed);
}

// Лучи из окон: призма от проёма вдоль хода света до пола, стены или торца зала. Ярче у окна, гаснет к концу;
// грани, видные вскользь, почти прозрачны — луч выглядит объёмным, а не коробкой.
export function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uStrength: { value: 0 } },
    vertexShader: `attribute float along; varying float vAlong; varying vec3 vN, vV;
      void main() { vAlong = along; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vAlong; varying vec3 vN, vV;
      void main() { float a = uStrength * pow(1. - vAlong, 1.6) * smoothstep(0., .04, vAlong) * pow(abs(dot(normalize(vN), normalize(vV))), 1.3); gl_FragColor = vec4(uColor * a, 1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
// polys — контуры окон (точки на стекле) с наружной нормалью; box — стены зала; d — куда идёт свет (от солнца).
export function shaftGeometry(polys, d, box, maxLen = 32) {
  const pos = [], along = [], tmp = new THREE.Vector3();
  for (const { pts, out } of polys) {
    if (-d.dot(out) < .06) continue;
    // Длина — до первой стены зала от середины окна.
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    let L = maxLen;
    for (const ax of ['x', 'y', 'z']) if (Math.abs(d[ax]) > 1e-4) { const t = ((d[ax] > 0 ? box.max[ax] : box.min[ax]) - c[ax]) / d[ax]; if (t > .5) L = Math.min(L, t); }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], a2 = tmp.copy(a).addScaledVector(d, L).clone(), b2 = b.clone().addScaledVector(d, L);
      pos.push(...a.toArray(), ...b.toArray(), ...b2.toArray(), ...a.toArray(), ...b2.toArray(), ...a2.toArray()); along.push(0, 0, 1, 0, 1, 1);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1)); g.computeVertexNormals();
  return g;
}
