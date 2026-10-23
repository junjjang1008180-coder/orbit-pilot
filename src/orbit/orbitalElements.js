/**
 * 궤도 요소 계산 (2체 문제, 행성 중심 관성 좌표계)
 * ------------------------------------------------------------
 * 현재 위치 r⃗ 과 속도 v⃗ 로부터 아래 값을 구한다.
 *   비에너지        ε = v²/2 − μ/r
 *   각운동량        h⃗ = r⃗ × v⃗
 *   이심률 벡터     e⃗ = (v⃗ × h⃗)/μ − r̂
 *   반장축          a = −μ / (2ε)        (ε < 0 일 때 타원)
 *   근지점 반지름   r_p = a(1 − e)       (포물선이면 h²/2μ)
 *   원지점 반지름   r_a = a(1 + e)       (ε ≥ 0 이면 무한대 = 탈출 궤도)
 * 고도는 반지름에서 행성 반지름을 뺀 값이다.
 */
import { vec3 } from '../physics/vectorMath.js';

/** 포물선(ε ≈ 0)으로 볼 비에너지 기준 (J/kg) */
const PARABOLIC_EPSILON = 1e-6;

/**
 * @param {number[]} position 행성 중심 기준 위치 (m)
 * @param {number[]} velocity 속도 (m/s)
 * @param {number} mu 중력 파라미터 (m³/s²)
 * @param {number} planetRadius 행성 반지름 (m)
 */
export function computeOrbit(position, velocity, mu, planetRadius) {
  const r = vec3.length(position);
  const speed = vec3.length(velocity);
  const energy = (speed * speed) / 2 - mu / r;
  const hVec = vec3.cross(position, velocity);
  const h = vec3.length(hVec);
  const eVec = vec3.sub(vec3.scale(vec3.cross(velocity, hVec), 1 / mu), vec3.scale(position, 1 / r));
  const e = vec3.length(eVec);

  let semiMajorAxis;
  let periapsisRadius;
  let apoapsisRadius;
  if (Math.abs(energy) < PARABOLIC_EPSILON) {
    semiMajorAxis = Infinity;
    periapsisRadius = (h * h) / (2 * mu);
    apoapsisRadius = Infinity;
  } else {
    semiMajorAxis = -mu / (2 * energy);
    periapsisRadius = semiMajorAxis * (1 - e);
    apoapsisRadius = energy < 0 ? semiMajorAxis * (1 + e) : Infinity;
  }

  const escape = energy >= 0;
  const periapsisAltitude = periapsisRadius - planetRadius;
  return {
    energy, // 비에너지 (J/kg)
    angularMomentum: hVec, // 각운동량 벡터 (m²/s)
    eccentricityVector: eVec,
    eccentricity: e,
    semiMajorAxis, // 반장축 (m), 탈출 궤도는 음수 또는 무한대
    periapsisRadius,
    apoapsisRadius,
    periapsisAltitude, // 근지점 고도 (m)
    apoapsisAltitude: apoapsisRadius - planetRadius, // 원지점 고도 (m), 탈출이면 Infinity
    period: escape ? Infinity : 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu), // 공전 주기 (s)
    escape, // 탈출 궤도(포물선·쌍곡선)
    // 근지점이 지표 아래 = 이대로 두면 행성에 떨어지는 궤도
    impact: periapsisAltitude < 0,
  };
}

/**
 * 원궤도 진입 성공 판정 (판정 기준은 설정 파일 orbit 항목)
 * @param {ReturnType<typeof computeOrbit>} orbit
 * @param {object} orbitConfig PHYSICS_CONFIG.orbit
 */
export function isCircularOrbitAchieved(orbit, orbitConfig) {
  return (
    !orbit.escape &&
    orbit.periapsisAltitude >= orbitConfig.minPeriapsisAltitude &&
    orbit.eccentricity <= orbitConfig.maxCircularEccentricity
  );
}
