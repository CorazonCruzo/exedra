#!/usr/bin/env node
// Проверка локализации (Node 22, без зависимостей):  node tools/i18n/check.mjs [язык ...]
//  (a) кириллица в строках и шаблонах src/*.js (вне комментариев) и в видимом тексте index.html — кроме разрешённого ниже (надписи самого зала, служебное);
//  (b) каждый ключ из t('…') / tn('…') / data-i18n* есть в en.js и ru.js (и во всех языках, названных в аргументах);
//  (c) ключи en.js, которых нет в файле языка (по умолчанию ru), согласованность подстановок {имя} и форм множественного числа.
// Код возврата 1, если есть пропавшие ключи, лишняя кириллица или расхождения.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CYR = /[А-Яа-яЁё]/;
const langs = process.argv.slice(2).filter(a => !a.startsWith('-'));
const wantLangs = [...new Set(['en', 'ru', ...langs])];
let problems = 0;
const bad = (...a) => { problems++; console.log(...a); };

// ——— что разрешено оставить по-русски ———
// Целиком файлы: надписи самого зала (корешки, буквы на ящиках каталога), раскладка клавиатуры машинки, служебные тексты и данные.
const ALLOW_FILES = {
  'src/titles.js': 'надписи на корешках книг — часть сцены',
  'src/catalog.js': 'кириллические буквы на ящиках каталога — часть сцены',
  'src/i18n.js': 'родные названия языков',
  'src/typewriter.js': 'раскладка ЙЦУКЕН машинки (функция, не текст интерфейса)',
  'src/typeink.js': 'наборы знаков для оттиска краски (функция)',
  'src/label.js': 'названия вариантов ярлыка для ?label=… и образец для загрузки шрифта (не интерфейс)',
  'src/lounge.js': 'названия вариантов киноуголка для ?lounge=… (не интерфейс)',
  'src/bindings.js': 'описание источников переплётов в данных (не показывается)',
  'src/filmaudio.js': 'служебные причины и ошибки разбора (console, не интерфейс)',
  'src/filmaudio-worker.js': 'служебные ошибки воркера (не показываются)',
  'src/filmvideo.js': 'служебные ошибки; регулярка по тексту ошибки воркера',
  'src/filmvideo-worker.js': 'служебные ошибки воркера (не показываются)',
  'src/filmsubs.js': 'служебная ошибка разбора субтитров (не показывается)',
  'src/stand.js': 'служебная ошибка сборки модели',
  'src/pdf.js': 'строка Producer в метаданных PDF',
};
// Отдельные литералы в остальных файлах: [файл, начало литерала, причина].
const ALLOW_LITERALS = [
  ['src/room.js', ['БУРЯ', 'ДОЖДЬ', 'ПЕРЕМЕННО', 'ЯСНО', 'СУШЬ', 'Барометръ', 'миллиметры ртутнаго'], 'циферблат барометра — предмет сцены'],
  ['src/room.js', ['АаЙйЁё', 'не загрузилось:', 'На столе вещь с негодным', 'Шейдер не собрался'], 'образец для загрузки шрифта; сообщения в консоль'],
  ['src/cinema.js', ['формат не поддерживается'], 'ошибка, до экрана не доходит (проектор выводит свой текст)'],
  ['src/webplayers.js', ['not_?exist', 'embed|domain'], 'регулярки по русским текстам ошибок самих сайтов'],
  ['src/loader.js', ['зажигаю лампу', 'Зал не загрузился'], 'встроенная таблица заставки (ru)'],
];

