#!/usr/bin/env node
// Builds assets/cinema/commons-index.json: a compact index of the silent-film videos on
// Wikimedia Commons (Category:Silent films videos plus country / theme categories).
// Re-runnable, Node 22, no dependencies. Polite: serial MediaWiki API requests, ~1.5 s apart,
// maxlag=5, descriptive User-Agent (see commons-api.mjs). No video files are fetched.
//
//   node tools/cinema/build-commons-index.mjs
//   CACHE_DIR=/some/dir node tools/cinema/build-commons-index.mjs   # reuse raw API answers while developing
//
// Output format is documented in assets/cinema/README.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api, apiAll, stats } from './commons-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(root, 'assets/cinema/commons-index.json');
const CACHE = process.env.CACHE_DIR;
const LOG = process.env.API_LOG;
if (CACHE) mkdirSync(CACHE, { recursive: true });

async function cached(name, fn) {
  if (CACHE && existsSync(join(CACHE, name))) return JSON.parse(readFileSync(join(CACHE, name), 'utf8'));
  const v = await fn();
  if (CACHE) writeFileSync(join(CACHE, name), JSON.stringify(v));
  return v;
}

// ---- dimensions -----------------------------------------------------------------------
// Country list: bit i of the `countries` mask = COUNTRIES[i].code
const COUNTRIES = [
  ['it', 'Italy', 'Italy'],
  ['fr', 'France', 'France'],
  ['ru', 'Russia / USSR', 'Russia|Soviet Union|Russian Empire|Russian SFSR'],
  ['us', 'United States', 'United States'],
  ['gb', 'United Kingdom', 'United Kingdom|England|Scotland|Wales'],
  ['de', 'Germany', 'Germany|Weimar Republic'],
  ['es', 'Spain and Latin America', 'Spain|Argentina|Mexico|Chile|Cuba|Uruguay|Peru|Colombia|Venezuela|Bolivia'],
  ['jp', 'Japan', 'Japan'],
  ['dk', 'Denmark', 'Denmark'],
  ['se', 'Sweden', 'Sweden'],
  ['nl', 'Netherlands', 'Netherlands'],
  ['br', 'Brazil', 'Brazil'],
  ['in', 'India', 'India'],
  ['pl', 'Poland', 'Poland'],
  ['at', 'Austria', 'Austria'],
];
// Theme list: bit i of the `themes` mask
const THEMES = [
  ['pathe-baby', 'Pathé-Baby 9.5 mm'],
  ['trick', 'Trick films'],
  ['dance', 'Dance'],
  ['trains', 'Trains'],
  ['laugh-o-gram', 'Laugh-O-Gram'],
  ['newsreel', 'Newsreels'],
  ['eye', 'Eye Filmmuseum'],
];
// Category -> tag, for members found by crawling those categories directly (themes: with direct subcategories).
const THEME_CATS = {
  'pathe-baby': ['Pathé-Baby films'],
  trick: ['Trick films videos'],
  dance: ['Silent era dance videos'],
  trains: ['Silent films videos of trains'],
  'laugh-o-gram': ['Laugh-O-Gram'],
  newsreel: ['Kino-Pravda', 'Kinonedelja', 'Newsreels'],
  eye: ['Eye Filmmuseum'],
};
const COUNTRY_CATS = {
  it: ['Silent films of Italy'], fr: ['Silent films of France'], ru: ['Silent films of Russia', 'Kino-Pravda', 'Kinonedelja'],
  de: ['Silent films of Germany'], dk: ['Silent films of Denmark'], se: ['Silent films of Sweden'], jp: ['Silent films of Japan'],
  es: ['Silent films of Spain', 'Silent films of Argentina', 'Segundo de Chomón'], br: ['Silent films of Brazil'], in: ['Silent films of India'],
  gb: ['Silent films of the United Kingdom'], us: ['Silent films of the United States'], pl: ['Silent films of Poland'], at: ['Silent films of Austria'],
};
// Only these shelves are expanded one level into subcategories ('Newsreels' alone has thousands of unrelated films below it).
const SUBCAT_OK = new Set(['Pathé-Baby films', 'Trick films videos', 'Laugh-O-Gram', 'Eye Filmmuseum']);
const EXCLUDE_CATS = ['Videos from Polissons et galipettes'];
// A file is dropped when any of its category names matches this (adult content).
const ADULT_RE = /porn|erotic|nudity|\bnude\b|sexual|\bsex\b|striptease|topless|lingerie|polissons|stag films?|adult films?/i;

