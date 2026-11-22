// filmvideo-worker.js — декодирует КАРТИНКУ фильма, который Chrome сам не играет (AVI с Xvid/DivX, MJPEG, MPEG-2 с DVD, DV, ...),
// через libav.js (FFmpeg, LGPL, WebAssembly) в отдельном потоке. Файл читается кусками через File.slice() — целиком в память
// не загружается. Кадры уходят главному потоку как плоскости Y, U, V (8 бит) в одном ArrayBuffer, без копирования.
//
// Протокол (главный поток -> воркер):
//   {type:'open', file}                                  -> {type:'opened', info}
//   {type:'seek', gen, time, until, preview}             перемотать (по индексу контейнера до ключевого кадра, дальше — декодирование до time)
//   {type:'until', gen, until, clock}                    декодировать дальше, до этой секунды фильма (clock — где сейчас часы: по ним видно отставание)
//   {type:'close'}
// Воркер -> главный поток:
//   {type:'frame', gen, pts, dur, w, h, cw, ch, buf, offY, strideY, offU, strideU, offV, strideV, fullRange, cs, key, preview, ms}
//   {type:'eof', gen, endPts}                            файл кончился, все кадры отданы (endPts — конец последнего кадра)
//   {type:'tick', gen, stats}, {type:'error', gen, message, fatal}
//
// Перемотка: после seek кадры до нужного момента декодируются, но не отдаются (с пропуском кадров, которые никто не покажет:
// skip_frame=NONREF, пока до цели больше секунды), так что 10-секундный интервал между ключевыми кадрами проходится за доли секунды.
// Первый ключевой кадр уходит сразу как «предварительный» (preview) — экран обновляется мгновенно, пока декодер догоняет цель.

import LibAV from '../vendor/libav/libav-6.11.9.0.2-filmav.mjs';
import {sniffContainer} from './filmsniff.js';

const AVMEDIA_TYPE_VIDEO = 0;
const AVDISCARD_DEFAULT = 0, AVDISCARD_NONREF = 8, AVDISCARD_ALL = 48;
const AVSEEK_FLAG_BACKWARD = 1, AVSEEK_FLAG_BYTE = 2, AVSEEK_FLAG_ANY = 4;
const BLOCK_SEQ = 1 << 20;        // размер чтения с диска при последовательном чтении
const BLOCK_RANDOM = 1 << 18;     // и при «прыжках» (индекс контейнера, перемотка)
const NOPTS_LO = 0, NOPTS_HI = -2147483648;
const LAG_ON = 0.35, LAG_OFF = 0.08;     // отставание декодера от часов, с: выше — пропускаем нессылочные кадры, ниже — возвращаемся
const SKIP_WINDOW = 1.0;                  // с: ближе к цели перемотки декодируем всё

// форматы пикселей FFmpeg (AV_PIX_FMT_*), которые отдаём как есть: 8-битные планарные YUV
const FMT_NATIVE = new Set([0, 4, 5, 6, 7, 12, 13, 14, 31, 32]);   // 420, 422, 444, 410, 411, J420, J422, J444, 440, J440
const FMT_FULL_RANGE = new Set([12, 13, 14, 32]);                  // «J»-форматы: полный диапазон
const FMT_YUV420P = 0, FMT_YUV422P = 4, FMT_YUV444P = 5, FMT_YUV410P = 6, FMT_YUV411P = 7, FMT_YUV440P = 31;
const AV_PIX_FMT_FLAG_PLANAR = 0x10, AV_PIX_FMT_FLAG_RGB = 0x20, AV_PIX_FMT_FLAG_PAL = 0x2;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const i64 = (lo, hi) => (hi | 0) * 4294967296 + (lo >>> 0);
const isNoPts = (lo, hi) => (hi | 0) === NOPTS_HI && (lo >>> 0) === NOPTS_LO;

// ---------------------------------------------------------------- состояние
let libav = null;
let file = null;
let fmtCtx = 0, demuxPkt = 0;
let vs = null;                       // видеопоток (libav.js-описание)
let tb = 0;                          // секунд в одном такте метки видеопотока
let startTime = 0;                   // с: метка первого кадра в контейнере (у AVI — 0, у MPEG-PS/TS обычно 0,2–1,4 с)
let frameDur = 0.04;                 // с: длительность кадра по частоте
let container = 'other';
let closed = false;

