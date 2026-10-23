/**
 * 기동 노드 (궤도 계획)
 * ------------------------------------------------------------
 * 노드 = 미래의 한 시각(time)에 줄 속도 변화(Δv)를 궤도 기준 세 방향으로 나눈 것.
 *   진행(prograde)  : 그 순간 속도 방향
 *   법선(normal)    : 궤도면에 수직 (각운동량 h = r × v 방향)
 *   방사(radial)    : 궤도면 안에서 진행 방향에 수직, 바깥쪽 (v × h 방향)
 * 노드 시각의 위치·속도는 케플러 전파로 구하고, 그 속도에 Δv 를 더해 "실행 후 궤도" 를 예측한다.
 * 연소 시간은 치올콥스키 식으로 계산한다: m₁ = m₀·e^(−Δv/vₑ), 시간 = (m₀ − m₁)/ṁ.
 */
import { vec3 } from '../physics/vectorMath.js';
import { propagateKepler } from './kepler.js';
import { computeOrbit } from './orbitalElements.js';

/** 새 노드 */
export function createManeuverNode(time) {
  return { time, prograde: 0, normal: 0, radial: 0, executing: false, executionVector: null, remaining: null };
}

/** 노드 Δv 크기 (m/s) */
export function nodeDeltaV(node) {
  return Math.hypot(node.prograde, node.normal, node.radial);
}

/**
 * 위치·속도 기준의 궤도 방향 단위벡터
 * @returns {{prograde:number[], normal:number[], radial:number[]}}
 */
export function orbitalAxes(position, velocity) {
  const prograde = vec3.normalize(velocity);
  const normal = vec3.normalize(vec3.cross(position, velocity));
  const radial = vec3.normalize(vec3.cross(velocity, normal));
  return { prograde, normal, radial };
}

/**
 * 노드 시각의 상태, 월드 기준 Δv 벡터, 실행 후 궤도
 * @param {object} vehicle 현재 비행체 상태 (position, velocity, time)
 * @param {object} node 기동 노드
 * @param {number} mu 중력 파라미터
 * @param {number} planetRadius 행성 반지름
 */
export function evaluateNode(vehicle, node, mu, planetRadius) {
  const dt = node.time - vehicle.time;
  const at = propagateKepler(vehicle.position, vehicle.velocity, mu, Math.max(0, dt));
  const axes = orbitalAxes(at.position, at.velocity);
  const deltaV = vec3.add(
    vec3.add(vec3.scale(axes.prograde, node.prograde), vec3.scale(axes.normal, node.normal)),
    vec3.scale(axes.radial, node.radial),
  );
  const after = vec3.add(at.velocity, deltaV);
  return {
    timeToNode: dt,
    position: at.position,
    velocityBefore: at.velocity,
    deltaV, // 월드 기준 Δv 벡터 (m/s)
    orbitAfter: computeOrbit(at.position, after, mu, planetRadius),
    velocityAfter: after,
  };
}

/**
 * 연소 시간과 연료 충분 여부 (현재 단 기준)
 * @param {number} deltaV (m/s)
 * @param {{mass:number, thrust:number, exhaustVelocity:number, fuel:number}} engine
 */
export function estimateBurn(deltaV, { mass, thrust, exhaustVelocity, fuel }) {
  if (thrust <= 0 || exhaustVelocity <= 0) return { burnTime: Infinity, fuelNeeded: Infinity, enoughFuel: false };
  const endMass = mass * Math.exp(-deltaV / exhaustVelocity);
  const fuelNeeded = mass - endMass;
  const massFlow = thrust / exhaustVelocity;
  return { burnTime: fuelNeeded / massFlow, fuelNeeded, enoughFuel: fuelNeeded <= fuel + 1e-9 };
}
