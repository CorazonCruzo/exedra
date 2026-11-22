// filmvideo-yuv.js — кадры filmvideo.js (плоскости Y, U, V) -> обычная RGB-текстура three.js, которую можно поставить в экран проектора
// вместо THREE.VideoTexture. Один проход на новый кадр: три «DataTexture» (R8) -> шейдер YUV→RGB -> RenderTarget RGBA8.
//
//   import {YuvScreen} from './filmvideo-yuv.js';
//   const yuv = new YuvScreen(renderer, {width: fv.width, height: fv.height});   // renderer — THREE.WebGLRenderer
//   screenMat.map = yuv.texture;                      // та же «сырая» текстура, что у VideoTexture: значения как в видео (закодированные), без colorSpace
//   // в кадре отрисовки, до renderer.render(scene, camera):
//   const f = media.frame;                            // media = fv.media
//   if (f && media.frameSerial !== lastSerial) { lastSerial = media.frameSerial; yuv.update(f); }
//   yuv.dispose();                                    // при закрытии фильма
//
// Текстуры Y/U/V имеют ширину «шага строки» кадра (stride), а не ширины: ничего не копируется на главном потоке, шейдер просто берёт только нужную часть
// строки. Тексель у правого края зажат, чтобы линейная фильтрация не подмешивала хвост строки. Плоскости кадра действительны, пока кадр — media.frame:
// update() заливает их сразу же (texSubImage2D), дальше держать ссылки не нужно.

import * as THREE from 'three';
import {yuvToRgb} from './filmvideo.js';

const VS = `
varying vec2 vUv;
// строка 0 плоскости — верх кадра, а в текстуре v = 0 — низ: переворачиваем по вертикали
void main() { vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tY, tU, tV;
uniform vec4 uCrop;      // x: w / strideY, y: (w - 0.5) / strideY, z: cw / strideU, w: (cw - 0.5) / strideU
uniform mat3 uM;         // YCbCr -> RGB (столбцы), см. yuvToRgb()
uniform vec4 uRange;     // yOff, yScale, cOff, cScale
void main() {
  float y = texture2D(tY, vec2(min(vUv.x * uCrop.x, uCrop.y), vUv.y)).r;
  vec2 cuv = vec2(min(vUv.x * uCrop.z, uCrop.w), vUv.y);
  float u = texture2D(tU, cuv).r, v = texture2D(tV, cuv).r;
  vec3 c = vec3((y - uRange.x) * uRange.y, (u - uRange.z) * uRange.w, (v - uRange.z) * uRange.w);
  gl_FragColor = vec4(clamp(uM * c, 0.0, 1.0), 1.0);     // закодированный RGB, как у видео: сырой, без перевода в линейный
}`;

function plane(w, h) {
  const t = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export class YuvScreen {
  constructor(renderer, {width = 0, height = 0} = {}) {
    this.renderer = renderer;
    this.rt = null;
    this.sig = '';
    this.tex = null;
    this.uniforms = {
      tY: {value: null}, tU: {value: null}, tV: {value: null},
      uCrop: {value: new THREE.Vector4(1, 1, 1, 1)}, uM: {value: new THREE.Matrix3()}, uRange: {value: new THREE.Vector4(0, 1, 0.5, 1)},
    };
    this.material = new THREE.ShaderMaterial({uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false, toneMapped: false});
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.frames = 0;
    // текстура есть сразу (до первого кадра — чёрная), её можно назначить материалу и собрать шейдеры заранее; размер — с fv.width × fv.height
    this._makeTarget(width || 2, height || 2);
  }

  _makeTarget(w, h) {
    if (this.rt) this.rt.dispose();
    // сырые значения (colorSpace не задан): экран проектора сам переводит их из sRGB в линейные, как для VideoTexture
    this.rt = new THREE.WebGLRenderTarget(w, h, {depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false});
    this.texture = this.rt.texture;
  }

  /** Залить кадр и перерисовать RGB-текстуру. frame — media.frame (filmvideo.js). */
  update(f) {
    const sig = [f.w, f.h, f.cw, f.ch, f.strideY, f.strideU, f.strideV].join('x');
    if (sig !== this.sig) this._rebuild(f, sig);
    const t = this.tex;
    t.y.image.data = f.y; t.y.needsUpdate = true;
    t.u.image.data = f.u; t.u.needsUpdate = true;
    t.v.image.data = f.v; t.v.needsUpdate = true;
    const c = yuvToRgb(f);
    this.uniforms.uM.value.fromArray(c.matrix);
    this.uniforms.uRange.value.set(c.yOff, c.yScale, c.cOff, c.cScale);
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    this.frames++;
  }

  _rebuild(f, sig) {
    this._disposeTextures();
    this.sig = sig;
    this.tex = {y: plane(f.strideY, f.h), u: plane(f.strideU, f.ch), v: plane(f.strideV, f.ch)};
    this.uniforms.tY.value = this.tex.y; this.uniforms.tU.value = this.tex.u; this.uniforms.tV.value = this.tex.v;
    this.uniforms.uCrop.value.set(f.w / f.strideY, (f.w - 0.5) / f.strideY, f.cw / f.strideU, (f.cw - 0.5) / f.strideU);
    if (this.rt.width !== f.w || this.rt.height !== f.h) this._makeTarget(f.w, f.h);   // размер кадра сменился: texture — новая, назначьте её материалу заново
  }

  _disposeTextures() {
    if (!this.tex) return;
    this.tex.y.dispose(); this.tex.u.dispose(); this.tex.v.dispose();
    this.tex = null;
  }

  dispose() {
    this._disposeTextures();
    if (this.rt) { this.rt.dispose(); this.rt = null; }
    this.material.dispose(); this.quad.geometry.dispose();
  }
}
