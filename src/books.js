// Книги на полках: вместо нарисованных в модели шкафа рядов — отдельные тома.
// Разной толщины, высоты и глубины, сериями и вразнобой, кое-где наклонился том или лежит стопка.
// Корешок скруглён по-настоящему (дуга в сечении, тем круче, чем толще том); бинты, тиснение и ярлыки — рельефом,
// зерно и пятна кожи — со скана настоящей кожи, у каждого тома свои.
// Рисунки корешков — в двух текстурах. Цвет: красный канал — светотень (половина — «как есть»), зелёный — позолота,
// синий — бумага (наклейка), прозрачность — цветной кожаный ярлык. Рельеф: наклон поверхности и гладкость.
// Названия — отдельной текстурой (titleAtlas): у каждого тома своё, у серии — одно на всех; рисунок корешка знает только место для него.
import * as THREE from 'three';
import { TITLES } from './titles.js';

const COLS = 16, CW = 128, CH = 992, PLAIN = 32;
// NOM — ширина корешка, на которую нарисован рисунок: у тома толще он не растягивается, а остаётся посередине (линейки и ярлыки
// тянутся до краёв). B — выгиб корешка в сетке (в долях глубины тома); настоящий выгиб ставит шейдер. DET — сторона скана кожи на томе, м.
const NOM = .036, B = .03, DET = .1;
// Названия: клетка на одно название и сколько клеток в ряду текстуры.
const TW = 128, TH = 64, TCOLS = 16, TROWS = Math.ceil(TITLES.length / TCOLS);
// Тона старых переплётов научной библиотеки: больше всего коричневой телячьей кожи разной выдержки,
// тёмный сафьян (бордо, зелень), чёрный коленкор, потемневший пергамент. Повторы — чтобы коричневых было больше.
const TONES = ['#3a2418', '#4a2c1a', '#5a3820', '#2e1d14', '#6b4428', '#4e3a28', '#33251c', '#3a2418', '#4a2c1a', '#5a3820', '#3d1612', '#4a1a16', '#1e2a20', '#22201e', '#2a2622', '#5a4832'];
// Рисунки корешков: чаще кожа с бинтами, золотом и ярлыками, реже гладкие и с бумажными наклейками.
const DESIGNS = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 9, 9, 10, 11, 11, 12, 13, 13, 14, 15];

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

