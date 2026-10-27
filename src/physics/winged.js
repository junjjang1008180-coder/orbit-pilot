/**
 * 날개 달린 궤도선(우주 왕복선)의 물리
 * ------------------------------------------------------------
 * 축: 로컬 +Y = 기수, +Z = 윗면(조종석 쪽), −Z = 배(열 차폐 타일), +X = 오른쪽 날개.
 *
 * 공기역학 (궤도선 단이 맨 아래 단일 때)
 *   받음각 α = 기수가 진행 방향보다 윗면 쪽으로 든 각, 옆미끄럼 β = 진행 방향이 오른쪽으로 벗어난 각
 *   양력 L = q·S·CL,  CL = a·sin(2α)          (q = ½ρv², S = 날개 면적)
 *   항력 D = q·S·CD,  CD = CD0 + k·sin²α + 바퀴 + 에어브레이크
 *   양력 방향 = 윗면 벡터에서 진행 방향 성분을 뺀 방향 (기체를 굴리면 양력도 기울어 방향이 바뀐다)
 *   수직 꼬리날개: 옆미끄럼이 있으면 기수를 진행 방향 쪽으로 돌린다 (동압에 비례)
 *
 * 착지·활주 (바퀴를 내리고 활주로 위)
 *   땅에 닿는 순간 수직 속도·속력·기수 각도·날개 기울기·활주로 위인지 검사
 *   → 통과하면 바퀴로 달린다: 앞바퀴가 내려앉고, 굴림 마찰·브레이크·항력(감속 낙하산)으로 감속,
 *     A/D 로 앞바퀴 방향을 돌린다. 너무 빠르게 활주로를 벗어나면 파손.
 */
import { vec3, quat } from './vectorMath.js';
import { isOnRunway } from '../landing/runway.js';

const DEG = Math.PI / 180;

/** 지금 맨 아래 단이 날개 달린 궤도선인지 */
export function isWinged(state) {
  return Boolean(state.stages[state.currentStage]?.winged);
}

/** 기체 축 (월드 방향) */
export function bodyAxes(state) {
  const q = state.orientation;
  return {
    nose: quat.rotate(q, [0, 1, 0]),
    top: quat.rotate(q, [0, 0, 1]),
    right: quat.rotate(q, [1, 0, 0]),
  };
}

/** 받음각·옆미끄럼 (rad) — 공기에 대한 속도 기준 (행성 자전·바람 없음) */
export function flowAngles(state, velocity = state.velocity) {
  const speed = vec3.length(velocity);
  if (speed < 1e-6) return { alpha: 0, beta: 0, speed: 0 };
  const b = quat.rotate(quat.conjugate(state.orientation), velocity); // 기체 좌표의 속도
  return { alpha: Math.atan2(-b[2], b[1]), beta: Math.asin(Math.max(-1, Math.min(1, b[0] / speed))), speed };
}

/**
 * 날개 공기력 (양력 + 항력, N)
 * @returns {{force:number[], alpha:number, beta:number, liftCoefficient:number, dragCoefficient:number}}
 */
export function wingedAeroForce(state, config, density) {
  const sh = config.shuttle;
  const { alpha, beta, speed } = flowAngles(state);
  if (speed < 1e-3 || density <= 0) return { force: [0, 0, 0], alpha, beta, liftCoefficient: 0, dragCoefficient: 0 };
  const q = 0.5 * density * speed * speed;
  const vHat = vec3.scale(state.velocity, 1 / speed);
  const { top } = bodyAxes(state);
  const cl = sh.liftSlope * Math.sin(2 * alpha);
  const s = Math.sin(alpha);
  const cd = sh.zeroLiftDrag + sh.inducedDrag * s * s + (state.gearDown ? sh.gearDrag : 0) + (state.speedbrake ?? 0) * sh.speedbrakeDrag;
  const liftRaw = vec3.addScaled(top, vHat, -vec3.dot(top, vHat));
  const liftLen = vec3.length(liftRaw);
  const liftDir = liftLen > 1e-6 ? vec3.scale(liftRaw, 1 / liftLen) : [0, 0, 0];
  const force = vec3.add(vec3.scale(liftDir, q * sh.wingArea * cl), vec3.scale(vHat, -q * sh.wingArea * cd));
  return { force, alpha, beta, liftCoefficient: cl, dragCoefficient: cd };
}

