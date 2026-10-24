/**
 * 로켓 비행 물리 한 스텝 계산
 * ------------------------------------------------------------
 * 고정 시간 간격 dt 마다 호출되어 로켓 상태를 갱신한다.
 *
 * 힘과 속도 변화
 *   - 추력: 연료를 Δm 만큼 태우면 치올콥스키 로켓 방정식
 *           Δv = Isp · g₀ · ln(m₀ / (m₀ − Δm)) 만큼 기수 방향 속도가 늘어난다.
 *           연료 소모율 ṁ = F / (Isp · g₀).
 *   - 중력: g = μ / r², 행성 중심 방향. 달 중력권 안에서는 달 중심 방향 (celestialBodies.js).
 *   - 항력: D = ½ρv²·Cd·A, 상대 속도 반대 방향. 낙하산을 펼쳤으면 낙하산 항력을 더한다.
 *   - 재진입 가열: 열유속으로 표면 온도를 올리고, 앞면 부품의 한계를 넘으면 파손 (heating.js).
 * 적분 방식: 도약법(leapfrog, 속도 베를레) — 중력은 스텝 처음과 끝에서 반씩 나눠 적용하는
 *           2차 정확도·심플렉틱 방식이라 궤도를 오래 돌아도 오차가 거의 쌓이지 않는다.
 *           추력·항력·RCS 는 스텝 처음에 한 번에 적용한다.
 */
import { vec3, quat } from './vectorMath.js';
import { gravityMagnitudeAtRadius } from './gravity.js';
import { gravityAt, bodyAt, referenceBodyAt } from './celestialBodies.js';
import { stepAttitude } from './attitudeDynamics.js';
import { airDensity, dynamicPressure, dragForce, circularArea } from './aerodynamics.js';
import { resolveGroundContact } from './terrain.js';
import { evaluateTouchdown } from './touchdown.js';
import { heatFlux, stepSkinTemperature, thermalLimit, stepParachuteArea } from './heating.js';

/** 로켓 로컬 기수 방향 (+Y) */
const NOSE_LOCAL = [0, 1, 0];

/** 현재 로켓에 붙어 있는 단(현재 단과 그 위 단들)의 총질량 (kg) */
export function rocketMass(state) {
  let mass = 0;
  for (let i = state.currentStage; i < state.stages.length; i++) {
    mass += state.stages[i].dryMass + state.stages[i].fuel;
  }
  return mass;
}

/** 현재 점화 대상 단의 최대 추력 (N) */
export function maxThrust(state) {
  const stage = state.stages[state.currentStage];
  return stage ? stage.maxThrust : 0;
}

/** 현재 단에 연료가 남아 있는지 */
export function hasFuel(state) {
  const stage = state.stages[state.currentStage];
  return Boolean(stage) && stage.fuel > 0;
}

/** 지금 실제로 내고 있는 추력 (N). 연료가 없거나 파손되면 0. */
export function currentThrust(state) {
  if (!state.engineOn || state.destroyed || !hasFuel(state)) return 0;
  return state.throttle * maxThrust(state);
}

/** 로켓 기수가 가리키는 월드 방향 단위벡터 */
export function noseDirection(state) {
  return quat.rotate(state.orientation, NOSE_LOCAL);
}

/** 해수면 기준 고도 (m) */
export function altitude(state, config) {
  return vec3.length(state.position) - config.planet.radius;
}

/** 항력 기준 단면적: 붙어 있는 단 중 가장 굵은 부품의 원 면적 (m²) */
export function rocketDragArea(state) {
  let radius = 0;
  for (let i = state.currentStage; i < state.stages.length; i++) {
    radius = Math.max(radius, state.stages[i].maxRadius);
  }
  return circularArea(radius);
}

/**
 * 추력 대 중량비 TWR = 추력 / (현재 질량 × 현재 위치의 중력가속도)
 * 중력은 지금 기준 천체(행성 또는 달)의 것을 쓴다.
 * @param {number} thrust 추력 (N)
 */
export function thrustToWeight(state, config, thrust) {
  const body = referenceBodyAt(state.position, state.time ?? 0, config);
  const g = gravityMagnitudeAtRadius(vec3.length(vec3.sub(state.position, body.position)), body.mu);
  const mass = rocketMass(state);
  return mass > 0 && g > 0 ? thrust / (mass * g) : 0;
}

