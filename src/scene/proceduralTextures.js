/**
 * 절차적 텍스처 (행성 지도, 구름, 지면 근접 무늬) — 시각 효과 전용
 * ------------------------------------------------------------
 * 외부 이미지 없이 코드로 그려서 만든다. 결과는 한 번 만든 뒤 재사용한다.
 *
 * 행성 텍스처 좌표: SphereGeometry 의 극(±Y)을 행성의 실제 북극(−Z) 쪽으로 돌려 쓰므로
 * (globeOrientation 참고), 텍스처의 각 점에 해당하는 월드 방향을 그 회전에 맞춰 계산한다.
 */
import * as THREE from 'three';
import { planetColorAt, linearToSrgbByte } from './planetSurface.js';
import { fbm3, valueNoise3 } from './noise.js';

/** SphereGeometry(극 = +Y)를 행성 북극(−Z)에 맞추는 회전: X 축으로 −90° */
export const GLOBE_ROTATION_X = -Math.PI / 2;

/** 텍스처 좌표 (u, v) → 월드 방향 (globe 회전 적용 후) */
export function uvToWorldDirection(u, v) {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  // SphereGeometry 의 정점 공식
  const gx = -Math.cos(phi) * Math.sin(theta);
  const gy = Math.cos(theta);
  const gz = Math.sin(phi) * Math.sin(theta);
  // X 축 −90° 회전: (x, y, z) → (x, z, −y)
  return [gx, gz, -gy];
}

const cache = new Map();

/**
 * 행성 표면 지도 3장을 한 번에 (정거원통 도법)
 *   color  : 표면 색 (sRGB)
 *   surface: R = 높이(지형 굴곡, bumpMap), G = 거칠기(roughnessMap — 바다는 매끈해 햇빛이 반사된다) (선형)
 *   lights : 밤 도시 불빛 (sRGB, 밤쪽에서만 보이게 셰이더가 가린다)
 */
export function createPlanetMaps(siteDir, northDir, width = 2048) {
  const key = `planet-maps-${width}`;
  if (cache.has(key)) return cache.get(key);
  const height = width / 2;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, image: ctx.createImageData(width, height) };
  };
  const color = make();
  const surface = make();
  const lights = make();
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const dir = uvToWorldDirection((i + 0.5) / width, (j + 0.5) / height);
      const s = planetColorAt(dir, siteDir, northDir);
      const k = (j * width + i) * 4;
      color.image.data[k] = linearToSrgbByte(s.color[0]);
      color.image.data[k + 1] = linearToSrgbByte(s.color[1]);
      color.image.data[k + 2] = linearToSrgbByte(s.color[2]);
      color.image.data[k + 3] = 255;
      surface.image.data[k] = Math.round(s.height * 255);
      surface.image.data[k + 1] = Math.round(s.roughness * 255);
      surface.image.data[k + 2] = 0;
      surface.image.data[k + 3] = 255;
      const l = s.lights;
      lights.image.data[k] = Math.round(255 * Math.min(1, l * 1.1));
      lights.image.data[k + 1] = Math.round(200 * l);
      lights.image.data[k + 2] = Math.round(110 * l);
      lights.image.data[k + 3] = 255;
    }
  }
  const toTexture = ({ canvas, ctx, image }, srgb) => {
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const maps = { color: toTexture(color, true), surface: toTexture(surface, false), lights: toTexture(lights, true) };
  cache.set(key, maps);
  return maps;
}

/** 행성 표면 색 텍스처 (지도 화면 등에서 색만 쓸 때) */
export function createPlanetTexture(siteDir, northDir, width = 2048) {
  return createPlanetMaps(siteDir, northDir, width).color;
}

/** 구름 텍스처: 흰색 + 노이즈로 만든 투명도 (정거원통 도법). 비튼 좌표로 소용돌이·띠 모양을 만든다 */
export function createCloudTexture(width = 2048) {
  const key = `clouds-${width}`;
  if (cache.has(key)) return cache.get(key);
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [x, y, z] = uvToWorldDirection((i + 0.5) / width, (j + 0.5) / height);
      // 소용돌이: 좌표를 노이즈로 크게 비튼다
      const wx = valueNoise3(x * 3 + 1.7, y * 3 - 2.9, z * 3 + 4.1) - 0.5;
      const wy = valueNoise3(x * 3 - 6.2, y * 3 + 3.3, z * 3 - 1.4) - 0.5;
      const wz = valueNoise3(x * 3 + 2.5, y * 3 + 7.7, z * 3 - 5.6) - 0.5;
      const n = fbm3((x + 0.5 * wx) * 4 + 31.7, (y + 0.5 * wy) * 4 - 12.9, (z + 0.5 * wz) * 4 + 5.3, 6);
      // 위도에 따라 구름 띠 (적도·중위도에 많고 아열대에 적음) — 행성 북극은 −Z
      const lat = Math.abs(z);
      const band = 0.06 * Math.cos(lat * Math.PI * 3.2);
      const fine = fbm3(x * 30, y * 30, z * 30, 3);
      const alpha = Math.min(1, Math.max(0, (n + band - 0.53) * 3.2)) * (0.75 + 0.25 * fine);
      const k = (j * width + i) * 4;
      image.data[k] = 255;
      image.data[k + 1] = 255;
      image.data[k + 2] = 255;
      image.data[k + 3] = Math.round(alpha * 225);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

/** 지면 근접 무늬 (풀·흙 결): 밝기 0.75~1.0 의 회색 반복 무늬, 지면 색에 곱해진다 */
export function createGroundDetailTexture(size = 256) {
  const key = `ground-${size}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // 원기둥 좌표로 이어 붙여 반복 경계가 보이지 않게 한다
      const a = (i / size) * Math.PI * 2;
      const b = (j / size) * Math.PI * 2;
      const n = fbm3(Math.cos(a) * 2 + 3, Math.sin(a) * 2, Math.cos(b) * 2 + Math.sin(b) * 2 * 0.5 + 7, 5);
      const g = Math.round((0.72 + 0.28 * n) * 255);
      const k = (j * size + i) * 4;
      image.data[k] = g;
      image.data[k + 1] = g;
      image.data[k + 2] = g;
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
