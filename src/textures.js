import * as THREE from 'three';

// ------------------------------------------------------------------ 噪声

export function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function fbm(x, y, seed, oct = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function ridged(x, y, seed, oct = 4) {
  return 1 - Math.abs(fbm(x, y, seed, oct) * 2 - 1);
}

// ------------------------------------------------------------------ 纹理构建

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function normalMapFromHeight(height, size, strength) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const y0 = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const i = y0 + x;
      const l = height[y0 + xm];
      const r = height[y0 + xp];
      const u = height[ym + x];
      const dn = height[yp + x];
      let nx = (l - r) * strength;
      let ny = (u - dn) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      d[i * 4] = (nx * 0.5 + 0.5) * 255;
      d[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      d[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function greyMapFromValues(values, size) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = clamp01(values[i]) * 255;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * pixelFn(x, y, size) -> [r, g, b, height, roughness, alpha?]
 * 颜色与 alpha 为 0..1，height 与 roughness 为 0..1。
 */
function buildSet(key, size, pixelFn, normalStrength) {
  if (cache.has(key)) return cache.get(key);

  const colorCanvas = makeCanvas(size);
  const ctx = colorCanvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const out = pixelFn(x, y, size);
      d[i * 4] = clamp01(out[0]) * 255;
      d[i * 4 + 1] = clamp01(out[1]) * 255;
      d[i * 4 + 2] = clamp01(out[2]) * 255;
      d[i * 4 + 3] = out.length > 5 ? clamp01(out[5]) * 255 : 255;
      height[i] = clamp01(out[3]);
      rough[i] = clamp01(out[4]);
    }
  }
  ctx.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const normalMap = normalMapFromHeight(height, size, normalStrength);
  const roughnessMap = greyMapFromValues(rough, size);

  const set = { map, normalMap, roughnessMap };
  cache.set(key, set);
  return set;
}

// ------------------------------------------------------------------ 具体材质

export function floorTiles(seed) {
  return buildSet(
    `floor:${seed}`,
    512,
    (x, y) => {
      const tx = x % 128;
      const ty = y % 128;
      const gx = Math.floor(x / 128);
      const gy = Math.floor(y / 128);
      const tileId = gx + gy * 7;
      const grout = tx < 5 || ty < 5;
      const shade = 0.8 + hash2(tileId, 3, seed) * 0.26;
      const grain = fbm(x * 0.05, y * 0.05, seed + 1, 4);
      const stain = fbm(x * 0.007, y * 0.007, seed + 9, 4);
      const crack = ridged(x * 0.022, y * 0.022, seed + 7, 4);
      const chip = hash2(tx, ty, seed + 2);

      let r = 0.29 * shade;
      let g = 0.315 * shade;
      let b = 0.305 * shade;
      if (grout) {
        r = 0.105;
        g = 0.11;
        b = 0.107;
      }
      const dirt = grain * 0.3 + stain * 0.34;
      r = mix(r, 0.1, dirt * 0.7);
      g = mix(g, 0.11, dirt * 0.67);
      b = mix(b, 0.1, dirt * 0.65);

      if (crack > 0.985) {
        r *= 0.42;
        g *= 0.42;
        b *= 0.41;
      }
      if (chip > 0.994) {
        r *= 0.6;
        g *= 0.6;
        b *= 0.6;
      }
      const wet = smoothstep(0.64, 0.8, stain);
      r *= 1 - wet * 0.45;
      g *= 1 - wet * 0.42;
      b *= 1 - wet * 0.35;

      const h = grout ? 0.18 : 0.72 + grain * 0.12 - (crack > 0.98 ? 0.3 : 0) - (chip > 0.994 ? 0.35 : 0);
      const rough = grout ? 0.92 : mix(0.6 + grain * 0.25, 0.12, wet);
      return [r, g, b, h, rough];
    },
    2.6,
  );
}

export function wallPlaster(seed) {
  return buildSet(
    `wall:${seed}`,
    512,
    (x, y) => {
      const ny = y / 512;
      const fine = fbm(x * 0.02, y * 0.02, seed + 3, 4);
      const mid = fbm(x * 0.008, y * 0.008, seed + 11, 4);
      const streak = fbm(x * 0.055, y * 0.0035, seed + 5, 3);
      const grime = fbm(x * 0.0035, y * 0.006, seed + 21, 4);

      let r = 0.45 + fine * 0.06;
      let g = 0.445 + fine * 0.06;
      let b = 0.41 + fine * 0.055;

      // 下半截墨绿色墙裙（贴图 v 轴向上，ny 越小越靠地面）
      const band = 1.0 - smoothstep(0.34, 0.365, ny);
      const bandCol = 0.14 + fine * 0.04;
      r = mix(r, bandCol * 0.85, band);
      g = mix(g, bandCol * 1.55, band);
      b = mix(b, bandCol * 1.45, band);

      // 剥落露出的水泥（斑块更细、对比更弱；墙裙区域保持完整）
      const peelMask = smoothstep(0.6, 0.635, mid + fine * 0.2) * (1 - band);
      r = mix(r, 0.315 + fine * 0.08, peelMask * 0.85);
      g = mix(g, 0.31 + fine * 0.08, peelMask * 0.85);
      b = mix(b, 0.285 + fine * 0.07, peelMask * 0.85);

      // 细裂纹
      const crack = ridged(x * 0.048, y * 0.048, seed + 33, 3);
      const c = crack > 0.977 ? 0.5 : 1;

      // 垂直水渍 + 整体脏污
      const dirt = streak * 0.5 + grime * 0.5;
      const dirtAmt = Math.pow(dirt, 1.5) * 0.6;
      r *= (1 - dirtAmt) * c;
      g *= (1 - dirtAmt * 0.95) * c;
      b *= (1 - dirtAmt * 0.85) * c;

      // 顶部积灰更重
      const topGrime = smoothstep(0.7, 1.0, ny) * 0.32;
      r *= 1 - topGrime;
      g *= 1 - topGrime;
      b *= 1 - topGrime * 0.9;

      const h = peelMask ? 0.34 + fine * 0.1 : 0.6 + fine * 0.12;
      const rough = peelMask ? 0.96 : 0.7 + mid * 0.2;
      return [r, g, b, h, rough];
    },
    2.6,
  );
}

export function ceilingTiles(seed) {
  return buildSet(
    `ceil:${seed}`,
    256,
    (x, y) => {
      const tx = x % 128;
      const ty = y % 128;
      const seam = tx < 3 || ty < 3;
      const base = fbm(x * 0.02, y * 0.02, seed + 4, 4);
      const water = fbm(x * 0.009, y * 0.009, seed + 13, 5);
      let r = 0.48 + base * 0.1;
      let g = 0.47 + base * 0.1;
      let b = 0.44 + base * 0.09;
      if (seam) {
        r *= 0.45;
        g *= 0.45;
        b *= 0.45;
      }
      const stain = smoothstep(0.55, 0.72, water);
      r = mix(r, 0.32, stain * 0.6);
      g = mix(g, 0.26, stain * 0.6);
      b = mix(b, 0.17, stain * 0.6);
      const h = seam ? 0.15 : 0.65 + base * 0.08;
      return [r, g, b, h, 0.9];
    },
    2.0,
  );
}

export function metalSurface(seed) {
  return buildSet(
    `metal:${seed}`,
    256,
    (x, y) => {
      const brush = vnoise(x * 0.003, y * 0.22, seed + 1);
      const rust = smoothstep(0.58, 0.72, fbm(x * 0.018, y * 0.018, seed + 6, 5));
      const grime = fbm(x * 0.04, y * 0.04, seed + 8, 3);
      let r = 0.28 + brush * 0.1;
      let g = 0.29 + brush * 0.1;
      let b = 0.29 + brush * 0.1;
      r = mix(r, 0.34 + grime * 0.12, rust);
      g = mix(g, 0.17 + grime * 0.06, rust);
      b = mix(b, 0.08 + grime * 0.03, rust);
      const h = 0.5 + rust * 0.35 + brush * 0.05;
      const rough = mix(0.35 + grime * 0.15, 0.9, rust);
      return [r, g, b, h, rough];
    },
    1.8,
  );
}

export function fabricSurface(seed) {
  return buildSet(
    `fabric:${seed}`,
    256,
    (x, y) => {
      const weave = (Math.sin(x * 1.1) * Math.sin(y * 1.1)) * 0.5 + 0.5;
      const stain = smoothstep(0.58, 0.75, fbm(x * 0.017, y * 0.017, seed + 12, 5));
      const base = 0.55 + weave * 0.04;
      let r = base;
      let g = base * 0.98;
      let b = base * 0.92;
      r = mix(r, 0.33, stain * 0.75);
      g = mix(g, 0.24, stain * 0.75);
      b = mix(b, 0.14, stain * 0.7);
      return [r, g, b, 0.5 + weave * 0.1, 0.92];
    },
    1.2,
  );
}

export function woodSurface(seed) {
  return buildSet(
    `wood:${seed}`,
    256,
    (x, y) => {
      const warp = fbm(x * 0.006, y * 0.03, seed + 2, 4);
      const grain = Math.sin((x * 0.02 + warp * 9) * 6) * 0.5 + 0.5;
      const dark = fbm(x * 0.02, y * 0.02, seed + 5, 3);
      const r = 0.26 + grain * 0.12 - dark * 0.08;
      const g = 0.17 + grain * 0.08 - dark * 0.06;
      const b = 0.1 + grain * 0.05 - dark * 0.04;
      return [r, g, b, 0.55 + grain * 0.15, 0.78];
    },
    1.4,
  );
}

export function bloodDecal(seed) {
  return buildSet(
    `blood:${seed}`,
    256,
    (x, y) => {
      const cx = x / 256 - 0.5;
      const cy = y / 256 - 0.5;
      const d = Math.hypot(cx, cy) * 2;
      const radial = 1 - smoothstep(0.15, 0.98, d);

      const n1 = fbm(x * 0.03, y * 0.03, seed + 4, 5);
      const n2 = fbm(x * 0.11, y * 0.11, seed + 8, 3);

      // 有机飞溅：噪声阈值 + 径向衰减，边缘必须有孔洞
      const mask = n1 * 0.78 + n2 * 0.22 + radial * 0.5 - 0.5;
      let a = smoothstep(0.015, 0.19, mask) * radial;

      // 小血点
      const speck = hash2(x, y, seed + 9) > 0.987 ? radial : 0;
      a = Math.max(a, speck * 0.85);

      return [0.24, 0.028, 0.02, 0.5, 0.9, a];
    },
    1.0,
  );
}

export function curtainSurface(seed) {
  return buildSet(
    `curtain:${seed}`,
    256,
    (x, y) => {
      const folds = Math.sin(x * 0.06 + fbm(x * 0.01, y * 0.01, seed, 3) * 4) * 0.5 + 0.5;
      const grime = fbm(x * 0.02, y * 0.02, seed + 7, 4);
      const r = 0.33 + folds * 0.12 - grime * 0.08;
      const g = 0.42 + folds * 0.13 - grime * 0.08;
      const b = 0.43 + folds * 0.13 - grime * 0.07;
      return [r, g, b, folds * 0.7, 0.88, 0.72];
    },
    1.6,
  );
}

// ------------------------------------------------------------------ 粒子贴图

// ------------------------------------------------------------------ 鬼的皮肤

export function ghostSkin(seed) {
  return buildSet(
    `ghostskin:${seed}`,
    256,
    (x, y) => {
      const n = fbm(x * 0.028, y * 0.028, seed + 1, 5);
      const mott = fbm(x * 0.085, y * 0.085, seed + 2, 4);
      const veinField = fbm(x * 0.012, y * 0.012, seed + 7, 3) * 2.4;
      const vein = ridged(x * 0.04 + veinField, y * 0.04 - veinField * 0.6, seed + 3, 4);
      const bruise = smoothstep(0.52, 0.74, fbm(x * 0.014, y * 0.014, seed + 9, 4));
      const grime = fbm(x * 0.005, y * 0.005, seed + 11, 4);

      let r = 0.4 + n * 0.13;
      let g = 0.42 + n * 0.13;
      let b = 0.37 + n * 0.1;

      // 瘀斑
      r = mix(r, 0.26, bruise * 0.55);
      g = mix(g, 0.2, bruise * 0.55);
      b = mix(b, 0.23, bruise * 0.55);

      // 皮下静脉
      if (vein > 0.84) {
        const t = Math.min(1, (vein - 0.84) / 0.16);
        r = mix(r, 0.18, t * 0.8);
        g = mix(g, 0.16, t * 0.8);
        b = mix(b, 0.22, t * 0.8);
      }

      // 污垢
      const dirt = 0.72 + grime * 0.34;
      r *= dirt;
      g *= dirt;
      b *= dirt * 1.02;

      const h = 0.45 + n * 0.25 + (vein > 0.84 ? 0.12 : 0) + mott * 0.1;
      const rough = 0.5 + mott * 0.3 + bruise * 0.1;
      return [r, g, b, h, rough];
    },
    2.4,
  );
}

let dotTex = null;
export function dotTexture() {  if (dotTex) return dotTex;
  const s = 64;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

// ------------------------------------------------------------------ 标识牌

const signCache = new Map();

export function signTexture(label, sub = '') {
  const key = `${label}|${sub}`;
  if (signCache.has(key)) return signCache.get(key);
  const w = 512;
  const h = 170;
  const c = makeCanvas(w);
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#0e2523';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(190,220,212,0.35)';
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // 污渍
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${20 + Math.random() * 40},${30 + Math.random() * 40},${28 + Math.random() * 30},0.6)`;
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + Math.random() * 26, 2 + Math.random() * 9, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#cfe3dc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${sub ? 62 : 74}px "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.fillText(label, w / 2, sub ? h * 0.42 : h * 0.52);
  if (sub) {
    ctx.font = '26px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(180,206,198,0.65)';
    ctx.fillText(sub, w / 2, h * 0.74);
  }

  // 划痕
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  signCache.set(key, t);
  return t;
}

export function exitSignTexture() {
  const key = 'exit-sign';
  if (signCache.has(key)) return signCache.get(key);
  const w = 256;
  const h = 96;
  const c = makeCanvas(w);
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0d0d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d33a2c';
  ctx.font = 'bold 52px "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT →', w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signCache.set(key, t);
  return t;
}

export function screenTexture() {
  const key = 'ecg-screen';
  if (signCache.has(key)) return signCache.get(key);
  const w = 256;
  const h = 160;
  const c = makeCanvas(w);
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#03110a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(70,190,120,0.13)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#5cff9b';
  ctx.lineWidth = 2.6;
  ctx.shadowColor = '#5cff9b';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const cycle = x % 84;
    let y = h * 0.58 + Math.sin(x * 0.07) * 4;
    if (cycle > 34 && cycle < 40) y -= 46 * Math.sin(((cycle - 34) / 6) * Math.PI);
    else if (cycle > 46 && cycle < 52) y += 14 * Math.sin(((cycle - 46) / 6) * Math.PI);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  signCache.set(key, t);
  return t;
}
