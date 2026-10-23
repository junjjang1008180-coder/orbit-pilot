/**
 * 자동조종
 * ------------------------------------------------------------
 * 1) 자세 보조(SAS, T 키) — 기수 방향만 잡아 준다. 스로틀은 사람이 조절한다.
 *      hold       : 자세 유지 (조종 키를 누르면 돌고, 떼면 그 자세를 유지)
 *      prograde   : 진행 방향
 *      retrograde : 진행 반대 방향
 *      (도킹 목표가 있으면 target / antiTarget / relativePrograde / relativeRetrograde)
 * 2) 자동 비행 프로그램(G 키) — 자세와 스로틀, 단 분리까지 맡는다.
 *      orbit   : 발사 → 동압 관리 → 중력 선회 → 단 분리 → 원지점 목표 → 원궤도 연소
 *      landing : (부스터) 재진입 감속 → 착륙 지점 접근 → 수직 착륙
 *      moonLanding : (달 중력권) 수평 속도 없애기 → 자유 낙하 → 제동 → 수직 착륙
 *      maneuver : 기동 노드 실행
 *      reentry  : (궤도에서) 역추진으로 근지점 낮추기 → 회수 캡슐만 남기기 → 열 차폐막 앞으로 재진입 → 낙하산
 *    사람이 조종 키를 누르면 프로그램은 바로 해제된다.
 *
 * 매 물리 스텝마다 사람 입력(manualInput)을 받아 실제 조종 입력(controls)을 만든다.
 * 사람 조종과 같은 입력 경로·같은 물리를 쓰므로 자동조종이라고 특별한 힘이 생기지 않는다.
 */
import { vec3 } from '../physics/vectorMath.js';
import { localFrame } from '../physics/referenceFrame.js';
import { airDensity } from '../physics/aerodynamics.js';
import { steerToward, noseOf } from './attitudeController.js';
import { hasFuel } from '../physics/flightPhysics.js';

export const SAS_MODES = ['off', 'hold', 'prograde', 'retrograde'];
export const SAS_TARGET_MODES = ['target', 'antiTarget', 'relativePrograde', 'relativeRetrograde'];

export const SAS_LABELS = {
  off: '꺼짐',
  hold: '자세 유지',
  prograde: '진행 방향',
  retrograde: '역진행',
  target: '목표 방향',
  antiTarget: '목표 반대',
  relativePrograde: '상대 진행',
  relativeRetrograde: '상대 역진행',
  maneuver: '기동 방향',
};

export const PROGRAM_LABELS = {
  orbit: '자동 궤도 진입',
  landing: '자동 착륙',
  docking: '자동 도킹',
  maneuver: '기동 실행',
  moonLanding: '자동 달 착륙',
  reentry: '자동 재진입·회수',
};

export function createAutopilotState() {
  return {
    sas: 'off', // 자세 보조 모드
    holdDirection: null, // 자세 유지 방향 (월드)
    program: null, // 'orbit' | 'landing' | 'docking' | null
    phase: '', // 프로그램 진행 단계 (표시용)
    message: '', // 마지막 안내 문구
    messageTime: 0,
  };
}

const hasAttitudeInput = (m) => m.pitch !== 0 || m.yaw !== 0 || m.roll !== 0;
const hasTranslateInput = (m) => Boolean(m.translate) && m.translate.some((x) => x !== 0);
const hasAnyInput = (m) => hasAttitudeInput(m) || m.throttleUp || m.throttleDown || hasTranslateInput(m);

/** 조종 입력 c 를 사람 입력 m 으로 채운다 (평행이동 배열은 복사) */
function copyInput(c, m) {
  c.throttleUp = m.throttleUp;
  c.throttleDown = m.throttleDown;
  c.pitch = m.pitch;
  c.yaw = m.yaw;
  c.roll = m.roll;
  c.translate = m.translate ? [...m.translate] : [0, 0, 0];
}

