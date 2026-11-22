// filmaudio-worker.js — декодирует звук фильма (AC-3, E-AC-3, DTS, TrueHD, ...) через
// libav.js (FFmpeg, LGPL, WebAssembly) в отдельном потоке. Файл читается кусками
// через File.slice() — целиком в память не загружается. Результат — стерео float32
// кусками по ~0,25 с, уже приведённый к частоте AudioContext.
//
// Протокол (главный поток -> воркер):
//   {type:'open', file}                          -> {type:'opened', info}
//   {type:'start', gen, track, time, until, outRate}  начать (перемотать) декодирование
//   {type:'until', gen, until}                   декодировать дальше, до этой секунды фильма
//   {type:'audioStop'}                           звук больше не нужен (плеер снят); субтитры продолжают читаться
//   {type:'sub', epoch, seq, track, time, ahead, lookback}   нужны субтитры (номер в info.subtitles, -1 — не нужны)
//                                                для [time - lookback, time + ahead]; шлётся при смене дорожки, перемотке и по мере чтения
//   {type:'close'}
// Воркер -> главный поток:
//   {type:'chunk', gen, t, n, sr, L, R}  (L, R — Float32Array, переданы без копирования)
//   {type:'eof', gen}, {type:'tick', ...stats, sub}, {type:'error', gen, message}
//   {type:'subcues', epoch, cues:[{start,end,text,lines}]}   новые реплики (уже очищенный текст, см. filmsubs.js)
//   {type:'substale', epoch, seq}        субтитрам нужна перемотка, а демуксер занят звуком: главный поток перезапускает звук
//   tick.sub = {epoch, covFrom, covTo}   «все реплики, начинающиеся в [covFrom, covTo], уже отправлены»
//
// Субтитры и звук делят один демуксер: пока играет звук (audioOn), пакеты выбранной дорожки субтитров идут «попутно»
// с чтением звука, второго чтения файла нет. Без звука воркер сам читает вперёд только дорожку субтитров (в Matroska/AVI/TS —
// заодно проходя видеопоток без копирования данных: по его меткам времени он знает, докуда дочитал).

import LibAV from '../vendor/libav/libav-6.11.9.0.2-filmav.mjs';
import {makeCue} from './filmsubs.js';
import {sniffContainer as sniffFormat} from './filmsniff.js';

const AVMEDIA_TYPE_VIDEO = 0, AVMEDIA_TYPE_AUDIO = 1, AVMEDIA_TYPE_SUBTITLE = 3;
const AVDISCARD_DEFAULT = 0, AVDISCARD_ALL = 48;
const AVSEEK_FLAG_BACKWARD = 1, AVSEEK_FLAG_ANY = 4;
const CHUNK_SECONDS = 0.25;      // размер куска, отдаваемого главному потоку
const READ_LIMIT = 32 * 1024;    // сколько байт пакетов звука читать за один вызов demuxer
const BLOCK_SEQ = 1 << 20;       // размер чтения с диска при последовательном чтении
const BLOCK_RANDOM = 1 << 18;    // и при «прыжках» (индекс контейнера, перемотка)
const TEXT_SUB = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);   // остальные кодеки (PGS, DVD, DVB...) — картинки, без декодера
const SUB_SKEW = 0.5;            // с: на столько метки пакетов субтитров могут отставать от видео/звука в файле (у mkvmerge ≤ 0,25)
const SUB_FWD_GAP = 6;           // с: нужное время дальше конца прочитанного на столько — читаем вперёд, больше — перематываем

// Каналы FFmpeg (AV_CH_*), номер бита
const CH = {FL: 0, FR: 1, FC: 2, LFE: 3, BL: 4, BR: 5, FLC: 6, FRC: 7, BC: 8, SL: 9, SR: 10,
  TC: 11, TFL: 12, TFC: 13, TFR: 14, TBL: 15, TBC: 16, TBR: 17};
const DEFAULT_ORDER = {
  1: [CH.FC], 2: [CH.FL, CH.FR], 3: [CH.FL, CH.FR, CH.FC],
  4: [CH.FL, CH.FR, CH.BL, CH.BR], 5: [CH.FL, CH.FR, CH.FC, CH.BL, CH.BR],
  6: [CH.FL, CH.FR, CH.FC, CH.LFE, CH.BL, CH.BR],
  7: [CH.FL, CH.FR, CH.FC, CH.LFE, CH.BC, CH.SL, CH.SR],
  8: [CH.FL, CH.FR, CH.FC, CH.LFE, CH.BL, CH.BR, CH.SL, CH.SR],
};
const K = Math.SQRT1_2;
// коэффициенты в левый/правый канал (ITU-R BS.775: центр и тыловые — минус 3 дБ; LFE не смешивается)
const MIX = {
  [CH.FL]: [1, 0], [CH.FR]: [0, 1], [CH.FC]: [K, K], [CH.LFE]: [0, 0],
  [CH.BL]: [K, 0], [CH.BR]: [0, K], [CH.SL]: [K, 0], [CH.SR]: [0, K],
  [CH.FLC]: [0.8, 0], [CH.FRC]: [0, 0.8], [CH.BC]: [0.5, 0.5],
  [CH.TC]: [0.35, 0.35], [CH.TFL]: [0.5, 0], [CH.TFC]: [0.35, 0.35], [CH.TFR]: [0, 0.5],
  [CH.TBL]: [0.35, 0], [CH.TBC]: [0.25, 0.25], [CH.TBR]: [0, 0.35],
};
const SURROUND_GAIN = 1 / (1 + K); // запас по громкости, чтобы сумма каналов реже упиралась в 1.0

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const i64 = (lo, hi) => (hi | 0) * 4294967296 + (lo >>> 0);
const isNoPts = (lo, hi) => (hi | 0) === -2147483648 && (lo >>> 0) === 0;

