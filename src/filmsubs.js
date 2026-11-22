// filmsubs.js — субтитры для проектора: разбор файлов .srt/.vtt/.ass, очистка текста реплик,
// выбор кодировки и слежение за <video> (когда какие реплики видны). Без зависимостей; работает и в воркере
// (очистка текста), и в главном потоке (всё остальное). Подключение и ограничения — docs/filmaudio-test/INTEGRATION.md.
//
// Формат реплики во всём модуле:
//   { start, end, text, lines }
//   start, end — секунды; text — чистый текст («\n» между строками);
//   lines — [{text, italic}] по строкам. italic = true, если ВСЯ строка набрана курсивом
//   (<i>…</i> или {\i1}…{\i0}); если курсив только в части строки — italic = false, теги просто убраны.

// ------------------------------------------------------------------ очистка текста реплики
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '', zwnj: '', zwj: ''};
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/**
 * Чистит текст реплики любого формата (SRT с HTML-тегами, WebVTT, ASS/SSA, mov_text).
 * Убирает {\…} (теги ASS), <i>/<b>/<u>/<font>/<c.x>/<v X>/<ruby> и т. п., переводит \N, \n, \h в перенос строки/пробел,
 * выкидывает векторные рисунки ASS ({\p1}…). Возвращает [{text, italic}] без пустых строк.
 */
export function cleanCueText(raw) {
  let s = String(raw).replace(/\r\n?/g, '\n');
  const lines = [];
  let cur = '', curItalic = 0, curChars = 0;   // curItalic — сколько непробельных символов набрано курсивом
  let italic = false, drawing = false;
  const endLine = () => {
    const text = cur.replace(/[ \t ]+/g, ' ').trim();
    if (text) lines.push({text: decodeEntities(text), italic: curChars > 0 && curItalic === curChars});
    cur = ''; curItalic = 0; curChars = 0;
  };
  const put = (str) => {
    if (drawing) return;
    cur += str;
    const nb = str.replace(/\s/g, '').length;
    curChars += nb;
    if (italic) curItalic += nb;
  };
  const n = s.length;
  let i = 0, buf = '';
  const flush = () => { if (buf) { put(buf); buf = ''; } };
  while (i < n) {
    const c = s[i];
    if (c === '{') {                               // блок тегов ASS
      const j = s.indexOf('}', i);
      if (j > 0) {
        flush();
        const block = s.slice(i + 1, j);
        const re = /\\(?:(i|p)(\d+)|r)/g;
        let m;
        while ((m = re.exec(block))) {
          if (m[1] === 'i') italic = m[2] === '1';
          else if (m[1] === 'p') drawing = m[2] !== '0';
          else italic = false;                     // \r — сброс к стилю
        }
        i = j + 1; continue;
      }
    } else if (c === '<') {                        // HTML-подобные теги
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:[\s.][^>]*)?>/.exec(s.slice(i, i + 200));
      if (m) {
        flush();
        if (m[2].toLowerCase() === 'i') italic = m[1] === '';
        if (m[2].toLowerCase() === 'br') endLine();
        i += m[0].length; continue;
      }
      const ts = /^<\d\d?:\d\d?(?::\d\d)?[.,]\d+>/.exec(s.slice(i, i + 20));   // метки времени внутри реплики WebVTT
      if (ts) { flush(); i += ts[0].length; continue; }
    } else if (c === '\\') {
      const d = s[i + 1];
      if (d === 'N' || d === 'n') { flush(); endLine(); i += 2; continue; }
      if (d === 'h') { buf += ' '; i += 2; continue; }
    } else if (c === '\n') { flush(); endLine(); i++; continue; }
    buf += c; i++;
  }
  flush(); endLine();
  return lines;
}

export function makeCue(start, end, raw) {
  const lines = cleanCueText(raw);
  if (!lines.length || !(end > start)) return null;
  return {start, end, text: lines.map((l) => l.text).join('\n'), lines};
}