/** 안내 문구 기록 */
export function announce(vehicle, message) {
  vehicle.autopilot.message = message;
  vehicle.autopilot.messageTime = vehicle.time;
}

/** 자동 비행 프로그램 끄기 */
export function stopProgram(vehicle, message) {
  const ap = vehicle.autopilot;
  if (!ap.program) return;
  ap.program = null;
  ap.phase = '';
  if (message) announce(vehicle, message);
}

/**
 * 물리 한 스텝 전에 호출: 실제 조종 입력(vehicle.controls)을 정한다.
 * @param {object} vehicle
 * @param {object} ctx {
 *   config, dt,
 *   orbit: () => 궤도 요소, canStage: boolean, separateStage: () => void,
 *   landingZone: number[] | null, target: {position, velocity, portDirection?} | null,
 *   dockingStep?: (vehicle, ctx) => object  (도킹 프로그램 — docking 모듈이 넘겨줌)
 * }
 */
export function stepAutopilot(vehicle, ctx) {
  const ap = vehicle.autopilot;
  const manual = vehicle.manualInput;
  const c = vehicle.controls;

  // 사람이 조종 키를 누르면 자동 비행 해제
  if (ap.program && hasAnyInput(manual)) stopProgram(vehicle, '조종 키 입력 — 자동 비행을 해제했어요');
  if (ap.program && (vehicle.destroyed || vehicle.aborted)) stopProgram(vehicle, '자동 비행 중단 (기체 이상)');

  if (ap.program) {
    const out = runProgram(vehicle, ctx);
    const attitude = out.attitude ?? { pitch: 0, yaw: 0, roll: 0 };
    c.throttleUp = false;
    c.throttleDown = false;
    c.pitch = attitude.pitch;
    c.yaw = attitude.yaw;
    c.roll = attitude.roll;
    c.translate = out.translate ? [...out.translate] : [0, 0, 0];
    return;
  }

  // 자세 보조 (SAS)
  copyInput(c, manual);
  if (ap.sas === 'off' || vehicle.landed) return;
  if (ap.sas === 'hold') {
    if (hasAttitudeInput(manual) || !ap.holdDirection) {
      ap.holdDirection = noseOf(vehicle); // 돌리는 동안·처음에는 현재 기수 방향을 새 목표로
      if (hasAttitudeInput(manual)) return;
    }
  } else if (hasAttitudeInput(manual)) {
    return; // 다른 모드에서도 사람이 돌리는 동안은 사람 입력 우선
  }
  const direction = sasDirection(vehicle, ap, ctx);
  if (!direction) return;
  const steer = steerToward(vehicle, direction, ctx.config.autopilot);
  c.pitch = steer.pitch;
  c.yaw = steer.yaw;
  c.roll = manual.roll !== 0 ? manual.roll : steer.roll;
}

/** SAS 모드별 목표 방향 (없으면 null) */
function sasDirection(vehicle, ap, ctx) {
  // 진행 방향은 기준 천체(행성 또는 달)에 대한 상대 속도로 정한다
  const body = ctx.reference?.();
  const velocity = body ? vec3.sub(vehicle.velocity, body.velocity) : vehicle.velocity;
  const speed = vec3.length(velocity);
  switch (ap.sas) {
    case 'hold':
      return ap.holdDirection;
    case 'prograde':
      return speed > 1 ? velocity : null;
    case 'retrograde':
      return speed > 1 ? vec3.scale(velocity, -1) : null;
    case 'maneuver': {
      const info = ctx.maneuver?.();
      return info && vec3.length(info.direction) > 1e-6 ? info.direction : null;
    }
    default:
      break;
  }
  const t = ctx.target;
  if (!t) return null;
  const toTarget = vec3.sub(t.position, vehicle.position);
  const relV = vec3.sub(vehicle.velocity, t.velocity);
  switch (ap.sas) {
    case 'target':
      return toTarget;
    case 'antiTarget':
      return vec3.scale(toTarget, -1);
    case 'relativePrograde':
      return vec3.length(relV) > 0.05 ? relV : null;
    case 'relativeRetrograde':
      return vec3.length(relV) > 0.05 ? vec3.scale(relV, -1) : null;
    default:
      return null;
  }
}

