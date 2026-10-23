/**
 * 대기와 공기역학 계산
 * ------------------------------------------------------------
 * 공기 밀도:  ρ(h) = ρ₀ · e^(−h / H)   (대기 상한 위는 0)
 * 동압:       q = ½ · ρ · v²            (Pa)
 * 항력:       D = q · Cd · A            (N), 방향은 상대 속도의 반대
 * 행성 자전과 바람은 없으므로 공기에 대한 상대 속도 = 관성 속도이다.
 */
import { vec3 } from './vectorMath.js';

/**
 * 고도 altitude(m)에서의 공기 밀도 (kg/m³)
 * @param {number} altitude 해수면 기준 고도 (m)
 * @param {object} atmosphere PHYSICS_CONFIG.atmosphere
 */
export function airDensity(altitude, atmosphere) {
  if (altitude >= atmosphere.topAltitude) return 0;
  const h = Math.max(0, altitude);
  return atmosphere.seaLevelDensity * Math.exp(-h / atmosphere.scaleHeight);
}

/** 동압 q = ½ρv² (Pa) */
export function dynamicPressure(density, speed) {
  return 0.5 * density * speed * speed;
}

/** 원 단면적 π·r² (m²) */
export function circularArea(radius) {
  return Math.PI * radius * radius;
}

/**
 * 항력 벡터 (N)
 * @param {number[]} relativeVelocity 공기에 대한 상대 속도 (m/s)
 * @param {number} density 공기 밀도 (kg/m³)
 * @param {number} dragCoefficient Cd
 * @param {number} area 기준 단면적 (m²)
 */
export function dragForce(relativeVelocity, density, dragCoefficient, area) {
  const speed = vec3.length(relativeVelocity);
  if (speed === 0 || density === 0) return [0, 0, 0];
  const magnitude = dynamicPressure(density, speed) * dragCoefficient * area;
  return vec3.scale(relativeVelocity, -magnitude / speed);
}
