/**
 * 달 조우 예측과 달 전이 계획
 * ------------------------------------------------------------
 * 조우 예측: 행성 기준 2체 궤도(케플러 전파)를 시간 순으로 따라가며, 달 중력권(SOI)
 *   경계 안으로 처음 들어가는 시각을 찾고(이분법으로 다듬음), 그 순간의 달 기준 위치·속도로
 *   "달 기준 궤도"(근접 고도 등)를 계산한다. 물리도 같은 중력권 이어 붙이기를 쓰므로
 *   예측과 실제가 거의 같다.
 * 달 전이 계획(호만 전이): 한 바퀴를 촘촘히 나눈 각 시각에서, 원지점이 달 궤도까지 닿는
 *   진행 방향 Δv 를 주었을 때의 조우를 예측해, 달 근접 고도가 목표에 가장 가까운 시각과 Δv 를 고른다.
 * 궤도 보정: 이미 전이 궤도에 있으면, 조금 뒤에 줄 작은 진행·방사 Δv 를 찾아 근접 고도를 목표에 맞춘다
 *   (연소 오차로 근접 고도가 어긋났을 때).
 */
import { vec3 } from '../physics/vectorMath.js';
import { moonState } from '../physics/celestialBodies.js';
import { propagateKepler } from './kepler.js';
import { computeOrbit } from './orbitalElements.js';

const SAMPLE_STEP = 45; // 조우 탐색 간격 (s). 상대 속도 3 km/s 에서도 중력권 지름보다 훨씬 짧다.
const MAX_SAMPLES = 3_000;
const BISECTION_STEPS = 30;

/**
 * 행성 기준 궤도가 달 중력권에 들어가는지 예측한다
 * @param {number[]} position 행성 중심 기준 위치 (m)
 * @param {number[]} velocity 속도 (m/s)
 * @param {number} time 지금 시각 (s)
 * @param {object} config PHYSICS_CONFIG
 * @param {{horizon?:number}} [options] 탐색할 최대 시간 (s, 기본: 한 주기 또는 탈출 궤도면 12시간)
 * @returns {null | {
 *   time:number, timeToEncounter:number, moonPosition:number[],
 *   relativePosition:number[], relativeVelocity:number[], orbit:object, periapsisAltitude:number,
 * }}
 */
export function predictMoonEncounter(position, velocity, time, config, { horizon } = {}) {
  if (!config.moon) return null;
  const { planet, moon } = config;
  const orbit = computeOrbit(position, velocity, planet.mu, planet.radius);
  // 원지점이 달 중력권 안쪽 경계에 못 미치면 만날 수 없다
  if (!orbit.escape && orbit.apoapsisRadius < moon.orbitRadius - moon.soiRadius) return null;
  if (orbit.periapsisRadius > moon.orbitRadius + moon.soiRadius) return null;
  const span = horizon ?? (orbit.escape ? 12 * 3600 : Math.min(orbit.period, 24 * 3600));
  const samples = Math.min(MAX_SAMPLES, Math.max(20, Math.ceil(span / SAMPLE_STEP)));

  const distanceAt = (dt) => {
    const at = propagateKepler(position, velocity, planet.mu, dt);
    return vec3.length(vec3.sub(at.position, moonState(config, time + dt).position));
  };

  let previous = 0;
  for (let i = 1; i <= samples; i++) {
    const dt = (span * i) / samples;
    if (distanceAt(dt) < moon.soiRadius) {
      // 경계를 이분법으로 찾는다 (previous 는 밖, dt 는 안)
      let lo = previous;
      let hi = dt;
      for (let k = 0; k < BISECTION_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (distanceAt(mid) < moon.soiRadius) hi = mid;
        else lo = mid;
      }
      return encounterAt(position, velocity, time, hi, config);
    }
    previous = dt;
  }
  return null;
}

/** 조우 시각 time + dt 의 달 기준 상태와 궤도 */
function encounterAt(position, velocity, time, dt, config) {
  const at = propagateKepler(position, velocity, config.planet.mu, dt);
  const moon = moonState(config, time + dt);
  const relativePosition = vec3.sub(at.position, moon.position);
  const relativeVelocity = vec3.sub(at.velocity, moon.velocity);
  const orbit = computeOrbit(relativePosition, relativeVelocity, config.moon.mu, config.moon.radius);
  return {
    time: time + dt,
    timeToEncounter: dt,
    moonPosition: moon.position, // 조우 순간 달 위치 (행성 기준)
    relativePosition,
    relativeVelocity,
    orbit, // 달 기준 궤도 요소
    periapsisAltitude: orbit.periapsisAltitude, // 달 근접 고도 (m), 음수면 충돌
  };
}

/**
 * 달 전이 기동 계획 (행성 궤도에서)
 * @param {{position:number[], velocity:number[], time:number}} vehicle 행성 기준 상태
 * @param {object} config
 * @param {{targetPeriapsisAltitude?:number}} [options] 목표 달 근접 고도 (m)
 * @returns {null | {time:number, prograde:number, encounter:object}}
 */