/** 수직 꼬리날개 효과: 옆미끄럼을 줄이도록 기수를 윗면 축 둘레로 돌린다 */
export function applyYawStability(state, config, dynamicPressure, dt) {
  const speed = vec3.length(state.velocity);
  if (speed < 5 || dynamicPressure < 10) return;
  const { nose, top } = bodyAxes(state);
  const vHat = vec3.scale(state.velocity, 1 / speed);
  const target = vec3.addScaled(vHat, top, -vec3.dot(vHat, top)); // 진행 방향을 윗면에 수직인 면에 투영
  const tl = vec3.length(target);
  if (tl < 1e-6) return;
  const t = vec3.scale(target, 1 / tl);
  const beta = Math.acos(Math.max(-1, Math.min(1, vec3.dot(nose, t))));
  if (beta < 1e-5 || beta > Math.PI / 2) return; // 뒤로 날 때는 하지 않음
  const rate = Math.min(0.6, config.shuttle.yawStability * (dynamicPressure / 1000)) * beta; // rad/s
  const axis = vec3.cross(nose, t);
  if (vec3.length(axis) < 1e-9) return;
  const step = Math.min(beta, rate * dt);
  state.orientation = quat.normalize(quat.multiply(quat.fromAxisAngle(vec3.normalize(axis), step), state.orientation));
}

/**
 * 진행 방향 기준 자세 유지 (실제 왕복선의 비행 제어 컴퓨터처럼):
 * 공기 속에서는 조종 입력이 없어도 받음각·뱅크가 그대로 유지되도록, 진행 방향이 돈 만큼 기체도 같이 돌린다.
 * (그러지 않으면 우주 기준 자세가 고정되어, 재진입하며 진행 방향이 휠 때 받음각이 계속 틀어진다)
 * 동압이 아주 낮은 곳(우주)에서는 하지 않는다.
 */
export function followFlightPath(state, velocityBefore, dynamicPressure) {
  if (!velocityBefore || dynamicPressure < 20) return;
  const a = vec3.length(velocityBefore);
  const b = vec3.length(state.velocity);
  if (a < 5 || b < 5) return;
  const from = vec3.scale(velocityBefore, 1 / a);
  const to = vec3.scale(state.velocity, 1 / b);
  const axis = vec3.cross(from, to);
  const s = vec3.length(axis);
  if (s < 1e-9) return;
  const angle = Math.atan2(s, vec3.dot(from, to));
  state.orientation = quat.normalize(quat.multiply(quat.fromAxisAngle(vec3.scale(axis, 1 / s), angle), state.orientation));
}

/** 기수 고각(°)과 날개 기울기(°, 오른쪽 날개가 내려가면 +) */
export function attitudeAngles(state) {
  const up = vec3.normalize(state.position);
  const { nose, right } = bodyAxes(state);
  return {
    pitchDeg: Math.asin(Math.max(-1, Math.min(1, vec3.dot(nose, up)))) / DEG,
    rollDeg: -Math.asin(Math.max(-1, Math.min(1, vec3.dot(right, up)))) / DEG,
  };
}

/**
 * 바퀴 착지 판정
 * @param {number[]} impactVelocity 닿는 순간 속도 (m/s)
 */
export function evaluateWheelTouchdown(state, config, impactVelocity) {
  const lim = config.shuttle.touchdown;
  const up = vec3.normalize(state.position);
  const vertical = vec3.dot(impactVelocity, up);
  const verticalSpeed = Math.max(0, -vertical);
  const horizontal = vec3.addScaled(impactVelocity, up, -vertical);
  const horizontalSpeed = vec3.length(horizontal);
  const { pitchDeg, rollDeg } = attitudeAngles(state);
  const onRunway = Boolean(isOnRunway(config, state.position, config.runway.tolerance ?? 0)); // 어느 활주로든
  const failures = [];
  if (!state.gearDown) failures.push('착륙 바퀴를 내리지 않았어요 (Y)');
  if (verticalSpeed > lim.maxVerticalSpeed) failures.push(`수직 속도 ${verticalSpeed.toFixed(1)} m/s > ${lim.maxVerticalSpeed}`);
  if (horizontalSpeed > lim.maxSpeed) failures.push(`속력 ${horizontalSpeed.toFixed(0)} m/s > ${lim.maxSpeed}`);
  if (pitchDeg < -lim.maxNoseDownDeg || pitchDeg > lim.maxPitchDeg) failures.push(`기수 각도 ${pitchDeg.toFixed(1)}° (범위 −${lim.maxNoseDownDeg}~${lim.maxPitchDeg}°)`);
  if (Math.abs(rollDeg) > lim.maxRollDeg) failures.push(`날개 기울기 ${Math.abs(rollDeg).toFixed(1)}° > ${lim.maxRollDeg}°`);
  if (!onRunway) failures.push('활주로 밖에 닿았어요');
  return {
    verticalSpeed,
    horizontalSpeed,
    tiltDeg: Math.abs(rollDeg),
    pitchDeg,
    rollDeg,
    onRunway,
    wheels: true,
    safe: failures.length === 0,
    failures,
    horizontalVelocity: horizontal,
  };
}

