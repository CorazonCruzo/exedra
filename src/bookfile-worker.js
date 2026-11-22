// «Движок» PDF книги: копирует файл в хранилище браузера (OPFS) и рисует страницы в картинки.
// Работает в отдельном Worker, чтобы главный поток зала не отвлекался от 60 кадров в секунду.
// Запасной путь: тот же код можно запустить прямо в главном потоке (bookfile.js делает это при ?main=1 или если в Worker нет OffscreenCanvas).
const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;
const IN_WORKER = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
let HWA = false; // проба: холсты pdf.js на видеокарте (willReadFrequently: false)
const CHUNK = 8 << 20;      // копируем по 8 МБ: файл никогда не лежит в памяти целиком
const RANGE = 1 << 20;      // pdf.js просит у нас куски по 1 МБ: с диска это дёшево, а обращений меньше

const fail = (name, message, code, vars) => Object.assign(new Error(message), { name, code, vars }); // code/vars — ключ словаря и подстановки: текст для человека собирает главный поток (bookfile.js)
export const dirOf = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('books', { create: true });

// Понятные ошибки по-русски вместо «QuotaExceededError».
function explain(e, bytes) {
  if (e.name === 'QuotaExceededError') return fail('QuotaExceededError', 'Not enough browser storage for this book', bytes ? 'book.err.quotaSize' : 'book.err.quota', { mb: bytes ? (bytes / 1048576).toFixed(0) : '' });
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return fail('NotAllowedError', 'Storage not allowed for this site', 'book.err.denied');
  return e;
}

// ---------- сохранение ----------
// Файл копируется кусками прямо в OPFS. Пока копия идёт, рядом лежит пометка «.part»: если вкладку закрыли посреди копирования, по пометке видно, что файл неполный.
async function save({ file, id }, { progress }) {
  if (!navigator.storage?.getDirectory) throw fail('Unsupported', 'No OPFS in this browser', 'book.err.noOpfs');
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) throw fail('NotPdf', 'Not a PDF file', 'book.err.notPdfFile');
  const est = await navigator.storage.estimate?.().catch(() => null);
  if (est?.quota && est.quota - est.usage < file.size * 1.02) throw explain({ name: 'QuotaExceededError' }, file.size);
  const dir = await dirOf();
  await dir.getFileHandle(id + '.part', { create: true });
  const fh = await dir.getFileHandle(id + '.pdf', { create: true });
  let h;
  try {
    h = await fh.createSyncAccessHandle();
    h.truncate(0);
    for (let off = 0; off < file.size; off += CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
      let done = 0; while (done < buf.length) done += h.write(buf.subarray(done), { at: off + done });
      progress?.(Math.min(file.size, off + buf.length), file.size);
    }
    h.flush(); h.close(); h = null;
    await dir.removeEntry(id + '.part');
  } catch (e) {
    try { h?.close(); } catch {}
    await dir.removeEntry(id + '.pdf').catch(() => {}); await dir.removeEntry(id + '.part').catch(() => {});
    throw explain(e, file.size);
  }
}

async function remove({ id }) {
  const dir = await dirOf();
  for (const n of [id + '.pdf', id + '.part']) await dir.removeEntry(n).catch(e => { if (e.name !== 'NotFoundError') throw e; });
}

async function list() {
  const dir = await dirOf(), res = new Map();
  for await (const [name, fh] of dir.entries()) {
    const m = /^(.+)\.(pdf|part)$/.exec(name); if (!m) continue;
    const r = res.get(m[1]) || { id: m[1], bytes: 0, partial: false };
    if (m[2] === 'pdf') r.bytes = (await fh.getFile()).size; else r.partial = true;
    res.set(m[1], r);
  }
  return [...res.values()];
}

// ---------- чтение и рисование ----------
// Холсты pdf.js делает сам. В Worker «document» нет, поэтому отдаём ему свою фабрику на OffscreenCanvas.
class Canvases {
  create(w, h) { const canvas = IN_WORKER || typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); return { canvas, context: canvas.getContext('2d', { willReadFrequently: !HWA }) }; }
  reset({ canvas }, w, h) { canvas.width = w; canvas.height = h; }
  destroy(c) { c.canvas.width = c.canvas.height = 0; c.canvas = c.context = null; }
  getNoAlphaContext(canvas) { return canvas.getContext('2d', { alpha: false, willReadFrequently: !HWA }); }
}
// SVG-фильтры нужны только для режима высокой контрастности — нам не нужны.
class NoFilters {
  addFilter() { return 'none'; } addHCMFilter() { return 'none'; } addAlphaFilter() { return 'none'; } addLuminosityFilter() { return 'none'; }
  addKnockoutFilter() { return 'none'; } addHighlightHCMFilter() { return 'none'; } addSelectionHCMFilter() { return 'none'; } addSelectionFilter() { return 'none'; }
  createSelectionStyle() { return null; } destroy() {}
}

