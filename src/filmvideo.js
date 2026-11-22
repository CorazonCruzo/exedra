// filmvideo.js — картинка фильма, который Chrome сам не играет (AVI с Xvid/DivX/MJPEG/DV, MPEG-2 с DVD, ...).
//
// Кадры декодирует FFmpeg (libav.js, WebAssembly, LGPL) в воркере; файл читается кусками через File.slice(), целиком в память не
// попадает. Вместо <video> зал получает объект `media` с тем же минимумом свойств, событий и методов (currentTime, paused, play(),
// pause(), seeking, ended, ...) — по нему работают и filmaudio (звук), и filmsubs (субтитры) без изменений — и кадры:
// `media.frame` (плоскости Y, U, V) и `media.frameSerial` (растёт при каждом новом кадре). Подробности — docs/filmvideo-test/INTEGRATION.md.
//
//   const fv = await openFilmVideo(file);        // { width, height, sar, displayAspect, fps, duration, codec, container, canPlay, media, close() }
//   if (fv.canPlay) {
//     const media = fv.media;                    // как <video>: play(), pause(), currentTime = t, события
//     const fa = await openFilmAudio(file);      // звук и субтитры — как обычно, но вместо video подаём media
//     fa.attach({ctx, video: media, track: fa.defaultTrack, destination});
//     // каждый кадр отрисовки:
//     if (media.frameSerial !== lastSerial) { lastSerial = media.frameSerial; upload(media.frame); }
//   }
//
// Часы — у самого `media` (performance.now, ровные, без ступенек); звук подстраивается под них так же, как под <video>.

import {needsOwnVideo} from './filmaudio.js';
export {needsOwnVideo};

const AHEAD_SEC = 0.7;          // на сколько секунд вперёд декодировать (по часам)
const MAX_QUEUE_BYTES = 40e6;   // потолок очереди кадров по памяти
const MIN_QUEUE = 4, MAX_QUEUE = 16;
const TICK_MS = 60;

export async function openFilmVideo(file, options = {}) {
  if (!(file instanceof Blob)) throw new TypeError('openFilmVideo: нужен File или Blob');
  const worker = new Worker(options.workerUrl || new URL('./filmvideo-worker.js', import.meta.url), {type: 'module'});
  const fv = new FilmVideo(worker, file);
  let timer;
  try {
    await Promise.race([fv._opened, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('filmvideo: файл не открылся за ' + (options.timeoutMs || 30000) / 1000 + ' с')), options.timeoutMs || 30000); })]);
  } catch (e) {
    worker.terminate();
    throw e;
  } finally { clearTimeout(timer); }
  return fv;
}

// Таблица цветов: Kr, Kb для матриц YCbCr (AVCOL_SPC_*)
const MATRICES = {
  bt601: [0.299, 0.114], bt709: [0.2126, 0.0722], bt2020: [0.2627, 0.0593], smpte240m: [0.212, 0.087],
};
const CS_NAME = {1: 'bt709', 4: 'bt601', 5: 'bt601', 6: 'bt601', 7: 'smpte240m', 9: 'bt2020', 10: 'bt2020'};

/**
 * Данные для шейдера YUV -> RGB для этого кадра (или для сведений fv): { matrix: Float32Array(9, по столбцам, для mat3 в GLSL),
 * yOff, yScale, cOff, cScale, name } — rgb = matrix * vec3((Y - yOff) * yScale, (U - cOff) * cScale, (V - cOff) * cScale);
 * Y, U, V — значения текстуры 0..1. Матрицу выбирает кадр (cs из потока); если в потоке не указана — по размеру: от 720 строк
 * или шире 1024 — BT.709, иначе BT.601. Диапазон — по кадру (J-форматы и метка в потоке — полный, иначе ограниченный).
 */
