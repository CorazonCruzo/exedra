// Рабочий поток для страниц подшивок: печатает лист целиком (бумага, приметы, ~1000 знаков с оттиском ленты) процессором, мимо кадров зала.
// На главном потоке такой лист стоил 0,3–0,5 с растеризации — экран вставал; здесь он занимает те же 0,3 с, но никому не мешает.
// Протокол: { op: 'init', paper, stamps, stampScale } → { op: 'ready', ok }; { op: 'page', id, lines, fmt, seed } → { id, front, back } (ImageBitmap: лицо 1024 и оборот 512 точек в ширину)
// или { id, err }. Лицо — тот же лист, что `drawPage`; оборот — бледный зеркальный отпечаток того же оттиска на чистой бумаге, как `drawBack`.
import { lineInks, paintPaperWith, CTX } from './typeink.js';

// Шрифты страницы здесь недоступны (у потока свой набор): те же гарнитуры из того же файла, что и в index.html (обычное начертание).
const FONTS = new URL('../assets/fonts/fonts.css', import.meta.url), FAMILIES = ['Old Standard TT', 'PT Mono'];
let env = { paper: null, stamps: [], stampScale: 1 }, ready = null;
async function loadFonts() {
  const css = await (await fetch(FONTS)).text();
  for (const [, face] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const family = face.match(/font-family:\s*['"]?([^;'"]+)/)?.[1], src = face.match(/url\(([^)]+)\)/)?.[1], range = face.match(/unicode-range:\s*([^;]+)/)?.[1];
    if (FAMILIES.includes(family) && src && !/font-style:\s*italic/.test(face)) self.fonts.add(new FontFace(family, `url(${new URL(src, FONTS)})`, { style: 'normal', weight: '400', ...(range ? { unicodeRange: range } : {}) }));
  }
}
const W = 1024, H = 1448, WB = 512, HB = 724;
async function page({ lines, fmt, seed }) {
  const text = lines.join(''), faces = [self.fonts.load('400 24px "PT Mono"', text)];
  if (fmt?.some(f => f)) faces.push(self.fonts.load('400 34px "Old Standard TT"', text));
  await Promise.all(faces);
  // Печать — на прозрачный холст: лицо — бумага и этот оттиск поверх, оборот — тот же оттиск зеркально и бледно (так одной печати хватает на обе стороны).
  const ink = new OffscreenCanvas(W, H), ig = ink.getContext('2d', CTX);
  lines.forEach((l, i) => { for (const f of lineInks(ig, l, i, { scale: 1, fmt: fmt?.[i], seed })) f(); });
  const front = new OffscreenCanvas(W, H), g = front.getContext('2d', CTX);
  paintPaperWith(g, W, H, seed, env.paper, env.stamps, env.stampScale); g.drawImage(ink, 0, 0);
  const back = new OffscreenCanvas(WB, HB), bg = back.getContext('2d', CTX);
  paintPaperWith(bg, WB, HB, null, env.paper, env.stamps, env.stampScale);
  bg.save(); bg.globalAlpha = .1; bg.translate(WB, 0); bg.scale(-1, 1); bg.drawImage(ink, 0, 0, WB, HB); bg.restore();
  return { front: front.transferToImageBitmap ? front.transferToImageBitmap() : await createImageBitmap(front), back: back.transferToImageBitmap ? back.transferToImageBitmap() : await createImageBitmap(back) };
}
self.onmessage = async ({ data }) => {
  if (data.op === 'init') {
    env = { paper: data.paper, stamps: data.stamps, stampScale: data.stampScale };
    ready = loadFonts().then(() => true, e => { console.warn('pagework fonts', e); return false; });
    self.postMessage({ op: 'ready', ok: await ready });
  } else if (data.op === 'page') {
    try { const r = await page(data); self.postMessage({ id: data.id, ...r }, [r.front, r.back]); }
    catch (e) { self.postMessage({ id: data.id, err: String(e?.message || e) }); }
  }
};