const stats = {bytesRead: 0, reads: 0, decoded: 0, delivered: 0, skippedSeek: 0, skippedNonref: 0, decodeMs: 0, readMs: 0, copyMs: 0,
  convMs: 0, errors: 0, packets: 0, lagSkips: 0, seeks: 0, lastSeekMs: 0};

let req = null;                      // {gen, time, until, preview, recv} — ожидает применения
let gen = 0;
let until = 0;
let clockNow = 0;
let wakeResolve = null;

let dec = null;                      // {c, pkt, frame}
let sess = null;                     // сессия декодирования после перемотки
let swsCache = null;                 // {key, ctx}
let rangeStream = 0;                 // color_range из параметров потока (1 — MPEG, 2 — JPEG)
let csStream = 2;                    // color_space из параметров потока

// ---------------------------------------------------------------- чтение файла блоками (как в filmaudio-worker.js)
let lastEnd = -1;
let prefetch = null;

function fetchBlock(pos, len) {
  const end = Math.min(file.size, pos + len);
  return {pos, end, promise: file.slice(pos, end).arrayBuffer()};
}

async function onBlockRead(name, pos, length) {
  const sequential = pos === lastEnd;
  let blk;
  if (prefetch && prefetch.pos === pos) blk = prefetch;
  else blk = fetchBlock(pos, Math.max(length, sequential ? BLOCK_SEQ : BLOCK_RANDOM));
  prefetch = null;
  const buf = await blk.promise;
  stats.bytesRead += buf.byteLength;
  stats.reads++;
  lastEnd = blk.end;
  if (sequential && blk.end < file.size) prefetch = fetchBlock(blk.end, BLOCK_SEQ);
  await libav.ff_block_reader_dev_send(name, pos, new Uint8Array(buf));
}

// ---------------------------------------------------------------- открытие
const MATRIX_NAME = {1: 'bt709', 4: 'bt601', 5: 'bt601', 6: 'bt601', 7: 'smpte240m', 9: 'bt2020', 10: 'bt2020'};

async function open(f) {
  file = f;
  libav = await LibAV.LibAV({noworker: true, nothreads: true});
  await libav.mkblockreaderdev('input', file.size);
  libav.onblockread = onBlockRead;
  container = sniffContainer(new Uint8Array(await file.slice(0, 512).arrayBuffer()));
  const t0 = performance.now();
  const [ctx, strs] = await libav.ff_init_demuxer_file('input');
  fmtCtx = ctx;
  demuxPkt = await libav.av_packet_alloc();
  const dur = i64(await libav.AVFormatContext_duration(ctx), await libav.AVFormatContext_durationhi(ctx)) / 1e6;
  const fstart = i64(await libav.AVFormatContext_start_time(ctx), await libav.AVFormatContext_start_timehi(ctx)) / 1e6;
  const videos = strs.filter((s) => s.codec_type === AVMEDIA_TYPE_VIDEO);
  const audioCount = strs.filter((s) => s.codec_type === 1).length;
  if (!videos.length) throw new Error('в файле нет видеопотока');
  // обложки (attached_pic) — не видео для показа
  vs = null;
  for (const s of videos) {
    const disp = await libav.AVStream_disposition(s.ptr);
    if (!(disp & 0x400)) { vs = s; break; }
  }
  if (!vs) vs = videos[0];
  tb = vs.time_base_num / vs.time_base_den;
  const cp = vs.codecpar;
  const codec = await libav.avcodec_get_name(vs.codec_id);
  const w = await libav.AVCodecParameters_width(cp), h = await libav.AVCodecParameters_height(cp);
  const pixFmtId = await libav.AVCodecParameters_format(cp);
  rangeStream = await libav.AVCodecParameters_color_range(cp);
  csStream = await libav.AVCodecParameters_color_space(cp);
  const trc = await libav.AVCodecParameters_color_trc(cp);
  // частота кадров: средняя, иначе «базовая», иначе из параметров
  let fps = 0;
  for (const [n, d] of [
    [await libav.AVStream_avg_frame_rate_num(vs.ptr), await libav.AVStream_avg_frame_rate_den(vs.ptr)],
    [await libav.AVStream_r_frame_rate_num(vs.ptr), await libav.AVStream_r_frame_rate_den(vs.ptr)],
    [await libav.AVCodecParameters_framerate_num(cp), await libav.AVCodecParameters_framerate_den(cp)]]) {
    if (n > 0 && d > 0) { fps = n / d; break; }
  }
  if (fps > 0 && fps < 1000) frameDur = 1 / fps; else fps = 0;
  // соотношение сторон пикселя: у потока, иначе у параметров
  let sarN = await libav.AVStream_sample_aspect_ratio_num(vs.ptr), sarD = await libav.AVStream_sample_aspect_ratio_den(vs.ptr);
  if (!(sarN > 0 && sarD > 0)) { sarN = await libav.AVCodecParameters_sample_aspect_ratio_num(cp); sarD = await libav.AVCodecParameters_sample_aspect_ratio_den(cp); }
  if (!(sarN > 0 && sarD > 0)) { sarN = 1; sarD = 1; }
  const fieldOrder = await libav.AVCodecParameters_field_order(cp);   // 0 неизвестно, 1 построчная, >1 чересстрочная
  // Время кадров — «сырое», как у метки в контейнере (так же считает звук filmaudio), поэтому у MPEG-PS/TS, где поток начинается не с нуля,
  // первый кадр лежит на startTime, а не на 0; media.duration = startTime + duration.
  startTime = fstart > 0 && fstart < 1e5 ? fstart : 0;
  // лишние потоки отбрасываем сразу в демуксере: их пакеты не копируются в JS
  for (const s of strs) if (s !== vs) await libav.AVStream_discard_s(s.ptr, AVDISCARD_ALL);

  // пробуем открыть декодер — по этому «можем ли показать» (canDecode)
  let canDecode = true, decodeError = '';
  try { await initDecoder(); } catch (e) { canDecode = false; decodeError = String((e && e.message) || e); }
  const profile = await libav.AVCodecParameters_profile(cp), level = await libav.AVCodecParameters_level(cp);
  return {
    container, codec, width: w, height: h, pixFmt: pixFmtId, fps, frameDur, duration: dur > 0 ? dur : 0, startTime,
    sarNum: sarN, sarDen: sarD, fieldOrder, colorRange: rangeStream, colorSpace: csStream, colorTrc: trc,
    matrix: MATRIX_NAME[csStream] || '', profile, level, audioStreams: audioCount, canDecode, decodeError,
    openMs: performance.now() - t0, bytesRead: stats.bytesRead, reads: stats.reads, size: file.size,
  };
}

