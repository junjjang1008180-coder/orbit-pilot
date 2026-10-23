/**
 * 도킹 시스템
 * ------------------------------------------------------------
 * - 우주 정거장: 원궤도를 도는 엔진 없는 비행체. 도킹 포트(기수, 로컬 +Y 끝)가 진행 반대 방향을
 *   향하도록 자세를 유지해, 뒤(아래 궤도)에서 따라잡아 오는 우주선이 포트에 들어갈 수 있다.
 * - 포트 판정: 두 포트 사이 거리, 상대 속도, 두 포트 축이 마주 보는 정도를 설정 기준과 비교한다.
 * - 결합: 운동량을 보존해 두 물체의 속도를 합친 뒤, 우주선을 정거장에 고정된 상대 위치·자세로 붙인다.
 * - 분리: 서로 반대 방향으로 설정 속도만큼 밀어낸다 (운동량 보존).
 * - 자동 도킹: 접근 → 포트 앞 대기 지점 정렬 → 포트 접근 (주 엔진 + RCS 평행이동)
 * 모든 기준값은 PHYSICS_CONFIG.docking / station / rcs 에서 읽는다.
 */
import { vec3, quat } from '../physics/vectorMath.js';
import { rocketMass } from '../physics/flightPhysics.js';
import { createAutopilotState, stopProgram, announce } from '../autopilot/autopilot.js';
import { steerToward, noseOf } from '../autopilot/attitudeController.js';
import { idleInput } from '../rocket/rocketState.js';

const DEG = Math.PI / 180;

// ── 정거장 ───────────────────────────────────────────────
/**
 * 원궤도 위 위상각 phase(rad, 발사장(+Y)에서 동쪽(+X)으로 잰 각)의 정거장 상태
 * @param {object} config PHYSICS_CONFIG
 */
export function createStationVehicle(config, phase) {
  const { planet, station } = config;
  const r = planet.radius + station.orbitAltitude;
  const v = Math.sqrt(planet.mu / r);
  const position = [r * Math.sin(phase), r * Math.cos(phase), 0];
  const velocity = [v * Math.cos(phase), -v * Math.sin(phase), 0];
  // 처음 자세: 포트(+Y)가 진행 반대 방향을 보게
  const yAxis = vec3.normalize(vec3.scale(velocity, -1));
  const zAxis = [0, 0, 1];
  const xAxis = vec3.cross(yAxis, zAxis);
  const autopilot = createAutopilotState();
  autopilot.sas = 'retrograde'; // 포트를 계속 진행 반대 방향으로 유지
  return {
    time: 0,
    position,
    velocity,
    orientation: quat.fromBasis(xAxis, yAxis, zAxis),
    angularVelocity: [0, 0, 0],
    stages: [{ index: 0, dryMass: station.mass, fuel: 0, fuelCapacity: 0, maxThrust: 0, isp: 0, length: station.length, maxRadius: station.radius }],
    currentStage: 0,
    engineOn: false,
    throttle: 0,
    manualInput: idleInput(),
    controls: idleInput(),
    autopilot,
    rcsEnabled: false,
    docked: false,
    aborted: false,
    landed: false,
    liftoffBlocked: false,
    lastImpactSpeed: 0,
    dynamicPressure: 0,
    maxDynamicPressureSeen: 0,
    destroyed: false,
    destroyedReason: '',
    touchdown: null,
  };
}

/**
 * 발사 순간 기준 정거장 위상각: 같은 로켓으로 자동 궤도 진입을 미리 계산해,
 * 궤도에 들어간 순간 정거장이 rendezvousLead 만큼 앞에 있도록 한다.
 * @param {(definition:object) => object} createSimulation 정거장 없는 시뮬레이션을 만드는 함수
 */
export function computeStationPhase(config, definition, createSimulation) {
  const { planet, station } = config;
  const r = planet.radius + station.orbitAltitude;
  const omega = Math.sqrt(planet.mu / r ** 3); // 정거장 각속도 (rad/s)
  try {
    const sim = createSimulation(definition);
    sim.toggleAutopilot();
    const dt = config.simulation.fixedTimeStep * 4; // 미리 계산은 조금 성기게
    for (let t = 0; t < 1200 && sim.orbitAchievedAt === null; t += dt) {
      sim.step(dt);
      if (sim.state.destroyed) break;
    }
    if (sim.orbitAchievedAt !== null) {
      const p = sim.state.position;
      const theta = Math.atan2(p[0], p[1]); // 궤도 진입 지점의 위상각
      return theta + station.rendezvousLead / r - omega * sim.state.time;
    }
  } catch {
    /* 계산 실패 시 기본값 */
  }
  return station.fallbackPhaseDeg * DEG;
}

