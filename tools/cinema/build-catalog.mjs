#!/usr/bin/env node
// Builds assets/cinema/catalog.json (curated shelf) from the starter list in
// docs/cinema/silent-films-commons-catalog.json, verifying every file through the
// MediaWiki API (batched, serial, polite). Re-runnable. Node 22, no dependencies.
//
//   node tools/cinema/build-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api, stats } from './commons-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const starter = JSON.parse(readFileSync(join(root, 'docs/cinema/silent-films-commons-catalog.json'), 'utf8'));

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ' };
export function plain(html, max = 120) {
  let s = String(html ?? '')
    .replace(/<[^>]*display:\s*none[^>]*>.*?<\/[^>]+>/gis, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENT[m])
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}
const clean = (u) => u.replace(/\?.*$/, '');

const MUSIC_RE = /soundtrack|with (?:a )?(?:new )?(?:music|score|musical)|music (?:by|added|composed)|(?:added|new|modern|original) (?:music|score)|score (?:by|composed)|musical accompaniment|accompan|sonoriz|sonorisation|synchroni[sz]ed (?:music|score)|backing (?:track|music)/i;

async function lookup(titles) {
  const j = await api(
    {
      action: 'query',
      titles: titles.join('|'),
      redirects: '1',
      prop: 'videoinfo',
      viprop: 'url|size|mime|derivatives|extmetadata',
      viextmetadatafilter: 'LicenseShortName|Artist|ImageDescription|Categories|ObjectName|DateTimeOriginal',
    },
    { logFile: process.env.API_LOG },
  );
  const map = new Map(); // requested title -> page
  const alias = new Map();
  for (const n of j.query.normalized ?? []) alias.set(n.from, n.to);
  for (const r of j.query.redirects ?? []) alias.set(r.from, r.to);
  const byTitle = new Map(j.query.pages.map((p) => [p.title, p]));
  for (const t of titles) {
    let cur = t;
    for (let i = 0; i < 4 && alias.has(cur); i++) cur = alias.get(cur);
    map.set(t, byTitle.get(cur));
  }
  return map;
}

function pickStream(vi) {
  const orig = clean(vi.url);
  const isWebm = /\.webm$/i.test(orig) && /webm/.test(vi.mime || '');
  const derivs = (vi.derivatives ?? []).filter((d) => /\.vp9\.webm$/.test(d.transcodekey));
  const d480 = derivs.find((d) => d.transcodekey === '480p.vp9.webm');
  const byH = [...derivs].sort((a, b) => b.height - a.height);
  const heavy = vi.size > 60 * 1024 * 1024;
  if (isWebm && !heavy) {
    return { kind: 'original', url: orig, mb: vi.size / 1048576, est: false, w: vi.width, h: vi.height };
  }
  const d = d480 ?? byH.find((x) => x.height <= 480) ?? byH[byH.length - 1];
  if (d) {
    return {
      kind: d.transcodekey,
      url: clean(d.src),
      mb: (d.bandwidth * vi.duration) / 8 / 1048576,
      est: true,
      w: d.width,
      h: d.height,
    };
  }
  if (isWebm) return { kind: 'original', url: orig, mb: vi.size / 1048576, est: false, w: vi.width, h: vi.height };
  return null;
}

const films = starter.films;
const results = new Map();
for (let i = 0; i < films.length; i += 40) {
  const batch = films.slice(i, i + 40);
  const m = await lookup(batch.map((f) => f.commonsFile));
  for (const f of batch) results.set(f.id, m.get(f.commonsFile));
  console.error(`batch ${i / 40 + 1}: ${Math.min(i + 40, films.length)}/${films.length}`);
}

// Тексты (название, режиссёр, примечание, названия разделов) — не в catalog.json, а в переводах assets/cinema/i18n/<язык>.json;
// скрипт пишет только русский (ru.json — из стартового списка), английский (en.json) и остальные ведутся вручную.
const GROUP_ID = { 'Итальянское': 'it', 'Русское': 'ru', 'Английское': 'en', 'Французское': 'fr', 'Немецкое': 'de', 'Испанское и Латинская Америка': 'es', 'Японское': 'ja',
  'Pathé-Baby (9,5 мм)': 'pathe', 'Цвет, танец и наука (без слов)': 'colour', 'Скандинавия (Дания / Швеция)': 'nordic', 'Бразилия (Португальский)': 'br', 'Индия': 'in' };
const ru = { groups: {}, films: {} };
const kept = [];
const dropped = [];
for (const f of films) {
  const pg = results.get(f.id);
  const vi = pg?.videoinfo?.[0];
  if (!pg || pg.missing || !vi) {
    dropped.push({ id: f.id, title: f.title, file: f.commonsFile, reason: 'file missing or no videoinfo' });
    continue;
  }
  const s = pickStream(vi);
  if (!s) {
    dropped.push({ id: f.id, title: f.title, file: f.commonsFile, reason: 'no playable WebM' });
    continue;
  }
  const em = vi.extmetadata ?? {};
  const desc = plain(em.ImageDescription?.value, 2000);
  const cats = em.Categories?.value ?? '';
  const entry = {
    id: f.id,
    lang: f.lang,
    group: GROUP_ID[f.group] ?? f.group,
    year: f.year,
    durationSec: Math.round(vi.duration),
    stream: s.url,
    streamKind: s.kind,
    streamMb: Math.round(s.mb * 10) / 10,
    streamMbEstimated: s.est,
    streamSize: `${s.w}x${s.h}`,
    license: plain(em.LicenseShortName?.value, 40) || f.license,
    attribution: plain(em.Artist?.value, 120) || 'Unknown author',
    commonsFile: pg.title,
    commonsPage: vi.descriptionurl,
  };
  ru.groups[entry.group] = f.group;
  ru.films[f.id] = { title: f.title, director: f.director, note: f.note };
  if (/[А-Яа-яЁё]/.test(entry.attribution)) { ru.films[f.id].attribution = entry.attribution; delete entry.attribution; }   // русская подпись автора — в перевод
  if (f.onboardingCandidate) entry.onboardingCandidate = true;
  // No lighter transcode exists on Commons for these: warn the UI before streaming.
  if (entry.streamMb > 100) entry.heavy = true;
  if (MUSIC_RE.test(desc) || /soundtrack|music/i.test(cats.split('|').filter((c) => !/^Silent films|music videos? by/i.test(c)).join('|'))) {
    entry.modernAudio = true;
  }
  kept.push(entry);
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'Wikimedia Commons, verified through the MediaWiki API (tools/cinema/build-catalog.mjs)',
  count: kept.length,
  groups: [...new Set(kept.map((k) => k.group))],
  films: kept,
};
writeFileSync(join(root, 'assets/cinema/catalog.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(root, 'assets/cinema/i18n/ru.json'), JSON.stringify(ru, null, 1) + '\n');
console.log(JSON.stringify({ kept: kept.length, dropped, stats }, null, 1));