/** 자동 비행 프로그램 한 스텝 → { attitude } (스로틀·단 분리는 직접 명령) */
function runProgram(vehicle, ctx) {
  switch (vehicle.autopilot.program) {
    case 'orbit':
      return orbitProgram(vehicle, ctx);
    case 'landing':
      return landingProgram(vehicle, ctx);
    case 'docking':
      return ctx.dockingStep ? ctx.dockingStep(vehicle, ctx) : (stopProgram(vehicle, '도킹 목표가 없어요'), {});
    case 'maneuver':
      return maneuverProgram(vehicle, ctx);
    case 'moonLanding':
      return moonLandingProgram(vehicle, ctx);
    case 'reentry':
      return reentryProgram(vehicle, ctx);
    default:
      return {};
  }
}

function setThrottle(vehicle, value) {
  vehicle.throttle = Math.max(0, Math.min(1, value));
  vehicle.engineOn = vehicle.throttle > 0;
}

// ── 자동 궤도 진입 ────────────────────────────────────────
function orbitProgram(vehicle, ctx) {
  const { config, dt } = ctx;
  const a = config.autopilot;
  const ap = vehicle.autopilot;
  const frame = localFrame(vehicle.position, config.planet.northPoleDirection);
  const alt = vec3.length(vehicle.position) - config.planet.radius;
  const verticalSpeed = vec3.dot(vehicle.velocity, frame.up);
  const orbit = ctx.orbit();
  const q = vehicle.dynamicPressure;
  const qLimit = config.aerodynamics.maxDynamicPressure;

  // 연료가 떨어지면 다음 단으로
  if (vehicle.engineOn && !hasFuel(vehicle)) {
    if (ctx.canStage) {
      ctx.separateStage();
      setThrottle(vehicle, 1);
    } else {
      stopProgram(vehicle, '연료가 다 떨어져 자동 비행을 멈췄어요');
      return {};
    }
  }

  // 진행 방향의 수평 성분 (없으면 동쪽)
  const horizontalVelocity = vec3.addScaled(vehicle.velocity, frame.up, -verticalSpeed);
  const horizontal = vec3.length(horizontalVelocity) > 1 ? vec3.normalize(horizontalVelocity) : frame.east;
  const tilted = (angleFromVerticalDeg, toward) => {
    const t = (angleFromVerticalDeg * Math.PI) / 180;
    return vec3.add(vec3.scale(frame.up, Math.cos(t)), vec3.scale(toward, Math.sin(t)));
  };

  if (!ap.phase) ap.phase = 'ascent';
  if (ap.phase === 'ascent') {
    if (vehicle.landed && vehicle.throttle === 0) setThrottle(vehicle, 1);
    // 동압 관리: 한계에 가까우면 스로틀을 줄이고, 여유가 생기면 다시 최대로
    if (q > a.maxQThrottleDownRatio * qLimit) setThrottle(vehicle, vehicle.throttle - config.controls.throttleRate * dt);
    else if (q < a.maxQThrottleUpRatio * qLimit) setThrottle(vehicle, 1);
    const progress = Math.max(0, Math.min(1, (alt - a.gravityTurnStartAltitude) / (a.gravityTurnEndAltitude - a.gravityTurnStartAltitude)));
    const direction = tilted(progress * a.gravityTurnMaxAngleDeg, frame.east);
    if (!orbit.escape && orbit.apoapsisAltitude >= a.targetApoapsisAltitude) {
      setThrottle(vehicle, 0);
      ap.phase = 'coast';
      announce(vehicle, `원지점 ${Math.round(orbit.apoapsisAltitude / 1000)} km — 엔진을 끄고 원지점까지 올라가요`);
    }
    return { attitude: steerToward(vehicle, direction, a) };
  }

  if (ap.phase === 'coast') {
    const top = config.atmosphere.topAltitude;
    // 원지점 근처에 오거나, 대기 밖에서 떨어지기 시작하면 원궤도 연소
    if ((verticalSpeed < a.circularizeStartVerticalSpeed && alt > top) || (verticalSpeed < 0 && alt <= top)) {
      ap.phase = 'circularize';
      setThrottle(vehicle, 1);
      announce(vehicle, '원궤도 연소 시작');
    }
    return { attitude: steerToward(vehicle, horizontal, a) };
  }

  if (ap.phase === 'circularize') {
    // 추력이 약한 로켓은 원궤도가 되기 전에 원지점이 크게 올라갈 수 있다 → 엔진을 끄고 새 원지점까지 기다린다
    if (verticalSpeed > 0 && (orbit.escape || orbit.apoapsisAltitude > a.targetApoapsisAltitude * 2)) {
      setThrottle(vehicle, 0);
      ap.phase = 'coast';
      announce(vehicle, '원지점이 높아졌어요 — 엔진을 끄고 새 원지점에서 다시 연소해요');
      return { attitude: steerToward(vehicle, horizontal, a) };
    }
    const lift = Math.max(-20, Math.min(35, -verticalSpeed * a.circularizePitchPerVerticalSpeed));
    const direction = tilted(90 - lift, horizontal);
    if (ctx.orbitCircularNow()) {
      setThrottle(vehicle, 0);
      stopProgram(vehicle, '원궤도 진입 완료! 자세 보조를 진행 방향으로 맞춰 둘게요');
      vehicle.autopilot.sas = 'prograde';
      return {};
    }
    return { attitude: steerToward(vehicle, direction, a) };
  }
  return {};
}

