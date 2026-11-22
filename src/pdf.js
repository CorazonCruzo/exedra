// Простейший PDF без библиотек: по одной картинке JPEG на страницу A4.
const enc = new TextEncoder();

// Строка для PDF с кириллицей: UTF-16BE в шестнадцатеричном виде с меткой порядка байтов.
const pdfText = t => '<FEFF' + [...t].map(ch => { const c = ch.codePointAt(0); return c > 0xffff ? '' : c.toString(16).padStart(4, '0'); }).join('').toUpperCase() + '>';

// images: [{ bytes, w, h }] → Blob application/pdf. Страница — A4, картинка на весь лист.
export function makePdf(images, { title = '' } = {}) {
  const chunks = [], offsets = []; let len = 0;
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); len += b.length; };
  const obj = (id, body) => { offsets[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  const W = 595.28, H = 841.89, n = images.length;
  // Двоичная пометка во второй строке — чтобы файл считался двоичным.
  push('%PDF-1.4\n%');
  push(new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${images.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`));
  images.forEach((im, i) => {
    const p = 3 + 3 * i, cs = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    obj(p + 1, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(p + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); push(im.bytes); push('\nendstream'); });
  });
  const info = 3 + 3 * n;
  obj(info, () => push(`<< /Title ${pdfText(title)} /Producer ${pdfText('Exedra')} >>`));
  const total = info + 1, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + offsets.slice(1, total).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  // Safari начинает скачивание после подтверждения — ссылку держим подольше.
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
