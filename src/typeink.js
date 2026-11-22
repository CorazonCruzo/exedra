// Лист и оттиск букв: всё, что нужно, чтобы напечатать строку листа так, как её печатает машинка. Без DOM и без three.js — тот же код работает
// на главной странице (машинка, листы на столе, ярлыки) и в рабочем потоке `pagework.js` (страницы подшивок печатаются там, мимо кадров зала).
// Холсты берутся по месту: на странице — обычные, в рабочем потоке — OffscreenCanvas.
export const makeCanvas = (w, h) => typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : new OffscreenCanvas(w, h);
// Лист машинки: поля, строка, сколько знаков в строке. Те же числа нужны, чтобы перерисовать лист со стола.
export const PAGE = { W: 1024, H: 1448, LM: 80, TOP: 150, BOTTOM: 80, LINE: 46, COLS: 46 };
// Книжный шрифт — как в берлинском Чехове 1920 года: буквы разной ширины, строки выровнены по обоим краям.
export const BOOK = { family: 'Old Standard TT', px: 34, indent: 1.6 };
export function pageLayout(scale = 1) {
  const char = (PAGE.W - PAGE.LM * 2) / PAGE.COLS, px = Math.round(char / .6 * scale);
  return { lm: PAGE.LM * scale, top: PAGE.TOP * scale, line: PAGE.LINE * scale, char: char * scale, px, cols: PAGE.COLS, lines: Math.floor((PAGE.H - PAGE.TOP - PAGE.BOTTOM) / PAGE.LINE), width: (PAGE.W - PAGE.LM * 2) * scale };
}
// В рабочем потоке холсты считаются процессором (видеокарту не трогаем: зал в это время рисует кадры).
export const CTX = typeof document === 'undefined' ? { willReadFrequently: true } : undefined;
const measureCtx = makeCanvas(1, 1).getContext('2d', CTX);
export const bookWidth = (ch, px) => { measureCtx.font = `400 ${px}px "${BOOK.family}"`; return measureCtx.measureText(ch).width; };
// Места знаков в строке — так же, как их ставит машинка. fmt: b — книжный шрифт, s — строка перенесена (выровнять), i — абзацный отступ.
export function layoutLine(text, fmt = '', scale = 1) {
  const L = pageLayout(scale), [flags, mix] = fmt.split('|'), book = flags.includes('b'), chars = [...text];
  // Шрифт каждого знака: в смешанной строке — свой, иначе один на всю строку.
  const faces = chars.map((_, j) => mix ? (mix[j] === 'b') : book);
  const ws = chars.map((ch, j) => faces[j] ? bookWidth(ch, BOOK.px * scale) : L.char), xs = [];
  let x = flags.includes('i') ? BOOK.px * BOOK.indent * scale : 0;
  for (const w of ws) { xs.push(x); x += w; }
  if (book && flags.includes('s')) justifyXs(chars, xs, ws, L.width);
  return { book, mixed: !!mix, faces, px: L.px, bookPx: BOOK.px * scale, xs, ws, chars };
}
// Выключка по ширине: лишнее место делится между пробелами между словами.
export function justifyXs(chars, xs, ws, width) {
  let n = chars.length; while (n && chars[n - 1] === ' ') n--;
  if (!n) return;
  let gaps = 0; for (let k = 1; k < n; k++) if (chars[k] === ' ' && chars[k - 1] !== ' ') gaps++;
  const extra = width - (xs[n - 1] + ws[n - 1]);
  if (!gaps || extra <= 0 || extra > width * .3) return;
  let shift = 0;
  for (let k = 0; k < n; k++) { if (k && chars[k] === ' ' && chars[k - 1] !== ' ') shift += extra / gaps; xs[k] += shift; }
}
// Напечатать строку листа так же, как её печатала машинка (scale — во сколько раз холст меньше листа машинки).
export function printLine(ctx, text, row, opts) { for (const f of lineInks(ctx, text, row, opts)) f(); }
// То же по знакам: список действий, по одному на знак (оттиск у каждого знака свой по seed, так что порядок и разбивка на кадры результат не меняют).
export function lineInks(ctx, text, row, { scale = .5, font = 'PT Mono', ink = 1, fmt = '', seed = null } = {}) {
  const L = pageLayout(scale);
  // Строка 25 бывает: перенос, если лист вынули посреди смены.
  if (row > L.lines) return [];
  const { book, mixed, faces, px, bookPx, xs, ws, chars } = layoutLine(text, fmt, scale), out = [];
  // Старые чисто машинописные листы режутся по ширине строки; остальное машинка уже уложила в поля.
  chars.forEach((ch, j) => { if (ch !== ' ' && (book || mixed || j < L.cols)) out.push(() => typeInk(ctx, ch, L.lm + xs[j] + ws[j] / 2, L.top + row * L.line, { font: faces[j] ? BOOK.family : font, px: faces[j] ? bookPx : px, ink, ...(seed !== null && { rand: mulberry(seed * 7919 + row * 131 + j) }) })); });
  return out;
}
export const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// Оттиск как с настоящей ленты:
// — густота у каждой буквы своя, литера бьёт неровно — один край бледнее;
// — в буквах видна ткань ленты, края рваные;
// — краска чуть расходится по волокнам;
// — точки и запятые пробивают сильнее, а «е», «о», «а» иногда забиты — петельки залиты, как у старых машинок.
// ink — сколько краски осталось в ленте.
let weave = null; const glyphs = {};
export function typeInk(ctx, ch, x, y, { font = 'PT Mono', px = 24, ink = .95, rand = Math.random } = {}) {
  if (!weave) {
    weave = makeCanvas(96, 96); const w = weave.getContext('2d', CTX), d = w.createImageData(96, 96);
    for (let yy = 0; yy < 96; yy++) for (let xx = 0; xx < 96; xx++) {
      const v = .74 + .2 * Math.sin((xx + yy) * 1.15) * Math.sin((xx - yy) * 1.15) + (Math.random() - .4) * .34, i = (yy * 96 + xx) * 4;
      d.data[i + 3] = Math.max(0, Math.min(255, v * 255));
    }
    w.putImageData(d, 0, 0);
  }
  const G = Math.ceil(px * 1.8); let gc = glyphs[G]; if (!gc) { gc = glyphs[G] = makeCanvas(G, G); }
  const gg = gc.getContext('2d', CTX), heavy = '.,;:!?'.includes(ch), clogged = 'еоаэбдрсeoacdbpg0689'.includes(ch.toLowerCase()) && rand() < .16;
  gg.setTransform(1, 0, 0, 1, 0, 0); gg.globalCompositeOperation = 'source-over'; gg.clearRect(0, 0, G, G);
  gg.font = `400 ${px}px "${font}"`; gg.textAlign = 'center'; gg.textBaseline = 'alphabetic';
  gg.fillStyle = gg.strokeStyle = '#17161f'; gg.fillText(ch, G / 2, G * .68);
  if (heavy || clogged) { gg.lineWidth = px * (clogged ? .06 : .05); gg.lineJoin = 'round'; gg.strokeText(ch, G / 2, G * .68); }
  gg.globalCompositeOperation = 'destination-in';
  // Неровный удар: по случайной стороне литера бледнеет почти до бумаги.
  const a = rand() * Math.PI * 2, gr = gg.createLinearGradient(G / 2 - Math.cos(a) * px * .5, G / 2 - Math.sin(a) * px * .5, G / 2 + Math.cos(a) * px * .5, G / 2 + Math.sin(a) * px * .5);
  gr.addColorStop(0, `rgba(0,0,0,${heavy ? .9 : .42 + rand() * .38})`); gr.addColorStop(1, 'rgba(0,0,0,1)');
  gg.fillStyle = gr; gg.fillRect(0, 0, G, G);
  // Ткань ленты: клетка размером с волокно, не меньше пикселя.
  const k = px / 31;
  gg.save(); gg.scale(k, k); gg.fillStyle = gg.createPattern(weave, 'repeat'); gg.translate(rand() * 96, rand() * 96); gg.fillRect(-96, -96, G / k + 192, G / k + 192); gg.restore();
  // Своя густота у каждой буквы.
  const dens = heavy || clogged ? 1 : .8 + rand() * .2;
  ctx.save(); ctx.translate(x, y + (rand() - .5) * px * .05); ctx.rotate((rand() - .5) * .04);
  ctx.shadowColor = `rgba(23,22,31,${(.45 * ink).toFixed(2)})`; ctx.shadowBlur = Math.max(1, px / 14);
  ctx.globalAlpha = ink * dens; ctx.drawImage(gc, -G / 2, -G * .68);
  ctx.shadowBlur = 0;
  // Иногда литера чуть отскакивает и даёт бледный второй оттиск.
  if (rand() < .12) { ctx.globalAlpha = .22 * ink; ctx.drawImage(gc, -G / 2 + px * .025, -G * .68 + px * .02); }
  ctx.restore();
}

// Бумага листа: снимок (paper), на нём — приметы (stamps) по числу листа (seed); без seed — чистая бумага. Холсты и снимки берутся как есть, поэтому то же и в рабочем потоке.
export function paintPaperWith(g, W, H, seed, paper, stamps, stampScale) {
  if (!paper) { g.fillStyle = '#e8dcbc'; g.fillRect(0, 0, W, H); return; }
  g.drawImage(paper, 0, 0, W, H);
  if (seed === null) return;
  let a = (seed ^ 0x9e3779b9) | 0; const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for (const { stamp, R, chance } of stamps) {
    const on = rnd() < chance, x = (.1 + rnd() * .8) * W, y = (.08 + rnd() * .84) * H, turn = rnd() * Math.PI * 2, flip = rnd() < .5 ? -1 : 1, size = (.8 + rnd() * .35) * W * stampScale;
    if (!on) continue;
    g.save(); g.globalCompositeOperation = 'multiply'; g.translate(x, y); g.rotate(turn); g.scale(size * flip, size); g.drawImage(stamp, -R, -R); g.restore();
  }
}