export function yuvToRgb(frame) {
  const name = CS_NAME[frame.cs] || (frame.h >= 720 || frame.w > 1024 ? 'bt709' : 'bt601');
  const [kr, kb] = MATRICES[name];
  const kg = 1 - kr - kb;
  const m = new Float32Array([
    1, 1, 1,
    0, -2 * kb * (1 - kb) / kg, 2 * (1 - kb),
    2 * (1 - kr), -2 * kr * (1 - kr) / kg, 0,
  ]);
  const full = !!frame.fullRange;
  return {matrix: m, name, full, yOff: full ? 0 : 16 / 255, yScale: full ? 1 : 255 / 219, cOff: 128 / 255, cScale: full ? 1 : 255 / 224};
}

class FilmVideo {
  constructor(worker, file) {
    this.file = file;
    this._worker = worker;
    this._closed = false;
    this.media = null;
    this._opened = new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'opened') {
          const i = m.info;
          this.info = i;
          this.container = i.container;
          this.format = i.container;
          this.frameDur = i.frameDur;
          this.codec = i.codec;
          this.width = i.width; this.height = i.height;
          this.sar = i.sarNum / i.sarDen;
          this.displayAspect = (i.width * i.sarNum) / (i.height * i.sarDen);
          this.fps = i.fps;
          this.duration = i.duration;           // длительность по контейнеру, с
          this.startTime = i.startTime;         // метка первого кадра, с (у AVI 0)
          this.profile = i.profile; this.level = i.level;
          this.hasAudio = i.audioStreams > 0;
          this.interlaced = i.fieldOrder > 1;
          this.canPlay = i.canDecode;
          this.reason = i.canDecode ? '' : 'кодек ' + i.codec + ' не поддерживается сборкой' + (i.decodeError ? ' (' + i.decodeError + ')' : '');
          this.openInfo = {openMs: i.openMs, bytesRead: i.bytesRead, reads: i.reads, size: i.size};
          this.media = i.canDecode ? new FilmVideoMedia(this, worker) : null;   // без декодера кадров не будет: решать по canPlay
          resolve(this);
        } else if (m.type === 'error' && m.fatal) {
          reject(new Error(m.message));
          worker.terminate();
        }
      };
      worker.onerror = (e) => { reject(new Error(e.message || 'не удалось запустить воркер')); };
      worker.postMessage({type: 'open', file});
    });
  }

  /** Нужен ли наш показ картинки вместо <video> (по контейнеру и кодеку; см. needsOwnVideo в filmaudio.js). */
  needsOwnVideo(video) { return needsOwnVideo(this, video); }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this.media) this.media._dispose();
    try { this._worker.postMessage({type: 'close'}); } catch (e) { /* ignore */ }
    setTimeout(() => this._worker.terminate(), 50);
  }
}

// ---------------------------------------------------------------------------------------------
// Минимальный «видеоэлемент»: часы, состояние, события; кадры — в media.frame
class FilmVideoMedia extends EventTarget {
  constructor(fv, worker) {
    super();
    this.fv = fv;
    this._worker = worker;
    this.isFilmVideo = true;
    this.ownVideo = true;            // filmaudio: у этого «видео» нет родного звука, звук всегда свой
    this.muted = false; this.volume = 1;
    this.videoWidth = fv.width; this.videoHeight = fv.height;
    this.videoOffset = 0;            // с: сдвиг картинки относительно часов (> 0 — картинка позже)
    this._dur = fv.duration > 0 ? fv.duration + fv.startTime : NaN;
    this._paused = true;
    this._rate = 1;
    this._base = 0; this._t0 = 0;    // часы: позиция _base в момент _t0 (с, performance.now)
    this._seeking = false; this._seekT = 0; this._seekStart = 0;
    this._ended = false;
    this._readyState = 1;
    this._error = null;
    this._gen = 0;
    this._queue = [];                // декодированные кадры, по возрастанию pts
    this._cur = null;                // кадр, который показывается
    this._serial = 0;
    this._eofEnd = NaN;              // конец последнего кадра, если файл дочитан
    this._until = 0;
    this._lastTimeupdate = 0;
    this._disposed = false;
    this._firstFrame = false;
    this._playWaiters = [];
    this._maxQueue = MAX_QUEUE;
    this.st = {frames: 0, shown: 0, dropped: 0, droppedLate: 0, previews: 0,
      decodeMsSum: 0, decodeMsMax: 0, seeks: 0, lastSeekMs: 0, seekMsMax: 0, lastPreviewMs: 0, errors: 0, starved: 0, worker: null,
      queueMax: 0, bytesQueued: 0};
    worker.onmessage = (ev) => this._onWorker(ev.data);
    worker.onerror = (e) => { this.st.errors++; this._error = {code: 4, message: e.message || 'ошибка воркера'}; this._fire('error'); };
    this._timer = setInterval(() => this._tick(), TICK_MS);
    // первый кадр (обложка): не ждём вызова seek — читаем сразу
    this._startSeek(0, true);
    setTimeout(() => this._fire('loadedmetadata'), 0);
  }

