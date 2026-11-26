// Корзина для бумаг: экран поверх зала, как у перетасовки (shuffle-screen.js), — сукно, на нём всё, что выброшено, последнее первым (пользователь 2026-11-26:
// «достать последний — точно неудобный механизм. там должно быть что-то типа интерфейса такого же, как при раскладывании листов в подшивке»).
// Нажали на лист или папку — вещь возвращается в зал туда, откуда её выбросили (`onTake`), и уходит с сукна; «вынести корзину» — всё насовсем (`onEmpty`),
// вторым нажатием в течение 5 с. Пока экран открыт, зал не рисуется (`binOpen()`) и не слышит ни указателя, ни клавиш.
//   openBin({ items: [{ key, kind: 'sheet' | 'folder', page: { lines, fmt, seed } | null, title, sub }], onTake(key), onEmpty() })
import { drawPage } from './paper.js';
import { t } from './i18n.js';

let current = null;
export const binOpen = () => !!current;

const FADE = 200, SURE_MS = 5000;
const STOP = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'gesturestart', 'gesturechange', 'gestureend'];

export function openBin({ items, onTake, onEmpty }) {
  if (current || !items.length) return;
  const root = document.createElement('div');
  root.className = 'shuf bin'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', t('bin.title'));
  root.innerHTML = `<div class="shuf-scroll"><h2 class="bin-title"></h2><div class="bin-field"></div></div>`
    + `<button class="key shuf-done" data-tip="${t('common.done')}" aria-label="${t('common.done')}"><svg><use href="#i-done"/></svg></button>`
    + `<button class="bin-out" type="button"></button>`
    + `<div class="shuf-said on">${t('bin.hint')}</div>`;
  const scroller = root.firstChild, head = scroller.firstChild, field = scroller.lastChild, [, doneBtn, outBtn, said] = root.children;
  head.textContent = t('bin.title');
  document.body.appendChild(root);

  // Карточки: лист — его страница; папка — первая страница на двух подложках, как стопка в обложке. Страницы рисуются по одной, когда браузер свободен.
  const W = innerWidth < 560 ? 120 : 196, px = Math.round(W * Math.min(2, devicePixelRatio || 1)), queue = [];
  const cards = items.map(it => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bin-card is-' + it.kind; b.style.setProperty('--w', W + 'px');
    const paper = document.createElement('span'); paper.className = 'bin-paper';
    const c = document.createElement('canvas'); paper.appendChild(c); if (it.page) queue.push([c, it.page]);
    const cap = document.createElement('span'); cap.className = 'bin-cap'; cap.innerHTML = '<b></b><i></i>'; cap.firstChild.textContent = it.title; cap.lastChild.textContent = it.sub;
    b.append(paper, cap); field.appendChild(b);
    b.onclick = () => take(it, b);
    return b;
  });
  let pumpT = 0, sureT = 0, closing = false;
  const pump = () => { pumpT = 0; if (closing || !queue.length) return; const [c, p] = queue.shift(); drawPage(c, p, px); pumpT = setTimeout(pump, 0); };
  requestAnimationFrame(() => { if (!closing) pumpT = setTimeout(pump, 0); });

  let left = items.length;
  function take(it, b) {
    if (closing || b.classList.contains('gone')) return;
    b.classList.add('gone'); onTake(it.key);
    if (!--left) setTimeout(() => close(), 260);
  }
  // «Вынести корзину»: первое нажатие спрашивает, второе (в течение 5 с) — выносит.
  const outIdle = () => { outBtn.textContent = t('bin.out'); outBtn.classList.remove('sure'); };
  outIdle();
  outBtn.onclick = () => {
    if (!outBtn.classList.contains('sure')) { outBtn.textContent = t('bin.outSure'); outBtn.classList.add('sure'); clearTimeout(sureT); sureT = setTimeout(outIdle, SURE_MS); return; }
    clearTimeout(sureT); onEmpty(); close();
  };

  function close(fromHistory = false) {
    if (closing) return; closing = true; current = null;
    removeEventListener('keydown', onKey, true); removeEventListener('popstate', onPop);
    clearTimeout(pumpT); clearTimeout(sureT);
    if (!fromHistory && history.state?.bin) history.back();
    root.style.pointerEvents = 'none'; root.classList.remove('on');
    setTimeout(() => { for (const b of cards) { const c = b.querySelector('canvas'); c.width = c.height = 0; } root.remove(); }, FADE + 40);
  }
  const onKey = e => { e.stopImmediatePropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onPop = () => close(true);
  addEventListener('keydown', onKey, true);
  addEventListener('popstate', onPop);
  history.pushState({ bin: true }, '');
  for (const ev of STOP) root.addEventListener(ev, e => e.stopPropagation());
  root.addEventListener('pointerdown', () => said.classList.remove('on'));
  doneBtn.onclick = () => close();

  current = { close };
  void root.offsetWidth; root.classList.add('on');
  setTimeout(() => said.classList.remove('on'), 8000);
}