function spineAtlas() {
  const W = COLS * CW, H = CH + PLAIN, R = rng(97);
  // Слои рисуются по отдельности и потом сводятся в две текстуры. У светотени и высоты серое — «как есть»; позолота, бумага
  // и цветной ярлык — на одном холсте, каждый в своём канале (краски складываются).
  const layer = (base, add) => { const g = Object.assign(document.createElement('canvas'), { width: W, height: CH }).getContext('2d', { willReadFrequently: true }); g.fillStyle = base; g.fillRect(0, 0, W, CH); if (add) g.globalCompositeOperation = 'lighter'; return g; };
  const L = { shade: layer('#808080'), height: layer('#808080'), mask: layer('#000', true) };
  const white = a => `rgba(255,255,255,${a})`, black = a => `rgba(0,0,0,${a})`, GOLD = '#0f0', PAPER = '#00f', TINT = '#f00';
  const rect = (g, v0, v1, style, u0 = 0, u1 = 1) => { g.fillStyle = style; g.fillRect(u0 * CW, v0 * CH, (u1 - u0) * CW, (v1 - v0) * CH); };
  const ramp = (g, y0, y1, stops) => { const gr = g.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(0, y0, CW, y1 - y0); };
  const stamp = fn => { for (const [g, style] of [[L.mask, GOLD], [L.height, black(.22)]]) { g.save(); g.fillStyle = g.strokeStyle = style; fn(g); g.restore(); } };
  // Бинт — валик поперёк корешка: гребень вытерт до светлого и гладкий, по сторонам тёмные ложбинки, куда набилась пыль.
  const band = (v, hw = 9) => {
    const y = v * CH, a = y - hw * 1.9, b = y + hw * 1.9;
    ramp(L.height, a, b, [[0, white(0)], [.24, white(0)], [.37, white(.45)], [.5, white(.7)], [.63, white(.45)], [.76, white(0)], [1, white(0)]]);
    ramp(L.shade, a, b, [[0, black(0)], [.2, black(.42)], [.33, black(0)], [.5, white(.2)], [.67, black(0)], [.8, black(.48)], [1, black(0)]]);
  };
  // Золотая линейка (вдавлена штампом) и слепая — без золота.
  const rule = (v, t = 2) => stamp(g => g.fillRect(0, Math.round(v * CH), CW, t));
  const blind = (v, t = 3) => { rect(L.height, v, v + t / CH, black(.3)); rect(L.shade, v, v + t / CH, black(.3)); };
  // Место для названия (сами названия — в titleAtlas): v — середина по высоте корешка; along — вдоль корешка и вдвое крупнее;
  // mode: 1 — золотом (на бумажной наклейке — краской), меньше — стёртое золото, −1 — краской.
  // На этом месте рисуются условные строчки золотом (dummy) — их видно издалека; вблизи шейдер кладёт вместо них настоящее название.
  const slots = [], title = (v, mode = 1, along = false, dummy = mode > 0) => {
    slots[slots.length - 1] = [v, (along ? 2 * TW : TH) / CH, along ? 1 : 0, mode];
    if (!dummy) return;
    const g = L.mask, rows = along ? [0] : [-9, 9], len = along ? 170 : CW * .56, h = along ? 20 : 9;
    g.save(); g.translate(CW / 2, v * CH); if (along) g.rotate(Math.PI / 2); g.fillStyle = `rgba(0,255,0,${.75 * mode})`;
    for (const y of rows) for (let x = -len / 2 + R() * 6; x < len / 2 - 4;) { const w = Math.min(len / 2 - x, (along ? 12 : 5) + R() * (along ? 14 : 8)); g.fillRect(x, y - h / 2, w, h); x += w + 3 + R() * 3; }
    g.restore();
  };
  // Штампы переплётчика: ромб, розетка, звезда, цветок.
  const tool = (kind, v, r = 13) => stamp(g => {
    g.translate(CW / 2, v * CH); g.lineWidth = Math.max(1.5, r * .13); g.lineJoin = 'round';
    const dot = (x, y, q) => { g.beginPath(); g.arc(x, y, q, 0, 7); g.fill(); };
    const leaf = (a, d, l, w) => { g.save(); g.rotate(a); g.beginPath(); g.ellipse(0, -d, w, l, 0, 0, 7); g.fill(); g.restore(); };
    if (kind === 'lozenge') { g.beginPath(); g.moveTo(0, -r); g.lineTo(r * .62, 0); g.lineTo(0, r); g.lineTo(-r * .62, 0); g.closePath(); g.stroke(); dot(0, 0, r * .2); }
    else if (kind === 'rosette') { for (let k = 0; k < 8; k++) leaf(k * Math.PI / 4, r * .58, r * .36, r * .15); dot(0, 0, r * .2); }
    else if (kind === 'star') { for (let k = 0; k < 4; k++) { g.save(); g.rotate(k * Math.PI / 4); g.fillRect(-r, -g.lineWidth * .4, 2 * r, g.lineWidth * .8); g.restore(); } dot(0, 0, r * .26); }
    else { for (let k = 0; k < 4; k++) { leaf(k * Math.PI / 2, r * .62, r * .38, r * .17); leaf(k * Math.PI / 2 + Math.PI / 4, r * .5, r * .24, r * .1); } dot(0, 0, r * .22); dot(-r * 1.3, 0, r * .1); dot(r * 1.3, 0, r * .1); }
  });
  const frame = (v0, v1, inset = 10) => stamp(g => { g.lineWidth = 1.5; g.strokeRect(inset, v0 * CH + 5, CW - 2 * inset, (v1 - v0) * CH - 10); });
  // Накатка: ряд мелких ромбиков поперёк корешка.
  const roll = (v, n = 11) => stamp(g => { for (let k = 0; k < n; k++) { const x = (k + .5) / n * CW, y = v * CH; g.beginPath(); g.moveTo(x, y - 3.5); g.lineTo(x + 3, y); g.lineTo(x, y + 3.5); g.lineTo(x - 3, y); g.fill(); } });
  // Кожаный ярлык: чёрный или цветной (red), чуть выше кожи корешка и глаже её, по краям золотые линейки.
  const label = (v0, v1, red) => { rect(red ? L.mask : L.shade, v0, v1, red ? TINT : black(.7)); rect(L.height, v0, v1, white(.14)); rule(v0 + .005); rule(v1 - .007); };
  // Бумажная наклейка; chip — оторванный уголок.
  const sticker = (v0, v1, u0 = .1, u1 = .9, chip = 0) => {
    const x0 = u0 * CW, x1 = u1 * CW, y0 = v0 * CH, y1 = v1 * CH, c = chip * (x1 - x0);
    for (const [g, style] of [[L.mask, PAPER], [L.height, white(.1)]]) { g.fillStyle = style; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1, y1 - c); g.lineTo(x1 - c * .7, y1 - c * .35); g.lineTo(x1 - c, y1); g.lineTo(x0, y1); g.closePath(); g.fill(); }
  };
  const five = [.155, .32, .485, .65, .815], four = [.19, .395, .6, .805], six = [.13, .275, .42, .565, .71, .855], three = [.25, .5, .75];
  // Поля между бинтами: fn(номер, середина, верх, низ).
  const panels = (b, fn) => { for (let k = 0; k <= b.length; k++) { const a = k ? b[k - 1] + .03 : .025, z = k < b.length ? b[k] - .03 : .975; fn(k, (a + z) / 2, a, z); } };
  const designs = [
    // 0 — телячья кожа, пять бинтов; в полях рамки с цветком, название — прямо по коже
    () => { five.forEach(v => band(v)); panels(five, (k, c, a, z) => { if (k === 1) title(c); else { frame(a, z); tool('fleur', c, 11); } }); },
    // 1 — пять бинтов, красный ярлык с названием, под ним чёрный с ромбом, в остальных полях розетки
    () => { five.forEach(v => { band(v); rule(v - .026); rule(v + .024); }); panels(five, (k, c, a, z) => { if (k === 1) { label(a + .004, z - .004, true); title(c); } else if (k === 2) { label(a + .02, z - .02); tool('lozenge', c, 10); } else tool('rosette', c, 12); }); },
    // 2 — четыре бинта, двойные линейки, чёрный ярлык
    () => { four.forEach(v => { band(v); rule(v - .03); rule(v - .023, 1); rule(v + .028); rule(v + .023, 1); }); panels(four, (k, c, a, z) => { if (k === 1) { label(a + .012, z - .012); title(c); } else tool('star', c, 13); }); },
    // 3 — гладкий корешок, разбитый двойными линейками, красный ярлык, розетки
    () => { for (const v of [.03, .2, .35, .52, .69, .86, .962]) { rule(v, 3); rule(v + .008, 1); } label(.215, .345, true); title(.28); for (const v of [.115, .435, .605, .775, .915]) tool('rosette', v, v > .9 ? 8 : 12); },
    // 4 — два чёрных кожаных ярлыка с золотом, как на старых собраниях сочинений
    () => { label(.13, .27); title(.2); label(.68, .76); tool('lozenge', .72, 9); rule(.04, 3); rule(.957, 3); tool('fleur', .47, 14); },
    // 5 — полукожа: тёмные верх и низ, широкие золотые полосы
    () => { rect(L.shade, 0, .1, black(.4)); rect(L.shade, .9, 1, black(.4)); rule(.1, 4); rule(.896, 4); title(.22); rule(.3, 1); tool('fleur', .58, 17); rule(.82, 1); },
    // 6 — потёртый, выгоревший: слепые линейки, от названия осталась тень
    () => { rect(L.shade, 0, 1, white(.14)); for (const v of [.09, .105, .88, .895]) blind(v); title(.19, .5); },
    // 7 — коленкор с бумажной наклейкой наверху
    () => { blind(.035); blind(.96); sticker(.085, .25, .1, .9, .14); title(.165, 1, false, false); for (const v of [.105, .228]) rect(L.shade, v, v + 1.5 / CH, black(.6), .16, .84); },
    // 8 — бумажная обложка с напечатанным названием, внизу библиотечная наклейка
    () => { title(.15, -1); rect(L.shade, .215, .217, black(.6), .3, .7); sticker(.87, .93, .22, .78); rect(L.shade, .897, .9, black(.55), .36, .64); },
    // 9 — шесть частых бинтов, мелкое название, звёздочки
    () => { six.forEach(v => band(v, 7)); panels(six, (k, c) => { if (k === 1) title(c); else tool('star', c, 9); }); rule(.012); rule(.985); },
    // 10 — название вдоль корешка
    () => { for (const v of [.045, .06, .935, .95]) rule(v); title(.47, 1, true); tool('lozenge', .12, 9); tool('lozenge', .87, 9); },
    // 11 — богатое тиснение: накатка по бинтам, двойные рамки, красный ярлык
    () => { five.forEach(v => { band(v); roll(v); }); panels(five, (k, c, a, z) => { if (k === 1) { label(a, z, true); title(c); } else { frame(a, z, 8); frame(a + .008, z - .008, 16); tool('fleur', c, 11); } }); roll(.012); roll(.988); },
    // 12 — гладкий, с широкими золотыми полосами и большим ромбом
    () => { rule(.03, 5); rule(.045, 1); rule(.052, 1); rule(.943, 1); rule(.95, 1); rule(.962, 5); rule(.14, 1); title(.19); rule(.24, 1); tool('lozenge', .56, 26); tool('rosette', .56, 8); },
    // 13 — четыре бинта, чёрный ярлык, внизу библиотечная наклейка с оторванным уголком
    () => { four.forEach(v => band(v)); panels(four, (k, c, a, z) => { if (k === 1) { label(a + .01, z - .01); title(c); } else if (k < 4) tool('fleur', c, 12); }); sticker(.9, .955, .2, .8, .2); rect(L.shade, .925, .928, black(.55), .34, .62); },
    // 14 — три широких плоских бинта
    () => { three.forEach(v => { band(v, 13); rule(v - .04); rule(v + .038); }); title(.125); tool('star', .375, 13); tool('star', .625, 13); tool('lozenge', .875, 11); },
    // 15 — гладкий коленкор: название наверху, ромбик внизу
    () => { blind(.03); rule(.09); title(.125); rule(.16); tool('lozenge', .93, 7); blind(.965); },
  ];
  const all = Object.values(L);
  designs.forEach((draw, i) => {
    for (const g of all) { g.save(); g.beginPath(); g.rect(i * CW, 0, CW, CH); g.clip(); g.translate(i * CW, 0); }
    slots.push([0, 1, 0, 0]); draw();
    // Каптал: валик у верхнего и нижнего края корешка.
    ramp(L.height, 0, 12, [[0, white(.5)], [1, white(0)]]); ramp(L.height, CH - 12, CH, [[0, white(0)], [1, white(.5)]]);
    for (const g of all) g.restore();
  });
  // Точка холста — одно 32-битное число (младший байт — красный): так сведение двух миллионов точек идёт втрое быстрее, чем по байтам.
  const px = k => new Uint32Array(L[k].getImageData(0, 0, W, CH).data.buffer), S = px('shade'), M = px('mask'), Hh = px('height');
  const color = new Uint8Array(W * H * 4), relief = new Uint8Array(W * H * 4), C32 = new Uint32Array(color.buffer), R32 = new Uint32Array(relief.buffer).fill(0xff808080);
  let seed = 97; const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 8) / 16777216;
  const slope = d => { const v = 128 + (d * 3 >> 1); return v < 0 ? 0 : v > 255 ? 255 : v; };
  for (let y = 0, i = 0; y < CH; y++) {
    const up = y ? -W : 0, down = y < CH - 1 ? W : 0;
    for (let x = 0; x < W; x++, i++) {
      const cx = x % CW, m = M[i], h = Hh[i] & 255;
      // Светотень, позолота (местами осыпалась), бумага, цветной ярлык.
      let gold = m >> 8 & 255; if (gold) gold = gold * (.86 + rnd() * .14) * (rnd() > .1 ? 1 : .35) | 0;
      C32[i] = S[i] & 255 | gold << 8 | (m >> 16 & 255) << 16 | (m & 255) << 24;
      // Рельеф — наклон высоты (по краям столбца — без соседнего рисунка); гладкость — всё выпуклое вытерто до блеска.
      const dx = (Hh[cx ? i - 1 : i] & 255) - (Hh[cx < CW - 1 ? i + 1 : i] & 255), dy = (Hh[i + down] & 255) - (Hh[i + up] & 255);
      if (dx || dy || h > 128) R32[i] = slope(dx) | slope(dy) << 8 | (h > 128 ? Math.min(255, 128 + (h - 128) * 1.1 | 0) : 128) << 16 | 0xff000000;
    }
  }
  // Внизу — гладкие места: крышки переплёта и верх книги — обрез (страницы между крышками различает шейдер).
  // Листы — тонкими полосками, между тетрадями — щели потемнее.
  const pages = new Uint8Array(W); for (let x = 0, gap = 0; x < W; x++) pages[x] = 112 + R() * 34 - (gap-- <= 0 ? (gap = 6 + R() * 9, 44) : 0);
  for (let y = CH; y < H; y++) for (let x = 0; x < W; x++) color[(y * W + x) * 4] = y >= CH + PLAIN / 2 ? pages[x] : 120 + R() * 10;
  const tex = data => { const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };
  return { color: tex(color), relief: tex(relief), slots };
}

