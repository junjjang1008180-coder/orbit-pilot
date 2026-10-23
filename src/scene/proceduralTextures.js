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
import { fbm3 } from './noise.js';

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

/** 행성 표면 색 텍스처 (정거원통 도법) */
export function createPlanetTexture(siteDir, northDir, width = 1024) {
  const key = `planet-${width}`;
  if (cache.has(key)) return cache.get(key);
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const dir = uvToWorldDirection((i + 0.5) / width, (j + 0.5) / height);
      const { color } = planetColorAt(dir, siteDir, northDir);
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

/** 구름 텍스처: 흰색 + 노이즈로 만든 투명도 (정거원통 도법) */
export function createCloudTexture(width = 1024) {
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
      const n = fbm3(x * 4 + 31.7, y * 4 - 12.9, z * 4 + 5.3, 6);
      const alpha = Math.min(1, Math.max(0, (n - 0.56) * 3.5));
      const k = (j * width + i) * 4;
      image.data[k] = 255;
      image.data[k + 1] = 255;
      image.data[k + 2] = 255;
      image.data[k + 3] = Math.round(alpha * 210);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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