// ---------------------------------------------------------------- состояние
let libav = null;
let file = null;
let fmtCtx = 0, demuxPkt = 0;
let streams = [];                // все потоки контейнера
let audioStreams = [];           // только звуковые (порядок = номер дорожки)
let isMatroska = false;
let containerFormat = 'other';   // тонкое определение контейнера (filmsniff.js)
let isMov = false;               // MP4/MOV: у каждой дорожки свой индекс, можно читать только субтитры, не трогая видео
let closed = false;

const stats = {bytesRead: 0, reads: 0, decodeMs: 0, mixMs: 0, readMs: 0, audioSec: 0, packets: 0, errors: 0};

// запрос от главного потока (применяется движком между шагами)
let req = null;                  // {gen, track, time, until, outRate} — ожидает применения
let gen = 0;
let until = 0;
let outRate = 48000;
let startT = 0;
let wakeResolve = null;

// текущая дорожка / декодер
let curTrack = -1, dec = null /* {c, pkt, frame} */, curStream = null, tbMul = 0;
let primeSec = 0.6;

// сессия декодирования
let sess = null;

// субтитры
let subInfo = [];                // то же, что info.subtitles
let subStreams = [];             // потоки субтитров контейнера (порядок = номер дорожки)
let sub = null;                  // выбранная дорожка: {epoch, idx, stream, info, tb, assSkip, covFrom, covTo, sent:Set, time, until, lookback, seq}
let subDirty = false;            // сменилась дорожка/режим: перенастроить потоки
let subCheck = false;            // проверить, что нужное время покрыто
let audioOn = false;             // идёт звуковая сессия (демуксер занят звуком)
const discardState = new Map();  // индекс потока -> true (читаем) / false (отбрасываем)

// ---------------------------------------------------------------- чтение файла блоками
let lastEnd = -1;
let prefetch = null;             // {pos, end, promise}

function fetchBlock(pos, len) {
  const end = Math.min(file.size, pos + len);
  return {pos, end, promise: file.slice(pos, end).arrayBuffer()};
}

async function onBlockRead(name, pos, length) {
  const sequential = pos === lastEnd;
  let blk;
  if (prefetch && prefetch.pos === pos) {
    blk = prefetch;
  } else {
    blk = fetchBlock(pos, Math.max(length, sequential ? BLOCK_SEQ : BLOCK_RANDOM));
  }
  prefetch = null;
  const buf = await blk.promise;
  stats.bytesRead += buf.byteLength;
  stats.reads++;
  lastEnd = blk.end;
  if (sequential && blk.end < file.size) prefetch = fetchBlock(blk.end, BLOCK_SEQ); // читаем следующий, пока декодируем этот
  await libav.ff_block_reader_dev_send(name, pos, new Uint8Array(buf));
}

// ---------------------------------------------------------------- открытие
async function sniffContainer() {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const mkv = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return {mkv, mov: !mkv && ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(box), format: sniffFormat(head)};
}

