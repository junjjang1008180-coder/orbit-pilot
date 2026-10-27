/**
 * 자세 제어기 — 기수를 원하는 방향으로 돌리는 피치·요·롤 입력 계산
 * ------------------------------------------------------------
 * 사람이 W/S/A/D/Q/E 를 누르는 것과 똑같은 -1~1 입력을 만든다 (물리 쪽 회전 한계는 그대로).
 *   오차 축 = 기수 × 목표 방향 (월드) → 로켓 로컬 축으로 바꿔
 *   입력 = 이득 × 오차 − 감쇠 × 현재 회전 속도   (비례-미분 제어)
 * 롤은 회전을 멈추는 쪽으로만 쓴다.
 */
import { vec3, quat } from '../physics/vectorMath.js';

const NOSE_LOCAL = [0, 1, 0];
const clampUnit = (x) => Math.max(-1, Math.min(1, x));

/**
 * @param {object} vehicle 비행체 상태 (orientation, angularVelocity)
 * @param {number[]} direction 기수를 향하게 할 월드 방향
 * @param {{attitudeGain:number, attitudeDamping:number}} autopilotConfig
 * @returns {{pitch:number, yaw:number, roll:number}}
 */
export function steerToward(vehicle, direction, autopilotConfig) {
  const nose = quat.rotate(vehicle.orientation, NOSE_LOCAL);
  const target = vec3.normalize(direction);
  const w = vehicle.angularVelocity;
  const k = autopilotConfig.attitudeGain;
  const damp = autopilotConfig.attitudeDamping;

  let axisWorld = vec3.cross(nose, target);
  // 정반대 방향이면 외적이 0 에 가까우므로 아무 수직 축으로 돌기 시작한다
  if (vec3.length(axisWorld) < 1e-4 && vec3.dot(nose, target) < 0) axisWorld = quat.rotate(vehicle.orientation, [1, 0, 0]);
  // 외적 크기 = sin(오차각). 90° 넘게 벌어지면 최대 입력으로 돈다
  const errorAngle = Math.acos(Math.max(-1, Math.min(1, vec3.dot(nose, target))));
  const axisLength = vec3.length(axisWorld);
  const axis = axisLength > 0 ? vec3.scale(axisWorld, errorAngle / axisLength) : [0, 0, 0];
  const local = quat.rotate(quat.conjugate(vehicle.orientation), axis);

  // 입력 부호 규칙(attitudeDynamics.js): pitch +1 = +X 축 회전, yaw +1 = −Z 축 회전, roll +1 = +Y 축 회전
  return {
    pitch: clampUnit(k * local[0] - damp * w[0]),
    yaw: clampUnit(-(k * local[2] - damp * w[2])),
    roll: clampUnit(-damp * w[1]),
  };
}

/** 기수 방향 단위벡터 */
export function noseOf(vehicle) {
  return quat.rotate(vehicle.orientation, NOSE_LOCAL);
}

/**
 * 기수 방향과 윗면 방향을 함께 맞추는 입력 (날개 달린 궤도선용 — 뱅크 각까지 잡는다)
 * 롤 오차 = 지금 윗면을 원하는 윗면(기수에 수직으로 투영)으로 돌리는 기수 축 둘레 각
 */
export function steerAttitude(vehicle, noseDirection, topDirection, autopilotConfig) {
  const out = steerToward(vehicle, noseDirection, autopilotConfig);
  const nose = quat.rotate(vehicle.orientation, NOSE_LOCAL);
  const top = quat.rotate(vehicle.orientation, [0, 0, 1]);
  const wanted = vec3.addScaled(topDirection, nose, -vec3.dot(topDirection, nose));
  if (vec3.length(wanted) < 1e-6) return out;
  const tp = vec3.normalize(wanted);
  const error = Math.atan2(vec3.dot(vec3.cross(top, tp), nose), vec3.dot(top, tp));
  out.roll = clampUnit(autopilotConfig.attitudeGain * error - autopilotConfig.attitudeDamping * vehicle.angularVelocity[1]);
  return out;
}