// ── 기동 노드 실행 ───────────────────────────────────────
function maneuverProgram(vehicle, ctx) {
  const info = ctx.maneuver?.();
  if (!info) {
    // 노드가 끝났거나 지워졌으면 엔진을 끄고 지금 자세를 유지
    setThrottle(vehicle, 0);
    stopProgram(vehicle, vehicle.autopilot.message || '기동 완료');
    vehicle.autopilot.sas = 'hold';
    vehicle.autopilot.holdDirection = noseOf(vehicle);
    return {};
  }
  if (vehicle.engineOn && !hasFuel(vehicle)) {
    if (ctx.canStage) ctx.separateStage();
    else {
      setThrottle(vehicle, 0);
      stopProgram(vehicle, '연료가 다 떨어져 기동을 마치지 못했어요');
      return {};
    }
  }
  const direction = info.direction;
  if (vec3.length(direction) < 1e-6) return {};
  const attitude = steerToward(vehicle, direction, ctx.config.autopilot);
  const aligned = vec3.dot(noseOf(vehicle), vec3.normalize(direction)) > 0.995;
  if (info.timeToBurnStart > 0 && !info.executing) {
    vehicle.autopilot.phase = 'waitBurn';
    setThrottle(vehicle, 0);
    if (info.timeToBurnStart < 10) ctx.stopWarp(); // 점화 직전에는 시간 가속을 멈춘다
    return { attitude };
  }
  vehicle.autopilot.phase = 'burn';
  const stage = vehicle.stages[vehicle.currentStage];
  const mass = stage ? vehicle.stages.slice(vehicle.currentStage).reduce((m, st) => m + st.dryMass + st.fuel, 0) : 1;
  const amax = stage ? stage.maxThrust / mass : 0;
  // 남은 Δv 가 작아지면 스로틀을 줄여 넘치지 않게
  setThrottle(vehicle, aligned && amax > 0 ? Math.max(0.02, Math.min(1, info.remaining / (amax * 0.8))) : 0);
  return { attitude };
}

