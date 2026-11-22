// Переплёты книги — снимки настоящих книг (Метрополитен-музей, CC0). Реестр `BINDINGS` и сборка материалов `bindingMats(id, env)` для Book (book.js, `ctx.mats`).
// Снимки готовит tools/bindings/prepare.py (обрезка, масштаб, зеркало там, где корешок на снимке с другой стороны; ретуши нет). Текстуры грузятся лениво — только у тех
// переплётов, которые взяты в дело; `mats.ready` — обещание: все снимки пришли, `mats.textures` — то, что стоит отправить на видеокарту заранее (`renderer.initTexture`).
// Книга сама читает у материалов только отношения сторон снимков: `coverAspect` (ширина к высоте лица крышки), `spineAspect` (то же у полосы корешка), `stretch` (во сколько раз
// можно растянуть или сжать снимок по ширине, дальше он обрезается по краям или продолжается краем кожи, см. book.js, `fitK`).
import * as THREE from 'three';

// Снимок → отношение сторон и размер в пикселях берутся из assets/bindings/<id>/info.json (число точек нужно для счёта памяти видеокарты).
// tint — приглушающий тон снимка кожи (сняты при ровном музейном свете и под лампой выгорали бы; красные ещё и темнее, чтобы не горели), rough — блеск кожи, grain — сила общей мелкой кожи поверх снимка.
// edge — обрез блока: цвет золота и металличность; endpaper — как называется форзац в подписях.
export const BINDINGS = {
  mm: {
    title: 'Красный сафьян с золотой каймой, Marius Michel et fils, Париж (издание 1876)', short: 'Красный, золотая кайма', red: true,
    source: 'Метрополитен-музей, №681556 («Мемуары графа де Граммона»), дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'красно-бордовый мрамор «гребень» (тот же переплёт, второй лист)',
    cover: { front: [903, 1536, .5876], back: [910, 1536, .5924] }, spine: [290, 2048, .1418], endpaper: [1024, 1536], rim: [32, 32],
    tint: [.62, .5, .55], rough: .52, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
  noel: {
    title: 'Красный сафьян с гербом, «L’office de Noël», Версаль (1768)', short: 'Тёмно-красный, герб', red: true,
    source: 'Метрополитен-музей, №681259, дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'красно-сине-зелёный мрамор «гребень» (тот же переплёт)',
    cover: { front: [934, 1536, .6078], back: [923, 1536, .6007] }, spine: [281, 2048, .137], endpaper: [1024, 1536], rim: [32, 32],
    tint: [.88, .84, .84], rough: .6, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
  // Основной красный — выбор пользователя 2026-11-21: крышки и корешок от «Noël», форзац — мрамор от Marius Michel (`endpaperFrom`).
  noelmm: {
    title: 'Красный сафьян с гербом, «L’office de Noël», Версаль (1768); форзац — мрамор переплёта Marius Michel (1876)', short: 'Тёмно-красный, герб; форзац Marius Michel', red: true,
    source: 'Метрополитен-музей, №681259 (крышки, корешок) и №681556 (форзац), дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'красно-бордовый мрамор «гребень» (переплёт Marius Michel)', endpaperFrom: 'mm', photosFrom: 'noel',
    cover: { front: [934, 1536, .6078], back: [923, 1536, .6007] }, spine: [281, 2048, .137], endpaper: [1024, 1536], rim: [32, 32],
    tint: [.88, .84, .84], rough: .6, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
  tel: {
    title: 'Красный сафьян с золотыми линиями, Bozerian, Париж (издание 1790)', short: 'Красный, золотые линии', red: true,
    source: 'Метрополитен-музей, №681128 («Les aventures de Télémaque»), дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'бледно-голубой муар (шёлк), мрамора у этой книги нет',
    cover: { front: [982, 1536, .6396], back: [1006, 1536, .6553] }, spine: [352, 2048, .1717], endpaper: [1024, 1536], rim: [32, 32],
    tint: [.6, .49, .53], rough: .52, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
  mol: {
    title: 'Зелёный сафьян, «Œuvres de Molière», Париж (1773)', short: 'Зелёный, тонкие золотые линии', red: false,
    source: 'Метрополитен-музей, №681563, дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'красно-сине-зелёно-жёлтый мрамор «перо» (тот же переплёт)',
    cover: { front: [968, 1536, .6301], back: [972, 1536, .6327] }, spine: [298, 2048, .1455], endpaper: [1024, 1536], rim: [32, 32],
    tint: [.62, .72, .74], rough: .6, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
  rag: {
    title: 'Тёмно-зелёный сафьян с гербом, «De’ ragguagli di Parnaso», Амстердам (1669), переплёт Simier', short: 'Тёмно-зелёный, герб', red: false,
    source: 'Метрополитен-музей, №681546, дар Джейн Райтсман, 2008', licence: 'CC0 (Open Access)',
    marble: 'пятнистая «черепаховая» бумага (тот же переплёт)',
    cover: { front: [768, 1536, .5], back: [769, 1536, .5006] }, spine: [323, 2048, .1575], endpaper: [1024, 1536], rim: [32, 32],
    tint: [1, 1, 1], rough: .62, grain: .15, edge: { color: '#c79a45', metal: .15, rough: .4 },
  },
};
// Красные на выбор (первый — по умолчанию), и порядок, в котором переплёты достаются книгам на столе: k-я книга берёт ORDER[k].
export const RED = ['noelmm', 'mm', 'noel', 'tel'];
export const DEFAULT_RED = 'noelmm';
export const ORDER = [DEFAULT_RED, 'mol', 'rag'];
export const bindingOf = k => ORDER[k % ORDER.length];
// Пропорции страницы, под которые сделан снимок (для пустой книги без PDF): ширина к высоте, в пределах, которые держит книга.
export const bindingRatio = id => { const a = BINDINGS[id]?.cover.front[2]; return a ? Math.min(.8, Math.max(.62, a)) : .68; };

// Сколько видеокарта держит под снимки переплёта (RGBA, с уровнями уменьшения), байт.
export function bindingBytes(id) {
  const b = BINDINGS[id]; if (!b) return 0;
  const sz = ([w, h]) => w * h * 4 * 4 / 3;
  return sz(b.cover.front) + sz(b.cover.back) + sz(b.spine) + sz(b.endpaper) + sz(b.rim);
}

// Обрез блока — тонкие полоски листов под золото: по одной на лист (v у книги идёт по листам), цвет и блеск — у материала.
function edgeTexture(base) {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 8); g.fillStyle = 'rgba(70,52,24,.34)'; g.fillRect(0, 6, 64, 2);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(70,50,20,${(Math.random() * .14).toFixed(3)})`; g.fillRect(Math.random() * 64, Math.random() * 8, 2 + Math.random() * 6, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

const cache = new Map();
// env: { loader: THREE.TextureLoader, anisotropy, grain(rep) → общая мелкая кожа как карта нормалей (отдельный объект на каждый повтор), shared: { paper, paperNormal, squash, pageTone, rest } }.
// Возвращает ctx.mats для Book. Материалы одного переплёта общие для всех книг с ним; снимки тянутся лениво, при первом вызове.
export function bindingMats(id, env) {
  const key = BINDINGS[id] ? id : DEFAULT_RED;
  if (cache.has(key)) return cache.get(key);
  const b = BINDINGS[key], waits = [], textures = [];
  const photo = (name, wrap, rep) => {
    const base = `assets/bindings/${name === 'endpaper' ? b.endpaperFrom ?? b.photosFrom ?? key : b.photosFrom ?? key}/`;
    // Снимок не только пришёл, но и разобран (decode): иначе разбор JPEG случился бы при отправке на видеокарту и занял бы кадр (на снимок до 0,25 с).
    let t; waits.push(new Promise(r => { t = env.loader.load(`${base}${name}.jpg`, im => (im.image.decode ? im.image.decode().catch(() => {}) : Promise.resolve()).then(() => r()), undefined, e => { console.warn('Снимок переплёта не загрузился:', name, e); r(); }); }));
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = env.anisotropy; t.wrapS = t.wrapT = wrap;
    if (rep) t.repeat.set(...rep); textures.push(t); return t;
  };
  const CL = THREE.ClampToEdgeWrapping, dim = new THREE.Color(...b.tint);
  const skin = (name, rep) => new THREE.MeshStandardMaterial({ map: photo(name, CL), normalMap: env.grain(rep), normalScale: new THREE.Vector2(b.grain, b.grain), color: dim, roughness: b.rough, envMapIntensity: .5 });
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTexture(), color: new THREE.Color(b.edge.color), metalness: b.edge.metal, roughness: b.edge.rough, envMapIntensity: .8 });
  const mats = {
    front: skin('front', [3, 4.5]), back: skin('back', [3, 4.5]), spine: skin('spine', [1, 6]),
    rim: new THREE.MeshStandardMaterial({ map: photo('rim', THREE.RepeatWrapping), color: dim.clone().multiplyScalar(.7), roughness: b.rough, envMapIntensity: .5 }),
    endpaper: new THREE.MeshStandardMaterial({ map: photo('endpaper', THREE.MirroredRepeatWrapping), color: new THREE.Color().setScalar(.88), roughness: .88 }),
    edge: edgeMat,
    ...env.shared,
    coverAspect: (b.cover.front[2] + b.cover.back[2]) / 2, spineAspect: b.spine[2], stretch: 1.2,
    id: key, textures, ready: null,
  };
  mats.ready = Promise.all(waits);
  cache.set(key, mats);
  return mats;
}
