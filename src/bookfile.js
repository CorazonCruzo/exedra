// Файл книги (PDF) для зала: хранится в браузере, страницы рисуются в картинки вне главного потока.
//   saveBook(file, onProgress) → info   — копирует файл в хранилище (OPFS) кусками, onProgress(0..1, байт, всего)
//   openBook(id, { main }) → BookFile   — main: true рисует в главном потоке (запасной путь)
//   removeBook(id), listBooks() → [{ id, bytes, partial }]  — partial: копирование не закончилось
// BookFile: info, pageSize(n), render(n, height, { priority, signal }) → ImageBitmap, outline(), close(); tones — Map: страница → [r, g, b] цвета её фона (sRGB 0…1).
// Номера страниц с 1, размеры страниц — в пунктах PDF. Всю тяжёлую работу делает bookfile-worker.js.
import { t } from './i18n.js';
const WORKER = new URL('./bookfile-worker.js', import.meta.url);
const abortError = () => Object.assign(new Error(t('book.err.aborted')), { name: 'AbortError' });
// Ошибки движка несут `code` (ключ словаря) и `vars`: текст для человека собирается здесь, в главном потоке (Worker словарей не знает).
const human = e => { if (e?.code) e.message = t(e.code, e.vars); return e; };
const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Канал к движку: настоящий Worker или (запасной путь) тот же код в главном потоке.
class Channel {
  constructor(main) { this.main = main; this.n = 0; this.wait = new Map(); }
  async start() {
    if (this.main) { this.mod = await import('./bookfile-worker.js'); return this; }
    const w = this.w = new Worker(WORKER, { type: 'module' });
    w.onmessage = ({ data: { id, ok, err, progress } }) => {
      const p = this.wait.get(id); if (!p) { ok?.bmp?.close(); return; }
      if (progress) return p.progress?.(...progress);
      this.wait.delete(id); err ? p.reject(human(Object.assign(new Error(err.message), { name: err.name, code: err.code, vars: err.vars }))) : p.resolve(ok);
    };
    // Если сам Worker не запустился (старый браузер, запрет), все ожидающие получают ошибку.
    w.onerror = e => { for (const p of this.wait.values()) p.reject(new Error(t('book.err.noWorker'))); this.wait.clear(); };
    return this;
  }
  call(op, args, progress) {
    if (this.main) { try { return Promise.resolve(this.mod.run(op, args, { progress })).catch(e => { throw human(e); }); } catch (e) { throw human(e); } }
    return new Promise((resolve, reject) => { const id = ++this.n; this.wait.set(id, { resolve, reject, progress }); this.w.postMessage({ id, op, args }); });
  }
  cancel(job) { this.main ? this.mod.cancel(job) : this.w.postMessage({ op: 'cancel', args: { job } }); }
  stop() { this.w?.terminate(); for (const p of this.wait.values()) p.reject(Object.assign(new Error(t('book.err.closed')), { name: 'Closed' })); this.wait.clear(); }
}

export async function saveBook(file, onProgress) {
  if (!navigator.storage?.getDirectory || typeof Worker === 'undefined') throw Object.assign(new Error(t('book.err.unsupported')), { name: 'Unsupported' });
  navigator.storage.persist?.().catch(() => {}); // просим браузер не стирать книги при нехватке места
  const id = newId(), ch = await new Channel(false).start();
  try { await ch.call('save', { file, id }, (done, total) => onProgress?.(done / total, done, total)); }
  finally { ch.stop(); }
  try { const bf = await openBook(id); const info = { ...bf.info, name: file.name }; bf.close(); return info; }
  catch (e) { await removeBook(id).catch(() => {}); throw e; }
}

export async function openBook(id, { main = false, hwa = false, systemFonts } = {}) {
  const ch = await new Channel(main || typeof OffscreenCanvas === 'undefined').start();
  let info;
  // Движок страниц: по умолчанию MuPDF (bookfile-worker); ?engine=pdfjs — pdf.js, ?engine=pdfjs0 — pdf.js без удвоенной отрисовки разворота.
  const engine = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('engine') ?? '' : '';
  try { info = await ch.call('open', { id, hwa, systemFonts, engine }); } catch (e) { ch.stop(); throw e; }
  return new BookFile(id, info, ch);
}

async function oneShot(op, args) { const ch = await new Channel(false).start(); try { return await ch.call(op, args); } finally { ch.stop(); } }
export const removeBook = id => oneShot('remove', { id });
export const listBooks = () => oneShot('list', {});

class BookFile {
  constructor(id, info, ch) { this.id = id; this.info = info; this.ch = ch; this.queue = []; this.busy = false; this.seq = 0; this.sizes = new Map([[1, { w: info.w, h: info.h }]]); this.closed = false; this.onstat = null; this.tones = new Map(); }   // tones: страница → [r, g, b] фона (sRGB 0…1), кладётся до того, как картинка отдана

  pageSize(n) {
    const s = this.sizes.get(n); if (s) return Promise.resolve(s);
    return this.ch.call('pageSize', { id: this.id, n }).then(r => (this.sizes.set(n, r), r));
  }
  outline() { return this._outline ||= this.ch.call('outline', { id: this.id }); }

  // priority: больше — раньше (страницы разворота ставим выше соседних). signal.abort() снимает запрос из очереди или обрывает рисование.
  // ss — во сколько раз крупнее рисовать перед уменьшением с усреднением (1 или 2; только страницам разворота при чтении).
  render(n, height, { priority = 0, signal, ss = 1 } = {}) {
    if (this.closed) return Promise.reject(Object.assign(new Error(t('book.err.closed')), { name: 'Closed' }));
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const it = { n, height: Math.round(height), ss, priority, seq: this.seq++, resolve, reject, signal, state: 'wait' };
      it.onabort = () => {
        if (it.state === 'done') return; const was = it.state; it.state = 'done'; reject(abortError());
        if (was === 'run') this.ch.cancel(it.job); else this.queue.splice(this.queue.indexOf(it), 1);
      };
      signal?.addEventListener('abort', it.onabort, { once: true });
      this.queue.push(it); this._pump();
    });
  }

  // Рисуется одна страница за раз: сначала самая важная, при равенстве — та, что просили раньше.
  _pump() {
    if (this.busy || this.closed || !this.queue.length) return;
    let bi = 0; this.queue.forEach((q, i) => { const b = this.queue[bi]; if (q.priority > b.priority || (q.priority === b.priority && q.seq < b.seq)) bi = i; });
    const it = this.queue.splice(bi, 1)[0]; it.state = 'run'; it.job = ++this.seq; this.busy = true;
    const t0 = performance.now();
    this.ch.call('render', { id: this.id, n: it.n, height: it.height, ss: it.ss, job: it.job }).then(r => {
      if (it.state === 'done') { r.bmp.close(); return; } // пока рисовали, запрос отменили
      it.state = 'done'; it.signal?.removeEventListener('abort', it.onabort);
      if (r.tone) this.tones.set(it.n, r.tone);
      this.onstat?.({ n: it.n, height: it.height, ms: r.ms, toneMs: r.toneMs, wait: performance.now() - t0 - r.ms, w: r.bmp.width, h: r.bmp.height });
      it.resolve(r.bmp);
    }, e => { if (it.state !== 'done') { it.state = 'done'; it.reject(e); } })
      .finally(() => { this.busy = false; this._pump(); });
  }

  close() {
    this.closed = true;
    for (const it of this.queue.splice(0)) { it.state = 'done'; it.reject(Object.assign(new Error(t('book.err.closed')), { name: 'Closed' })); }
    this.ch.stop();
  }
}