// ── 포트 ─────────────────────────────────────────────────
/** 로켓에 붙어 있는 단들의 전체 길이 (m) — 위치 기준점(아래 끝)에서 기수 끝까지 */
export function attachedLength(vehicle) {
  let length = 0;
  for (let i = vehicle.currentStage; i < vehicle.stages.length; i++) length += vehicle.stages[i].length;
  return length;
}

/** 기수 끝(도킹 포트) 위치 (m) */
export function portPosition(vehicle) {
  return vec3.addScaled(vehicle.position, noseOf(vehicle), attachedLength(vehicle));
}

/**
 * 맨 위 부품이 도킹 포트인지
 * @param {ReturnType<typeof import('../rocket/rocketDefinition.js').buildRocket>} rocket
 */
export function rocketHasDockingPort(rocket) {
  const top = rocket.stages.at(-1)?.parts.at(-1);
  return Boolean(top?.dockingPort);
}

/**
 * 두 포트 사이 상태
 * @returns {{portDistance:number, relativeSpeed:number, closingSpeed:number, alignmentDeg:number, lateralOffset:number, canDock:boolean, crash:boolean}}
 */
export function evaluateDocking(craft, station, config) {
  const d = config.docking;
  const craftPort = portPosition(craft);
  const stationPort = portPosition(station);
  const separation = vec3.sub(craftPort, stationPort);
  const portDistance = vec3.length(separation);
  const relV = vec3.sub(craft.velocity, station.velocity);
  const relativeSpeed = vec3.length(relV);
  const closingSpeed = portDistance > 1e-6 ? -vec3.dot(relV, vec3.scale(separation, 1 / portDistance)) : 0;
  // 우주선 기수가 정거장 포트 축의 반대 방향(마주 봄)에서 벗어난 각도
  const alignmentDeg = Math.acos(Math.max(-1, Math.min(1, -vec3.dot(noseOf(craft), noseOf(station))))) / DEG;
  const stationAxis = noseOf(station);
  const lateralOffset = vec3.length(vec3.addScaled(separation, stationAxis, -vec3.dot(separation, stationAxis)));
  const canDock = portDistance <= d.captureDistance && relativeSpeed <= d.maxRelativeSpeed && alignmentDeg <= d.maxAlignmentDeg;
  const crash = !canDock && portDistance <= d.captureDistance * 1.5 && relativeSpeed > d.crashSpeed;
  return { portDistance, relativeSpeed, closingSpeed, alignmentDeg, lateralOffset, canDock, crash };
}

/**
 * 결합: 운동량 보존으로 속도를 합치고, 우주선의 정거장 기준 상대 위치·자세를 기록한다.
 * @returns {{offsetLocal:number[], relativeOrientation:number[]}} 고정 정보
 */
export function dock(craft, station) {
  const mc = rocketMass(craft);
  const ms = rocketMass(station);
  const v = vec3.scale(vec3.add(vec3.scale(craft.velocity, mc), vec3.scale(station.velocity, ms)), 1 / (mc + ms));
  craft.velocity = vec3.clone(v);
  station.velocity = vec3.clone(v);
  // 포트끼리 딱 붙도록 우주선 위치를 맞춘 뒤 상대 위치 기록 (정거장 로컬 좌표)
  const nose = noseOf(craft);
  craft.position = vec3.addScaled(portPosition(station), nose, -attachedLength(craft));
  const inverse = quat.conjugate(station.orientation);
  craft.docked = true;
  craft.engineOn = false;
  craft.throttle = 0;
  craft.angularVelocity = [0, 0, 0];
  return {
    offsetLocal: quat.rotate(inverse, vec3.sub(craft.position, station.position)),
    relativeOrientation: quat.multiply(inverse, craft.orientation),
  };
}

/** 도킹 중: 우주선을 정거장에 고정된 상대 위치·자세로 따라가게 한다 */
export function followStation(craft, station, link) {
  craft.position = vec3.add(station.position, quat.rotate(station.orientation, link.offsetLocal));
  craft.orientation = quat.normalize(quat.multiply(station.orientation, link.relativeOrientation));
  craft.velocity = vec3.clone(station.velocity);
  craft.angularVelocity = [0, 0, 0];
  craft.time = station.time;
}

/** 분리: 정거장 포트 축을 따라 서로 밀어낸다 (운동량 보존) */
export function undock(craft, station, config) {
  const mc = rocketMass(craft);
  const ms = rocketMass(station);
  const axis = noseOf(station);
  const push = config.docking.undockSpeed;
  craft.velocity = vec3.addScaled(craft.velocity, axis, (push * ms) / (mc + ms));
  station.velocity = vec3.addScaled(station.velocity, axis, (-push * mc) / (mc + ms));
  craft.docked = false;
}

// ── 자동 도킹 프로그램 ───────────────────────────────────
const clampUnit = (x) => Math.max(-1, Math.min(1, x));

