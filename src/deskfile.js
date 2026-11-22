// Стол — в файл и из файла: один ZIP с несжатыми записями, написанный здесь же, без библиотек.
//   desk.json          — { app: 'reading-room', format: 1, saved: ISO, state: <то, что лежит в localStorage под ключом стола> }
//   books/<id>.pdf     — файл каждой книги, на которую ссылается стол (id — как в state.books[].file.id)
// Записи НЕ сжимаются (STORED): PDF и так сжат, а главное — файл книги кладётся в архив как есть, ссылкой на OPFS-файл, не копируясь в память.
//   deskBlob(state, onProgress) → { blob, books, missing, bytes }  — собирает архив; onProgress(доля 0…1, подпись)
//   readDesk(file) → plan      — читает и проверяет архив, ничего не трогая (бросает DeskError с понятным текстом)
//   applyDesk(plan, onProgress) → { state, ids } — кладёт PDF в OPFS (под новыми id: прежние книги не тронуты), возвращает state с пересчитанными id
//   sweepBooksExcept(ids)      — убирает из OPFS книги, которых нет в новом столе
// Больше 4 ГБ (ZIP без zip64) не берётся: честно отказываем, а не пишем битый файл.
import { saveBook, removeBook, listBooks } from './bookfile.js';
import { t } from './i18n.js';

export const FORMAT = { app: 'reading-room', format: 1 };
export class DeskError extends Error { constructor(m) { super(m); this.name = 'DeskError'; } }
const LIMIT = 0xFFFFFFFF;       // всё в ZIP без zip64 — 32 бита
const SLICE = 1 << 20;          // CRC считаем по мегабайту: кусок ≈ 2–3 мс, потом отдаём поток кадрам
const enc = new TextEncoder(), dec = new TextDecoder();
const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const pause = () => new Promise(r => setTimeout(r, 0));
const mb = n => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} ${t('unit.kb')}` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} ${t('unit.mb')}`;

// ——— CRC-32 (slicing-by-4: ~4 байта за шаг) ———
const T = (() => {
  const t = new Uint32Array(1024);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  for (let n = 0; n < 256; n++) { let c = t[n]; for (let k = 1; k < 4; k++) { c = t[c & 255] ^ (c >>> 8); t[k * 256 + n] = c; } }
  return t;
})();
// crc — прежнее значение (0 для начала); возвращает новое.
export function crc32(b, crc = 0) {
  let c = ~crc, i = 0; const n = b.length, n4 = n - 3;
  for (; i < n4; i += 4) { c ^= b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24; c = T[768 + (c & 255)] ^ T[512 + ((c >>> 8) & 255)] ^ T[256 + ((c >>> 16) & 255)] ^ T[c >>> 24]; }
  for (; i < n; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
// CRC целого Blob/File кусками: в памяти — один кусок за раз; между кусками отдаём поток странице.
async function crcOf(blob, onBytes) {
  let c = 0;
  for (let o = 0; o < blob.size; o += SLICE) {
    c = crc32(new Uint8Array(await blob.slice(o, o + SLICE).arrayBuffer()), c);
    onBytes?.(Math.min(SLICE, blob.size - o)); await pause();
  }
  return c;
}

// ——— запись ZIP ———
function dosTime(d) { return [(d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1) & 0xFFFF, ((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()) & 0xFFFF]; }
const utf8 = s => enc.encode(s);
function localHeader(name, crc, size, [tm, dt]) {
  const nm = utf8(name), b = new Uint8Array(30 + nm.length), v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true); v.setUint16(10, tm, true); v.setUint16(12, dt, true);
  v.setUint32(14, crc, true); v.setUint32(18, size, true); v.setUint32(22, size, true); v.setUint16(26, nm.length, true); v.setUint16(28, 0, true); b.set(nm, 30);
  return b;
}
function centralHeader(name, crc, size, off, [tm, dt]) {
  const nm = utf8(name), b = new Uint8Array(46 + nm.length), v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, tm, true); v.setUint16(14, dt, true);
  v.setUint32(16, crc, true); v.setUint32(20, size, true); v.setUint32(24, size, true); v.setUint16(28, nm.length, true); v.setUint32(42, off, true); b.set(nm, 46);
  return b;
}
function endRecord(n, cdSize, cdOff) {
  const b = new Uint8Array(22), v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, n, true); v.setUint16(10, n, true); v.setUint32(12, cdSize, true); v.setUint32(16, cdOff, true);
  return b;
}