const countryRes = COUNTRIES.map(([code, , names]) => [code, new RegExp(`\\b(?:of|from|in)\\s+(?:the\\s+)?(?:${names})$`)]);

// ---- crawl ----------------------------------------------------------------------------
const VI = {
  action: 'query', prop: 'videoinfo', viprop: 'size|mime|derivatives|extmetadata',
  viextmetadatafilter: 'DateTimeOriginal|LicenseShortName|Categories|ObjectName',
};

const mainPages = await cached('main.json', () =>
  apiAll({ ...VI, generator: 'categorymembers', gcmtitle: 'Category:Silent films videos', gcmtype: 'file', gcmlimit: '50' }, { logFile: LOG }));
console.error(`main category: ${mainPages.length} files`);

// members of one category (files + direct subcategories), cheap list query
async function members(cat, type = 'file|subcat') {
  const out = [];
  let cont = {};
  for (;;) {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmtype: type, cmlimit: '500', ...cont }, { logFile: LOG });
    out.push(...j.query.categorymembers);
    if (!j.continue) break;
    cont = j.continue;
  }
  return out;
}

const tagTitles = { themes: new Map(), countries: new Map() }; // title -> Set(tag)
const excluded = new Set();
const add = (m, title, tag) => (m.has(title) ? m.get(title).add(tag) : m.set(title, new Set([tag])));

async function crawlCat(cat, kind, tag) {
  const mem = await cached(`cat-${cat}.json`, async () => {
    const top = await members(cat);
    const files = top.filter((m) => m.ns === 6).map((m) => m.title);
    // one level of subcategories only for theme shelves; country categories hold one subcategory per film
    if (kind === 'exclude' || SUBCAT_OK.has(cat)) {
      for (const s of top.filter((m) => m.ns === 14)) {
        const sub = await members(s.title.replace(/^Category:/, ''), 'file');
        files.push(...sub.map((m) => m.title));
      }
    }
    return files;
  });
  for (const t of mem) {
    if (kind === 'exclude') excluded.add(t);
    else add(kind === 'theme' ? tagTitles.themes : tagTitles.countries, t, tag);
  }
  console.error(`  ${kind} ${tag ?? ''} ${cat}: ${mem.length}`);
}

for (const cat of EXCLUDE_CATS) await crawlCat(cat, 'exclude');
for (const [tag, cats] of Object.entries(THEME_CATS)) for (const c of cats) await crawlCat(c, 'theme', tag);
for (const [tag, cats] of Object.entries(COUNTRY_CATS)) for (const c of cats) await crawlCat(c, 'country', tag);

// files found only in theme/country categories (not in the main category): fetch their info too
const have = new Set(mainPages.map((p) => p.title));
const extra = [...new Set([...tagTitles.themes.keys(), ...tagTitles.countries.keys()])].filter((t) => !have.has(t));
const extraPages = await cached('extra.json', async () => {
  const res = [];
  for (let i = 0; i < extra.length; i += 50) {
    const j = await api({ ...VI, titles: extra.slice(i, i + 50).join('|') }, { logFile: LOG });
    res.push(...j.query.pages);
  }
  return res;
});
console.error(`extra files outside main category: ${extra.length}`);

