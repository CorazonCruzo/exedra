// Закладки книги — тканевые шёлковые ляссе (решения пользователя 2026-11-21: «тканевую аккуратную», у каждой свой приглушённый тон; и «это прям страница с закладкой»).
// Как настоящее ляссе: прикреплено у головы корешка (внутри, не видно), идёт между листами g−1 и g вдоль корешка и выходит из книги у хвоста (нижний обрез, z+, к читателю),
// где свисает через обрез: короткая дуга, вниз к столу, там лежит ещё пару сантиметров; конец срезан ласточкиным хвостом. Зазор g (1…L−1) лежит в левой стопке,
// если g·T ≤ высоты левой стопки, иначе в правой. Когда зазор — верх своей стопки (книга раскрыта на его развороте), лента лежит на самой странице: ныряет под страницу у головы
// (там её прикрепление) — с самого верха страницы, лежит в сгибе разворота и уходит за хвостовой обрез; на других разворотах она внутри стопки, и видны только хвосты.
// Хвост у каждой ленты на своём месте вдоль хвостового обреза (ячейка slot из 12), чтобы лежащие на столе хвосты не накрывали друг друга.
// Вся геометрия книги — одна сетка (по ленте своя группа с материалом тона); положения пересчитываются в `layout` книги, по тем же точкам веера (`fan`), что у стопки.
// Материал — обычный MeshStandardMaterial без текстур (тот же шейдер, что у верха блока; новых шейдеров нет), тон — цветом, чуть собственного света, roughness .38.
import * as THREE from 'three';
import { Spring, clamp } from './util.js';

export const MARK_MAX = 12;
const NA = 14, NB = 32, N = NA + NB, COLS = 3, SIDES = 2, TPS = (N - 1) * 8, VPS = N * COLS * SIDES;   // ряды вдоль страницы и вдоль свисающей части; колонок, сторон; треугольников и вершин на ленту
const SLOTS = 12, PS = .002, NS = 170, TAILW = .0013, TAIL0 = .005;   // ячеек; шаг таблицы пути и её длина; шаг ячеек хвоста и где начинается первая (от сгиба, м): хвосты у самого сгиба, как у настоящего ляссе
const TONES = [0x2c4636, 0x94742a, 0x682031, 0x5a3a26, 0x56687a, 0xc9bf9f];       // бутылочный зелёный, старое золото, бордо, шоколад, пыльный сине-серый, слоновая кость
const TONE_ORDER = [0, 2, 1, 4, 3, 5];                                            // в таком порядке тона раздаются: соседние различаются
export const FOLD = { off: .005, lift: .0008 };   // на сколько от самого сгиба (м) ложится край ленты на своём развороте и на сколько она приподнята над страницей. 0,6 мм (вплотную к сгибу) правая страница прикрывала до 60 % ширины, и при сдвиге взгляда (нажатие на книгу в зале) лента «тонула» и всплывала; с 5 мм видна вся
const ss = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const frac = x => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

// Материалы тонов общие на все книги: создаются один раз; лампы им раздаёт `lightMasks` (в сцене они уже есть у пустой сетки каждой книги).
let toneMats = null;
const TONE_MATS = () => toneMats ??= TONES.map(c => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: .38, metalness: 0 }); m.emissive.set(c).multiplyScalar(.22); return m; });   // чуть собственного цвета: в тени книги лента не чернеет

// Точка веера на расстоянии s вдоль листа от корешка: [X, Y] в осях половины.
function onFan(f, s) {
  const P = f.pts, S = f.s; s = clamp(s, 0, S[S.length - 1]); let k = 0; while (k < S.length - 2 && S[k + 1] < s) k++;
  const d = S[k + 1] - S[k], q = d > 1e-9 ? (s - S[k]) / d : 0; return [P[k][0] + (P[k + 1][0] - P[k][0]) * q, P[k][1] + (P[k + 1][1] - P[k][1]) * q];
}

