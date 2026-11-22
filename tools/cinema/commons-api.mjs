// Small polite MediaWiki API client for Wikimedia Commons (Node 22, no deps).
// Serial requests, ~1 per second, maxlag=5, descriptive User-Agent, retry on 429/maxlag.
import { appendFileSync } from 'node:fs';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ReadingRoomBuilder/1.0 (local personal project; non-commercial 3D reading room demo)';
const GAP_MS = 1500;
let last = 0;
export const stats = { requests: 0, r429: 0, retries: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(params, { logFile } = {}) {
  const url = new URL(API);
  const p = { format: 'json', formatversion: '2', maxlag: '5', ...params };
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    stats.requests++;
    if (logFile) appendFileSync(logFile, `${new Date().toISOString()} ${url.search.slice(0, 120)}\n`);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.status === 429 || res.status === 503) {
      stats.r429++;
      const ra = Number(res.headers.get('retry-after')) || 10 * (attempt + 1);
      console.error(`HTTP ${res.status}, waiting ${ra}s`);
      await sleep(ra * 1000);
      stats.retries++;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.search.slice(0, 100)}`);
    const j = await res.json();
    if (j.error?.code === 'maxlag') {
      const ra = Number(res.headers.get('retry-after')) || 5;
      await sleep(ra * 1000);
      stats.retries++;
      continue;
    }
    if (j.error) throw new Error(`API error ${j.error.code}: ${j.error.info}`);
    return j;
  }
  throw new Error('too many retries');
}

// Follow `continue` to the end, merging pages by title.
export async function apiAll(params, opts) {
  const pages = new Map();
  let cont = {};
  for (;;) {
    const j = await api({ ...params, ...cont }, opts);
    for (const pg of j.query?.pages ?? []) {
      const prev = pages.get(pg.title);
      if (!prev) pages.set(pg.title, pg);
      else {
        for (const [k, v] of Object.entries(pg)) {
          if (Array.isArray(v) && Array.isArray(prev[k])) prev[k] = [...prev[k], ...v];
          else prev[k] = v;
        }
      }
    }
    if (!j.continue) break;
    cont = j.continue;
  }
  return [...pages.values()];
}