// ------------------------------------------------------------------ кодировки
function cyrillicLike(bytes) {
  // Windows-1251: кириллические буквы лежат в C0–FF (+ Ё/ё A8/B8 и украинские/белорусские буквы в A0–BF)
  const cyrExtra = new Set([0xa5, 0xaa, 0xaf, 0xb2, 0xb3, 0xb4, 0xba, 0xbf, 0xa8, 0xb8, 0xa1, 0xa2, 0xb5]);
  let high = 0, cyr = 0, ascii = 0, tag = 0;
  const lim = Math.min(bytes.length, 200000);
  for (let i = 0; i < lim; i++) {
    const b = bytes[i];
    if (b === 0x3c || b === 0x7b) tag++; else if (b === 0x3e || b === 0x7d) tag = 0;   // латиница внутри <тегов> и {тегов} не считается
    if (b >= 0x80) { high++; if (b >= 0xc0 || cyrExtra.has(b)) cyr++; }
    else if (!tag && ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a))) ascii++;
  }
  return high > 0 && cyr / high >= 0.9 && cyr / (cyr + ascii) >= 0.5;
}

/** Байты -> {text, encoding}: UTF-8 (с BOM или без), UTF-16 LE/BE (BOM, либо по нулевым байтам), windows-1251, иначе latin1 (windows-1252). */
export function decodeSubtitleBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dec = (enc, from = 0, fatal = false) => new TextDecoder(enc, {fatal}).decode(b.subarray(from));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return {text: dec('utf-8', 3), encoding: 'utf-8', bom: true};
  if (b[0] === 0xff && b[1] === 0xfe) return {text: dec('utf-16le', 2), encoding: 'utf-16le', bom: true};
  if (b[0] === 0xfe && b[1] === 0xff) return {text: dec('utf-16be', 2), encoding: 'utf-16be', bom: true};
  // UTF-16 без BOM: у латиницы каждый второй байт нулевой
  if (b.length >= 8) {
    let z0 = 0, z1 = 0;
    const lim = Math.min(b.length - 1, 4000);
    for (let i = 0; i < lim; i += 2) { if (b[i] === 0) z0++; if (b[i + 1] === 0) z1++; }
    const half = lim / 2;
    if (z1 > half * 0.3 && z0 < half * 0.05) return {text: dec('utf-16le'), encoding: 'utf-16le', bom: false};
    if (z0 > half * 0.3 && z1 < half * 0.05) return {text: dec('utf-16be'), encoding: 'utf-16be', bom: false};
  }
  try { return {text: dec('utf-8', 0, true), encoding: 'utf-8', bom: false}; } catch (e) { /* не UTF-8 */ }
  if (cyrillicLike(b)) return {text: dec('windows-1251'), encoding: 'windows-1251', bom: false};
  return {text: dec('windows-1252'), encoding: 'latin1', bom: false};
}

// ------------------------------------------------------------------ разбор файлов
function parseClock(str, ass) {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345 (VTT) | 0:01:02.34 (ASS, сотые)
  const m = /^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/.exec(str.trim());
  if (!m) return NaN;
  const frac = m[4] ? parseFloat('0.' + m[4]) : 0;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + frac;
}

function sortCues(cues) { cues.sort((a, b) => a.start - b.start || a.end - b.end); return cues; }

export function parseSRT(text) {
  const cues = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const blk of blocks) {
    const lines = blk.split('\n');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[k]);
    if (!m) continue;
    const c = makeCue(parseClock(m[1]), parseClock(m[2]), lines.slice(k + 1).join('\n'));
    if (c) cues.push(c);
  }
  return sortCues(cues);
}

export function parseVTT(text) {
  const cues = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const blk of blocks) {
    const lines = blk.split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const m = /^\s*([\d:.]+)\s*-->\s*([\d:.]+)/.exec(lines[k]);
    if (!m) continue;
    const c = makeCue(parseClock(m[1]), parseClock(m[2]), lines.slice(k + 1).join('\n'));
    if (c) cues.push(c);
  }
  return sortCues(cues);
}

