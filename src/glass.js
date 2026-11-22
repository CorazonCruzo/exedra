// Простое остекление окон: старое бледное стекло в свинце вместо картин-витражей. Окно собирается из снимка настоящего остекления:
// кусок снимка (crop — доли кадра) кладётся в настоящем размере (span — сколько метров он занимает в жизни) и повторяется зеркально —
// швов между повторами нет; сам снимок не ретушируется. Поверх у бокового окна — железный прут на пяте арки и свинцовая кайма по контуру;
// у веерного прутья настоящие, золочёные (ceiling.js).
import * as THREE from 'three';

const DARK = '#14100c';
const sheet = (W, H) => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); return [c, c.getContext('2d')]; };
const done = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return dress(t, c); };
// Стеклу — его тон и рельеф (src — снимок или холст, из которого сделана текстура t): ими пользуется потолок (setGlass).
// tone — средний цвет стекла: им окрашен свет, прошедший сквозь окно. relief — карта нормалей из самого снимка: светлое выше, свинец ниже;
// по ней свет ламп ложится на стекло мелкими бликами — на каждом кружке и вдоль свинца, — а не ровной плёнкой: стекло читается стеклом.
function dress(t, src) {
  const [s, q] = sheet(16, 16); q.drawImage(src, 0, 0, 16, 16);
  const px = q.getImageData(0, 0, 16, 16).data, sum = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k] / (64 * 255);
  t.userData.tone = new THREE.Color().setRGB(sum[0], sum[1], sum[2], THREE.SRGBColorSpace);
  const k = Math.min(1, 2048 / src.width), W = Math.round(src.width * k), H = Math.round(src.height * k), [c, g] = sheet(W, H);
  g.filter = 'blur(1px)'; g.drawImage(src, 0, 0, W, H);
  const im = g.getImageData(0, 0, W, H), d = im.data, h = new Float32Array(W * H); let mean = 0;
  for (let i = 0; i < W * H; i++) mean += h[i] = d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11;
  const st = RELIEF / Math.max(1, mean / (W * H)), at = (x, y) => h[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * st, dy = (at(x, y + 1) - at(x, y - 1)) * st, l = 1 / Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    d[i] = (-dx * l * .5 + .5) * 255; d[i + 1] = (dy * l * .5 + .5) * 255; d[i + 2] = (l * .5 + .5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const n = new THREE.CanvasTexture(c); n.anisotropy = 8; n.flipY = t.flipY; t.userData.relief = n;
  return t;
}
// Крутизна рельефа: во сколько раз перепад яркости (в долях средней яркости снимка) больше шага точки.
const RELIEF = .55;
// Поле стекла: зеркальные повторы куска снимка; ось зеркала — по середине холста, чтобы окно было симметричным.
function field(g, img, [cx, cy, cw, ch], span, ppm, W, H) {
  const sx = cx * img.width, sy = cy * img.height, sw = cw * img.width, sh = ch * img.height, tw = span * ppm, th = tw * sh / sw;
  const i0 = -Math.ceil(W / 2 / tw), j0 = -Math.ceil(H / th);
  g.imageSmoothingQuality = 'high';
  for (let j = j0; j < 0; j++) for (let i = i0; i < -i0; i++) {
    const x = W / 2 + i * tw, y = H + j * th, fx = i & 1, fy = j & 1;
    g.save(); g.translate(x + (fx ? tw : 0), y + (fy ? th : 0)); g.scale(fx ? -1 : 1, fy ? -1 : 1); g.drawImage(img, sx, sy, sw, sh, -.5, -.5, tw + 1, th + 1); g.restore();
  }
}
// Спокойнее: рисунок стекла (кружки и свинец снимка) наполовину сведён к его среднему тону — окно не спорит с залом за внимание.
const calmed = (g, k, W, H) => {
  if (!k) return;
  const [s, q] = sheet(8, 8); q.drawImage(g.canvas, 0, 0, 8, 8);
  const px = q.getImageData(0, 0, 8, 8).data, sum = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c] / 64;
  g.globalAlpha = k; g.fillStyle = `rgb(${sum.map(Math.round).join(',')})`; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
};
const tinted = (g, tint, W, H) => { if (!tint) return; g.globalCompositeOperation = 'multiply'; g.fillStyle = tint; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; };

