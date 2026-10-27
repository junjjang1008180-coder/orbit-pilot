/**
 * 행성 표면 (대륙·바다·사막·숲·산·만년설·도시 불빛) — 시각 효과 전용
 * ------------------------------------------------------------
 * 방향(행성 중심 기준 단위벡터)만으로 표면 색·높이·거칠기·밤 불빛을 정한다.
 * 같은 함수를 행성 텍스처(멀리서 보는 구)와 발사장·활주로 주변 고해상도 지면에 함께 써서,
 * 가까이 볼 때와 멀리서 볼 때 색이 이어지게 한다. 물리(지면 높이 등)에는 영향을 주지 않는다.
 *
 * 사실감을 위해
 *   - 대륙 노이즈 좌표를 다른 노이즈로 비틀어(domain warp) 해안선이 구불구불하고 반도·섬이 생기게 한다
 *   - 바다는 해안 가까이 얕은 청록, 먼 바다는 짙은 남색. 바다는 매끈해서(거칠기 낮음) 햇빛이 반사된다
 *   - 육지는 위도·습도에 따라 열대림 · 초원 · 사바나 · 사막 · 툰드라, 높은 곳은 바위와 눈
 *   - 해안·저지대의 일부에 도시 불빛 (밤쪽에서만 보인다)
 */
import { fbm3, valueNoise3 } from './noise.js';

// 색 (선형 RGB, 0~1) — 우주에서 본 지구 사진에 가깝게 어둡고 채도 낮게
const OCEAN_DEEP = [0.004, 0.016, 0.055];
const OCEAN_MID = [0.006, 0.032, 0.09];
const OCEAN_SHALLOW = [0.02, 0.11, 0.15];
const RAINFOREST = [0.018, 0.055, 0.016];
const FOREST = [0.03, 0.07, 0.025];
const GRASS = [0.075, 0.12, 0.04];
const SAVANNA = [0.2, 0.17, 0.075];
const DESERT = [0.52, 0.38, 0.2];
const DESERT_RED = [0.42, 0.2, 0.09];
const TUNDRA = [0.12, 0.12, 0.09];
const ROCK = [0.16, 0.13, 0.1];
const SNOW = [0.82, 0.85, 0.9];
const SEA_ICE = [0.6, 0.66, 0.72];

const LAND_LEVEL = 0.535; // 이 값보다 대륙 노이즈가 크면 육지 (바다가 더 넓게)

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param {number[]} dir 행성 중심 기준 단위 방향
 * @param {number[]} siteDir 발사장 방향 (발사장 주변은 항상 육지가 되도록)
 * @param {number[]} northDir 북극 방향 (위도 계산)
 * @returns {{color:number[], water:boolean, height:number, roughness:number, lights:number}}
 *   height: 육지 높이 0~1 (바다 0, 지형 굴곡 표시용), roughness: 표면 거칠기 0~1, lights: 도시 불빛 0~1
 */
