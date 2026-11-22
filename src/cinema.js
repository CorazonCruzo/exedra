// Кино: проектор уголка светит на панель-экран. Модуль самостоятельный: зал отдаёт ему сцену, прямоугольник экрана в мире и положение объектива,
// остальное — своё: видеоэлемент и его текстура, свет экрана, луч с пылью, свечение объектива, плеер YouTube на стене.
// YouTube в кадры сцены не превратить (браузер не даёт читать его картинку), поэтому он — настоящий плеер под холстом: страница с плеером повёрнута в объёме
// ровно на панель (как CSS3DRenderer), а зал в этом месте прозрачен («окно», альфа 0). Всё, что перед экраном, его заслоняет; луч и пыль ложатся поверх
// картинки (их смешение не трогает альфу). Холст зала поэтому с альфой (room.js).
// Всё, что нужно видеокарте (шейдер экрана, луча, пыли, объектива), создаётся сразу при постройке и до первого показа лежит в сцене невидимым —
// `compileAll` под заставкой собирает шейдеры и для невидимых вещей; при первом включении шейдеров новых нет (60 кадров, никаких сборок на ходу).
// Свет зала настоящими лампами не добавляется: приглушение (`lit`) читает зал (room.js, `dimK`) и убавляет уже существующие лампы.
import * as THREE from 'three';
import { t } from './i18n.js';
import { radial } from './util.js';
import { openFilmAudio, pickDefaultSubtitle, parseSubtitleFile, watchCues } from './filmaudio.js';
import { openFilmVideo } from './filmvideo.js';
import { YuvScreen } from './filmvideo-yuv.js';
import { sniffContainer, NATIVE_CONTAINERS } from './filmsniff.js';

// Звук фильмов, который Chrome не играет (AC-3, E-AC-3, DTS, TrueHD — почти все фильмы): декодирует filmaudio.js (FFmpeg в WebAssembly, в воркере),
// играет через свой AudioContext вслед за <video>. Контекст — один на зал, заводится при первом таком файле.
let actx = null;


// Луч: прозрачная пирамида от объектива до экрана. Считается в шейдере: для каждой точки экрана — длина хорда луча взгляда внутри пирамиды (пять плоскостей: четыре грани и стена),
// яркость убывает с квадратом расстояния от объектива — так луч виден тонкой дымкой, ярче у объектива, и мягко сходит на нет у краёв (хорд короче).
const BEAM_V = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_F = `
uniform vec4 uPl[5]; uniform vec3 uA, uAx, uCol; uniform float uGain, uTime, uLit, uC;
varying vec3 vW;
float h3(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 o = cameraPosition, dir = normalize(vW - o);
  float t0 = 0., t1 = distance(vW, o);
  for (int i = 0; i < 5; i++) {
    float nd = dot(uPl[i].xyz, dir), no = dot(uPl[i].xyz, o) + uPl[i].w;
    if (abs(nd) < 1e-5) { if (no > 0.) discard; }
    else { float t = -no / nd; if (nd > 0.) t1 = min(t1, t); else t0 = max(t0, t); }
  }
  if (t1 <= t0) discard;
  float c = uC, s0 = dot(o - uA, uAx) + c, k = dot(dir, uAx), s1 = s0 + k * t1, s2 = s0 + k * t0;
  s2 = max(s2, .2); s1 = max(s1, .2);
  float I = abs(k) > 1e-3 ? abs(1. / s2 - 1. / s1) / abs(k) : (t1 - t0) / (s0 * s0);
  vec3 pm = o + dir * (.5 * (t0 + t1));
  float n = .72 + .5 * vn(pm * 1.6 + vec3(0., 0., uTime * .07)) * (.6 + .4 * vn(pm * 4.3 - vec3(uTime * .05, 0., 0.)));
  gl_FragColor = vec4(uCol * (uGain * I * n * uLit), 1.);
}`;
// Пыль в луче: точки плывут по кругу (в вершинном шейдере — ни одного байта в видеокарту за кадр), мерцают.
const DUST_V = `attribute float aSeed; attribute float aB; uniform float uTime, uPx, uLit; varying float vA;
void main(){
  vec3 p = position + vec3(sin(uTime * .31 + aSeed * 17.), cos(uTime * .23 + aSeed * 9.) * .7, sin(uTime * .27 + aSeed * 5.)) * .1;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
  float tw = .35 + .65 * pow(.5 + .5 * sin(uTime * (.6 + fract(aSeed * 7.)) + aSeed * 40.), 2.);
  gl_PointSize = clamp(uPx * .0075 / max(-mv.z, .2), 1.4, 6.); vA = aB * tw * uLit;
}`;
const DUST_F = `uniform vec3 uCol; varying float vA;
void main(){ float r = length(gl_PointCoord - .5) * 2.; float a = smoothstep(1., .1, r); gl_FragColor = vec4(uCol * a * vA, 1.); }`;