async function initDecoder() {
  if (dec) { await libav.ff_free_decoder(dec.c, dec.pkt, dec.frame); dec = null; }
  const [, c, pkt, frame] = await libav.ff_init_decoder(vs.codec_id, {codecpar: vs.codecpar, time_base: [vs.time_base_num, vs.time_base_den]});
  dec = {c, pkt, frame, skip: AVDISCARD_DEFAULT};
}

async function setSkip(mode) {
  if (!dec || dec.skip === mode) return;
  dec.skip = mode;
  await libav.AVCodecContext_skip_frame_s(dec.c, mode);
}

// ---------------------------------------------------------------- перемотка
async function seekTo(sec) {
  // чуть раньше цели (3 кадра): в потоках с B-кадрами индекс хранит метки декодирования, и ключевой кадр, чья метка показа уже позже цели, нам не подходит
  const ts = Math.max(0, Math.floor((sec - 3 * frameDur) / tb + 1e-6));
  for (const flags of [AVSEEK_FLAG_BACKWARD, AVSEEK_FLAG_BACKWARD | AVSEEK_FLAG_ANY]) {
    const r = await libav.av_seek_frame(fmtCtx, vs.index, ts % 4294967296, Math.floor(ts / 4294967296), flags);
    if (r >= 0) return 'index';
  }
  // нет индекса: прыгаем по байтам пропорционально времени (потом ждём ключевой кадр)
  const dur = i64(await libav.AVFormatContext_duration(fmtCtx), await libav.AVFormatContext_durationhi(fmtCtx)) / 1e6;
  if (dur > 0 && sec > 0) {
    const pos = Math.max(0, Math.min(file.size - 1, Math.floor(file.size * Math.min(1, sec / dur))));
    const r = await libav.av_seek_frame(fmtCtx, vs.index, pos % 4294967296, Math.floor(pos / 4294967296), AVSEEK_FLAG_BYTE);
    if (r >= 0) return 'byte';
  }
  return sec === 0 ? 'none' : null;
}

function newSession(r) {
  return {
    gen: r.gen, target: Math.max(0, r.time), preview: !!r.preview,
    first: true,              // ещё не было ни одного декодированного кадра
    needKey: false,           // после байтовой перемотки показываем только с первого ключевого
    lastPts: -1, expect: NaN, // метка последнего декодированного кадра; ожидаемая метка следующего, если у декодера её нет
    delivered: 0, eof: false, endPts: 0, readErrors: 0, recv: r.recv, lag: false,
    redo: false, retries: 0, back: 0,   // перескок: первый кадр оказался позже цели (контейнер прыгнул не к ключевому кадру до неё)
  };
}

