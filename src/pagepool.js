// Пул рабочих потоков, печатающих страницы подшивок (`pagework.js`). Задание — { s: лист (lines, fmt, seed), pri: чем меньше, тем раньше, dead, finish(front, back), local() }:
// пока поток занят, задания ждут; когда не вышло (нет потоков, не загрузились шрифты, ошибка) — `local()`: страница печатается в главном потоке по кадрам (paper.js).
const WORKER = new URL('./pagework.js', import.meta.url);
export class PagePool {
  // env: { paper, stamps: [{ stamp, R, chance }], stampScale } — снимок бумаги и приметы листов; n — сколько потоков (по умолчанию два: третье ядро зал не отдаёт).
  constructor(env, n = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 4) - 4))) {
    this.pending = new Set(); this.failed = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || new URLSearchParams(location.search).get('pagework') === '0'; this.ws = []; this.n = 0;   // ?pagework=0 — без потоков (запасной путь)
    if (this.failed) return;
    this.start = this.boot(env, n).catch(e => { console.warn('pagepool', e); this.fail(); });
  }
  async boot(env, n) {
    for (let k = 0; k < n; k++) {
      // Снимок бумаги и приметы у каждого потока свои: ImageBitmap при передаче отдаётся насовсем.
      const mk = src => src ? createImageBitmap(src) : null, paper = await mk(env.paper), stamps = await Promise.all(env.stamps.map(async s => ({ stamp: await createImageBitmap(s.stamp), R: s.R, chance: s.chance })));
      if (this.failed) { paper?.close(); stamps.forEach(s => s.stamp.close()); return; }
      const w = new Worker(WORKER, { type: 'module' }), slot = { w, busy: null, ready: false };
      w.onmessage = ({ data }) => this.message(slot, data);
      w.onerror = () => this.fail();
      w.postMessage({ op: 'init', paper, stamps, stampScale: env.stampScale }, [...(paper ? [paper] : []), ...stamps.map(s => s.stamp)]);
      this.ws.push(slot);
    }
  }
  message(slot, d) {
    if (d.op === 'ready') { if (!d.ok) return this.fail(); slot.ready = true; return this.pump(); }
    const job = slot.busy; slot.busy = null;
    if (job) {
      if (d.err) { console.warn('pagework', d.err); this.fail(); d.front?.close?.(); }
      else if (job.dead) { d.front.close(); d.back.close(); }
      else job.finish(d.front, d.back);
    }
    this.pump();
  }
  add(job) { if (this.failed) return job.local(); this.pending.add(job); this.pump(); }
  pump() {
    if (this.failed) return;
    for (const slot of this.ws) {
      if (!slot.ready || slot.busy) continue;
      let best = null; for (const j of this.pending) { if (j.dead) this.pending.delete(j); else if (!best || j.pri < best.pri) best = j; }
      if (!best) return;
      this.pending.delete(best); slot.busy = best; slot.w.postMessage({ op: 'page', id: 1, lines: best.s.lines, fmt: best.s.fmt, seed: best.s.seed });
    }
  }
  // Потоки не вышли: что ждало или печаталось — печатается здесь, по кадрам.
  fail() {
    if (this.failed && !this.ws.length) return;
    this.failed = true; const jobs = [...this.pending, ...this.ws.map(s => s.busy)].filter(j => j && !j.dead); this.pending.clear();
    for (const s of this.ws) s.w.terminate(); this.ws = [];
    for (const j of jobs) j.local();
  }
  close() { this.fail(); }
}
