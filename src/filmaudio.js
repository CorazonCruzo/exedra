// filmaudio.js — звук фильма, который Chrome сам не умеет проигрывать (AC-3, E-AC-3, DTS, TrueHD, ...).
//
// Звук декодирует FFmpeg (libav.js, WebAssembly, LGPL) в воркере; файл читается кусками через
// File.slice(), целиком в память не попадает. Главный поток получает готовое стерео и ставит его
// в очередь AudioContext, следуя за <video> (play/pause/seek/ratechange). Подробности и порядок
// подключения — docs/filmaudio-test/INTEGRATION.md.
//
//   const fa = await openFilmAudio(file);       // { duration, tracks:[{index,codec,lang,title,channels,isDefault,...}], defaultTrack, close(), attach() }
//   const need = needsOwnAudio(fa, video);        // { needed, reason, codec } — решение по кодеку, детерминированно
//   if (need.needed) {
//     video.muted = true;                         // своё звучит вместо родного
//     const player = fa.attach({ctx, video, track: fa.defaultTrack, destination});
//     player.setTrack(i); player.setVolume(0.8); player.dispose();
//   } else fa.close();
//
// Субтитры (тот же файл, тот же воркер; со звуком пакеты субтитров идут попутно, без второго чтения):
//   fa.subtitles                                   // [{index, streamIndex, codec, lang, title, isDefault, forced, kind:"text"|"bitmap"}]
//   const w = fa.watchSubtitles({video, track: pickDefaultSubtitle(fa.subtitles), onChange: (lines, rich) => ...});
//   w.setTrack(i) / w.setOffset(sec) / w.dispose();
//   внешние файлы: const {cues} = await parseSubtitleFile(file); const w2 = watchCues({video, cues, onChange});

import {CueTimeline, CueFollower} from './filmsubs.js';
import {NATIVE_CONTAINERS} from './filmsniff.js';
export {parseSubtitleFile, watchCues, parseSRT, parseVTT, parseASS, cleanCueText, decodeSubtitleBytes} from './filmsubs.js';

const NATIVE_CODECS = {            // что Chrome играет сам (в подходящих контейнерах), с «пробной» строкой для canPlayType
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mpeg',
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/webm; codecs="vorbis"',
  flac: 'audio/flac',
};

const LANG3 = {   // двухбуквенный код -> трёхбуквенные (ISO 639-2, обе формы)
  ru: ['rus'], en: ['eng'], uk: ['ukr'], be: ['bel'], de: ['ger', 'deu'], fr: ['fre', 'fra'], es: ['spa'],
  it: ['ita'], pt: ['por'], pl: ['pol'], cs: ['cze', 'ces'], sk: ['slo', 'slk'], ja: ['jpn'], zh: ['chi', 'zho'],
  ko: ['kor'], tr: ['tur'], nl: ['dut', 'nld'], sv: ['swe'], fi: ['fin'], no: ['nor', 'nob', 'nno'], nb: ['nor', 'nob'],
  da: ['dan'], hu: ['hun'], ro: ['rum', 'ron'], el: ['gre', 'ell'], he: ['heb'], ar: ['ara'], hi: ['hin'],
  bg: ['bul'], sr: ['srp'], hr: ['hrv'], kk: ['kaz'], ka: ['geo', 'kat'], hy: ['arm', 'hye'], az: ['aze'],
  lv: ['lav'], lt: ['lit'], et: ['est'], uz: ['uzb'], ca: ['cat'], vi: ['vie'], th: ['tha'], id: ['ind'],
};

function langMatches(tag, pref) {
  tag = (tag || '').toLowerCase();
  pref = (pref || '').toLowerCase().split('-')[0];
  if (!tag || !pref) return false;
  if (tag === pref || tag.split('-')[0] === pref) return true;
  const t3 = LANG3[pref];
  return !!t3 && t3.includes(tag.split('-')[0]);
}

// Какую дорожку включить: помеченную в контейнере как основную, если её язык — среди языков браузера (автор файла выбрал её; у «en-RU, ru-RU…»
// первая же «en» уводила бы с основного русского дубляжа на английскую дорожку); иначе первую с языком браузера по порядку, иначе основную, иначе первую.
export function pickDefaultTrack(tracks, languages) {
  if (!tracks.length) return -1;
  const prefs = languages || (typeof navigator !== 'undefined'
    ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : []);
  const main = tracks.findIndex((t) => t.isDefault);
  if (main >= 0 && prefs.some((p) => langMatches(tracks[main].lang, p))) return main;
  for (const p of prefs) {
    const i = tracks.findIndex((t) => langMatches(t.lang, p));
    if (i >= 0) return i;
  }
  const d = tracks.findIndex((t) => t.isDefault);
  return d >= 0 ? d : 0;
}

