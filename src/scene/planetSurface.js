/**
 * 행성 표면 색 (대륙·바다·사막·산·만년설) — 시각 효과 전용
 * ------------------------------------------------------------
 * 방향(행성 중심 기준 단위벡터)만으로 표면 색을 정한다.
 * 같은 함수를 행성 텍스처(멀리서 보는 구)와 발사장 주변 고해상도 지면에 함께 써서,
 * 가까이 볼 때와 멀리서 볼 때 색이 이어지게 한다. 물리(지면 높이 등)에는 영향을 주지 않는다.
 */
import { fbm3 } from './noise.js';

// 색 (선형 RGB, 0~1)
const OCEAN_DEEP = [0.012, 0.05, 0.16];
const OCEAN_SHALLOW = [0.03, 0.16, 0.3];
const GRASS = [0.09, 0.2, 0.06];
const FOREST = [0.04, 0.12, 0.035];
const DESERT = [0.42, 0.33, 0.17];
const ROCK = [0.2, 0.17, 0.14];
const SNOW = [0.85, 0.88, 0.92];

const LAND_LEVEL = 0.5; // 이 값보다 대륙 노이즈가 크면 육지

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param {number[]} dir 행성 중심 기준 단위 방향
 * @param {number[]} siteDir 발사장 방향 (발사장 주변은 항상 육지가 되도록)
 * @param {number[]} northDir 북극 방향 (위도 계산)
 * @returns {{color:number[], water:boolean}}
 */
export function planetColorAt(dir, siteDir, northDir) {
  const [x, y, z] = dir;
  // 대륙: 큰 무늬 노이즈 + 발사장 근처를 육지로 끌어올리는 보정
  const siteInfluence = clamp01((dot(dir, siteDir) - 0.85) / 0.15); // 발사장 근처 1, 멀어지면 0
  const raw = fbm3(x * 1.6 + 11.3, y * 1.6 - 4.1, z * 1.6 + 7.7, 6);
  const continent = raw + 0.3 * siteInfluence;
  const latitude = Math.abs(dot(dir, northDir)); // 0 = 적도, 1 = 극

  if (continent < LAND_LEVEL) {
    const depth = clamp01((LAND_LEVEL - continent) / 0.12);
    const ice = latitude > 0.965 ? clamp01((latitude - 0.965) / 0.02) : 0; // 위도 약 75° 위 바다는 얼음
    return { color: mix(mix(OCEAN_SHALLOW, OCEAN_DEEP, depth), SNOW, ice), water: true };
  }

  // 해안 0 → 내륙 높은 곳 1. 발사장 근처는 낮은 평야(풀밭)가 되도록 높이를 눌러 준다
  const height = clamp01((raw - LAND_LEVEL) / 0.25) * (1 - siteInfluence) + 0.08 * siteInfluence;
  const moisture = fbm3(x * 3.1 - 2.2, y * 3.1 + 9.4, z * 3.1 + 1.3, 4);
  let color = mix(GRASS, FOREST, clamp01((moisture - 0.45) * 3));
  // 적도 부근의 건조한 곳은 사막
  const dryness = clamp01((0.42 - moisture) * 5) * clamp01(1 - latitude * 1.6) * (1 - siteInfluence);
  color = mix(color, DESERT, dryness);
  color = mix(color, ROCK, clamp01((height - 0.55) * 2.5));
  const snowLine = 0.9 - latitude * 0.4;
  color = mix(color, SNOW, clamp01((height - snowLine) * 6) + clamp01((latitude - 0.95) * 25));
  return { color, water: false };
}

/** 선형 RGB(0~1) → sRGB 바이트(0~255), 캔버스 텍스처에 쓸 때 사용 */
export function linearToSrgbByte(v) {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