  // ------------------------------------------------------------------ свойства как у <video>
  get duration() { return this._dur; }
  get paused() { return this._paused; }
  get seeking() { return this._seeking; }
  get ended() { return this._ended; }
  get readyState() { return this._readyState; }
  get networkState() { return 1; }
  get error() { return this._error; }
  get playbackRate() { return this._rate; }
  set playbackRate(v) {
    v = +v;
    if (!(v > 0) || v === this._rate) return;
    this._rebase();
    this._rate = v;
    this._fire('ratechange');
  }
  get currentTime() { return this._pos(); }
  set currentTime(v) {
    v = +v;
    if (!Number.isFinite(v)) return;
    this._startSeek(v, false);
  }
  get src() { return ''; }
  canPlayType() { return ''; }       // «родного» воспроизведения нет

  play() {
    if (this._disposed) return Promise.reject(new Error('filmvideo закрыт'));
    if (this._ended) this._startSeek(0, false);
    if (!this._paused) return Promise.resolve();
    this._paused = false;
    this._ended = false;
    this._fire('play');
    if (this._seeking || this._readyState < 3) {
      this._fire('waiting');
      return new Promise((res, rej) => this._playWaiters.push({res, rej}));
    }
    this._resumeClock();
    return Promise.resolve();
  }

  pause() {
    if (this._paused) return;
    this._base = this._pos();
    this._paused = true;
    this._fire('pause');
    this._fire('timeupdate');
  }

  load() { /* нечего загружать */ }

  // ------------------------------------------------------------------ кадры
  /** Кадр, который сейчас надо показывать: {w, h, cw, ch, y, u, v, strideY, strideU, strideV, strideUV, pts, dur, fullRange, cs, key} или null. */
  get frame() { this._advance(); return this._cur; }
  /** Растёт при каждом новом кадре (в том числе после перемотки): заливайте текстуру только при смене. */
  get frameSerial() { this._advance(); return this._serial; }

  /** Статистика: показано, пропущено, отставание кадра от часов, время декодирования, очередь. */
  stats() {
    const s = this.st;
    return {
      frames: s.frames, shown: s.shown, dropped: s.dropped, droppedLate: s.droppedLate, starved: s.starved, previews: s.previews,
      prepMsAvg: s.frames ? s.decodeMsSum / s.frames : NaN, prepMsMax: s.decodeMsMax,   // подготовка кадра в воркере (перевод формата + копия), без самого декодирования: его время — в worker.decodeMs / worker.decoded
      seeks: s.seeks, lastSeekMs: s.lastSeekMs, seekMsMax: s.seekMsMax, lastPreviewMs: s.lastPreviewMs,
      queue: this._queue.length, queueMax: s.queueMax, ahead: this._queue.length ? this._queue[this._queue.length - 1].pts - this._pos() : 0,
      errors: s.errors, worker: s.worker, readyState: this._readyState, playing: !this._paused && !this._seeking,
    };
  }

  resetStats() {
    const w = this.st.worker;
    this.st = {...this.st, frames: 0, shown: 0, dropped: 0, droppedLate: 0, previews: 0,
      decodeMsSum: 0, decodeMsMax: 0, errors: 0, starved: 0, queueMax: 0, worker: w};
  }

  // ------------------------------------------------------------------ часы
  _now() { return performance.now() / 1000; }