// Свисающая часть: путь от хвоста — o вдоль z+ (от обреза), d вдоль «вниз» (e2), по длине s. Выход прямо на 4 мм, дуга радиуса 1,6 см к направлению тяжести (turn — на какой угол, π/2 у лежащей книги),
// дальше прямо; у пола (dF — путь вниз до пола, null — пола нет) дуга обратно, и ленту несёт стол. Если до пола меньше одной дуги — пологий сход.
const PATHK = { a0: .004, r: .016, rf: .006 };   // у стола: выход прямо, радиус дуги вниз, радиус дуги у пола (м)
const STANDK = { a0: .0005, r: .0015, rf: .004, y: .03 };   // на подставке: между торцом страниц и полочкой всего 3 мм, поэтому лента поднимается вплотную к торцу (вылет 2 мм), перебирается через полочку на высоте 3 см над спинкой (лицо полочки — на 2,5 см) и висит вдоль рамки; иначе она шла бы сквозь полочку и пряталась за рамой (нажатие по хвосту попадало бы в раму)
const PATH = { o: new Float32Array(NS), d: new Float32Array(NS) };
// Дуги тем меньше, чем ближе пол (scaleOf): путь и длина меняются плавно, без скачка конца ленты, когда лента проходит мимо порога «низко / высоко».
const scaleOf = (dF, K) => dF === null ? 1 : clamp(dF / (K.r + K.rf + .004), .12, 1);
function buildPath(dF, turn, K = PATHK) {
  const O = PATH.o, D = PATH.d, a0 = K.a0, sc = scaleOf(dF, K), r = K.r * sc, rf = K.rf * sc; O[0] = D[0] = 0;
  let th = 0, o = 0, d = 0;
  for (let k = 1; k < NS; k++) {
    const s = k * PS, was = th;
    if (s > a0) {
      if (dF !== null && d >= dF - rf && th > .3) th = Math.max(0, th - PS / rf);
      else if (th < turn && !(dF !== null && d >= dF - rf && th <= .3 && d > dF - rf * 1.01)) th = Math.min(turn, th + PS / r);
    }
    const mid = (th + was) / 2; o += Math.cos(mid) * PS; d += Math.sin(mid) * PS;
    if (dF !== null) d = Math.min(d, dF);
    O[k] = o; D[k] = d;
  }
}
// Путь на длине s (за таблицей — по последнему шагу).
const tmp = [0, 0];
function atPath(s, out) {
  if (s <= 0) { out[0] = s; out[1] = 0; return; }
  const f = s / PS, k = Math.floor(f);
  if (k >= NS - 1) { const e = NS - 1, dO = PATH.o[e] - PATH.o[e - 1], dD = PATH.d[e] - PATH.d[e - 1], q = (s - e * PS) / PS; out[0] = PATH.o[e] + dO * q; out[1] = PATH.d[e] + dD * q; return; }
  const q = f - k; out[0] = PATH.o[k] + (PATH.o[k + 1] - PATH.o[k]) * q; out[1] = PATH.d[k] + (PATH.d[k + 1] - PATH.d[k]) * q;
}

const BA = new Float32Array(VPS * 3), BB = new Float32Array(VPS * 3), NA_ = new Float32Array(VPS * 3), NB_ = new Float32Array(VPS * 3);   // две раскладки ленты, пока она перетекает с одной половины на другую
const rowP = Array.from({ length: N }, () => new THREE.Vector3()), rowN = Array.from({ length: N }, () => new THREE.Vector3()), rowD = Array.from({ length: N }, () => new THREE.Vector3()), rowU = Array.from({ length: N }, () => new THREE.Vector3()), rowS = new Float32Array(N);
const sf = { x: 0, y: 0, nx: 0, ny: 1 }, e1 = new THREE.Vector3(0, 0, 1), e2 = new THREE.Vector3(), tail = new THREE.Vector3(), q1 = new THREE.Vector3();

