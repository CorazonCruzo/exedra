// filmsniff.js — какой это контейнер, по первым байтам файла. Без зависимостей; используют оба воркера (звук и картинка).
//
//   sniffContainer(head: Uint8Array)  ->  'matroska' | 'mov' | 'avi' | 'mpegps' | 'mpegts' | 'ogg' | 'asf' | 'flv' | 'other'
//
// 'matroska' — и .mkv, и .webm; 'mov' — и .mp4, и .mov. По первым 12 байтам, без чтения всего файла и без демуксера.

export function sniffContainer(head) {
  const b = head;
  const str = (a, n) => String.fromCharCode(...Array.from(b.subarray(a, a + n)));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'matroska';
  if (str(0, 4) === 'RIFF' && (str(8, 4) === 'AVI ' || str(8, 4) === 'AVIX')) return 'avi';
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(str(4, 4))) return 'mov';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xba) return 'mpegps';                 // заголовок пакета MPEG-PS (DVD VOB, .mpg)
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xb3 || b[3] === 0xb0)) return 'other'; // «голый» видеопоток MPEG
  if (str(0, 4) === 'OggS') return 'ogg';
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return 'asf';
  if (str(0, 3) === 'FLV') return 'flv';
  if (b[0] === 0x47 && (b[188] === 0x47 || (b[4] === 0x47 && b[192] === 0x47))) return 'mpegts';
  return 'other';
}

// Контейнеры, которые Chrome умеет открывать сам (картинка идёт через <video>, если кодек подходит)
export const NATIVE_CONTAINERS = new Set(['matroska', 'mov', 'ogg']);