let pdfjs;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(PDFJS + 'build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.mjs';
  return pdfjs;
}

const books = new Map(); // id → { doc, file, sizes, outline } (у MuPDF — { mu, ... })
// Движок по умолчанию — MuPDF (пользователь 2026-11-21, сравнив страницы «Обломова»: «я прям вижу, насколько эта библиотека лучше! поменяй на нее»). Файл читается кусками прямо
// с диска: MuPDF просит байты синхронно, а у хранилища в рабочем потоке есть синхронный доступ (`createSyncAccessHandle`) — в память книга целиком не попадает (170 МБ «Обломова»).
// Где такого доступа нет (главный поток — запасной путь) или ?engine=pdfjs — как раньше, pdf.js. Рисует MuPDF без промежуточного холста: картинка RGB → ImageBitmap.
let mupdf = null;
const MU_OK = IN_WORKER && typeof FileSystemFileHandle !== 'undefined' && 'createSyncAccessHandle' in FileSystemFileHandle.prototype;
async function openMu(id) {
  mupdf ??= await import(new URL('../vendor/mupdf/mupdf.js', import.meta.url).href);
  let fh, sync;
  try { fh = await (await dirOf()).getFileHandle(id + '.pdf'); sync = await fh.createSyncAccessHandle(); }
  catch (e) { if (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError') throw e; throw e.name === 'NotFoundError' ? fail('NotFound', 'Book file not found in browser storage', 'book.err.notFound') : explain(e); }
  const size = sync.getSize();
  const stm = new mupdf.Stream({ fileSize: () => size, read: (mem, off, len, pos) => sync.read(mem.subarray(off, off + len), { at: pos }), close: () => sync.close() });
  let mu;
  try { mu = mupdf.Document.openDocument(stm, 'application/pdf'); }
  catch (e) { sync.close(); throw fail('NotPdf', 'Damaged file or not a PDF', 'book.err.notPdf'); }
  if (mu.needsPassword()) { mu.destroy(); throw fail('Password', 'Password-protected PDF', 'book.err.password'); }
  const muSize = n => { const p = mu.loadPage(n - 1), [x0, y0, x1, y1] = p.getBounds(); p.destroy(); return { w: x1 - x0, h: y1 - y0 }; };
  const { w, h } = muSize(1), meta = k => { try { const v = String(mu.getMetaData(k) ?? '').trim(); return v.length > 200 ? v.slice(0, 200) : v; } catch { return ''; } };
  books.set(id, { mu, muSize, sizes: new Map([[1, { w, h }]]), outline: null });
  return { id, bytes: size, pages: mu.countPages(), w, h, title: meta('info:Title'), author: meta('info:Author') };
}
async function renderMu(b, n, height) {
  const t0 = performance.now(), p = b.mu.loadPage(n - 1), [, y0, , y1] = p.getBounds(), s = Math.min(height, 8192) / (y1 - y0);
  let pix;
  try { pix = p.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true); } finally { p.destroy(); }
  const w = pix.getWidth(), h = pix.getHeight(), src = pix.getPixels(), rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0, k = 0; i < w * h; i++, j += 3, k += 4) { rgba[k] = src[j]; rgba[k + 1] = src[j + 1]; rgba[k + 2] = src[j + 2]; rgba[k + 3] = 255; }
  pix.destroy();
  const bmp = await createImageBitmap(new ImageData(rgba, w, h)), t1 = performance.now(), tone = paperTone(bmp);
  return { bmp, ms: performance.now() - t0, tone, toneMs: performance.now() - t1 };
}
function outlineMu(b) {
  const res = [], walk = (items, level) => { for (const it of items ?? []) { if (res.length >= 2000) return; if (it.title && Number.isInteger(it.page)) res.push({ title: it.title.trim(), page: it.page + 1, level }); walk(it.down, level + 1); } };
  try { walk(b.mu.loadOutline(), 0); } catch {}
  return res;
}
const tasks = new Map(); // номер запроса → задача рисования pdf.js (чтобы можно было отменить)

