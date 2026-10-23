/**
 * 부스터 착륙: 착륙 지점 예측과 착륙 성공 판정
 * ------------------------------------------------------------
 * - 착륙 지점: 분리 순간 부스터가 조종 없이 떨어질 곳(중력 + 항력)을 미리 계산해,
 *   그 지표 위치에 착륙 지점을 둔다. (물리 함수 stepBallisticBody 를 그대로 사용)
 * - 성공 판정: 착지 판정(속도·기울기)이 안전하고, 착륙 지점 반지름 안에 내렸을 때만 성공.
 */
import { vec3 } from '../physics/vectorMath.js';
import { stepBallisticBody } from '../physics/ballisticBody.js';
import { circularArea } from '../physics/aerodynamics.js';

/**
 * 조종하지 않을 때의 낙하 지점 (지표 위치, m). 예측 시간 안에 떨어지지 않으면 null.
 * @param {object} vehicle 분리된 단 상태
 * @param {object} config PHYSICS_CONFIG
 */
export function predictImpactPoint(vehicle, config) {
  const stage = vehicle.stages[vehicle.currentStage];
  const body = {
    position: vec3.clone(vehicle.position),
    velocity: vec3.clone(vehicle.velocity),
    mass: stage.dryMass + stage.fuel,
    dragArea: circularArea(stage.maxRadius),
    landed: false,
  };
  const { predictionTimeStep, predictionMaxTime } = config.landing;
  for (let t = 0; t < predictionMaxTime; t += predictionTimeStep) {
    stepBallisticBody(body, config, predictionTimeStep);
    if (body.landed) return vec3.scale(vec3.normalize(body.position), config.planet.radius);
  }
  return null;
}

/** 두 지표 위치 사이의 지표 거리 (m, 대원 거리) */
export function surfaceDistance(a, b, planetRadius) {
  const cos = vec3.dot(vec3.normalize(a), vec3.normalize(b));
  return Math.acos(Math.max(-1, Math.min(1, cos))) * planetRadius;
}

/**
 * 착지한 부스터의 착륙 결과
 * @param {object} vehicle 착지한 부스터 상태 (vehicle.touchdown 이 있어야 함)
 * @param {number[] | null} landingZone 착륙 지점 지표 위치 (m)
 * @param {object} config PHYSICS_CONFIG
 * @returns {{result:'success'|'failure', reason:string, distance:number|null}}
 */
export function judgeBoosterLanding(vehicle, landingZone, config) {
  const distance = landingZone ? surfaceDistance(vehicle.position, landingZone, config.planet.radius) : null;
  if (vehicle.destroyed) return { result: 'failure', reason: `폭발 — ${vehicle.destroyedReason}`, distance };
  if (distance === null || distance > config.landing.landingZoneRadius) {
    const where = distance === null ? '착륙 지점 없음' : `착륙 지점에서 ${Math.round(distance).toLocaleString('ko-KR')} m`;
    return { result: 'failure', reason: `착륙 지점 밖에 내림 (${where}, 허용 ${config.landing.landingZoneRadius} m)`, distance };
  }
  return { result: 'success', reason: '착륙 지점에 수직 착륙', distance };
}
