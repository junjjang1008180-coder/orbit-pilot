/**
 * 우주 왕복선 자동 귀환·착륙 (G — 궤도선일 때)
 * ------------------------------------------------------------
 * 단계
 *   etSep       : 외부 탱크가 붙어 있으면 분리
 *   deorbitWait : 궤도에서 "지금 역추진하면 어디로 내려오는지" 를 미리 계산(활공 예측)해,
 *                 활공 진입점에 맞는 순간을 기다린다 (그동안 역진행 자세, 시간 가속 가능)
 *   deorbitBurn : 궤도 조종 엔진으로 역추진 → 근지점을 대기 안으로
 *   glideEntry  : 받음각 40°(속도가 줄면 점점 낮춤)로 배 쪽 타일을 앞세워 재진입.
 *                 뱅크(기울기) 크기로 거리를 맞춘다 — 매초 활공 예측으로 진입점에 닿는 뱅크를 찾는다.
 *                 뱅크 방향은 활주로 중심선에서 벗어난 쪽 반대로 (뱅크 뒤집기)
 *   glideApproach: 활공각 18° 직선 경로를 따라 겨냥점으로. 위아래는 받음각, 좌우는 뱅크, 속도는 에어브레이크.
 *                 450 m 부터 하강을 늦추고(플레어), 400 m 에서 바퀴를 내린다
 *   rollout     : 착지 후 감속 낙하산·브레이크, 앞바퀴로 중심선 유지 → 멈추면 끝
 * 자세는 "받음각 α · 뱅크 φ" 로 정하고(진행 방향 기준), 자세 제어기로 기수·윗면을 맞춘다.
 */
import { vec3 } from '../physics/vectorMath.js';
import { airDensity } from '../physics/aerodynamics.js';
import { gravityAcceleration } from '../physics/gravity.js';
import { runwayFrame, runwayCoords, runwayList, getRunway, nearestRunway } from '../landing/runway.js';
import { steerAttitude, steerToward, noseOf } from './attitudeController.js';
import { hasFuel, rocketMass } from '../physics/flightPhysics.js';

const DEG = Math.PI / 180;
const BEST_GLIDE_ALPHA = 12 * DEG; // 양항비가 가장 큰 받음각 (CL = 1.2·sin2α, CD = 0.06 + 1.4·sin²α 기준)

/** 받음각 alpha · 뱅크 bank (rad) 로 날 때 기수·윗면 방향 */
export function flightAttitude(position, velocity, alpha, bank) {
  const v = vec3.normalize(velocity);
  const up = vec3.normalize(position);
  let n0 = vec3.addScaled(up, v, -vec3.dot(up, v));
  if (vec3.length(n0) < 1e-6) n0 = [1, 0, 0];
  n0 = vec3.normalize(n0);
  const right = vec3.normalize(vec3.cross(v, n0));
  const lift = vec3.add(vec3.scale(n0, Math.cos(bank)), vec3.scale(right, Math.sin(bank)));
  return {
    nose: vec3.add(vec3.scale(v, Math.cos(alpha)), vec3.scale(lift, Math.sin(alpha))),
    top: vec3.sub(vec3.scale(lift, Math.cos(alpha)), vec3.scale(v, Math.sin(alpha))),
  };
}

/** 재진입 받음각 일정: 빠를 때 40°, 느려지면 점점 낮춰 활공 (rad) */
export function entryAlpha(config, speed) {
  const top = config.shuttle.autopilot.entryAlphaDeg;
  const f = Math.max(0, Math.min(1, (speed - 300) / 1500));
  return (10 + (top - 10) * f) * DEG;
}

/**
 * 질점 활공 예측: 받음각 일정·뱅크 고정으로 날아 고도 targetAltitude 에 닿을 때(내려가는 중) 위치
 * @param {object|null} [runway] 활주로 좌표 기준 (빼면 첫 번째 활주로)
 * @returns {{along:number, cross:number, time:number, reached:boolean, position:number[]}}
 */