export function planMoonTransfer(vehicle, config, { targetPeriapsisAltitude = 30_000 } = {}) {
  if (!config.moon) return null;
  const { planet, moon } = config;
  const orbit = computeOrbit(vehicle.position, vehicle.velocity, planet.mu, planet.radius);
  if (orbit.escape || orbit.apoapsisRadius > moon.orbitRadius - moon.soiRadius) return null;
  const period = orbit.period;

  // 노드 시각 dt 에서 원지점을 달 궤도 반지름 × factor 로 올리는 진행 방향 Δv 와 그 조우
  const evaluate = (dt, factor = 1) => {
    const at = propagateKepler(vehicle.position, vehicle.velocity, planet.mu, dt);
    const r = vec3.length(at.position);
    const ra = moon.orbitRadius * factor;
    const vNeeded = Math.sqrt(planet.mu * (2 / r - 2 / (r + ra)));
    const prograde = vNeeded - vec3.length(at.velocity);
    const after = vec3.add(at.velocity, vec3.scale(vec3.normalize(at.velocity), prograde));
    const encounter = predictMoonEncounter(at.position, after, vehicle.time + dt, config);
    const miss = encounter ? Math.abs(encounter.periapsisAltitude - targetPeriapsisAltitude) : Infinity;
    return { dt, factor, prograde, encounter, miss };
  };

  // 1) 한 바퀴(+ 여유 10초 이후부터)를 나눠 거친 탐색
  const coarse = 180;
  let best = null;
  for (let i = 0; i < coarse; i++) {
    const c = evaluate(30 + (period * i) / coarse);
    if (c.encounter && (!best || c.miss < best.miss)) best = c;
  }
  if (!best) return null;

  // 2) 시각과 원지점 배율을 번갈아 좁혀 근접 고도를 목표에 맞춘다
  let span = period / coarse;
  let factorSpan = 0.04;
  for (let round = 0; round < 6; round++) {
    for (let k = -6; k <= 6; k++) {
      const c = evaluate(Math.max(10, best.dt + (span * k) / 6), best.factor);
      if (c.encounter && c.miss < best.miss) best = c;
    }
    for (let k = -6; k <= 6; k++) {
      const c = evaluate(best.dt, best.factor + (factorSpan * k) / 6);
      if (c.encounter && c.miss < best.miss) best = c;
    }
    span /= 4;
    factorSpan /= 4;
  }
  return { time: vehicle.time + best.dt, prograde: best.prograde, encounter: best.encounter };
}

/**
 * 전이 궤도 위에서 근접 고도 보정 계획
 * @param {{position:number[], velocity:number[], time:number}} vehicle 행성 기준 상태
 * @param {object} config
 * @param {{targetPeriapsisAltitude?:number, leadTime?:number}} [options] leadTime: 지금부터 노드까지 (s)
 * @returns {null | {time:number, prograde:number, radial:number, encounter:object}}
 */
export function planMoonCorrection(vehicle, config, { targetPeriapsisAltitude = 30_000, leadTime = 120 } = {}) {
  if (!config.moon) return null;
  const { planet } = config;
  const at = propagateKepler(vehicle.position, vehicle.velocity, planet.mu, leadTime);
  const prograde = vec3.normalize(at.velocity);
  const normal = vec3.normalize(vec3.cross(at.position, at.velocity));
  const radial = vec3.normalize(vec3.cross(at.velocity, normal));
  const evaluate = (dp, dr) => {
    const after = vec3.add(at.velocity, vec3.add(vec3.scale(prograde, dp), vec3.scale(radial, dr)));
    const encounter = predictMoonEncounter(at.position, after, vehicle.time + leadTime, config);
    // Δv 가 작을수록 조금 더 좋게 (같은 근접 고도면 적은 연료)
    const miss = encounter ? Math.abs(encounter.periapsisAltitude - targetPeriapsisAltitude) + Math.hypot(dp, dr) * 10 : Infinity;
    return { dp, dr, encounter, miss };
  };
  let best = evaluate(0, 0);
  // 진행 방향 → 방사 방향 순으로 범위를 좁혀 가며 찾는다
  let span = 30;
  for (let round = 0; round < 8; round++) {
    for (let k = -10; k <= 10; k++) {
      const c = evaluate(best.dp + (span * k) / 10, best.dr);
      if (c.miss < best.miss) best = c;
    }
    for (let k = -10; k <= 10; k++) {
      const c = evaluate(best.dp, best.dr + (span * k) / 10);
      if (c.miss < best.miss) best = c;
    }
    span /= 3;
  }
  if (!best.encounter) return null;
  return { time: vehicle.time + leadTime, prograde: best.dp, radial: best.dr, encounter: best.encounter };
}