/**
 * Какие субтитры включить сами. Правило: по умолчанию — НИКАКИХ (-1). Включаем дорожку, только если одновременно
 *   1) она текстовая (kind === 'text': картинки PGS/DVD/DVB мы не рисуем),
 *   2) автор файла пометил её «по умолчанию» (isDefault) или «принудительной» (forced), и
 *   3) её язык — среди языков браузера (navigator.languages; «ru» подходит к «rus», «en-US» к «eng»).
 * Из подходящих берём ту, чей язык раньше в списке языков браузера; при равенстве — «по умолчанию» (полные субтитры)
 * раньше «принудительной» (только иноязычные реплики), потом по порядку в файле.
 */
export function pickDefaultSubtitle(subs, languages) {
  const prefs = languages || (typeof navigator !== 'undefined'
    ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : []);
  let best = -1, bestKey = null;
  (subs || []).forEach((t, i) => {
    if (t.kind !== 'text' || !(t.isDefault || t.forced)) return;
    const li = prefs.findIndex((p) => langMatches(t.lang, p));
    if (li < 0) return;
    const key = [li, t.isDefault && !t.forced ? 0 : t.isDefault ? 1 : 2, i];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = i; bestKey = key; }
  });
  return best;
}

// Какие видеокодеки умеет показывать наш декодер (filmvideo.js, vendor/libav) и как проверять их родную поддержку в браузере
const OWN_VIDEO_CODECS = new Set(['mpeg4', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'wmv1', 'wmv2', 'h263', 'h263p', 'mjpeg', 'mpeg1video',
  'mpeg2video', 'dvvideo', 'h264', 'cinepak', 'msvideo1']);
const H264_PROFILE = {66: '42', 77: '4d', 88: '58', 100: '64', 110: '6e', 122: '7a', 244: 'f4'};
function nativeVideoProbe(codec, info) {
  switch (codec) {
    case 'h264': {
      const p = H264_PROFILE[info.videoProfile !== undefined ? info.videoProfile : info.profile] || '64';
      const lv = info.videoLevel !== undefined ? info.videoLevel : info.level;
      const l = (lv > 0 && lv < 256 ? lv : 40).toString(16).padStart(2, '0');
      return 'video/mp4; codecs="avc1.' + p + '00' + l + '"';
    }
    case 'hevc': return 'video/mp4; codecs="hvc1.1.6.L93.B0"';
    case 'vp8': return 'video/webm; codecs="vp8"';
    case 'vp9': return 'video/webm; codecs="vp09.00.10.08"';
    case 'av1': return 'video/mp4; codecs="av01.0.05M.08"';
    case 'theora': return 'video/ogg; codecs="theora"';
    default: return null;                       // MPEG-4 Part 2, MPEG-2, MJPEG, DV, H.263 ...: Chrome их не играет ни в каком контейнере
  }
}

/**
 * Нужен ли свой показ картинки (filmvideo.js) вместо <video>. Решение детерминированное: по контейнеру (по первым байтам файла),
 * кодеку, который назвал наш демуксер, и по canPlayType браузера.
 * info — fa (после openFilmAudio) или fv (после openFilmVideo): { format, videoCodec | codec, videoProfile | profile, videoLevel | level }.
 * Возвращает { needed, canDecode, reason, codec, format }: needed — <video> не справится; canDecode — наша сборка кодек знает.
 */
export function needsOwnVideo(info, video) {
  const codec = info.videoCodec !== undefined ? info.videoCodec : info.codec;
  const format = info.format || '';
  if (!codec) return {needed: false, canDecode: false, reason: 'в файле нет видео', codec: null, format};
  const canDecode = OWN_VIDEO_CODECS.has(codec);
  if (!NATIVE_CONTAINERS.has(format)) {
    return {needed: true, canDecode, reason: 'контейнер ' + (format || 'неизвестный') + ' браузер не открывает', codec, format};
  }
  const probe = nativeVideoProbe(codec, info);
  if (!probe) return {needed: true, canDecode, reason: 'кодек ' + codec + ' браузер не воспроизводит', codec, format};
  const el = video && !video.ownVideo && video.canPlayType ? video : (typeof document !== 'undefined' ? document.createElement('video') : null);
  const answer = el && el.canPlayType ? el.canPlayType(probe) : 'probably';
  if (!answer) {
    return {needed: true, canDecode, reason: 'браузер не заявляет поддержку ' + codec, codec, format};
  }
  return {needed: false, canDecode, reason: 'кодек ' + codec + ' играет сам браузер', codec, format};
}