let ENGINE = '';
async function open({ id, hwa = false, systemFonts, engine = '' }) {
  HWA = hwa; ENGINE = engine;
  // Файл уже держит другая вкладка (синхронный доступ — исключительный) — эта открывает книгу через pdf.js.
  if (engine !== 'pdfjs' && engine !== 'pdfjs0' && MU_OK) { try { return await openMu(id); } catch (e) { if (e.name !== 'NoModificationAllowedError' && e.name !== 'InvalidStateError') throw e; } }
  const P = await lib();
  const dir = await dirOf();
  let file;
  try { file = await (await dir.getFileHandle(id + '.pdf')).getFile(); }
  catch (e) { throw e.name === 'NotFoundError' ? fail('NotFound', 'Book file not found in browser storage', 'book.err.notFound') : explain(e); }
  // pdf.js просит нужные куски файла, мы читаем их с диска (File.slice) — всё остальное в память не попадает.
  const transport = new class extends P.PDFDataRangeTransport {
    requestDataRange(b, e) { file.slice(b, e).arrayBuffer().then(buf => this.onDataRange(b, new Uint8Array(buf)), () => {}); }
  }(file.size, new Uint8Array(await file.slice(0, Math.min(file.size, RANGE)).arrayBuffer()));
  const task = P.getDocument({
    range: transport, disableAutoFetch: true, disableStream: true, rangeChunkSize: RANGE,
    cMapUrl: PDFJS + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS + 'standard_fonts/', wasmUrl: PDFJS + 'wasm/', iccUrl: PDFJS + 'iccs/',
    useWorkerFetch: true, isOffscreenCanvasSupported: true,
    // В Worker у страницы нет document, а pdf.js добавляет шрифты книги в document.fonts: даём подставной документ с self.fonts.
    ownerDocument: IN_WORKER ? { fonts: self.fonts } : undefined,
    useSystemFonts: systemFonts, CanvasFactory: Canvases, FilterFactory: NoFilters, disableWorkerRendering: true,
  });
  let doc;
  try { doc = await task.promise; }
  catch (e) {
    task.destroy?.();
    if (e.name === 'InvalidPDFException') throw fail('NotPdf', 'Damaged file or not a PDF', 'book.err.notPdf');
    if (e.name === 'PasswordException') throw fail('Password', 'Password-protected PDF', 'book.err.password');
    throw e;
  }
  const { w, h } = await size(doc, 1);
  let meta = {}; try { meta = await doc.getMetadata(); } catch {}
  const pick = (a, b) => { const s = String(a || b || '').trim(); return s.length > 200 ? s.slice(0, 200) : s; };
  const m = meta.metadata;
  books.set(id, { doc, file, sizes: new Map([[1, { w, h }]]), outline: null });
  return { id, bytes: file.size, pages: doc.numPages, w, h, title: pick(meta.info?.Title, m?.get?.('dc:title')), author: pick(meta.info?.Author, m?.get?.('dc:creator')) };
}

const book = id => books.get(id) || (() => { throw fail('Closed', 'Book closed', 'book.err.closed'); })();

async function size(doc, n) {
  const page = await doc.getPage(n), v = page.getViewport({ scale: 1 }); // с учётом поворота страницы
  page.cleanup();
  return { w: v.width, h: v.height };
}
async function pageSize({ id, n }) {
  const b = book(id); let s = b.sizes.get(n);
  if (!s) b.sizes.set(n, s = b.mu ? b.muSize(n) : await size(b.doc, n));
  return s;
}