/** 배기 속도 vₑ = Isp · g₀ (m/s) */
export function exhaustVelocity(isp, config) {
  return isp * config.constants.standardGravity;
}

/**
 * 물리 한 스텝 진행 (state 를 직접 갱신한다)
 * @param {object} state createRocketState 로 만든 상태
 * @param {object} config PHYSICS_CONFIG
 * @param {number} dt 시간 간격 (s)
 */
export function stepFlight(state, config, dt) {
  if (state.destroyed || state.docked) {
    // 파손됐거나 다른 비행체에 도킹해 함께 움직이는 동안은 스스로 물리를 진행하지 않는다
    // (도킹 중 위치·속도는 도킹 모듈이 상대 비행체에 맞춰 갱신한다)
    state.time += dt;
    return;
  }
  stepThrottle(state, config.controls, dt);
  stepAttitude(state, config.controls, dt);
  // 낙하산: 펼친 면적을 늘리고, 펼친 동안 기체를 낙하산 아래로 매단다 (기수가 진행 반대쪽)
  const chuteArea = config.parachute && !state.landed ? stepParachuteArea(state, altitude(state, config), dt, config.parachute) : 0;
  if (chuteArea > 0) hangUnderParachute(state, config.parachute, dt);

  const nose = noseDirection(state);
  const massBefore = rocketMass(state);

  // ── 1) 연료 소모와 추력에 의한 속도 변화 (치올콥스키) ───────
  const burn = burnFuel(state, config, dt);
  const thrustDeltaV = burn.fuelBurned > 0
    ? exhaustVelocity(burn.isp, config) * Math.log(massBefore / (massBefore - burn.fuelBurned))
    : 0;

  // ── 2) 중력과 항력 ─────────────────────────────────────────
  const alt = altitude(state, config);
  const density = airDensity(alt, config.atmosphere);
  // 열 차폐막이 앞면이면 뭉툭한 면의 큰 항력 계수를 쓴다
  const bodyCd = state.heatShielded && config.heating ? config.heating.shieldDragCoefficient : config.aerodynamics.dragCoefficient;
  let drag = dragForce(state.velocity, density, bodyCd, rocketDragArea(state));
  if (chuteArea > 0) drag = vec3.add(drag, dragForce(state.velocity, density, config.parachute.dragCoefficient, chuteArea));
  const massAvg = massBefore - burn.fuelBurned / 2;
  const t0 = state.time;
  const gravityStart = gravityAt(state.position, t0, config);
  let otherAcceleration = vec3.addScaled(gravityStart, drag, 1 / massAvg);
  // RCS 평행이동 (지면에 서 있을 때는 쓰지 않는다)
  const rcs = state.landed ? [0, 0, 0] : rcsAcceleration(state, config, dt, massAvg);
  otherAcceleration = vec3.add(otherAcceleration, rcs);
  // 이번 스텝에 엔진·RCS 가 실제로 준 속도 변화 (기동 노드 남은 Δv 계산용)
  state.lastDeltaV = vec3.add(vec3.scale(nose, thrustDeltaV), vec3.scale(rcs, dt));

  // 몸으로 느끼는 가속도(중력 제외: 추력·항력·RCS, 지면 위에서는 지면 반력) — G 계기용 (m/s²)
  state.properAcceleration = vec3.length(vec3.add(vec3.scale(nose, thrustDeltaV / dt), vec3.sub(otherAcceleration, gravityStart)));

  if (state.landed) {
    // 지면에 서 있을 때는 지면 반력이 아래로 누르는 힘을 받쳐 준다.
    // 위쪽 방향 알짜 가속도(서 있는 천체 기준)가 0 이하(= TWR ≤ 1)이면 움직이지 않는다.
    const surfaceBody = bodyAt(state.landedOn === 'moon' ? 'moon' : 'planet', t0, config);
    const up = vec3.normalize(vec3.sub(state.position, surfaceBody.position));
    const relativeAcceleration = vec3.sub(otherAcceleration, surfaceBody.acceleration);
    const upwardAcceleration = vec3.dot(nose, up) * (thrustDeltaV / dt) + vec3.dot(relativeAcceleration, up);
    if (upwardAcceleration <= 0) {
      if (state.landedOn === 'moon') {
        // 달 표면에 선 채로 달과 함께 움직인다
        const moonNext = bodyAt('moon', t0 + dt, config);
        state.position = vec3.add(moonNext.position, state.surfaceOffset);
        state.velocity = vec3.clone(moonNext.velocity);
      } else {
        state.velocity = [0, 0, 0];
      }
      state.liftoffBlocked = burn.thrust > 0;
      state.dynamicPressure = 0;
      state.properAcceleration = vec3.length(vec3.sub(gravityStart, surfaceBody.acceleration)); // 지면 반력 = 중력
      state.time += dt;
      return;
    }
    state.landed = false;
    state.liftoffBlocked = false;
  }

  // ── 3) 도약법 적분 ────────────────────────────────────────
  // 반 스텝: 중력 절반 + 추력·항력·RCS 전부 → 위치 이동 → 새 위치 중력 절반
  const nonGravity = vec3.sub(otherAcceleration, gravityStart); // 항력 + RCS
  let velocityHalf = vec3.addScaled(state.velocity, nose, thrustDeltaV);
  velocityHalf = vec3.addScaled(velocityHalf, nonGravity, dt);
  velocityHalf = vec3.addScaled(velocityHalf, gravityStart, dt / 2);
  state.position = vec3.addScaled(state.position, velocityHalf, dt);
  state.velocity = vec3.addScaled(velocityHalf, gravityAt(state.position, t0 + dt, config), dt / 2);
  state.time += dt;

  // ── 4) 동압과 Max-Q 파손 판정 ───────────────────────────
  const densityAfter = airDensity(altitude(state, config), config.atmosphere);
  state.dynamicPressure = dynamicPressure(densityAfter, vec3.length(state.velocity));
  state.maxDynamicPressureSeen = Math.max(state.maxDynamicPressureSeen, state.dynamicPressure);
  if (state.dynamicPressure > config.aerodynamics.maxDynamicPressure) {
    destroy(state, `Max-Q 초과: 동압 ${Math.round(state.dynamicPressure).toLocaleString('ko-KR')} Pa > 한계 ${config.aerodynamics.maxDynamicPressure.toLocaleString('ko-KR')} Pa`);
    return;
  }

  // ── 4-2) 재진입 가열 ─────────────────────────────────────
  if (config.heating && updateHeating(state, config, densityAfter, dt)) return;

  // ── 5) 지면 접촉과 착지 판정 ────────────────────────────
  const orientationAtContact = state.orientation;
  const contact = resolveGroundContact(state, config, state.time);
  if (contact) {
    state.landed = true;
    state.landedOn = contact.bodyId; // 'planet' | 'moon'
    state.surfaceOffset = contact.surfaceOffset; // 천체 중심 → 접지 위치
    state.dynamicPressure = 0;
    if (contact.impactSpeed > 0) state.lastImpactSpeed = contact.impactSpeed;
    // 착지 순간의 (그 천체 표면 기준) 속도·기울기를 기록하고, 기준을 넘으면 폭발(파손) 처리
    const touchdown = evaluateTouchdown(contact.surfaceOffset, contact.impactVelocity, orientationAtContact, config.landing);
    state.touchdown = { ...touchdown, time: state.time, position: vec3.clone(state.position), bodyId: contact.bodyId };
    if (!touchdown.safe) destroy(state, `지면 충돌: ${touchdown.failures.join(', ')}`);
  }
}

