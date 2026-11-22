// Обучение — игрой: табличка в стиле плашки проектора слева внизу, одно задание за раз. Задание засчитывается само, когда человек сделал нужное
// действие в зале (не кнопкой «дальше»): зал отдаёт сюда «показания» (`api`), обучение раз в четверть секунды сверяет их с тем, что было в начале шага.
// Засчитано — латунная галочка, табличка вспыхивает ободком, звенит колокольчик машинки, через миг — следующее задание. «Пропустить шаг» — если
// действие сейчас не сделать (нет под рукой PDF); «выйти» и Esc — в любой момент. Пройденное помнится (localStorage): вернулись — «продолжим или
// начнём сначала?»; пройдено целиком — само больше не предлагается, но запускается из справки и «убранства».

import { t } from './i18n.js';

const KEY = 'exedra.tour';
// Шаги: id; check(api, at) — сделано ли (at — показания в начале шага); how — подсказка «как» (мышь / касание — свои).
const STEPS = [
  { id: 'look', check: (a, at) => Math.abs(a.yaw() - at.yaw) > .35 || Math.abs(a.pitch() - at.pitch) > .25 },
  // Пройтись: набрать метр пути в любую сторону (у стены шаг вперёд упирается — тогда считается и шаг вбок или назад) или приблизить взгляд колесом.
  { id: 'walk', check: (a, at) => at.path > 1 || Math.abs(a.fov() - at.fov) > 4 },
  { id: 'seat', check: a => a.lastView() === 'seat' && a.pressed('seat') },
  { id: 'fs', check: a => a.fullscreen() },
  { id: 'type', check: (a, at) => a.typed() >= 1 || a.sheets() > at.sheets },   // первый же знак на листе (или лист уже вынули — значит, напечатали)
  { id: 'eject', check: (a, at) => a.sheets() > at.sheets },
  { id: 'file', check: (a, at) => a.filed() > at.filed },
  { id: 'folder', check: (a, at) => a.folders() > at.folders },
  { id: 'drawer', check: (a, at) => a.inDrawers() > at.inDrawers },
  { id: 'book', check: (a, at) => a.booksWithFile() > at.booksWithFile || (at.booksWithFile > 0 && a.reading()) },
  { id: 'flip', check: (a, at) => a.spreadSum() !== at.spreadSum },
  { id: 'stand', check: (a, at) => a.onStand() !== at.onStand },
  { id: 'nook', check: a => a.inNook() },
  { id: 'film', check: a => a.silentFilm() },
];
const snap = a => ({ yaw: a.yaw(), pitch: a.pitch(), eye: a.eye().clone(), fov: a.fov(), path: 0, last: a.eye().clone(), sheets: a.sheets(), filed: a.filed(), folders: a.folders(), inDrawers: a.inDrawers(),
  booksWithFile: a.booksWithFile(), spreadSum: a.spreadSum(), onStand: a.onStand() });

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const store = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

