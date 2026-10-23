/**
 * 예상 궤도선 점 계산
 * ------------------------------------------------------------
 * 궤도 방정식 r(ν) = p / (1 + e·cos ν),  p = h² / μ  (ν = 진근점 이각)
 * 을 궤도면 위에서 계산해 물리 좌표(m) 점 목록으로 돌려준다.
 * 타원은 한 바퀴, 쌍곡선(탈출)은 maxRadius 까지만 그린다.
 */
import { vec3 } from '../physics/vectorMath.js';
import { propagateKepler } from './kepler.js';

/**
 * @param {ReturnType<typeof import('./orbitalElements.js').computeOrbit>} orbit
 * @param {number[]} position 현재 위치 (m) — 원궤도·수직 궤도의 기준 방향에 쓴다
 * @param {number} mu (m³/s²)
 * @param {{segments?:number, maxRadius:number}} options
 * @returns {number[][]} 점 목록 (m)
 */
export function sampleOrbitPath(orbit, position, mu, { segments = 256, maxRadius }) {
  const h = vec3.length(orbit.angularMomentum);
  const e = orbit.eccentricity;

  // 각운동량이 거의 0 = 수직으로만 오르내리는 궤도 → 중심에서 바깥으로 곧은 선
  if (h < 1e-6) {
    const dir = vec3.normalize(position);
    const top = Math.min(orbit.apoapsisRadius, maxRadius);
    return [vec3.scale(dir, 0), vec3.scale(dir, top)];
  }

  // 궤도면 기준축: P = 근지점 방향, Q = 진행 방향으로 90°
  const W = vec3.normalize(orbit.angularMomentum);
  const P = e > 1e-9 ? vec3.normalize(orbit.eccentricityVector) : vec3.normalize(position);
  const Q = vec3.cross(W, P);
  const p = (h * h) / mu; // 반통경 (m)

  // 그릴 진근점 이각 범위
  let nuMax = Math.PI;
  if (e >= 1) {
    // 쌍곡선: 점근선 각도 acos(−1/e) 직전까지, 그리고 maxRadius 를 넘지 않게
    const asymptote = Math.acos(-1 / e);
    const cosAtMax = (p / maxRadius - 1) / e;
    nuMax = Math.min(asymptote * 0.999, Math.acos(Math.max(-1, Math.min(1, cosAtMax))));
  }

  const points = [];
  for (let i = 0; i <= segments; i++) {
    const nu = -nuMax + (2 * nuMax * i) / segments;
    const r = p / (1 + e * Math.cos(nu));
    if (!(r > 0) || r > maxRadius * 1.0001) continue;
    points.push(vec3.add(vec3.scale(P, r * Math.cos(nu)), vec3.scale(Q, r * Math.sin(nu))));
  }
  return points;
}

/** 근지점·원지점의 위치 (m). 원지점이 없으면(탈출) null */
export function apsisPositions(orbit, position) {
  const e = orbit.eccentricity;
  const P = e > 1e-9 ? vec3.normalize(orbit.eccentricityVector) : vec3.normalize(position);
  return {
    periapsis: vec3.scale(P, orbit.periapsisRadius),
    apoapsis: Number.isFinite(orbit.apoapsisRadius) ? vec3.scale(P, -orbit.apoapsisRadius) : null,
  };
}

/**
 * 지금부터 duration 초 동안 지나갈 길을 시간 순으로 나눈 점 (m) — 케플러 전파
 * (조우 지점까지만 그리는 궤도선 등에 쓴다)
 */
export function samplePathByTime(position, velocity, mu, duration, segments = 256) {
  const points = [vec3.clone(position)];
  for (let i = 1; i <= segments; i++) {
    points.push(propagateKepler(position, velocity, mu, (duration * i) / segments).position);
  }
  return points;
}