  _pos() {
    if (this._seeking) return this._seekT;
    if (this._paused) return this._base;
    let t = this._base + this._rate * (this._now() - this._t0);
    const end = this._endTime();
    if (t > end) t = end;
    return t;
  }

  _endTime() {
    let e = Number.isFinite(this._dur) ? this._dur : Infinity;
    if (Number.isFinite(this._eofEnd)) e = Math.min(e, this._eofEnd);
    return e;
  }

  _rebase() { this._base = this._pos(); this._t0 = this._now(); }

  _resumeClock() {
    this._t0 = this._now();
    this._fire('playing');
    const w = this._playWaiters; this._playWaiters = [];
    for (const p of w) p.res();
  }

  // ------------------------------------------------------------------ перемотка
  _startSeek(t, initial) {
    if (this._disposed) return;
    const end = Number.isFinite(this._dur) ? this._dur : Infinity;
    t = Math.max(0, Math.min(t, end));
    this._gen++;
    this._seeking = true;
    this._seekInitial = !!initial;
    this._seekT = t;
    this._seekStart = performance.now();
    this._ended = false;
    this._eofEnd = NaN;
    this._queue = [];
    this._readyState = 1;
    this.st.seeks++;
    const until = t + this._ahead();
    this._until = until;
    // у самого конца просим кадр чуть раньше: «последний кадр» лежит не на самой длительности
    const fd = this.fv.frameDur || 0.04;
    const reqT = Number.isFinite(this._dur) ? Math.min(t, Math.max(0, this._dur - 1.5 * fd)) : t;
    this._worker.postMessage({type: 'seek', gen: this._gen, time: reqT, until: until, preview: !initial});
    if (!initial) { this._fire('seeking'); this._fire('timeupdate'); }
  }

  _finishSeek() {
    const t = this._seekT;
    this._seeking = false;
    this._base = t;
    this._t0 = this._now();
    this._readyState = 4;
    const ms = performance.now() - this._seekStart;
    this.st.lastSeekMs = ms;
    if (ms > this.st.seekMsMax) this.st.seekMsMax = ms;
    if (!this._firstFrame) { this._firstFrame = true; this._fire('loadeddata'); }
    if (!this._seekInitial) this._fire('seeked');
    this._fire('canplay');
    this._fire('timeupdate');
    if (!this._paused) this._resumeClock();
  }

  _ahead() {
    const f = this.fv;
    const frameBytes = f.width * f.height * 1.5;
    const maxQ = Math.max(MIN_QUEUE, Math.min(MAX_QUEUE, Math.floor(MAX_QUEUE_BYTES / frameBytes)));
    this._maxQueue = maxQ;
    const dur = 1 / (f.fps || 25);
    return Math.min(AHEAD_SEC, maxQ * dur) * Math.max(1, this._rate);
  }

  // ------------------------------------------------------------------ воркер
  _onWorker(m) {
    if (this._disposed) return;
    if (m.type === 'frame') {
      if (m.gen !== this._gen) return;
      this._onFrame(m);
    } else if (m.type === 'eof') {
      if (m.gen !== this._gen) return;
      this._eofEnd = m.endPts;
      if (this._seeking) {                    // перемотали за последний кадр: остаётся то, что есть (предварительный или прежний кадр), конец
        this._seekT = Math.min(this._seekT, Math.max(0, m.endPts));
        this._finishSeek();
        if (!this._paused) this._finish();
      }
    } else if (m.type === 'tick') {
      this.st.worker = m.stats;
    } else if (m.type === 'error') {
      this.st.errors++;
      if (m.fatal || /перемотать|ошибка чтения/.test(m.message)) {
        this._error = {code: 4, message: m.message};
        this._fire('error');
      }
    }
  }

