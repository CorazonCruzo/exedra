// Заставка «Читального зала»: процедурный рисунок на Canvas 2D, утверждённый вариант
// «Импульс реле». Перенесён со стенда docs/design/reading-room-loaders-2026-11-13 проекта
// concentration без изменений в рисунке (убраны только звук, другие варианты и
// ветки стилей, недостижимые для этого вызова; сверено со стендом точка в точку).
// Модуль без зависимостей; подключается в index.html раньше room.js и стартует ДО загрузки
// three.js. Как он запускается и почему рисует в отдельном потоке — в конце файла.

const BG = '#0b0806';

const TEXT_IVORY = '#eadfc8';
const LAMP_GREEN_DARK = '#06210f';
const LAMP_GREEN_MID = '#0d421d';
const LAMP_GREEN_GLOW = '#1f7a34';

const DEEP_AMBER_RGB = '208, 96, 24';
const AMBER_RGB = '240, 136, 36';
const TUNGSTEN_RGB = '255, 178, 68';
const EMERALD_RGB = '28, 112, 46';
const NAVE_VP_X = 102.25;
const NAVE_VP_Y = -225.5;

/**
 * Compute projected left/right nave lamp positions, scale, and atmospheric depth attenuation
 * for row index `0..count-1` (`0` = farthest) toward shared oblique VP (102.25, -225.5).
 */
function projectObliqueNaveRow(row, count) {
  const uFar = 0.68;
  const xL1 = -54.0;
  const xR1 = 32.0;
  const y1 = -13.0;
  const f = count <= 1 ? 1 : row / (count - 1);
  const zInv = 1 / lerp(1 / uFar, 1.0, f);
  const u = lerp(zInv, lerp(uFar, 1.0, f), 0.22);
  const normU = (u - uFar) / (1.0 - uFar);
  const ly = NAVE_VP_Y + (y1 - NAVE_VP_Y) * u;
  return {
    lx: NAVE_VP_X + (xL1 - NAVE_VP_X) * u,
    ly,
    rx: NAVE_VP_X + (xR1 - NAVE_VP_X) * u,
    ry: ly,
    ls: lerp(0.30, 0.62, normU),
    depthAtten: lerp(0.56, 1.0, normU),
  };
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

const smoothstep = (x) => {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
};

const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);

/** Gentle tungsten filament breath. */
function microBreath(t, seed = 0) {
  return Math.sin(t * 1.4 + seed) * 0.022 + Math.sin(t * 2.9 + seed * 1.7) * 0.01;
}