async function applySeek(r) {
  gen = r.gen;
  until = r.until;
  const t0 = performance.now();
  stats.seeks++;
  sess = newSession(r);
  const how = await seekTo(sess.target);
  await initDecoder();                      // декодер после перемотки создаём заново (как и звук): нет остатков от прошлого места
  lastEnd = -1;
  if (how === null) { post({type: 'error', gen, message: 'не удалось перемотать контейнер'}); }
  sess.needKey = how === 'byte';
  stats.lastSeekMs = performance.now() - t0;
  if (sess.target > 0) await setSkip(AVDISCARD_NONREF);
}

// ---------------------------------------------------------------- кадры
// Плоскости кадра — в один ArrayBuffer. Кадры не в 8-битном планарном YUV (10 бит, RGB, серый, палитра, упакованный YUV) переводит
// swscale в ближайший 8-битный планарный YUV: сохраняя разрежение цвета у планарного YUV, иначе — в 4:2:0.
// YUV -> YUV: матрица и диапазон прежние; RGB/серый -> YUV: BT.601 (SD) или BT.709 (HD), ограниченный диапазон.
async function convertIfNeeded(ptr, fmt, w, h, cs, fullRange) {
  if (FMT_NATIVE.has(fmt)) return {ptr, fmt, own: false, rgb: false};
  const desc = await libav.av_pix_fmt_desc_get(fmt);
  const flags = await libav.AVPixFmtDescriptor_flags(desc);
  const nb = await libav.AVPixFmtDescriptor_nb_components(desc);
  const rgb = !!(flags & (AV_PIX_FMT_FLAG_RGB | AV_PIX_FMT_FLAG_PAL)) || nb < 3;
  let dstFmt = FMT_YUV420P;
  if (!rgb && (flags & AV_PIX_FMT_FLAG_PLANAR)) {
    const lw = await libav.AVPixFmtDescriptor_log2_chroma_w(desc), lh = await libav.AVPixFmtDescriptor_log2_chroma_h(desc);
    dstFmt = lw === 0 && lh === 0 ? FMT_YUV444P : lw === 1 && lh === 0 ? FMT_YUV422P : lw === 0 && lh === 1 ? FMT_YUV440P
      : lw === 2 && lh === 0 ? FMT_YUV411P : lw === 2 && lh === 2 ? FMT_YUV410P : FMT_YUV420P;
  }
  const key = w + 'x' + h + ':' + fmt + '>' + dstFmt;
  if (!swsCache || swsCache.key !== key) {
    if (swsCache) await libav.sws_freeContext(swsCache.ctx);
    swsCache = null;
    const ctx = await libav.sws_getContext(w, h, fmt, w, h, dstFmt, 2 /* SWS_BILINEAR */, 0, 0, 0);
    if (!ctx) throw new Error('swscale: нет преобразования формата ' + fmt);
    swsCache = {key, ctx};
  }
  const dst = await libav.av_frame_alloc();
  await libav.AVFrame_width_s(dst, w);
  await libav.AVFrame_height_s(dst, h);
  await libav.AVFrame_format_s(dst, dstFmt);
  await libav.AVFrame_colorspace_s(dst, rgb ? (h >= 720 || w > 1024 ? 1 : 6) : cs);
  await libav.AVFrame_color_range_s(dst, rgb ? 1 : (fullRange ? 2 : 1));
  const rr = await libav.sws_scale_frame(swsCache.ctx, dst, ptr);
  if (rr < 0) { await libav.av_frame_free_js(dst); throw new Error('swscale: ошибка ' + rr); }
  return {ptr: dst, fmt: dstFmt, own: true, rgb};
}