  _onFrame(m) {
    const buf = m.buf;
    const frame = {
      w: m.w, h: m.h, cw: m.cw, ch: m.ch, pts: m.pts, dur: m.dur, fullRange: m.fullRange, cs: m.cs, key: m.key,
      y: new Uint8Array(buf, m.offY, m.strideY * m.h),
      u: new Uint8Array(buf, m.offU, m.strideU * m.ch),
      v: new Uint8Array(buf, m.offV, m.strideV * m.ch),
      strideY: m.strideY, strideU: m.strideU, strideV: m.strideV, strideUV: m.strideU,
      bytes: buf.byteLength, preview: m.preview,
    };
    const st = this.st;
    st.frames++;
    st.decodeMsSum += m.ms; if (m.ms > st.decodeMsMax) st.decodeMsMax = m.ms;
    if (this._seeking) {
      if (m.preview) {                        // мгновенный кадр с ключевого места: экран обновляем сразу, перемотка продолжается
        st.previews++;
        st.lastPreviewMs = performance.now() - this._seekStart;
        this._cur = frame; this._serial++;
        return;
      }
      this._cur = frame; this._serial++;
      this._queue = [];
      this._finishSeek();
      this._pump();
      return;
    }
    // обычное воспроизведение: кладём в очередь по порядку
    const q = this._queue;
    let i = q.length;
    while (i > 0 && q[i - 1].pts > frame.pts) i--;
    q.splice(i, 0, frame);
    if (q.length > st.queueMax) st.queueMax = q.length;
    if (!this._firstFrame) { this._cur = frame; this._serial++; }
    this._advance();
  }

  // Выбор кадра для текущего момента: берём самый поздний, чья метка уже наступила; пропущенные считаем
  _advance() {
    if (this._seeking || this._disposed) return;
    const q = this._queue;
    if (!q.length) return;
    // при воспроизведении выбираем ближайший к часам кадр (а не «последний, что уже наступил»): ошибка ±полкадра вместо 0…кадр
    const t = this._pos() - this.videoOffset + (this._paused ? 0 : 0.5 * (q[0].dur || 0.04));
    let idx = -1;
    while (idx + 1 < q.length && q[idx + 1].pts <= t + 0.0005) idx++;
    if (idx < 0) return;
    const f = q[idx];
    if (idx > 0) { this.st.dropped += idx; if (this._cur && f.pts - this._cur.pts > 2.5 * f.dur) this.st.droppedLate += idx; }
    q.splice(0, idx + 1);
    this._cur = f; this._serial++;
    this.st.shown++;
    this._pump();
  }

  // Сообщаем воркеру, докуда декодировать
  _pump() {
    if (this._seeking || this._disposed) return;
    const t = this._pos();
    const want = t + this._ahead();
    const dur = this.fv.frameDur || 0.04;
    if (want > this._until + 0.5 * dur || (this._queue.length < 2 && want > this._until)) {
      this._until = want;
      this._worker.postMessage({type: 'until', gen: this._gen, until: want, clock: t});
    }
  }

  _tick() {
    if (this._disposed) return;
    this._advance();
    this._pump();
    if (this._seeking) return;
    const t = this._pos();
    if (!this._paused) {
      const now = performance.now();
      if (now - this._lastTimeupdate >= 250) { this._lastTimeupdate = now; this._fire('timeupdate'); }
      if (t >= this._endTime() - 1e-6 && this._queue.length === 0 && (Number.isFinite(this._eofEnd) || (Number.isFinite(this._dur) && t >= this._dur))) this._finish();
      else if (this._queue.length === 0 && !Number.isFinite(this._eofEnd)) this.st.starved++;
    }
  }

  _finish() {
    if (this._ended) return;
    this._base = Math.min(this._pos(), this._endTime());
    this._paused = true;
    this._ended = true;
    this._fire('timeupdate');
    this._fire('pause');
    this._fire('ended');
  }

  // ------------------------------------------------------------------ служебное
  _fire(name) {
    if (this._disposed && name !== 'emptied') return;
    try { this.dispatchEvent(new Event(name)); } catch (e) { console.error('filmvideo: обработчик', name, e); }
  }

  _dispose() {
    if (this._disposed) return;
    clearInterval(this._timer);
    this._fire('emptied');
    this._disposed = true;
    this._queue = []; this._cur = null;
    for (const p of this._playWaiters) p.rej(new Error('filmvideo закрыт'));
    this._playWaiters = [];
  }
}