/** Номер (с 0) поля Text в «Dialogue:» по строке Format секции [Events]; без неё — стандартные 10 полей. */
function assFormat(text) {
  const m = /^\s*\[Events\][\s\S]*?^\s*Format:\s*(.+)$/im.exec(text);
  const names = (m ? m[1] : 'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text').split(',').map((s) => s.trim().toLowerCase());
  return {names, start: names.indexOf('start'), end: names.indexOf('end'), text: names.indexOf('text')};
}

export function parseASS(text) {
  const cues = [];
  const f = assFormat(text);
  if (f.start < 0 || f.end < 0 || f.text < 0) return cues;
  let inEvents = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*\[.*\]\s*$/.test(line)) { inEvents = /^\s*\[events\]/i.test(line); continue; }
    if (!inEvents) continue;
    const m = /^\s*Dialogue:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const parts = [];
    let rest = m[1];
    for (let i = 0; i < f.names.length - 1; i++) {   // последнее поле (Text) может содержать запятые
      const j = rest.indexOf(',');
      if (j < 0) { parts.push(rest); rest = ''; break; }
      parts.push(rest.slice(0, j)); rest = rest.slice(j + 1);
    }
    parts.push(rest);
    const c = makeCue(parseClock(parts[f.start], true), parseClock(parts[f.end], true), parts[f.text] || '');
    if (c) cues.push(c);
  }
  return sortCues(cues);
}

/** Определяет формат по расширению и началу файла: 'srt' | 'vtt' | 'ass' | null. */
export function sniffSubtitleFormat(name, text) {
  const head = text.slice(0, 2000);
  if (/^\s*WEBVTT/.test(head)) return 'vtt';
  if (/^\s*\[Script Info\]/im.test(head) || /^\s*\[(V4\+? Styles|Events)\]/im.test(text.slice(0, 20000))) return 'ass';
  const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1];
  if (ext) { const e = ext.toLowerCase(); if (e === 'vtt') return 'vtt'; if (e === 'ass' || e === 'ssa') return 'ass'; if (e === 'srt') return 'srt'; }
  if (/\d+[:]\d+[:]\d+[,.]\d+\s*-->/.test(head)) return 'srt';
  return null;
}

/** Внешний файл субтитров (.srt, .vtt, .ass, .ssa) -> {cues, format, encoding, bom}. Wasm не нужен. Бросает ошибку, если формат не узнан. */
export async function parseSubtitleFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const {text, encoding, bom} = decodeSubtitleBytes(bytes);
  const format = sniffSubtitleFormat(file.name, text);
  if (!format) throw new Error('parseSubtitleFile: формат субтитров не распознан' + (file.name ? ' (' + file.name + ')' : ''));
  const cues = format === 'vtt' ? parseVTT(text) : format === 'ass' ? parseASS(text) : parseSRT(text);
  return {cues, format, encoding, bom};
}

// ------------------------------------------------------------------ ось времени и слежение за <video>
const key = (c) => c.start + '|' + c.end + '|' + c.text;

/** Отсортированный набор реплик: быстрый ответ «что видно в момент t». */
export class CueTimeline {
  constructor() { this.clear(); }
  clear() { this.cues = []; this.keys = new Set(); this.maxDur = 0; }
  add(list) {
    let n = 0;
    for (const c of list) {
      const k = key(c);
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      // вставка в отсортированный массив (двоичный поиск; чаще всего — в конец)
      const a = this.cues;
      let lo = 0, hi = a.length;
      if (hi && a[hi - 1].start > c.start) { while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].start <= c.start) lo = mid + 1; else hi = mid; } } else lo = hi;
      a.splice(lo, 0, c);
      if (c.end - c.start > this.maxDur) this.maxDur = c.end - c.start;
      n++;
    }
    return n;
  }
  // номер первой реплики с start > t
  _upper(t) {
    const a = this.cues;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].start <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  at(t) {
    const a = this.cues, out = [];
    for (let i = this._upper(t) - 1; i >= 0 && a[i].start >= t - this.maxDur; i--) if (a[i].end > t) out.push(a[i]);
    return out.reverse();
  }
  /** ближайший момент, когда набор видимых реплик изменится (> t); Infinity — больше перемен нет */
  nextChange(t) {
    const a = this.cues;
    let next = Infinity;
    const u = this._upper(t);
    if (u < a.length) next = a[u].start;
    for (let i = u - 1; i >= 0 && a[i].start >= t - this.maxDur; i--) if (a[i].end > t && a[i].end < next) next = a[i].end;
    return next;
  }
}

