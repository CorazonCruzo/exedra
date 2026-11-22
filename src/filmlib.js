// Фильмотека немого кино: подборка (assets/cinema/catalog.json, ~100 фильмов по разделам, итальянское первым) и весь архив Wikimedia Commons
// (assets/cinema/commons-index.json, тысячи лент: десятилетие, страна, тема, длина, поиск). Данные грузятся при первом открытии, не со стартом зала.
// Фильм из архива — один запрос к API Commons по нажатию: лёгкий поток (480p VP9, если оригинал тяжёлый или .ogv) и подпись (лицензия, автор).
// Модуль сам строит свою панель; зал даёт корень и `play(film)`: { name, url, credit, page, silent, vtt? }.

import { t, lang } from './i18n.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? t('lib.dur.hm', { h, m }) : m ? t('lib.dur.m', { m }) : t('lib.dur.s', { s }); };
const plain = html => { const d = document.createElement('div'); d.innerHTML = String(html ?? ''); return d.textContent.replace(/\s+/g, ' ').trim(); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// Поток и подпись файла Commons: оригинал .webm, если он лёгкий (≤ 60 МБ), иначе — производный 480p (VP9, затем любой WebM).
export async function commonsStream(file) {
  const title = file.startsWith('File:') ? file : 'File:' + file;
  const q = `${API}?action=query&format=json&origin=*&prop=videoinfo&viprop=url|size|mime|derivatives|extmetadata&titles=${encodeURIComponent(title)}`;
  const r = await fetch(q); if (!r.ok) throw new Error(`Commons: ${r.status}`);
  const page = Object.values((await r.json()).query?.pages ?? {})[0], vi = page?.videoinfo?.[0];
  if (!vi) throw new Error(t('lib.err.noFile'));
  const clean = u => u.replace(/\?utm_[^#]*/, '');
  const der = vi.derivatives ?? [], pick = re => der.find(d => re.test(d.src))?.src;
  const light = vi.mime === 'video/webm' && vi.size <= 60e6;
  const url = clean(light ? vi.url : pick(/480p\.vp9\.webm$/) ?? pick(/480p.*\.webm$/) ?? pick(/\d+p\.vp9\.webm$/) ?? (vi.mime === 'video/webm' ? vi.url : null) ?? '');
  if (!url) throw new Error(t('lib.err.noStream'));
  const m = vi.extmetadata ?? {}, lic = plain(m.LicenseShortName?.value), who = plain(m.Artist?.value);
  return { url, credit: [lic, who].filter(Boolean).join(' · '), page: vi.descriptionurl };
}

// Короткие подписи разделов подборки для кнопок.
// Подпись раздела на кнопке: из словаря (`lib.short.<id>`), иначе — полное название из переводов подборки.
let GROUPS = {};
const shortOf = g => { const k = `lib.short.${g}`, s = t(k); return s === k ? GROUPS[g] ?? g : s; };
// Тексты подборки (название, режиссёр, примечание) — в assets/cinema/i18n/<язык>.json; нет перевода на язык зала — английский.
const loadOverlay = async code => { try { const r = await fetch(`assets/cinema/i18n/${code}.json`); return r.ok ? await r.json() : null; } catch { return null; } };

export function filmLibrary({ root, play }) {
  let catalog = null, index = null, tab = 'pick', shown = 60;
  const panel = el('div', 'filmlib'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', t('lib.title'));
  const head = el('div', 'fl-head'), title = el('h3', '', t('lib.title')), close = el('button', 'fl-close', '×'); close.type = 'button'; close.setAttribute('aria-label', t('common.close'));
  const tabs = el('div', 'fl-tabs'), tPick = el('button', 'on', t('lib.tab.pick')), tAll = el('button', '', t('lib.tab.all'));
  tPick.type = tAll.type = 'button'; tabs.append(tPick, tAll); head.append(title, tabs, close);
  const filters = el('div', 'fl-filters'); filters.hidden = true;
  const search = el('input'); search.type = 'search'; search.placeholder = t('lib.search'); search.spellcheck = false;
  const sel = (label, opts) => { const s = el('select'); s.setAttribute('aria-label', label); s.append(...opts.map(([v, t]) => new Option(t, v))); return s; };
  const fDec = sel(t('lib.dec'), [['', t('lib.dec.all')], ['1870', t('lib.dec.1870')], ['1900', t('lib.dec.1900')], ['1910', t('lib.dec.1910')], ['1920', t('lib.dec.1920')], ['1930', t('lib.dec.1930')]]);
  const fCountry = sel(t('lib.country'), [['', t('lib.country.all')]]), fTheme = sel(t('lib.theme'), [['', t('lib.theme.all')]]);
  const fLen = sel(t('lib.len'), [['', t('lib.len.any')], ['s', t('lib.len.s')], ['m', t('lib.len.m')], ['l', t('lib.len.l')]]);
  filters.append(search, fDec, fCountry, fTheme, fLen);
  const count = el('p', 'fl-count'), list = el('div', 'fl-list'), more = el('button', 'fl-more', t('lib.more')); more.type = 'button'; more.hidden = true;
  panel.append(head, filters, count, list, more); root.appendChild(panel); panel.hidden = true;

  const item = (f, onPick) => {
    const b = el('button', 'fl-item'); b.type = 'button';
    b.append(el('b', '', f.title), el('span', 'fl-meta', [...new Set([f.year, f.place, f.director, f.dur ? fmtDur(f.dur) : '', f.heavy || f.mb > 150 ? t('lib.meta.heavy') : '', f.sound ? t('lib.meta.sound') : ''])].filter(Boolean).join(' · ')));
    if (f.note) b.append(el('span', 'fl-note', f.note));
    b.onclick = () => onPick(f, b); return b;
  };
  const go = async (f, b) => {
    b?.classList.add('busy');
    try {
      const s = f.stream && !f.file ? { url: f.stream, credit: f.credit, page: f.page } : await commonsStream(f.file);
      api.close(); play({ name: f.year && !String(f.title).includes(f.year) ? `${f.title}, ${f.year}` : f.title, url: s.url, credit: s.credit || f.credit || '', page: s.page || f.page || '', silent: !f.sound, vtt: f.vtt });
    } catch (e) { console.warn(e); count.textContent = t('lib.openFail', { title: f.title, msg: e.message }); }
    finally { b?.classList.remove('busy'); }
  };

  // Подборка: разделы по порядку файла (итальянское первым), в разделе — по году.
  // Подборка: строка коротких кнопок (все, Италия, Россия… — в порядке файла, Италия первой) и поиск; список сплошной, по годам, страна — в строке фильма.
  let pickGroup = '';
  // Порядок: по длине (короткие сначала — по умолчанию), по известности (на скольких страницах Википедий на разных языках есть фильм, `fame`), по году.
  const ORDERS = { len: (a, b) => (a.dur || 0) - (b.dur || 0), fame: (a, b) => (b.fame || 0) - (a.fame || 0) || (a.dur || 0) - (b.dur || 0), year: (a, b) => (a.year || 0) - (b.year || 0) };
  const pickOrder = el('select'); pickOrder.className = 'fl-order'; pickOrder.setAttribute('aria-label', t('lib.order'));
  pickOrder.append(new Option(t('lib.order.len'), 'len'), new Option(t('lib.order.fame'), 'fame'), new Option(t('lib.order.year'), 'year'));
  pickOrder.addEventListener('change', () => renderPick());
  const chips = el('div', 'fl-chips'), pickSearch = el('input'); chips.hidden = pickSearch.hidden = true;
  pickSearch.type = 'search'; pickSearch.placeholder = t('lib.search'); pickSearch.spellcheck = false; pickSearch.className = 'fl-search';
  pickSearch.addEventListener('input', () => renderPick());
  const pickRow = el('div', 'fl-pickrow'); pickRow.append(pickSearch, pickOrder); pickRow.hidden = true;
  panel.insertBefore(pickRow, count); panel.insertBefore(chips, count);
  function renderPick() {
    list.replaceChildren(); more.hidden = true; filters.hidden = true; chips.hidden = pickRow.hidden = pickSearch.hidden = false;
    if (!catalog) { count.textContent = t('lib.loading'); return; }
    if (!chips.childElementCount) {
      const groups = ['', ...new Set(catalog.map(f => f.group))];
      chips.append(...groups.map(g => { const b = el('button', g === pickGroup ? 'on' : '', g ? shortOf(g) : t('lib.all')); b.type = 'button'; b.onclick = () => { pickGroup = g; for (const c of chips.children) c.classList.toggle('on', c === b); renderPick(); }; return b; }));
    }
    const q = pickSearch.value.trim().toLowerCase();
    const hits = catalog.filter(f => (!pickGroup || f.group === pickGroup) && (!q || `${f.title} ${f.year ?? ''} ${f.director ?? ''} ${f.note ?? ''}`.toLowerCase().includes(q))).sort(ORDERS[pickOrder.value]);
    count.textContent = t('lib.count.pick', { n: hits.length, total: catalog.length });
    list.replaceChildren(...hits.map(f => item({ ...f, place: pickGroup ? '' : shortOf(f.group) }, go)));
  }
  // Весь архив: фильтры и поиск по загруженному индексу, по 60 строк.
  function matches(f) {
    const q = search.value.trim().toLowerCase();
    if (q && !`${f.title} ${f.year ?? ''} ${f.director ?? ''} ${f.file}`.toLowerCase().includes(q)) return false;
    const d = +fDec.value, y = f.year || 0;
    if (fDec.value && (d === 1870 ? !(y && y < 1900) : d === 1930 ? y < 1930 : !(y >= d && y < d + 10))) return false;
    if (fCountry.value && !f.countries?.includes(fCountry.value)) return false;
    if (fTheme.value && !f.themes?.includes(fTheme.value)) return false;
    const m = (f.dur || 0) / 60;
    if (fLen.value === 's' ? !(m && m < 5) : fLen.value === 'm' ? !(m >= 5 && m <= 25) : fLen.value === 'l' ? !(m > 25) : false) return false;
    return true;
  }
  function renderAll() {
    filters.hidden = false;
    if (!index) { list.replaceChildren(); more.hidden = true; count.textContent = t('lib.loadingAll'); return; }
    const hits = index.films.filter(matches);
    count.textContent = t('lib.count.all', { n: hits.length, total: index.films.length });
    list.replaceChildren(...hits.slice(0, shown).map(f => item(f, go))); more.hidden = hits.length <= shown;
  }
  const render = () => { if (tab !== 'pick') chips.hidden = pickRow.hidden = true; return tab === 'pick' ? renderPick() : renderAll(); };
  for (const c of [search, fDec, fCountry, fTheme, fLen]) c.addEventListener(c === search ? 'input' : 'change', () => { shown = 60; renderAll(); });
  more.onclick = () => { shown += 60; renderAll(); };
  tPick.onclick = () => { tab = 'pick'; tPick.classList.add('on'); tAll.classList.remove('on'); render(); };
  tAll.onclick = () => { tab = 'all'; tAll.classList.add('on'); tPick.classList.remove('on'); loadIndex(); render(); };
  close.onclick = () => api.close();
  for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') api.close(); });

  async function loadCatalog() {
    if (catalog) return;
    try {
      const [d, own, en] = await Promise.all([fetch('assets/cinema/catalog.json').then(r => r.json()), loadOverlay(lang), lang === 'en' ? null : loadOverlay('en')]);
      const ov = own ?? en; GROUPS = { ...en?.groups, ...own?.groups };
      const tx = (id, k) => ov?.films?.[id]?.[k] ?? en?.films?.[id]?.[k];
      catalog = (d.films ?? d).map(f => normPick(f, tx));
    }
    catch (e) { console.warn(e); count.textContent = t('lib.err.pick'); return; }
    if (tab === 'pick') render();
  }
  async function loadIndex() {
    if (index) return;
    try { index = normIndex(await (await fetch('assets/cinema/commons-index.json')).json()); }
    catch (e) { console.warn(e); count.textContent = t('lib.err.all'); return; }
    fCountry.append(...index.countries.map(([v, t]) => new Option(t, v))); fTheme.append(...index.themes.map(([v, t]) => new Option(t, v)));
    if (tab === 'all') render();
  }
  const api = {
    open(which = 'pick') { panel.hidden = false; (which === 'all' ? tAll : tPick).click(); loadCatalog(); },
    close() { panel.hidden = true; },
    get isOpen() { return !panel.hidden; },
  };
  return api;
}

// Подборка: запись каталога + тексты на языке зала (tx) → { title, year, director, dur, note, group, stream, credit, page }.
function normPick(f, tx) {
  return { title: tx(f.id, 'title') ?? f.title ?? '', year: f.year, director: tx(f.id, 'director') ?? f.director, dur: f.durationSec, note: tx(f.id, 'note') ?? f.note, group: f.group, stream: f.stream ?? f.streamUrl,
    credit: [f.license, tx(f.id, 'attribution') ?? f.attribution].filter(Boolean).join(' · '), page: f.commonsPage, heavy: !!f.heavy, sound: !!f.modernAudio, fame: f.fame || 0 };
}
// Архив (tools/cinema/build-commons-index.mjs): строка фильма — [имя файла, год, длительность с, размер МБ, подсказка потока, маска стран, маска тем, номер лицензии];
// бит маски — номер в списках `countries` / `themes`. Здесь — к общему виду { file, title, year, dur, countries, themes, license } и подписям фильтров на языке зала.
const label = (pre, k, en) => { const key = pre + k, s = t(key); return s === key ? en : s; };   // подпись из словаря (`lib.c.<код>`, `lib.th.<код>`), иначе — английская из самого индекса
// Название из имени файла Commons — без служебных хвостов загрузчиков: « - yt», «HD», «Best Quality», «( 240p, H 264)», « - Full Movie», « - Public Domain …».
const cleanTitle = file => file.replace(/\.(webm|ogv|ogg)$/i, '').replace(/_/g, ' ')
  .replace(/\s*-\s*yt$/i, '').replace(/\s*-\s*(Full Movie|Public Domain.*)$/i, '').replace(/,?\s*Best Quality/i, '').replace(/\s*\(\s*\d{3,4}p[^)]*\)/i, '').replace(/\s+HD\b/g, '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
function normIndex(d) {
  const C = d.countries ?? [], T = d.themes ?? [], L = d.licenses ?? [];
  const bits = (m, list) => list.filter((_, i) => m & (1 << i)).map(([k]) => k);
  const films = (d.films ?? []).map(([file, year, dur, mb, , cm, tm, li]) => ({
    file, year, dur, mb, countries: bits(cm, C), themes: bits(tm, T), license: L[li] ?? '',
    title: cleanTitle(file),
  }));
  return { films, countries: C.map(([k, en]) => [k, label('lib.c.', k, en)]), themes: T.map(([k, en]) => [k, label('lib.th.', k, en)]) };
}