/**
 * RCS(자세제어 추진기) 평행이동 가속도 (m/s²). 연료를 쓴다.
 * 로컬 축마다 −1~1 입력 × 최대 추력, 연료 소모율 = Σ|F| / (Isp·g₀).
 */
export function rcsAcceleration(state, config, dt, mass) {
  const t = state.controls.translate;
  const stage = state.stages[state.currentStage];
  if (!state.rcsEnabled || !t || state.destroyed || state.aborted || !stage || stage.fuel <= 0) return [0, 0, 0];
  const magnitude = Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2]);
  if (magnitude === 0) return [0, 0, 0];
  const { thrust, isp } = config.rcs;
  const fuelNeeded = (magnitude * thrust * dt) / exhaustVelocity(isp, config);
  const fraction = Math.min(1, stage.fuel / fuelNeeded);
  stage.fuel = Math.max(0, stage.fuel - fuelNeeded * fraction);
  const forceLocal = [t[0] * thrust * fraction, t[1] * thrust * fraction, t[2] * thrust * fraction];
  return vec3.scale(quat.rotate(state.orientation, forceLocal), 1 / mass);
}

/**
 * 이번 스텝에 태울 연료를 계산하고 현재 단의 연료를 줄인다.
 * 남은 연료가 한 스텝 소모량보다 적으면 남은 만큼만 태운다.
 * @returns {{fuelBurned:number, thrust:number, isp:number}}
 */
