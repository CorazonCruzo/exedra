// Стенд для замеров пролиста (подключается из консоли: `await import('/tools/riffle-bench.js')`). Всё кладёт в window:
//   __mkText(pages, isBlank) → Uint8Array — PDF с текстом, 47 строк на странице (пустые по isBlank(индекс с 0), по умолчанию первые три и каждая 97-я)
//   __mkScan(pages) → Promise<Uint8Array> — PDF из шести серых «сканов» (JPEG 1240×1754 с шумом и пятнами), страницы идут по кругу
//   __loadPdf(bytes, name)           — подставляет файл в #bookFile, как выбор файла
//   __riffle(to) → [кадры, мс]       — go(to) и интервалы между кадрами до посадки + 350 мс; кадр = rAF
//   __runAB(n, targets, key) → результат в window.__abRes — n пар пролётов с «начинкой» (on) и без (off: fill.list = []) вперемешку
//   __stats(массив) → медиана, p95, максимум и число кадров дольше 17,5 / 25 / 33 мс (при 120 Гц кадр бывает 8,3 или 16,7)
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const lorem = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
const line = maxc => { let s = ''; while (s.length < maxc - 8) s += lorem[(rnd() * lorem.length) | 0] + ' '; return s.trim(); };
window.__mkText = (pages, isBlank = p => p < 3 || p % 97 === 50) => {
  const objs = [], add = s => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'), kids = [];
  for (let p = 0; p < pages; p++) {
    let c = 'BT /F1 9 Tf 11 TL 40 555 Td\n'; const blank = isBlank(p);
    if (!blank) for (let l = 0; l < 47; l++) c += '(' + line(78) + ') Tj T*\n'; else c += '(' + (p < 3 ? 'Title page' : '') + ') Tj\n';
    c += 'ET'; const cid = add('<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream');
    kids.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents ' + cid + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>') + ' 0 R');
  }
  objs[1] = '<< /Type /Pages /Count ' + pages + ' /Kids [' + kids.join(' ') + '] >>';
  let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
  const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
};
window.__mkScan = async (pages, W = 1240, H = 1754) => {
  const imgs = [];
  for (let k = 0; k < 6; k++) {
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d'); g.fillStyle = '#d9cfae'; g.fillRect(0, 0, W, H);
    const id = g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n * .9; } g.putImageData(id, 0, 0);
    for (let s = 0; s < 14; s++) { const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 240, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,90,40,.10)'); gr.addColorStop(1, 'rgba(120,90,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    g.save(); g.translate(W / 2, H / 2); g.rotate((rnd() - .5) * .02); g.translate(-W / 2, -H / 2); g.fillStyle = '#231d12'; g.font = '34px "Times New Roman", serif';
    for (let l = 0; l < 44; l++) { let s = ''; while (s.length < 56) s += lorem[(rnd() * lorem.length) | 0] + ' '; g.fillText(s.trim(), 150, 170 + l * 33); } g.restore();
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .72)); imgs.push(new Uint8Array(await b.arrayBuffer()));
  }
  const enc = new TextEncoder(), parts = []; let len = 0; const push = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
  const offs = [], obj = (n, body, stream) => { offs[n] = len; push(n + ' 0 obj\n' + body); if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); } push('\nendobj\n'); };
  push('%PDF-1.4\n'); obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = [], ids = []; let n = 3;
  for (const im of imgs) { ids.push(n); obj(n++, '<< /Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.length + ' >>', im); }
  for (let p = 0; p < pages; p++) { const c = 'q 420 0 0 595 0 0 cm /Im Do Q', cid = n++, pid = n++; obj(cid, '<< /Length ' + c.length + ' >>', enc.encode(c)); obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents ' + cid + ' 0 R /Resources << /XObject << /Im ' + ids[p % imgs.length] + ' 0 R >> >> >>'); kids.push(pid + ' 0 R'); }
  obj(2, '<< /Type /Pages /Count ' + pages + ' /Kids [' + kids.join(' ') + '] >>');
  const x = len; let xr = 'xref\n0 ' + n + '\n0000000000 65535 f \n'; for (let i = 1; i < n; i++) xr += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(xr + 'trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF');
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
};
window.__loadPdf = (bytes, name) => { const inp = document.getElementById('bookFile'), dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: 'application/pdf' })); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); };
window.__stats = a => { a = [...a].sort((x, y) => x - y); const q = p => a[Math.min(a.length - 1, Math.floor(p * a.length))]; return { n: a.length, med: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), max: +a[a.length - 1].toFixed(2), gt17: a.filter(v => v > 17.5).length, gt25: a.filter(v => v > 25).length, gt33: a.filter(v => v > 33).length }; };
// Кадры одного пролёта: [интервал, момент от go()].
window.__riffle = async to => {
  const b = __rr.bookThing.book, d = []; let last = performance.now(), run = true, t0 = 0;
  const tick = t => { if (!run) return; if (t0) d.push([t - last, t - t0]); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  await new Promise(r => setTimeout(r, 120)); t0 = performance.now(); b.go(to);
  while ((b.rif || performance.now() - t0 < 100) && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 350)); run = false; return d;
};
window.__runAB = async (runs, targets, key = '__abRes') => {
  const b = __rr.bookThing.book, keep = b.fill?.list ?? [], res = { on: [], off: [] }, longs = [];
  window[key] = null;
  for (let i = 0; i < runs; i++) for (const mode of (i % 2 ? ['off', 'on'] : ['on', 'off'])) {
    if (b.fill) b.fill.list = mode === 'on' ? keep : []; const to = targets[(i * 2 + (mode === 'on' ? 0 : 1)) % targets.length];
    const d = await window.__riffle(to); res[mode].push(...d.map(x => x[0])); for (const x of d) if (x[0] > 25) longs.push([mode, to, +x[0].toFixed(0), +x[1].toFixed(0)]);
    await new Promise(r => setTimeout(r, 1800));
  }
  if (b.fill) b.fill.list = keep; window[key] = { on: window.__stats(res.on), off: window.__stats(res.off), longs };
};
// Кадр посреди пролёта: __freeze(to, ms) — go(to), через ms мс время пролёта останавливается (листы застывают в воздухе); __thaw() — отпустить.
window.__freeze = async (to, ms = 480) => { const b = __rr.bookThing.book, P = Object.getPrototypeOf(b); b.go(to); await new Promise(r => setTimeout(r, ms)); b.stepRiffle = function () { return P.stepRiffle.call(this, 0); }; return b.rif ? ['frozen', b.rif.flyers.length, b.rif.t.toFixed(2)] : 'no rif'; };
window.__thaw = () => { delete __rr.bookThing.book.stepRiffle; };