export function predictGlide(config, position, velocity, mass, bankDeg, targetAltitude, maxTime = 4_000, runway = null) {
  const sh = config.shuttle;
  const R = config.planet.radius;
  let p = vec3.clone(position);
  let v = vec3.clone(velocity);
  let t = 0;
  const bank = bankDeg * DEG;
  while (t < maxTime) {
    const r = vec3.length(p);
    const alt = r - R;
    const up = vec3.scale(p, 1 / r);
    if (alt <= targetAltitude && vec3.dot(v, up) < 0) {
      const rc = runwayCoords(config, p, runway);
      return { along: rc.along, cross: rc.cross, time: t, reached: true, position: p };
    }
    if (alt < 0) break;
    const rho = airDensity(alt, config.atmosphere);
    const dt = rho > 1e-7 ? 1 : 4;
    let a = gravityAcceleration(p, config.planet.mu);
    if (rho > 0) {
      const speed = vec3.length(v);
      const vHat = vec3.scale(v, 1 / speed);
      const alpha = entryAlpha(config, speed);
      const cl = sh.liftSlope * Math.sin(2 * alpha);
      const cd = sh.zeroLiftDrag + sh.inducedDrag * Math.sin(alpha) ** 2;
      // 뱅크를 좌우로 뒤집어 가며 날므로 옆 성분은 상쇄된다고 보고, 위쪽 성분(cos 뱅크)만 쓴다
      const n0 = vec3.normalize(vec3.addScaled(up, vHat, -vec3.dot(up, vHat)));
      const qs = (0.5 * rho * speed * speed * sh.wingArea) / mass;
      a = vec3.add(a, vec3.add(vec3.scale(n0, qs * cl * Math.cos(bank)), vec3.scale(vHat, -qs * cd)));
    }
    v = vec3.addScaled(v, a, dt);
    p = vec3.addScaled(p, v, dt);
    t += dt;
  }
  const rc = runwayCoords(config, p, runway);
  return { along: rc.along, cross: rc.cross, time: t, reached: false, position: p };
}

function setThrottle(vehicle, value) {
  vehicle.throttle = Math.max(0, Math.min(1, value));
  vehicle.engineOn = vehicle.throttle > 0;
}

/**
 * @param {object} vehicle 궤도선(또는 외부 탱크가 붙은 왕복선)
 * @param {object} ctx 자동조종 맥락 (config, dt, orbit(), separateStage, nextStageWinged, deployParachute, stopWarp, announce, stop)
 */
