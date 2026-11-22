// Тестовая обвязка для переноса вещей над всем: синтетические указатели, замер кадров. Грузится из страницы: await import('/tools/carry-harness.js').
const R = () => window.__rr;
const sc = (x, y, z) => { const w = R().toWorld(x, y, z); return R().project(...w); };
const ev = (type, t, x, y, b) => t.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: b, bubbles: true, cancelable: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// from: [x, z, высота хвата над столом] — где нажали; path: точки стола (x, z), по которым идёт хват; указатель водят на высоте хвата (пока несут — на высоте руки).
async function drag(from, path, o = {}) {
  const r = R(), dt = r.deskTop, ms = o.ms ?? 40, per = o.per ?? 8, log = [], cuts = [], moveT = []; let lastCarry = null;
  const p0 = sc(from[0], dt + (from[2] ?? .02), from[1]), cv = document.elementFromPoint(p0[0], p0[1]);
  const fr = []; let run = true, last = 0; const loop = () => { if (!run) return; const t = performance.now(); if (last) fr.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  ev('pointerdown', cv, p0[0], p0[1], 1); await sleep(ms);
  let cur = [from[0], from[1]], lastScr = p0;
  for (const q of path) {
    for (let i = 1; i <= per; i++) {
      const x = cur[0] + (q[0] - cur[0]) * i / per, z = cur[1] + (q[1] - cur[1]) * i / per, c = r.carry, y = dt + (c && c.on ? c.gy.v + c.gh : (from[2] ?? .02)), p = sc(x, y, z);
      const t0 = performance.now(); ev('pointermove', window, p[0], p[1], 1); if (r.carry) lastCarry = r.carry; moveT.push(performance.now() - t0); lastScr = p;
      await sleep(ms); if (o.sample) log.push(o.sample());
    }
    cur = q;
  }
  if (o.hold) await sleep(o.hold);
  ev('pointerup', window, lastScr[0], lastScr[1], 0);
  const after = []; if (o.after) for (let i = 0; i < (o.afterN ?? 12); i++) { await sleep(50); after.push(o.sample()); }
  run = false;
  const f = fr.slice(1).sort((a, b) => a - b), m = moveT.slice().sort((a, b) => a - b);
  return { pops: lastCarry && [lastCarry.pops ?? 0, +(lastCarry.popMax ?? 0).toFixed(4), lastCarry.popLog], log, after, fr: { n: f.length, med: +f[f.length >> 1]?.toFixed(1), p95: +f[Math.floor(f.length * .95)]?.toFixed(1), max: +f[f.length - 1]?.toFixed(1), over20: f.filter(x => x > 20).length }, move: { max: +m[m.length - 1]?.toFixed(2), med: +m[m.length >> 1]?.toFixed(2) } };
}
// Независимая проверка высоты: верх каждой вещи — по рамке видимых частей (мировые координаты), а не тем кодом, что считает подъём.
function topOf(obj) {
  const r = R(), V = r.camera.position.constructor, v = new V(); obj.updateWorldMatrix(true, true); let mx = -1e9;
  obj.traverseVisible(o => { const g = o.isMesh && o.geometry; if (!g?.attributes.position) return; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { v.set(x, y, z).applyMatrix4(o.matrixWorld); r.station.worldToLocal(v); mx = Math.max(mx, v.y); } });
  return mx - r.deskTop;
}
// Преграды (все вещи, кроме skip): { id, shape, top } — для проверки зазора. Папка — по толщине, машинка — по рамке всего (TW_TOP).
function obstacles(skip) {
  const r = R(), out = [], p = m => ({ x: m.x.v, z: m.z.v, r: m.rot.v });
  if (r.twM !== skip) out.push({ id: 'tw', shape: r.bodyShape({ c: r.TW_BASE }, p(r.twM)), top: topOf(r.tw.group) });
  if (r.lampM !== skip) out.push({ id: 'lamp', shape: r.bodyShape({ c: r.LAMP_BASE }, p(r.lampM)), top: topOf(r.lamp.group) });
  if (r.weightM !== skip) out.push({ id: 'weight', shape: r.slabBox(r.weightM.x.v, r.weightM.z.v, r.weightM.rot.v, 0), top: topOf(r.weight.group) });
  r.books.forEach((b, i) => { if (b !== skip && b.drawer === null) out.push({ id: 'book' + i, shape: r.bodyShape({ c: r.bookRect(b) }, p(b)), top: topOf(b.holder) }); });
  r.folders.forEach((f, i) => { if (f !== skip && f.drawer === null) out.push({ id: 'folder' + i, shape: { x: f.px.v, z: f.pz.v, r: f.pr.v, hw: f.foot[0] / 2, hd: f.foot[1] / 2 }, top: f.floor - r.deskTop + f.thick }); });
  return out;
}
// Форма несомой вещи сейчас (по видимому положению) и высота её низа.
function footOf(T) {
  const r = R(), isF = T.px !== undefined && T.b, bottom = isF ? T.floor - r.deskTop + Math.max(0, T.lift.v) : T.obj.position.y - r.deskTop;
  if (isF) return { shape: { x: T.px.v, z: T.pz.v, r: T.pr.v, hw: T.foot[0] / 2, hd: T.foot[1] / 2 }, bottom };
  const p = { x: T.x.v, z: T.z.v, r: T.rot.v };
  if (T === r.weightM) return { shape: r.slabBox(p.x, p.z, p.r, 0), bottom };
  if (T === r.lampM) return { shape: r.bodyShape({ c: r.LAMP_BASE }, p), bottom };
  return { shape: r.bodyShape({ c: r.bookRect(T) }, p), bottom };
}
const hit = (a, b) => a.R !== undefined ? (b.R !== undefined ? Math.hypot(a.x - b.x, a.z - b.z) < a.R + b.R : !!R().circleShift({ ...b }, a)) : (b.R !== undefined ? !!R().circleShift(a, b) : !!R().rectShift(a, b));
// Минимальный зазор снизу вещи над верхом того, над чем она проходит (только когда фигуры пересекаются по горизонтали): по пути. < 0 — вещь вошла в другую.
function clearance(T, obs) {
  const f = footOf(T); let min = Infinity, who = null;
  for (const o of obs) if (hit(f.shape, o.shape)) { const c = f.bottom - o.top; if (c < min) { min = c; who = o.id; } }
  return { min, who, bottom: f.bottom };
}
// Раскладка для испытаний: все вещи на известных местах (пружины — сразу).
async function reset() {
  const r = R(), B = [[.822, -.24], [-.54, .131], [.492, -.218]];
  for (const [m, x, z, rot] of [[r.lampM, -.62, -.17, .3], [r.twM, .02, -.02, 0], [r.weightM, -.339, .2, .4]]) { m.x.set(x); m.z.set(z); m.rot.set(rot); }
  r.books.forEach((b, i) => { b.x.set(B[i][0]); b.z.set(B[i][1]); b.rot.set(.1); });
  const f = r.folders[0]; f.px.set(.6); f.pz.set(.1); f.pr.set(0);
  await sleep(500);
}
const stats = a => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, med: +s[s.length >> 1]?.toFixed(2), max: +s[s.length - 1]?.toFixed(2) }; };
// Сценарий: несут T за точку на высоте gh над столом по путевым точкам со скоростью speed м/с (указатель ~60 Гц); отчёт: кадры, зазоры над каждой вещью, где легла.
async function scen(name, T, gh, way, o = {}) {
  const r = R(); await reset(); const LG = []; r.carryLog = LG; const obs = obstacles(T), isF = !!T.b, px = isF ? T.px : T.x, pz = isF ? T.pz : T.z, start = [px.t, pz.t];
  const sample = () => { const c = clearance(T, obs); return [+(isF ? T.px.v : T.x.v).toFixed(3), +(isF ? T.pz.v : T.z.v).toFixed(3), +c.bottom.toFixed(3), c.who, +c.min.toFixed(4)]; };
  const speed = o.speed ?? .5, ms = 16; let cur = start, per = 1; for (const q of way) { per = Math.max(per, Math.ceil(Math.hypot(q[0] - cur[0], q[1] - cur[1]) / (speed * ms / 1000))); cur = q; }
  const res = await drag([start[0], start[1], gh], way, { sample, after: true, per, ms, afterN: 14 });
  r.carryLog = null; const ov = res.log.filter(a => a[3]), by = {}; ov.forEach(a => { by[a[3]] = Math.min(by[a[3]] ?? 9, a[4]); });
  const end = res.after.slice(-1)[0];
  return { name, fr: res.fr, move: res.move, carryStep: stats(LG), pops: res.pops, minClear: by, maxH: Math.max(...res.log.map(a => a[2])), end, hang: end && end[2], err: r.frameErr[0] };
}
// Пары вещей, что входят друг в друга по рамкам (пресс-папье на папке не в счёт), и где что стоит (цели пружин).
const pairs = () => { const o = obstacles(null), bad = []; for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) if (hit(o[i].shape, o[j].shape)) { const id = o[i].id + 'x' + o[j].id; if (id !== 'weightxfolder0') bad.push(id); } return bad; };
const pos = () => { const r = R(), f = x => +x.toFixed(3); return { tw: [f(r.twM.x.t), f(r.twM.z.t)], lamp: [f(r.lampM.x.t), f(r.lampM.z.t)], w: [f(r.weightM.x.t), f(r.weightM.z.t)], b: r.books.map(b => [f(b.x.t), f(b.z.t)]), f: r.folders.map(q => [f(q.px.t), f(q.pz.t)]) }; };
// Отпустить над чем-то: где легла, как падала (высоты после отпускания), нет ли пересечений.
async function rel(name, T, gh, way, o = {}) {
  const r = R(); await reset(); await sleep(300); const obs = obstacles(T), isF = !!T.b;
  const sample = () => { const f = footOf(T), c = clearance(T, obs); return [+(isF ? T.px.v : T.x.v).toFixed(3), +(isF ? T.pz.v : T.z.v).toFixed(3), +f.bottom.toFixed(3), c.who, +c.min.toFixed(4)]; };
  const st = isF ? [T.px.t, T.pz.t] : [T.x.t, T.z.t], res = await drag([st[0], st[1], gh], way, { sample, after: true, per: 20, ms: 16, afterN: 20, hold: 200 }), fin = res.after.slice(-1)[0];
  const minAfter = Math.min(...res.after.filter(a => a[3]).map(a => a[4]), 9), heights = res.after.map(a => a[2]);
  return { name, pops: res.pops && res.pops[0], fin, landAt: isF ? [+T.px.t.toFixed(3), +T.pz.t.toFixed(3)] : [+T.x.t.toFixed(3), +T.z.t.toFixed(3)], minClearWhileFalling: minAfter, heights: heights.filter((a, i) => i % 2 === 0), pairs: pairs(), err: r.frameErr[0] };
}
export { R, sc, ev, sleep, drag, topOf, obstacles, footOf, clearance, hit, reset, scen, stats, pairs, pos, rel };
