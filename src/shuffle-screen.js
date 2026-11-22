// Экран перетасовки: поверх зала на весь экран открывается сукно с листами одной папки, порядок меняют перетаскиванием (shuffle.js).
// Пока экран открыт, зал не рисуется (`shuffleOpen()` — для его кадра) и не слышит ни указателя, ни клавиш.
//   openShuffle({ sheets, onApply, onDrop }): sheets — листы папки по порядку ({ id, lines, fmt, seed }); onApply(ids) — «готово», порядок
//   от первого к последнему; onDrop() — лист опустили на место. Esc и «назад» закрывают без onApply.
import { createShuffle } from './shuffle.js';
import { drawPage } from './paper.js';
import { t } from './i18n.js';

let current = null;
export const shuffleOpen = () => !!current;

const FADE = 200;   // мс: экран появляется и уходит прозрачностью
const HINT = t('shuffle.hint');
const HINT_MS = 8000;
// Эти события не идут дальше экрана: иначе зал под ним двигался бы (взгляд, жесты, лампа…).
const STOP = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'gesturestart', 'gesturechange', 'gestureend'];

// Лист — такой крупный, какой помещается без прокрутки (до 260 точек), чтобы первые строки читались; не помещается — 150.
function fitW(n) {
  for (let w = 260; w > 150; w -= 10) {
    const cols = Math.max(1, Math.floor((Math.min(innerWidth, 1680) - 56 + 22) / (w + 22)));
    if (84 + Math.ceil(n / cols) * (w * 1448 / 1024 + 48) <= innerHeight - 16) return w;
  }
  return 150;
}

export function openShuffle({ sheets, onApply, onDrop }) {
  if (current || sheets.length < 2) return;
  const n = sheets.length, pageW = fitW(n);
  const root = document.createElement('div');
  root.className = 'shuf'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', t('shuffle.title'));
  root.innerHTML = '<div class="shuf-scroll"><div class="shuf-field"></div></div>'
    + `<button class="key shuf-done" data-tip="${t('common.done')}" aria-label="${t('common.done')}"><svg><use href="#i-done"/></svg></button>`
    + `<div class="shuf-said">${HINT}</div>`;
  const scroller = root.firstChild, host = scroller.firstChild, said = root.lastChild, doneBtn = root.children[1];
  document.body.appendChild(root);

  const items = sheets.map(s => ({ id: s.id, sheet: s, canvas: document.createElement('canvas'), drawn: false }));
  const api = createShuffle({ host, items, width: pageW, scroller, keys: false, onDrop: () => onDrop?.() });

  // Страницы рисуются по одной, когда браузер свободен, — ближайшие к окну первыми; экран открыт сразу.
  const px = Math.min(640, Math.round(pageW * Math.min(n > 80 ? 1 : 2, devicePixelRatio || 1)));
  let pumpT = 0, hintT = 0, closing = false;
  function pump() {
    pumpT = 0; if (closing) return;
    const view = scroller.getBoundingClientRect();
    let best = null, bk = Infinity;
    for (const it of items) {
      if (it.drawn) continue;
      const r = it.canvas.getBoundingClientRect();
      const away = r.bottom < view.top ? view.top - r.bottom : r.top > view.bottom ? r.top - view.bottom : 0;
      const k = away > 0 ? 1e6 + away : r.top * 10 + r.left;   // видимые — по строкам сверху вниз, потом ближайшие
      if (k < bk) { bk = k; best = it; }
    }
    if (!best) return;
    best.drawn = true; drawPage(best.canvas, best.sheet, px);
    pumpT = setTimeout(pump, 0);
  }
  requestAnimationFrame(() => { if (!closing) pumpT = setTimeout(pump, 0); });
  // Если зал рядом дорисовывает страницы, на прокрутке очередь перестраивается сама: каждый шаг выбирает ближайшую к окну.

  // ——— Закрытие ———
  const hideHint = () => { clearTimeout(hintT); said.classList.remove('on'); };
  function close(apply, fromHistory = false) {
    if (closing) return; closing = true; current = null;
    removeEventListener('keydown', onKey, true); removeEventListener('popstate', onPop);
    clearTimeout(pumpT); hideHint();
    if (!fromHistory && history.state?.shuffle) history.back();
    if (apply) onApply?.(api.order());
    root.style.pointerEvents = 'none'; root.classList.remove('on');
    setTimeout(() => { api.destroy(); for (const it of items) it.canvas.width = it.canvas.height = 0; root.remove(); }, FADE + 40);
  }
  const onKey = e => {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (api.holding()) api.cancel(); else close(false); }
  };
  const onPop = () => close(false, true);
  addEventListener('keydown', onKey, true);
  addEventListener('popstate', onPop);
  history.pushState({ shuffle: true }, '');

  for (const t of STOP) root.addEventListener(t, e => e.stopPropagation());
  root.addEventListener('pointerdown', hideHint);
  doneBtn.onclick = () => close(true);

  current = { close };
  void root.offsetWidth; root.classList.add('on');
  said.classList.add('on'); hintT = setTimeout(hideHint, HINT_MS);
}
