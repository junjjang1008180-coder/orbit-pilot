/**
 * 자세(회전) 갱신
 * ------------------------------------------------------------
 * 조종 입력(피치·요·롤, -1~1)을 목표 회전 속도로 바꾸고,
 * 실제 회전 속도가 목표를 부드럽게 따라가도록 한 뒤 자세 쿼터니언을 적분한다.
 * 회전 속도와 축은 로켓 로컬 좌표 기준이다.
 *
 * 로컬 축과 키 방향
 *   피치(로컬 X 축): W = 기수 내리기 → 기수가 배(-Z) 쪽으로
 *   요  (로컬 Z 축): D = 오른쪽     → 기수가 +X 쪽으로
 *   롤  (로컬 Y 축): Q = 뒤에서 볼 때 반시계, E = 시계
 * 입력 부호 규칙: pitch +1 = 기수 올리기(S), yaw +1 = 오른쪽(D), roll +1 = 시계(E)
 */
import { vec3, quat } from './vectorMath.js';

const DEG = Math.PI / 180;

/**
 * 입력을 로컬 목표 회전 속도 벡터(rad/s)로 바꾼다.
 * @param {{pitch:number, yaw:number, roll:number}} input
 * @param {object} controlsConfig PHYSICS_CONFIG.controls
 */
export function targetAngularVelocity(input, controlsConfig) {
  return [
    // +X 축 양의 회전은 기수(+Y)를 +Z(등) 쪽으로 → 기수 올리기
    input.pitch * controlsConfig.pitchRateDeg * DEG,
    // +Y 축 양의 회전(오른손 법칙)은 꼬리 쪽에서 기수 방향으로 볼 때 시계 방향 → E 는 양수
    input.roll * controlsConfig.rollRateDeg * DEG,
    // +Z 축 양의 회전은 기수를 -X(왼쪽) 쪽으로 → 오른쪽(D)은 음수
    -input.yaw * controlsConfig.yawRateDeg * DEG,
  ];
}

/**
 * 회전 속도와 자세를 dt 만큼 갱신한다 (state 를 직접 바꾼다).
 * 지면에 서 있는 동안에는 회전하지 않는다.
 */
export function stepAttitude(state, controlsConfig, dt, rateScale = 1) {
  if (state.landed) {
    state.angularVelocity = [0, 0, 0];
    return;
  }
  const input = state.aborted ? { pitch: 0, yaw: 0, roll: 0 } : state.controls;
  const target = vec3.scale(targetAngularVelocity(input, controlsConfig), rateScale);
  // 1차 지연: ω ← ω + (목표 − ω)·(1 − e^(−k·dt))
  const blend = 1 - Math.exp(-controlsConfig.attitudeResponse * dt);
  state.angularVelocity = vec3.addScaled(
    state.angularVelocity,
    vec3.sub(target, state.angularVelocity),
    blend,
  );

  const rate = vec3.length(state.angularVelocity);
  // 아주 작은 회전 속도는 0 으로: 입력 없이 오래 두면 지수적으로 줄어 비정규 수가 되고,
  // 1/rate 가 무한대로 넘쳐 자세가 NaN 이 되는 것을 막는다
  if (rate < 1e-12) {
    state.angularVelocity = [0, 0, 0];
    return;
  }
  // 로컬 축 회전이므로 오른쪽에 곱한다: q ← q · Δq
  const delta = quat.fromAxisAngle(vec3.scale(state.angularVelocity, 1 / rate), rate * dt);
  state.orientation = quat.normalize(quat.multiply(state.orientation, delta));
}
