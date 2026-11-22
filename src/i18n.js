// Языки Экседры. По умолчанию — английский; при первом входе язык выбирается по языкам браузера (navigator.languages), потом — тот, что выбран
// в «убранстве» (запоминается в localStorage). Смена языка перезагружает страницу: так на новом языке оказывается всё сразу — заставка, клавиши,
// подсказки, надписи на холстах и текстурах; расстановка зала хранится отдельно и не теряется.
//
// Словари — src/i18n/<код>.js: `export default { ключ: 'текст' }`. Основа — en.js: ключа нет в словаре языка — берётся английский, нет и там — сам ключ
// (так пропуск виден сразу). Подстановки — {имя}: t('cinema.playing', { name }). Числа с падежами — объект по правилам Intl.PluralRules:
// { one: '{n} фильм', few: '{n} фильма', many: '{n} фильмов', other: '{n} фильма' } → tn('lib.films', n).
// В разметке: data-i18n="ключ" (текст элемента), data-i18n-html="ключ" (разметка из словаря — только для своих строк с <b>, <br>),
// data-i18n-attr="placeholder:ключ; aria-label:ключ; data-tip:ключ" (атрибуты). applyDom() проставляет их при старте.

export const LANGS = [
  ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['fr', 'Français'], ['pt', 'Português'],
  ['ja', '日本語'], ['zh', '中文'], ['el', 'Ελληνικά'], ['ru', 'Русский'],
];
const CODES = new Set(LANGS.map(([c]) => c));
export const LANG_KEY = 'exedra.lang';

// Язык: выбранный раньше, иначе первый подходящий из языков браузера (pt-BR → pt, zh-TW → zh), иначе английский.
export function pickLang() {
  try { const s = localStorage.getItem(LANG_KEY); if (s && CODES.has(s)) return s; } catch {}
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const c = String(l).toLowerCase().split('-')[0];
    if (CODES.has(c)) return c;
  }
  return 'en';
}

export let lang = 'en';
let dict = {}, base = {};
const rules = new Map();

// Загрузить словари (основа и выбранный язык). Вызывается один раз, до того как зал что-то пишет.
export async function loadLang(code = pickLang()) {
  base = (await import('./i18n/en.js')).default;
  dict = code === 'en' ? base : await import(`./i18n/${code}.js`).then(m => m.default, e => { console.warn('i18n:', code, e); return base; });
  lang = code; document.documentElement.lang = code;
  return code;
}

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : String(s));
// Текст по ключу (с подстановками).
export function t(key, vars) {
  const s = dict[key] ?? base[key];
  if (s == null) return key;
  return fill(typeof s === 'object' ? s.other ?? Object.values(s)[0] : s, vars);
}
// Текст с числом: форма по правилам языка (one / few / many / other …); {n} — само число, отформатированное по языку.
export function tn(key, n, vars = {}) {
  const s = dict[key] ?? base[key];
  if (s == null) return key;
  if (typeof s !== 'object') return fill(s, { n: n.toLocaleString(lang), ...vars });
  if (!rules.has(lang)) rules.set(lang, new Intl.PluralRules(lang));
  const form = rules.get(lang).select(n);
  return fill(s[form] ?? s.other, { n: n.toLocaleString(lang), ...vars });
}
// Есть ли перевод ключа на выбранном языке (не английская подстановка).
export const has = key => dict[key] != null;

// Разметка: проставить тексты и атрибуты по data-i18n*.
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(x => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

// Сменить язык: запомнить и перезагрузить страницу.
export function setLang(code) {
  if (!CODES.has(code) || code === lang) return;
  try { localStorage.setItem(LANG_KEY, code); } catch {}
  location.reload();
}

// Словари грузятся при первом импорте модуля (await верхнего уровня): любой модуль, импортирующий i18n.js, уже может звать t(), даже при своей загрузке.
await loadLang();
