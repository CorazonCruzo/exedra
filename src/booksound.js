// Звуки книги — записи настоящих книг (assets/sounds/book, авторы — в CREDITS.md). Книга сама не играет: `ctx.sound(name, opts)` (book.js, `snd`) приходит сюда.
//   'turn'   — один лист перевёрнут рукой или подряд (≤3 листа): запись одного листа, дубли без повтора подряд; при зажатой стрелке (hold) — короткие дубли, тише.
//   'riffle' — пролист { dur, n, follow }: при n ≥ 10 листов — запись пролиста, обрезанная по длительности dur; иначе листы по одному вдоль полёта.
//   'leaf'   — лист сорвался в пролисте: при n < 10 — по звуку листа на каждый летящий (не больше n); при n ≥ 10 молчит (звучит запись пролиста); при пролисте за рукой (follow) цели
//              заранее не видно: каждый лист — отдельный звук, а когда их набралось 10 и больше — короткие куски записи пролиста встык.
//   'open', 'close' — раскрытие и закрытие переплёта; 'put' — книгу положили на стол (зовёт room.js после переноса); 'press' — молчит.
//   'notch' — остриё распорки подставки село в выемку: самый начало записи «put» (стук дерева о дерево), ускоренное и короткое, тихо.
// Правило пролиста (решение пользователя 2026-11-21): шорох пролиста — только когда точно перевернули не меньше десятка листов.
import { sfx, fetchSound } from './util.js';

const BASE = 'assets/sounds/book/';
// Запасы по громкости — одно место для подстройки: записи нормированы по средней громкости внутри роли (пик листа −15…−23 дБFS), здесь они приглушены,
// чтобы быть деликатнее листов папки (page.wav, gain .5–.6: пик около −19 дБFS).
const LEVEL = { turn: .55, leaf: .45, riffle: .6, open: .6, close: .6, put: .6 };
// rate — скорость записи пролиста, чтобы плотность шороха была близка к летящим листам (около 17 в секунду).
const SETS = {
  leaf: { n: 8 }, open: { n: 2 }, close: { n: 3 }, put: { n: 2 },
  riffle: { n: 4, rate: [.9, 1, 1.25, .8] },
};
const RIFFLE_MIN = 10;   // с этого числа листов звучит запись пролиста

let ctx = null, master = null; const bufs = {}, last = {};
const rnd = (a, b) => a + Math.random() * (b - a);
const buf = (kind, i) => bufs[`${kind}-${i + 1}`];

export function loadBookSounds() {
  ctx ??= new AudioContext();
  for (const [kind, s] of Object.entries(SETS)) for (let i = 1; i <= s.n; i++) {
    const key = `${kind}-${i}`;
    fetchSound(ctx, `${BASE}${key}.wav`).then(b => { bufs[key] = b; }).catch(e => console.warn(e));
  }
}

// Дубль без повтора подряд среди уже загруженных.
function pick(kind, from = 0) {
  const ok = []; for (let i = from; i < SETS[kind].n; i++) if (buf(kind, i)) ok.push(i);
  if (!ok.length) return -1;
  const pool = ok.length > 1 ? ok.filter(i => i !== last[kind]) : ok;
  return last[kind] = pool[Math.floor(Math.random() * pool.length)];
}

// Один звук: from — с какого места записи (с), len — сколько играть (с записи), fade — плавное начало и конец (с).
function play(kind, i, { gain = 1, rate = 1, from = 0, len = Infinity, fadeIn = .004, fadeOut = .05, delay = 0 } = {}) {
  if (!sfx.on || !ctx || i < 0) return;
  const b = buf(kind, i); if (!b) return;
  if (ctx.state === 'suspended') ctx.resume();
  master ??= (() => { const g = ctx.createGain(); g.connect(ctx.destination); return g; })();
  const s = ctx.createBufferSource(), g = ctx.createGain(), t0 = ctx.currentTime + delay;
  s.buffer = b; s.playbackRate.value = rate;
  const span = Math.max(.02, Math.min(len, b.duration - from)), wall = span / rate;   // wall — сколько звучит на самом деле
  const fo = Math.min(fadeOut, wall * .6), fi = Math.min(fadeIn, wall * .4);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + fi);
  g.gain.setValueAtTime(gain, t0 + wall - fo); g.gain.linearRampToValueAtTime(0, t0 + wall);
  s.connect(g).connect(master); s.start(t0, from, span);
  s.onended = () => { s.disconnect(); g.disconnect(); };
}