// Нужен ли наш декодер для этой дорожки. Решение детерминированное: по кодеку, который
// назвал наш собственный демуксер, и по canPlayType браузера — без таймеров и догадок.
export function needsOwnAudio(fa, video, track) {
  const i = track === undefined ? fa.defaultTrack : track;
  const t = fa.tracks[i];
  if (!t) return {needed: false, reason: 'в файле нет звуковых дорожек', codec: null};
  if (video && video.ownVideo) return {needed: true, reason: 'картинку показывает filmvideo (своё «видео»): родного звука у него нет', codec: t.codec};
  const probe = NATIVE_CODECS[t.codec];
  if (!probe) return {needed: true, reason: 'кодек ' + t.codec + ' браузер не воспроизводит', codec: t.codec};
  const el = video || (typeof document !== 'undefined' ? document.createElement('video') : null);
  if (el && el.canPlayType && !el.canPlayType(probe)) {
    return {needed: true, reason: 'браузер не заявляет поддержку ' + t.codec, codec: t.codec};
  }
  if (i !== 0 && fa.tracks.length > 1) {
    // в браузере играет только одна дорожка (первая); чужую можно включить только своим звуком
    return {needed: true, reason: 'выбрана не первая из ' + fa.tracks.length + ' дорожек: родной звук играет только первую', codec: t.codec};
  }
  return {needed: false, reason: 'кодек ' + t.codec + ' играет сам браузер', codec: t.codec};
}

// Запасная проверка «на слух» для файлов, где canPlayType соврал: если <video> со звуком в
// браузере играет уже секунду, а декодировано ноль байт звука — зовёт cb(). Возвращает функцию отмены.
export function watchNativeAudio(video, cb, afterMs = 1500) {
  let timer = 0, done = false;
  const check = () => {
    timer = 0;
    if (done) return;
    if (video.paused || video.muted || video.volume === 0) { timer = setTimeout(check, afterMs); return; }
    if (typeof video.webkitAudioDecodedByteCount === 'number' && video.webkitAudioDecodedByteCount === 0 && video.currentTime > 0.5) {
      done = true; cb();
    } else if (video.webkitAudioDecodedByteCount > 0) done = true;
    else timer = setTimeout(check, afterMs);
  };
  const onPlaying = () => { if (!timer && !done) timer = setTimeout(check, afterMs); };
  video.addEventListener('playing', onPlaying);
  if (!video.paused) onPlaying();
  return () => { done = true; clearTimeout(timer); video.removeEventListener('playing', onPlaying); };
}

export async function openFilmAudio(file, options = {}) {
  if (!(file instanceof Blob)) throw new TypeError('openFilmAudio: нужен File или Blob');
  const worker = new Worker(options.workerUrl || new URL('./filmaudio-worker.js', import.meta.url), {type: 'module'});
  const fa = new FilmAudio(worker, file);
  let timer;
  try {
    await Promise.race([fa._opened, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('filmaudio: файл не открылся за ' + (options.timeoutMs || 30000) / 1000 + ' с')), options.timeoutMs || 30000); })]);
  } catch (e) {
    worker.terminate();
    throw e;
  } finally { clearTimeout(timer); }
  return fa;
}