/**
 * 바퀴로 활주 (지면 위, 한 스텝)
 * @param {number} thrustAcceleration 기수 방향 추력 가속도 (m/s²)
 * @param {number[]} dragForce 공기 항력 (감속 낙하산 포함, N)
 * @param {number} mass (kg)
 * @returns {string|null} 파손 사유 (없으면 null)
 */
export function stepRolling(state, config, dt, thrustAcceleration, dragForce, mass) {
  const r = config.shuttle.rolling;
  const g = config.planet.surfaceGravity;
  const up = vec3.normalize(state.position);
  const rotateWorld = (axis, angle) => {
    if (Math.abs(angle) < 1e-9 || vec3.length(axis) < 1e-9) return;
    state.orientation = quat.normalize(quat.multiply(quat.fromAxisAngle(vec3.normalize(axis), angle), state.orientation));
  };
  let { nose, top } = bodyAxes(state);
  // 앞바퀴가 내려앉는다: 기수 고각 → 0
  const elevation = Math.asin(Math.max(-1, Math.min(1, vec3.dot(nose, up))));
  rotateWorld(vec3.cross(nose, up), -Math.sign(elevation) * Math.min(Math.abs(elevation), r.derotateRateDeg * DEG * dt));
  // 날개를 수평으로
  ({ nose, top } = bodyAxes(state));
  const topFlat = vec3.addScaled(up, nose, -vec3.dot(up, nose));
  if (vec3.length(topFlat) > 1e-6) {
    const tf = vec3.normalize(topFlat);
    const rollErr = Math.atan2(vec3.dot(vec3.cross(top, tf), nose), vec3.dot(top, tf));
    rotateWorld(nose, Math.sign(rollErr) * Math.min(Math.abs(rollErr), 10 * DEG * dt));
  }
  // 앞바퀴 조향 (A/D), 느리면 덜 돈다
  const speedNow = vec3.length(state.velocity);
  const steer = state.controls.yaw ?? 0;
  if (steer) rotateWorld(up, -steer * r.steerRateDeg * DEG * dt * Math.min(1, speedNow / 5));

  ({ nose } = bodyAxes(state));
  const noseFlat = vec3.addScaled(nose, up, -vec3.dot(nose, up));
  const forward = vec3.length(noseFlat) > 1e-6 ? vec3.normalize(noseFlat) : vec3.normalize(state.velocity);
  // 바퀴는 기수 방향으로만 굴러간다 (옆으로 미끄러지지 않음)
  let speed = Math.max(0, vec3.dot(state.velocity, forward));
  const braking = state.controls.brake || state.autoBrake;
  const resist = g * (r.friction + (braking ? r.brake : 0));
  const dragAlong = vec3.dot(dragForce, forward) / mass; // 보통 음수
  speed += (thrustAcceleration * Math.max(0, vec3.dot(nose, forward)) + dragAlong) * dt;
  speed = speed > 0 ? Math.max(0, speed - resist * dt) : 0;
  state.velocity = vec3.scale(forward, speed);
  // 지면(해수면)을 따라 이동
  const next = vec3.addScaled(state.position, state.velocity, dt);
  state.position = vec3.scale(vec3.normalize(next), config.planet.radius);
  state.gearDown = true;
  if (speed < 0.2 && thrustAcceleration <= 0.01) {
    state.velocity = [0, 0, 0];
    state.rolling = false;
  }
  if (speed > r.maxOffRunwaySpeed && !isOnRunway(config, state.position, config.runway.tolerance ?? 5)) return `활주로를 벗어났어요 (${speed.toFixed(0)} m/s)`;
  return null;
}
