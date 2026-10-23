/**
 * 중력 계산
 * ------------------------------------------------------------
 * 뉴턴 만유인력: 가속도 크기 g = μ / r², 방향은 행성 중심 쪽이다.
 * 고도가 높아져 r 이 커질수록 중력이 약해진다.
 */
import { vec3 } from './vectorMath.js';

/**
 * 위치 position(행성 중심 기준, m)에서의 중력가속도 벡터 (m/s²)
 * @param {number[]} position
 * @param {number} mu 중력 파라미터 μ (m³/s²)
 */
export function gravityAcceleration(position, mu) {
  const r = vec3.length(position);
  if (r === 0) return [0, 0, 0];
  // a = -μ · r̂ / r²  =  -μ · r⃗ / r³
  return vec3.scale(position, -mu / (r * r * r));
}

/** 행성 중심에서 거리 r(m)일 때 중력가속도 크기 (m/s²) */
export function gravityMagnitudeAtRadius(r, mu) {
  return mu / (r * r);
}