// Боковое окно пояса: ширина 2·hw, высота rh + hw (прямая часть и полукруг).
export function leadedSide(img, { hw, rh, crop, span, tint, calm = 0, ppm = 640 }) {
  const W = Math.round(2 * hw * ppm), H = Math.round((rh + hw) * ppm), [c, g] = sheet(W, H), ya = hw * ppm;
  field(g, img, crop, span, ppm, W, H); tinted(g, tint, W, H); calmed(g, calm, W, H);
  // Прут на пяте арки и свинцовая кайма по контуру проёма.
  g.strokeStyle = DARK; g.lineWidth = .016 * ppm; g.beginPath(); g.moveTo(0, ya); g.lineTo(W, ya); g.stroke();
  const b = .03 * ppm; g.lineWidth = b; g.beginPath(); g.moveTo(b / 2, H); g.lineTo(b / 2, ya); g.arc(W / 2, ya, hw * ppm - b / 2, Math.PI, 0); g.lineTo(W - b / 2, H); g.lineTo(b / 2, H); g.stroke();
  return done(c);
}
// Стекло веерной фрамуги двери, набранное из отдельных стёклышек старого литого стекла: полукруг в середине низа и два пояса
// долей вокруг него (во внешнем долей вдвое больше — как у большого веерного окна). Каждое стёклышко своего оттенка (бутылочная
// зелень, изредка оливковое или посветлее), наклонено чуть по-своему — свет ламп вспыхивает то на одном, то на другом, —
// и у переплёта сходит фацетом. За стеклом — свет вестибюля: ярче всего в середине низа, к краю веера слабее.
// w × h метров — всё поле; a, b — полуоси веера (его середина — середина нижнего края поля); rays — долей во внутреннем поясе;
// hub, mid — где дуги переплёта, в долях полуоси. Ответ — три карты: цвет, свечение и рельеф.
export function fanPanes({ w, h, a, b, rays, hub, mid, ppm = 640 }) {
  const W = Math.round(w * ppm), H = Math.round(h * ppm), bev = .009;
  const sheets = [sheet(W, H), sheet(W, H), sheet(W, H)], [col, glow, nor] = sheets.map(([, g]) => g.createImageData(W, H));
  const rnd = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p += 4) {
    // Метры от середины низа (v — вверх); rho и th — место в веере: доля полуоси и угол.
    const u = (x + .5) / ppm - w / 2, v = h - (y + .5) / ppm, rho = Math.hypot(u / a, v / b), th = Math.atan2(v / b, u / a), R = Math.hypot(u, v) || 1e-6, ex = u / R, ey = v / R;
    const ring = rho < hub ? 0 : rho < mid ? 1 : 2, n = ring === 2 ? rays * 2 : ring === 1 ? rays : 1, sec = Math.min(n - 1, Math.floor(th / Math.PI * n)), f = th / Math.PI * n - sec;
    const kind = rnd(ring, sec, 2), k = .82 + .36 * rnd(ring, sec, 1), [r0, g0, b0] = ring === 0 ? [104, 100, 58] : kind < .22 ? [78, 80, 48] : kind < .42 ? [62, 86, 62] : [44, 70, 52];
    const lit = Math.max(0, 1 - rho * .72) ** 1.3 * (.75 + .5 * rnd(ring, sec, 3));
    let nx = (rnd(ring, sec, 4) - .5) * .16, ny = (rnd(ring, sec, 5) - .5) * .16;
    // Фацет: у лучей — поперёк луча, у дуг — вдоль радиуса.
    if (n > 1 && Math.min(f, 1 - f) * Math.PI / n * R < bev) { const sg = f < .5 ? 1 : -1; nx += sg * ey * .55; ny -= sg * ex * .55; }
    for (const edge of [hub, mid, 1]) { const d = (rho - edge) * R / Math.max(rho, 1e-6); if (Math.abs(d) < bev) { const sg = d > 0 ? -1 : 1; nx += sg * ex * .55; ny += sg * ey * .55; } }
    const l = 1 / Math.hypot(nx, ny, 1);
    col.data.set([r0 * k, g0 * k, b0 * k, 255], p); glow.data.set([r0 * k * .5 + lit * 104, g0 * k * .5 + lit * 98, b0 * k * .5 + lit * 50, 255], p); nor.data.set([(nx * l * .5 + .5) * 255, (ny * l * .5 + .5) * 255, (l * .5 + .5) * 255, 255], p);
  }
  const [map, emissiveMap, normalMap] = sheets.map(([c, g], n) => { g.putImageData([col, glow, nor][n], 0, 0); const t = new THREE.CanvasTexture(c); if (n < 2) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  return { map, emissiveMap, normalMap };
}
// Веерное окно в торце: полуовал шириной width метров, высота — width · aspect. Прутьев в стекле нет: их ставят отдельно, настоящими
// (золочёные — ceiling.js, раскладка FAN_BARS: лучи из середины низа, две дуги, у ступицы — полукруг).
export const FAN_BARS = { rays: 14, hub: .16, mid: .58, rim: .995, w: { ray: .05, half: .03, hub: .06, mid: .05, rim: .1 } };
export function leadedFan(img, { aspect, width, crop, span, tint, calm = 0, W = 4096 }) {
  const H = Math.round(W * aspect), [c, g] = sheet(W, H), ppm = W / width;
  field(g, img, crop, span, ppm, W, H); tinted(g, tint, W, H); calmed(g, calm, W, H);
  return done(c);
}
