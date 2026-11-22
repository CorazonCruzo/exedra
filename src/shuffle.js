// Экран перетасовки: листы лежат на сукне, порядок меняют перетаскиванием. Без зависимостей: обычный DOM.
// Приёмы — из Dragology («closest + withFloating»), но без состояний «про запас»: раскладка — чистая функция от порядка.
//   createShuffle({ host, items: [{ id, canvas }], width, scroller, keys, onFrame, onChange, onDrop }) -> { order, holding, cancel, relayout, destroy }
// items — холсты страниц (рисует тот, кто вызывает, хоть позже: тут они только показываются уменьшенными).
// scroller — то, что прокручивается (элемент во весь экран с началом в углу окна; по умолчанию — сама страница); host лежит в нём, position: relative.
// keys: false — Esc сам не слушается (так делает тот, кто встроил экран: ему нужно решать, что Esc закрывает); тогда лист из руки возвращает cancel().
// onDrop(changed) — лист опустили на место (в том числе возвращённый); onChange(ids, cancelled) — порядок поменялся.

// Числа, которые можно крутить. Время — «за сколько пружина доезжает»: критически затухающая пружина на 98% приходит за 5,8 / ω.
export const TUNE = {
  gap: 22,             // просвет между листами, px
  captionH: 26,        // место под листом для номера, px
  neighborMs: 180,     // соседи переезжают
  dropMs: 220,         // лист опускается в окно
  liftOmega: 26, liftZeta: .62, // подъём и опускание: чуть упруго
  liftScale: 1.04,
  tiltMax: 6,          // наклон от скорости руки, градусы
  tiltPerSpeed: 1 / 160, // градусов на px/с
  tiltOmega: 15,
  tiltBase: 1.2,       // постоянный случайный наклон лежащего листа
  hysteresis: 10,      // px: новое место должно быть ближе текущего на столько
  holdMs: 250,         // палец: долгое нажатие
  holdSlop: 8,         // палец: сдвиг, после которого нажатие — это прокрутка
  touchLift: 34,       // палец: лист поднят над пальцем, px
  edge: 96,            // автопрокрутка: ширина зоны у края экрана, px
  scrollMax: 1300,     // автопрокрутка: скорость у самого края, px/с
  hopOmega: 52,        // перенос на новую строку: каждая половина (уйти и появиться) — пружина ω=52, всё вместе ~190 мс
  hopFlip: .08,        // когда лист угас до этой прозрачности, он переносится на другой конец
};
const omegaFor = ms => 5.8 / (ms / 1000);

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Шаг пружины: x — значение, v — скорость, t — цель. Полунеявный Эйлер с мелкими шагами: ω·dt ≈ 0,1 — устойчиво и точно.
function spring(o, key, t, omega, zeta, dt) {
  const n = Math.max(1, Math.ceil(dt / .004)), h = dt / n;
  let x = o[key], v = o[key + 'V'];
  for (let i = 0; i < n; i++) { v += (omega * omega * (t - x) - 2 * zeta * omega * v) * h; x += v * h; }
  o[key] = x; o[key + 'V'] = v;
}
const rest = (o, key, t, eps = .04) => Math.abs(o[key] - t) < eps && Math.abs(o[key + 'V']) < eps * 8;
// Случайное, но постоянное у листа (по его номеру).
const rnd = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };

export function createShuffle({ host, items, width = 150, aspect = 1448 / 1024, scroller = null, keys = true, onFrame, onChange, onDrop } = {}) {
  host.classList.add('shuffle');
  // Окно, в котором листы лежат: вся страница или свой прокручиваемый элемент.
  const viewW = () => scroller ? scroller.clientWidth : document.documentElement.clientWidth;
  const viewH = () => scroller ? scroller.clientHeight : innerHeight;
  const scrollPos = () => scroller ? scroller.scrollTop : scrollY;
  const scrollDown = n => scroller ? (scroller.scrollTop += n) : scrollBy(0, n);
  let dead = false;
  const hole = el('div', 'hole', host);
  const sheets = items.map((it, i) => {
    const slot = el('div', 'slot', host), paper = el('div', 'paper', slot);
    const shRest = el('div', 'sh sh-rest', paper), shLift = el('div', 'sh sh-lift', paper);
    paper.appendChild(it.canvas); it.canvas.draggable = false;
    const num = el('div', 'num', slot);
    return { id: it.id, slot, paper, shRest, shLift, num, i,
      base: (rnd(i + 1) * 2 - 1) * TUNE.tiltBase,
      x: 0, xV: 0, y: 0, yV: 0, tx: 0, ty: 0, lift: 0, liftV: 0, liftT: 0, tilt: 0, tiltV: 0, tiltT: 0,
      idx: i, z: 0, w: {}, f: 1, fV: 0, fT: 1, k: i, row: 0, hop: null };
  });
  let order = sheets.slice(), geo = null, drag = null, pending = null, raf = 0, last = 0, scrollAcc = 0;
  const H = { x: 0, xV: 0, y: 0, yV: 0, op: 0, opV: 0, opT: 0, w: {}, f: 1, fV: 0, fT: 1, k: 0, row: 0, hop: null, tx: 0, ty: 0 };

  // ---- раскладка: чистая функция от числа листов и ширины окна ----
  function layout() {
    const vw = viewW(), narrow = vw < 560, pad = narrow ? 14 : 28, gap = narrow ? 14 : TUNE.gap;
    let W = width, cols;
    if (narrow) { cols = 3; W = Math.floor((vw - pad * 2 - gap * 2) / 3); }
    else cols = Math.max(1, Math.floor((Math.min(vw, 1680) - pad * 2 + gap) / (W + gap)));
    cols = Math.min(cols, sheets.length);
    const h = Math.round(W * aspect), pitchX = W + gap, pitchY = h + TUNE.captionH + gap, rows = Math.ceil(sheets.length / cols);
    const left = Math.round((vw - (cols * W + (cols - 1) * gap)) / 2), top = narrow ? 70 : 84;
    geo = { vw, W, h, cols, pitchX, pitchY, left, top };
    host.style.setProperty('--w', W + 'px'); host.style.setProperty('--h', h + 'px'); host.style.setProperty('--cap', TUNE.captionH + 'px');
    host.style.height = top + rows * pitchY + 90 + 'px';
  }
  const slotXY = k => ({ x: geo.left + (k % geo.cols) * geo.pitchX, y: geo.top + Math.floor(k / geo.cols) * geo.pitchY });
  // Новое место для листа (или окна). Ряды — как строки текста: лист, которого сдвиг на одно место переводит в соседний ряд, не летит через
  // весь стол, а уходит за край своего ряда на полместа, гаснет, и появляется на полместа за краем следующего ряда, въезжая на место.
  function retarget(o, k, hopOK) {
    const p = slotXY(k), row = Math.floor(k / geo.cols), oldRow = o.row, dk = k - o.k, h = o.hop, ox = o.tx, oy = o.ty;
    if (!hopOK) { o.hop = null; o.fT = 1; }
    else if (h && h.phase === 'out' && row === h.fromRow) { o.hop = null; o.fT = 1; }       // передумали: вернулся в свой ряд — просто едет назад
    else if (row !== oldRow && Math.abs(dk) === 1 && !(h && h.phase === 'out')) {
      const dir = row > oldRow ? 1 : -1;
      o.hop = { phase: 'out', dir, fromRow: oldRow, ex: ox + dir * geo.pitchX / 2, ey: oy }; o.fT = 0;
    } else if (row !== oldRow && !(h && h.phase === 'out')) { o.hop = null; o.fT = 1; }
    o.tx = p.x; o.ty = p.y; o.k = k; o.row = row;
  }
  // Куда поставить всех: тащимый — в своё окно (k), остальные заполняют остальные места по порядку.
  function assign(hopOK = true) {
    order.forEach((s, k) => { retarget(s, k, hopOK && drag?.s !== s); if (s.w.n !== k + 1) { s.w.n = k + 1; s.num.textContent = k + 1; } });
  }
  function relayout(snap = false) {
    layout(); assign(false);
    if (drag) retarget(H, drag.k, false);
    if (snap) for (const s of sheets) { s.x = s.tx; s.y = s.ty; s.xV = s.yV = 0; }
    wake();
  }

  // ---- перетаскивание ----
  function begin(s, e) {
    const touch = e.pointerType === 'touch', r = geo, px = e.clientX, py = e.clientY + scrollPos();
    const grab = { x: px - s.x, y: py - s.y };
    drag = { s, pid: e.pointerId, touch, grab, cx: e.clientX, cy: e.clientY, vx: 0, from: order.indexOf(s), k: order.indexOf(s), before: order.slice(), lx: e.clientX, ly: e.clientY };
    const p = slotXY(drag.k); H.k = drag.k; H.row = Math.floor(drag.k / geo.cols); retarget(H, drag.k, false); H.x = p.x; H.y = p.y; H.xV = H.yV = 0; H.f = 1; H.opT = 1;
    s.hop = null; s.fT = 1; s.f = 1; s.fV = 0;
    s.liftT = 1; s.z = 100; s.slot.style.zIndex = 100; s.dropping = false;
    host.classList.add('dragging');
    try { s.slot.setPointerCapture(e.pointerId); } catch { /* событие не от настоящего указателя */ }
    wake();
  }
  // Ближайшее к середине листа место. Гистерезис: чтобы переключиться, новое место должно быть ближе текущего на TUNE.hysteresis.
  function pickSlot() {
    const { s } = drag, c = center(s), cx = c.x, cy = c.y;
    const dist = k => { const p = slotXY(k); return Math.hypot(p.x + geo.W / 2 - cx, p.y + geo.h / 2 - cy); };
    let best = drag.k, bd = Infinity;
    for (let k = 0; k < sheets.length; k++) { const d = dist(k); if (d < bd) { bd = d; best = k; } }
    // Гистерезис: чтобы переключиться, лучшее место должно быть ближе текущего хотя бы на TUNE.hysteresis.
    if (best !== drag.k && bd < dist(drag.k) - TUNE.hysteresis) {
      drag.k = best;
      const others = drag.before.filter(o => o !== s); others.splice(best, 0, s); order = others; assign();
      retarget(H, best, true);
    }
  }
  // Центр тащимого листа на странице (по тому, где он сейчас нарисован).
  const center = s => ({ x: s.x + geo.W / 2, y: s.y + geo.h / 2 });
  function finish(cancel) {
    if (!drag) return;
    const { s } = drag;
    if (cancel) { order = drag.before.slice(); assign(); }
    s.fT = 1; if (s.f < 1) s.f = 1;
    s.dropping = true; s.liftT = 0; s.tiltT = 0;
    // скорость руки уносим в пружину, но не больше разумного
    s.xV = clamp(drag.vx, -600, 600); s.yV = 0;
    H.opT = 0;
    host.classList.remove('dragging');
    try { s.slot.releasePointerCapture(drag.pid); } catch { /* уже отпущен */ }
    const changed = drag.before.some((o, i) => o !== order[i]);
    drag = null; wake();
    if (changed || cancel) onChange?.(order.map(o => o.id), cancel);
    onDrop?.(changed);
  }

  // Тащимый лист — под рукой: точка, за которую взяли, остаётся под ней, с учётом подъёма (масштаб) и наклона.
  function followHand(s, dt) {
    const sc = 1 + (TUNE.liftScale - 1) * s.lift, ang = (s.base + s.tilt) * Math.PI / 180, c = Math.cos(ang), n = Math.sin(ang);
    const gx = drag.grab.x - geo.W / 2, gy = drag.grab.y - geo.h / 2, lift = drag.touch ? TUNE.touchLift * s.lift : 0;
    const rx = sc * (c * gx - n * gy) + geo.W / 2, ry = sc * (n * gx + c * gy) + geo.h / 2;
    // лист нельзя унести за край стола: иначе страница выросла бы под ним, и автопрокрутка не кончилась бы
    const maxY = parseFloat(host.style.height) - geo.h - TUNE.captionH - 8;
    s.x = clamp(drag.cx - rx, 0, geo.vw - geo.W); s.y = clamp(drag.cy + scrollPos() - ry - lift, 8, maxY); s.xV = s.yV = 0;
    if (dt) {
      const vx = (drag.cx - drag.lx) / dt; drag.lx = drag.cx; drag.ly = drag.cy;
      drag.vx += (vx - drag.vx) * Math.min(1, dt * 14);
      s.tiltT = clamp(drag.vx * TUNE.tiltPerSpeed, -TUNE.tiltMax, TUNE.tiltMax);
    }
    pickSlot();
  }

  // ---- события ----
  function down(s, e) {
    if (drag || pending || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'touch') {
      // Палец: сначала ждём. Короткое движение — это прокрутка, браузер сам пришлёт pointercancel.
      pending = { s, id: e.pointerId, x: e.clientX, y: e.clientY, ev: e, timer: setTimeout(() => { const p = pending; pending = null; if (p) { begin(p.s, p.ev); drag.cx = p.x; drag.cy = p.y; navigator.vibrate?.(8); } }, TUNE.holdMs) };
    } else { e.preventDefault(); begin(s, e); }
  }
  function move(e) {
    if (pending && e.pointerId === pending.id) {
      pending.ev = e;
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > TUNE.holdSlop) { clearTimeout(pending.timer); pending = null; }
      else { pending.x = e.clientX; pending.y = e.clientY; }
      return;
    }
    if (!drag || e.pointerId !== drag.pid) return;
    drag.cx = e.clientX; drag.cy = e.clientY; wake();
  }
  function up(e) {
    if (pending && e.pointerId === pending.id) { clearTimeout(pending.timer); pending = null; return; }
    if (drag && e.pointerId === drag.pid) {
      // последнее движение руки могло не дойти до кадра: учтём его до отпускания
      if (e.type === 'pointerup') { drag.cx = e.clientX; drag.cy = e.clientY; followHand(drag.s, 0); }
      finish(e.type === 'pointercancel');
    }
  }
  const key = e => { if (e.key === 'Escape' && drag) { e.preventDefault(); finish(true); } };
  // Палец уже взял лист: прокрутку страницы гасим (если браузер её ещё не начал).
  const touchmove = e => { if (drag?.touch && e.cancelable) e.preventDefault(); };
  const ctx = e => { if (drag || pending) e.preventDefault(); };
  for (const s of sheets) {
    s.slot.addEventListener('pointerdown', e => down(s, e));
    s.slot.addEventListener('pointermove', move);
    s.slot.addEventListener('pointerup', up);
    s.slot.addEventListener('pointercancel', up);
    s.slot.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.pid) finish(true); });
  }
  if (keys) addEventListener('keydown', key);
  addEventListener('touchmove', touchmove, { passive: false }); addEventListener('contextmenu', ctx);
  const onResize = () => relayout(false); addEventListener('resize', onResize);

  // ---- кадр: один requestAnimationFrame на всё ----
  function wake() { if (!raf && !dead) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  const put = (o, k, v, apply) => { if (o.w[k] !== v) { o.w[k] = v; apply(v); } };
  // Один шаг пружин листа или окна: обычный переезд, а при переносе на новую строку — две половины подряд.
  function stepMover(o, dt, om) {
    const h = o.hop, w = TUNE.hopOmega;
    if (h && h.phase === 'out') {
      spring(o, 'x', h.ex, w, 1, dt); spring(o, 'y', h.ey, w, 1, dt); spring(o, 'f', 0, w, 1, dt);
      if (o.f <= TUNE.hopFlip) {   // угас — переносим на полместа левее (правее) первого (последнего) места следующего ряда и проявляем
        h.phase = 'in'; o.x = o.tx - h.dir * geo.pitchX / 2; o.y = o.ty; o.yV = 0; o.f = 0; o.fV = 0; o.fT = 1;
      }
    } else if (h) {
      spring(o, 'x', o.tx, w, 1, dt); spring(o, 'y', o.ty, w, 1, dt); spring(o, 'f', 1, w, 1, dt);
      if (rest(o, 'x', o.tx) && rest(o, 'y', o.ty) && rest(o, 'f', 1, .01)) o.hop = null;
    } else {
      spring(o, 'x', o.tx, om, 1, dt); spring(o, 'y', o.ty, om, 1, dt); spring(o, 'f', o.fT, w, 1, dt);
    }
  }
  function tick(now) {
    raf = 0; const t0 = performance.now(), dt = clamp((now - last) / 1000, .001, .034); last = now;
    let busy = !!drag || !!pending;
    // автопрокрутка у края; рука стоит на месте, а страница едет — лист под рукой едет вместе с ней
    if (drag) {
      const vh = viewH(), top = drag.cy, bot = vh - drag.cy;
      let v = 0;
      if (top < TUNE.edge) v = -(Math.min(1.25, (TUNE.edge - top) / TUNE.edge) ** 1.6) * TUNE.scrollMax;
      else if (bot < TUNE.edge) v = Math.min(1.25, (TUNE.edge - bot) / TUNE.edge) ** 1.6 * TUNE.scrollMax;
      if (v) { scrollAcc += v * dt; const step = Math.trunc(scrollAcc); scrollAcc -= step; if (step) scrollDown(step); }
      else scrollAcc = 0;
    }
    const wPos = omegaFor(TUNE.neighborMs), wDrop = omegaFor(TUNE.dropMs);
    for (const s of sheets) {
      const held = drag?.s === s;
      if (held) {
        followHand(s, dt);
      } else {
        stepMover(s, dt, s.dropping ? wDrop : wPos);
      }
      spring(s, 'lift', s.liftT, TUNE.liftOmega, TUNE.liftZeta, dt);
      spring(s, 'tilt', s.tiltT, TUNE.tiltOmega, 1, dt);
      const still = !held && !s.hop && rest(s, 'x', s.tx) && rest(s, 'y', s.ty) && rest(s, 'f', s.fT, .01) && rest(s, 'lift', s.liftT, .002) && rest(s, 'tilt', s.tiltT, .02);
      if (still) { s.x = s.tx; s.y = s.ty; s.xV = s.yV = 0; s.f = s.fT; s.fV = 0; s.lift = s.liftT; s.liftV = 0; s.tilt = s.tiltT; s.tiltV = 0; if (s.dropping) { s.dropping = false; s.z = 0; s.slot.style.zIndex = ''; } }
      else busy = true;
      // только transform и opacity
      const q = v => Math.round(v * 20) / 20;
      put(s, 'pos', q(s.x) + ',' + q(s.y), () => { s.slot.style.transform = `translate3d(${q(s.x)}px,${q(s.y)}px,0)`; });
      put(s, 'op', Math.round(clamp(s.f, 0, 1) * 200), () => { s.slot.style.opacity = s.f > .995 ? 1 : clamp(s.f, 0, 1); });
      const L = clamp(s.lift, -.15, 1.15), a = Math.round((s.base + s.tilt) * 100) / 100, sc = Math.round((1 + (TUNE.liftScale - 1) * s.lift) * 1000) / 1000;
      put(s, 'pap', a + '|' + sc, () => {
        s.paper.style.transform = `rotate(${a}deg) scale(${sc})`;
      });
      put(s, 'sh', Math.round(L * 100), () => {
        s.shLift.style.opacity = clamp(L, 0, 1); s.shRest.style.opacity = clamp(1 - .65 * L, .2, 1);
      });
    }
    // окно на месте вставки
    stepMover(H, dt, wPos); spring(H, 'op', H.opT, 22, 1, dt);
    if (H.hop || !(rest(H, 'x', H.tx) && rest(H, 'y', H.ty) && rest(H, 'op', H.opT, .01) && rest(H, 'f', H.fT, .01))) busy = true;
    put(H, 'p', Math.round(H.x * 20) + ',' + Math.round(H.y * 20), () => { hole.style.transform = `translate3d(${H.x.toFixed(2)}px,${H.y.toFixed(2)}px,0)`; });
    put(H, 'o', Math.round(H.op * H.f * 200), () => { hole.style.opacity = clamp(H.op, 0, 1) * clamp(H.f, 0, 1); });
    onFrame?.(performance.now() - t0, dt);
    if (busy) raf = requestAnimationFrame(tick);
  }

  relayout(true);
  return {
    order: () => order.map(s => s.id),
    relayout, TUNE,
    holding: () => !!drag,
    cancel() { if (drag) finish(true); },
    // Снять всё, что повесили на окно, остановить кадр и очистить host: после этого объектом пользоваться нельзя.
    destroy() {
      if (dead) return; dead = true;
      if (drag) { try { drag.s.slot.releasePointerCapture(drag.pid); } catch { /* уже отпущен */ } drag = null; }
      if (pending) { clearTimeout(pending.timer); pending = null; }
      removeEventListener('keydown', key); removeEventListener('touchmove', touchmove); removeEventListener('contextmenu', ctx); removeEventListener('resize', onResize);
      cancelAnimationFrame(raf); raf = 0;
      host.classList.remove('shuffle', 'dragging'); host.style.height = ''; host.innerHTML = '';
    },
  };
}