// ——— токенайзер JS: строки, шаблоны, регулярки; комментарии пропускаются ———
const KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'void', 'delete', 'throw', 'yield', 'await', 'of']);
function literals(src) {
  const out = []; let i = 0, line = 1, last = null; const stack = [];   // stack: глубина фигурных скобок внутри ${ } шаблона
  const nl = s => { for (const c of s) if (c === '\n') line++; };
  const tpl = () => {   // читаем текст шаблона от i (после ` или }) до ${ или `
    let s = i, start = line;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { out.push({ text: src.slice(s, i), line: start, kind: 'template' }); nl(src.slice(s, i)); i++; last = 'v'; return; }
      if (c === '$' && src[i + 1] === '{') { out.push({ text: src.slice(s, i), line: start, kind: 'template' }); nl(src.slice(s, i)); i += 2; stack.push(0); last = '('; return; }
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); nl(src.slice(i, e + 2)); i = e + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; } out.push({ text: src.slice(i + 1, j), line, kind: 'string' }); i = j + 1; last = 'v'; continue; }
    if (c === '`') { i++; tpl(); continue; }
    if (c === '/') {
      if (last === 'v') { i++; last = '/'; continue; }   // деление
      let j = i + 1, cls = false; while (j < src.length) { const d = src[j]; if (d === '\\') j++; else if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; j++; }
      out.push({ text: src.slice(i, j + 1), line, kind: 'regexp' }); i = j + 1; while (/[a-z]/.test(src[i] ?? '')) i++; last = 'v'; continue;
    }
    if (c === '{') { if (stack.length) stack[stack.length - 1]++; i++; last = '{'; continue; }
    if (c === '}') { if (stack.length && stack[stack.length - 1] === 0) { stack.pop(); i++; tpl(); continue; } if (stack.length) stack[stack.length - 1]--; i++; last = '}'; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (/[\w$]/.test(src[j] ?? '')) j++; const w = src.slice(i, j); last = KW.has(w) ? 'k' : 'v'; i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (/[\w.]/.test(src[j] ?? '')) j++; i = j; last = 'v'; continue; }
    if (c === ')' || c === ']') { last = 'v'; i++; continue; }
    last = c; i++;
  }
  return out;
}

const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f);

// (a1) кириллица в JS
console.log('— (a) кириллица вне комментариев —');
let allowedSeen = 0;
for (const f of srcFiles) {
  const src = read(f), lits = literals(src);
  const hits = lits.filter(l => CYR.test(l.text));
  if (ALLOW_FILES[f]) { allowedSeen += hits.length; continue; }
  for (const h of hits) {
    const ok = ALLOW_LITERALS.some(([file, starts]) => file === f && starts.some(s => h.text.includes(s)));
    if (ok) { allowedSeen++; continue; }
    // шейдеры в шаблонах: русский только в комментариях GLSL (// …) — не текст интерфейса
    if (h.kind === 'template' && !h.text.split('\n').some(l => CYR.test(l.replace(/\/\/.*$/, '')))) { allowedSeen++; continue; }
    bad(`  ${f}:${h.line}: ${h.kind}: ${h.text.slice(0, 90).replace(/\n/g, '⏎')}`);
  }
}
// (a2) кириллица в index.html: видимый текст и атрибуты (без комментариев, <script>, <style>)
{
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  html.split('\n').forEach((l, i) => { if (CYR.test(l)) bad(`  index.html: ${l.trim().slice(0, 100)}`); });
}
console.log(`  разрешённых мест (надписи зала, служебное): ${allowedSeen}; файлов целиком: ${Object.keys(ALLOW_FILES).length}`);

// ——— словари ———
const load = async code => { try { return (await import(pathToFileURL(path.join(ROOT, `src/i18n/${code}.js`)).href)).default; } catch (e) { bad(`  не загрузился словарь ${code}: ${e.message}`); return {}; } };
const dicts = {}; for (const c of wantLangs) dicts[c] = await load(c);