class FilmAudio {
  constructor(worker, file) {
    this.file = file;
    this._worker = worker;
    this._player = null;
    this._closed = false;
    this._workerStats = null;
    this._subWatch = null;
    this._opened = new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'opened') {
          const info = m.info;
          this.duration = info.duration;
          this.tracks = info.tracks;
          this.subtitles = info.subtitles || [];
          this.container = info.container;
          this.hasVideo = info.hasVideo;
          this.videoTrc = info.videoTrc;
          this.format = info.format;                 // контейнер по первым байтам: matroska | mov | avi | mpegps | mpegts | ogg | asf | flv | other
          this.videoCodec = info.videoCodec;         // кодек первого видеопотока ('' — видео нет)
          this.videoProfile = info.videoProfile; this.videoLevel = info.videoLevel;
          this.defaultTrack = pickDefaultTrack(info.tracks);
          this.openInfo = {openMs: info.openMs, bytesRead: info.bytesRead, reads: info.reads, size: info.size};
          worker.onmessage = (e) => this._onMessage(e.data);
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

  _onMessage(m) {
    if (m.type === 'tick') this._workerStats = m.stats;
    if (this._player) this._player._onWorker(m);
    if (this._subWatch) this._subWatch._onWorker(m);
  }

  /** Привязать звук к ctx и <video>. Одновременно — один плеер на файл. */
  attach(opts) {
    if (this._closed) throw new Error('filmaudio закрыт');
    if (this._player) this._player.dispose();
    this._player = new Player(this, opts);
    return this._player;
  }

  needsOwnAudio(video, track) { return needsOwnAudio(this, video, track); }

  /** Нужен ли свой показ картинки (filmvideo.js) вместо <video>: { needed, canDecode, reason, codec, format } */
  needsOwnVideo(video) { return needsOwnVideo(this, video); }

  /**
   * Субтитры, вшитые в файл. { video, track?, onChange(lines, rich), ahead?, lookback?, offset? } -> { setTrack(i), setOffset(sec), dispose() }.
   * track — номер в fa.subtitles (-1 или картинка — ничего не показывать). Один наблюдатель на файл. Работает и со звуком (fa.attach), и без него.
   */
  watchSubtitles(opts) {
    if (this._closed) throw new Error('filmaudio закрыт');
    if (this._subWatch) this._subWatch.dispose();
    this._subWatch = new SubWatch(this, opts);
    return this._subWatch;
  }

  /** Статистика воркера: прочитано байт, время декодирования на секунду звука. */
  stats() {
    const s = this._workerStats || {};
    const sec = s.audioSec || 0;
    return {
      bytesRead: s.bytesRead || this.openInfo.bytesRead, reads: s.reads || this.openInfo.reads,
      audioSec: sec, decodeMs: s.decodeMs || 0, mixMs: s.mixMs || 0, readMs: s.readMs || 0, errors: s.errors || 0,
      // сколько миллисекунд работы воркера уходит на секунду звука (без ожидания диска)
      cpuMsPerAudioSec: sec ? (s.decodeMs + s.mixMs) / sec : 0,
      readMsPerAudioSec: sec ? s.readMs / sec : 0,
      fileSize: this.file.size,
    };
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._subWatch) this._subWatch.dispose();
    if (this._player) this._player.dispose();
    try { this._worker.postMessage({type: 'close'}); } catch (e) { /* ignore */ }
    setTimeout(() => this._worker.terminate(), 50);
  }
}

// ---------------------------------------------------------------------------------------------
const HARD_RESYNC = 0.060;     // рассинхрон, при котором звук пересобирается с нуля, с
const DEADBAND = 0.004;        // ниже этого подстройку скоростью не включаем, с
const SLEW_MAX = 0.004;        // максимальная подстройка скорости (0,4 % ≈ 7 центов), доля
const START_LEAD = 0.03;       // запас при (пере)запуске, с
const HORIZON = 0.5;           // насколько вперёд ставим куски в очередь AudioContext, с
const HORIZON_HIDDEN = 3.0;    // то же во вкладке в фоне (таймеры замедляются)

class Player {
  constructor(fa, {ctx, video, track, destination, ahead = 3, offset = 0, onError}) {
    this.onError = onError;
    this.fa = fa; this.ctx = ctx; this.video = video;
    this.track = track === undefined ? fa.defaultTrack : track;
    this.ahead = ahead;          // на сколько секунд вперёд декодировать
    this.offset = offset;        // задержка звука относительно картинки, с (> 0 — звук позже)
    this.disposed = false;
    this.running = false;
    this.lastRestartAt = 0;
    this.volume = 1;
    this._tTrigger = performance.now();

    this.out = ctx.createGain();
    this.out.connect(destination || ctx.destination);

    // очередь декодированного
    this.gen = 0;
    this.chunks = [];
    this.winStart = 0;
    this.decodedEnd = 0;
    this.lastUntil = 0;
    this.eof = false;

    // планирование
    this.epoch = null;
    this.cursor = 0;
    this.nextWhen = null;
    this.sched = [];

    // оценка часов видео
    this._clockOff = null;
    this._clockN = 0;
    this._armed = false; this._moving = false; this._vt0 = 0;

    // статистика
    this.st = {underruns: 0, resyncs: 0, hardResyncs: 0, restarts: 0, chunks: 0, driftSamples: [], driftNow: NaN,
      driftAbsMax: 0, driftSum: 0, driftCount: 0, slewing: false, lastError: null, resyncLog: []};

    this._ev = ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange', 'ended', 'emptied', 'stalled', 'canplay']
      .map((n) => { const f = () => this._evaluate(n); this.video.addEventListener(n, f); return [n, f]; });
    this._onState = () => this._evaluate('statechange');
    ctx.addEventListener('statechange', this._onState);
    this._evaluate('attach');
    this._feed(true);
  }