// ── 부스터 자동 착륙 ─────────────────────────────────────
function landingProgram(vehicle, ctx) {
  const { config } = ctx;
  const zone = ctx.landingZone;
  if (!zone || vehicle.landed) {
    stopProgram(vehicle, vehicle.landed ? '착지했어요' : '착륙 지점이 없어요');
    setThrottle(vehicle, 0);
    return {};
  }
  const a = config.autopilot;
  const up = vec3.normalize(vehicle.position);
  const alt = vec3.length(vehicle.position) - config.planet.radius;
  const vs = vec3.dot(vehicle.velocity, up);
  const toZone = vec3.sub(zone, vehicle.position);
  const horizToZone = vec3.addScaled(toZone, up, -vec3.dot(toZone, up));
  const hv = vec3.addScaled(vehicle.velocity, up, -vs);
  const stage = vehicle.stages[vehicle.currentStage];
  const amax = stage.maxThrust / (stage.dryMass + stage.fuel);
  const g = config.planet.surfaceGravity;
  // 동압이 한계의 60% 를 넘지 않는 속도
  const rho = Math.max(1e-6, airDensity(alt, config.atmosphere));
  const vSafe = Math.sqrt((2 * 0.6 * config.aerodynamics.maxDynamicPressure) / rho);
  const dist = vec3.length(horizToZone);
  // 착륙 지점 쪽으로 향하는 목표 수평 속도 (가까울수록 느리게)
  const desiredH = dist > 0.5 ? vec3.scale(vec3.normalize(horizToZone), Math.min(60, dist * 0.08, Math.sqrt(3 * dist))) : [0, 0, 0];
  // 제동 가능한 목표 하강 속도
  const brakeVs = Math.sqrt(2 * Math.max(0.5, amax * 0.25) * Math.max(0, alt - 15));
  const targetVs = -Math.max(dist > 15 && alt < 60 ? 0.5 : 2.5, Math.min(vSafe * 0.9, brakeVs));
  const acc = vec3.add(vec3.scale(vec3.sub(desiredH, hv), 0.8), vec3.scale(up, (targetVs - vs) * 3 + g));
  let dir = vec3.normalize(vec3.dot(acc, up) > 0.1 ? acc : up);
  const maxTilt = ((alt < 8 ? 2 : 25) * Math.PI) / 180;
  if (vec3.dot(dir, up) < Math.cos(maxTilt)) {
    const h = vec3.addScaled(dir, up, -vec3.dot(dir, up));
    dir = vec3.length(h) > 1e-6 ? vec3.add(vec3.scale(up, Math.cos(maxTilt)), vec3.scale(vec3.normalize(h), Math.sin(maxTilt))) : up;
  }
  const nose = noseOf(vehicle);
  const throttle = vec3.dot(nose, dir) > 0.85 ? Math.min(1, Math.max(0, vec3.dot(acc, nose)) / amax) : vs < -5 && alt < 300 ? 0.3 : 0;
  setThrottle(vehicle, throttle);
  vehicle.autopilot.phase = alt > 15_000 ? 'coast' : vehicle.dynamicPressure > 1000 ? 'descent' : 'final';
  return { attitude: steerToward(vehicle, dir, a) };
}