// (b) ключи из кода и разметки
const used = new Map();   // ключ → [где]
const prefixes = new Map();
const addKey = (k, where) => { if (!used.has(k)) used.set(k, []); used.get(k).push(where); };
const addPrefix = (p, where) => { if (!prefixes.has(p)) prefixes.set(p, []); prefixes.get(p).push(where); };
// аргумент вызова: берём все строки и шаблоны внутри первого аргумента
function firstArg(src, from) {
  let depth = 0, i = from, s = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") { i++; while (src[i] !== c) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '`') { i++; let d = 0; while (!(src[i] === '`' && d === 0)) { if (src[i] === '\\') i++; else if (src[i] === '$' && src[i + 1] === '{') { d++; i++; } else if (src[i] === '}' && d > 0) d--; i++; } continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) { if (depth === 0) break; depth--; } else if (c === ',' && depth === 0) break;
  }
  return src.slice(s, i);
}
for (const f of srcFiles) {
  if (f === 'src/i18n.js') continue;   // сам модуль: примеры в комментариях
  const src = read(f);
  for (const m of src.matchAll(/`([a-z]+(?:\.[\w-]+)+\.)\$\{/g)) addPrefix(m[1], f);   // ключ, собранный из шаблона: префикс + значение
  for (const m of src.matchAll(/(?<![\w$.])(tn?)\(/g)) {
    const arg = firstArg(src, m.index + m[0].length), line = src.slice(0, m.index).split('\n').length;
    for (const s of arg.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\]*)`/g)) {
      const lit = s[1] ?? s[2] ?? s[3];
      if (s[3] != null && lit.includes('${')) addPrefix(lit.split('${')[0], `${f}:${line}`);
      else if (/^[a-z][\w]*(\.[\w-]+)+$/i.test(lit)) addKey(lit, `${f}:${line}`);
    }
  }
}
// динамические ключи, собираемые не в t(…): префикс + идентификатор (lib.c.<код> в filmlib.js — label('lib.c.', k, …); lib.short.<id> — шаблон)
for (const m of read('src/filmlib.js').matchAll(/label\('([\w.]+\.)'/g)) addPrefix(m[1], 'src/filmlib.js');
// коды ошибок воркера книги: code: 'book.err.…' в bookfile-worker.js и 'book.err.…' в fail(…)
for (const m of read('src/bookfile-worker.js').matchAll(/'(book\.err\.\w+)'/g)) addKey(m[1], 'src/bookfile-worker.js');
{
  const html = read('index.html');
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) addKey(m[1], 'index.html');
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) { const k = p.split(':')[1]?.trim(); if (k) addKey(k, 'index.html'); }
}
console.log('\n— (b) ключи из кода и разметки —');
console.log(`  ключей в коде и разметке: ${used.size}; динамических префиксов: ${prefixes.size}`);
for (const code of ['en', 'ru']) {
  const miss = [...used.keys()].filter(k => !(k in dicts[code]));
  if (miss.length) for (const k of miss) bad(`  нет ключа в ${code}.js: ${k}  (${used.get(k)[0]})`);
  else console.log(`  ${code}.js: все ключи на месте`);
  for (const [p, w] of prefixes) if (![...Object.keys(dicts[code])].some(k => k.startsWith(p))) bad(`  нет ни одного ключа с префиксом ${p} в ${code}.js (${w[0]})`);
}

// (c) сверка языков с английским
console.log('\n— (c) языки против en.js —');
const vars = v => [...new Set([...(typeof v === 'object' ? Object.values(v).join(' ') : String(v)).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort().join(',');
for (const code of wantLangs.filter(c => c !== 'en')) {
  const d = dicts[code], missing = Object.keys(dicts.en).filter(k => !(k in d)), extra = Object.keys(d).filter(k => !(k in dicts.en));
  console.log(`  ${code}: ключей ${Object.keys(d).length} из ${Object.keys(dicts.en).length}; нет: ${missing.length}; лишних: ${extra.length}`);
  for (const k of missing) bad(`    ${code}: нет ключа ${k}`);
  for (const k of extra) bad(`    ${code}: лишний ключ ${k}`);
  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  for (const k of Object.keys(d)) {
    if (!(k in dicts.en)) continue;
    if (vars(d[k]) !== vars(dicts.en[k]) && !(typeof dicts.en[k] === 'object' && typeof d[k] === 'object' && false)) bad(`    ${code}: подстановки в ${k} не совпадают с en: «${vars(d[k])}» ≠ «${vars(dicts.en[k])}»`);
    if (typeof d[k] === 'object') for (const c of cats) if (!(c in d[k])) bad(`    ${code}: в ${k} нет формы «${c}»`);
  }
}
{
  const cats = new Intl.PluralRules('en').resolvedOptions().pluralCategories;
  for (const [k, v] of Object.entries(dicts.en)) if (typeof v === 'object') for (const c of cats) if (!(c in v)) bad(`    en: в ${k} нет формы «${c}»`);
}
// ключи словаря, на которые нет ссылок (возможны ложные: динамические)
{
  const unused = Object.keys(dicts.en).filter(k => !used.has(k) && ![...prefixes.keys()].some(p => k.startsWith(p)));
  console.log(`\n— справка: ключей en.js без ссылок в коде: ${unused.length}${unused.length ? ' → ' + unused.join(', ') : ''}`);
}
console.log(problems ? `\nПРОБЛЕМ: ${problems}` : '\nВсё чисто: пропавших ключей нет, лишней кириллицы нет.');
process.exit(problems ? 1 : 0);