// entries: [{ name, blob }] → Blob (заголовки + сами Blob/File, без копирования больших файлов). onProgress(доля, подпись).
export async function zipBlob(entries, onProgress, when = new Date()) {
  let total = 0, cd = 0;
  for (const e of entries) { total += 30 + utf8(e.name).length + e.blob.size; cd += 46 + utf8(e.name).length; if (e.blob.size > LIMIT) throw new DeskError(t('desk.err.bigBook')); }
  total += cd + 22;
  if (total > LIMIT) throw new DeskError(t('desk.err.total', { gb: (total / 2 ** 30).toFixed(1) }));
  const bytes = entries.reduce((s, e) => s + e.blob.size, 0) || 1, ts = dosTime(when); let done = 0;
  const parts = [], central = []; let off = 0;
  for (const e of entries) {
    const crc = await crcOf(e.blob, n => onProgress?.((done += n) / bytes, e.name));
    const lh = localHeader(e.name, crc, e.blob.size, ts);
    central.push(centralHeader(e.name, crc, e.blob.size, off, ts));
    parts.push(lh, e.blob); off += lh.length + e.blob.size;
  }
  return new Blob([...parts, ...central, endRecord(entries.length, cd, off)], { type: 'application/zip' });
}

// ——— чтение ZIP (только то, что нужно нашему формату) ———
const notDesk = () => new DeskError(t('desk.err.notDesk'));
async function zipEntries(file) {
  const size = file.size;
  if (size < 22) throw notDesk();
  const tailLen = Math.min(size, 22 + 65535), tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer()), tv = new DataView(tail.buffer);
  let p = tailLen - 22;
  for (; p >= 0; p--) if (tv.getUint32(p, true) === 0x06054b50 && p + 22 + tv.getUint16(p + 20, true) === tailLen) break;
  if (p < 0) throw notDesk();
  const n = tv.getUint16(p + 10, true), cdSize = tv.getUint32(p + 12, true), cdOff = tv.getUint32(p + 16, true);
  if (n === 0xFFFF || cdSize === LIMIT || cdOff === LIMIT) throw new DeskError(t('desk.err.tooBig'));
  if (!n || cdOff + cdSize > size - tailLen + p || cdSize > 4 << 20) throw notDesk();   // каталог целиком до конечной записи
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer()), v = new DataView(cd.buffer), map = new Map();
  for (let i = 0, q = 0; i < n; i++) {
    if (q + 46 > cd.length || v.getUint32(q, true) !== 0x02014b50) throw notDesk();
    const nl = v.getUint16(q + 28, true), el = v.getUint16(q + 30, true), cl = v.getUint16(q + 32, true);
    if (q + 46 + nl > cd.length) throw notDesk();
    const name = dec.decode(cd.subarray(q + 46, q + 46 + nl));
    if (map.has(name)) throw notDesk();
    map.set(name, { name, flags: v.getUint16(q + 8, true), method: v.getUint16(q + 10, true), crc: v.getUint32(q + 16, true), csize: v.getUint32(q + 20, true), size: v.getUint32(q + 24, true), off: v.getUint32(q + 42, true) });
    q += 46 + nl + el + cl;
  }
  return map;
}
// Содержимое записи: Blob-срез архива. Проверяем, что запись целиком внутри файла и не сжата.
async function entryData(file, e) {
  if (e.flags & 1) throw new DeskError(t('desk.err.encrypted'));
  if (e.method !== 0 || e.csize !== e.size) throw new DeskError(t('desk.err.recompressed'));
  if (e.off + 30 > file.size) throw notDesk();
  const lh = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw notDesk();
  const start = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  if (start + e.csize > file.size) throw new DeskError(t('desk.err.truncated'));
  return file.slice(start, start + e.csize);
}