// Тон «бумаги» страницы: картинка страницы (ImageBitmap — она уже в памяти видеокарты) уменьшается до 32×32, берётся среднее (sRGB, 0…1) по точкам не темнее медианной яркости —
// текст и картинки в него почти не попадают. Читать пиксели с самого холста страницы нельзя: это 10–25 мс на страницу, а с маленького — доли миллисекунды.
let toneCanvas = null;
function paperTone(bmp) {
  try {
    toneCanvas ??= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(32, 32) : Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
    const g = toneCanvas.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low'; g.drawImage(bmp, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data, n = 1024, lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = .2126 * d[i * 4] + .7152 * d[i * 4 + 1] + .0722 * d[i * 4 + 2];
    const med = Float32Array.from(lum).sort()[n >> 1]; let r = 0, gr = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) if (lum[i] >= med) { r += d[i * 4]; gr += d[i * 4 + 1]; b += d[i * 4 + 2]; c++; }
    return [r / c / 255, gr / c / 255, b / c / 255];
  } catch { return [1, 1, 1]; }
}
// Уменьшить картинку с усреднением: createImageBitmap с resizeQuality 'high', где его нет — холст со сглаживанием высокого качества.
async function shrink(bmp, w, h) {
  try { const r = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); bmp.close(); return r; }
  catch {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h); bmp.close();
    return c.transferToImageBitmap ? c.transferToImageBitmap() : await createImageBitmap(c);
  }
}
// Одна страница → ImageBitmap (верх страницы — верх картинки), фон белый. ss = 2 — рисуется вдвое крупнее и уменьшается с усреднением: pdf.js, уменьшая большой скан прямо до
// нужного размера, берёт точки через одну — тонкие штрихи бледнеют и рвутся (пользователь 2026-11-21, «Обломов»: в Preview буквы жирные, при чтении — «стёртые»). Просит так только
// разворот при чтении (book.js, `sharp`): удвоенно рисовать весь запас страниц съело память браузера. Большой холст освобождается сразу.
async function render({ id, n, height, ss = 1, job }) {
  if (book(id).mu) return renderMu(book(id), n, height);
  if (ENGINE === 'pdfjs0') ss = 1;
  const { doc } = book(id), t0 = performance.now();
  const page = await doc.getPage(n);
  try {
    const out = Math.min(height, 8192), SS = out * ss <= 4096 ? ss : 1, v1 = page.getViewport({ scale: 1 }), scale = out * SS / v1.height, vp = page.getViewport({ scale });
    const w = Math.max(1, Math.round(vp.width)), h = Math.max(1, Math.round(vp.height));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const task = page.render({ canvas, viewport: vp, background: '#fff' });
    tasks.set(job, task);
    try { await task.promise; } finally { tasks.delete(job); }
    // Цвет фона страницы (для зала: белое — «печать на нашей бумаге», уже не белое — скан старой книги, показывается как есть). Оценка по картинке 32×32 — доли миллисекунды.
    let bmp = canvas.transferToImageBitmap ? canvas.transferToImageBitmap() : await createImageBitmap(canvas);
    if (SS > 1) { canvas.width = canvas.height = 1; bmp = await shrink(bmp, Math.max(1, Math.round(w / SS)), Math.max(1, Math.round(h / SS))); }
    const t1 = performance.now(), tone = paperTone(bmp), toneMs = performance.now() - t1;
    return { bmp, ms: performance.now() - t0, tone, toneMs };
  } catch (e) {
    if (e.name === 'RenderingCancelledException') throw fail('AbortError', 'Cancelled', 'book.err.aborted');
    throw e;
  } finally { page.cleanup(); } // иначе память растёт при долгом листании
}

// Оглавление: [{ title, page, level }]. Пункты, чью страницу не нашли, пропускаем.
async function outline({ id }) {
  const b = book(id); if (b.outline) return b.outline;
  if (b.mu) return b.outline = outlineMu(b);
  const res = [], tree = await b.doc.getOutline().catch(() => null);
  const walk = async (items, level) => {
    for (const it of items) {
      if (res.length >= 2000) return;
      try {
        let dest = it.dest; if (typeof dest === 'string') dest = await b.doc.getDestination(dest);
        if (Array.isArray(dest)) {
          const r = dest[0], page = typeof r === 'number' ? r + 1 : (await b.doc.getPageIndex(r)) + 1;
          if (it.title) res.push({ title: it.title.trim(), page, level });
        }
      } catch {}
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  if (tree) await walk(tree, 0);
  return b.outline = res;
}

async function close({ id }) { const b = books.get(id); books.delete(id); if (b?.mu) b.mu.destroy(); else await b?.doc.destroy(); }

const ops = { save, remove, list, open, pageSize, render, outline, close };

// Единая точка входа: и Worker, и главный поток (запасной путь) вызывают run(op, args, { progress }).
export function run(op, args, extra = {}) { return ops[op](args, extra); }
export function cancel(job) { tasks.get(job)?.cancel(); }

if (IN_WORKER) {
  self.onmessage = async ({ data: { id, op, args } }) => {
    if (op === 'cancel') return cancel(args.job);
    try {
      const r = await run(op, args, { progress: (a, b) => self.postMessage({ id, progress: [a, b] }) });
      if (r?.bmp) self.postMessage({ id, ok: r }, [r.bmp]); else self.postMessage({ id, ok: r ?? null });
    } catch (e) { self.postMessage({ id, err: { name: e.name, message: e.message, code: e.code, vars: e.vars } }); }
  };
}