function layoutName(mask, n) {
  const names = {1: 'mono', 2: 'stereo', 3: '3.0', 4: '4.0', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1'};
  if (!mask) return names[n] || (n + 'ch');
  const hasLfe = (mask >>> 3) & 1;
  let top = 0;
  for (let b = 11; b <= 17; b++) if ((mask >>> b) & 1) top++;
  const base = n - hasLfe - top;
  return base + '.' + hasLfe + (top ? '.' + top : '');
}

async function open(f) {
  file = f;
  libav = await LibAV.LibAV({noworker: true, nothreads: true});
  await libav.mkblockreaderdev('input', file.size);
  libav.onblockread = onBlockRead;
  ({mkv: isMatroska, mov: isMov, format: containerFormat} = await sniffContainer());
  const t0 = performance.now();
  const [ctx, strs] = await libav.ff_init_demuxer_file('input');
  fmtCtx = ctx;
  streams = strs;
  demuxPkt = await libav.av_packet_alloc();
  const dur = i64(await libav.AVFormatContext_duration(ctx), await libav.AVFormatContext_durationhi(ctx)) / 1e6;
  audioStreams = streams.filter((s) => s.codec_type === AVMEDIA_TYPE_AUDIO);
  const tracks = [];
  for (let i = 0; i < audioStreams.length; i++) {
    const s = audioStreams[i];
    const cp = s.codecpar;
    const codec = await libav.avcodec_get_name(s.codec_id);
    const channels = await libav.AVCodecParameters_channels(cp);
    const mask = (await libav.AVCodecParameters_channel_layout(cp)) >>> 0;
    const md = s.metadata || {};
    const disp = await libav.AVStream_disposition(s.ptr);
    tracks.push({
      index: i,
      streamIndex: s.index,
      codec,
      lang: (md.language || md.LANGUAGE || '').toLowerCase(),
      title: md.title || md.TITLE || '',
      channels,
      layout: layoutName(mask, channels),
      sampleRate: await libav.AVCodecParameters_sample_rate(cp),
      isDefault: !!(disp & 1),
    });
  }
  subStreams = streams.filter((s) => s.codec_type === AVMEDIA_TYPE_SUBTITLE);
  subInfo = [];
  for (let i = 0; i < subStreams.length; i++) {
    const s = subStreams[i];
    const codec = await libav.avcodec_get_name(s.codec_id);
    const md = s.metadata || {};
    const disp = await libav.AVStream_disposition(s.ptr);
    subInfo.push({
      index: i, streamIndex: s.index, codec,
      lang: (md.language || md.LANGUAGE || '').toLowerCase(),
      title: md.title || md.TITLE || '',
      isDefault: !!(disp & 1), forced: !!(disp & 64),      // AV_DISPOSITION_DEFAULT = 1, AV_DISPOSITION_FORCED = 64
      kind: TEXT_SUB.has(codec) ? 'text' : 'bitmap',
    });
  }
  const hasVideo = streams.some((s) => s.codec_type === AVMEDIA_TYPE_VIDEO);
  // Передаточная функция картинки (16 — PQ, 18 — HLG): зал по ней узнаёт HDR-фильм и пересчитывает цвета экрана (cinema.js).
  const vs = streams.find((s) => s.codec_type === AVMEDIA_TYPE_VIDEO);
  const videoTrc = vs ? await libav.AVCodecParameters_color_trc(vs.codecpar) : 0;
  const videoCodec = vs ? await libav.avcodec_get_name(vs.codec_id) : '';
  const videoProfile = vs ? await libav.AVCodecParameters_profile(vs.codecpar) : 0;
  const videoLevel = vs ? await libav.AVCodecParameters_level(vs.codecpar) : 0;
  return {duration: dur > 0 ? dur : 0, tracks, subtitles: subInfo, container: isMatroska ? 'matroska' : 'other', hasVideo, videoTrc,
    format: containerFormat, videoCodec, videoProfile, videoLevel,
    openMs: performance.now() - t0, bytesRead: stats.bytesRead, reads: stats.reads, size: file.size};
}

// ---------------------------------------------------------------- дорожка и декодер
async function selectTrack(i) {
  if (dec) {
    await libav.ff_free_decoder(dec.c, dec.pkt, dec.frame);
    dec = null;
  }
  const s = audioStreams[i];
  if (!s) throw new Error('нет дорожки ' + i);
  const [, c, pkt, frame] = await libav.ff_init_decoder(s.codec_id, {
    codecpar: s.codecpar, time_base: [s.time_base_num, s.time_base_den],
  });
  dec = {c, pkt, frame};
  curStream = s;
  curTrack = i;
  tbMul = s.time_base_num / s.time_base_den;
  const name = await libav.avcodec_get_name(s.codec_id);
  primeSec = (name === 'truehd' || name === 'mlp') ? 4 : 0.6;
  await configureStreams();
}

// Какие потоки демуксер отдаёт: чужие (видео, другая озвучка, лишние субтитры) он отбрасывает сам — их пакеты не копируются в JS.
// Со звуком: звуковая дорожка + выбранные субтитры. Без звука: субтитры + (если контейнер читается подряд) видео как «часы» чтения.
function timeStream() {
  if (isMov) return null;                                  // MP4: пакеты субтитров идут по индексу сами, часы не нужны
  return streams.find((s) => s.codec_type === AVMEDIA_TYPE_VIDEO) || audioStreams[0] || null;
}
async function configureStreams() {
  const keep = new Set();
  if (audioOn && curStream) keep.add(curStream.index);
  if (sub) keep.add(sub.stream.index);
  if (!audioOn && sub) { const t = timeStream(); if (t) keep.add(t.index); }
  for (const o of streams) {
    const want = keep.has(o.index);
    if (discardState.get(o.index) === want) continue;
    await libav.AVStream_discard_s(o.ptr, want ? AVDISCARD_DEFAULT : AVDISCARD_ALL);
    discardState.set(o.index, want);
  }
}

async function seekTo(sec) {
  // Matroska: индекс (Cues) обычно есть только у видео; перемотка по звуковому потоку превращается
  // в линейное чтение файла (гигабайты). Поэтому в Matroska прыгаем по видео, если оно есть.
  const video = streams.find((s) => s.codec_type === AVMEDIA_TYPE_VIDEO);
  const order = [];
  if (isMatroska && video) order.push(video);
  if (audioOn && curStream) order.push(curStream);
  if (isMov && sub) order.push(sub.stream);                // MP4: точный индекс есть у самой дорожки субтитров
  if (video) order.push(video);
  if (sub) order.push(sub.stream);
  if (curStream) order.push(curStream);
  for (const st of [...new Set(order)]) {
    for (const flags of [AVSEEK_FLAG_BACKWARD, AVSEEK_FLAG_BACKWARD | AVSEEK_FLAG_ANY]) {
      const ts = Math.max(0, Math.round(sec / (st.time_base_num / st.time_base_den)));
      const r = await libav.av_seek_frame(fmtCtx, st.index, ts % 4294967296, Math.floor(ts / 4294967296), flags);
      if (r >= 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- микс, ресемплер
function popcount(x) { let n = 0; x >>>= 0; while (x) { n += x & 1; x >>>= 1; } return n; }

// список номеров каналов FFmpeg в порядке плоскостей кадра
function channelOrder(mask, n) {
  if (mask && popcount(mask) === n) {
    const order = [];
    for (let b = 0; b < 32; b++) if ((mask >>> b) & 1) order.push(b);
    return order;
  }
  return DEFAULT_ORDER[n] || DEFAULT_ORDER[2].slice(0, n);
}

const SCALE = {0: [128, 128], 1: [32768, 0], 2: [2147483648, 0], 3: [1, 0], 4: [1, 0],
  5: [128, 128], 6: [32768, 0], 7: [2147483648, 0], 8: [1, 0], 9: [1, 0]};

// плоскость i кадра как Float32Array (без копии, если уже float)
function plane(frame, i, nch, n) {
  const fmt = frame.format;
  const planar = fmt >= 5 && fmt <= 9;
  const src = planar ? frame.data[i] : frame.data;
  if (planar && fmt === 8) return src;
  const out = new Float32Array(n);
  const [div, off] = SCALE[fmt] || [1, 0];
  if (planar) {
    if (off) for (let k = 0; k < n; k++) out[k] = (src[k] - off) / div;
    else for (let k = 0; k < n; k++) out[k] = src[k] / div;
  } else if (off) {
    for (let k = 0, j = i; k < n; k++, j += nch) out[k] = (src[j] - off) / div;
  } else {
    for (let k = 0, j = i; k < n; k++, j += nch) out[k] = src[j] / div;
  }
  return out;
}

// Нормальный стерео-даунмикс. Возвращает [L, R]
function downmix(frame) {
  const n = frame.nb_samples;
  const nch = frame.channels || (frame.data.length) || 2;
  const mask = (frame.channel_layout || 0) >>> 0;
  const L = new Float32Array(n), R = new Float32Array(n);
  if (nch === 1) {
    const p = plane(frame, 0, 1, n);
    L.set(p); R.set(p);
    return [L, R];
  }
  if (nch === 2 && (!mask || mask === 3)) {
    L.set(plane(frame, 0, 2, n)); R.set(plane(frame, 1, 2, n));
    return [L, R];
  }
  const order = channelOrder(mask, nch);
  let sumL = 0;
  for (const b of order) { const m = MIX[b]; if (m) sumL += m[0]; }
  const g = sumL > 1.0001 ? SURROUND_GAIN : 1;
  for (let i = 0; i < nch; i++) {
    const m = MIX[order[i]];
    if (!m || (m[0] === 0 && m[1] === 0)) continue;
    const p = plane(frame, i, nch, n);
    const cl = m[0] * g, cr = m[1] * g;
    if (cl) for (let k = 0; k < n; k++) L[k] += p[k] * cl;
    if (cr) for (let k = 0; k < n; k++) R[k] += p[k] * cr;
  }
  return [L, R];
}

// мягкое ограничение пиков (иначе сумма каналов обрезается на выходе звуковой карты)
function softLimit(a) {
  const T = 0.92, W = 1 - T;
  for (let k = 0; k < a.length; k++) {
    const x = a[k], ax = x < 0 ? -x : x;
    if (ax > T) a[k] = (x < 0 ? -1 : 1) * (T + W * Math.tanh((ax - T) / W));
  }
}

// Ресемплер: полифазный sinc с окном Кайзера, запоминает хвост между кадрами (без щелчков на стыках)
class Resampler {
  constructor(inRate, outRate) {
    this.ratio = inRate / outRate;
    const H = this.H = 24, P = this.P = 1024;
    const fc = Math.min(1, outRate / inRate) * 0.985;
    const beta = 8.5;
    const bessel = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; };
    const b0 = bessel(beta);
    const taps = 2 * H;
    this.table = new Float32Array((P + 1) * taps);
    for (let p = 0; p <= P; p++) {
      const frac = p / P;
      let sum = 0;
      for (let j = 0; j < taps; j++) {
        const x = (j - H + 1) - frac;           // расстояние от точки отсчёта
        const w = Math.abs(x) < H ? bessel(beta * Math.sqrt(1 - (x / H) * (x / H))) / b0 : 0;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x);
        const v = fc * sinc * w;
        this.table[p * taps + j] = v;
        sum += v;
      }
      for (let j = 0; j < taps; j++) this.table[p * taps + j] /= sum;
    }
    this.reset();
  }
  reset() {
    this.histL = new Float32Array(this.H * 2);   // нули до начала потока
    this.histR = new Float32Array(this.H * 2);
    this.pos = this.H * 2;                        // позиция следующего выходного отсчёта: входной отсчёт 0
  }
  // подаёт L, R; возвращает [outL, outR]
  process(L, R) {
    const H = this.H, taps = 2 * H, P = this.P;
    const bufL = new Float32Array(this.histL.length + L.length);
    const bufR = new Float32Array(this.histR.length + R.length);
    bufL.set(this.histL); bufL.set(L, this.histL.length);
    bufR.set(this.histR); bufR.set(R, this.histR.length);
    const outN = Math.max(0, Math.ceil((bufL.length - H - this.pos) / this.ratio));
    const oL = new Float32Array(outN), oR = new Float32Array(outN);
    let pos = this.pos, n = 0;
    const tbl = this.table;
    while (pos + H < bufL.length && n < outN) {
      let i0 = Math.floor(pos);
      let ph = Math.round((pos - i0) * P);
      const base = ph * taps;
      const s0 = i0 - H + 1;
      let aL = 0, aR = 0;
      for (let j = 0; j < taps; j++) {
        const w = tbl[base + j];
        aL += bufL[s0 + j] * w;
        aR += bufR[s0 + j] * w;
      }
      oL[n] = aL; oR[n] = aR; n++;
      pos += this.ratio;
    }
    // оставляем хвост (2H последних отсчётов) для следующего вызова
    const keepFrom = Math.max(0, Math.floor(pos) - H + 1);
    this.histL = bufL.slice(keepFrom);
    this.histR = bufR.slice(keepFrom);
    this.pos = pos - keepFrom;
    return n === outN ? [oL, oR] : [oL.subarray(0, n), oR.subarray(0, n)];
  }
}

// ---------------------------------------------------------------- сессия декодирования
// Время входа и выхода считаются по числу отсчётов от «якорей»: метки кадров (pts) в Matroska
// округлены до миллисекунды, и по ним нельзя собирать непрерывный поток. Якорь переставляется
// только при настоящем разрыве (> 80 мс) и после перемотки.
function newSession(startTime) {
  return {
    start: startTime,
    inAnchor: null,     // время фильма входного отсчёта 0 текущего сегмента
    inCount: 0,         // входных отсчётов с начала сегмента
    outAnchor: null,    // время фильма выходного отсчёта 0 (после обрезки до точки перемотки)
    outCount: 0,        // выходных отсчётов, уже отданных главному потоку с начала сегмента
    resampler: null, resamplerRate: 0,
    accL: [], accR: [], accN: 0, accT: 0,
    posEnd: startTime,  // до какого времени фильма всё отдано
    eof: false, readErrors: 0,
  };
}

function flushAcc(force) {
  const s = sess;
  if (!s || !s.accN) return;
  if (!force && s.accN < CHUNK_SECONDS * outRate) return;
  const L = new Float32Array(s.accN), R = new Float32Array(s.accN);
  let o = 0;
  for (let i = 0; i < s.accL.length; i++) { L.set(s.accL[i], o); R.set(s.accR[i], o); o += s.accL[i].length; }
  softLimit(L); softLimit(R);
  const t = s.accT;
  const startMs = s.firstSent ? undefined : performance.now() - s.recv;   // от команды «начать» до первого звука
  s.firstSent = true;
  post({type: 'chunk', gen, t, n: s.accN, sr: outRate, L, R, startMs}, [L.buffer, R.buffer]);
  s.posEnd = t + s.accN / outRate;
  s.outCount += s.accN;
  s.accL = []; s.accR = []; s.accN = 0;
}

// добавить стерео-отсчёты (уже на частоте outRate) в копилку
function pushOut(L, R) {
  const s = sess;
  if (!L.length) return;
  if (!s.accN) s.accT = s.outAnchor + s.outCount / outRate;
  s.accL.push(L); s.accR.push(R); s.accN += L.length;
  flushAcc(false);
}

function handleFrame(frame) {
  const s = sess;
  const sr = frame.sample_rate || 48000;
  const n = frame.nb_samples;
  if (!n) return;
  let ft = NaN;
  if (frame.pts !== undefined && !isNoPts(frame.pts, frame.ptshi || 0)) ft = i64(frame.pts, frame.ptshi || 0) * tbMul;
  if (s.inAnchor === null) {
    s.inAnchor = Number.isFinite(ft) ? ft : s.start;
    s.inCount = 0;
  } else if (Number.isFinite(ft) && Math.abs(ft - (s.inAnchor + s.inCount / sr)) > 0.08) {
    flushAcc(true);                                // разрыв: закрываем текущий сегмент
    s.inAnchor = ft; s.inCount = 0; s.outAnchor = null; s.resampler = null;
  }
  const frameStart = s.inAnchor + s.inCount / sr;
  s.inCount += n;
  if (frameStart + n / sr <= s.start) return;      // целиком до точки перемотки
  const t0 = performance.now();
  let [L, R] = downmix(frame);
  let skip = 0;
  if (frameStart < s.start) {
    skip = Math.min(n, Math.round((s.start - frameStart) * sr));
    L = L.subarray(skip); R = R.subarray(skip);
  }
  if (!L.length) return;
  if (s.outAnchor === null) {                      // начало сегмента звука
    s.outAnchor = frameStart + skip / sr;
    s.outCount = 0;
    s.resampler = null;
  }
  if (sr !== outRate) {
    if (!s.resampler || s.resamplerRate !== sr) { s.resampler = new Resampler(sr, outRate); s.resamplerRate = sr; }
    [L, R] = s.resampler.process(L, R);
  }
  stats.mixMs += performance.now() - t0;
  stats.audioSec += n / sr;
  pushOut(L, R);
}

async function decodePackets(pkts) {
  if (!pkts.length) return;
  const t0 = performance.now();
  let frames;
  try {
    frames = await libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, pkts, {ignoreErrors: true});
  } catch (e) {
    stats.errors++;
    return;
  }
  stats.decodeMs += performance.now() - t0;
  for (const f of frames) {
    if (req) return;                               // пришла новая команда — выбрасываем старое
    handleFrame(f);
  }
}

async function step() {
  const t0 = performance.now();
  const [res, pk] = await libav.ff_read_frame_multi(fmtCtx, demuxPkt, {limit: READ_LIMIT});
  stats.readMs += performance.now() - t0;
  if (req) return;
  const si = curStream.index;
  const all = pk[si] || [];
  const pkts = [];
  const minPts = (sess.start - primeSec);
  let lastT = NaN;
  for (const p of all) {
    stats.packets++;
    if (p.stream_index !== undefined && p.stream_index !== si) continue;
    const t = isNoPts(p.pts || 0, p.ptshi || 0) ? NaN : i64(p.pts, p.ptshi || 0) * tbMul;
    if (Number.isFinite(t) && !(t < lastT)) lastT = t;
    // пакеты задолго до точки перемотки не декодируем (нужен только «разгон» декодера)
    if (Number.isFinite(t) && t < minPts) continue;
    pkts.push(p);
  }
  // субтитры идут попутно: реплики выбранной дорожки + «докуда дочитали» по меткам времени звука
  if (sub && sub.covFrom === sub.covFrom) {
    const sp = pk[sub.stream.index];
    if (sp) handleSubPackets(sp);
    if (Number.isFinite(lastT)) sub.covTo = Math.max(sub.covTo, lastT - SUB_SKEW);
    if (res === libav.AVERROR_EOF) sub.covTo = Infinity;
  }
  await decodePackets(pkts);
  if (res === libav.AVERROR_EOF) {
    if (!req) {
      try { await libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, [], {fin: true, ignoreErrors: true}).then((fr) => fr.forEach(handleFrame)); } catch (e) { /* ignore */ }
      if (sess.resampler && sess.outAnchor !== null) {
        const z = new Float32Array(sess.resampler.H * 2);
        const [l, r] = sess.resampler.process(z, z);
        pushOut(l, r);
      }
      flushAcc(true);
      sess.eof = true;
      post({type: 'eof', gen});
    }
  } else if (res < 0 && res !== -libav.EAGAIN) {
    stats.errors++;
    if (++sess.readErrors > 50) { sess.eof = true; post({type: 'error', gen, message: 'ошибка чтения: ' + res}); }
  }
}

async function applyStart(r) {
  gen = r.gen;
  outRate = r.outRate;
  startT = Math.max(0, r.time);
  audioOn = true;
  if (!curStream || r.track !== curTrack) await selectTrack(r.track);   // (первое открытие / смена дорожки)
  // с субтитрами перематываем на несколько секунд раньше: реплика, начавшаяся до точки перемотки, должна остаться на экране
  const seekT = sub ? Math.max(0, startT - sub.lookback) : startT;
  const ok = await seekTo(seekT);
  if (sub) { sub.covFrom = seekT; sub.covTo = seekT; }
  // Декодер после перемотки создаём заново, а не avcodec_flush_buffers(): у AC-3/E-AC-3 после flush
  // звук получается другой громкости (в 2 раза и больше), чем при обычном воспроизведении подряд.
  await selectTrack(r.track);
  sess = newSession(startT);
  sess.recv = r.recv;
  lastEnd = -1;
  if (!ok) post({type: 'error', gen, message: 'не удалось перемотать контейнер'});
}

// ---------------------------------------------------------------- субтитры
const utf8 = new TextDecoder('utf-8');

function tbOf(st) { return st.time_base_num / st.time_base_den; }

// пакет субтитров -> реплика {start, end, text, lines} (или null)
function subPacketToCue(p) {
  const info = sub.info;
  const t = isNoPts(p.pts || 0, p.ptshi || 0) ? (isNoPts(p.dts || 0, p.dtshi || 0) ? NaN : i64(p.dts, p.dtshi || 0)) : i64(p.pts, p.ptshi || 0);
  if (!Number.isFinite(t)) return null;
  const start = t * sub.tb;
  const dur = (p.duration || p.durationhi) ? i64(p.duration, p.durationhi || 0) * sub.tb : 0;
  const end = dur > 0 ? start + dur : start + 3;            // длительность неизвестна — 3 с (редко: у mkv/mp4 она есть)
  const d = p.data;
  if (!d || !d.length) return null;
  let text;
  switch (info.codec) {
    case 'ass': case 'ssa': {
      // Matroska/FFmpeg: «ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text» — берём всё после assSkip запятых
      const str = utf8.decode(d);
      let pos = 0;
      for (let k = 0; k < sub.assSkip; k++) { const j = str.indexOf(',', pos); if (j < 0) { pos = str.length; break; } pos = j + 1; }
      text = str.slice(pos);
      break;
    }
    case 'mov_text': {
      // 3GPP Timed Text: 2 байта длины, текст (UTF-8 или UTF-16 с BOM), затем атомы стилей. Длина 0 — «погасить» предыдущую реплику.
      const len = (d[0] << 8) | d[1];
      if (!len || d.length < 2 + len) return len ? null : null;
      const body = d.subarray(2, 2 + len);
      text = (body[0] === 0xfe && body[1] === 0xff) ? new TextDecoder('utf-16be').decode(body.subarray(2))
        : (body[0] === 0xff && body[1] === 0xfe) ? new TextDecoder('utf-16le').decode(body.subarray(2)) : utf8.decode(body);
      break;
    }
    case 'webvtt': text = webvttPayload(d); break;
    default: text = utf8.decode(d);                          // subrip, text
  }
  return makeCue(start, end, text);
}

// WebVTT в Matroska/FFmpeg: пакет — «идентификатор?\nнастройки\nтекст» либо «боксы MP4» (vttc/payl); берём только текст реплики
function webvttPayload(d) {
  if (d.length >= 8 && d[4] === 0x76 && d[5] === 0x74 && d[6] === 0x74) {       // 'vtt?' бокс (MP4 wvtt)
    let out = '', pos = 0;
    while (pos + 8 <= d.length) {
      const size = ((d[pos] << 24) | (d[pos + 1] << 16) | (d[pos + 2] << 8) | d[pos + 3]) >>> 0;
      const type = String.fromCharCode(d[pos + 4], d[pos + 5], d[pos + 6], d[pos + 7]);
      if (size < 8 || pos + size > d.length) break;
      if (type === 'vttc') {
        let q = pos + 8;
        while (q + 8 <= pos + size) {
          const s2 = ((d[q] << 24) | (d[q + 1] << 16) | (d[q + 2] << 8) | d[q + 3]) >>> 0;
          if (s2 < 8) break;
          if (String.fromCharCode(d[q + 4], d[q + 5], d[q + 6], d[q + 7]) === 'payl') out += (out ? '\n' : '') + utf8.decode(d.subarray(q + 8, q + s2));
          q += s2;
        }
      }
      pos += size;
    }
    return out;
  }
  return utf8.decode(d);
}

// Сколько запятых пропустить в пакете ASS до текста: по строке Format из заголовка дорожки (ReadOrder добавлен, Start/End убраны)
async function loadSubExtra() {
  sub.assSkip = 8;
  if (sub.info.codec !== 'ass' && sub.info.codec !== 'ssa') return;
  try {
    const cp = sub.stream.codecpar;
    const ptr = await libav.AVCodecParameters_extradata(cp);
    const size = await libav.AVCodecParameters_extradata_size(cp);
    if (!ptr || !size) return;
    const head = utf8.decode(await libav.copyout_u8(ptr, size));
    const m = /^\s*\[Events\][\s\S]*?^\s*Format:\s*(.+)$/im.exec(head);
    if (m) { const n = m[1].split(',').length; if (n >= 3) sub.assSkip = n - 2; }
  } catch (e) { /* остаётся стандартное значение */ }
}

function handleSubPackets(list) {
  const out = [];
  for (const p of list) {
    stats.subPackets = (stats.subPackets || 0) + 1;
    let c;
    try { c = subPacketToCue(p); } catch (e) { stats.errors++; continue; }
    if (!c) continue;
    const k = Math.round(c.start * 1000) + '|' + Math.round(c.end * 1000) + '|' + c.text;
    if (sub.sent.has(k)) continue;
    sub.sent.add(k);
    out.push(c);
  }
  if (out.length) post({type: 'subcues', epoch: sub.epoch, cues: out});
}

// Проверка по сообщению 'sub' / смене режима: настроить потоки, а если нужное время не покрыто — перемотать (когда звука нет)
async function applySub() {
  subDirty = false; subCheck = false;
  await configureStreams();
  if (!sub) return;
  if (sub.assSkip === undefined) await loadSubExtra();
  const from = Math.max(0, sub.time - sub.lookback);
  const covered = sub.covFrom === sub.covFrom && sub.covFrom <= from + 0.25 && sub.time <= sub.covTo + SUB_FWD_GAP;
  if (covered) return;
  if (audioOn) { post({type: 'substale', epoch: sub.epoch, seq: sub.seq}); return; }   // демуксер занят звуком — пусть главный поток перезапустит его
  const ok = await seekTo(from);
  lastEnd = -1;
  sub.covFrom = from; sub.covTo = from;
  if (!ok) post({type: 'error', gen, message: 'не удалось перемотать контейнер (субтитры)'});
}

// Чтение «только субтитры»: пока покрытие не дошло до sub.until. Видео проходится без копирования данных — нужны только его метки времени.
async function subStep() {
  const tsr = timeStream();
  const tIdx = tsr ? tsr.index : -1;
  const tTb = tsr ? tbOf(tsr) : 0;
  const sIdx = sub.stream.index;
  let n = 0;
  const t0 = performance.now();
  while (!req && !subDirty && !subCheck && sub && sub.covTo < sub.until && n++ < 300) {
    const r = await libav.av_read_frame(fmtCtx, demuxPkt);
    if (r < 0) {
      if (r === libav.AVERROR_EOF) sub.covTo = Infinity;
      else if (r !== -libav.EAGAIN && ++sub.readErrors > 50) { sub.covTo = Infinity; post({type: 'error', gen, message: 'ошибка чтения: ' + r}); }
      break;
    }
    stats.subReads = (stats.subReads || 0) + 1;
    const si = await libav.AVPacket_stream_index(demuxPkt);
    if (si === sIdx) {
      const p = await libav.ff_copyout_packet(demuxPkt);
      handleSubPackets([p]);
      // у MP4 пакеты идут строго по времени и других потоков нет: до этой метки реплик больше нет. У остальных — с запасом на разнобой
      const t = isNoPts(p.pts || 0, p.ptshi || 0) ? NaN : i64(p.pts, p.ptshi || 0) * sub.tb;
      if (Number.isFinite(t)) sub.covTo = Math.max(sub.covTo, isMov ? t : t - SUB_SKEW);
    } else if (si === tIdx) {
      const lo = await libav.AVPacket_dts(demuxPkt), hi = await libav.AVPacket_dtshi(demuxPkt);
      let t = NaN;
      if (!isNoPts(lo, hi)) t = i64(lo, hi) * tTb;
      else { const plo = await libav.AVPacket_pts(demuxPkt), phi = await libav.AVPacket_ptshi(demuxPkt); if (!isNoPts(plo, phi)) t = i64(plo, phi) * tTb; }
      if (Number.isFinite(t)) sub.covTo = Math.max(sub.covTo, t - SUB_SKEW);
    }
    await libav.av_packet_unref(demuxPkt);
  }
  stats.subReadMs = (stats.subReadMs || 0) + performance.now() - t0;
}

function newSub(m) {
  const info = subInfo[m.track];
  return {epoch: m.epoch, idx: m.track, stream: subStreams[m.track], info, tb: tbOf(subStreams[m.track]),
    assSkip: undefined, covFrom: NaN, covTo: NaN, sent: new Set(), time: m.time, until: m.time, lookback: m.lookback, seq: m.seq, readErrors: 0};
}

// ---------------------------------------------------------------- движок
function wake() { if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } }
function waitWake() { return new Promise((res) => { wakeResolve = res; }); }