/** Soft multi-stop elliptical radial light pool with zero hard boundaries. */
function drawLightPool(ctx, x, y, rx, ry, intensity = 1, rgb = AMBER_RGB) {
  if (intensity <= 0.004 || rx <= 0.5 || ry <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.02, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb}, ${(0.44 * intensity).toFixed(3)})`);
  g.addColorStop(0.28, `rgba(${rgb}, ${(0.24 * intensity).toFixed(3)})`);
  g.addColorStop(0.62, `rgba(${rgb}, ${(0.08 * intensity).toFixed(3)})`);
  g.addColorStop(0.86, `rgba(${rgb}, ${(0.02 * intensity).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Hushed distant nave lamp in the gloomy library depth.
 * Deep bottle-emerald cap + subdued cognac-amber table pool; zero bright strokes.
 */
function drawNaveLampSpot(ctx, x, y, scale = 1, glow = 1, bloom = 0) {
  if (glow <= 0.004) return;
  const g = clamp(glow);
  const b = clamp(bloom);
  const halo = 1 + b * 0.24;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  drawLightPool(ctx, 0, 11, 29 * halo, 9.0 * halo, g * (0.84 + b * 0.22), AMBER_RGB);
  drawLightPool(ctx, 0, 9.5, 14 * halo, 4.5 * halo, g * (0.54 + b * 0.36), TUNGSTEN_RGB);
  drawLightPool(ctx, 0, -2, 16 * halo, 8.0 * halo, g * (0.42 + b * 0.14), EMERALD_RGB);

  // Subtle brass stem hint
  ctx.strokeStyle = `rgba(158, 121, 59, ${(0.28 * g).toFixed(3)})`;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(0, 9);
  ctx.stroke();

  // Symmetrical coved dark bottle-emerald glass cap
  ctx.save();
  ctx.globalAlpha *= smoothstep(g * 1.15);
  const wTop = 9.0;
  const wBot = 11.6;
  const topY = -4.0;
  const botY = 2.4;

  const capGrad = ctx.createLinearGradient(0, topY, 0, botY);
  capGrad.addColorStop(0, '#052b16');
  capGrad.addColorStop(0.55, '#0e5c30');
  capGrad.addColorStop(0.92, '#177a42');
  capGrad.addColorStop(1, '#09381d');

  ctx.fillStyle = capGrad;
  ctx.beginPath();
  ctx.moveTo(-wTop, topY);
  ctx.lineTo(wTop, topY);
  ctx.quadraticCurveTo(wBot + 1, topY + 0.4, wBot, botY);
  ctx.lineTo(-wBot, botY);
  ctx.quadraticCurveTo(-wBot - 1, topY + 0.4, -wTop, topY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = `rgba(130, 198, 152, ${(0.2 * g).toFixed(3)})`;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-wTop + 2, topY + 1.2);
  ctx.lineTo(wTop - 2, topY + 1.2);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/**
 * Delicate high barrel-vault ribs and cornice whispers overhead (reading-room hall silhouette),
 * centered with zero camera roll and aligned along (vpVX, vpVY) above the reading aisle.
 */
function drawHighVaults(ctx, hallGlow = 0, lampGlow = 0, opts = {}) {
  const { appear = 1, intensity = 1 } = opts;
  const vaultLit = clamp(appear * (0.18 + 0.62 * clamp(hallGlow) + 0.32 * clamp(lampGlow))) * intensity;
  if (vaultLit <= 0.01) return;

  const rgb = '204, 152, 84';

  const vpVX = 18.0;
  const vpVY = -172.0;
  const proj = (x1, y1, u) => [
    vpVX + (x1 - vpVX) * u,
    vpVY + (y1 - vpVY) * u,
  ];

  const xVL1 = -210.0;
  const xVR1 = 214.0;
  const ySp1 = -118.0;
  const yCrown1 = -228.0;

  const archPointAt = (u, ang) => {
    const [vlx, ysp] = proj(xVL1, ySp1, u);
    const [vrx] = proj(xVR1, ySp1, u);
    const [, ycr] = proj(0, yCrown1, u);
    const t = (1 - Math.cos(ang)) * 0.5;
    const ax = lerp(vlx, vrx, t);
    const ay = ysp - (ysp - ycr) * Math.pow(Math.sin(ang), 0.90);
    return [ax, ay];
  };

  ctx.save();

  // Soft hushed atmospheric canopy glow inside the upper vault (zero roll)
  drawLightPool(ctx, 4, -200, 156, 40, vaultLit * 0.085, DEEP_AMBER_RGB);

  const strokeFadeRay = (xA, yA, xB, yB, peakAlpha, lineWidth) => {
    const grad = ctx.createLinearGradient(xA, yA, xB, yB);
    grad.addColorStop(0, `rgba(${rgb}, 0)`);
    grad.addColorStop(0.28, `rgba(${rgb}, ${peakAlpha.toFixed(3)})`);
    grad.addColorStop(0.76, `rgba(${rgb}, ${(peakAlpha * 0.55).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(xA, yA);
    ctx.lineTo(xB, yB);
    ctx.stroke();
  };

  // Receding springing cornice whispers (left & right walls meeting the vault)
  const [lcNearX, lcNearY] = proj(xVL1, ySp1, 1.02);
  const [lcFarX, lcFarY] = proj(xVL1, ySp1, 0.40);
  strokeFadeRay(lcNearX, lcNearY, lcFarX, lcFarY, 0.052 * vaultLit, 0.75);

  const [rcNearX, rcNearY] = proj(xVR1, ySp1, 1.02);
  const [rcFarX, rcFarY] = proj(xVR1, ySp1, 0.40);
  strokeFadeRay(rcNearX, rcNearY, rcFarX, rcFarY, 0.052 * vaultLit, 0.75);

  // 3 whisper-faint longitudinal coffer purlins converging to (vpVX, vpVY)
  for (const theta of [0.34 * Math.PI, 0.50 * Math.PI, 0.66 * Math.PI]) {
    const [pNearX, pNearY] = archPointAt(1.02, theta);
    const [pFarX, pFarY] = archPointAt(0.40, theta);
    strokeFadeRay(pNearX, pNearY, pFarX, pFarY, 0.044 * vaultLit, 0.6);
  }

  // 4 receding semi-elliptical transverse vault arches
  const bays = [1.0, 0.76, 0.57, 0.43];
  const bayFades = [1.0, 0.80, 0.62, 0.44];
  const segments = 36;

  for (let b = 0; b < bays.length; b++) {
    const u = bays[b];
    const bayFade = bayFades[b];
    const a = vaultLit * bayFade;
    const [vlx] = proj(xVL1, ySp1, u);
    const [vrx] = proj(xVR1, ySp1, u);
    const [, ycr] = proj(0, yCrown1, u);

    const pts = [];
    for (let i = 0; i <= segments; i++) {
      pts.push(archPointAt(u, (Math.PI * i) / segments));
    }

    // Soft dark extrados relief shadow above arch rib
    ctx.strokeStyle = `rgba(4, 3, 2, ${(0.28 * a).toFixed(3)})`;
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      if (i === 0) ctx.moveTo(px, py - 1.5 * u);
      else ctx.lineTo(px, py - 1.5 * u);
    }
    ctx.stroke();

    // Main molded arch rib dissolving symmetrically at springing ends
    const ribGrad = ctx.createLinearGradient(vlx, ycr, vrx, ycr);
    ribGrad.addColorStop(0, `rgba(${rgb}, 0)`);
    ribGrad.addColorStop(0.20, `rgba(${rgb}, ${(0.062 * a).toFixed(3)})`);
    ribGrad.addColorStop(0.50, `rgba(${rgb}, ${(0.112 * a).toFixed(3)})`);
    ribGrad.addColorStop(0.80, `rgba(${rgb}, ${(0.062 * a).toFixed(3)})`);
    ribGrad.addColorStop(1, `rgba(${rgb}, 0)`);

    ctx.strokeStyle = ribGrad;
    ctx.lineWidth = Math.max(0.5, 0.95 * u);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Fine inner coffer fillet companion line
    const innerGrad = ctx.createLinearGradient(vlx, ycr, vrx, ycr);
    innerGrad.addColorStop(0, `rgba(${rgb}, 0)`);
    innerGrad.addColorStop(0.20, `rgba(${rgb}, ${(0.062 * 0.42 * a).toFixed(3)})`);
    innerGrad.addColorStop(0.50, `rgba(${rgb}, ${(0.112 * 0.42 * a).toFixed(3)})`);
    innerGrad.addColorStop(0.80, `rgba(${rgb}, ${(0.062 * 0.42 * a).toFixed(3)})`);
    innerGrad.addColorStop(1, `rgba(${rgb}, 0)`);

    ctx.strokeStyle = innerGrad;
    ctx.lineWidth = Math.max(0.4, 0.55 * u);
    ctx.beginPath();
    for (let i = 2; i <= pts.length - 3; i++) {
      const [px, py] = pts[i];
      if (i === 2) ctx.moveTo(px, py + 2.6 * u);
      else ctx.lineTo(px, py + 2.6 * u);
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Heavy antique mahogany & tooled-leather library desk (бювар).
 * Almost invisible in darkness until revealed by the left lamp's cognac-amber light,
 * with left/right sides dissolving organically into #0b0806 gloom.
 */
function drawLibraryDesk(ctx, opts = {}) {
  const {
    rearY = 52,
    frontY = 124,
    lampX = -132,
    ambient = 0.06,
    light = 0,
  } = opts;

  const l = clamp(light);
  const amb = clamp(ambient);

  const surf = lerp(amb * 2.4, 1.0, smoothstep(l));
  const focusX = lampX + 62;
  const focusY = rearY + 34;

  if (surf <= 0.004 && l <= 0.004) return;

  ctx.save();

  // Subtle rear edge whisper before lamp ignites
  if (l < 0.99 && amb > 0) {
    const preRim = ctx.createLinearGradient(-290, rearY, 290, rearY);
    preRim.addColorStop(0, 'rgba(92, 62, 34, 0)');
    preRim.addColorStop(0.32, `rgba(116, 80, 44, ${(amb * 0.75 * (1 - l)).toFixed(3)})`);
    preRim.addColorStop(0.68, `rgba(92, 62, 34, ${(amb * 0.45 * (1 - l)).toFixed(3)})`);
    preRim.addColorStop(1, 'rgba(92, 62, 34, 0)');
    ctx.strokeStyle = preRim;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-290, rearY);
    ctx.lineTo(290, rearY);
    ctx.stroke();
  }

  // 1. Wide mahogany top surface (dimly present before click, warmly lit when lamp turns on)
  const topRadius = 305;
  const topGrad = ctx.createRadialGradient(focusX, focusY, 18, focusX + 24, focusY + 6, topRadius);
  topGrad.addColorStop(0, `rgba(64, 32, 12, ${(0.96 * surf).toFixed(3)})`);
  topGrad.addColorStop(0.42, `rgba(38, 19, 8, ${(0.88 * surf).toFixed(3)})`);
  topGrad.addColorStop(0.76, `rgba(20, 11, 6, ${(0.55 * surf).toFixed(3)})`);
  topGrad.addColorStop(1, 'rgba(11, 8, 6, 0)');
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.moveTo(-330, rearY);
  ctx.lineTo(330, rearY);
  ctx.lineTo(350, frontY);
  ctx.lineTo(-350, frontY);
  ctx.closePath();
  ctx.fill();

  // Rear mahogany bevel glint catching lamp light near lampX
  const rearBevel = ctx.createRadialGradient(lampX + 20, rearY, 12, lampX + 40, rearY, 265);
  rearBevel.addColorStop(0, `rgba(212, 138, 58, ${(0.44 * surf).toFixed(3)})`);
  rearBevel.addColorStop(0.55, `rgba(148, 92, 38, ${(0.22 * surf).toFixed(3)})`);
  rearBevel.addColorStop(1, 'rgba(60, 38, 20, 0)');
  ctx.strokeStyle = rearBevel;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(-310, rearY);
  ctx.lineTo(310, rearY);
  ctx.stroke();

  // 2. Inset perspective tooled-leather writing mat (бювар) centered symmetrically along x = 0
  const mTopY = rearY + 6;
  const mBotY = frontY - 8;
  const mTL = -228;
  const mTR = 228;
  const mBL = -246;
  const mBR = 246;

  const matRadius = 260;
  const matFill = ctx.createRadialGradient(focusX + 12, focusY + 4, 16, focusX + 35, focusY + 10, matRadius);
  matFill.addColorStop(0, `rgba(44, 24, 11, ${(0.95 * surf).toFixed(3)})`);
  matFill.addColorStop(0.55, `rgba(25, 14, 7, ${(0.88 * surf).toFixed(3)})`);
  matFill.addColorStop(1, 'rgba(11, 8, 6, 0)');
  ctx.fillStyle = matFill;
  ctx.beginPath();
  ctx.moveTo(mTL, mTopY);
  ctx.lineTo(mTR, mTopY);
  ctx.lineTo(mBR, mBotY);
  ctx.lineTo(mBL, mBotY);
  ctx.closePath();
  ctx.fill();

  // Warm leather sheen pools between the lamp and typewriter (strictly only when lamp glows)
  if (l > 0.004) {
    drawLightPool(ctx, lampX + 104, (mTopY + mBotY) * 0.5, 176, 36, l * 0.74, AMBER_RGB);
    drawLightPool(ctx, lampX + 54, (mTopY + mBotY) * 0.5 - 2, 96, 25, l * 0.50, TUNGSTEN_RGB);
  }

  // Subtle double blind-tooled / antique-gilt hairline inset frame on leather mat
  const borderGrad = ctx.createRadialGradient(focusX + 8, focusY, 20, focusX + 30, focusY, 245);
  borderGrad.addColorStop(0, `rgba(208, 142, 62, ${(0.28 * surf).toFixed(3)})`);
  borderGrad.addColorStop(0.65, `rgba(158, 104, 46, ${(0.13 * surf).toFixed(3)})`);
  borderGrad.addColorStop(1, 'rgba(92, 64, 34, 0)');

  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(mTL, mTopY);
  ctx.lineTo(mTR, mTopY);
  ctx.lineTo(mBR, mBotY);
  ctx.lineTo(mBL, mBotY);
  ctx.closePath();
  ctx.stroke();

  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(mTL + 4.5, mTopY + 2.8);
  ctx.lineTo(mTR - 4.5, mTopY + 2.8);
  ctx.lineTo(mBR - 5, mBotY - 2.8);
  ctx.lineTo(mBL + 5, mBotY - 2.8);
  ctx.closePath();
  ctx.stroke();

  // 3. Molded mahogany front edge fascia at frontY
  const lipGrad = ctx.createRadialGradient(lampX + 55, frontY, 24, lampX + 75, frontY, 315);
  lipGrad.addColorStop(0, `rgba(34, 19, 10, ${(0.95 * surf).toFixed(3)})`);
  lipGrad.addColorStop(0.7, `rgba(19, 11, 7, ${(0.75 * surf).toFixed(3)})`);
  lipGrad.addColorStop(1, 'rgba(11, 8, 6, 0)');
  ctx.fillStyle = lipGrad;
  ctx.fillRect(-350, frontY, 700, 7);

  // Top & lower front molding glints
  const lipRimTop = ctx.createRadialGradient(lampX + 42, frontY, 18, lampX + 60, frontY, 275);
  lipRimTop.addColorStop(0, `rgba(204, 136, 58, ${(0.36 * surf).toFixed(3)})`);
  lipRimTop.addColorStop(0.6, `rgba(142, 90, 38, ${(0.16 * surf).toFixed(3)})`);
  lipRimTop.addColorStop(1, 'rgba(60, 38, 20, 0)');
  ctx.strokeStyle = lipRimTop;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(-340, frontY);
  ctx.lineTo(340, frontY);
  ctx.stroke();

  const lipRimBot = ctx.createRadialGradient(lampX + 42, frontY + 5, 18, lampX + 60, frontY + 5, 250);
  lipRimBot.addColorStop(0, `rgba(176, 114, 48, ${(0.2 * surf).toFixed(3)})`);
  lipRimBot.addColorStop(1, 'rgba(60, 38, 20, 0)');
  ctx.strokeStyle = lipRimBot;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-330, frontY + 5);
  ctx.lineTo(330, frontY + 5);
  ctx.stroke();

  ctx.restore();
}

/**
 * Strictly plumb, weighty antique banker's lamp anchored at its cast-brass base center (x, baseY).
 * Zero angle tilt, zero bent wire stem: 4-tier domed brass base + cylindrical vertical stem +
 * plumb right-side beaded brass pull-chain + deep forest bottle-emerald coved glass hood with symmetrical brass caps.
 */
function drawAntiqueBankerLamp(ctx, x, baseY, scale = 1, glow = 1, opts = {}) {
  const { appear = 1, chainPull = 0, stemHeight = 64 } = opts;

  const app = clamp(appear);
  if (app <= 0.004) return;
  const g = clamp(glow);

  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= app;

  const botY = -stemHeight;
  const topY = botY - 30;
  const swTop = 39;
  const swBot = 48;

  // 1. Directional warm honey-cognac light pools cast down & right across leather desk and typewriter
  if (g > 0.004) {
    drawLightPool(ctx, 64, 2, 248, 68, g * 0.68, DEEP_AMBER_RGB);
    drawLightPool(ctx, 56, -2, 218, 60, g * 0.90, AMBER_RGB);
    drawLightPool(ctx, 12, -10, 102, 37, g * 0.86, TUNGSTEN_RGB);
    drawLightPool(ctx, 4, botY + 6, 58, 20, g * 0.56, TUNGSTEN_RGB);
    drawLightPool(ctx, 0, botY - 12, 56, 21, g * 0.32, EMERALD_RGB);
  }

  // 2. Contact shadow beneath heavy cast-brass base (feathered across all vibes to avoid hard cutout)
  {
    ctx.save();
    ctx.translate(2, 2);
    ctx.scale(1, 8.2 / 31);
    const shGrad = ctx.createRadialGradient(0, 0, 12, 0, 0, 32);
    shGrad.addColorStop(0, 'rgba(2, 1, 1, 0.86)');
    shGrad.addColorStop(0.75, 'rgba(2, 1, 1, 0.45)');
    shGrad.addColorStop(1, 'rgba(2, 1, 1, 0)');
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Helper to mix dark-bronze resting values to glowing brass values cleanly
  const brassScale = 1.0;
  const mixBrass = (alphaMult) => lerp(0.14, 1.0, g) * alphaMult * brassScale;

  // 3. Sculpted 4-tier domed cast-brass base
  const tiers = [
    [27, 7.0, 0],
    [22, 5.6, -2.4],
    [15.5, 4.0, -5.0],
    [8.5, 2.4, -7.4],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [rx, ry, ty] = tiers[i];
    const grad = ctx.createLinearGradient(-rx, ty, rx, ty);
    grad.addColorStop(0, `rgba(22, 15, 9, ${clamp(0.85 + g * 0.15).toFixed(2)})`);
    grad.addColorStop(0.28, `rgba(104, 68, 28, ${mixBrass(0.9).toFixed(3)})`);
    grad.addColorStop(0.46, `rgba(224, 166, 74, ${mixBrass(0.96).toFixed(3)})`);
    grad.addColorStop(0.68, `rgba(82, 54, 22, ${mixBrass(0.9).toFixed(3)})`);
    grad.addColorStop(1, `rgba(18, 12, 7, ${clamp(0.85 + g * 0.15).toFixed(2)})`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, ty, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle upper rim gleam
    const rimAlpha = lerp(0.11, 0.66, g);
    ctx.strokeStyle = `rgba(244, 192, 98, ${rimAlpha.toFixed(3)})`;
    ctx.lineWidth = i === 0 ? 0.95 : 0.8;
    ctx.beginPath();
    ctx.ellipse(0, ty, rx, ry, 0, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();
  }

  // 4. Plumb turned cylindrical brass column (width 5.2px)
  const colHalfW = 2.6;
  const colBot = -8;
  const colTop = botY + 2;
  const colGrad = ctx.createLinearGradient(-colHalfW, 0, colHalfW, 0);
  colGrad.addColorStop(0, '#181008');
  colGrad.addColorStop(0.24, `rgba(136, 94, 38, ${(lerp(0.2, 0.96, g) * brassScale).toFixed(3)})`);
  colGrad.addColorStop(0.44, `rgba(234, 178, 84, ${(lerp(0.24, 1.0, g) * brassScale).toFixed(3)})`);
  colGrad.addColorStop(0.74, `rgba(76, 50, 20, ${(lerp(0.2, 0.92, g) * brassScale).toFixed(3)})`);
  colGrad.addColorStop(1, '#160f08');
  ctx.fillStyle = colGrad;
  ctx.fillRect(-colHalfW, colTop, colHalfW * 2, colBot - colTop);

  // Turned brass collars on the stem
  for (const [cy, crx, cry] of [
    [-32, 4.6, 1.8],
    [botY + 5, 5.2, 2.0],
  ]) {
    ctx.fillStyle = `rgba(184, 140, 68, ${lerp(0.18, 0.86, g).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, cy, crx, cry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(24, 16, 9, 0.7)`;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // 5. Dead-vertical beaded brass pull-chain on right side of shade (x = +19)
  {
    const chainX = 19;
    const chainStart = botY + 1;
    const chainLen = 24 + clamp(chainPull) * 7;
    const chainAlpha = lerp(0.46, 0.95, g);

    ctx.strokeStyle = `rgba(164, 126, 62, ${(chainAlpha * 0.72).toFixed(3)})`;
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(chainX, chainStart);
    ctx.lineTo(chainX, chainStart + chainLen);
    ctx.stroke();

    ctx.fillStyle = `rgba(222, 182, 106, ${chainAlpha.toFixed(3)})`;
    for (let i = 1; i <= 8; i++) {
      const by = chainStart + (chainLen * i) / 9;
      ctx.beginPath();
      ctx.arc(chainX, by, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    // Small turned brass bell/acorn drop at chain bottom
    const acornY = chainStart + chainLen + 3.1;
    const acornGrad = ctx.createRadialGradient(chainX - 0.6, acornY - 1, 0.3, chainX, acornY, 3.6);
    acornGrad.addColorStop(0, `rgba(244, 214, 152, ${Math.min(1, chainAlpha + 0.08).toFixed(3)})`);
    acornGrad.addColorStop(1, `rgba(128, 92, 38, ${chainAlpha.toFixed(3)})`);
    ctx.fillStyle = acornGrad;
    ctx.beginPath();
    ctx.ellipse(chainX, acornY, 2.0, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Plumb symmetrical coved bottle-emerald glass shade
  // Warm golden inner liner glow peeking along bottom lip
  if (g > 0.01) {
    const linerGrad = ctx.createRadialGradient(0, botY - 0.4, 3, 0, botY, swBot - 3);
    linerGrad.addColorStop(0, `rgba(255, 196, 92, ${(0.90 * g).toFixed(3)})`);
    linerGrad.addColorStop(0.58, `rgba(244, 144, 48, ${(0.50 * g).toFixed(3)})`);
    linerGrad.addColorStop(1, 'rgba(224, 122, 38, 0)');
    ctx.fillStyle = linerGrad;
    ctx.beginPath();
    ctx.ellipse(0, botY, swBot - 2, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trace symmetrical horizontal coved glass hood path
  const traceHood = () => {
    ctx.beginPath();
    ctx.moveTo(-swTop, topY);
    ctx.lineTo(swTop, topY);
    ctx.bezierCurveTo(swBot - 0.5, topY, swBot + 1.5, botY - 11, swBot, botY);
    ctx.lineTo(-swBot, botY);
    ctx.bezierCurveTo(-swBot - 1.5, botY - 11, -swBot + 0.5, topY, -swTop, topY);
    ctx.closePath();
  };

  // Resting dark obsidian-emerald shell
  traceHood();
  const darkShell = ctx.createLinearGradient(0, topY, 0, botY);
  darkShell.addColorStop(0, '#0b1710');
  darkShell.addColorStop(0.65, '#07100b');
  darkShell.addColorStop(1, '#040a07');
  ctx.fillStyle = darkShell;
  ctx.fill();

  // Lit deep forest bottle-emerald glass & 3D cylindrical rolloff
  if (g > 0.005) {
    ctx.save();
    ctx.globalAlpha *= g;

    traceHood();
    const emeraldGrad = ctx.createLinearGradient(0, topY, 0, botY);
    emeraldGrad.addColorStop(0, LAMP_GREEN_DARK);
    emeraldGrad.addColorStop(0.32, LAMP_GREEN_MID);
    emeraldGrad.addColorStop(0.66, '#156329');
    emeraldGrad.addColorStop(0.88, LAMP_GREEN_GLOW);
    emeraldGrad.addColorStop(1, '#0a3818');
    ctx.fillStyle = emeraldGrad;
    ctx.fill();

    // Subtle interior warm-emerald bulb heart
    const bulbHeart = ctx.createRadialGradient(0, botY - 9, 3, 0, botY - 9, 34);
    bulbHeart.addColorStop(0, 'rgba(176, 216, 94, 0.32)');
    bulbHeart.addColorStop(0.55, 'rgba(56, 142, 52, 0.15)');
    bulbHeart.addColorStop(1, 'rgba(10, 48, 20, 0)');
    ctx.fillStyle = bulbHeart;
    ctx.fill();

    // Horizontal cylindrical edge shading so sides roll smoothly into shadow
    const sideVignette = ctx.createLinearGradient(-swBot, 0, swBot, 0);
    sideVignette.addColorStop(0, 'rgba(3, 12, 7, 0.65)');
    sideVignette.addColorStop(0.16, 'rgba(3, 12, 7, 0.15)');
    sideVignette.addColorStop(0.5, 'rgba(3, 12, 7, 0)');
    sideVignette.addColorStop(0.84, 'rgba(3, 12, 7, 0.15)');
    sideVignette.addColorStop(1, 'rgba(3, 12, 7, 0.65)');
    ctx.fillStyle = sideVignette;
    ctx.fill();

    ctx.restore();
  }

  // Straight dark antique-brass bottom bezel rim
  ctx.strokeStyle = `rgba(218, 162, 74, ${lerp(0.14, 0.76, g).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-swBot - 0.5, botY);
  ctx.lineTo(swBot + 0.5, botY);
  ctx.stroke();

  // Subtle horizontal beveled top glass highlight
  ctx.strokeStyle = `rgba(196, 232, 172, ${lerp(0.08, 0.24, g).toFixed(3)})`;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-swTop + 5, topY + 3.2);
  ctx.lineTo(swTop - 5, topY + 3.2);
  ctx.stroke();

  // Symmetrical brass side pivot mounts & knurled thumbscrews on BOTH ends
  for (const dir of [-1, 1]) {
    const px = dir * (swBot + 0.8);
    const py = botY - 10;
    // Slight directional weighting (left cap dimly lit when g > 0, right cap brighter facing desk/typewriter glow or vice-versa)
    const capAlpha = lerp(0.22, dir < 0 ? 0.68 : 0.84, g);

    // Pivot stud
    ctx.fillStyle = `rgba(156, 118, 56, ${capAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, 2.3, 0, Math.PI * 2);
    ctx.fill();

    // Knurled thumbscrew stem & head
    ctx.fillStyle = `rgba(218, 178, 102, ${capAlpha.toFixed(3)})`;
    ctx.fillRect(dir < 0 ? px - 4.2 : px + 1.2, py - 1.5, 3.0, 3.0);
    ctx.fillStyle = `rgba(92, 66, 30, ${capAlpha.toFixed(3)})`;
    ctx.fillRect(dir < 0 ? px - 2.6 : px + 1.2, py - 0.8, 1.4, 1.6);
  }

  ctx.restore();
}

/**
 * Reading-room's exact 3D Victorian typewriter (Tijerín Art Studio, typewriter-victorian.glb,
 * matching now-night-seat.jpg, sun-desk.jpg, and preview-mashinka.png):
 *  - Tall chamfered black rear crest with arched antique-gold banner/filigree
 *  - Overhanging carriage arms, charcoal rubber platen, bright steel end-collars & dual fluted gear knobs (no hook)
 *  - Twin gleaming horizontal front carriage scale bars with center black half-moon boss & pointer arrow
 *  - Gold-pinstriped open corner pillars, deep slotted circular comb-drum basket & olive-branch gilt garlands
 *  - Stepped 4-row ivory keyboard (12 / 12 / 11 / 10) + upper-left RETURN + twin lower SHIFT keys + black spacebar
 * Dimly visible from frame 1 alongside the unlit banker's lamp; bathed in warm honey-cognac tungsten when lit.
 */
function drawVintageTypewriter(ctx, x, frontY, scale = 1, lightReveal = 1, opts = {}) {
  const { appear = 1 } = opts;
  const app = clamp(appear);
  if (app <= 0.004) return;
  const g = smoothstep(clamp(lightReveal));

  ctx.save();
  ctx.translate(x, frontY);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= app;

  const m = lerp(0.24, 1.0, g);
  const kLit = lerp(0.30, 1.0, g);
  const mixC = (a, b) => Math.round(lerp(a, b, g));
  const rgbMix = (r0, g0, b0, r1, g1, b1) => `${mixC(r0, r1)}, ${mixC(g0, g1)}, ${mixC(b0, b1)}`;
  const hexMix = (c0, c1) => `rgb(${rgbMix(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2])})`;

  // Helper to mix warm directional highlights from lamp on the left
  const gold = (a) => `rgba(${rgbMix(178, 138, 76, 240, 166, 62)}, ${(a * m).toFixed(3)})`;
  const goldSoft = (a) => `rgba(${rgbMix(144, 108, 58, 192, 132, 52)}, ${(a * m).toFixed(3)})`;
  const warmSteel = (a) => `rgba(${rgbMix(182, 170, 148, 250, 206, 134)}, ${(a * m).toFixed(3)})`;
  const midSteel = (a) => `rgba(${rgbMix(144, 132, 114, 204, 160, 98)}, ${(a * m).toFixed(3)})`;
  const dimSteel = (a) => `rgba(${rgbMix(96, 86, 72, 140, 112, 74)}, ${(a * m).toFixed(3)})`;

  // Subtle warm-amber spill pool around the typewriter base when lamp glows
  if (g > 0.004) {
    drawLightPool(ctx, -6, -26, 84, 36, g * 0.44, AMBER_RGB);
  }

  // 1. Cast & contact shadows on leather writing mat
  ctx.fillStyle = `rgba(4, 2, 1, ${lerp(0.28, 0.78, g).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(14, -14, 64, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(3, 2, 1, ${lerp(0.65, 0.9, g).toFixed(3)})`;
  ctx.fillRect(-51, -4, 102, 6.5);

  // 2. Arched piano-black rear crest shield & Victorian antique-gold banner (-87..-73, matches sun-desk.jpg)
  const crestGrad = ctx.createLinearGradient(-37, -87, 37, -73);
  crestGrad.addColorStop(0, hexMix([17, 14, 11], [30, 22, 16]));
  crestGrad.addColorStop(0.45, hexMix([11, 9, 7], [15, 11, 8]));
  crestGrad.addColorStop(1, '#060504');
  ctx.fillStyle = crestGrad;
  ctx.beginPath();
  ctx.moveTo(-36, -73);
  ctx.lineTo(-36, -82.5);
  ctx.quadraticCurveTo(-36, -85.2, -28, -85.8);
  ctx.quadraticCurveTo(0, -87.6, 28, -85.8);
  ctx.quadraticCurveTo(36, -85.2, 36, -82.5);
  ctx.lineTo(36, -73);
  ctx.closePath();
  ctx.fill();

  // Warm top-bevel highlight on crest fading left-to-right
  const crestRim = ctx.createLinearGradient(-36, -86, 36, -86);
  crestRim.addColorStop(0, gold(0.46));
  crestRim.addColorStop(0.55, goldSoft(0.24));
  crestRim.addColorStop(1, goldSoft(0.06));
  ctx.strokeStyle = crestRim;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-35.6, -75);
  ctx.lineTo(-35.6, -82.4);
  ctx.quadraticCurveTo(-35.6, -84.8, -28, -85.4);
  ctx.quadraticCurveTo(0, -87.1, 28, -85.4);
  ctx.stroke();

  // Signature arched Victorian gold banner/scrollwork on rear crest (matches sun-desk.jpg)
  {
    const bannerGrad = ctx.createLinearGradient(-22, -82, 22, -82);
    bannerGrad.addColorStop(0, gold(0.52));
    bannerGrad.addColorStop(0.5, gold(0.40));
    bannerGrad.addColorStop(1, goldSoft(0.22));
    ctx.strokeStyle = bannerGrad;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-22, -80.4);
    ctx.quadraticCurveTo(0, -83.4, 22, -80.4);
    ctx.stroke();

    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-17, -78.6);
    ctx.quadraticCurveTo(0, -81.0, 17, -78.6);
    ctx.stroke();

    // Subtle filigree scroll flourishes & central lettering gleam
    ctx.fillStyle = bannerGrad;
    ctx.fillRect(-9.5, -81.6, 19, 1.2);
    ctx.beginPath();
    ctx.arc(-20.5, -79.8, 1.0, 0, Math.PI * 2);
    ctx.arc(20.5, -79.8, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Overhanging carriage cheeks, platen roller (Rodillo), steel collars & dual fluted gear knobs (Tuercas)
  // Rear corner projecting tabs on left & right carriage brackets
  ctx.fillStyle = hexMix([15, 12, 10], [26, 20, 15]);
  ctx.fillRect(-50.5, -77, 4.3, 20);
  ctx.fillStyle = '#0c0907';
  ctx.fillRect(46.2, -77, 4.3, 20);

  // Crisp top metallic bevels on overhanging carriage side arms
  ctx.strokeStyle = warmSteel(0.68);
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-50.2, -57.5);
  ctx.lineTo(-50.2, -76.5);
  ctx.lineTo(-46.5, -76.5);
  ctx.stroke();

  ctx.strokeStyle = dimSteel(0.42);
  ctx.beginPath();
  ctx.moveTo(46.5, -76.5);
  ctx.lineTo(50.2, -76.5);
  ctx.lineTo(50.2, -57.5);
  ctx.stroke();

  // Cylindrical matte-charcoal rubber platen roller (-46..+46, y = -74.5..-63)
  const platenGrad = ctx.createLinearGradient(0, -74.5, 0, -63);
  platenGrad.addColorStop(0, hexMix([32, 27, 22], [50, 39, 30]));
  platenGrad.addColorStop(0.28, hexMix([20, 17, 14], [29, 22, 17]));
  platenGrad.addColorStop(0.75, '#0e0b09');
  platenGrad.addColorStop(1, '#070504');
  ctx.fillStyle = platenGrad;
  ctx.fillRect(-46, -74.5, 92, 11.5);

  // Subtle horizontal cylindrical sheen along upper front of rubber platen
  const rollerGleam = ctx.createLinearGradient(-44, -71.5, 44, -71.5);
  rollerGleam.addColorStop(0, warmSteel(0.46));
  rollerGleam.addColorStop(0.55, midSteel(0.26));
  rollerGleam.addColorStop(1, dimSteel(0.12));
  ctx.strokeStyle = rollerGleam;
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  ctx.moveTo(-40, -71.6);
  ctx.lineTo(40, -71.6);
  ctx.stroke();

  // Center thin vertical paper-bail pin above platen pointer
  ctx.fillStyle = warmSteel(0.56);
  ctx.fillRect(-0.55, -75.0, 1.1, 11.5);

  // Gleaming brushed-steel/nickel end-collars on both ends of platen roller
  for (const dir of [-1, 1]) {
    const cxCol = dir < 0 ? -45.8 : 40.8;
    const colGrad = ctx.createLinearGradient(0, -74, 0, -63.5);
    if (dir < 0) {
      colGrad.addColorStop(0, `rgba(${rgbMix(82, 74, 62, 184, 152, 102)}, ${lerp(0.68, 1, g).toFixed(3)})`);
      colGrad.addColorStop(0.32, `rgba(${rgbMix(104, 94, 78, 222, 193, 144)}, ${lerp(0.72, 1, g).toFixed(3)})`);
      colGrad.addColorStop(0.68, `rgba(${rgbMix(54, 46, 36, 114, 88, 56)}, ${lerp(0.7, 1, g).toFixed(3)})`);
      colGrad.addColorStop(1, '#241c14');
    } else {
      colGrad.addColorStop(0, `rgba(${rgbMix(58, 51, 42, 122, 98, 66)}, ${lerp(0.65, 1, g).toFixed(3)})`);
      colGrad.addColorStop(0.32, `rgba(${rgbMix(72, 63, 52, 152, 124, 84)}, ${lerp(0.68, 1, g).toFixed(3)})`);
      colGrad.addColorStop(0.68, `rgba(${rgbMix(38, 32, 26, 72, 56, 36)}, ${lerp(0.68, 1, g).toFixed(3)})`);
      colGrad.addColorStop(1, '#16110c');
    }
    ctx.fillStyle = colGrad;
    ctx.fillRect(cxCol, -74, 5.0, 10.5);
  }

  // Dual symmetrical fluted / gear-toothed platen knobs (Tuercas) on both sides
  for (const dir of [-1, 1]) {
    const isLeft = dir < 0;
    const axleStart = dir * 50.5;
    const axleEnd = dir * 53.0;
    ctx.fillStyle = isLeft ? midSteel(0.74) : dimSteel(0.46);
    ctx.fillRect(Math.min(axleStart, axleEnd), -70.6, 2.5, 4.0);

    const knobX = isLeft ? -58.5 : 53.0;
    const knobGrad = ctx.createLinearGradient(0, -74, 0, -63.5);
    knobGrad.addColorStop(0, isLeft ? hexMix([38, 32, 26], [66, 51, 36]) : '#1b1510');
    knobGrad.addColorStop(0.4, isLeft ? hexMix([24, 20, 16], [38, 29, 21]) : '#100c09');
    knobGrad.addColorStop(1, '#070504');
    ctx.fillStyle = knobGrad;
    ctx.fillRect(knobX, -74, 5.5, 10.5);

    // 5 horizontal knurled / gear ridges catching silver-amber light
    ctx.fillStyle = isLeft ? warmSteel(0.78) : dimSteel(0.44);
    for (let t = 0; t < 5; t++) {
      ctx.fillRect(knobX + 0.3, -73.2 + t * 2.15, 4.9, 0.9);
    }
  }

  // 4. Signature twin gleaming horizontal front carriage scale & guide rails (Reglas, -62.2..-55.8)
  // Upper brushed-nickel wide scale ruler bar (-50..+50, y = -62.2..-59.0)
  const scaleGrad = ctx.createLinearGradient(-50, -60.5, 50, -60.5);
  scaleGrad.addColorStop(0, warmSteel(0.84));
  scaleGrad.addColorStop(0.52, midSteel(0.60));
  scaleGrad.addColorStop(1, dimSteel(0.40));
  ctx.fillStyle = scaleGrad;
  ctx.fillRect(-50, -62.2, 100, 3.2);

  // Subtle top warm-nickel gleam edge on ruler bar
  ctx.strokeStyle = warmSteel(0.66);
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-49.5, -62.1);
  ctx.lineTo(49.5, -62.1);
  ctx.stroke();

  // Fine dark vertical ruler tick marks along front scale bar
  ctx.fillStyle = `rgba(20, 14, 9, ${lerp(0.4, 0.68, g).toFixed(3)})`;
  for (let tx = -42; tx <= 42; tx += 2.8) {
    if (Math.abs(tx) < 5) continue;
    const major = Math.abs(Math.round(tx / 2.8)) % 5 === 0;
    ctx.fillRect(tx, -62.0, 0.65, major ? 2.1 : 1.25);
  }

  // End mounting ears & rivets on ruler ends
  for (const ex of [-47.5, 47.5]) {
    ctx.fillStyle = ex < 0 ? midSteel(0.86) : dimSteel(0.62);
    ctx.beginPath();
    ctx.arc(ex, -60.6, 1.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central black semicircular indicator boss & crisp downward silver pointer arrow
  ctx.fillStyle = '#0b0806';
  ctx.beginPath();
  ctx.arc(0, -61.0, 4.5, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = midSteel(0.45);
  ctx.lineWidth = 0.65;
  ctx.stroke();

  ctx.fillStyle = warmSteel(0.88);
  ctx.beginPath();
  ctx.moveTo(-1.15, -63.0);
  ctx.lineTo(1.15, -63.0);
  ctx.lineTo(0, -61.0);
  ctx.closePath();
  ctx.fill();

  // Lower slender gleaming steel guide rod (-52.5..+52.5, y = -56.8) with two vertical paper-guide clips
  const rodGrad = ctx.createLinearGradient(-52.5, -56.8, 52.5, -56.8);
  rodGrad.addColorStop(0, warmSteel(0.82));
  rodGrad.addColorStop(0.55, midSteel(0.54));
  rodGrad.addColorStop(1, dimSteel(0.36));
  ctx.strokeStyle = rodGrad;
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  ctx.moveTo(-52.5, -56.8);
  ctx.lineTo(52.5, -56.8);
  ctx.stroke();

  for (const clipX of [-14.5, 27.5]) {
    ctx.fillStyle = clipX < 0 ? midSteel(0.82) : dimSteel(0.6);
    ctx.fillRect(clipX - 1.1, -60.2, 2.2, 6.2);
  }

  // 5. Open gold-pinstriped corner pillars, deep slotted circular comb-drum & olive-branch gilt filigree (-56..-32.5)
  const apronGrad = ctx.createLinearGradient(-46, -44, 46, -44);
  apronGrad.addColorStop(0, hexMix([15, 12, 10], [27, 20, 14]));
  apronGrad.addColorStop(0.35, hexMix([11, 9, 7], [16, 12, 9]));
  apronGrad.addColorStop(1, '#070504');
  ctx.fillStyle = apronGrad;
  ctx.fillRect(-46, -56, 92, 23.5);

  // Subtle dark open stepped side pockets flanking upper pillars
  ctx.fillStyle = '#060403';
  ctx.fillRect(-41.5, -54.8, 6.8, 18.5);
  ctx.fillRect(34.7, -54.8, 6.8, 18.5);

  // Architectural vertical corner columns (-46..-41.5 and +41.5..+46) with antique-gold pinstripes
  ctx.fillStyle = hexMix([18, 14, 11], [31, 22, 15]);
  ctx.fillRect(-46, -56, 4.5, 23.5);
  ctx.fillStyle = '#0c0907';
  ctx.fillRect(41.5, -56, 4.5, 23.5);

  ctx.strokeStyle = gold(0.68);
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  // Left corner pillar outer & inner pinstripes + angled foot
  ctx.moveTo(-45.5, -55.5);
  ctx.lineTo(-45.5, -33.0);
  ctx.moveTo(-41.8, -55.5);
  ctx.lineTo(-41.8, -35.0);
  ctx.lineTo(-45.5, -32.6);
  ctx.stroke();

  ctx.strokeStyle = goldSoft(0.36);
  ctx.beginPath();
  // Right corner pillar subdued pinstripes
  ctx.moveTo(45.5, -55.5);
  ctx.lineTo(45.5, -33.0);
  ctx.moveTo(41.8, -55.5);
  ctx.lineTo(41.8, -35.0);
  ctx.lineTo(45.5, -32.6);
  ctx.stroke();

  // Dark flat ribbon-spool wheels tucked tight under carriage deck (very flat & dark -> zero eye pareidolia)
  for (const sx of [-32, 32]) {
    ctx.fillStyle = '#050403';
    ctx.beginPath();
    ctx.ellipse(sx, -54.4, 7.2, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = sx < 0 ? goldSoft(0.24) : goldSoft(0.1);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sx - 6.4, -54.1);
    ctx.lineTo(sx + 6.4, -54.1);
    ctx.stroke();
  }

  // Deep circular slotted comb-drum typebar basket (center 0, -52.5, outer rx 24.5, ry 16.5 down to -36)
  ctx.fillStyle = '#050403';
  ctx.beginPath();
  ctx.ellipse(0, -52.5, 24.5, 16.5, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();

  // Concentric inner stepped gunmetal/steel segment ring inside drum
  const innerRing = ctx.createLinearGradient(-16.5, -52, 16.5, -42);
  innerRing.addColorStop(0, midSteel(0.60));
  innerRing.addColorStop(0.55, dimSteel(0.46));
  innerRing.addColorStop(1, dimSteel(0.24));
  ctx.strokeStyle = innerRing;
  ctx.lineWidth = 1.65;
  ctx.beginPath();
  ctx.ellipse(0, -52.5, 16.5, 10.5, 0, 0.06, Math.PI - 0.06);
  ctx.stroke();

  // 23 closely-spaced slotted comb ribs fanning across curved black drum bowl
  const ribCount = 23;
  for (let i = 0; i < ribCount; i++) {
    const f = i / (ribCount - 1);
    const theta = lerp(Math.PI * 0.06, Math.PI * 0.94, f);
    const x1 = Math.cos(theta) * 17.0;
    const y1 = -52.5 + Math.sin(theta) * 10.9;
    const x2 = Math.cos(theta) * 23.6;
    const y2 = -52.5 + Math.sin(theta) * 15.8;
    const sideLit = lerp(0.56, 0.22, 1 - f);
    ctx.strokeStyle = warmSteel(sideLit);
    ctx.lineWidth = 0.68;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Outer drum bezel rim catching warm brass edge highlight on the left
  const outerRim = ctx.createLinearGradient(-24.5, -46, 24.5, -46);
  outerRim.addColorStop(0, gold(0.58));
  outerRim.addColorStop(0.55, goldSoft(0.30));
  outerRim.addColorStop(1, goldSoft(0.14));
  ctx.strokeStyle = outerRim;
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  ctx.ellipse(0, -52.5, 24.5, 16.5, 0, 0.04, Math.PI - 0.04);
  ctx.stroke();

  // Gleaming central brushed-steel/brass type-guide anvil block right below scale pointer
  const anvilGrad = ctx.createLinearGradient(-4.0, -55, 4.0, -51.5);
  anvilGrad.addColorStop(0, warmSteel(0.76));
  anvilGrad.addColorStop(0.6, midSteel(0.52));
  anvilGrad.addColorStop(1, dimSteel(0.34));
  ctx.fillStyle = anvilGrad;
  ctx.fillRect(-4.0, -54.8, 8.0, 3.4);
  ctx.fillStyle = '#0a0806';
  ctx.fillRect(-1.0, -54.6, 2.0, 2.4);

  // Symmetrical Victorian antique-gold olive-branch garlands flanking the lower drum (preview-mashinka.png)
  for (const dir of [-1, 1]) {
    const isLeft = dir < 0;
    const gStroke = isLeft ? gold(0.48) : goldSoft(0.32);
    ctx.strokeStyle = gStroke;
    ctx.fillStyle = gStroke;
    ctx.lineWidth = 0.72;
    ctx.beginPath();
    ctx.moveTo(dir * 31, -47.5);
    ctx.quadraticCurveTo(dir * 25, -36.5, dir * 7.5, -34.2);
    ctx.stroke();

    // Small olive-leaf accents along the vine
    const leaves = [
      [29.5, -45.5, -0.5],
      [25.5, -41.5, -0.35],
      [20.2, -38.0, -0.2],
      [14.0, -35.6, -0.1],
    ];
    for (const [lx, ly, rot] of leaves) {
      ctx.save();
      ctx.translate(dir * lx, ly);
      ctx.rotate(dir * rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.85, 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Delicate warm-gold centered "Typewriter" script plaque glint above top row
  ctx.fillStyle = gold(0.54);
  ctx.fillRect(-5.8, -34.4, 11.6, 1.15);
  ctx.fillStyle = gold(0.7);
  ctx.fillRect(-2.4, -34.6, 4.8, 1.4);

  // 6. Open stepped 4-row ivory keyboard (12/12/11/10) + RETURN & SHIFT + Spacebar + Gold Base Frame (-32.5..0)
  ctx.fillStyle = '#060403';
  ctx.beginPath();
  ctx.moveTo(-46, -32.5);
  ctx.lineTo(46, -32.5);
  ctx.lineTo(50, 0);
  ctx.lineTo(-50, 0);
  ctx.closePath();
  ctx.fill();

  // Left & right tapering black cheek rails & flat horizontal front base frame
  ctx.fillStyle = hexMix([16, 13, 10], [28, 20, 14]);
  ctx.beginPath();
  ctx.moveTo(-46, -32.5);
  ctx.lineTo(-42.5, -32.5);
  ctx.lineTo(-46, 0);
  ctx.lineTo(-50, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0c0907';
  ctx.beginPath();
  ctx.moveTo(42.5, -32.5);
  ctx.lineTo(46, -32.5);
  ctx.lineTo(50, 0);
  ctx.lineTo(46, 0);
  ctx.closePath();
  ctx.fill();

  // Flat front horizontal base bar (-50..+50, y = -2.8..0)
  const frontBarGrad = ctx.createLinearGradient(-50, -1.4, 50, -1.4);
  frontBarGrad.addColorStop(0, hexMix([18, 15, 11], [34, 24, 16]));
  frontBarGrad.addColorStop(0.55, hexMix([12, 10, 8], [21, 15, 11]));
  frontBarGrad.addColorStop(1, '#090705');
  ctx.fillStyle = frontBarGrad;
  ctx.fillRect(-50, -2.8, 100, 2.8);

  // Crisp gold-leaf pinstripes along left rail, front horizontal bar & subdued right rail
  ctx.strokeStyle = gold(0.56);
  ctx.lineWidth = 0.78;
  ctx.beginPath();
  ctx.moveTo(-49.6, -0.4);
  ctx.lineTo(-45.7, -32.5);
  ctx.stroke();

  ctx.strokeStyle = goldSoft(0.28);
  ctx.lineWidth = 0.72;
  ctx.beginPath();
  ctx.moveTo(49.6, -0.4);
  ctx.lineTo(45.7, -32.5);
  ctx.stroke();

  const frontPin = ctx.createLinearGradient(-50, -2.3, 50, -2.3);
  frontPin.addColorStop(0, gold(0.54));
  frontPin.addColorStop(0.55, gold(0.34));
  frontPin.addColorStop(1, goldSoft(0.16));
  ctx.strokeStyle = frontPin;
  ctx.lineWidth = 0.72;
  ctx.beginPath();
  ctx.moveTo(-49.5, -2.15);
  ctx.lineTo(49.5, -2.15);
  ctx.stroke();

  // Suspended glossy black spacebar (-33..+33, y = -6.4..-3.8) leaving clean dark slot above front rail
  ctx.fillStyle = '#0e0b08';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-33, -6.4, 66, 2.6, 1.1) : ctx.rect(-33, -6.4, 66, 2.6);
  ctx.fill();

  const spaceSheen = ctx.createLinearGradient(-32, -6.2, 32, -6.2);
  spaceSheen.addColorStop(0, gold(0.52));
  spaceSheen.addColorStop(0.6, goldSoft(0.28));
  spaceSheen.addColorStop(1, dimSteel(0.14));
  ctx.strokeStyle = spaceSheen;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-32.2, -6.15);
  ctx.lineTo(32.2, -6.15);
  ctx.stroke();

  // Helper to paint an authentic round Victorian ivory-in-metal keycap (dim dusk bone -> warm honey-ivory when lit)
  const drawRoundKey = (kx, ky, rx, ry, colNorm) => {
    // Even ambient weighting when lamp is off; directional warm left-to-right chiaroscuro when lit
    const effSide = lerp(lerp(0.86, 0.66, colNorm), lerp(0.98, 0.56, colNorm), g);
    const kA = kLit * effSide;

    // Key stem shaft & keywell drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.beginPath();
    ctx.ellipse(kx + 0.5, ky + 1.35, rx + 0.25, ry + 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Warm aged-ivory / honey-cream circular disc (or rag-ivory / yellowed bone per vibe)
    const capGrad = ctx.createRadialGradient(kx - rx * 0.22, ky - ry * 0.28, rx * 0.1, kx, ky, rx * 1.15);
    capGrad.addColorStop(0, `rgba(${rgbMix(196, 178, 148, 252, 216, 152)}, ${(kA * 0.94).toFixed(3)})`);
    capGrad.addColorStop(0.72, `rgba(${rgbMix(172, 152, 122, 232, 186, 118)}, ${(kA * 0.88).toFixed(3)})`);
    capGrad.addColorStop(1, `rgba(${rgbMix(134, 114, 88, 192, 140, 78)}, ${(kA * 0.82).toFixed(3)})`);
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.ellipse(kx, ky, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fine metallic brass/nickel outer bezel ring
    ctx.strokeStyle = `rgba(${rgbMix(158, 132, 92, 218, 162, 78)}, ${(kA * 0.95).toFixed(3)})`;
    ctx.lineWidth = 0.68;
    ctx.stroke();

    // Faint vintage character glyph mark centered on ivory keycap
    ctx.fillStyle = `rgba(44, 30, 18, ${(kA * 0.34).toFixed(3)})`;
    ctx.fillRect(kx - 0.55, ky - 0.35, 1.1, 0.7);
  };

  // Upper-left raised round RETURN key matching preview-mashinka.png & typewriter.js
  drawRoundKey(-42.8, -30.8, 2.3, 1.75, 0.02);

  // 4 closely-packed horizontal rows of round cream/ivory keys (12 / 12 / 11 / 10)
  // Radius kept compact (2.40..2.50) so adjacent keys retain ~2.3px dark separation without merging.
  const rows = [
    { count: 12, x0: -38.5, x1: 40.0, y: -27.8, rx: 2.40, ry: 1.80 },
    { count: 12, x0: -40.2, x1: 40.2, y: -22.2, rx: 2.44, ry: 1.84 },
    { count: 11, x0: -37.5, x1: 37.5, y: -16.6, rx: 2.48, ry: 1.88 },
    { count: 10, x0: -34.0, x1: 34.0, y: -11.0, rx: 2.50, ry: 1.90 },
  ];

  for (const row of rows) {
    const step = (row.x1 - row.x0) / (row.count - 1);
    for (let col = 0; col < row.count; col++) {
      const kx = row.x0 + col * step;
      const normX = col / (row.count - 1);
      drawRoundKey(kx, row.y, row.rx, row.ry, normX);
    }
  }

  // Prominent protruding bottom-left & bottom-right SHIFT KEY discs flanking the black spacebar
  drawRoundKey(-42.0, -6.2, 2.95, 2.15, 0.0);
  drawRoundKey(42.0, -6.2, 2.95, 2.15, 1.0);

  // Subtle brass foot glint at front base corners
  const footGrad = ctx.createLinearGradient(-50, 0.3, 50, 0.3);
  footGrad.addColorStop(0, gold(0.42));
  footGrad.addColorStop(0.55, goldSoft(0.2));
  footGrad.addColorStop(1, 'rgba(60, 42, 20, 0)');
  ctx.strokeStyle = footGrad;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-50, 0.3);
  ctx.lineTo(50, 0.3);
  ctx.stroke();

  ctx.restore();
}

/** Exact #loading italic typography from reading-room/src/room.css, with optional vibe override. */
function drawLoaderCaption(ctx, text, x, y, alpha = 1, opts = {}) {
  const {
    color = TEXT_IVORY,
    font = 'italic 500 21px "Cormorant Garamond", Georgia, serif',
    letterSpacing = 0,
  } = opts;
  const a = clamp(alpha);
  if (a <= 0.005) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = color;
  ctx.font = font;
  if (letterSpacing && 'letterSpacing' in ctx) {
    ctx.letterSpacing = `${letterSpacing}px`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 1;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const WARM_AMBIENT_DUST = Array.from({ length: 26 }, (_, i) => {
  const fracX = ((i * 0.6180339 + 0.13) % 1);
  const fracY = ((i * 0.381966 + 0.29) % 1);
  const isForegroundHalo = i % 5 === 1; // 5 мягких ближних пылинок с тёплым ореолом глубины резкости
  const radius = isForegroundHalo
    ? 1.2 + (i % 3) * 0.2
    : 0.45 + ((i * 3) % 4) * 0.13;
  const speedY = 1.6 + ((i * 7) % 6) * 0.3; // 1.6..3.1 px/s плавная конвекция вверх
  const driftPhase = i * 1.47;
  const twinkleFreq = 0.75 + ((i * 5) % 4) * 0.28;
  return { fracX, fracY, isForegroundHalo, radius, speedY, driftPhase, twinkleFreq };
});

/**
 * 26 мягких пылинок в тёплом воздухе вокруг настольной лампы без косого луча.
 * Проявляются только внутри эллиптической зоны освещения (-96, 54).
 */
function drawWarmAmbientDust(ctx, t, glow) {
  const g = clamp(glow);
  if (g <= 0.02) return;

  ctx.save();
  const minX = -168;
  const maxX = 48;
  const minY = 20;
  const spanY = 84; // 20..104

  for (const mote of WARM_AMBIENT_DUST) {
    const rawY = (mote.fracY * spanY - t * mote.speedY) % spanY;
    const normY = rawY < 0 ? rawY + spanY : rawY;
    const y = minY + normY;
    const baseX = lerp(minX, maxX, mote.fracX);
    const x = baseX + Math.sin(t * 0.55 + mote.driftPhase) * 3.0;

    // Эллиптическая огибающая тёплого ореола света вокруг (-96, 54) с радиусами (135, 52)
    const dx = (x + 96) / 135;
    const dy = (y - 54) / 52;
    const radialDist = Math.hypot(dx, dy);
    const envelope = Math.pow(clamp(1 - radialDist), 1.35);
    if (envelope <= 0.02) continue;

    const twinkle = 0.52 + 0.48 * Math.sin(t * mote.twinkleFreq + mote.driftPhase);
    const alpha = g * envelope * twinkle * 0.56;
    if (alpha <= 0.015) continue;

    if (mote.isForegroundHalo) {
      const halo = ctx.createRadialGradient(x, y, 0.2, x, y, mote.radius * 3.2);
      halo.addColorStop(0, `rgba(255, 224, 158, ${alpha.toFixed(3)})`);
      halo.addColorStop(0.45, `rgba(252, 196, 108, ${(alpha * 0.36).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(240, 148, 52, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius * 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255, 214, 138, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Incandescent strike curve for distant nave lamps:
 * crisp onset when relay closes, warm tungsten bloom peak (~45ms after strike), then steady settle.
 */
function filamentIgnition(t, start, riseDur = 0.18, bloomAmt = 0.35, easeFn = easeOutCubic) {
  if (t < start) return { glow: 0, bloom: 0 };
  const rise = easeFn(seg(t, start, start + riseDur));
  const pulse = Math.exp(-Math.pow((t - (start + 0.045)) / 0.055, 2));
  const bloom = pulse * bloomAmt;
  const glow = clamp(rise + bloom * 0.28, 0, 1.12);
  return { glow, bloom };
}

/** Incandescent flash-and-sag curve for hero banker lamp during mains relay surge. */
function relaySurgeLampCurve(t, start = 0.98, end = 1.34) {
  if (t < start) return 0;
  const onset = smoothstep(seg(t, start, start + 0.025));
  const base = smoothstep(seg(t, start, end));
  const flash = Math.exp(-Math.pow((t - (start + 0.045)) / 0.026, 2)) * 0.42;
  const sag = Math.exp(-Math.pow((t - (start + 0.115)) / 0.034, 2)) * 0.16;
  return onset * clamp(base + flash - sag);
}

/** Approved choreography «Импульс реле · Подхват и просадка сети» (4.2 s on the stand; here it just keeps burning). */
const CHOREO = {
  startsL: [0.22, 0.41, 0.485, 0.54],
  startsR: [0.22, 0.425, 0.5, 0.555],
  riseDur: 0.16,
  bloomAmt: 0.58,
  easeFn: easeOutCubic,
  chainRange: [0.86, 1.12],
  lampRange: [0.98, 1.34],
  capRange: [1.2, 1.74],
  lampCurve: relaySurgeLampCurve,
  perLampMod: (t, _row, _sideIdx, start) => {
    const sag = 1 - 0.08 * Math.exp(-Math.pow((t - 0.62) / 0.055, 2));
    return t >= start ? sag : 1;
  },
};

/** Shared v11 Etalon canvas scene with parameterized ignition choreography. */
function renderChoreographedHall(ctx, w, h, t, choreo) {
  const scale = Math.min(w / 760, h / 480);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const shimmer = 1 + microBreath(t, 1.2);
  const appear = smoothstep(seg(t, 0.0, 0.55));
  const maxIntensity = 0.68;

  const [c0, c1] = choreo.chainRange;
  const [l0, l1] = choreo.lampRange;
  const [cap0, cap1] = choreo.capRange;
  const chainPull = Math.sin(seg(t, c0, c1) * Math.PI);
  const lampGlow = choreo.lampCurve ? choreo.lampCurve(t, l0, l1) : smoothstep(seg(t, l0, l1));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const count = choreo.startsL.length;
  const spots = [];
  let sumGlow = 0;

  for (let row = 0; row < count; row++) {
    const startL = choreo.startsL[row];
    const startR = choreo.startsR[row];
    const igL = filamentIgnition(t, startL, choreo.riseDur, choreo.bloomAmt, choreo.easeFn);
    const igR = filamentIgnition(t, startR, choreo.riseDur, choreo.bloomAmt, choreo.easeFn);
    const modL = choreo.perLampMod ? choreo.perLampMod(t, row, 0, startL) : 1;
    const modR = choreo.perLampMod ? choreo.perLampMod(t, row, 1, startR) : 1;

    const gL = igL.glow * maxIntensity * modL;
    const gR = igR.glow * maxIntensity * modR;
    sumGlow += (gL + gR) * 0.5;
    spots.push({ gL, bL: igL.bloom, gR, bR: igR.bloom });
  }

  const avgHallGlow = sumGlow / count;
  drawHighVaults(ctx, avgHallGlow / maxIntensity, lampGlow, {
    appear,
    intensity: 1.0,
  });

  if (avgHallGlow > 0.008) {
    ctx.save();
    ctx.translate(7, -47);
    ctx.rotate(0.49);
    drawLightPool(ctx, 0, 0, 21, 42, avgHallGlow * 0.22, AMBER_RGB);
    ctx.restore();
  }

  for (let row = 0; row < count; row++) {
    const { lx, ly, rx, ry, ls, depthAtten } = projectObliqueNaveRow(row, count);
    const s = spots[row];
    drawNaveLampSpot(ctx, lx, ly, ls, s.gL * depthAtten * shimmer, s.bL * depthAtten);
    drawNaveLampSpot(ctx, rx, ry, ls, s.gR * depthAtten * shimmer, s.bR * depthAtten);
  }

  drawLibraryDesk(ctx, {
    rearY: 50,
    frontY: 126,
    lampX: -132,
    ambient: lerp(0.03, 0.08, appear),
    light: lampGlow,
  });

  drawVintageTypewriter(ctx, 56, 106, 0.82, lampGlow * shimmer, {
    appear: lerp(0.55, 1, appear),
  });

  drawWarmAmbientDust(ctx, t, lampGlow * shimmer);

  drawAntiqueBankerLamp(ctx, -132, 82, 1.0, lampGlow * shimmer, {
    appear: lerp(0.55, 1, appear),
    chainPull,
    stemHeight: 64,
  });

  const capAlpha = smoothstep(seg(t, cap0, cap1)) * 0.86;
  drawLoaderCaption(ctx, CAPTION, 0, 162, capAlpha);

  ctx.restore();
}

// ---- Запуск и публичный API ----------------------------------------------------------

const CAPTION_FONT = 'italic 500 21px "Cormorant Garamond", Georgia, serif';
const CAPTION_CSS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,500&display=swap';
const SETTLE_AT = 1.35; // лампа на столе догорела (lampRange[1])

// Тексты заставки на всех языках зала. Заставка стартует раньше словарей (src/i18n/) и их не ждёт, поэтому таблица своя, крошечная; язык —
// по тому же правилу, что pickLang() в src/i18n.js: выбранный в «убранстве» (localStorage `exedra.lang`), затем языки браузера, иначе английский.
// Для каждого языка: [подпись на холсте, что сказать, если зал не собрался].
const LOADER_TEXT = {
  en: ['lighting the lamp…', 'The room failed to load. Reload the page with Shift: Cmd + Shift + R (or Ctrl + Shift + R).'],
  es: ['enciendo la lámpara…', 'La sala no se cargó. Recarga la página con Shift: Cmd + Shift + R (o Ctrl + Shift + R).'],
  de: ['ich zünde die Lampe an…', 'Der Saal konnte nicht geladen werden. Lade die Seite mit Shift neu: Cmd + Shift + R (oder Strg + Shift + R).'],
  fr: ['j’allume la lampe…', 'La salle n’a pas pu se charger. Rechargez la page avec Maj : Cmd + Maj + R (ou Ctrl + Maj + R).'],
  pt: ['acendendo a lâmpada…', 'A sala não carregou. Recarregue a página com Shift: Cmd + Shift + R (ou Ctrl + Shift + R).'],
  ja: ['ランプを灯しています…', 'ホールを読み込めませんでした。Shift を押しながら再読み込みしてください: Cmd + Shift + R（または Ctrl + Shift + R）。'],
  zh: ['正在点亮台灯…', '大厅未能加载。请按住 Shift 刷新页面：Cmd + Shift + R（或 Ctrl + Shift + R）。'],
  el: ['ανάβω τη λάμπα…', 'Η αίθουσα δεν φορτώθηκε. Ανανεώστε τη σελίδα με Shift: Cmd + Shift + R (ή Ctrl + Shift + R).'],
  ru: ['зажигаю лампу…', 'Зал не загрузился. Обновите страницу с Shift: Cmd + Shift + R (или Ctrl + Shift + R).'],
};
const loaderLang = () => {
  try { const s = localStorage.getItem('exedra.lang'); if (s && LOADER_TEXT[s]) return s; } catch {}
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) { const c = String(l).toLowerCase().split('-')[0]; if (LOADER_TEXT[c]) return c; }
  return 'en';
};
// В потоке заставки localStorage нет — язык приходит от страницы вместе с холстом (caption); до того — по языкам браузера.
let CAPTION = LOADER_TEXT[loaderLang()][0];

/** Pure draw of one frame: ctx already has the dpr transform, w and h are CSS pixels, t is seconds since start. */
export function drawLoader(ctx, w, h, t) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  renderChoreographedHall(ctx, w, h, t, CHOREO);
}

// Пока зал собирается, главный поток страницы занят секундами подряд (сборка сцены, шейдеры) — рисунок на обычном холсте в это время
// стоял бы: из всей заставки были бы видны первый кадр и последний. Поэтому холст отдан отдельному потоку (OffscreenCanvas в Worker):
// этот же файл запускается в нём второй раз и рисует сам, не дожидаясь страницы. Где так нельзя — рисует страница, как умеет.
// start — миг начала по общим часам (мс от начала эпохи): время заставки одно и то же в обоих потоках и идёт без сброса.
function runLoop(canvas, start) {
  const ctx = canvas.getContext('2d'), next = globalThis.requestAnimationFrame ? (f) => requestAnimationFrame(f) : (f) => setTimeout(f, 16);
  const cancel = globalThis.requestAnimationFrame ? cancelAnimationFrame : clearTimeout;
  let w = 1, h = 1, dpr = 1, raf = 0, stopped = false, shown = 0;
  const paint = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLoader(ctx, w, h, (performance.timeOrigin + performance.now() - start) / 1000);
  };
  // Не чаще 60 кадров в секунду: на экране в 120 Гц заставка иначе отнимала у сборки зала больше полсекунды.
  const frame = (now = performance.now()) => { if (stopped) return; if (now - shown > 12) { shown = now; paint(); } raf = next(frame); };
  return {
    size(cssW, cssH, ratio) {
      if (stopped) return;
      w = cssW; h = cssH; dpr = ratio;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      if (raf) paint(); else frame();
    },
    // Полная остановка: цикл снят, память холста отдана.
    stop() { stopped = true; cancel(raf); raf = 0; canvas.width = canvas.height = 0; },
  };
}

let stop = () => {};
let settle;
const settledPromise = new Promise((resolve) => { settle = resolve; });

/** Resolves once the desk lamp has finished switching on; immediately if the loader never started. */
export function settled() {
  return settledPromise;
}

/** Full stop: cancel the loop, drop the resize listener, release the canvas. Safe to call twice. */
export function stopLoader() {
  stop(); stop = () => {};
  settle();
}

if (typeof document === 'undefined') {
  // ——— В отдельном потоке ———
  let run = null;
  // Шрифтов страницы здесь нет: подпись берёт тот же Cormorant Garamond с того же адреса (не вышло — Georgia, как и на странице).
  const captionFont = async () => {
    const css = await (await fetch(CAPTION_CSS)).text();
    for (const [, face] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      const src = face.match(/url\(([^)]+)\)/)?.[1], range = face.match(/unicode-range:\s*([^;]+)/)?.[1];
      if (src) self.fonts.add(new FontFace('Cormorant Garamond', `url(${src})`, { style: 'italic', weight: '500', ...(range ? { unicodeRange: range } : {}) }));
    }
    await self.fonts.load(CAPTION_FONT, CAPTION);
  };
  self.onmessage = ({ data }) => {
    if (data.canvas) { if (data.caption) CAPTION = data.caption; run = runLoop(data.canvas, data.start); captionFont().catch(() => {}); }
    if (data.size) run?.size(...data.size);
    if (data.stop) { run?.stop(); self.close(); }
  };
} else {
  const host = document.getElementById('loading');
  if (!host) settle();
  else {
    const start = performance.timeOrigin + performance.now();
    const measure = () => [Math.max(1, Math.round(host.clientWidth)), Math.max(1, Math.round(host.clientHeight)), Math.min(devicePixelRatio || 1, 2)];
    const place = () => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      host.replaceChildren(canvas);
      return canvas;
    };
    let resize = () => {};
    // На странице: подпись рисуется на холсте, а текста с этим шрифтом в разметке больше нет — шрифт подгружается явно.
    const onPage = () => {
      const run = runLoop(place(), start);
      try { document.fonts?.load(CAPTION_FONT, CAPTION)?.catch(() => {}); } catch (e) { /* без шрифта — Georgia */ }
      resize = () => run.size(...measure()); resize();
      return () => run.stop();
    };
    let halt;
    try {
      const worker = new Worker(import.meta.url, { type: 'module' }), off = place().transferControlToOffscreen();
      worker.postMessage({ canvas: off, start, size: measure(), caption: CAPTION }, [off]);
      resize = () => worker.postMessage({ size: measure() });
      halt = () => worker.postMessage({ stop: true });
      // Поток не запустился (старый браузер) — рисует страница.
      worker.onerror = () => { worker.terminate(); if (halt) halt = onPage(); };
    } catch (e) {
      halt = onPage();
    }
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    // Ждущих отпускают настенные часы, а не кадры: в скрытой вкладке кадры не идут.
    const timer = setTimeout(settle, SETTLE_AT * 1000);
    stop = () => { clearTimeout(timer); window.removeEventListener('resize', onResize); halt?.(); halt = null; };
    // Зал не собрался вовсе: чаще всего браузер взял из своего запаса старую копию одного файла рядом с новыми, и они не сошлись
    // (так было 2026-11-15 — «проект в вечном лоадере»: свежий room.js просил у старого glass.js то, чего в нём ещё не было).
    // Тогда все уже загруженные файлы страницы перечитываются мимо запаса, и страница открывается заново — один раз; не помогло —
    // заставка не крутится вечно, а говорит, что делать. Ошибки самого зала ловит room.js (у него к тому времени есть __rr).
    window.addEventListener('error', () => {
      if (window.__rr || !host.isConnected) return;
      const KEY = 'reading-room-reload', last = Number(sessionStorage.getItem(KEY)) || 0, files = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin) && /\.(js|css)(\?|$)/.test(u));
      if (Date.now() - last > 30000) {
        sessionStorage.setItem(KEY, Date.now());
        Promise.allSettled([location.href, ...files].map(u => fetch(u, { cache: 'reload' }))).then(() => location.reload());
      } else { stopLoader(); host.textContent = LOADER_TEXT[loaderLang()][1]; }
    });
  }
}