// ── 자동 달 착륙 ─────────────────────────────────────────
// 달은 대기가 없으므로 동압 걱정 없이:
//   1) 수평 속도(달 표면 기준)를 역추진으로 없애고 (그동안 높이는 자유 낙하)
//   2) 제동 곡선(남은 높이에서 멈출 수 있는 속도)보다 빨리 떨어지면 감속
//   3) 마지막 수십 m 는 느린 일정 속도로 수직 착지
function moonLandingProgram(vehicle, ctx) {
  const body = ctx.reference?.();
  if (!body || body.id !== 'moon') {
    setThrottle(vehicle, 0);
    stopProgram(vehicle, '달 중력권 밖이에요');
    return {};
  }
  if (vehicle.landed) {
    setThrottle(vehicle, 0);
    stopProgram(vehicle, vehicle.touchdown?.safe ? '달 착륙 성공!' : '착지했어요');
    vehicle.autopilot.sas = 'off';
    return {};
  }
  if (vehicle.engineOn && !hasFuel(vehicle)) {
    if (ctx.canStage) ctx.separateStage();
    else {
      setThrottle(vehicle, 0);
      stopProgram(vehicle, '연료가 다 떨어져 자동 착륙을 멈췄어요');
      return {};
    }
  }
  const a = ctx.config.autopilot;
  const relPos = vec3.sub(vehicle.position, body.position);
  const relVel = vec3.sub(vehicle.velocity, body.velocity);
  const up = vec3.normalize(relPos);
  const alt = vec3.length(relPos) - body.radius;
  const vs = vec3.dot(relVel, up);
  const hv = vec3.addScaled(relVel, up, -vs);
  const hSpeed = vec3.length(hv);
  const stage = vehicle.stages[vehicle.currentStage];
  const mass = vehicle.stages.slice(vehicle.currentStage).reduce((m, st) => m + st.dryMass + st.fuel, 0);
  const amax = stage && mass > 0 ? stage.maxThrust / mass : 0;
  const g = body.mu / vec3.dot(relPos, relPos);
  if (amax <= g * 1.1) {
    setThrottle(vehicle, 0);
    stopProgram(vehicle, '추력이 약해 달에 착륙할 수 없어요 (TWR ≤ 1.1)');
    return {};
  }
  // 제동 곡선: 여유 있게 최대 추력의 60% 로 멈출 수 있는 하강 속도, 마지막엔 1.5 m/s
  const brakeAcc = Math.max(0.2, amax * 0.6 - g);
  const brakeSpeed = Math.sqrt(2 * brakeAcc * Math.max(0, alt - 12));
  const targetVs = -Math.max(alt < 40 ? 1.5 : 3, brakeSpeed);
  // 수직이 먼저: 목표 하강 속도에 맞추는 위쪽 가속도 (아래로는 밀지 않는다)
  const verticalAcc = Math.min(amax, Math.max(0, (targetVs - vs) * 2 + g));
  // 남은 추력으로 수평 속도를 없앤다 (빠르면 최대, 느리면 비례)
  const horizontalRoom = Math.sqrt(Math.max(0, amax * amax - verticalAcc * verticalAcc));
  const horizontalAcc = Math.min(horizontalRoom * 0.95, hSpeed * 0.6);
  let acc = vec3.scale(up, verticalAcc);
  if (hSpeed > 1e-6) acc = vec3.addScaled(acc, hv, -horizontalAcc / hSpeed);
  let accMag = vec3.length(acc);
  let dir = accMag > 1e-3 ? vec3.scale(acc, 1 / accMag) : null;
  // 땅 가까이에서는 거의 똑바로 선다 (기울기 제한, 위쪽 성분은 유지)
  const maxTiltDeg = alt < 30 ? 3 : alt < 300 ? 20 : null; // null = 제한 없음 (높은 곳에서는 수평으로도 민다)
  const maxTilt = ((maxTiltDeg ?? 90) * Math.PI) / 180;
  if (dir && maxTiltDeg !== null && vec3.dot(dir, up) < Math.cos(maxTilt)) {
    const h = vec3.normalize(vec3.addScaled(dir, up, -vec3.dot(dir, up)));
    dir = vec3.add(vec3.scale(up, Math.cos(maxTilt)), vec3.scale(h, Math.sin(maxTilt)));
    accMag = Math.min(amax, verticalAcc / Math.cos(maxTilt));
  }
  // 밀 필요가 없으면 역진행 방향(제동 방향)을 미리 보고 기다린다
  const relSpeed = vec3.length(relVel);
  if (!dir) dir = relSpeed > 1 ? vec3.scale(relVel, -1 / relSpeed) : up;
  const nose = noseOf(vehicle);
  const alignment = vec3.dot(nose, dir);
  const throttle = alignment > 0.9 ? Math.min(1, (accMag * alignment) / amax) : 0;
  setThrottle(vehicle, throttle);
  vehicle.autopilot.phase = hSpeed > 3 && alt > 300 ? 'deorbit' : alt > 40 ? 'descent' : 'final';
  return { attitude: steerToward(vehicle, dir, a) };
}

