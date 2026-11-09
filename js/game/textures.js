// Procedural textures drawn on canvas at startup — crisp at any resolution,
// tiny download size, and no external image dependencies.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD } from '../config.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Full-pitch grass texture with mowing stripes and accurate white markings. */
export function makePitchTexture(maxSize = 2048) {
  const ppm = maxSize / (FIELD.L + 4); // pixels per metre (2m apron each end)
  const PW = Math.round((FIELD.W + 4) * ppm), PL = Math.round((FIELD.L + 4) * ppm);
  // canvas: x → pitch width (x), y → pitch length (z)
  const c = canvas(PW, PL);
  const g = c.getContext('2d');
  const R = rand(7);
  // stripes along length
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f8a3c' : '#287a33';
    g.fillRect(0, (i * PL) / stripes, PW, PL / stripes + 1);
  }
  // cross mow (subtle checker)
  g.globalAlpha = 0.06;
  for (let i = 0; i < 10; i++) { if (i % 2) { g.fillStyle = '#ffffff'; g.fillRect((i * PW) / 10, 0, PW / 10, PL); } }
  g.globalAlpha = 1;
  // grain noise
  const img = g.getImageData(0, 0, PW, PL);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * 26;
    d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  // blades / clumps
  for (let i = 0; i < 9000; i++) {
    const x = R() * PW, y = R() * PL;
    g.fillStyle = R() > 0.5 ? 'rgba(80,170,80,0.18)' : 'rgba(10,50,15,0.18)';
    g.fillRect(x, y, 1, 2 + R() * 3);
  }

  // ── markings ──
  const X = (x) => (x + FIELD.HW + 2) * ppm;
  const Z = (z) => (z + FIELD.HL + 2) * ppm;
  const lw = Math.max(2, 0.12 * ppm);
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = lw;
  g.strokeRect(X(-FIELD.HW + 0.5), Z(-FIELD.HL), (FIELD.W - 1) * ppm, FIELD.L * ppm);
  g.beginPath(); g.moveTo(X(-FIELD.HW + 0.5), Z(0)); g.lineTo(X(FIELD.HW - 0.5), Z(0)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 6 * ppm, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 0.3 * ppm, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    const gz = s * FIELD.HL;
    // penalty box
    g.strokeRect(X(-FIELD.boxW / 2), s < 0 ? Z(gz) : Z(gz - FIELD.boxL), FIELD.boxW * ppm, FIELD.boxL * ppm);
    // goal area
    g.strokeRect(X(-6), s < 0 ? Z(gz) : Z(gz - 3.5), 12 * ppm, 3.5 * ppm);
    // penalty spot + arc
    const pz = gz - s * 7;
    g.beginPath(); g.arc(X(0), Z(pz), 0.25 * ppm, 0, Math.PI * 2); g.fill();
    g.beginPath();
    const a0 = s < 0 ? 0.25 * Math.PI : 1.25 * Math.PI;
    g.arc(X(0), Z(pz), 5 * ppm, a0, a0 + 0.5 * Math.PI); g.stroke();
  }
  // corner arcs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.beginPath(); g.arc(X(sx * (FIELD.HW - 0.5)), Z(sz * FIELD.HL), 1 * ppm, 0, Math.PI * 2); g.stroke();
  }
  // centre logo ring (power striker emblem)
  g.globalAlpha = 0.16;
  g.lineWidth = lw * 3;
  g.strokeStyle = '#7ef9ff';
  g.beginPath(); g.arc(X(0), Z(0), 3.2 * ppm, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, size: { w: FIELD.W + 4, l: FIELD.L + 4 } };
}

export function makeNoiseTexture(size = 256, repeat = 40) {
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size); const R = rand(3);
  for (let i = 0; i < img.data.length; i += 4) { const v = 110 + R() * 145; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  return t;
}