/** 원하는 상대 속도 변화 dv(월드) → RCS 평행이동 입력 (로컬 축) */
function translateFor(vehicle, dv, gain) {
  const local = quat.rotate(quat.conjugate(vehicle.orientation), vec3.scale(dv, gain));
  return [clampUnit(local[0]), clampUnit(local[1]), clampUnit(local[2])];
}

/** 크기를 limit 으로 자른 벡터 */
function capLength(v, limit) {
  const len = vec3.length(v);
  return len > limit ? vec3.scale(v, limit / len) : v;
}

/**
 * 자동 도킹 한 스텝 (autopilot 프로그램 'docking')
 * @param {object} craft 우주선 상태
 * @param {object} ctx autopilot 문맥 (config, target: {station})
 * @returns {{attitude?:object, translate?:number[]}}
 */
export function dockingProgram(craft, ctx) {
  const { config } = ctx;
  const d = config.docking;
  const station = ctx.target?.station;
  if (!station || craft.docked) {
    stopProgram(craft, craft.docked ? '도킹 완료' : '도킹 목표가 없어요');
    return {};
  }
  const ap = craft.autopilot;
  craft.rcsEnabled = true;
  const stationAxis = noseOf(station);
  const stationPort = portPosition(station);
  const craftPort = portPosition(craft);
  const relV = vec3.sub(craft.velocity, station.velocity);
  const faceThePort = vec3.scale(stationAxis, -1);
  const stage = craft.stages[craft.currentStage];
  const mass = rocketMass(craft);
  const amax = stage && stage.fuel > 0 ? stage.maxThrust / mass : 0;
  const setThrottle = (x) => {
    craft.throttle = Math.max(0, Math.min(1, x));
    craft.engineOn = craft.throttle > 0;
  };

  if (!ap.phase) ap.phase = 'approach';

  if (ap.phase === 'approach') {
    // 포트 앞 대기 지점으로 다가간다 (멀면 주 엔진, 가까우면 RCS)
    const standoff = vec3.addScaled(stationPort, stationAxis, d.approachStandoff);
    const toStandoff = vec3.sub(standoff, craftPort);
    const dist = vec3.length(toStandoff);
    const brake = Math.sqrt(2 * 0.4 * dist); // RCS 로도 멈출 수 있는 속도
    const desiredSpeed = Math.min(d.maxApproachSpeed, brake, 0.05 * dist + 0.3);
    const desired = dist > 0.01 ? vec3.scale(toStandoff, desiredSpeed / dist) : [0, 0, 0];
    const dv = vec3.sub(desired, relV);
    if (vec3.length(dv) > 3 && amax > 0) {
      // 큰 속도 변화는 주 엔진: 기수를 dv 방향으로 돌린 뒤 점화
      const aligned = vec3.dot(noseOf(craft), vec3.normalize(dv)) > 0.985;
      setThrottle(aligned ? Math.min(1, vec3.length(dv) / (amax * 0.5)) : 0);
      return { attitude: steerToward(craft, dv, config.autopilot) };
    }
    setThrottle(0);
    if (dist < 3 && vec3.length(relV) < 0.3) {
      ap.phase = 'align';
      announce(craft, '포트 앞 도착 — 정렬 중');
    }
    return { attitude: steerToward(craft, faceThePort, config.autopilot), translate: translateFor(craft, dv, 2) };
  }

  setThrottle(0);
  const separation = vec3.sub(craftPort, stationPort);
  const along = vec3.dot(separation, stationAxis); // 포트 축 방향 거리
  const lateral = vec3.addScaled(separation, stationAxis, -along); // 축에서 벗어난 정도

  if (ap.phase === 'align') {
    // 대기 지점에 머물며 기수를 포트와 마주 보게
    const standoff = vec3.addScaled(stationPort, stationAxis, d.approachStandoff);
    const desired = capLength(vec3.scale(vec3.sub(standoff, craftPort), 0.2), 1);
    const dv = vec3.sub(desired, relV);
    const alignment = Math.acos(Math.max(-1, Math.min(1, vec3.dot(noseOf(craft), faceThePort)))) / DEG;
    if (alignment < 2 && vec3.length(lateral) < 1 && vec3.length(relV) < 0.2) {
      ap.phase = 'dock';
      announce(craft, '정렬 완료 — 포트로 천천히 접근');
    }
    return { attitude: steerToward(craft, faceThePort, config.autopilot), translate: translateFor(craft, dv, 3) };
  }

  // 'dock': 포트 축을 따라 다가가며(가까울수록 느리게) 옆으로 벗어난 만큼 바로잡는다
  const closing = Math.min(d.maxClosingSpeed, d.finalApproachSpeed + d.closingSpeedPerMeter * Math.max(0, along));
  const desired = vec3.add(vec3.scale(stationAxis, -closing), capLength(vec3.scale(lateral, -0.4), 0.3));
  const dv = vec3.sub(desired, relV);
  return { attitude: steerToward(craft, faceThePort, config.autopilot), translate: translateFor(craft, dv, 4) };
}