// Названия: каждое в своей клетке, белым по чёрному — шейдер кладёт его золотом или краской на место, отведённое рисунком корешка.
// Строки — по середине клетки; длинная строка сжимается, чтобы по краям оставалось поле.
function titleAtlas() {
  const g = Object.assign(document.createElement('canvas'), { width: TW * TCOLS, height: TH * TROWS }).getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, TW * TCOLS, TH * TROWS); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  TITLES.forEach(([text], i) => {
    const lines = text.split('|'), px = [16, 14, 12.5][lines.length - 1], x = (i % TCOLS + .5) * TW, y = (Math.floor(i / TCOLS) + .5) * TH;
    g.font = `bold ${px}px Georgia, "Times New Roman", serif`;
    lines.forEach((s, k) => { const f = Math.min(1, TW * .78 / g.measureText(s).width); g.save(); g.translate(x, y + (k - (lines.length - 1) / 2) * px * 1.28); g.scale(f, 1); g.fillText(s, 0, 0); g.restore(); });
  });
  const t = new THREE.CanvasTexture(g.canvas); t.flipY = false; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Кожа: скан настоящей кожи (ambientCG Leather029 — та же, что на подшивках). Красный и зелёный — её рельеф, синий — зерно
// и пятна покрупнее (шум, который сходится на краях). Пока скан не загрузился — только пятна.
function leatherDetail() {
  const N = 512, data = new Uint8Array(N * N * 4).fill(128), blot = new Float32Array(N * N), R = rng(4211);
  // Три слоя пятен разной крупности; сетка случайных чисел повторяется по краям — пятна сходятся на стыке.
  for (const [n, amp] of [[4, .5], [9, .32], [23, .2]]) {
    const a = Float32Array.from({ length: n * n }, R), at = new Int32Array(N), next = new Int32Array(N), mix = new Float32Array(N);
    for (let x = 0; x < N; x++) { const f = x / N * n, k = Math.floor(f), t = f - k; at[x] = k; next[x] = (k + 1) % n; mix[x] = t * t * (3 - 2 * t); }
    for (let y = 0, i = 0; y < N; y++) { const r0 = at[y] * n, r1 = next[y] * n, sy = mix[y]; for (let x = 0; x < N; x++, i++) { const sx = mix[x]; blot[i] += ((a[r0 + at[x]] * (1 - sx) + a[r0 + next[x]] * sx) * (1 - sy) + (a[r1 + at[x]] * (1 - sx) + a[r1 + next[x]] * sx) * sy - .5) * amp; } }
  }
  for (let i = 0; i < N * N; i++) { blot[i] += .5; data[i * 4 + 2] = blot[i] * 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  const load = src => new Promise(done => { const im = new Image(); im.onload = () => done(im); im.onerror = () => done(null); im.src = src; });
  Promise.all([load('assets/textures/leather-normal.jpg'), load('assets/textures/leather-color.jpg')]).then(([relief, grain]) => {
    if (!relief || !grain) return;
    const g = Object.assign(document.createElement('canvas'), { width: N, height: N }).getContext('2d', { willReadFrequently: true });
    const read = im => { g.drawImage(im, 0, 0, N, N); return g.getImageData(0, 0, N, N).data; }, n = read(relief), c = read(grain), lum = i => c[i] * .3 + c[i + 1] * .59 + c[i + 2] * .11;
    let mean = 0; for (let i = 0; i < N * N; i++) mean += lum(i * 4) / (N * N);
    for (let i = 0; i < N * N; i++) { data[i * 4] = n[i * 4]; data[i * 4 + 1] = n[i * 4 + 1]; data[i * 4 + 2] = Math.max(0, Math.min(255, blot[i] * 255 + (lum(i * 4) - mean) * 2.6)); }
    t.needsUpdate = true;
  });
  return t;
}

// Том: в сечении — прямоугольник, у которого сторона корешка (+z) выгнута дугой. Единичный размер, в экземплярах растягивается.
// Корешок берёт свой рисунок из атласа, крышки — гладкое место внизу атласа, верх — обрез страниц между крышками.
// far — том для вида издалека: 22 треугольника вместо 44, без задней стороны, которой не видно. Вдали том шириной в три-четыре точки экрана,
// и мелкие треугольники вместе со сглаживанием краёв заставляли считать каждую точку по нескольку раз — книги стоили седьмую часть кадра.
function bookGeometry(far = false) {
  const H = CH + PLAIN, pos = [], nor = [], uv = [], face = [], idx = [];
  // f — какая это сторона: 0 — корешок, 1 — крышка, 2 — обрез (шейдеру).
  const v = (p, n, t, f) => { pos.push(...p); nor.push(...n); uv.push(...t); face.push(f); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => idx.push(a, b, d, b, c, d);
  const coverV = (CH + PLAIN * .25) / H, topV = (CH + PLAIN * .75) / H, sv = y => (.5 - y) * (CH - 1) / H + .5 / H;
  // У тома попроще дуга — из четырёх отрезков: два узких у крышек, как у подробного (там корешок поворачивает), и два широких посередине
  // (там он почти плоский). Свет ложится так же, отличие в форме — меньше миллиметра.
  const arc = (far ? [0, 1, 4, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8]).map(k => { const a = Math.PI * k / 8; return { x: -.5 * Math.cos(a), z: .5 + B * Math.sin(a), nx: -B * Math.cos(a), nz: .5 * Math.sin(a), u: k / 8 }; });
  // Корешок.
  const sp = arc.map(p => { const l = Math.hypot(p.nx, p.nz); return [v([p.x, .5, p.z], [p.nx / l, 0, p.nz / l], [p.u, sv(.5)], 0), v([p.x, -.5, p.z], [p.nx / l, 0, p.nz / l], [p.u, sv(-.5)], 0)]; });
  for (let i = 0; i + 1 < sp.length; i++) quad(sp[i][0], sp[i][1], sp[i + 1][1], sp[i + 1][0]);
  // Крышки и обрез (сзади).
  const flat = (pts, n) => { const k = pts.map(p => v(p, n, [.5, coverV], 1)); quad(k[0], k[1], k[2], k[3]); };
  flat([[-.5, .5, -.5], [-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5]], [-1, 0, 0]);
  flat([[.5, .5, .5], [.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5]], [1, 0, 0]);
  if (!far) flat([[.5, .5, -.5], [.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5]], [0, 0, -1]);
  // Верх и низ — веером от середины (у тома попроще — от угла: треугольников меньше).
  const outline = [...arc.map(p => [p.x, p.z]), [.5, -.5], [-.5, -.5]];
  for (const y of [.5, -.5]) {
    const ring = outline.map(([x, z]) => v([x, y, z], [0, Math.sign(y), 0], [x + .5, topV], 2)), c = far ? ring.pop() : v([0, y, 0], [0, Math.sign(y), 0], [.5, topV], 2);
    for (let i = 0; i < ring.length - (far ? 1 : 0); i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (y > 0) idx.push(c, a, b); else idx.push(c, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1)); g.setIndex(idx);
  return g;
}

// Верхний ярус — светлее по цвету: выше по шкафу на галерее дерево светлее и теплее, плавно, к расписному своду.
// amount — насколько (у шкафов целиком, у книг — слабее).
export function liftUpper(m, amount = 1) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = 'varying float vLiftY;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 liftP = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        liftP = instanceMatrix * liftP;
      #endif
      vLiftY = (modelMatrix * liftP).y;`);
    sh.fragmentShader = 'varying float vLiftY;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= mix(vec3(1.), vec3(1.75, 1.6, 1.38), ${amount.toFixed(3)} * smoothstep(.3, 4.4, vLiftY));`);
  };
  // У материала без своего ключа ключ — текст onBeforeCompile, а он теперь у всех одинаковый: берём текст прежнего.
  const base = key === THREE.Material.prototype.customProgramCacheKey ? prev.toString() : key.call(m);
  m.customProgramCacheKey = () => base + '|lift' + amount;
  return m;
}
// far — материал для томов вдали (дальше FAR метров, вместе с томом попроще): без настоящих названий — на корешке шириной
// в полтора десятка точек букв не разобрать, там видны условные строчки из рисунка корешка. Выборка названия и четыре числа,
// которые ради неё едут из каждой вершины в точки экрана, на всех книгах зала стоили 0,4–1 мс кадра с места за столом
// (замер 2026-11-15); вблизи шкафов немного, там это незаметно.
function bookMaterial({ color, relief, slots }, leather, titles, far = false) {
  const m = new THREE.MeshStandardMaterial({ map: color, roughness: .74, metalness: 0 });
  if (far) m.defines = { ...m.defines, BOOK_FAR: 1 };
  const f = n => n.toFixed(5), slotList = slots.map(s => `vec4(${s.map(f).join(', ')})`).join(', ');
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uRelief: { value: relief }, uLeather: { value: leather }, uTitles: { value: titles } });
    const pars = 'varying vec3 vBookWorld;\nvarying vec3 vBT;\nvarying vec3 vBB;\nvarying vec2 vDet;\nvarying vec4 vBk;\n#ifndef BOOK_FAR\nvarying vec4 vTtl;\n#endif\n';
    sh.vertexShader = `attribute vec2 aSpine;\nattribute float aFace;\n#ifndef BOOK_FAR\nconst vec4 SLOT[${slots.length}] = vec4[${slots.length}](${slotList});\n#endif\n` + pars + sh.vertexShader
      // vBk: x — какая это сторона (корешок, крышка, обрез), y — число тома, z — место поперёк корешка (у толстого тома рисунок
      // не растягивается; считается поперёк тома, а не по дуге: корешок пологий, и по дуге буквы посередине расползались),
      // w — расстояние до края корешка в метрах, а на обрезе — глубина. vDet — место на скане кожи, у каждого тома своё.
      // aSpine — номер рисунка корешка и номер названия. vTtl (только вблизи) — место в клетке названия, номер клетки и чем оно нанесено.
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 bSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), bP = position * bSc;
        vBk = vec4(aFace, fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453),
          aFace < .5 ? .5 + position.x * max(.78, bSc.x / ${NOM}) : uv.x, aFace < .5 ? (.5 - abs(position.x)) * bSc.x : position.z);
        vMapUv.x = aSpine.x;
        #ifndef BOOK_FAR
          vec4 slot = SLOT[int(aSpine.x + .5)];
          float tAlong = (.5 - position.y - slot.x) / slot.y + .5;
          vTtl = aFace < .5 ? vec4(slot.z > .5 ? vec2(tAlong, 1. - vBk.z) : vec2(vBk.z, tAlong), aSpine.y, slot.w) : vec4(-1., -1., 0., 0.);
        #endif
        vDet = (aFace < .5 ? bP.xy : aFace < 1.5 ? bP.zy : bP.xz) / ${DET} + vBk.y * vec2(7.3, 3.1);`)
      // Корешок выгнут в меру толщины тома, а не глубины: тонкий — чуть, толстый — заметной дугой.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float bBulge = clamp(.27 * bSc.x, .003, .015) / bSc.z;
        if (aFace < .5) objectNormal = normalize(vec3(2. * bBulge * position.x, 0., .5 * (position.z - .5) / ${B}));`)
      // Оси рисунка на этой стороне тома — для рельефа: вверх по корешку и крышке, вглубь на обрезе.
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vBB = normalize(mat3(modelViewMatrix) * (mat3(instanceMatrix) * (aFace > 1.5 ? vec3(0., 0., -1.) : vec3(0., 1., 0.))));
        vBT = cross(vBB, normalize(transformedNormal));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n if (position.z > .5) transformed.z = .5 + (position.z - .5) * bBulge / ${B};`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n vBookWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;');
    // Мягкий свет из зала: от середины зала и чуть сверху. Ложится на скруглённые корешки полосой, как от люстр,
    // и не трогает остальной зал (без лишних ламп и теней).
    sh.fragmentShader = 'uniform sampler2D uRelief;\nuniform sampler2D uLeather;\nuniform sampler2D uTitles;\n' + pars + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Пятнами — под люстрами зала (через 7 м), на галерее приглушённее. Обрезу под полкой достаётся меньше.
        vec3 Lv = normalize((viewMatrix * vec4(normalize(vec3(-vBookWorld.x, 2.4, 0.)), 0.)).xyz);
        float pool = .5 + .5 * pow(.5 + .5 * cos(6.2832 * (vBookWorld.z + 5.15) / 7.), 2.), lvl = vBookWorld.y > -.3 ? .6 : 1.;
        totalEmissiveRadiance += diffuseColor.rgb * .22 * pool * lvl * mix(1., .35, bTop) * (.12 + pow(max(dot(normal, Lv), 0.), 1.6));`)
      .replace('#include <map_fragment>', `
        vec2 bUv = vec2((clamp(vBk.z, ${(1.5 / CW).toFixed(5)}, ${(1 - 1.5 / CW).toFixed(5)}) + vMapUv.x) / ${COLS}.0, vMapUv.y);
        vec4 sp = texture2D(map, bUv), rl = texture2D(uRelief, bUv), lt = texture2D(uLeather, vDet);
        float bSpine = step(vBk.x, .5), bTop = step(1.5, vBk.x), bSeed = fract(vBk.y * 17.31), bSeed2 = fract(vBk.y * 53.7);
        // Название. В рисунке корешка на его месте — условные строчки (их и видно издалека); вблизи вместо них в клетку, отведённую
        // рисунком, ложится настоящее название из своей текстуры: золотом по коже, краской — по бумаге (и там, где так задумано).
        #ifndef BOOK_FAR
          vec2 tIn = step(vec2(0.), vTtl.xy) * step(vTtl.xy, vec2(1.));
          float tCell = floor(vTtl.z + .5), tHere = tIn.x * tIn.y;
          float ttl = texture2D(uTitles, (vec2(mod(tCell, ${TCOLS}.), floor(tCell / ${TCOLS}.)) + clamp(vTtl.xy, .01, .99)) / vec2(${TCOLS}., ${TROWS}.)).r * abs(vTtl.w) * tHere;
          sp.g = mix(sp.g, vTtl.w > 0. ? ttl * (1. - sp.b) : 0., tHere);
          sp.r *= 1. - .75 * (vTtl.w > 0. ? ttl * sp.b : ttl);
        #endif
        float shade = sp.r * 2.008, mott = .7 + .6 * lt.b;
        // Бумага: наклейка на корешке или обрез страниц между крышками.
        float bPaper = mix(sp.b, smoothstep(.06, .1, vBk.z) * smoothstep(.06, .1, 1. - vBk.z), bTop);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Кожа: светотень рисунка, зерно и пятна со скана.
        diffuseColor.rgb *= shade * mott;
        // Старые переплёты выцвели: цвет приглушён.
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.3, .59, .11))), diffuseColor.rgb, .62);
        if (bSpine > .5) {
          // У полки и у верхнего края корешок темнее: туда меньше попадает света.
          float sv = vMapUv.y * ${CH + PLAIN}.0 / ${CH}.0;
          diffuseColor.rgb *= mix(.55, 1., smoothstep(.0, .07, 1. - sv)) * mix(.75, 1., smoothstep(.0, .05, sv));
          // У сгибов кожа вытерта до светлого, в самом сгибе — тёмная складка.
          diffuseColor.rgb *= (1. + .5 * (1. - smoothstep(.0015, .0055, vBk.w)) * lt.b) * mix(.5, 1., smoothstep(.0, .0012, vBk.w));
          // Цветной ярлык — красный сафьян; на красном переплёте — чёрно-зелёный (цвет тома здесь уже не экранный, а световой:
          // у коричневой кожи красного в два с половиной раза больше зелёного, у бордовой — в шесть).
          diffuseColor.rgb = mix(diffuseColor.rgb, (vColor.r > vColor.g * 4. ? vec3(.012, .018, .014) : vec3(.05, .012, .01)) * shade * mott, sp.a);
        }
        // Золото потускнело и стёрлось — у каждого тома по-своему: где почти цело, где осталось пятнами.
        float gold = sp.g * mix(.2, 1., smoothstep(.25, .6, lt.b + (bSeed2 - .5) * .8));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.46, .36, .2), gold * .85);
        // Бумага старая: пожелтела и побурела, у каждого тома своя. Обрез в пыли, под полкой у задней стенки темнее;
        // у части томов он золочёный или крашен красным — и то и другое потускнело.
        vec3 pap = mix(vec3(.17, .125, .075), vec3(.115, .082, .05), bSeed) * (.82 + .36 * lt.b);
        if (bTop > .5) pap = (bSeed2 < .1 ? vec3(.2, .15, .07) : bSeed2 < .2 ? vec3(.125, .058, .044) : pap * .85) * mix(.45, 1., smoothstep(-.5, .5, vBk.w));
        diffuseColor.rgb = mix(diffuseColor.rgb, pap * (.45 + .55 * min(shade, 1.2)), bPaper * .92);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - (rl.b - .5) * .5 - (lt.b - .5) * .12, .3, 1.);
        roughnessFactor = mix(mix(roughnessFactor, .36, gold), .92, bPaper);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, .55, gold);')
      // Рельеф: бинты, тиснение и ярлыки — из рисунка корешка, зерно кожи — со скана (на бумаге его нет).
      .replace('#include <normal_fragment_maps>', `
        vec2 bN = (rl.xy * 2. - 1.) * 2. * bSpine + (lt.xy * 2. - 1.) * 2.5 * (1. - bPaper);
        normal = normalize(normal + vBT * bN.x + vBB * bN.y);`);
  };
  m.customProgramCacheKey = () => 'book-spines-5';
  return m;
}

// T — свои случайные числа для названий: расстановка томов от них не зависит.
const SERIES = TITLES.flatMap(([, multi], i) => multi ? [i] : []);
function layoutCase(bays, R, T) {
  const out = [], any = () => Math.floor(T() * TITLES.length);
  for (const b of bays) {
    const x1 = b.max.x - .006, y0 = b.min.y, front = b.max.z, depth = b.max.z - b.min.z, hmax = Math.min(.47, b.max.y - b.min.y + .05);
    let x = b.min.x + .004 + R() * .01, prev = null, set = 0, setH = 0, setW = 0, setTone = 0, setDesign = 0, setTitle = 0;
    while (x < x1 - .015) {
      const r = R();
      // Изредка пусто — и последний том перед пустотой наклонился.
      if (r < .03 && prev && x1 - x > .1) {
        const w = .02 + R() * .025, h = Math.min(hmax, prev.h * (.85 + R() * .12)), a = .14 + R() * .22, gap = Math.min(prev.h, h) * Math.tan(a) * .96;
        if (x + gap + w + .02 < x1) {
          const px = x + gap, c = Math.cos(a), s = Math.sin(a);
          out.push({ x: px + (w / 2) * c - (h / 2) * s, y: y0 + (w / 2) * s + (h / 2) * c, z: front - depth * (.7 + R() * .2) / 2 - R() * .01, w, h, d: depth * (.7 + R() * .2), rz: a, tone: Math.floor(R() * TONES.length), design: DESIGNS[Math.floor(R() * DESIGNS.length)], title: any() });
          x = px + w * c + .05 + R() * .08; prev = null; set = 0; continue;
        }
      }
      // Стопка лёжа.
      if (r > .975 && x1 - x > hmax * .75) {
        const L = .2 + R() * .08, n = 2 + Math.floor(R() * 3); let y = y0;
        // Лежащий том повёрнут на бок: корешок по-прежнему наружу, рисунок идёт вдоль полки.
        for (let k = 0; k < n; k++) { const t = .025 + R() * .03, dd = depth * (.75 + R() * .2); out.push({ x: x + L / 2 + (R() - .5) * .01, y: y + t / 2, z: front - dd / 2 - R() * .01, w: t, h: L * (.9 + R() * .1), d: dd, rz: Math.PI / 2, tone: Math.floor(R() * TONES.length), design: DESIGNS[Math.floor(R() * DESIGNS.length)], title: any() }); y += t; }
        x += L + .01; prev = null; continue;
      }
      // Серии: несколько одинаковых томов подряд.
      if (set <= 0 && R() < .32) { set = 3 + Math.floor(R() * 7); setH = hmax * (.62 + R() * .33); setW = .028 + R() * .03; setTone = Math.floor(R() * TONES.length); setDesign = DESIGNS[Math.floor(R() * DESIGNS.length)]; setTitle = SERIES[Math.floor(T() * SERIES.length)]; }
      const inSet = set > 0;
      const w = inSet ? setW * (.95 + R() * .1) : .016 + Math.pow(R(), 1.6) * .055, h = inSet ? setH : hmax * (.55 + R() * .42), d = depth * (.68 + R() * .3);
      if (x + w > x1) break;
      // Корешки стоят неровно: какой-то выдвинут, какой-то задвинут глубже; чуть покосились.
      out.push({ x: x + w / 2, y: y0 + h / 2, z: front - d / 2 - (inSet ? R() * .006 : Math.pow(R(), 2) * .03) + (R() < .06 ? .012 : 0), w, h, d, rz: (R() - .5) * .012, tone: inSet ? setTone : Math.floor(R() * TONES.length), design: inSet ? setDesign : DESIGNS[Math.floor(R() * DESIGNS.length)], title: inSet ? setTitle : any(), shade: inSet ? 1 : .82 + R() * .3 });
      prev = { h }; x += w + (R() < .2 ? .002 + R() * .004 : .0005); set--;
    }
  }
  return out;
}

// spots — где стоят шкафы ([x, y, z, поворот]); ближние к столу отбрасывают тени от лампы.
// Ответ — функция: ей дают, где сейчас взгляд, и она ставит шкафам дальше FAR метров тома попроще и материал попроще (ближе — подробные).
const FAR = 5;
export function fillShelves(scene, model, spots, near) {
  model.updateMatrixWorld(true);
  const bays = [];
  model.traverse(o => { if (o.isMesh && o.name.includes('book-stacks')) bays.push(new THREE.Box3().setFromObject(o)); });
  if (!bays.length) return () => {};
  const R = rng(20251110), geo = bookGeometry(), geoFar = bookGeometry(true), T = rng(1917), atlas = spineAtlas(), leather = leatherDetail(), titles = titleAtlas(), meshes = [];
  const mat = liftUpper(bookMaterial(atlas, leather, titles), .45), matFar = liftUpper(bookMaterial(atlas, leather, titles, true), .45);
  // Лампы у обоих материалов — общие, по всем шкафам (lightMasks в room.js): шкаф меняет материал на ходу.
  matFar.userData.lightsAs = mat; mat.userData.lightTwins = [matFar];
  const cases = spots.map(s => ({ s, books: layoutCase(bays, R, T), near: s[1] > -1 && Math.hypot(s[0] - near.x, s[2] - near.z) < 4 }));
  const tones = TONES.map(t => new THREE.Color(t));
  // По несколько шкафов в одной сетке: то, что не в кадре, не рисуется; ближние к столу — отдельно.
  const groups = new Map();
  cases.forEach((c, i) => { const [x, y, , r] = c.s, key = c.near ? 'near' : `${Math.sign(Math.round(x))}|${y}|${r.toFixed(2)}|${Math.floor(i / 4)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); });
  for (const [key, list] of groups) {
    const n = list.reduce((a, c) => a + c.books.length, 0);
    if (!n) continue;
    const g = geo.clone(), gFar = geoFar.clone(), im = new THREE.InstancedMesh(g, mat, n), spine = new Float32Array(n * 2), col = new THREE.Color();
    const M = new THREE.Matrix4(), B = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let i = 0;
    for (const { s: [x, y, z, r], books } of list) {
      M.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1));
      for (const b of books) {
        e.set(0, 0, b.rz);
        B.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e), new THREE.Vector3(b.w, b.h, b.d));
        im.setMatrixAt(i, M.clone().multiply(B));
        col.copy(tones[b.tone]).multiplyScalar((b.shade ?? 1) * (.9 + R() * .2)); im.setColorAt(i, col);
        spine[i * 2] = b.design; spine[i * 2 + 1] = b.title; i++;
      }
    }
    const aSpine = new THREE.InstancedBufferAttribute(spine, 2); g.setAttribute('aSpine', aSpine); gFar.setAttribute('aSpine', aSpine);
    // Все книги ловят солнце из окон и бросают тень; от лампы на столе — только ближние (тень лампы не дотянется дальше).
    im.receiveShadow = im.castShadow = true; im.userData.sunOnly = key !== 'near'; im.computeBoundingSphere(); im.computeBoundingBox();
    scene.add(im); meshes.push({ im, g, gFar });
  }
  // С места за столом все шкафы дальше FAR, и подробный материал не нужен ни одному — а первый подход к полкам заставил бы видеокарту
  // готовить его шейдер на ходу (заминка). Один невидимо малый том с этим материалом стоит в зале с самого начала: его рисует
  // кадр прогрева под заставкой (warmUp в room.js), а в обычных кадрах он почти всегда за краем кадра.
  if (spots.length) {
    const g = geo.clone(), warm = new THREE.InstancedMesh(g, mat, 1), [x, y, z] = spots[0];
    g.setAttribute('aSpine', new THREE.InstancedBufferAttribute(new Float32Array(2), 2));
    warm.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(x, y + .5, z), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4))); warm.setColorAt(0, tones[0]);
    warm.receiveShadow = true; warm.computeBoundingSphere(); scene.add(warm);
  }
  return eye => { for (const { im, g, gFar } of meshes) { const far = im.boundingBox.distanceToPoint(eye) > FAR, want = far ? gFar : g; if (im.geometry !== want) { im.geometry = want; im.material = far ? matFar : mat; } } };
}