export function makeNetTexture() {
  const c = canvas(128, 128), g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
  g.beginPath();
  g.moveTo(64, 0); g.lineTo(128, 64); g.lineTo(64, 128); g.lineTo(0, 64); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 3-step gradient for cel / toon shading. */
let toonGrad = null;
export function toonGradient() {
  if (toonGrad) return toonGrad;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  toonGrad = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter;
  toonGrad.needsUpdate = true;
  return toonGrad;
}

/** Anime face: big glossy eyes, brows and a small mouth. */
const faceCache = new Map();
export function makeFaceTexture(eyeHex, hairHex, variant = 0) {
  const key = `${eyeHex}-${hairHex}-${variant}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 256, H = 128;
  const c = canvas(W, H), g = c.getContext('2d');
  const eye = '#' + eyeHex.toString(16).padStart(6, '0');
  const brow = '#' + new THREE.Color(hairHex).multiplyScalar(0.6).getHexString();
  const drawEye = (cx, flip) => {
    const ey = 62;
    // white
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(cx, ey, 19, 22, 0, 0, Math.PI * 2); g.fill();
    // iris gradient
    const gr = g.createLinearGradient(0, ey - 20, 0, ey + 20);
    gr.addColorStop(0, '#000000'); gr.addColorStop(0.35, eye); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(cx + flip * 2, ey + 2, 14, 19, 0, 0, Math.PI * 2); g.fill();
    // pupil
    g.fillStyle = '#05060a';
    g.beginPath(); g.ellipse(cx + flip * 2, ey + 3, 6, 10, 0, 0, Math.PI * 2); g.fill();
    // highlights
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(cx + flip * 2 - 6, ey - 7, 5, 6, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + flip * 2 + 6, ey + 9, 2.5, 0, Math.PI * 2); g.fill();
    // upper lash line (sharp, determined look)
    g.strokeStyle = '#0b0b12'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - flip * 22, ey - 12);
    g.quadraticCurveTo(cx, ey - 26, cx + flip * 22, ey - 16);
    g.stroke();
    // brow
    g.strokeStyle = brow; g.lineWidth = 7;
    g.beginPath();
    g.moveTo(cx - flip * 22, ey - 30 - (variant ? 0 : 4));
    g.lineTo(cx + flip * 20, ey - 40 + (variant ? 6 : 0));
    g.stroke();
  };
  drawEye(84, 1);
  drawEye(172, -1);
  // mouth
  g.strokeStyle = 'rgba(120,40,40,0.8)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(118, 116); g.quadraticCurveTo(128, 121, 138, 115); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(key, t);
  return t;
}

export function makeNumberTexture(num, colorHex = 0xffffff, accentHex = 0x000000) {
  const c = canvas(128, 128), g = c.getContext('2d');
  g.font = '900 92px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#' + accentHex.toString(16).padStart(6, '0');
  g.strokeText(String(num), 64, 70);
  g.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Classic truncated-icosahedron football pattern projected onto an equirect map. */
export function makeBallTexture() {
  const W = 512, H = 256;
  const c = canvas(W, H), g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map((v) => new THREE.Vector3(...v).normalize());
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map((f) => ico[f[0]].clone().add(ico[f[1]]).add(ico[f[2]]).normalize());
  const centers = [...ico.map((v) => ({ v, pent: true })), ...faces.map((v) => ({ v, pent: false }))];
  const dir = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const th = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const ph = (x / W) * Math.PI * 2;
      dir.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
      let b1 = -2, b2 = -2, best = null;
      for (const cc of centers) {
        const d = dir.dot(cc.v);
        if (d > b1) { b2 = b1; b1 = d; best = cc; } else if (d > b2) b2 = d;
      }
      const i = (y * W + x) * 4;
      let col = best.pent ? [18, 28, 60] : [245, 247, 252];
      if (b1 - b2 < 0.012) col = [120, 130, 150];
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // electric accent stripes on pentagon edges for a modern look
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeGlowTexture() {
  const c = canvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Big LED board text (scoreboard / banners). */
export function makeBannerTexture(text, sub = '', w = 1024, h = 128, color = '#5ff6ff') {
  const c = canvas(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#020615'); gr.addColorStop(0.5, '#071a3a'); gr.addColorStop(1, '#020615');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.font = `900 italic ${h * 0.55}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 18;
  g.fillStyle = color;
  const reps = Math.max(1, Math.floor(w / (g.measureText(text + '   ').width + 1)));
  const step = w / reps;
  for (let i = 0; i < reps; i++) g.fillText(text, step * (i + 0.5), h * 0.5);
  if (sub) { g.font = `700 ${h * 0.18}px sans-serif`; g.fillStyle = '#ffffff'; g.fillText(sub, w / 2, h * 0.88); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