  // ------------------------------------------------------------------ публичное
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.volume, t, 0.015);
  }

  setTrack(i) {
    if (this.disposed || i === this.track || !this.fa.tracks[i]) return;
    this.track = i;
    this._endEpoch();
    this.running = false;
    this._restartWorker(this._videoNow());
    this._evaluate('track');
  }

  /** Сдвиг звука относительно картинки, секунды (> 0 — звук позже). */
  setOffset(sec) { this.offset = +sec || 0; if (this.running) this._resync('offset'); }

  get active() { return this.running; }

  stats() {
    const vt = this.video.currentTime;
    const ws = this.fa.stats();
    const s = this.st;
    return {
      running: this.running, driftMs: s.driftNow * 1000,
      driftAvgAbsMs: s.driftCount ? (s.driftSum / s.driftCount) * 1000 : NaN, driftMaxAbsMs: s.driftAbsMax * 1000,
      aheadSec: this.decodedEnd - vt, queuedChunks: this.chunks.length,
      underruns: s.underruns, resyncs: s.resyncs, hardResyncs: s.hardResyncs, restarts: s.restarts, slewing: s.slewing,
      worker: ws, lastError: s.lastError,
    };
  }

  resetDriftStats() {
    const s = this.st;
    s.driftSamples = []; s.driftAbsMax = 0; s.driftSum = 0; s.driftCount = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._endEpoch();
    for (const [n, f] of this._ev) this.video.removeEventListener(n, f);
    this.ctx.removeEventListener('statechange', this._onState);
    try { this.out.disconnect(); } catch (e) { /* ignore */ }
    this.chunks = [];
    if (this.fa._player === this) this.fa._player = null;
    if (!this.fa._closed) { try { this.fa._worker.postMessage({type: 'audioStop'}); } catch (e) { /* ignore */ } }   // демуксер освободился от звука
  }

  // ------------------------------------------------------------------ часы
  // Время сейчас, которое слышно в динамиках, в шкале AudioContext (учитывает задержку вывода)
  _audibleNow() {
    const ctx = this.ctx;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.performanceTime > 0 && ts.contextTime >= 0 && ts.contextTime <= ctx.currentTime + 0.05) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  // Сглаженные часы видео: currentTime у <video> может идти ступеньками, поэтому
  // усредняем смещение «время фильма − часы страницы» и дальше считаем по часам страницы.
  _videoNow() {
    const v = this.video;
    const rate = v.playbackRate || 1;
    const raw = v.currentTime;
    if (!this.running || v.paused || v.seeking) { this._clockOff = null; this._clockN = 0; return raw; }
    const tp = performance.now() / 1000;
    const off = raw - rate * tp;
    if (this._clockOff === null || this._clockRate !== rate) { this._clockOff = off; this._clockN = 1; this._clockRate = rate; }
    else {
      this._clockN++;
      const a = Math.max(0.05, 1 / this._clockN);
      // скачок больше 0,25 с — это уже не ступенька, а перемотка/пауза: берём как есть
      if (Math.abs(off - this._clockOff) > 0.25) { this._clockOff = off; this._clockN = 1; }
      else this._clockOff += (off - this._clockOff) * a;
    }
    return rate * tp + this._clockOff;
  }

  _whenFor(m, vt, rate) { return this._audibleNow() + (m + this.offset - vt) / rate; }
  _mediaAtWhen(w, vt, rate) { return vt + (w - this._audibleNow()) * rate - this.offset; }

  // ------------------------------------------------------------------ состояние
  _evaluate(why) {
    if (this.disposed) return;
    const v = this.video, ctx = this.ctx;
    if (why === 'seeking' || why === 'play' || why === 'playing') this._tTrigger = performance.now();
    // «часы видео пошли»: ждём, пока currentTime действительно сдвинется, иначе звук
    // стартует раньше картинки (currentTime стоит на месте до первого показанного кадра)
    const playable = !v.paused && !v.seeking && !v.ended && v.readyState >= 3;
    if (!playable) { this._armed = false; this._moving = false; }
    else if (!this._armed) { this._armed = true; this._vt0 = v.currentTime; this._moving = false; }
    else if (!this._moving && Math.abs(v.currentTime - this._vt0) > 0.0005) this._moving = true;
    if (why === 'seeking' || why === 'emptied') { this._endEpoch(); this.running = false; this._clockOff = null; }
    const want = this._moving && !v.paused && !v.seeking && !v.ended && v.readyState >= 3 && ctx.state === 'running' && v.playbackRate > 0;
    if (why === 'ratechange' && this.running) { this._resync('ratechange'); return; }
    if (want && !this.running) {
      this.running = true;
      this._clockOff = null; this._clockN = 0;
      this._resync(why);
    } else if (!want && this.running) {
      this.running = false;
      this._endEpoch();
    }
    if (why === 'seeked' || why === 'seeking' || why === 'attach' || why === 'canplay') this._feed(true);
  }

  // ------------------------------------------------------------------ воркер
  _restartWorker(m) {
    this.lastRestartAt = performance.now();
    this.gen++;
    this.chunks = [];
    this.decodedEnd = m; this.winStart = m;
    this.eof = false;
    this.lastUntil = m + this.ahead * (this.video.playbackRate || 1);
    this.st.restarts++;
    this.fa._worker.postMessage({type: 'start', gen: this.gen, track: this.track, time: m, until: this.lastUntil, outRate: this.ctx.sampleRate});
  }

  // Следим, чтобы нужный кусок фильма был (или вот-вот будет) декодирован
  _feed(force) {
    if (this.disposed) return;
    const v = this.video;
    const vt = v.seeking ? v.currentTime : (this.running ? this._videoNow() : v.currentTime);
    const rate = v.playbackRate || 1;
    const dur = this.fa.duration;
    if (dur && vt >= dur) return;
    const inWindow = this.gen > 0 && vt >= this.winStart - 0.05 && vt <= this.decodedEnd + 0.5;
    if (!inWindow || (force && this.gen === 0)) {
      this._restartWorker(vt);
      return;
    }
    const want = vt + this.ahead * rate;
    if (!this.eof && want > this.lastUntil + 0.4) {
      this.lastUntil = want;
      this.fa._worker.postMessage({type: 'until', gen: this.gen, until: want});
    }
    // выбрасываем сыгранное
    const keepFrom = vt - 1.5;
    let drop = 0;
    while (drop < this.chunks.length && this.chunks[drop].t + this.chunks[drop].n / this.chunks[drop].sr < keepFrom) drop++;
    if (drop) {
      this.chunks.splice(0, drop);
      this.winStart = this.chunks.length ? this.chunks[0].t : this.winStart;
    }
  }

  _onWorker(m) {
    if (this.disposed) return;
    if (m.type === 'chunk') {
      if (m.gen !== this.gen) return;
      this.chunks.push(m);
      this.st.chunks++;
      if (m.startMs !== undefined) this.st.workerStartMs = m.startMs;
      const end = m.t + m.n / m.sr;
      if (end > this.decodedEnd) this.decodedEnd = end;
      this._pump();
    } else if (m.type === 'eof') {
      if (m.gen === this.gen) { this.eof = true; this.decodedEnd = Math.max(this.decodedEnd, this.fa.duration || 0); }
    } else if (m.type === 'tick') {
      this._tick();
    } else if (m.type === 'error') {
      this.st.lastError = m.message;
      if (this.onError) { try { this.onError(m.message); } catch (e) { /* ignore */ } }
    }
  }

  _tick() {
    if (this.disposed) return;
    this._evaluate('tick');
    this._feed(false);
    if (this.running) { this._pump(); this._measure(); }
  }

  // ------------------------------------------------------------------ звук
  _beginEpoch() {
    const gate = this.ctx.createGain();
    gate.gain.value = 0;
    gate.connect(this.out);
    this.epoch = {gate, sources: [], first: true};
  }

  _endEpoch() {
    const e = this.epoch;
    this.epoch = null;
    this.sched = [];
    this.nextWhen = null;
    if (!e) return;
    const t = this.ctx.currentTime;
    try {
      e.gate.gain.cancelScheduledValues(t);
      e.gate.gain.setValueAtTime(e.gate.gain.value, t);
      e.gate.gain.linearRampToValueAtTime(0, t + 0.012);
    } catch (err) { /* ignore */ }
    for (const s of e.sources) { try { s.stop(t + 0.02); } catch (err) { /* ignore */ } }
    setTimeout(() => { try { e.gate.disconnect(); } catch (err) { /* ignore */ } }, 120);
  }

  // Сборка заново: ближайший слышимый момент -> время фильма, дальше ставим куски с этого места
  _resync(why) {
    this._endEpoch();
    if (!this.running) return;
    this.st.resyncs++;
    this.st.resyncLog.push([why, +(performance.now() / 1000).toFixed(3)]);
    if (this.st.resyncLog.length > 100) this.st.resyncLog.shift();
    this._beginEpoch();
    const v = this.video;
    const rate = v.playbackRate || 1;
    const vt = this._videoNow();
    this.cursor = this._mediaAtWhen(this.ctx.currentTime + START_LEAD, vt, rate);
    this.nextWhen = null;
    this._feed(true);
    this._pump();
  }

  // кусок, в котором лежит время m (или ближайший следующий, если m попало в дырку)
  _chunkAt(m) {
    const cs = this.chunks;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (m < c.t + c.n / c.sr - 1e-4) return (c.t - m < 1.0) ? c : null;
    }
    return null;
  }

  // Ставит куски в очередь AudioContext на HORIZON секунд вперёд
  _pump() {
    if (!this.running || this.disposed || !this.epoch) return;
    const ctx = this.ctx;
    const v = this.video;
    const rate = v.playbackRate || 1;
    const horizon = ctx.currentTime + ((typeof document !== 'undefined' && document.hidden) ? HORIZON_HIDDEN : HORIZON);
    let guard = 0;
    while (guard++ < 64 && (this.nextWhen === null || this.nextWhen < horizon)) {
      if (!this._scheduleOne(rate)) break;
    }
  }

  _scheduleOne(rate) {
    const ctx = this.ctx;
    const vt = this._videoNow();
    const chunk = this._chunkAt(this.cursor);
    if (!chunk) {
      if (this.eof && this.cursor >= (this.fa.duration || Infinity) - 0.05) return false;
      // нужного куска ещё нет. Если играем уже давно — это недобор данных
      if (this.nextWhen !== null && this.nextWhen < ctx.currentTime) { this.st.underruns++; this.nextWhen = null; }
      return false;
    }
    const sr = chunk.sr;
    if (this.cursor < chunk.t) {           // дырка в декодированном: прыгаем вперёд, непрерывность теряем
      this.cursor = chunk.t;
      this.nextWhen = null;
    }
    let off = Math.round((this.cursor - chunk.t) * sr);
    if (off >= chunk.n) { this.cursor = chunk.t + chunk.n / sr; return true; }
    let when, k = 1;
    const desired = this._whenFor(this.cursor, vt, rate);
    if (this.nextWhen === null) {
      when = desired;
    } else {
      const e = this.nextWhen - desired;      // > 0: звук запаздывает относительно картинки
      if (Math.abs(e) > HARD_RESYNC) {
        this.st.hardResyncs++;
        this._resync('hard');
        return false;
      }
      when = this.nextWhen;
      if (Math.abs(e) > DEADBAND) {
        k = 1 + Math.max(-SLEW_MAX, Math.min(SLEW_MAX, e / 2));
        this.st.slewing = true;
      } else this.st.slewing = false;
    }
    // опоздали к началу — отрезаем начало куска
    const earliest = ctx.currentTime + 0.01;
    if (when < earliest) {
      const lateBy = earliest - when;
      const skip = Math.ceil(lateBy * rate * k * sr);
      if (this.nextWhen !== null) { this.nextWhen = null; this.st.underruns++; }
      off += skip;
      this.cursor += skip / sr;
      when += skip / (sr * rate * k);
      if (off >= chunk.n) { this.cursor = chunk.t + chunk.n / sr; return true; }
    }
    const n = chunk.n - off;
    const buf = ctx.createBuffer(2, n, sr);
    buf.copyToChannel(off ? chunk.L.subarray(off) : chunk.L, 0);
    buf.copyToChannel(off ? chunk.R.subarray(off) : chunk.R, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const pr = rate * k;
    if (pr !== 1) src.playbackRate.value = pr;
    const ep = this.epoch;
    src.connect(ep.gate);
    if (ep.first) {                          // плавное включение, чтобы не щёлкнуло
      ep.first = false;
      ep.gate.gain.cancelScheduledValues(0);
      ep.gate.gain.setValueAtTime(0, Math.max(0, when - 0.002));
      ep.gate.gain.linearRampToValueAtTime(1, when + 0.008);
    }
    src.start(when);
    if (ep.firstScheduled === undefined) {
      ep.firstScheduled = true;
      this.st.firstAudioMs = performance.now() - this._tTrigger;   // от перемотки/старта до первого поставленного звука
    }
    ep.sources.push(src);
    src.onended = () => { const i = ep.sources.indexOf(src); if (i >= 0) ep.sources.splice(i, 1); try { src.disconnect(); } catch (e) { /* ignore */ } };
    const dur = n / (sr * pr);
    this.sched.push({when, end: when + dur, m0: this.cursor, pr});
    if (this.sched.length > 40) this.sched.splice(0, this.sched.length - 40);
    this.cursor += n / sr;
    this.nextWhen = when + dur;
    return true;
  }

  // Реальный рассинхрон: какой момент фильма звучит прямо сейчас против часов видео
  _measure() {
    const x = this._audibleNow();
    const vt = this._videoNow();
    const s = this.sched;
    for (let i = s.length - 1; i >= 0; i--) {
      const e = s[i];
      if (x >= e.when && x < e.end) {
        const mAudio = e.m0 + (x - e.when) * e.pr;
        const d = (mAudio + this.offset) - vt;       // > 0: звук опережает картинку
        const st = this.st;
        st.driftNow = d;
        st.driftSum += Math.abs(d); st.driftCount++;
        if (Math.abs(d) > st.driftAbsMax) st.driftAbsMax = Math.abs(d);
        if (st.driftSamples.length < 20000) st.driftSamples.push([performance.now() / 1000, d]);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Субтитры из файла: реплики приходят от воркера по мере чтения, показ ведёт CueFollower (filmsubs.js)
let SUB_EPOCH = 0;               // общий счётчик: сообщения воркера о дорожке прежнего наблюдателя не должны попасть к новому
class SubWatch {
  constructor(fa, {video, track = -1, onChange, ahead = 3, lookback = 5, offset = 0}) {
    this.fa = fa; this.video = video;
    this.ahead = Math.max(2.6, ahead);       // звук читает на ~3 с вперёд; субтитры должны укладываться в это окно
    this.lookback = lookback;                 // на сколько секунд назад после перемотки подбираем начавшиеся раньше реплики
    this.timeline = new CueTimeline();
    this.follower = new CueFollower({video, timeline: this.timeline, onChange, offset});
    this.track = -1; this.epoch = 0; this.seq = 0; this.cov = null;
    this.sentAt = 0; this.lastSend = 0; this.disposed = false;
    this.stats = {requests: 0, cues: 0, staleRestarts: 0};
    this._ev = ['seeking', 'seeked', 'play', 'ratechange', 'loadeddata'].map((n) => { const f = () => this._request(true); video.addEventListener(n, f); return [n, f]; });
    this.setTrack(track);
  }

  /** номер дорожки в fa.subtitles; -1 — выключить */
  setTrack(i) {
    if (this.disposed) return;
    const t = this.fa.subtitles[i];
    this.track = t && t.kind === 'text' ? i : -1;
    this.epoch = ++SUB_EPOCH;
    this.cov = null;
    this.timeline.clear();
    this.follower.setEnabled(this.track >= 0);
    this._request(true);
  }
  setOffset(sec) { this.follower.setOffset(sec); this._request(true); }
  get offset() { return this.follower.offset; }

  _request(force) {
    if (this.disposed || this.fa._closed) return;
    const now = performance.now();
    if (!force && now - this.lastSend < 200) return;
    this.lastSend = this.sentAt = now;
    this.seq++;
    this.stats.requests++;
    const rate = Math.max(1, this.video.playbackRate || 1);
    this.fa._worker.postMessage({type: 'sub', epoch: this.epoch, seq: this.seq, track: this.track,
      time: this.follower.now(), ahead: this.ahead * rate, lookback: this.lookback});
  }

  _onWorker(m) {
    if (this.disposed) return;
    if (m.type === 'subcues') {
      if (m.epoch !== this.epoch) return;
      this.stats.cues += m.cues.length;
      if (this.timeline.add(m.cues)) this.follower.refresh('cues');
    } else if (m.type === 'tick') {
      if (!m.sub || m.sub.epoch !== this.epoch) return;
      this.cov = m.sub;
      const t = this.follower.now();
      if (this.track >= 0 && m.sub.covTo !== Infinity && !(t + this.ahead * 0.5 < m.sub.covTo)) this._request(false);
    } else if (m.type === 'substale') {
      // демуксер занят звуком, а субтитрам нужно другое место: перезапускаем звук оттуда (он заодно отмотает назад на lookback).
      // Если звук уже перезапускали после нашего запроса — это его перезапуск, ждём.
      if (m.epoch !== this.epoch || m.seq !== this.seq) return;
      const p = this.fa._player;
      if (p && !p.disposed && p.lastRestartAt < this.sentAt) {
        this.stats.staleRestarts++;
        p._restartWorker(p.running ? p._videoNow() : this.video.currentTime);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [n, f] of this._ev) this.video.removeEventListener(n, f);
    this.follower.dispose();
    if (this.fa._subWatch === this) this.fa._subWatch = null;
    if (!this.fa._closed) { try { this.fa._worker.postMessage({type: 'sub', epoch: -1, seq: 0, track: -1, time: 0, ahead: 0, lookback: 0}); } catch (e) { /* ignore */ } }
  }
}