async function engine() {
  while (!closed) {
    try {
      if (req) {
        const r = req; req = null;
        await applyStart(r);
        continue;
      }
      if (subDirty || subCheck) { await applySub(); continue; }
      if (audioOn) {
        if (!sess || sess.eof || sess.posEnd + sess.accN / outRate >= until) { await waitWake(); continue; }
        await step();
      } else if (sub && sub.covTo < sub.until && sub.covFrom === sub.covFrom) {
        await subStep();
      } else {
        await waitWake();
      }
    } catch (e) {
      post({type: 'error', gen, message: String((e && e.message) || e)});
      sess = null;
      await waitWake();
    }
  }
}

let ticker = null;
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    post({type: 'tick', gen, posEnd: sess ? sess.posEnd : 0, eof: sess ? sess.eof : false, stats: {...stats},
      sub: sub ? {epoch: sub.epoch, covFrom: sub.covFrom, covTo: sub.covTo} : null});
  }, 50);
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'open') {
      const info = await open(m.file);
      post({type: 'opened', info});
      startTicker();
      engine();
    } else if (m.type === 'start') {
      req = {gen: m.gen, track: m.track, time: m.time, until: m.until, outRate: m.outRate, recv: performance.now()};
      gen = m.gen;
      until = m.until;            // здесь, а не в applyStart: «until» новой команды может прийти раньше, чем её применят
      wake();
    } else if (m.type === 'until') {
      if (m.gen === gen) { until = Math.max(until, m.until); wake(); }
    } else if (m.type === 'sub') {
      const info = m.track >= 0 ? subInfo[m.track] : null;
      if (!info || info.kind !== 'text') {
        if (sub) { sub = null; subDirty = true; }
      } else {
        if (!sub || sub.idx !== m.track || sub.epoch !== m.epoch) { sub = newSub(m); subDirty = true; }
        sub.time = m.time; sub.until = m.time + m.ahead; sub.lookback = m.lookback; sub.seq = m.seq;
      }
      subCheck = true;
      wake();
    } else if (m.type === 'audioStop') {
      if (audioOn) { audioOn = false; sess = null; subDirty = true; subCheck = true; wake(); }
    } else if (m.type === 'close') {
      closed = true;
      clearInterval(ticker);
      wake();
      post({type: 'closed'});
      self.close();
    }
  } catch (e) {
    post({type: 'error', gen, message: String((e && e.message) || e), fatal: m.type === 'open'});
  }
};