const LEAD = 0.004;          // показываем реплику на 4 мс раньше метки: таймер в Chrome не точнее
const MAX_SLEEP = 250;       // мс: чаще не просыпаемся, реже — не спим (страховка от ухода часов и дросселирования таймеров)

/**
 * Ведёт <video>: зовёт onChange(lines, rich), когда меняется набор видимых реплик.
 *   lines — массив строк (чистый текст); пусто — ничего не показывать.
 *   rich  — то же как [{text, italic}] (italic = вся строка курсивом).
 * timeline заполняет владелец (watchCues — сразу, watchSubtitles — по мере чтения файла); после добавления реплик вызвать refresh().
 */
export class CueFollower {
  constructor({video, timeline, onChange, offset = 0}) {
    this.video = video; this.timeline = timeline; this.onChange = onChange || (() => {});
    this.offset = +offset || 0;
    this.sig = '';
    this.timer = 0;
    this.disposed = false;
    this.enabled = true;
    this._ev = ['play', 'playing', 'pause', 'seeked', 'seeking', 'ratechange', 'timeupdate', 'emptied', 'loadeddata', 'waiting', 'ended']
      .map((n) => { const f = () => this.refresh(n); video.addEventListener(n, f); return [n, f]; });
  }
  setOffset(sec) { this.offset = +sec || 0; this.refresh('offset'); }
  setEnabled(on) { this.enabled = !!on; this.refresh('enabled'); }
  /** время субтитров сейчас (секунды), с учётом сдвига */
  now() { return this.video.currentTime - this.offset; }
  refresh() {
    if (this.disposed) return;
    clearTimeout(this.timer); this.timer = 0;
    const v = this.video;
    if (v.seeking) return;                       // картинка ещё старая — по 'seeked' покажем нужное
    const t = this.now();
    const tl = this.timeline;
    const act = this.enabled ? tl.at(t + LEAD) : [];
    const sig = act.map(key).join('\u0001');
    if (sig !== this.sig) {
      this.sig = sig;
      const rich = [];
      for (const c of act) for (const l of c.lines) rich.push(l);
      try { this.onChange(rich.map((l) => l.text), rich, act); } catch (e) { console.error('filmsubs: onChange', e); }
    }
    if (!v.paused && !v.ended) {
      const rate = v.playbackRate || 1;
      const nx = this.enabled ? tl.nextChange(t + LEAD) : Infinity;
      const ms = Math.max(0, Math.min(MAX_SLEEP, ((nx - t - LEAD) / rate) * 1000));
      this.timer = setTimeout(() => this.refresh('timer'), ms);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    for (const [n, f] of this._ev) this.video.removeEventListener(n, f);
    if (this.sig) { this.sig = ''; try { this.onChange([], [], []); } catch (e) { /* ignore */ } }
  }
}

/**
 * Внешние реплики (из parseSubtitleFile) под <video>: { video, cues, onChange, offset? } -> { setCues(cues), setOffset(sec), setEnabled(bool), dispose() }.
 * onChange(lines, rich) — как у CueFollower; пустой массив — ничего не показывать.
 */
export function watchCues({video, cues, onChange, offset = 0}) {
  const timeline = new CueTimeline();
  timeline.add(cues || []);
  const f = new CueFollower({video, timeline, onChange, offset});
  f.refresh('start');
  return {
    setCues(list) { timeline.clear(); timeline.add(list || []); f.refresh('cues'); },
    setOffset: (s) => f.setOffset(s),
    setEnabled: (on) => f.setEnabled(on),
    dispose: () => f.dispose(),
  };
}
