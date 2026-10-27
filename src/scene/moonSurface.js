/**
 * 달 표면 색 (시각 효과 전용)
 * ------------------------------------------------------------
 * 달 중심 기준 방향(단위벡터) → 선형 RGB 색.
 *   - 바다(어두운 현무암 평원): 큰 규모 노이즈로 정한 얼룩
 *   - 충돌구: 의사 난수로 흩뿌린 원. 바닥은 어둡고, 테두리는 밝고, 큰 충돌구는 밝은 분출물 띠
 *   - 잔무늬: 작은 규모 노이즈
 * 같은 방향에는 항상 같은 색이 나오므로, 멀리서 보는 텍스처와 가까이서 보는 지표 조각이 맞물린다.
 */
import * as THREE from 'three';
import { fbm3, valueNoise3 } from './noise.js';
import { uvToWorldDirection } from './proceduralTextures.js';
import { linearToSrgbByte } from './planetSurface.js';

const CRATER_COUNT = 1100;
const YOUNG_CRATERS = 7; // 밝은 빛줄기(광조)가 사방으로 뻗은 젊은 큰 충돌구 수

/** 결정적 의사 난수 (같은 시드 → 같은 수열) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 충돌구 목록: 중심 방향, 각반지름(rad), 영향 범위, 빛줄기. 작은 것이 많도록 거듭제곱 분포.
const CRATERS = (() => {
  const rand = mulberry32(20_261_024);
  const list = [];
  for (let i = 0; i < CRATER_COUNT; i++) {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const young = i < YOUNG_CRATERS;
    const radius = young ? 0.03 + 0.03 * rand() : 0.004 + 0.12 * rand() ** 3.6;
    const center = [s * Math.cos(phi), s * Math.sin(phi), z];
    // 빛줄기 방향 계산용 접평면 축
    const ref = Math.abs(center[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [ref[1] * center[2] - ref[2] * center[1], ref[2] * center[0] - ref[0] * center[2], ref[0] * center[1] - ref[1] * center[0]];
    const l = Math.hypot(...e1);
    e1 = e1.map((v) => v / l);
    const e2 = [center[1] * e1[2] - center[2] * e1[1], center[2] * e1[0] - center[0] * e1[2], center[0] * e1[1] - center[1] * e1[0]];
    const reach = young ? 9 : radius > 0.05 ? 2.6 : 1.35; // 분출물·빛줄기까지 포함한 영향 범위 (반지름의 배수)
    list.push({
      center,
      radius,
      e1,
      e2,
      reach,
      cosOuter: Math.cos(Math.min(Math.PI, radius * reach)),
      ejecta: radius > 0.05 && rand() < 0.6,
      young,
      raySeed: Math.floor(rand() * 1e6),
      depth: 0.72 + 0.12 * rand(), // 바닥 어둡기
    });
  }
  return list;
})();

/** 각도 방향 빛줄기 세기 (0~1): 몇 개의 가늘고 긴 줄기 */
function rayPattern(c, x, y, z) {
  const a = Math.atan2(x * c.e2[0] + y * c.e2[1] + z * c.e2[2], x * c.e1[0] + y * c.e1[1] + z * c.e1[2]);
  const k = (a / (Math.PI * 2) + 0.5) * 48; // 둘레를 48칸으로
  const i = Math.floor(k);
  const f = k - i;
  const h = (n) => {
    const v = Math.sin((n % 48) * 127.1 + c.raySeed * 0.013) * 43758.5453;
    return v - Math.floor(v);
  };
  const a0 = h(i);
  const a1 = h(i + 1);
  const v = a0 + (a1 - a0) * (f * f * (3 - 2 * f));
  return Math.max(0, (v - 0.55) / 0.45) ** 2;
}