// ---- build records --------------------------------------------------------------------
const YEAR_NAME = /\((?:[^()]*?[ ,.\-–])?((?:18[6-9]\d|19[0-4]\d))(?:[^()0-9][^()]*)?\)/;
const YEAR_ANY = /\b(18[6-9]\d|19[0-4]\d)\b/;
function yearOf(name, em) {
  let m = name.match(YEAR_NAME);
  if (m) return +m[1];
  const d = em.DateTimeOriginal?.value;
  if (d) {
    m = String(d).replace(/<[^>]+>/g, ' ').match(YEAR_ANY);
    if (m) return +m[1];
  }
  const cats = (em.Categories?.value ?? '').split('|');
  for (const c of cats) {
    m = c.match(/^(?:Videos of )?(18[6-9]\d|19[0-4]\d) (?:films|from)/);
    if (m) return +m[1];
  }
  m = name.match(YEAR_ANY);
  return m ? +m[1] : 0;
}

const rejected = { noVideoinfo: 0, adult: 0, excluded: 0, noWebm: 0, notVideo: 0, duplicates: 0, outsideEra: 0 };
let recs = [];
const mainSet = new Set(mainPages.map((p) => p.title));
for (const pg of [...mainPages, ...extraPages]) {
  const vi = pg.videoinfo?.[0];
  if (!vi) { rejected.noVideoinfo++; continue; }
  if (!/^video\/|^application\/ogg$/.test(vi.mime || '')) { rejected.notVideo++; continue; }
  if (excluded.has(pg.title)) { rejected.excluded++; continue; }
  const em = vi.extmetadata ?? {};
  const cats = (em.Categories?.value ?? '').split('|').filter(Boolean);
  if (cats.some((c) => ADULT_RE.test(c))) { rejected.adult++; continue; }

  const name = pg.title.replace(/^File:/, '');
  // files outside the main category are only taken when clearly from the silent era
  if (!mainSet.has(pg.title)) { const y = yearOf(name, em); if (y < 1860 || y > 1935) { rejected.outsideEra++; continue; } }
  const isWebm = /\.webm$/i.test(name) && /webm/.test(vi.mime);
  const vp9 = (vi.derivatives ?? []).filter((d) => /\.vp9\.webm$/.test(d.transcodekey ?? ''));
  const best480 = vp9.find((d) => d.transcodekey === '480p.vp9.webm') ?? [...vp9].sort((a, b) => b.height - a.height).find((d) => d.height <= 480) ?? vp9[vp9.length - 1];
  if (!isWebm && !best480) { rejected.noWebm++; continue; }
  // stream hint: 0 = the original WebM; otherwise the height of the preferred VP9 transcode
  // (originals over 60 MB and non-WebM originals use the transcode when it exists)
  const heavy = vi.size > 60 * 1048576;
  const stream = isWebm && (!heavy || !best480) ? 0 : best480.height;

  const themes = new Set(tagTitles.themes.get(pg.title) ?? []);
  const countries = new Set(tagTitles.countries.get(pg.title) ?? []);
  for (const c of cats) {
    for (const [code, re] of countryRes) if (re.test(c)) countries.add(code);
    if (/Segundo de Chomón/.test(c)) countries.add('es');
    if (/Edison|Biograph|^American silent films/.test(c)) countries.add('us');
    if (/\bParis\b|Pathé|Lumière|Méliès|Gaumont|Exposition Universelle/.test(c)) countries.add('fr');
    if (/^Pathé-Baby/.test(c)) themes.add('pathe-baby');
    if (/^Trick films/.test(c)) themes.add('trick');
    if (/dance videos|^Silent era dance/.test(c)) themes.add('dance');
    if (/videos of trains|^Silent films videos of trains/.test(c)) themes.add('trains');
    if (/^Laugh-O-Gram/.test(c)) themes.add('laugh-o-gram');
    if (/^Kino-Pravda|^Kinonedelja|[Nn]ewsreels?$/.test(c)) themes.add('newsreel');
    if (/^Eye Filmmuseum|EYE Film|Open Beelden|^EYE FLM/i.test(c)) themes.add('eye');
  }
  const mask = (set, list) => list.reduce((a, [code], i) => (set.has(code) ? a | (1 << i) : a), 0);
  recs.push({
    name,
    year: yearOf(name, em),
    dur: Math.round(vi.duration || 0),
    mb: Math.max(1, Math.round(vi.size / 1048576)),
    stream,
    cm: mask(countries, COUNTRIES),
    tm: mask(themes, THEMES),
    lic: (String(em.LicenseShortName?.value ?? '').replace(/<[^>]+>/g, '').trim() || '?').replace(/^Public Domain$/, 'Public domain'),
  });
}