function burnFuel(state, config, dt) {
  const stage = state.stages[state.currentStage];
  const thrust = currentThrust(state);
  if (thrust <= 0 || !stage || stage.isp <= 0) return { fuelBurned: 0, thrust: 0, isp: 0 };
  const massFlow = thrust / exhaustVelocity(stage.isp, config); // ṁ (kg/s)
  const fuelBurned = Math.min(stage.fuel, massFlow * dt);
  stage.fuel -= fuelBurned;
  if (stage.fuel < 1e-9) stage.fuel = 0;
  return { fuelBurned, thrust: thrust * (fuelBurned / (massFlow * dt)), isp: stage.isp };
}

/**
 * 표면 온도 갱신. 한계를 넘으면 파손하고 true 를 돌려준다.
 * 앞면 반지름은 붙어 있는 가장 굵은 부품의 반지름.
 */
function updateHeating(state, config, density, dt) {
  const h = config.heating;
  let radius = 0;
  for (let i = state.currentStage; i < state.stages.length; i++) radius = Math.max(radius, state.stages[i].maxRadius);
  state.heatFlux = heatFlux(density, vec3.length(state.velocity), radius, h);
  state.skinTemperature = stepSkinTemperature(state.skinTemperature, state.heatFlux, dt, h);
  state.maxSkinTemperature = Math.max(state.maxSkinTemperature, state.skinTemperature);
  const { limit, shielded } = thermalLimit(state, noseDirection(state), state.velocity, h);
  state.thermalLimit = limit;
  state.heatShielded = shielded;
  if (state.skinTemperature > limit) {
    destroy(state, `과열: 표면 온도 ${Math.round(state.skinTemperature).toLocaleString('ko-KR')} K > 한계 ${Math.round(limit).toLocaleString('ko-KR')} K${shielded ? '' : ' (열 차폐막이 앞면이 아님)'}`);
    return true;
  }
  return false;
}

/** 낙하산에 매달린 기체: 기수를 진행 반대 방향(낙하산 쪽)으로 최대 alignRate 로 돌린다 */
function hangUnderParachute(state, parachuteConfig, dt) {
  const speed = vec3.length(state.velocity);
  if (speed < 0.5) return;
  const nose = noseDirection(state);
  const target = vec3.scale(state.velocity, -1 / speed);
  const angle = Math.acos(Math.max(-1, Math.min(1, vec3.dot(nose, target))));
  if (angle < 1e-4) return;
  let axis = vec3.cross(nose, target);
  if (vec3.length(axis) < 1e-9) axis = quat.rotate(state.orientation, [1, 0, 0]);
  const step = Math.min(angle, ((parachuteConfig.alignRateDeg * Math.PI) / 180) * dt);
  // 월드 축 회전은 왼쪽에 곱한다: q ← Δq · q
  state.orientation = quat.normalize(quat.multiply(quat.fromAxisAngle(vec3.normalize(axis), step), state.orientation));
  state.angularVelocity = vec3.scale(state.angularVelocity, 0.9);
}

/** 기체 파손: 엔진을 끄고 이후 물리 갱신을 멈춘다 */
function destroy(state, reason) {
  state.destroyed = true;
  state.destroyedReason = reason;
  state.engineOn = false;
  state.throttle = 0;
}

/**
 * Shift/Ctrl 을 누르고 있는 동안 스로틀을 설정된 속도로 올리거나 내린다 (0~1 범위).
 * 스로틀을 올리면 엔진이 점화된다. 비상 중단 후에는 엔진을 다시 켤 수 없다.
 */
export function stepThrottle(state, controlsConfig, dt) {
  if (state.aborted) {
    state.throttle = 0;
    state.engineOn = false;
    return;
  }
  const direction = (state.controls.throttleUp ? 1 : 0) - (state.controls.throttleDown ? 1 : 0);
  if (direction === 0) return;
  state.throttle = clamp01(state.throttle + direction * controlsConfig.throttleRate * dt);
  if (direction > 0) state.engineOn = true;
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