async function sendFrame(ptr, pts, key, preview) {
  const t0 = performance.now();
  const w = await libav.AVFrame_width(ptr), h = await libav.AVFrame_height(ptr);
  const fmt0 = await libav.AVFrame_format(ptr);
  const range0 = await libav.AVFrame_color_range(ptr);
  const cs0 = await libav.AVFrame_colorspace(ptr);
  let fullRange = FMT_FULL_RANGE.has(fmt0) || range0 === 2 || (range0 === 0 && rangeStream === 2);
  let cs = cs0 && cs0 !== 2 ? cs0 : csStream;
  const c = await convertIfNeeded(ptr, fmt0, w, h, cs, fullRange);
  if (c.rgb) { cs = h >= 720 || w > 1024 ? 1 : 6; fullRange = false; }
  stats.convMs += performance.now() - t0;
  const t1 = performance.now();
  const desc = await libav.av_pix_fmt_desc_get(c.fmt);
  const lw = await libav.AVPixFmtDescriptor_log2_chroma_w(desc), lh = await libav.AVPixFmtDescriptor_log2_chroma_h(desc);
  const cf = await libav.ff_copyout_frame_video(c.ptr, w);
  if (c.own) await libav.av_frame_free_js(c.ptr);
  stats.copyMs += performance.now() - t1;
  const L = cf.layout;
  const cw = -((-w) >> lw), ch = -((-h) >> lh);
  post({type: 'frame', gen, pts, dur: frameDur, w, h, cw, ch, buf: cf.data.buffer,
    offY: L[0].offset, strideY: L[0].stride, offU: L[1].offset, strideU: L[1].stride, offV: L[2].offset, strideV: L[2].stride,
    fullRange, cs, key, preview: !!preview, ms: performance.now() - t0}, [cf.data.buffer]);
  stats.delivered++;
}

async function handleFrame(ptr) {
  const s = sess;
  stats.decoded++;
  // метка кадра: «лучшая догадка» декодера, иначе pts, иначе предыдущая + длительность
  let lo = await libav.AVFrame_best_effort_timestamp(ptr), hi = await libav.AVFrame_best_effort_timestamphi(ptr);
  if (isNoPts(lo, hi)) { lo = await libav.AVFrame_pts(ptr); hi = await libav.AVFrame_ptshi(ptr); }
  let pts;
  const ftbN = await libav.AVFrame_time_base_num(ptr), ftbD = await libav.AVFrame_time_base_den(ptr);
  const ftb = ftbN > 0 && ftbD > 0 ? ftbN / ftbD : tb;
  if (isNoPts(lo, hi)) pts = Number.isFinite(s.expect) ? s.expect : s.target;
  else pts = i64(lo, hi) * ftb;
  s.expect = pts + frameDur;
  s.lastPts = Math.max(s.lastPts, pts);
  const key = !!(await libav.AVFrame_key_frame(ptr));
  if (s.needKey) { if (!key) { stats.skippedSeek++; return; } s.needKey = false; }
  const wasFirst = s.first;
  // MPEG-PS/TS (и AVI без индекса) прыгают к ближайшему пакету с меткой, а не к ключевому кадру; в потоках с B-кадрами кадры перед ключевым в показе
  // (открытая группа) без прежней группы не декодируются. Если первый кадр уже позже цели, нужного кадра мы не видели:
  // отступаем назад (0,5 с, 1 с, 2 с, ...) и пробуем снова — иначе вместо нужного места показали бы начало следующей группы кадров
  if (wasFirst && pts > s.target + 1e-4 && s.target > startTime + 0.1 && s.retries < 9) { s.redo = true; stats.skippedSeek++; return; }
  s.first = false;
  // перемотка: кадры, которые закончились раньше цели, не нужны
  if (pts + frameDur * 0.999 <= s.target) {
    if (wasFirst && s.preview && key) { await sendFrame(ptr, pts, key, true); }   // мгновенный предварительный кадр
    else stats.skippedSeek++;
    if (s.target - pts <= SKIP_WINDOW) await setSkip(AVDISCARD_DEFAULT);
    return;
  }
  if (dec.skip !== AVDISCARD_DEFAULT && !s.lag) await setSkip(AVDISCARD_DEFAULT);
  // отставание от часов: пропускаем нессылочные кадры, пока не догоним
  const behind = clockNow - pts;
  if (!s.lag && behind > LAG_ON && s.delivered > 2) { s.lag = true; await setSkip(AVDISCARD_NONREF); }
  else if (s.lag && behind < LAG_OFF) { s.lag = false; await setSkip(AVDISCARD_DEFAULT); }
  if (s.lag && behind > LAG_ON * 2 && !key) { stats.lagSkips++; return; }
  s.delivered++;
  await sendFrame(ptr, pts, key, false);
}

async function redoSeek() {
  const s = sess;
  s.redo = false; s.retries++;
  s.back = s.back ? s.back * 2 : 0.5;
  const how = await seekTo(Math.max(0, s.target - s.back));
  await initDecoder();
  lastEnd = -1;
  s.first = true; s.lastPts = -1; s.expect = NaN; s.delivered = 0; s.needKey = how === 'byte';
  stats.redos = (stats.redos || 0) + 1;
  if (s.target > 0) await setSkip(AVDISCARD_NONREF);
}