// ── 자동 재진입·회수 ─────────────────────────────────────
function reentryProgram(vehicle, ctx) {
  const { config } = ctx;
  const a = config.autopilot;
  const ap = vehicle.autopilot;
  if (vehicle.landed) {
    setThrottle(vehicle, 0);
    stopProgram(vehicle, vehicle.touchdown?.safe ? '회수 성공! 안전하게 내려왔어요' : '착지했어요');
    vehicle.autopilot.sas = 'off';
    return {};
  }
  const body = ctx.reference?.();
  if (body && body.id !== 'planet') {
    setThrottle(vehicle, 0);
    stopProgram(vehicle, '행성 중력권에서만 재진입할 수 있어요');
    return {};
  }
  const speed = vec3.length(vehicle.velocity);
  const retrograde = speed > 1 ? vec3.scale(vehicle.velocity, -1 / speed) : vec3.normalize(vehicle.position);
  const alt = vec3.length(vehicle.position) - config.planet.radius;
  const stage = vehicle.stages[vehicle.currentStage];
  const isRecoveryStage = (st) => (st?.parachuteArea ?? 0) > 0 || (st?.bottomShieldTemperature ?? 0) > 0;

  if (!ap.phase) ap.phase = ctx.orbit().periapsisAltitude > a.reentryPeriapsisAltitude ? 'retroBurn' : 'separate';

  if (ap.phase === 'retroBurn') {
    // 역진행으로 연소해 근지점을 대기 안(목표 고도)으로 낮춘다
    if (ctx.orbit().periapsisAltitude <= a.reentryPeriapsisAltitude) {
      setThrottle(vehicle, 0);
      ap.phase = 'separate';
      announce(vehicle, '근지점을 낮췄어요 — 회수 캡슐만 남기고 재진입해요');
    } else if (!stage || stage.maxThrust <= 0 || !hasFuel(vehicle)) {
      if (ctx.canStage && !isRecoveryStage(stage)) ctx.separateStage();
      else {
        setThrottle(vehicle, 0);
        stopProgram(vehicle, '역추진할 엔진·연료가 없어 재진입할 수 없어요');
        return {};
      }
    } else {
      const aligned = vec3.dot(noseOf(vehicle), retrograde) > 0.995;
      setThrottle(vehicle, aligned ? 1 : 0);
    }
    return { attitude: steerToward(vehicle, retrograde, a) };
  }

  if (ap.phase === 'separate') {
    // 열 차폐막·낙하산이 있는 단이 맨 아래가 될 때까지 아래 단을 떼어 낸다
    setThrottle(vehicle, 0);
    if (ctx.canStage && !isRecoveryStage(stage)) ctx.separateStage();
    else ap.phase = 'entry';
    return { attitude: steerToward(vehicle, retrograde, a) };
  }

  if (ap.phase === 'entry') {
    // 꼬리(열 차폐막)를 진행 방향으로 → 충분히 느려지면 낙하산
    const pc = config.parachute;
    const slowEnough = speed < pc.maxDeploySpeed * 0.85 && vehicle.dynamicPressure < pc.maxDeployDynamicPressure * 0.8;
    if (vehicle.parachute === 'packed' && slowEnough && alt < 25_000) {
      ctx.deployParachute?.();
      ap.phase = 'chute';
    }
    return { attitude: steerToward(vehicle, retrograde, a) };
  }

  // 낙하산에 매달려 내려가는 중: 자세는 낙하산이 잡는다
  ap.phase = 'chute';
  return {};
}