const gauss = (x) => Math.exp(-x * x);
const smoothstep = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** 충돌구 하나가 그 방향의 밝기에 곱하는 값 (영향 범위 밖이면 1) — 실제 달처럼 차이는 은은하게 */
function craterFactor(c, x, y, z) {
  const d = x * c.center[0] + y * c.center[1] + z * c.center[2];
  if (d < c.cosOuter) return 1;
  const t = Math.acos(Math.min(1, d)) / c.radius; // 0 = 중심, 1 = 테두리
  let f = 1 - (1 - c.depth) * 0.6 * (1 - smoothstep(0.5, 1.0, t)); // 조금 어두운 바닥
  f += 0.1 * gauss((t - 1) / 0.12); // 밝은 테두리
  if (c.young) f += (0.4 * rayPattern(c, x, y, z) + 0.2 * gauss((t - 1) / 0.8)) * Math.max(0, 1 - (t - 1) / (c.reach - 1));
  else if (c.ejecta && t > 1) f += 0.1 * Math.exp(-(t - 1) / 0.5); // 밝은 분출물
  return f;
}

/** 충돌구 하나의 높이 (반지름 비례): 오목한 그릇 + 솟은 테두리 + 큰 충돌구 가운데 봉우리 */
function craterHeight(c, t) {
  let h = 0.5 * c.radius * gauss((t - 1) / 0.18); // 테두리
  if (t < 1) h -= 1.1 * c.radius * (1 - t * t); // 그릇
  if (c.radius > 0.03) h += 0.35 * c.radius * gauss(t / 0.14); // 가운데 봉우리
  return h;
}

/** 충돌구를 뺀 바탕: 밝기(고지대 밝음 · 바다 어두움 · 잔무늬)와 높이(바다는 낮다) */
function baseSurface(x, y, z) {
  // 바다: 비튼 좌표의 큰 무늬 — 둥글고 큰 분지 모양
  const wx = valueNoise3(x * 2 + 4.4, y * 2 - 1.1, z * 2 + 2.2) - 0.5;
  const wy = valueNoise3(x * 2 - 3.3, y * 2 + 5.5, z * 2 - 6.6) - 0.5;
  const maria = fbm3((x + 0.3 * wx) * 1.7 + 11.3, (y + 0.3 * wy) * 1.7 - 4.1, z * 1.7 + 7.7, 5);
  const mariaMix = smoothstep(0.5, 0.6, maria);
  const grain = fbm3(x * 40, y * 40, z * 40, 4);
  const shade = 0.43 * (1 - 0.48 * mariaMix) * (0.88 + 0.24 * grain);
  const height = -0.012 * mariaMix + 0.004 * (fbm3(x * 9, y * 9, z * 9, 4) - 0.5) * (1 - mariaMix * 0.7);
  return { shade, height };
}

/**
 * @param {number[]} dir 달 중심 기준 단위벡터
 * @returns {number[]} 선형 RGB (0~1)
 */
export function moonColorAt(dir) {
  const [x, y, z] = dir;
  let shade = baseSurface(x, y, z).shade;
  for (const c of CRATERS) shade *= craterFactor(c, x, y, z);
  return tint(shade);
}

/** 살짝 따뜻한 회색 */
function tint(shade) {
  return [shade * 1.03, shade, shade * 0.95];
}

// 높이 지도에만 넣는 작은 충돌구들 (색에는 영향 없음 — 가까이 볼 때 지표 조각의 색과 어긋나지 않게)
const SMALL_CRATERS = (() => {
  const rand = mulberry32(99_173);
  return Array.from({ length: 3_000 }, () => {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const radius = 0.002 + 0.012 * rand() ** 2.5;
    return { center: [s * Math.cos(phi), s * Math.sin(phi), z], radius, cosOuter: Math.cos(radius * 1.5) };
  });
})();

const cache = new Map();

/**
 * 달 텍스처 2장 (정거원통 도법, 행성 텍스처와 같은 좌표 규칙): 색(sRGB)과 높이(굴곡용, 선형)
 * 충돌구는 영향 범위 안 화소만 칠해 빠르게 만든다.
 */