async function decodePackets(pkts) {
  if (!pkts.length) return;
  const t0 = performance.now();
  let frames;
  try {
    frames = await libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, pkts, {ignoreErrors: true, copyoutFrame: 'ptr'});
  } catch (e) {
    stats.errors++;
    return;
  }
  stats.decodeMs += performance.now() - t0;
  for (let i = 0; i < frames.length; i++) {
    const ptr = frames[i];
    if (!req && !sess.redo) {
      try { await handleFrame(ptr); } catch (e) { stats.errors++; post({type: 'error', gen, message: 'кадр: ' + String((e && e.message) || e)}); }
    }
    await libav.av_frame_free_js(ptr);
  }
}

// Читаем пакеты по одному и сразу декодируем: у статичных сцен пакеты крошечные, и «пачка в 64 КБ» — это секунды кадров вперёд
async function step() {
  let n = 0;
  while (!req && !closed && n++ < 16) {
    const t0 = performance.now();
    const r = await libav.av_read_frame(fmtCtx, demuxPkt);
    stats.readMs += performance.now() - t0;
    if (req) { if (r >= 0) await libav.av_packet_unref(demuxPkt); return; }
    if (r >= 0) {
      const si = await libav.AVPacket_stream_index(demuxPkt);
      if (si === vs.index) {
        const p = await libav.ff_copyout_packet(demuxPkt);
        stats.packets++;
        await libav.av_packet_unref(demuxPkt);
        await decodePackets([p]);
        if (sess.redo && !req) { await redoSeek(); return; }
      } else await libav.av_packet_unref(demuxPkt);
      if (sess.lastPts >= until && sess.delivered > 0) return;
      continue;
    }
    if (r === libav.AVERROR_EOF) {
      try {
        const frames = await libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, [], {fin: true, ignoreErrors: true, copyoutFrame: 'ptr'});
        for (const ptr of frames) { if (!req && !sess.redo) await handleFrame(ptr); await libav.av_frame_free_js(ptr); }
      } catch (e) { /* ignore */ }
      // после перемотки не вышло ни одного кадра (контейнер прыгнул в самый хвост, где нет ключевого кадра): отступаем назад и пробуем снова
      if (!req && !sess.redo && sess.lastPts < 0 && sess.retries < 9 && sess.target > startTime + 0.1) sess.redo = true;
      if (!req && sess.redo) { await redoSeek(); return; }
      if (!req) {
        sess.eof = true;
        post({type: 'eof', gen, endPts: sess.lastPts >= 0 ? sess.lastPts + frameDur : 0});
      }
      return;
    }
    if (r !== -libav.EAGAIN) {
      stats.errors++;
      if (++sess.readErrors > 50) {
        sess.eof = true;
        post({type: 'eof', gen, endPts: sess.lastPts >= 0 ? sess.lastPts + frameDur : 0});
        post({type: 'error', gen, message: 'ошибка чтения: ' + r});
        return;
      }
    }
  }
}

// ---------------------------------------------------------------- движок
function wake() { if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } }
function waitWake() { return new Promise((res) => { wakeResolve = res; }); }

async function engine() {
  while (!closed) {
    try {
      if (req) {
        const r = req; req = null;
        await applySeek(r);
        continue;
      }
      // пока не дошли до цели перемотки — декодируем независимо от until
      if (!sess || sess.eof || (sess.lastPts >= until && sess.delivered > 0)) { await waitWake(); continue; }
      await step();
    } catch (e) {
      post({type: 'error', gen, message: String((e && e.message) || e)});
      if (sess) sess.eof = true;
      await waitWake();
    }
  }
}

let ticker = null;
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => { post({type: 'tick', gen, stats: {...stats, until, lastPts: sess ? sess.lastPts : -1, lag: sess ? sess.lag : false}}); }, 250);
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'open') {
      const info = await open(m.file);
      post({type: 'opened', info});
      startTicker();
      if (info.canDecode) engine();
    } else if (m.type === 'seek') {
      req = {gen: m.gen, time: m.time, until: m.until, preview: m.preview, recv: performance.now()};
      gen = m.gen; until = m.until; clockNow = m.time;
      wake();
    } else if (m.type === 'until') {
      if (m.gen === gen) { until = Math.max(until, m.until); clockNow = m.clock; wake(); }
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