// Читает и проверяет файл стола, ничего не меняя. plan: { state, pdfs: [{ id, name, blob }], missing, counts: { sheets, folders, books }, saved }
export async function readDesk(file) {
  const map = await zipEntries(file);
  const e = map.get('desk.json'); if (!e) throw notDesk();
  if (e.size > 64 << 20) throw notDesk();
  const data = await entryData(file, e), bytes = new Uint8Array(await data.arrayBuffer());
  if (crc32(bytes) !== e.crc) throw new DeskError(t('desk.err.checksum'));
  let doc; try { doc = JSON.parse(dec.decode(bytes)); } catch { throw notDesk(); }
  if (!doc || doc.app !== FORMAT.app) throw notDesk();
  if (doc.format !== FORMAT.format) throw new DeskError(doc.format > FORMAT.format ? t('desk.err.newer') : notDesk().message);
  const st = doc.state;
  if (!st || typeof st !== 'object' || Array.isArray(st)) throw notDesk();
  for (const k of ['sheets', 'binders', 'books']) if (st[k] != null && !Array.isArray(st[k])) throw notDesk();
  if (st.sheets?.some(s => !s || typeof s !== 'object') || st.binders?.some(s => !s || typeof s !== 'object')) throw notDesk();
  // Книги: прежняя одиночная `book` — тоже книга.
  const books = (Array.isArray(st.books) ? st.books : st.book ? [st.book] : []).filter(b => b && typeof b === 'object');
  const pdfs = new Map(); let missing = 0;
  for (const b of books) {
    const id = b.file?.id; if (id == null) continue;
    const ent = idOk(id) && map.get(`books/${id}.pdf`);
    if (!ent) { missing++; continue; }
    if (!pdfs.has(id)) pdfs.set(id, { id, name: typeof b.file.name === 'string' ? b.file.name : id + '.pdf', blob: await entryData(file, ent) });
  }
  return { state: st, pdfs: [...pdfs.values()], missing, counts: { sheets: st.sheets?.length ?? 0, folders: st.binders?.length ?? 0, books: books.filter(b => b.file?.id != null).length }, saved: typeof doc.saved === 'string' ? doc.saved : '' };
}

// Книги стола, у которых в OPFS лежит целый файл: [{ id, file }] (File из хранилища, не копия).
export async function bookFiles(state) {
  const books = (Array.isArray(state.books) ? state.books : state.book ? [state.book] : []).filter(b => b && typeof b === 'object');
  const ids = [...new Set(books.map(b => b.file?.id).filter(idOk))], res = []; let missing = 0;
  if (ids.length && navigator.storage?.getDirectory) {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('books', { create: true });
    for (const id of ids) {
      try {
        const partial = await dir.getFileHandle(id + '.part').then(() => true, () => false);
        if (partial) throw 0;
        res.push({ id, file: await (await dir.getFileHandle(id + '.pdf')).getFile() });
      } catch { missing++; }
    }
  } else missing = ids.length;
  return { files: res, missing };
}

// Весь стол в один Blob. state — разобранный localStorage. Названия файлов в архиве — по id книги.
export async function deskBlob(state, onProgress) {
  const { files, missing } = await bookFiles(state);
  const desk = new Blob([JSON.stringify({ ...FORMAT, saved: new Date().toISOString(), state })], { type: 'application/json' });
  const entries = [{ name: 'desk.json', blob: desk }, ...files.map(f => ({ name: `books/${f.id}.pdf`, blob: f.file }))];
  const blob = await zipBlob(entries, onProgress);
  return { blob, books: files.length, missing, bytes: blob.size };
}

// PDF — в OPFS, под новыми id (прежние файлы не трогаются, пока новый стол не принят); state получает новые id. При ошибке написанное убирается.
export async function applyDesk(plan, onProgress) {
  const map = new Map(), made = []; let k = 0;
  try {
    for (const p of plan.pdfs) {
      k++;
      const info = await saveBook(p.blob, f => onProgress?.(k, plan.pdfs.length, f, p.name));
      made.push(info.id); map.set(p.id, info.id);
    }
  } catch (e) { for (const id of made) await removeBook(id).catch(() => {}); throw e; }
  const st = structuredClone(plan.state);
  const fix = b => { if (!b || typeof b !== 'object' || b.file?.id == null) return; const id = map.get(b.file.id); if (id) b.file.id = id; else { b.file = null; delete b.pages; delete b.ratio; delete b.marks; b.pose = 'face'; b.i = 0; } };   // нет файла в архиве — книга остаётся пустой
  if (Array.isArray(st.books)) st.books.forEach(fix); if (st.book) fix(st.book);
  return { state: st, ids: new Set(made), undo: () => Promise.all(made.map(id => removeBook(id).catch(() => {}))) };
}
export async function sweepBooksExcept(keep) {
  let n = 0;
  for (const b of await listBooks()) if (!keep.has(b.id)) { try { await removeBook(b.id); n++; } catch (e) { console.warn(e); } }
  return n;
}
export { mb };