const jitter = (v, p = .06) => v * rnd(1 - p, 1 + p);
// Листы летящие в пролисте — только короткие дубли (4–8, до полсекунды): длинные (1–3) наложились бы друг на друга.
const leaf = (g, o = {}) => play('leaf', pick('leaf', 3), { gain: LEVEL.leaf * g * rnd(.85, 1.1), rate: jitter(1, .07), fadeOut: .06 });   // o.rate в событии — скорость анимации листа, не звука

let rif = null;   // пролист, который идёт: { mode: 'rec' | 'leaves' | 'follow', want, count, until }
export function bookSound(name, o = {}) {
  // Зажатая стрелка: короткие дубли листа, потише и без наложения длинных записей — иначе вместо листов выйдет пулемёт.
  if (name === 'turn' && o.hold) play('leaf', pick('leaf', 3), { gain: LEVEL.turn * .8 * rnd(.8, 1.05), rate: jitter(1.12, .08), len: .3, fadeOut: .08 });
  else if (name === 'turn') play('leaf', pick('leaf'), { gain: LEVEL.turn * rnd(.85, 1.1), rate: jitter(o.fast ? 1.12 : 1, .05), fadeOut: .06 });
  else if (name === 'open') play('open', pick('open'), { gain: LEVEL.open * rnd(.9, 1.05), rate: jitter(1.05, .04), fadeOut: .12 });
  else if (name === 'close') play('close', pick('close'), { gain: LEVEL.close * rnd(.9, 1.05), rate: jitter(1, .04), fadeOut: .1 });
  else if (name === 'put') play('put', pick('put'), { gain: LEVEL.put * rnd(.9, 1.05), rate: jitter(1, .04), fadeOut: .12, delay: .12 });   // лёгкий запас: пружина ещё опускает книгу
  else if (name === 'notch') play('put', 0, { gain: LEVEL.put * .5 * rnd(.9, 1.1), rate: rnd(1.9, 2.2), len: .17, fadeOut: .08 });
  else if (name === 'riffle') riffle(o);
  else if (name === 'leaf') flyLeaf(o);
}

function riffle({ dur = 0, n = 0, follow = false }) {
  if (follow) { rif = { mode: 'follow', count: 0, until: 0 }; return; }   // сколько листов пройдёт — неизвестно; считаем по ходу
  if (n >= RIFFLE_MIN) {
    rif = { mode: 'rec' };
    const i = pick('riffle'); if (i < 0) return;
    const r = SETS.riffle.rate[i] * rnd(.97, 1.04);
    play('riffle', i, { gain: LEVEL.riffle * rnd(.9, 1.05), rate: r, len: dur * r + .05, fadeIn: .015, fadeOut: Math.min(.2, dur * .4) });   // оборвать к концу пролиста
  } else {
    rif = { mode: 'leaves', want: Math.max(1, n), count: 0 };   // каждый летящий лист звучит сам, но не больше, чем листов переворачивается
  }
}

function flyLeaf(o) {
  if (!rif || (o.follow && rif.mode !== 'follow')) { rif = { mode: 'follow', count: rif?.mode === 'rec' ? RIFFLE_MIN : 0, until: 0 }; }
  if (rif.mode === 'rec') return;   // идёт запись пролиста
  if (rif.mode === 'leaves') {
    if (++rif.count <= rif.want) leaf(.8, o);
    return;
  }
  // За рукой: пока листов меньше десятка — отдельные листы, потом куски записи пролиста встык (перекрытие в 60 мс гасит стык)
  rif.count++;
  const now = performance.now();
  if (rif.count < RIFFLE_MIN) { leaf(.8, o); return; }
  if (now < rif.until - 70) return;
  const i = pick('riffle'), b = i < 0 ? null : buf('riffle', i); if (!b) return;
  const r = SETS.riffle.rate[i] * rnd(.97, 1.04), len = .45 * r;
  play('riffle', i, { gain: LEVEL.riffle * .9, rate: r, from: rnd(.1, Math.max(.1, b.duration - len - .1)), len, fadeIn: .07, fadeOut: .07 });
  rif.until = now + 450;
}
