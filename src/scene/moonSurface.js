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
import { fbm3 } from './noise.js';
import { uvToWorldDirection } from './proceduralTextures.js';
import { linearToSrgbByte } from './planetSurface.js';

const CRATER_COUNT = 260;

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

// 충돌구 목록: 중심 방향, 각반지름(rad), 밝은 분출물 여부. 작은 것이 많도록 거듭제곱 분포.
const CRATERS = (() => {
  const rand = mulberry32(20_261_024);
  const list = [];
  for (let i = 0; i < CRATER_COUNT; i++) {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const radius = 0.006 + 0.11 * rand() ** 3.2;
    list.push({
      center: [s * Math.cos(phi), s * Math.sin(phi), z],
      radius,
      cosOuter: Math.cos(radius * (radius > 0.05 ? 2.6 : 1.3)), // 분출물 띠까지 포함한 영향 범위
      rays: radius > 0.05 && rand() < 0.6,
    });
  }
  return list;
})();

/**
 * @param {number[]} dir 달 중심 기준 단위벡터
 * @returns {number[]} 선형 RGB (0~1)
 */
export function moonColorAt(dir) {
  const [x, y, z] = dir;
  // 바다: 낮은 주파수 노이즈가 기준보다 크면 어둡게
  const maria = fbm3(x * 1.8 + 11.3, y * 1.8 - 4.1, z * 1.8 + 7.7, 4);
  const mariaMix = Math.min(1, Math.max(0, (maria - 0.52) * 6));
  let shade = 0.36 * (1 - 0.42 * mariaMix);
  // 잔무늬
  shade *= 0.86 + 0.28 * fbm3(x * 38, y * 38, z * 38, 4);

  for (const c of CRATERS) {
    const d = x * c.center[0] + y * c.center[1] + z * c.center[2];
    if (d < c.cosOuter) continue;
    const angle = Math.acos(Math.min(1, d));
    const t = angle / c.radius; // 0 = 중심, 1 = 테두리
    if (t < 0.88) shade *= 0.8 + 0.08 * t; // 어두운 바닥
    else if (t < 1.12) shade *= 1.3 - Math.abs(t - 1) * 1.6; // 밝은 테두리
    else if (c.rays) shade *= 1 + 0.25 * Math.max(0, 1 - (t - 1.12) / 1.5); // 밝은 분출물
  }
  // 살짝 따뜻한 회색
  return [shade * 1.02, shade, shade * 0.95];
}

const cache = new Map();

/** 달 전체 텍스처 (정거원통 도법, 행성 텍스처와 같은 좌표 규칙) */
export function createMoonTexture(width = 1024) {
  const key = `moon-${width}`;
  if (cache.has(key)) return cache.get(key);
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const color = moonColorAt(uvToWorldDirection((i + 0.5) / width, (j + 0.5) / height));
      const k = (j * width + i) * 4;
      image.data[k] = linearToSrgbByte(color[0]);
      image.data[k + 1] = linearToSrgbByte(color[1]);
      image.data[k + 2] = linearToSrgbByte(color[2]);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
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
