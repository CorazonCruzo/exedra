// Подставка для книги (assets/models/bookstand, описание и таблица ступеней — notes.md там же). В зале она появляется только в режиме чтения: открытая книга ложится на рамку,
// нижним обрезом на полочку; когда режим кончается, подставка исчезает, а книга снова лежит на столе.
// Оси модели: X — ширина, Y — вверх, +Z — к читателю; начало — на столе в середине основания. Узлы: base, rack (неподвижны), frame (шарнир внизу, поворот вокруг +X) и в нём strut (распорка,
// поворот вокруг +X относительно рамки). Шесть ступеней зубчатой планки — углы рамки 60…23°; между ступенями плавно крутить нельзя (остриё распорки сидит в выемке), поэтому смена ступени —
// короткая анимация (`StandRig`): рамка чуть приподнимается, распорка выходит из выемки и перескакивает, рамка садится.
import * as THREE from 'three';
import { shadows } from './util.js';

export const STAND_URL = 'assets/models/bookstand/bookstand-chocolate.glb';
// frameRotX и strutLocalRotX из extras.bookstand.notches модели; deg — угол рамки к столу.
export const NOTCH = [
  { deg: 60.0, f: 0, s: 0 },
  { deg: 55.0, f: -.08731, s: .22543 },
  { deg: 49.08, f: -.19055, s: .46709 },
  { deg: 42.2, f: -.31064, s: .73371 },
  { deg: 33.97, f: -.45426, s: 1.04238 },
  { deg: 23.17, f: -.6428, s: 1.43867 },
];
export const NOTCHES = NOTCH.length;
// Ось шарниров рамки (y, z) от начала модели и размеры рамки, измеренные по сетке (в мм по рамке в позе 60°; u — вдоль рамки вверх от шарнира, w — от рамки к читателю):
// лицевая плоскость реек и перекладин — w = 10,6 мм, верх полочки (на нём стоит нижний обрез книги) — u = 17,5 мм, полочка выступает до w = 35,6 мм.
export const HINGE = { y: .01314, z: .14694 };
export const FRAME = { w: .0106, u: .0175, ledge: .0356 };
const ZERO = .0003;   // зазор книги над деревом (чтобы не мигало)
// Остриё распорки в её осях и шарнир распорки в осях рамки (из сетки): по ним считается, где остриё при любом повороте рамки и распорки.
const PIN = { y: .10944, z: -.06518 }, TIP = { y: -.11658, z: -.03625 };
const rot2 = (y, z, a) => [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
// Высота острия распорки над столом при повороте рамки fr и распорки sr.
export function tipY(fr, sr) {
  const [ty, tz] = rot2(TIP.y, TIP.z, sr), [wy] = rot2(PIN.y + ty, PIN.z + tz, fr);
  return HINGE.y + wy;
}
const FOLD_SR = 1.45;   // поворот распорки, когда подставка сложена
const ease = u => u * u * (3 - 2 * u);

// Положение тела книги (точка (0, 0, Dz/2) — нижний передний угол на плоскости стола — стоит на полочке, плоскость стола лежит на рамке), если рамка наклонена на th радианов:
// возвращает { y, z, rx } — положение начала тела в осях подставки и поворот вокруг X.
export function bookPlace(th, Dz) {
  const s = Math.sin(th), c = Math.cos(th), u = FRAME.u + ZERO, w = FRAME.w + ZERO;
  const cy = HINGE.y + u * s + w * c, cz = HINGE.z - u * c + w * s;   // точка на полочке у рамки
  return { y: cy + Dz / 2 * s, z: cz - Dz / 2 * c, rx: th };
}

export class StandRig {
  constructor(root) {
    this.group = root; this.frame = root.getObjectByName('frame'); this.strut = root.getObjectByName('strut');
    if (!this.frame || !this.strut) throw new Error('подставка: нет узлов frame/strut');
    this.n = 3; this.fr = NOTCH[2].f; this.sr = NOTCH[2].s; this.anim = null; this.onNotch = null; this.k = 1; this.apply();
  }
  get angle() { return Math.PI / 3 + this.fr; }   // угол рамки к столу, рад
  get moving() { return !!this.anim; }
  // k — насколько подставка разложена: 1 — стоит на ступени, 0 — сложена (рамка лежит, распорка вдоль неё): так она раскладывается и складывается, когда книгу раскрывают и закрывают.
  apply() { const k = this.k; this.frame.rotation.x = k * this.angle - Math.PI / 3; this.strut.rotation.x = this.sr * k + FOLD_SR * (1 - k); }
  // Сразу на ступень n (1…6).
  set(n) { this.n = Math.min(NOTCHES, Math.max(1, n | 0)); this.anim = null; this.fr = NOTCH[this.n - 1].f; this.sr = NOTCH[this.n - 1].s; this.apply(); }
  // На ступень n с анимацией (из того положения, где сейчас).
  go(n) {
    n = Math.min(NOTCHES, Math.max(1, n | 0)); if (n === this.n) return;
    const t = NOTCH[n - 1], hop = Math.abs(n - this.n) <= 1 ? 1 : 1.25;
    this.anim = { a: { f: this.fr, s: this.sr }, b: t, u: 0, dur: .34 + .07 * Math.min(3, Math.abs(n - this.n)), hop, rang: false };
    this.n = n;
  }
  // Каждый кадр. true — что-то движется (книга едет вместе с рамкой, нужны тени и вид).
  step(dt) {
    const m = this.anim; if (!m) return false;
    m.u = Math.min(1, m.u + dt / m.dur);
    const e = ease(m.u), bump = Math.sin(Math.PI * m.u);
    // Рамка: к новому углу и чуть выше по пути (приподнялась и села); распорка: к новому повороту и ещё отведена от планки — остриё выходит из выемки и перескакивает.
    this.fr = m.a.f + (m.b.f - m.a.f) * e + .035 * bump;
    this.sr = m.a.s + (m.b.s - m.a.s) * e + .08 * m.hop * Math.pow(bump, 1.4);   // середина пути: остриё на 16–18 мм над столом, планка — 12
    if (!m.rang && m.u >= .86) { m.rang = true; this.onNotch?.(); }
    if (m.u >= 1) { this.fr = m.b.f; this.sr = m.b.s; this.anim = null; }
    this.apply(); return true;
  }
}

// Подставка книги `thing`: копия модели (сетки и материал общие — шейдеров не прибавляется), слои 0 и 1 (зал и режим чтения), тени, невидима, пока книга на столе плашмя.
// Лежит в держателе книги (`holder`): едет и поворачивается вместе с ней.
export function buildStand(model, thing) {
  const root = model.clone(true); root.name = 'bookstand';
  shadows(root, true, true);
  root.traverse(o => { o.layers.enable(0); o.layers.enable(1); if (o.isMesh) o.frustumCulled = false; });
  root.visible = false; root.userData.stand = true; root.userData.thing = thing;
  return new StandRig(root);
}