export function makeTour({ root, api, touch, ding }) {
  let st = load() ?? { done: [], skipped: [], finished: false, step: 0 }, on = false, at = null, timer = 0, flash = 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const plate = el('div', 'tour'); plate.setAttribute('role', 'status'); plate.hidden = true;
  const head = el('div', 'tour-head'), task = el('div', 'tour-task'), how = el('div', 'tour-how'), bar = el('div', 'tour-bar'), foot = el('div', 'tour-foot');
  const skip = el('button', 'tour-link'), quit = el('button', 'tour-link'); skip.type = quit.type = 'button';
  foot.append(skip, quit); plate.append(head, task, how, bar, foot); root.appendChild(plate);
  // Вопрос: начать / продолжить / сначала — та же табличка.
  const ask = el('div', 'tour tour-ask'); ask.hidden = true; root.appendChild(ask);

  const save = () => store(st);
  function render() {
    const i = st.step, s = STEPS[i];
    head.textContent = t('tour.head', { n: i + 1, total: STEPS.length });
    if (s) { task.replaceChildren(t(`tour.${s.id}.t`)); how.textContent = t(`tour.${s.id}.${touch() && t(`tour.${s.id}.touch`) !== `tour.${s.id}.touch` ? 'touch' : 'how'}`); }
    // Отрезки полоски — шаги: нажать — перейти к этому шагу (вернуться к пройденному или забежать вперёд).
    bar.replaceChildren(...STEPS.map((x, k) => { const b = el('i', st.done.includes(x.id) ? 'd' : k === i ? 'n' : ''); b.title = t(`tour.${x.id}.t`); b.onclick = () => goTo(k); return b; }));
    skip.textContent = t('tour.skip'); quit.textContent = t('tour.quit');
    skip.hidden = !s;
  }
  function begin() { at = snap(api); api.clearPressed(); api.resetTyped(); render(); }
  function tick() {
    if (!on) return;
    const s = STEPS[st.step]; if (!s || flash) return;
    at.path += api.eye().distanceTo(at.last); at.last.copy(api.eye());
    if (s.check(api, at)) {
      flash = 1; if (!st.done.includes(s.id)) st.done.push(s.id); save();
      task.replaceChildren(el('span', 'tour-ok', '✓'), t(`tour.${s.id}.ok`)); plate.classList.add('done'); bar.children[st.step]?.classList.add('d'); ding?.();
      setTimeout(() => { plate.classList.remove('done'); flash = 0; next(); }, 1400);
    }
  }
  function goTo(k) { if (flash || k === st.step) return; st.step = k; save(); begin(); }
  function next() {
    st.step++; save();
    if (st.step >= STEPS.length) return finish();
    begin();
  }
  function finish() {
    st.finished = true; st.active = false; st.step = STEPS.length; save();
    head.textContent = t('tour.doneHead'); task.replaceChildren(t('tour.doneTask')); how.textContent = t('tour.doneHow');
    bar.replaceChildren(...STEPS.map(() => el('i', 'd'))); skip.hidden = true; quit.textContent = t('tour.close');
  }
  function start(from = st.step) {
    ask.hidden = true; on = true; st.step = Math.min(from, STEPS.length - 1); if (from === 0) { st.done = []; st.skipped = []; st.finished = false; }
    st.active = true; save(); plate.hidden = false; begin(); clearInterval(timer); timer = setInterval(tick, 250);
  }
  function stop() { st.active = false; save(); on = false; plate.hidden = true; ask.hidden = true; clearInterval(timer); }
  skip.onclick = () => { const s = STEPS[st.step]; if (s && !st.skipped.includes(s.id)) st.skipped.push(s.id); skip.blur(); next(); };
  quit.onclick = () => { quit.blur(); stop(); };
  function offer(kind) {
    // kind: 'first' — первый вход; 'resume' — пройдено не до конца; 'again' — пройдено целиком
    const q = el('div', 'tour-task', t(`tour.ask.${kind}`)), sub = el('div', 'tour-how', t(`tour.ask.${kind}.sub`)), row = el('div', 'tour-row');
    const b = (txt, cls, fn) => { const x = el('button', cls, txt); x.type = 'button'; x.onclick = fn; return x; };
    if (kind === 'resume') row.append(b(t('tour.continue'), 'tour-btn main', () => start(st.step)), b(t('tour.restart'), 'tour-btn', () => start(0)));
    else row.append(b(t(kind === 'first' ? 'tour.start' : 'tour.restart'), 'tour-btn main', () => start(0)));
    row.append(b(t('tour.notNow'), 'tour-link', () => { ask.hidden = true; if (kind === 'first') { st.offered = true; save(); } }));
    ask.replaceChildren(el('div', 'tour-head', t('tour.title')), q, sub, row); ask.hidden = false; plate.hidden = true; on = false;
  }
  return {
    // Из справки / «убранства»: по состоянию — начать, продолжить или пройти заново.
    open() { if (on) return; offer(st.finished ? 'again' : st.step > 0 || st.done.length ? 'resume' : 'first'); },
    // При входе в зал: предложить один раз, если ни разу не предлагали и не проходили.
    // Страницу перезагрузили посреди обучения — спросить, продолжить ли.
    welcome() { if (st.active && !st.finished) offer('resume'); else if (!st.offered && !st.finished && !st.done.length) offer('first'); },
    get on() { return on || !ask.hidden; }, get asking() { return !ask.hidden; },
    // Esc закрывает только вопрос; само обучение — клавишей «выйти» (Esc в зале занят: отойти от машинки, вернуться к столу — это шаги обучения).
    escape() { if (!ask.hidden) { ask.hidden = true; if (!st.done.length) { st.offered = true; save(); } return true; } return false; },
  };
}
