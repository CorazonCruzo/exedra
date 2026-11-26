// Корзина для бумаг: экран поверх зала, как у перетасовки (shuffle-screen.js), — сукно, на нём всё, что выброшено, последнее первым (пользователь 2026-11-26:
// «достать последний — точно неудобный механизм. там должно быть что-то типа интерфейса такого же, как при раскладывании листов в подшивке»).
// Выброшенная папка — не обложка, а раздел: её название, под ним её листы (её же просьба: «внутри папки (даже с её названием)… обычная вложенная структура…
// подшивки я в той корзине визуально видеть не хочу, но в целом можно выбирать возврат целой папки»). У раздела — «вернуть папку» (с её листами);
// нажатие на лист — этот лист возвращается в зал один. Насовсем — «вынести корзину», вторым нажатием в течение 5 с.
// Пока экран открыт, зал не рисуется (`binOpen()`) и не слышит ни указателя, ни клавиш.
//   openBin({ items, onTake(key), onEmpty() }); items — по порядку показа: лист { key, kind: 'sheet', page: { lines, fmt, seed }, title, sub }
//   или папка { key, kind: 'folder', title, sub, sheets: [лист…] }.
import { drawPage } from './paper.js';
import { t } from './i18n.js';

let current = null;
export const binOpen = () => !!current;

const FADE = 200, SURE_MS = 5000;
const STOP = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'gesturestart', 'gesturechange', 'gestureend'];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function openBin({ items, onTake, onEmpty }) {
  if (current || !items.length) return;
  const root = el('div', 'shuf bin'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', t('bin.title'));
  root.innerHTML = `<div class="shuf-scroll"><h2 class="bin-title"></h2><div class="bin-field"></div></div>`
    + `<button class="key shuf-done" data-tip="${t('common.done')}" aria-label="${t('common.done')}"><svg><use href="#i-done"/></svg></button>`
    + `<button class="bin-out" type="button"></button>`
    + `<div class="shuf-said on">${t('bin.hint')}</div>`;
  const scroller = root.firstChild, head = scroller.firstChild, field = scroller.lastChild, [, doneBtn, outBtn, said] = root.children;
  head.textContent = t('bin.title');
  document.body.appendChild(root);

  // Листы — карточками своей страницы; страницы рисуются по одной, когда браузер свободен.
  const W = innerWidth < 560 ? 120 : 196, px = Math.round(W * Math.min(2, devicePixelRatio || 1)), queue = [], canvases = [];
  let left = 0, closing = false;
  const card = (it, parent, group) => {
    const b = el('button', 'bin-card'); b.type = 'button'; b.style.setProperty('--w', W + 'px');
    const paper = el('span', 'bin-paper'), c = el('canvas'); paper.appendChild(c); canvases.push(c); queue.push([c, it.page]);
    const cap = el('span', 'bin-cap'); cap.append(el('b', '', it.title), el('i', '', it.sub));
    b.append(paper, cap); parent.appendChild(b); left++;
    b.onclick = () => { if (closing || b.classList.contains('gone')) return; b.classList.add('gone'); onTake(it.key); gone(); if (group) group.taken(); };
  };
  // Папка: раздел во всю ширину — название, сколько листов, «вернуть папку»; под ним её листы.
  const folder = it => {
    const sec = el('section', 'bin-folder'), top = el('div', 'bin-fhead'), name = el('b', '', it.title), sub = el('i', '', it.sub), back = el('button', 'bin-back', t('bin.folderBack'));
    back.type = 'button'; top.append(name, sub, back);
    const row = el('div', 'bin-fsheets'); sec.append(top, row); field.appendChild(sec); left++;
    const g = { taken() { if (!row.querySelector('.bin-card:not(.gone)')) sub.textContent = t('bin.folderEmpty'); } };
    if (!it.sheets.length) sub.textContent = t('bin.folderEmpty');
    for (const s of it.sheets) card(s, row, g);
    back.onclick = () => {
      if (closing || sec.classList.contains('gone')) return;
      const rest = row.querySelectorAll('.bin-card:not(.gone)').length;
      sec.classList.add('gone'); onTake(it.key); left -= rest; gone();
    };
  };
  for (const it of items) it.kind === 'folder' ? folder(it) : card(it, field);
  let pumpT = 0, sureT = 0;
  const pump = () => { pumpT = 0; if (closing || !queue.length) return; const [c, p] = queue.shift(); drawPage(c, p, px); pumpT = setTimeout(pump, 0); };
  requestAnimationFrame(() => { if (!closing) pumpT = setTimeout(pump, 0); });
  // Всё вернули (листы и разделы папок) — экран закрывается сам.
  function gone() { if (--left <= 0) setTimeout(() => close(), 260); }

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
    setTimeout(() => { for (const c of canvases) c.width = c.height = 0; root.remove(); }, FADE + 40);
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