export function planetColorAt(dir, siteDir, northDir) {
  const [x, y, z] = dir;
  // 대륙: 비튼 좌표의 큰 무늬 노이즈 + 발사장 근처를 육지로 끌어올리는 보정
  const siteInfluence = clamp01((dot(dir, siteDir) - 0.85) / 0.15); // 발사장 근처 1, 멀어지면 0
  const wx = valueNoise3(x * 2.3 + 3.1, y * 2.3 - 7.3, z * 2.3 + 1.9) - 0.5;
  const wy = valueNoise3(x * 2.3 - 5.7, y * 2.3 + 2.2, z * 2.3 - 3.4) - 0.5;
  const wz = valueNoise3(x * 2.3 + 8.8, y * 2.3 + 4.6, z * 2.3 + 6.1) - 0.5;
  const px = x + 0.42 * wx;
  const py = y + 0.42 * wy;
  const pz = z + 0.42 * wz;
  const raw = fbm3(px * 1.6 + 11.3, py * 1.6 - 4.1, pz * 1.6 + 7.7, 7);
  const continent = raw + 0.3 * siteInfluence;
  const latitude = Math.abs(dot(dir, northDir)); // 0 = 적도, 1 = 극

  if (continent < LAND_LEVEL) {
    const depth = clamp01((LAND_LEVEL - continent) / 0.1);
    let color = depth < 0.25 ? mix(OCEAN_SHALLOW, OCEAN_MID, depth / 0.25) : mix(OCEAN_MID, OCEAN_DEEP, (depth - 0.25) / 0.75);
    // 위도 약 70° 위 바다는 얼음 (가장자리는 얼음 조각처럼 섞인다)
    const iceNoise = fbm3(x * 12, y * 12, z * 12, 3);
    const ice = clamp01((latitude - 0.93 + (iceNoise - 0.5) * 0.06) / 0.02);
    color = mix(color, SEA_ICE, ice);
    return { color, water: ice < 0.5, height: ice * 0.1, roughness: ice > 0.5 ? 0.7 : 0.22, lights: 0 };
  }

  // 해안 0 → 내륙 높은 곳 1. 발사장 근처는 낮은 평야(풀밭)가 되도록 높이를 눌러 준다
  const ridges = 1 - Math.abs(fbm3(px * 6 + 2.7, py * 6 - 1.3, pz * 6 + 4.4, 4) * 2 - 1); // 산맥 줄기
  const height = clamp01(((raw - LAND_LEVEL) / 0.22) * 0.75 + ridges * ridges * 0.35 * clamp01((raw - LAND_LEVEL) / 0.06)) * (1 - siteInfluence) + 0.08 * siteInfluence;
  const moisture = fbm3(x * 3.1 - 2.2, y * 3.1 + 9.4, z * 3.1 + 1.3, 5);
  const coast = clamp01((continent - LAND_LEVEL) / 0.04); // 해안 0 → 내륙 1
  // 위도대별 기본 식생: 적도 열대림, 중위도 초원·숲, 고위도 툰드라
  let color = latitude < 0.3 ? mix(RAINFOREST, FOREST, latitude / 0.3) : latitude < 0.7 ? mix(FOREST, GRASS, (latitude - 0.3) / 0.4) : mix(GRASS, TUNDRA, clamp01((latitude - 0.7) / 0.2));
  color = mix(color, GRASS, clamp01((0.5 - moisture) * 4) * 0.6);
  // 아열대(위도 15~35°)의 건조한 곳은 사바나 → 사막 (붉은 사막도 섞임)
  const subtropic = clamp01(1 - Math.abs(latitude - 0.42) / 0.25);
  const dryness = clamp01((0.47 - moisture) * 6) * (0.35 + 0.65 * subtropic) * (1 - siteInfluence);
  color = mix(color, SAVANNA, clamp01(dryness * 1.8));
  const red = fbm3(x * 7 + 1.1, y * 7, z * 7 - 2.2, 3);
  color = mix(color, mix(DESERT, DESERT_RED, clamp01((red - 0.5) * 3)), clamp01((dryness - 0.35) * 2.2));
  // 높은 곳: 바위 → 눈 (극으로 갈수록 눈 고도가 낮다)
  color = mix(color, ROCK, clamp01((height - 0.5) * 2.5));
  const snowLine = 0.85 - latitude * 0.45;
  const snow = clamp01((height - snowLine) * 6) + clamp01((latitude - 0.9) * 20);
  color = mix(color, SNOW, clamp01(snow));
  // 잔무늬 (들판·숲 얼룩)
  const grain = 0.82 + 0.36 * fbm3(x * 60, y * 60, z * 60, 3);
  color = [color[0] * grain, color[1] * grain, color[2] * grain];
  // 도시 불빛: 사람이 많이 사는 해안·저지대·덜 추운 곳에 무리 지어
  const habitable = (1 - clamp01((height - 0.3) * 3)) * (1 - clamp01((latitude - 0.75) * 6)) * (1 - clamp01((dryness - 0.5) * 3)) * (0.4 + 0.6 * (1 - coast * 0.6));
  const cluster = fbm3(x * 26 + 5.5, y * 26 - 3.3, z * 26 + 9.1, 4);
  const lights = clamp01((cluster - 0.6) * 5) * habitable + clamp01((cluster - 0.52) * 2) * habitable * 0.12;
  return { color, water: false, height, roughness: snow > 0.5 ? 0.6 : 0.95, lights: clamp01(lights) };
}

/** 선형 RGB(0~1) → sRGB 바이트(0~255), 캔버스 텍스처에 쓸 때 사용 */
export function linearToSrgbByte(v) {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