// duplicates: same normalized name (no extension, "- yt", resolution tags, accents) and similar duration
const norm = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\.(webm|ogv|ogg|mp4|mpg|mpeg|mov)$/, '').replace(/[\s_]*-\s*yt$/, '')
  .replace(/\b(hd|4k|1080p|720p|480p|restored|remastered|colou?r|\[[^\]]*\])\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const rank = (r) => (r.stream === 0 ? 2 : 1) * 1e6 + (/ - yt\./.test(r.name) ? 0 : 5e5) + Math.min(r.mb, 400);
const groups = new Map();
for (const r of recs) {
  const k = norm(r.name);
  (groups.get(k) ?? groups.set(k, []).get(k)).push(r);
}
const dropSet = new Set();
for (const g of groups.values()) {
  if (g.length < 2) continue;
  g.sort((a, b) => rank(b) - rank(a));
  for (const r of g.slice(1)) if (Math.abs(r.dur - g[0].dur) <= Math.max(3, g[0].dur * 0.03)) { dropSet.add(r); rejected.duplicates++; if (process.env.VERBOSE) console.error(`dup: ${r.name}  ->  ${g[0].name}`); }
  // keep the union of tags on the survivor
  for (const r of g.slice(1)) if (dropSet.has(r)) { g[0].cm |= r.cm; g[0].tm |= r.tm; }
}
recs = recs.filter((r) => !dropSet.has(r));
recs.sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.name.localeCompare(b.name));

const licenses = [...new Set(recs.map((r) => r.lic))].sort((a, b) => recs.filter((r) => r.lic === b).length - recs.filter((r) => r.lic === a).length);
const out = {
  v: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'Wikimedia Commons, Category:Silent films videos and country/theme categories (tools/cinema/build-commons-index.mjs)',
  countries: COUNTRIES.map(([code, label]) => [code, label]),
  themes: THEMES.map(([code, label]) => [code, label]),
  licenses,
  // [file name without "File:", year (0 = unknown), duration s, original size MB, stream hint, countries mask, themes mask, license index]
  fields: ['name', 'year', 'durSec', 'sizeMb', 'stream', 'countries', 'themes', 'license'],
  films: recs.map((r) => [r.name, r.year, r.dur, r.mb, r.stream, r.cm, r.tm, licenses.indexOf(r.lic)]),
};
const text = '{\n' + Object.entries(out).map(([k, v]) => k === 'films'
  ? ` "films": [\n${v.map((f) => '  ' + JSON.stringify(f)).join(',\n')}\n ]`
  : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
writeFileSync(OUT, text);

// ---- report ---------------------------------------------------------------------------
const dec = {}; const cn = {}; const th = {};
for (const r of recs) {
  const d = !r.year ? 'unknown' : r.year < 1900 ? '<1900' : `${Math.floor(r.year / 10) * 10}s`;
  dec[d] = (dec[d] ?? 0) + 1;
  let any = false;
  COUNTRIES.forEach(([c], i) => { if (r.cm & (1 << i)) { cn[c] = (cn[c] ?? 0) + 1; any = true; } });
  if (!any) cn.other = (cn.other ?? 0) + 1;
  THEMES.forEach(([c], i) => { if (r.tm & (1 << i)) th[c] = (th[c] ?? 0) + 1; });
}
console.log(JSON.stringify({ films: recs.length, bytes: Buffer.byteLength(text), rejected, decades: dec, countries: cn, themes: th, licenses: licenses.map((l) => [l, recs.filter((r) => r.lic === l).length]), stats }, null, 1));