export function shuttleLandingProgram(vehicle, ctx) {
  const { config } = ctx;
  const sa = config.shuttle.autopilot;
  const ap = vehicle.autopilot;
  const a = config.autopilot;

  // 0) 외부 탱크 분리
  if (ctx.nextStageWinged) {
    setThrottle(vehicle, 0);
    ctx.separateStage();
    ctx.announce('외부 탱크 분리 — 궤도선만 남았어요');
    return {};
  }

  // 목표 활주로: 역추진 때 정해 고정한다. 정하기 전에는 고른 활주로(O) 또는 가장 가까운 활주로
  const runway = ap.runwayId ? getRunway(config, ap.runwayId) : ctx.targetRunwayId ? getRunway(config, ctx.targetRunwayId) : nearestRunway(config, vehicle.position);
  const f = runwayFrame(config, runway);
  const aimAlong = -f.halfLength + sa.aimPointPastThreshold; // 겨냥점 (활주로 좌표)
  const slope = Math.tan(sa.glideSlopeDeg * DEG);
  const interfaceAlong = aimAlong - sa.interfaceAltitude / slope; // 활공 진입점
  const rc = runwayCoords(config, vehicle.position, runway);
  const up = vec3.normalize(vehicle.position);
  const speed = vec3.length(vehicle.velocity);
  const vs = vec3.dot(vehicle.velocity, up);
  const mass = rocketMass(vehicle);

  // 5) 착지 후 활주
  if (vehicle.landed) {
    vehicle.speedbrakeCommand = 1;
    if (!vehicle.rolling) {
      vehicle.autoBrake = false;
      vehicle.speedbrakeCommand = 0;
      ctx.stop('착륙 완료! 활주로에 멈췄어요');
      return {};
    }
    ap.phase = 'rollout';
    if (vehicle.parachute === 'packed' && speed < ctx.parachuteDeploySpeed) ctx.deployParachute();
    if (!ap.touchdownTime) ap.touchdownTime = vehicle.time;
    vehicle.autoBrake = vehicle.time - ap.touchdownTime > 2 && speed < 90;
    const crossRate = vec3.dot(vehicle.velocity, f.north);
    const yaw = Math.max(-1, Math.min(1, 0.02 * rc.cross + 0.4 * crossRate));
    return { attitude: { pitch: 0, yaw, roll: 0 } };
  }

  if (!ap.phase) {
    const orbit = ctx.orbit();
    // 근지점이 역추진 목표보다 한참 높으면(대기 끝을 스치는 궤도도) 역추진부터 — 아니면 몇 바퀴를 돌며 못 내려온다
    const needsDeorbit = orbit.periapsisAltitude > sa.deorbitPeriapsisAltitude + 15_000 && rc.height > config.atmosphere.topAltitude - 10_000;
    ap.phase = needsDeorbit ? 'deorbitWait' : rc.height > sa.interfaceAltitude ? 'glideEntry' : 'glideApproach';
    ap.bank = 30;
    ap.bankSign = 1;
    ap.nextPredict = 0;
  }

  // 1) 역추진 시점 기다리기: "지금 역추진하면" 내려오는 곳을 예측
  if (ap.phase === 'deorbitWait') {
    setThrottle(vehicle, 0);
    const retro = vec3.scale(vehicle.velocity, -1 / Math.max(speed, 1e-6));
    if (vehicle.time >= ap.nextPredict) {
      ap.nextPredict = vehicle.time + 2;
      const r = vec3.length(vehicle.position);
      const rp = config.planet.radius + sa.deorbitPeriapsisAltitude;
      const vNeeded = Math.sqrt(config.planet.mu * (2 / r - 2 / (r + rp)));
      const hVel = vec3.addScaled(vehicle.velocity, up, -vs);
      const after = vec3.scale(vec3.normalize(hVel), vNeeded);
      const pred = predictGlide(config, vehicle.position, after, mass, 30, sa.interfaceAltitude);
      // 후보 활주로마다 "지금 역추진하면 활공 진입점을 지났는지" — 먼저 맞아떨어지는 활주로로 간다
      const candidates = ctx.targetRunwayId ? [getRunway(config, ctx.targetRunwayId)] : runwayList(config);
      ap.lastErrs ??= {};
      for (const cand of candidates) {
        const err = runwayCoords(config, pred.position, cand).along - interfaceAlong;
        const prev = ap.lastErrs[cand.id];
        if (pred.reached && Math.abs(err) < 400_000) {
          if (err > -80_000 && err < 0) ctx.stopWarp?.();
          if (prev !== undefined && prev < 0 && err >= 0 && ap.phase === 'deorbitWait') {
            ap.phase = 'deorbitBurn';
            ap.runwayId = cand.id;
            ctx.announce(`역추진 시작 — 근지점 ${Math.round(sa.deorbitPeriapsisAltitude / 1000)} km 로, 목표 ${cand.name}`);
          }
        }
        ap.lastErrs[cand.id] = pred.reached ? err : undefined;
      }
    }
    return { attitude: steerToward(vehicle, retro, a) };
  }

  // 2) 역추진
  if (ap.phase === 'deorbitBurn') {
    const retro = vec3.scale(vehicle.velocity, -1 / Math.max(speed, 1e-6));
    const orbit = ctx.orbit();
    if (orbit.periapsisAltitude <= sa.deorbitPeriapsisAltitude || !hasFuel(vehicle)) {
      setThrottle(vehicle, 0);
      ap.phase = 'glideEntry';
      ctx.announce('역추진 완료 — 배를 앞세워 재진입해요 (받음각 40°)');
    } else {
      setThrottle(vehicle, vec3.dot(noseOf(vehicle), retro) > 0.995 ? 1 : 0);
    }
    return { attitude: steerToward(vehicle, retro, a) };
  }

  // 3) 재진입: 받음각 일정 + 뱅크로 거리 조절
  if (ap.phase === 'glideEntry') {
    setThrottle(vehicle, 0);
    if (!ap.runwayId) {
      // 이미 대기 속에서 켰으면: 예측 착지점에서 진입점까지 가장 알맞은 활주로를 고른다
      const pred = predictGlide(config, vehicle.position, vehicle.velocity, mass, 30, sa.interfaceAltitude);
      const candidates = ctx.targetRunwayId ? [getRunway(config, ctx.targetRunwayId)] : runwayList(config);
      let best = candidates[0];
      let bestErr = Infinity;
      for (const cand of candidates) {
        const err = Math.abs(runwayCoords(config, pred.position, cand).along - interfaceAlong);
        if (err < bestErr) {
          bestErr = err;
          best = cand;
        }
      }
      ap.runwayId = best.id;
      return {};
    }
    vehicle.speedbrakeCommand = 0;
    if (rc.height < sa.interfaceAltitude) {
      ap.phase = 'glideApproach';
      ctx.announce('활공 접근 — 활공각 18° 로 활주로를 향해요');
    } else if (vehicle.time >= ap.nextPredict && rc.height < config.atmosphere.topAltitude + 20_000) {
      ap.nextPredict = vehicle.time + 1;
      // 뱅크 b 와 b+10° 의 예측으로 진입점에 맞는 뱅크를 찾는다 (뉴턴 방법 한 걸음)
      const b = ap.bank;
      const p1 = predictGlide(config, vehicle.position, vehicle.velocity, mass, b, sa.interfaceAltitude, 4_000, runway);
      const p2 = predictGlide(config, vehicle.position, vehicle.velocity, mass, b + 10, sa.interfaceAltitude, 4_000, runway);
      const e1 = p1.along - interfaceAlong;
      const slopeErr = (p2.along - p1.along) / 10;
      let next = b;
      if (Math.abs(slopeErr) > 1) next = b - e1 / slopeErr;
      else next = e1 > 0 ? b + 10 : b - 10;
      ap.bank = Math.max(0, Math.min(sa.maxEntryBankDeg, b + Math.max(-15, Math.min(15, next - b))));
    }
    // 뱅크 방향: 곧 벗어날 거리(지금 벗어난 거리 + 옆 속도 × 30 초)가 허용 폭을 넘으면 반대쪽으로 뒤집는다.
    // 허용 폭은 느려질수록 좁아져서 활공 진입점에서는 중심선 가까이 온다
    const crossMiss = rc.cross + 30 * vec3.dot(vehicle.velocity, f.north);
    const deadband = 800 + 3_000 * Math.max(0, Math.min(1, (speed - 400) / 1800));
    if (crossMiss > deadband) ap.bankSign = 1; // 북쪽으로 벗어남 → 오른쪽(남쪽) 뱅크
    else if (crossMiss < -deadband) ap.bankSign = -1;
    const air = airDensity(rc.height, config.atmosphere) > 1e-6;
    const bank = air ? ap.bank * ap.bankSign * DEG : 0;
    const att = flightAttitude(vehicle.position, vehicle.velocity, entryAlpha(config, speed), bank);
    return { attitude: steerAttitude(vehicle, att.nose, att.top, a) };
  }

  // 4) 활공 접근 · 플레어 (활주로를 아직 안 정했으면 지금 가장 가까운 곳)
  if (!ap.runwayId) ap.runwayId = runway.id;
  ap.phase = rc.height < sa.preflareAltitude ? 'flare' : 'glideApproach';
  setThrottle(vehicle, 0);
  const toAim = aimAlong - rc.along; // 겨냥점까지 (지나면 음수)
  const hPath = Math.max(0, toAim) * slope;
  const hSpeed = Math.sqrt(Math.max(0, speed * speed - vs * vs));
  let vsWanted;
  // 플레어: 고도에 비례해 하강을 늦추고(고도 × 0.2 m/s), 마지막은 2.2 m/s 로 닿는다 (오래 끌면 속도를 잃는다)
  if (rc.height < sa.preflareAltitude) vsWanted = -Math.max(sa.flareMinSink, rc.height * sa.flareRate);
  else vsWanted = -hSpeed * slope + 0.08 * (hPath - rc.height);
  vsWanted = Math.max(-hSpeed * 0.5, Math.min(5, vsWanted));
  // 필요한 위쪽 가속도 → 양력 → 받음각
  const r = vec3.length(vehicle.position);
  const gEff = config.planet.mu / (r * r) - (hSpeed * hSpeed) / r;
  const crossRate = vec3.dot(vehicle.velocity, f.north);
  const alongRate = vec3.dot(vehicle.velocity, f.east);
  // 좌우: 연장 중심선 위 앞쪽 점을 향해 방향을 맞춘다 (멀리 벗어나 있어도 부드럽게 돌아 들어온다)
  const lead = Math.max(3_000, Math.min(12_000, Math.abs(rc.cross) * 1.5 + 0.25 * Math.max(0, toAim)));
  const courseWanted = Math.atan2(-rc.cross, lead); // 동쪽 기준, 북쪽이 +
  const course = Math.atan2(crossRate, alongRate);
  let courseErr = courseWanted - course;
  courseErr = Math.atan2(Math.sin(courseErr), Math.cos(courseErr));
  const turnRate = Math.max(-0.12, Math.min(0.12, 0.35 * courseErr)); // rad/s, + = 북쪽(왼쪽)으로
  const latAcc = -turnRate * hSpeed; // + = 오른쪽(남쪽)
  const bankLimit = (rc.height < 60 ? 8 : rc.height < 600 ? 25 : 45) * DEG;
  const bank = Math.max(-bankLimit, Math.min(bankLimit, Math.atan2(latAcc, Math.max(1, gEff))));
  const upAcc = gEff + (rc.height < sa.preflareAltitude ? 1.2 : 0.6) * (vsWanted - vs);
  const q = 0.5 * airDensity(rc.height, config.atmosphere) * speed * speed;
  const cl = (mass * upAcc) / Math.max(1, q * config.shuttle.wingArea * Math.cos(bank));
  let alpha = 0.5 * Math.asin(Math.max(-1, Math.min(1, cl / config.shuttle.liftSlope)));
  const flaring = rc.height < sa.preflareAltitude;
  // 경로보다 많이 낮으면 올라가려 하지 말고 가장 멀리 나는 받음각(양항비 최대)으로 경로를 만날 때까지
  const low = !flaring && rc.height < hPath - 300;
  if (low) alpha = BEST_GLIDE_ALPHA;
  alpha = Math.max(0, Math.min((flaring ? 16 : 14) * DEG, alpha));
  // 속도: 빠르면 에어브레이크 (플레어 중에는 접음)
  vehicle.speedbrakeCommand = low || rc.height < 60 ? 0 : Math.max(0, Math.min(1, (speed - sa.approachSpeedMin) / (sa.approachSpeedMax - sa.approachSpeedMin)));
  if (!vehicle.gearDown && rc.height < sa.gearAltitude) {
    vehicle.gearDown = true;
    ctx.announce('착륙 바퀴 내림');
  }
  const att = flightAttitude(vehicle.position, vehicle.velocity, alpha, bank);
  return { attitude: steerAttitude(vehicle, att.nose, att.top, a) };
}