// Точка и «вверх» поверхности веера на расстоянии s от корешка — в осях тела.
function surf(h, f, s) {
  const a = onFan(f, s), b0 = onFan(f, s - .0015), b1 = onFan(f, s + .0015), p = h.w(a[0], a[1]), dx = b1[0] - b0[0], dy = b1[1] - b0[1], l = Math.hypot(dx, dy) || 1;
  sf.x = p[0]; sf.y = p[1]; sf.nx = (h.ex[0] * -dy + h.ey[0] * dx) / l; sf.ny = (h.ex[1] * -dy + h.ey[1] * dx) / l;
}

export class Marks {
  static FOLD = FOLD;
  // data — [{ g, slot, tone }] из хранилища.
  constructor(bk, fan, data = []) {
    this.bk = bk; this.fan = fan; this.list = []; this.dirty = true; this.geo = null;
    const L = bk.leaves;
    for (const d of Array.isArray(data) ? data : []) {
      const g = Math.round(d?.g), slot = Math.round(d?.slot), tone = Math.round(d?.tone);
      if (this.list.length < MARK_MAX && g >= 1 && g <= L - 1 && slot >= 0 && slot < SLOTS && tone >= 0 && !this.list.some(m => m.g === g)) this.list.push(this.make(g, slot, tone % TONES.length));
    }
    // Сетка есть всегда (пустая): материалы тонов попадают в сцену вместе с книгой, и `lightMasks` раздаёт им лампы заранее.
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), TONE_MATS());
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.userData.book = bk; this.mesh.userData.part = 'mark';
    this.mesh.raycast = function (rc, hits) { if (this.visible && this.geometry.index) THREE.Mesh.prototype.raycast.call(this, rc, hits); };
  }
  make(g, slot, tone) { return { g, slot, tone, seed: g * 7.31 + slot * 3.7 + tone, w: .0068 + .0006 * frac(g * 3.1 + slot), pull: new Spring(0, 80, 13), dying: false, hidden: false, onPage: false }; }
  get count() { return this.list.filter(m => !m.dying).length; }
  data() { return this.list.filter(m => !m.dying).map(({ g, slot, tone }) => ({ g, slot, tone })); }
  at(g) { return this.list.find(m => m.g === g && !m.dying) ?? null; }
  // Какая ячейка и какой тон: ячейка — самая далёкая от занятых (первая — ближе к переднему краю), тон — первый не занятый по порядку.
  nextSlot() {
    const used = this.list.map(m => m.slot); if (!used.length) return 8;
    let best = 8, score = -1; for (let s = 0; s < SLOTS; s++) { if (used.includes(s)) continue; const sc = Math.min(...used.map(u => Math.abs(u - s))) + s * .01 + Math.random() * .02; if (sc > score) { score = sc; best = s; } }
    return best;
  }
  nextTone() {
    const n = TONES.map((_, t) => this.list.filter(m => m.tone === t).length);
    for (const t of TONE_ORDER) if (!n[t]) return t;
    return TONE_ORDER.reduce((a, t) => n[t] < n[a] ? t : a, TONE_ORDER[0]);
  }
  // Заложить между листами g−1 и g (зазор g); лента въезжает на место. null — уже есть или мест нет.
  add(g) {
    if (g < 1 || g > this.bk.leaves - 1 || this.at(g) || this.count >= MARK_MAX) return null;
    const m = this.make(g, this.nextSlot(), this.nextTone()); m.pull.set(.07); m.pull.t = 0; this.list.push(m); this.dirty = true; this.layout(); return m;
  }
  // Убрать: лента вытягивается из книги (сама уезжает по своему пути и исчезает).
  remove(m, fast = false) { if (!m || m.dying) return; m.dying = true; m.pull.t = .24; m.pull.k = 55; m.pull.c = 9; if (fast) m.pull.set(.24); }
  // Книга в ящике: ленты не рисуются (ящик тесный, а лента лежала бы на столе).
  setAway(v) { v = !!v; if (v === !!this.away) return; this.away = v; this.layout(); }
  snapNow() { this.snap = true; }   // следующий layout: без плавного перехода (переход на лист без анимации, закрытие, постановка)
  clear() { this.list.length = 0; this.dirty = true; this.layout(); }
  // Лента под лучом (по номеру треугольника: у каждой ленты их TPS).
  fromHit(hit) { const k = Math.floor((hit.faceIndex ?? 0) / TPS); return this.list[k] ?? null; }
  update(dt) {
    let moving = false;
    const tn = this.bk.turn, k = tn ? tn.k : -9;
    for (const m of this.list) {
      if (!m.pull.resting) { m.pull.step(dt); moving = true; if (m.pull.resting) m.pull.set(m.pull.t); }
      // «Лежит в сгибе» (fold, 0…1) плавно идёт к цели после прыжков (пролист, переход); пока лист рядом в воздухе, fold считается по его ходу (layout).
      if (m.sideT !== undefined && m.sideV !== m.sideT && !(tn && (m.g === k || m.g === k + 1))) { const d = m.sideT - m.sideV; if (Math.abs(d) < .003) m.sideV = m.sideT; else m.sideV += d * (1 - Math.exp(-dt * 9)); moving = true; }
      if (m.tgt !== undefined && m.foldV !== m.tgt && !(tn && (m.g === k || m.g === k + 1))) { const d = m.tgt - m.foldV; if (Math.abs(d) < .003) m.foldV = m.tgt; else m.foldV += d * (1 - Math.exp(-dt * 11)); moving = true; }
    }
    const dead = this.list.filter(m => m.dying && m.pull.v > .22);
    if (dead.length) { this.list = this.list.filter(m => !dead.includes(m)); this.dirty = true; moving = true; }
    if (moving || this.dirty || tn) this.layout();
    return moving;
  }
  rebuild() {
    this.dirty = false; this.geo?.dispose();
    const n = this.list.length, g = this.geo = new THREE.BufferGeometry();
    if (!n) { this.mesh.geometry = g; return; }
    const idx = new Uint32Array(n * TPS * 3); let q = 0;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * VPS * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * VPS * 3), 3));
    for (let s = 0; s < n; s++) {
      const b = s * VPS, at = (side, row, col) => b + (side * N + row) * COLS + col;
      g.addGroup(q, TPS * 3, this.list[s].tone);
      for (let side = 0; side < SIDES; side++) for (let k = 0; k < N - 1; k++) for (let j = 0; j < COLS - 1; j++) {
        const A = at(side, k, j), B = at(side, k, j + 1), C = at(side, k + 1, j + 1), D = at(side, k + 1, j);
        if (!side) { idx[q++] = A; idx[q++] = B; idx[q++] = C; idx[q++] = A; idx[q++] = C; idx[q++] = D; } else { idx[q++] = A; idx[q++] = C; idx[q++] = B; idx[q++] = A; idx[q++] = D; idx[q++] = C; }
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1)); this.mesh.geometry = g;
  }
  // Положения всех лент по состоянию книги (вызывается из `Book.layout` и пока ленты двигаются).
  layout() {
    if (this.dirty) this.rebuild();
    const fan = this.fan, bk = this.bk, n = this.list.length; this.mesh.visible = n > 0 && !this.away; if (!n || this.away) return;
    const { Wp, T, t } = bk.s, zz = bk.headZ, pos = this.geo.attributes.position, nor = this.geo.attributes.normal, P = pos.array, Nn = nor.array;
    const grav = bk.grav ?? [-1, 0], floorY = bk.floorY, tn = bk.turn, k = tn ? tn.k : -9, dir = tn ? tn.dir : 0, q = tn ? clamp(dir > 0 ? bk.turnS.v / Math.PI : 1 - bk.turnS.v / Math.PI, 0, 1) : 0;
    for (let si = 0; si < n; si++) {
      const m = this.list[si], base = si * VPS * 3, T0 = m.g * T;
      // На своём развороте зазор — верх обеих стопок: лента остаётся на той стороне, где уже лежит (после листа вперёд — справа), а не переезжает через сгиб после посадки листа.
      let left = T0 <= bk.hl + 1e-6;
      if (left && m.sideV !== undefined && !this.snap && Math.abs(t - T0 - bk.hr) < 1e-6) left = m.sideV > .5;
      const h = bk.halves[left ? 0 : 1], u = left ? T0 : t - T0;
      m.hidden = !h.stackMesh.visible || u > h.h + 1e-6 || u < 0;
      if (m.hidden) { P.fill(0, base, base + VPS * 3); Nn.fill(0, base, base + VPS * 3); continue; }
      // На странице лежит лента на верхнем зазоре стопки (разворот этой закладки). Насколько она «лежит в сгибе» — fold (0…1), число непрерывное: у хвоста лента тогда в сгибе,
      // иначе в своей ячейке; нырок под страницу у головы и подъём над ней тоже по fold. Рядом с летящим листом fold и положение считаются по ходу листа (ниже), иначе — плавно к цели.
      const hw = m.w / 2, top = u >= h.h - 1e-6; m.tgt = bk.rif ? 0 : top ? 1 : 0;
      // Пролист к развороту этой ленты: она ложится на верхнюю страницу стопки (там с последней четверти пролиста уже страницы цели) и лежит на ней до посадки последних листов,
      // а не всплывает после (пользователь 2026-11-21: «только после долистывания из ниоткуда возникает лента», «глазами ловлю задержку»). rise — насколько она поднята
      // со своего зазора на верх стопки; по времени пролиста (у пролиста за рукой — по оставшимся листам), полностью — за 0,1–0,2 с до конца.
      let rise = 0;
      if (bk.rif && Math.round(bk.rif.to) === m.g) { const r = bk.rif; m.tgt = m.foldV = rise = r.follow ? 1 - ss((Math.abs(m.g - bk.iS.v) - .5) / 3) : ss((r.t - .7 * r.D) / (.18 * r.D)); }
      if (m.foldV === undefined || this.snap) m.foldV = m.tgt;
      let fold = m.foldV;
      if (tn) {
        // Лист k в воздухе. Лента остаётся в сгибе и с листом не едет: лист проходит над ней и закрывает (она уходит под страницу), или открывает её, когда поднимается.
        // Лента в зазоре k (на левой стопке под листом): вперёд — лист ложится на неё, fold уходит к нулю до посадки; назад — открывается. Лента в зазоре k+1 (правая стопка под листом):
        // вперёд — уже лежит на странице и открывается, пока лист поднимается (не всплывает после посадки: пользователь 2026-11-21 «чтобы уже была на листе»); назад — уходит под страницу,
        // пока лист поднимается. f0 — fold на начало хода (цепочка листов).
        if (m.tnRef !== tn) { m.tnRef = tn; m.f0 = m.foldV; m.s0 = m.sideV; }
        if (m.g === k) fold = dir > 0 ? m.f0 * (1 - ss((q - .55) / .4)) : m.f0 + (1 - m.f0) * ss(q / .4);
        else if (m.g === k + 1) fold = dir > 0 ? m.f0 + (1 - m.f0) * ss(q / .4) : m.f0 * (1 - ss(q / .35));
        if (m.g === k || m.g === k + 1) m.foldV = fold;
      } else m.tnRef = null;
      m.onPage = fold > .5;
      // Какая половина держит ленту: sideV (0 — правая, 1 — левая) плавно идёт к цели после прыжков (пролист мимо зазора, переход): хвост не перелетает через книгу, а перетекает. Рядом с
      // летящим листом сторона — по его ходу. Пока лента между сторонами, обе раскладки считаются и смешиваются.
      m.sideT = left ? 1 : 0; if (m.sideV === undefined || this.snap) m.sideV = m.sideT;
      // Лента у листа в воздухе перекладывается через сгиб в такт его подъёму (первая половина хода), а не рывком.
      if (tn && (m.g === k || m.g === k + 1) && m.s0 !== undefined) m.sideV = m.s0 + (m.sideT - m.s0) * ss(q / .5);
      const side = m.sideV;
      const leftNow = left, build = (leftP, PP, NN, off) => {
        const yawT = Math.tan(.1 + (m.slot % 6) * .075) * (leftP ? -1 : 1), hh = bk.halves[leftP ? 0 : 1], u0 = leftP === leftNow ? u : clamp(leftP ? T0 : t - T0, .0004, Math.max(.0004, hh.h)), uu = u0 + (hh.h - u0) * rise, f =fan(Math.max(.0004, uu - .0003 * (1 - fold)), hh.phi, Wp);
        // На своём развороте лента лежит в самом сгибе (край ленты — у сгиба) и идёт от самого верха страницы: выходит из-за головы у корешка (решение пользователя 2026-11-21).
        const sB = TAIL0 + m.slot * TAILW, sF = hw + FOLD.off, sHead = sB + (sF - sB) * fold, sTail = sHead, ph = m.seed * 1.7;
        const z0 = -zz + .002 - .004 * fold, LA = zz - z0;
        // Часть вдоль страницы: t от 0 (голова) до 1 (хвостовой обрез). Боковой сдвиг плавный и чуть извивается.
        const lat = tt => sHead + (sTail - sHead) * ss(tt) + (.0008 + (.0005 - .0008) * fold) * Math.sin(tt * 5.3 + ph) * Math.sin(Math.PI * tt);
        const lift = FOLD.lift * fold;
        const A = (tt, c, nu) => {
          const sl = lat(tt), z = z0 + tt * LA;
          surf(hh, f, sl); c.set(sf.x + sf.nx * lift, sf.y + sf.ny * lift, z); nu.set(sf.nx, sf.ny, 0);
        };
        // Хвост: центр, направление и «вверх» последнего ряда страницы; куда «вниз» (тяжесть в осях тела) и на какой угол ленту ведёт дуга.
        A(1, tail, q1); const y0 = tail.y;
        let gy = grav[0], gz = grav[1]; const gl = Math.hypot(gy, gz) || 1; gy /= gl; gz /= gl;
        const turn = Math.atan2(Math.abs(gy), gz);          // угол между «вдоль страницы к хвосту» и направлением тяжести
        const onStand = floorY == null, lie = .012 + .012 * frac(m.seed), notch = .0045;   // ласточкин хвост у всех лент (пользователь 2026-11-21: «кончики зазубренными»)
        let len, eo = Infinity, hasFloor = false, dF = null;
        if (onStand) {
          // Подставка: у хвоста лента выходит между книгой и полочкой — перед полочкой, и висит вдоль рамки.
          e2.set(0, 1, 0); dF = Math.max(0, STANDK.y - tail.y); buildPath(dF, Math.PI / 2, STANDK);
          len = dF + STANDK.a0 + .6 * (STANDK.r + STANDK.rf) * scaleOf(dF, STANDK) + .02 + .01 * frac(m.seed);
        } else {
          eo = bk.tableEdge && floorY != null ? bk.tableEdge(tail.x, zz, 1) : Infinity;
          hasFloor = gy < -.3 && eo > PATHK.a0 + PATHK.r + .008; const fl = floorY + (si % 6) * .0004;
          e2.set(0, gy, gz); e2.addScaledVector(e1, -e2.dot(e1)).normalize();   // «вниз» поперёк хода ленты (перпендикулярно z)
          dF = hasFloor ? Math.max(0, (y0 - fl) / Math.max(.3, -e2.y)) : null;
          buildPath(dF, hasFloor ? Math.PI / 2 : turn);
          len = hasFloor ? dF + PATHK.a0 + .6 * (PATHK.r + PATHK.rf) * scaleOf(dF, PATHK) + lie : .05 + .015 * frac(m.seed);
        }
        let lenE = len; if (hasFloor && eo < 1) { let k = 1; while (k < NS - 1 && PATH.o[k] < eo - .005) k++; lenE = Math.min(len, Math.max(.03, k * PS)); }
        const pull = m.pull.v, wf = m.dying ? 1 - ss((pull - .05) / .12) : 1;
        // Ряды по материалу ленты (от прикреплённого конца): NA вдоль страницы, дальше свисающая часть, срез.
        for (let k = 0; k < NA; k++) rowS[k] = k * LA / (NA - 1);
        for (let j = 0; j < NB; j++) rowS[NA + j] = j === NB - 1 ? LA + lenE : LA + (j + 1) * (lenE - .006) / (NB - 1);
        for (let k = 0; k < N; k++) {
          const s = rowS[k] + pull;
          if (s <= LA) A(s / LA, rowP[k], rowU[k]);
          else { atPath(s - LA, tmp); rowP[k].copy(tail).addScaledVector(e1, tmp[0]).addScaledVector(e2, tmp[1]); rowP[k].x += yawT * tmp[0] * ss(tmp[0] / .025); rowU[k].copy(q1); }   // хвосты на столе чуть расходятся веером
        }
        // Ход и «вверх» каждого ряда: ход — по соседним рядам; «вверх» переносится вдоль ленты без скручивания.
        for (let k = 0; k < N; k++) { const a = rowP[Math.max(0, k - 1)], b = rowP[Math.min(N - 1, k + 1)]; rowD[k].subVectors(b, a); if (rowD[k].lengthSq() < 1e-12) rowD[k].set(0, 0, 1); rowD[k].normalize(); }
        for (let k = 0; k < N; k++) {
          const nn = rowN[k], d = rowD[k];
          if (k === 0 || k < NA) { nn.copy(rowU[k]); nn.addScaledVector(d, -nn.dot(d)); } else { nn.copy(rowN[k - 1]); nn.addScaledVector(d, -nn.dot(d)); }
          if (nn.lengthSq() < 1e-9) nn.copy(rowN[Math.max(0, k - 1)]); nn.normalize();
        }
        const th = .00011;
        for (let side = 0; side < SIDES; side++) for (let k = 0; k < N; k++) {
          const c = rowP[k], nn = rowN[k], d = rowD[k], sg = side ? -1 : 1, w2 = m.w * wf / 2;
          // поперёк ленты: a = d × n (тогда a × d = n — лицо смотрит вверх)
          const ax = d.y * nn.z - d.z * nn.y, ay = d.z * nn.x - d.x * nn.z, az = d.x * nn.y - d.y * nn.x;
          for (let j = 0; j < COLS; j++) {
            const w = (j - 1) * w2; let cx = c.x + ax * w, cy = c.y + ay * w, cz = c.z + az * w;
            // Ласточкин хвост: середина последнего ряда отступает назад по ленте.
            if (k === N - 1 && j === 1 && notch) { cx -= d.x * notch * wf; cy -= d.y * notch * wf; cz -= d.z * notch * wf; }
            const o = off + ((side * N + k) * COLS + j) * 3;
            PP[o] = cx + nn.x * th * sg; PP[o + 1] = cy + nn.y * th * sg; PP[o + 2] = cz + nn.z * th * sg;
            NN[o] = nn.x * sg; NN[o + 1] = nn.y * sg; NN[o + 2] = nn.z * sg;
          }
        }
        m.root = [tail.x, tail.y, tail.z]; m.tip = [rowP[N - 1].x, rowP[N - 1].y, rowP[N - 1].z];
      };
      if (side < .002 || side > .998) build(side > .5, P, Nn, base);
      else {
        build(true, BA, NA_, 0); build(false, BB, NB_, 0);
        for (let k = 0; k < VPS * 3; k++) { P[base + k] = BA[k] * side + BB[k] * (1 - side); Nn[base + k] = NA_[k] * side + NB_[k] * (1 - side); }
        m.root = m.root ?? [0, 0, 0];
      }
    }
    this.snap = false; pos.needsUpdate = nor.needsUpdate = true; this.geo.computeBoundingSphere(); if (this.geo.boundingBox) this.geo.computeBoundingBox();   // рамку луч проверяет раньше треугольников: устаревшая — и нажатие по хвосту уходило в раму или стол
  }
  dispose() { this.geo?.dispose(); }
}