export function createMoonMaps(width = 2048) {
  const key = `moon-${width}`;
  if (cache.has(key)) return cache.get(key);
  const height = width / 2;
  const count = width * height;
  const dirs = new Float32Array(count * 3);
  const shade = new Float32Array(count);
  const elev = new Float32Array(count);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [x, y, z] = uvToWorldDirection((i + 0.5) / width, (j + 0.5) / height);
      const k = j * width + i;
      dirs[k * 3] = x;
      dirs[k * 3 + 1] = y;
      dirs[k * 3 + 2] = z;
      const b = baseSurface(x, y, z);
      shade[k] = b.shade;
      elev[k] = b.height;
    }
  }
  /** 충돌구 하나가 닿는 화소마다 fn(화소 번호, t) */
  const forEachPixel = (c, fn) => {
    const [cx, cy, cz] = c.center;
    const theta = Math.acos(Math.max(-1, Math.min(1, -cz))); // world (x, y, z) = (gx, gz, −gy)
    const phi = Math.atan2(cy, -cx);
    const outer = Math.acos(Math.max(-1, c.cosOuter));
    const j0 = Math.max(0, Math.floor(((theta - outer) / Math.PI) * height));
    const j1 = Math.min(height - 1, Math.ceil(((theta + outer) / Math.PI) * height));
    const sinMin = Math.min(Math.sin(Math.max(0, theta - outer)), Math.sin(Math.min(Math.PI, theta + outer)));
    const fullRow = theta - outer <= 0 || theta + outer >= Math.PI || sinMin < 1e-3 || outer / sinMin > Math.PI;
    const du = fullRow ? width : Math.ceil((outer / sinMin / (Math.PI * 2)) * width) + 1;
    const ic = Math.round(((((phi / (Math.PI * 2)) % 1) + 1) % 1) * width);
    for (let j = j0; j <= j1; j++) {
      for (let di = -du; di <= du; di++) {
        if (fullRow && di >= 0) break;
        const k = j * width + ((((ic + di) % width) + width) % width);
        const d = dirs[k * 3] * cx + dirs[k * 3 + 1] * cy + dirs[k * 3 + 2] * cz;
        if (d < c.cosOuter) continue;
        fn(k, Math.acos(Math.min(1, d)) / c.radius);
      }
    }
  };
  for (const c of CRATERS) {
    forEachPixel(c, (k, t) => {
      shade[k] *= craterFactor(c, dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]);
      elev[k] += craterHeight(c, t);
    });
  }
  for (const c of SMALL_CRATERS) forEachPixel(c, (k, t) => (elev[k] += craterHeight(c, t)));

  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < count; k++) {
    lo = Math.min(lo, elev[k]);
    hi = Math.max(hi, elev[k]);
  }
  const make = (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let k = 0; k < count; k++) fill(image.data, k);
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    return texture;
  };
  const color = make((data, k) => {
    const c = tint(shade[k]);
    data[k * 4] = linearToSrgbByte(c[0]);
    data[k * 4 + 1] = linearToSrgbByte(c[1]);
    data[k * 4 + 2] = linearToSrgbByte(c[2]);
    data[k * 4 + 3] = 255;
  });
  color.colorSpace = THREE.SRGBColorSpace;
  const bump = make((data, k) => {
    const v = Math.round(((elev[k] - lo) / (hi - lo)) * 255);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v;
    data[k * 4 + 3] = 255;
  });
  const maps = { color, bump };
  cache.set(key, maps);
  return maps;
}

/** 달 색 텍스처 (지도 화면 등) */
export function createMoonTexture(width = 2048) {
  return createMoonMaps(width).color;
}

/** 달 표면 근접 무늬 (고운 흙·자갈): 밝기 0.7~1.0 반복 무늬 */
export function createRegolithTexture(size = 256) {
  const key = `regolith-${size}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const rand = mulberry32(77);
  const pebbles = Array.from({ length: 140 }, () => [rand() * size, rand() * size, 0.6 + rand() * 2.2]);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const a = (i / size) * Math.PI * 2;
      const b = (j / size) * Math.PI * 2;
      let g = 0.74 + 0.26 * fbm3(Math.cos(a) * 3 + 5, Math.sin(a) * 3, Math.cos(b) * 3 + Math.sin(b) * 1.5 + 2, 5);
      for (const [px, py, pr] of pebbles) {
        const dx = Math.min(Math.abs(i - px), size - Math.abs(i - px));
        const dy = Math.min(Math.abs(j - py), size - Math.abs(j - py));
        if (dx * dx + dy * dy < pr * pr) g *= 0.75;
      }
      const v = Math.round(Math.min(1, g) * 255);
      const k = (j * size + i) * 4;
      image.data[k] = v;
      image.data[k + 1] = v;
      image.data[k + 2] = v;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}