// panel: { c: центр экрана (мир, на плоскости штукатурки), w, h, right, up, normal (из стены в зал) }; lens: объектив (мир).
export function buildCinema({ scene, panel, lens, camera, renderer }) {
  const { c, w, h } = panel, right = panel.right.clone().normalize(), up = panel.up.clone().normalize(), normal = panel.normal.clone().normalize();
  const group = new THREE.Group(); group.name = 'cinema'; scene.add(group);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));

  // — Видео и его текстура. Текстура видео собирается особым шейдером (декодирование sRGB в нём), поэтому с самого начала это VideoTexture; пока кадров нет, она пуста (экран скрыт).
  // Видео живёт в странице (точка в углу, невидимая): отсоединённое от документа Chrome считает фоновым и душит его декодирование — экран «то быстро, то застывает».
  const video = document.createElement('video'); video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', zIndex: '-1' }); document.body.appendChild(video);
  const vtex = new THREE.VideoTexture(video); vtex.colorSpace = THREE.SRGBColorSpace; vtex.minFilter = vtex.magFilter = THREE.LinearFilter; vtex.generateMipmaps = false;
  // Свет прибавляется к цвету, а прозрачность холста не трогает: над окном YouTube луч и пыль — свет поверх картинки, а не тёмная пелена.
  const add = { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true, depthWrite: false, fog: false };
  // Свет проектора прибавляется к штукатурке (чёрное в кадре — тёмная стена, как в настоящем зале); сдвиг глубины — чтобы не мерцало на панели.
  const screenMat = new THREE.MeshBasicMaterial({ map: vtex, ...add, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMat); screen.name = 'cinema-screen'; screen.visible = false; screen.renderOrder = 3;
  // Экран и стена смотрят в зал: плоскость модели (её лицо +z) разворачивается по базису панели.
  // HDR-фильмы (PQ, BT.2020 — почти все 4K): Chrome отдаёт сцене сырые значения сигнала, без пересчёта (проверено: совпадают с кадром ffmpeg без пересчёта),
  // и картинка бледная и плоская. Тогда (`uHDR` = 1) экран сам считает: PQ → яркость (белый SDR — 203 нит) → BT.709 → мягкое сжатие ярких мест.
  // Шейдер один для обычных и HDR-файлов (ветка по переменной): он собирается под заставкой вместе со всем залом, на ходу — ничего.
  const hdrU = { value: 0 };
  screenMat.onBeforeCompile = sh => {
    sh.uniforms.uHDR = hdrU;
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      if ( uHDR > .5 ) {
        vec3 p = pow( max( sampledDiffuseColor.rgb, 0. ), vec3( 1. / 78.84375 ) );
        vec3 L = pow( max( p - .8359375, 0. ) / ( 18.8515625 - 18.6875 * p ), vec3( 1. / .1593017578125 ) ) * ( 10000. / 203. );
        vec3 c = max( mat3( 1.6605, -.1246, -.0182, -.5876, 1.1329, -.1006, -.0728, -.0083, 1.1187 ) * L, 0. );
        float l = dot( c, vec3( .2126, .7152, .0722 ) ), W2 = 24.;
        c *= ( 1. + l / W2 ) / ( 1. + l );
        sampledDiffuseColor.rgb = min( c, 1. );
      } else sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
      diffuseColor *= sampledDiffuseColor;`).replace('void main() {', 'uniform float uHDR;\nvoid main() {');
  };
  screenMat.customProgramCacheKey = () => 'cinema-screen-hdr';
  screen.quaternion.copy(quat); screen.position.copy(c).addScaledVector(normal, .004);
  // Ровный тёплый свет на весь экран — когда кадров нет (YouTube): картинка в окошке сверху, а вокруг светится панель.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x000000, ...add, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat); glow.name = 'cinema-glow'; glow.visible = false; glow.renderOrder = 3;
  glow.quaternion.copy(quat); glow.position.copy(c).addScaledVector(normal, .0035);
  // Окно YouTube: прямоугольник 16:9 на панели, в котором зал прозрачен (без смешения: цвет и альфа пишутся как есть) — сквозь него виден плеер под холстом.
  // Не совсем прозрачен: тёплая дымка поверх (альфа `a`, цвет — уже умноженный на неё) приглушает картинку и поднимает чёрное, как у проекции на бумажный экран,
  // и дрожит вместе со светом лампы; пока проектор разгорается, окно почти непрозрачно — картинка проявляется.
  const fw = h * 16 / 9 > w ? w : h * 16 / 9, fh = fw * 9 / 16;
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), holeMat); hole.name = 'cinema-hole'; hole.visible = false; hole.renderOrder = 3.5;
  hole.quaternion.copy(quat); hole.position.copy(c).addScaledVector(normal, .0045);
  group.add(glow, screen, hole);
  // — Субтитры фильма: строки рисуются на холсте-текстуре у нижнего края кадра, как часть проекции (гаснут и дрожат вместе с ней).
  // Холст перерисовывается, только когда меняются строки (раз в несколько секунд). Шрифт — Old Standard TT, как у книжного набора зала.
  const SW = 2048, SH = 400, subCv = document.createElement('canvas'); subCv.width = SW; subCv.height = SH;
  const subTex = new THREE.CanvasTexture(subCv); subTex.colorSpace = THREE.SRGBColorSpace; subTex.anisotropy = 4;
  const subMat = new THREE.MeshBasicMaterial({ map: subTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const sub = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), subMat); sub.name = 'cinema-subs'; sub.visible = false; sub.renderOrder = 3.6; sub.quaternion.copy(quat);
  let subKey = '';
  const placeSub = () => {   // по кадру: на всю его ширину, низ — чуть выше нижнего края картинки
    const sx = screen.scale.x, sy = screen.scale.y, sw = sx * .96, sh = sw * SH / SW;
    sub.scale.set(sw, sh, 1); sub.position.copy(c).addScaledVector(normal, .006).addScaledVector(up, -sy / 2 + sh / 2 + sy * .03);
  };
  const drawSub = lines => {
    const key = JSON.stringify(lines); if (key === subKey) return; subKey = key;
    const g = subCv.getContext('2d'); g.clearRect(0, 0, SW, SH);
    // Строка: текст или { text, italic }; длинные переносятся по словам.
    const px = 74, lh = px * 1.2, max = SW * .94, rows = [];
    for (const l of lines) {
      const it = typeof l === 'object' && !!l.italic, t = String(typeof l === 'object' ? l.text : l);
      g.font = `${it ? 'italic ' : ''}400 ${px}px "Old Standard TT", Georgia, serif`;
      for (const part of t.split('\n')) {
        let row = '';
        for (const word of part.split(/\s+/).filter(Boolean)) { const tryRow = row ? row + ' ' + word : word; if (row && g.measureText(tryRow).width > max) { rows.push([row, it]); row = word; } else row = tryRow; }
        if (row) rows.push([row, it]);
      }
    }
    const shown = rows.slice(-3);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    shown.forEach(([t, it], i) => {
      const y = SH - 34 - (shown.length - 1 - i) * lh;
      g.font = `${it ? 'italic ' : ''}400 ${px}px "Old Standard TT", Georgia, serif`;
      g.lineWidth = 11; g.strokeStyle = 'rgba(16,10,5,.82)'; g.strokeText(t, SW / 2, y);
      g.fillStyle = '#f4ecd6'; g.fillText(t, SW / 2, y);
    });
    subTex.needsUpdate = true; sub.visible = shown.length > 0 && S.mode === 'file';
  };
  let ownAspect = 0, screenOwn = null;   // свой показ (filmvideo): пропорции кадра и его плоскость (заводится ниже)
  const fitScreen = () => {   // кадр вписывается в панель с полями сверху-снизу или по бокам
    const a = ownAspect ? ownAspect : video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9, pa = w / h;
    screen.scale.set(a > pa ? w : h * a, a > pa ? w / a : h, 1); screenOwn?.scale.copy(screen.scale); placeSub();
  };
  // — Карточка на экране, как интертитр немого кино: ошибка (весь кадр — тёмная карточка с рамкой, проектор светит, пока её не выключат)
  // или полоса поверх кадра («ждём данных»). Холст перерисовывается только при смене текста.
  const CW = 1600, CH = 900, cardCv = document.createElement('canvas'); cardCv.width = CW; cardCv.height = CH;
  const cardTex = new THREE.CanvasTexture(cardCv); cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.anisotropy = 4;
  const cardMat = new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), cardMat); card.name = 'cinema-card'; card.visible = false; card.renderOrder = 3.7;
  card.quaternion.copy(quat); card.position.copy(c).addScaledVector(normal, .007); group.add(card);
  let cardKey = '';
  const drawCard = (text, full) => {
    const key = (full ? 'F' : 'B') + text; if (key === cardKey) return; cardKey = key;
    const g = cardCv.getContext('2d'); g.clearRect(0, 0, CW, CH);
    const px = full ? 58 : 50, lh = px * 1.32, max = CW * (full ? .74 : .86), rows = [];
    g.font = `italic 400 ${px}px "Old Standard TT", Georgia, serif`;
    for (const part of String(text).split('\n')) {
      let row = '';
      for (const word of part.split(/\s+/).filter(Boolean)) { const t = row ? row + ' ' + word : word; if (row && g.measureText(t).width > max) { rows.push(row); row = word; } else row = t; }
      rows.push(row);
    }
    const h = rows.length * lh, y0 = CH / 2 - h / 2 + px * .95;
    if (full) {
      g.fillStyle = '#17100a'; g.fillRect(0, 0, CW, CH);
      g.strokeStyle = 'rgba(226,206,160,.75)'; g.lineWidth = 5; g.strokeRect(70, 70, CW - 140, CH - 140); g.lineWidth = 2; g.strokeRect(92, 92, CW - 184, CH - 184);
    } else { g.fillStyle = 'rgba(16,10,5,.72)'; g.fillRect(0, CH / 2 - h / 2 - px * .7, CW, h + px * 1.1); }
    g.textAlign = 'center'; g.fillStyle = '#efe3c6'; g.font = `italic 400 ${px}px "Old Standard TT", Georgia, serif`;
    rows.forEach((r, i) => g.fillText(r, CW / 2, y0 + i * lh));
    cardTex.needsUpdate = true;
  };
  // — Картинка старых файлов, которые Chrome не открывает (AVI: Xvid/DivX, MJPEG, DV; VOB/MPEG-2; TS — filmvideo.js): кадры Y/U/V из воркера → YuvScreen (один проход
  // в RGB-цель на новый кадр) → своя плоскость экрана с той же подсветкой, что у <video>. Обе программы (перевод цвета и экран) собираются под заставкой.
  // Шейдер перевода цвета собирается сразу и именно для рисования в цель (у него свой вариант вывода — не тот, что для экрана).
  const yuv = new YuvScreen(renderer, {}); { const was = renderer.getRenderTarget(); renderer.setRenderTarget(yuv.rt); renderer.compile(yuv.scene, yuv.camera); renderer.setRenderTarget(was); }
  const ownMat = new THREE.MeshBasicMaterial({ map: yuv.texture, ...add, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  ownMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );'); };
  ownMat.customProgramCacheKey = () => 'cinema-screen-own';
  screenOwn = new THREE.Mesh(screen.geometry, ownMat); screenOwn.name = 'cinema-screen-own'; screenOwn.visible = false; screenOwn.renderOrder = 3;
  screenOwn.quaternion.copy(quat); screenOwn.position.copy(screen.position); group.add(screenOwn);
  let lastSerial = -1;
  group.add(sub); fitScreen();

  // — Луч: пирамида с вершиной в объективе и основанием на экране.
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => c.clone().addScaledVector(right, sx * w / 2).addScaledVector(up, sy * h / 2));
  const A = lens.clone(), mid = c.clone().add(A).multiplyScalar(.5);
  const planes = [];
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4], n = new THREE.Vector3().crossVectors(p.clone().sub(A), q.clone().sub(A)).normalize();
    if (n.dot(mid.clone().sub(A)) > 0) n.negate();   // внутри: dot(n, x) + d <= 0
    planes.push(new THREE.Vector4(n.x, n.y, n.z, -n.dot(A)));
  }
  planes.push(new THREE.Vector4(-normal.x, -normal.y, -normal.z, normal.dot(c)));   // стена: по сторону зала
  const pos = [A, ...corners].flatMap(v => v.toArray()), idx = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 4, 3, 1, 3, 2];
  // Грани — лицом наружу (рисуются обратные: внутри пирамиды они видны и снаружи, и из середины).
  const cen = A.clone().add(corners[0]).add(corners[1]).add(corners[2]).add(corners[3]).multiplyScalar(.2), vs = [A, ...corners];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, d] = [idx[i], idx[i + 1], idx[i + 2]], n = new THREE.Vector3().crossVectors(vs[b].clone().sub(vs[a]), vs[d].clone().sub(vs[a]));
    if (n.dot(vs[a].clone().sub(cen)) < 0) { idx[i + 1] = d; idx[i + 2] = b; }
  }
  const bg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
  const beamU = { uPl: { value: planes }, uA: { value: A }, uAx: { value: c.clone().sub(A).normalize() }, uCol: { value: new THREE.Color(1, .82, .56) }, uGain: { value: 1.5 }, uC: { value: 1.2 }, uTime: { value: 0 }, uLit: { value: 0 } };
  // Основание пирамиды лежит на стене, в одной плоскости с панелью: без сдвига глубины видеокарта Mac местами (по своим плиткам) отдавала его стене —
  // над экраном луч пропадал квадратами («квадраты поверх видео», 2026-11-21).
  const beamMat = new THREE.ShaderMaterial({ uniforms: beamU, vertexShader: BEAM_V, fragmentShader: BEAM_F, side: THREE.BackSide, ...add, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const beam = new THREE.Mesh(bg, beamMat); beam.name = 'cinema-beam'; beam.visible = false; beam.frustumCulled = false; beam.renderOrder = 4; group.add(beam);

  // — Пыль: точки внутри пирамиды (чаще у объектива).
  const N = 90, dp = new Float32Array(N * 3), seed = new Float32Array(N), bri = new Float32Array(N); let rs = 11;
  const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) {
    const t = Math.pow(rnd(), .8) * .92 + .03, sx = (rnd() * 2 - 1) * .96, sy = (rnd() * 2 - 1) * .96;
    const tgt = c.clone().addScaledVector(right, sx * w / 2).addScaledVector(up, sy * h / 2), p = A.clone().lerp(tgt, t);
    dp.set(p.toArray(), i * 3); seed[i] = rnd(); bri[i] = Math.min(1, .55 / Math.pow(t * A.distanceTo(c) + .6, 2) * 3.5 + .12);
  }
  const dg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dp, 3)).setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)).setAttribute('aB', new THREE.BufferAttribute(bri, 1));
  const dustU = { uTime: { value: 0 }, uPx: { value: 600 }, uLit: { value: 0 }, uCol: { value: new THREE.Color(1, .86, .62) } };
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: dustU, vertexShader: DUST_V, fragmentShader: DUST_F, ...add, fog: false }));
  dust.name = 'cinema-dust'; dust.visible = false; dust.frustumCulled = false; dust.renderOrder = 4; group.add(dust);

  // — Объектив светится: тёплое пятно на кольце.
  const lensTex = radial([[0, 'rgba(255,240,205,1)'], [.18, 'rgba(255,214,150,.75)'], [.5, 'rgba(255,184,100,.18)'], [1, 'rgba(255,170,90,0)']], 128);
  const lensSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lensTex, ...add }));
  lensSp.name = 'cinema-lens'; lensSp.position.copy(A).addScaledVector(c.clone().sub(A).normalize(), .02); lensSp.scale.setScalar(.2); lensSp.visible = false; lensSp.renderOrder = 5; group.add(lensSp);

  // — Состояние.
  // kind — что показывали последним (экран гаснет плавно, когда режим уже 'off': последний кадр файла ещё держится на текстуре).
  const S = { subTrack: -1, mode: 'off', kind: 'off', paused: false, name: '', lit: 0, target: 0, url: null, frame: null, onEnd: null, vol: 1, pending: false };
  const showKinds = () => { const on = S.lit > .002; screen.visible = on && S.kind === 'file'; screenOwn.visible = on && S.kind === 'own'; glow.visible = on && (S.kind === 'web' || S.kind === 'card'); card.visible = on && (S.mode === 'card' || !!S.waitCard || (S.kind === 'card' && S.mode === 'off' && !S.pending)); hole.visible = S.mode === 'web'; beam.visible = dust.visible = lensSp.visible = on; };
  // — Плеер YouTube: сцена из двух блоков под холстом (перспектива и камера, как у CSS3DRenderer), в ней — окошко плеера, повёрнутое по панели.
  // Окошко чуть больше окна в зале (на 1,5%): край окна всегда ложится на картинку, щели к странице нет.
  const PX = 1920, PY = 1080, stage = document.createElement('div'), camEl = document.createElement('div');
  stage.id = 'cinemaStage'; stage.hidden = true; camEl.className = 'cam'; stage.appendChild(camEl); document.body.prepend(stage);
  const frameM = new THREE.Matrix4().compose(c.clone().addScaledVector(normal, .002), quat, new THREE.Vector3().setScalar(fw * 1.015 / PX));
  const css = (e, o) => 'matrix3d(' + e.map((v, i) => { const x = o(v, i); return Math.abs(x) < 1e-10 ? 0 : x; }).join(',') + ')';
  const camCss = m => css(m.elements, (v, i) => (i % 4 === 1 ? -v : v));
  const objCss = m => 'translate(-50%,-50%)' + css(m.elements, (v, i) => (i >= 4 && i < 8 ? -v : v));
  let stageKey = '';
  // Сообщения плеера сайта: разбирает его адаптер (webplayers.js), сюда приходит уже понятное — готов, время, длина, состояние, ошибка.
  addEventListener('message', e => { if (S.frame && S.ctl && e.source === S.frame.contentWindow) S.ctl.message(e.data); });
  const webOn = (f, site) => ({
    ready: () => { if (S.frame === f) S.webHeard = true; },
    // Время ролика: плеер присылает его несколько раз в секунду; между сообщениями оно досчитывается по часам (`time`).
    time: t => { if (S.frame === f && Number.isFinite(t)) { S.webTime = t; S.webAt = performance.now(); } },
    duration: d => { if (S.frame === f && d > 0) S.webDur = d; },
    state: st => { if (S.frame !== f) return; if (st === 'ended') { api.stop(); S.onEnd?.('ended'); } else S.paused = st === 'paused'; },
    // Причина — с названием сайта, если в тексте его нет («Vimeo: видео не найдено или удалено.»).
    error: text => { if (S.frame !== f) return; api.stop(); S.onEnd?.('web-error', text.includes(site.name) ? text : `${site.name}: ${text[0].toLowerCase()}${text.slice(1)}`); },
  });
  // Часы показа: <video> или «видеоэлемент» filmvideo (`media`, те же свойства и события) — V; слушатели одни и те же.
  let V = video;
  const listen = el => {
    el.addEventListener('loadedmetadata', fitScreen);
    // Видео ждёт данных (сайт отдаёт медленно или ограничил скачивание): с какого момента; пошли кадры — сброс. Зал после нескольких секунд говорит об этом.
    for (const t of ['waiting', 'stalled']) el.addEventListener(t, () => { if (el === V && !el.paused) S.waitAt ??= performance.now(); });
    for (const t of ['playing', 'timeupdate', 'pause', 'emptied']) el.addEventListener(t, () => { if (el === V && (t !== 'timeupdate' || el.readyState >= 3)) S.waitAt = null; });
    el.addEventListener('ended', () => { if (el === V && S.mode === 'file') { api.stop(); S.onEnd?.('ended'); } });
    // Ошибка своего файла, пока он открывается, — не конец: playFile попробует показать его сам (filmvideo). Ссылка или идущий показ — ошибка.
    el.addEventListener('error', () => {
      if (el !== V || !(S.mode === 'file' || S.pending)) return;
      if (S.pending && el === video && S.url?.startsWith('blob:')) return;
      const was = S.name, link = el === video && !S.url?.startsWith('blob:'); api.stop(); S.onEnd?.(link ? 'link-error' : 'error', was);
    });
  };
  listen(video);
  // Свой звук: <video> замолкает, плеер filmaudio идёт за его часами (пауза, перемотка — сам). Контекст запускается сразу; если браузер не дал
  // (выбор файла в системном окне — уже не «нажатие»), его включит следующее нажатие в зале (`unlockSound`).
  const attachOwn = () => {
    actx ??= new AudioContext(); if (V === video) video.muted = true; S.faVol = -1;
    S.player = S.fa.attach({ ctx: actx, video: V, track: S.track, onError: m => console.warn('filmaudio:', m) });
    S.player.setVolume(0); if (actx.state !== 'running') actx.resume().catch(() => {});
  };
  // Стрекот проектора (записанный Super 8, assets/sounds/projector-loop.ogg, 10 с по кругу): пока идёт немой фильм и не на паузе — тихо, у проектора громче,
  // дальше по залу тише; звук зала выключен — тишина. Свой AudioContext (общий со звуком фильмов), буфер грузится при первом немом фильме.
  let clatBuf = null, clatSrc = null, clatGain = null, clatLoading = false;
  const clatter = on => {
    if (on && !clatSrc) {
      actx ??= new AudioContext(); if (actx.state !== 'running') actx.resume().catch(() => {});
      if (!clatBuf) {
        if (!clatLoading) { clatLoading = true; fetch('assets/sounds/projector-loop.ogg').then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)).then(b => { clatBuf = b; }).catch(e => console.warn(e)); }
        return;
      }
      clatGain ??= actx.createGain(); clatGain.connect(actx.destination); clatGain.gain.value = 0;
      clatSrc = actx.createBufferSource(); clatSrc.buffer = clatBuf; clatSrc.loop = true; clatSrc.loopEnd = Math.min(10, clatBuf.duration); clatSrc.connect(clatGain); clatSrc.start();
    } else if (!on && clatSrc) { const src = clatSrc; clatSrc = null; clatGain.gain.setTargetAtTime(0, actx.currentTime, .08); setTimeout(() => { try { src.stop(); } catch {} src.disconnect(); }, 400); }
  };
  const dropUrl = () => { if (S.url?.startsWith('blob:')) URL.revokeObjectURL(S.url); S.url = null; };

  const api = {
    group, video, vtex, screen, beamU, dustU,
    get mode() { return S.mode; }, get paused() { return S.paused; }, get name() { return S.name; }, get lit() { return S.lit; },
    set onEnd(f) { S.onEnd = f; },
    // Видеофайл с компьютера (или по прямой ссылке — `link`: адрес; тогда без своего разбора звука и субтитров — его читают только из файла): идёт на панель сам, со звуком.
    // Видео по ссылке нужно разрешение сайта брать его (CORS) — иначе браузер не даёт его кадры сцене, и видео не открывается (`link-error`).
    // meta (фильмотека): { name — подпись «Идёт: …», credit — лицензия и автор, page — страница фильма, silent — немое кино (звука в файле и не ждут) }.
    async playFile(file, sound = true, link = null, meta = null) {
      // Свой файл в контейнере, который Chrome не открывает (AVI, VOB, TS, ASF, FLV) — сразу показ картинки своим декодером.
      if (!link && file) { try { if (!NATIVE_CONTAINERS.has(sniffContainer(new Uint8Array(await file.slice(0, 512).arrayBuffer())))) return api.playOwn(file, sound, meta); } catch {} }
      api.stop(); S.pending = true; const lu = link && new URL(link, location.href);
      S.name = meta?.name ?? (link ? decodeURIComponent(lu.pathname.split('/').filter(Boolean).pop() || lu.hostname) : file.name);
      S.credit = meta?.credit ?? ''; S.page = meta?.page ?? ''; S.silent = !!meta?.silent;
      S.url = link ?? URL.createObjectURL(file); video.src = S.url; video.muted = !sound; video.load(); S.soundOk = true;
      // Проектор загорается сразу; пока нет первых кадров, на экране — карточка «загружается» (после .4 с, чтобы у быстрых файлов не мелькала).
      S.pendAt = performance.now(); S.kind = 'card'; S.target = 1; S.link = !!link;
      // Свой разбор звука — одновременно с загрузкой картинки (≈ 50 мс, файл читается кусками). Нужен, если звук файла Chrome не играет или дорожек несколько
      // (родной звук играет только первую); не нужен — закрывается. Свой звук: <video> молчит всегда, громкость — у плеера (`update`).
      const url = S.url;
      const own = link ? Promise.resolve() : openFilmAudio(file).then(fa => {
        if (S.url !== url) { fa.close(); return; }
        S.tracks = fa.tracks; S.subList = fa.subtitles ?? []; hdrU.value = fa.videoTrc === 16 ? 1 : 0;   // 16 — SMPTE 2084 (PQ)
        const subs = S.subList.some(t => t.kind === 'text');
        if (!fa.tracks.length) { S.noAudio = true; if (!subs) { fa.close(); return; } }
        S.fa = fa; S.track = fa.defaultTrack;
        // Открытым разбор остаётся, если нужен свой звук, есть из чего выбрать озвучку или есть субтитры (их тоже читает он, попутно со звуком).
        if (fa.tracks.length && fa.needsOwnAudio(video).needed) attachOwn(); else if (fa.tracks.length < 2 && !subs) { fa.close(); S.fa = null; }
        // Субтитры сами включаются, только если файл пометил дорожку основной или обязательной на языке браузера (pickDefaultSubtitle); иначе — выбор на плашке.
        const st = pickDefaultSubtitle(S.subList); if (st >= 0 && S.subTrack === -1) api.setSubtitle(st);
      }).catch(e => console.warn('filmaudio:', e));
      // Файл выбран в системном окне — к запуску браузер может уже не считать это нажатием и не дать звук. Тогда — без звука, а звук включит следующее нажатие
      // в зале (`unlockSound`). Включать звук самим каждый кадр нельзя: Chrome в ответ ставит такое видео на паузу (экран застывал, при возобновлении — квадраты).
      try { await video.play(); } catch (e) {
        if (e?.name === 'NotAllowedError') { S.soundOk = false; video.muted = true; try { await video.play(); } catch { S.pending = false; api.stop(); throw e; } }
        else if (!link && file && S.url === url) return api.playOwn(file, sound, meta);   // Chrome не смог (например, MPEG-4 Part 2 в .mkv) — показываем сами
        else { S.pending = false; api.stop(); throw e; }
      }
      await own; if (S.url !== url) return false;
      S.pending = false; S.mode = S.kind = 'file'; S.paused = false; S.target = 1; S.waitCard = ''; fitScreen(); showKinds(); return true;
    },
    // Свой показ картинки (filmvideo): кадры из воркера на свою плоскость экрана, часы — `media`; звук и субтитры (filmaudio) идут за этими часами, как за <video>.
    async playOwn(file, sound = true, meta = null) {
      api.stop(); S.pending = true; const tok = S.ownTok = {}; S.name = meta?.name ?? file.name; S.credit = meta?.credit ?? ''; S.page = meta?.page ?? ''; S.silent = !!meta?.silent;
      S.pendAt = performance.now(); S.kind = 'card'; S.target = 1; S.link = false; S.soundOk = true;
      const [fv, fa] = await Promise.all([openFilmVideo(file), openFilmAudio(file).catch(e => { console.warn('filmaudio:', e); return null; })]);
      if (S.ownTok !== tok) { fv.close(); fa?.close(); return false; }
      if (!fv.canPlay) { fv.close(); fa?.close(); S.pending = false; api.stop(); throw new Error(fv.reason || 'формат не поддерживается'); }
      S.fv = fv; V = fv.media; listen(V); lastSerial = -1; hdrU.value = 0; ownAspect = fv.displayAspect || 4 / 3;
      if (fa) {
        S.tracks = fa.tracks; S.subList = fa.subtitles ?? [];
        if (fa.tracks.length || S.subList.some(t => t.kind === 'text')) { S.fa = fa; S.track = fa.defaultTrack; if (fa.tracks.length) attachOwn(); } else { fa.close(); S.noAudio = true; }
        if (!fa.tracks.length) S.noAudio = true;
        const st = pickDefaultSubtitle(S.subList); if (st >= 0 && S.subTrack === -1) api.setSubtitle(st);
      } else S.noAudio = true;
      try { await V.play(); } catch (e) { if (S.ownTok === tok) { S.pending = false; api.stop(); } throw e; }
      if (S.ownTok !== tok) return false;
      S.pending = false; S.mode = 'file'; S.kind = 'own'; S.paused = false; S.target = 1; S.waitCard = ''; fitScreen(); showKinds(); return true;
    },
    get ownVideo() { return !!S.fv; },
    // Плеер сайта на стене (YouTube, Rutube, VK Видео, Vimeo — webplayers.js): под холстом, повёрнут по панели; пауза, перемотка, громкость — сообщениями
    // через адаптер сайта; родные кнопки плеера — когда он поднят под курсором (`lift`).
    playWeb(site, m, sound = true) {
      api.stop(); S.mode = S.kind = 'web'; S.name = site.name; S.paused = false; S.target = 1; S.webVol = -1; S.webMute = null; S.webHeard = false;
      S.webTime = m.start || 0; S.webAt = performance.now(); S.webDur = 0; holeMat.opacity = 1; holeMat.color.setScalar(0); showKinds();
      const f = document.createElement('iframe'); f.id = 'cinemaFrame'; f.title = site.name; f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.allow = site.allow ?? 'autoplay; encrypted-media'; f.width = PX; f.height = PY;
      f.src = site.src(m, { sound, origin: location.origin });
      S.ctl = site.connect(f, m, webOn(f, site));
      f.addEventListener('mouseleave', () => api.lift(false));   // курсор ушёл с плеера — он снова под залом
      camEl.appendChild(f); stage.hidden = false; stageKey = ''; S.frame = f; S.lifted = false; return f;
    },
    get soundOk() { return S.mode !== 'file' || (S.player ? actx.state === 'running' : S.soundOk !== false); },
    // Свой звук (filmaudio) и дорожки файла: tracks — [{ codec, lang, title, layout, … }], track — номер играющей; noAudio — в файле звука нет.
    setSubLines(lines) { drawSub(lines ?? []); },
    // Субтитры: дорожки файла (subList — [{ codec, lang, title, kind: 'text' | 'bitmap' }]), выбранная (subTrack: номер, -1 — нет, 'ext' — из своего файла).
    get subtitles() { return S.subList ?? []; }, get subTrack() { return S.subTrack; }, get subName() { return S.subName ?? ''; },
    setSubtitle(i) {
      if (S.mode !== 'file' && !S.pending) return;
      S.ext?.dispose(); S.ext = null; S.subName = '';
      if (!(i >= 0) || !S.fa || S.subList?.[i]?.kind !== 'text') { S.subTrack = -1; S.subs?.setTrack(-1); drawSub([]); return; }
      S.subTrack = i;
      if (S.subs) S.subs.setTrack(i); else S.subs = S.fa.watchSubtitles({ video: V, track: i, onChange: (lines, rich) => drawSub(rich ?? lines) });
    },
    // Свой файл субтитров (.srt, .vtt, .ass; кодировка — сама, в том числе windows-1251): идёт по часам видео, дорожки файла выключаются.
    async loadSubFile(file) {
      const { cues } = await parseSubtitleFile(file);
      if (S.mode !== 'file' && !S.pending) return 0;
      S.subs?.setTrack(-1); S.ext?.dispose();
      S.ext = watchCues({ video: V, cues, onChange: (lines, rich) => drawSub(rich ?? lines) }); S.subTrack = 'ext'; S.subName = file.name;
      return cues.length;
    },
    // Ошибка на экране: проектор светит карточкой с причиной, пока её не выключат (`stop`) или не включат другое видео.
    showError(text) {
      api.stop(); S.mode = S.kind = 'card'; S.error = text; S.target = 1; drawCard(text, true); showKinds();
    },
    get error() { return S.mode === 'card' ? S.error : ''; },
    get waiting() { return S.mode === 'file' || S.pending ? (S.waitAt ? (performance.now() - S.waitAt) / 1000 : 0) : 0; },
    get credit() { return S.mode === 'file' ? S.credit ?? '' : ''; }, get page() { return S.mode === 'file' ? S.page ?? '' : ''; }, get silent() { return S.mode === 'file' && !!S.silent; },
    get ownAudio() { return !!S.player; }, get hdr() { return hdrU.value > .5; }, get audioStats() { return S.player?.stats(); }, get tracks() { return S.tracks ?? []; }, get track() { return S.track ?? 0; }, get noAudio() { return !!S.noAudio; },
    setTrack(i) {
      if (!S.fa || i === S.track || !S.tracks[i]) return;
      S.track = i;
      if (S.player) S.player.setTrack(i); else if (S.fa.needsOwnAudio(V, i).needed) attachOwn();
    },
    // Нажатие пользователя: звук, которого не дали при запуске, включается.
    unlockSound() {
      if (S.player && actx.state !== 'running') { actx.resume().catch(() => {}); return; }
      if (S.mode !== 'file' || S.soundOk !== false || V !== video) return;
      S.soundOk = true; video.muted = false; video.play().catch(() => { S.soundOk = false; video.muted = true; video.play().catch(() => {}); });
    },
    // Перемотка (ползунок на плашке): где сейчас и сколько всего, секунды; duration 0 — ещё неизвестно.
    get time() {
      if (S.mode === 'web') return Math.min(S.webDur || Infinity, S.webTime + (S.paused ? 0 : (performance.now() - S.webAt) / 1000));
      return S.mode === 'file' ? V.currentTime : 0;
    },
    get duration() {
      if (S.mode === 'web') return S.webDur || 0;
      if (S.mode !== 'file') return 0;
      return Number.isFinite(V.duration) && V.duration > 0 ? V.duration : S.fa?.duration ?? 0;
    },
    seek(t) {
      const d = api.duration; if (!d) return;
      t = Math.max(0, Math.min(d - .25, t));
      if (S.mode === 'web') { S.ctl?.seek(t); S.webTime = t; S.webAt = performance.now(); }
      else if (S.mode === 'file') V.currentTime = t;   // свой звук (filmaudio) следует за перемоткой сам
    },
    // Пульт YouTube: пока курсор на экране, плеер поднимается над холстом (z-index 0 — над холстом, но под клавишами и плашками зала) и ловит мышь —
    // его кнопки, субтитры, качество, полный экран работают. Над залом нет ни луча, ни тёплой дымки окна: её заменяет фильтр (приблизительно та же).
    // Ушёл курсор — плеер снова под холстом, фокус возвращается в зал (иначе стрелки уходили бы плееру).
    lift(on) {
      if (!S.frame || S.mode !== 'web' || !!S.lifted === on) return;
      S.lifted = on; stage.style.zIndex = on ? '0' : ''; S.frame.style.pointerEvents = on ? 'auto' : 'none'; S.frame.style.filter = on ? 'brightness(.78) sepia(.16)' : '';
      if (!on && document.activeElement === S.frame) S.frame.blur();
    },
    get lifted() { return !!S.lifted; },
    togglePause() {
      if (S.mode === 'web') { if (S.paused) S.ctl?.play(); else S.ctl?.pause(); S.paused = !S.paused; return true; }
      if (S.mode !== 'file') return false;
      if (V.paused) { V.play().catch(() => {}); S.paused = false; } else { V.pause(); S.paused = true; }
      return true;
    },
    // Выключить всё: видео остановлено, окошко убрано, свет гаснет (зал приглушён, пока `lit` не дойдёт до нуля).
    stop() {
      S.subs?.dispose(); S.ext?.dispose(); S.subs = S.ext = null; S.subTrack = -1; S.subList = null; S.subName = '';
      drawSub([]); hdrU.value = 0; S.player?.dispose(); S.fa?.close(); S.player = S.fa = S.tracks = null; S.track = 0; S.noAudio = false; S.faVol = -1;
      S.ownTok = null; if (S.fv) { S.fv.close(); S.fv = null; } V = video; lastSerial = -1; ownAspect = 0;
      S.pending = false; if (S.mode === 'file' || video.src) { video.pause(); video.removeAttribute('src'); video.load(); }
      S.ctl?.dispose(); S.ctl = null;
      dropUrl(); if (S.frame) { S.frame.src = 'about:blank'; S.frame.remove(); S.frame = null; stage.hidden = true; stage.style.zIndex = ''; S.lifted = false; }
      S.mode = 'off'; hole.visible = false; S.waitCard = false; S.error = ''; S.paused = false; S.name = ''; S.target = 0; return true;
    },
    // Раз в кадр, пока идёт YouTube: сцена плеера повторяет камеру зала (перспектива — по фокусному расстоянию в пикселях); стили меняются, только если камера сдвинулась.
    placeFrame(cam, wpx, hpx) {
      if (!S.frame) return;
      const f = cam.projectionMatrix.elements[5] * hpx / 2, key = f.toFixed(3) + cam.matrixWorldInverse.elements.map(v => v.toFixed(5)).join() + wpx + 'x' + hpx;
      if (key === stageKey) return; stageKey = key;
      stage.style.perspective = f + 'px'; camEl.style.width = wpx + 'px'; camEl.style.height = hpx + 'px';
      camEl.style.transform = `translateZ(${f}px)` + camCss(cam.matrixWorldInverse) + `translate(${wpx / 2}px,${hpx / 2}px)`;
      S.frame.style.transform = objCss(frameM);
    },
    get frame() { return S.frame; },
    // Раз в кадр: свет разгорается и гаснет, луч и пыль плывут; true — приглушение зала сдвинулось (зал пересчитает лампы).
    update(dt, time, eyePos, sound) {
      let moved = false;
      // Свой показ: новый кадр — в текстуру (один проход перевода цвета), только когда он сменился.
      if (S.fv) { const f = V.frame; if (f && V.frameSerial !== lastSerial) { lastSerial = V.frameSerial; yuv.update(f); if (ownMat.map !== yuv.texture) ownMat.map = yuv.texture; } }
      if (S.lit !== S.target) {
        const k = 1 - Math.exp(-dt * (S.target > S.lit ? 1.3 : 2.2)); S.lit += (S.target - S.lit) * k;
        if (Math.abs(S.target - S.lit) < .003) S.lit = S.target;
        moved = true; showKinds();
      }
      if (S.lit > 0) {
        const fl = 1 + .016 * Math.sin(time * 47) + .012 * Math.sin(time * 13.1);   // чуть дрожит, как плёнка
        const on = S.lit * (S.mode === 'file' && S.paused ? .94 : 1);
        screenMat.color.setScalar(.82 * on * fl); ownMat.color.setScalar(.82 * on * fl); glowMat.color.setRGB(.5, .38, .24).multiplyScalar(.6 * on * fl);
        if (sub.visible) subMat.color.setScalar(on * fl);
        // Ещё нет первых кадров — карточка на весь экран; потом видео ждёт данных дольше 3 с — полоса поверх кадра; пошли кадры — убрать.
        const loading = S.pending && performance.now() - S.pendAt > 400, stall = S.mode === 'file' && S.waitAt && performance.now() - S.waitAt > 3000;
        const want = loading ? 'L' : stall ? 'W' : '';
        if (want !== (S.waitCard || '')) {
          S.waitCard = want;
          if (loading) drawCard(t(S.link ? 'cinema.card.loadingSite' : 'cinema.card.loading', { name: S.name }), true);
          else if (stall) drawCard(t(S.link ? 'cinema.strip.site' : 'cinema.strip.file'), false);
          showKinds();
        }
        if (card.visible) cardMat.color.setScalar(on * fl);
        if (hole.visible) { const a = Math.min(1, .3 / fl + (1 - on) * .68); holeMat.opacity = a; holeMat.color.setRGB(.12 * a, .075 * a, .04 * a); }
        // Экран файла — сам кадр; у YouTube панель светит ровно, а за кадр ничего не видно.
        beamU.uTime.value = dustU.uTime.value = time; beamU.uLit.value = dustU.uLit.value = on * fl;
        dustU.uPx.value = camera.projectionMatrix.elements[5] * renderer.domElement.height / 2;
        lensSp.material.opacity = Math.min(1, on * 1.05) * fl;
      }
      // Звук: у экрана — полный, дальше по залу тише (до одной восьмой); выключен звук зала — тишина. У YouTube — те же правила, сообщениями плееру.
      const clat = S.mode === 'file' && S.silent && !S.paused && !V.paused && sound && S.lit > .3;
      clatter(clat);
      // Стрекот тихий: .05 у проектора (было .3, потом .12 — пользователь 2026-11-22: «можно потише», «еще тише»), дальше по залу тише.
      if (clatSrc) { const d = eyePos.distanceTo(A), v = .05 * Math.min(1, 1.5 / Math.max(d, .1)); clatGain.gain.setTargetAtTime(v * Math.min(1, S.lit), actx.currentTime, .1); }
      if (S.mode === 'web' && S.webHeard && S.ctl) {
        const d = eyePos.distanceTo(c), v = d <= 4 ? 1 : Math.max(.12, 4 / d);
        if (Math.abs(v - S.webVol) >= .02) { S.webVol = v; S.ctl.volume(v); }
        if (S.webMute !== !sound) { S.webMute = !sound; S.ctl.mute(!sound); }
      }
      if (S.mode === 'file') {
        const d = eyePos.distanceTo(c), v = d <= 4 ? 1 : Math.max(.12, 4 / d);
        if (S.player) {   // свой звук: <video> молчит, громкость — у плеера
          if (V === video && !video.muted) video.muted = true;
          const fv = sound ? v : 0; if (Math.abs(fv - S.faVol) > .01) { S.faVol = fv; S.player.setVolume(fv); }
        } else if (V === video) {
          if (Math.abs(v - S.vol) > .01) { S.vol = v; video.volume = v; }
          const mute = !sound || S.soundOk === false; if (video.muted !== mute) video.muted = mute;
        }
      }
      return moved;
    },
  };
  return api;
}
