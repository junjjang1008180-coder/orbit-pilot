/**
 * 비행 가이드 (직접 조종 도우미)
 * ------------------------------------------------------------
 * 지금 상태를 보고 "무엇을 하면 되는지" 와 기수를 둘 방향을 알려 준다. 기체를 조종하지는 않는다.
 * 자동 궤도 진입과 같은 생각으로 계산한다:
 *   상승: 고도에 따라 기울이되 원지점까지 남은 시간이 짧으면 덜 기울임 → 목표 피치
 *   원지점이 85 km 에 닿으면 엔진을 끄고 → 원지점 근처에서 수평으로 점화해 근지점을 70 km 위로
 * 재진입·달 근처·부스터 조종일 때도 알맞은 안내를 준다.
 */
import { vec3 } from '../physics/vectorMath.js';
import { localFrame } from '../physics/referenceFrame.js';
import { hasFuel } from '../physics/flightPhysics.js';
import { attachedParachute } from '../physics/heating.js';
import { formatDistance } from '../ui/format.js';

const km = (m) => (Number.isFinite(m) ? `${Math.round(m / 1000)} km` : '∞');
const sec = (s) => `${Math.max(0, Math.round(s))}초`;

/** 고도 위로 기울인 방향 (수직에서 angleDeg 만큼 toward 쪽으로) */
function tilted(frame, angleDeg, toward) {
  const a = (angleDeg * Math.PI) / 180;
  return vec3.add(vec3.scale(frame.up, Math.cos(a)), vec3.scale(toward, Math.sin(a)));
}

/** 지금 피치(°)와 목표 피치(°)를 비교한 키 안내 */
function pitchAdvice(now, wanted) {
  if (now > wanted + 3) return `<kbd>W</kbd> 로 기수를 내리세요 (목표 ${Math.round(wanted)}° · 지금 ${Math.round(now)}°)`;
  if (now < wanted - 3) return `<kbd>S</kbd> 로 기수를 올리세요 (목표 ${Math.round(wanted)}° · 지금 ${Math.round(now)}°)`;
  return `좋아요, 기수 피치 ${Math.round(now)}° 유지`;
}

/**
 * @param {import('../core/simulation.js').FlightSimulation} sim (읽기 전용)
 * @param {object} t 텔레메트리 (조종 중인 비행체)
 * @returns {null | {text:string, direction:number[]|null, level?:string}}
 */
export function computeGuide(sim, t) {
  const c = sim.config;
  const a = c.autopilot;
  const v = sim.getControlled();
  if (t.destroyed) return { text: '기체가 부서졌어요. 미션 창의 「재시작」으로 다시 해 보세요. (난이도 「쉬움」은 기체가 더 튼튼해요)', direction: null, level: 'warn' };
  if (v.autopilot.program) return { text: `자동 비행 중 — <b>${t.autopilot.programLabel}</b>. 조종 키를 누르면 직접 조종으로 바뀌어요.`, direction: null };
  if (t.docked) return { text: '정거장에 도킹했어요. <kbd>U</kbd> 로 분리할 수 있어요.', direction: null, level: 'success' };

  // 부스터 조종 중
  if (t.controlledVehicle === 'booster') {
    const L = t.landing;
    if (L.result) return { text: L.result === 'success' ? '부스터 착륙 성공! <kbd>B</kbd> 로 로켓으로 돌아가요.' : '부스터 착륙 실패. <kbd>B</kbd> 로 로켓으로 돌아가요.', direction: null };
    const body = sim.getReference(v);
    const rel = vec3.sub(v.velocity, body.velocity);
    const speed = vec3.length(rel);
    return {
      text: `부스터: 기수를 ◇(역방향)에 두고 동압이 오르면 엔진으로 감속 → 노란 □ 쪽으로 기울여 접근 → 수직 착지 (하강 ${L.limits.maxVerticalSpeed} m/s 이하). <kbd>G</kbd> = 자동 착륙`,
      direction: speed > 2 ? vec3.scale(rel, -1) : vec3.normalize(v.position),
    };
  }

  const body = sim.getReference(v);
  const relPos = vec3.sub(v.position, body.position);
  const relVel = vec3.sub(v.velocity, body.velocity);
  const retrograde = vec3.length(relVel) > 1 ? vec3.scale(relVel, -1) : null;

  // 달 근처
  if (body.id === 'moon') {
    if (t.landed) return { text: '달 표면에 섰어요! <kbd>Z</kbd> 로 다시 이륙할 수 있어요.', direction: null, level: 'success' };
    if (t.escapeTrajectory) {
      return { text: '달 근접 비행 중: 기동 계획의 <b>원궤도 만들기</b> → <kbd>G</kbd> 로 달 궤도에 들어가요. 직접 하려면 근지점에서 역진행(◇)으로 감속.', direction: retrograde };
    }
    return {
      text: `달 궤도 (고도 ${formatDistance(t.altitude)}): <kbd>G</kbd> = 자동 달 착륙. 직접 내리려면 기수를 ◇(역진행)에 두고 수평 속도를 줄인 뒤, 수직 속도를 보며 천천히.`,
      direction: retrograde,
    };
  }

  if (t.landed) {
    if (!sim.hasLiftedOff) {
      return {
        text: '① <kbd>Z</kbd>(또는 <kbd>Shift</kbd>)로 엔진을 켜고 똑바로 올라가요 ② 고도 1 km 부터 <kbd>W</kbd> 로 조금씩 동쪽(◇)으로 기울여요 ③ 원지점이 85 km 가 되면 <kbd>X</kbd>. 어려우면 <kbd>G</kbd> = 자동 궤도 진입',
        direction: vec3.normalize(v.position),
      };
    }
    return null;
  }

  const frame = localFrame(v.position, c.planet.northPoleDirection);
  const r = vec3.length(v.position);
  const alt = r - c.planet.radius;
  const vs = vec3.dot(v.velocity, frame.up);
  const hVel = vec3.addScaled(v.velocity, frame.up, -vs);
  const hSpeed = vec3.length(hVel);
  const horizontal = hSpeed > 30 ? vec3.scale(hVel, 1 / hSpeed) : frame.east;
  const orbit = sim.getOrbit(v);
  const target = a.targetApoapsisAltitude;
  const top = c.atmosphere.topAltitude;
  const stageEmpty = v.engineOn && !hasFuel(v) && t.canStage;
  const stageHint = stageEmpty ? ' · 연료가 다 떨어졌어요 → <kbd>Space</kbd> 로 단 분리' : '';

  // 궤도에 오른 뒤
  if (sim.orbitAchievedAt !== null) {
    if (orbit.periapsisAltitude < top && alt < top + 60_000) {
      const chute = attachedParachute(v).full > 0;
      const p = t.parachute;
      const chuteText = !chute ? '낙하산이 없어요 — 땅에 닿기 전에 엔진으로 감속해야 해요' : p.state === 'deployed' ? '낙하산 펼침 — 그대로 내려가요' : p.safeToDeploy ? '지금 <kbd>P</kbd> 로 낙하산!' : `${p.maxDeploySpeed} m/s 아래로 느려지면 <kbd>P</kbd>`;
      return {
        text: `재진입: 꼬리(열 차폐막)를 진행 방향으로 — <kbd>T</kbd> 로 자세 보조 「역진행」(◇). ${chuteText}`,
        direction: p?.state === 'deployed' ? null : retrograde,
      };
    }
    return {
      text: '원궤도 달성! 다음 목표: 지도(<kbd>M</kbd>)에서 기동 계획 · 🌕 달 전이 계획 · 궤도에서 <kbd>G</kbd> = 자동 재진입(낙하산이 있을 때)',
      direction: null,
      level: 'success',
    };
  }

  const g = c.planet.mu / (r * r) - (hSpeed * hSpeed) / r;
  const timeToApoapsis = vs > 0 ? vs / Math.max(0.3, g) : 0;
  const qRatio = t.maxQLimit > 0 ? t.dynamicPressure / t.maxQLimit : 0;
  const throttleHint = qRatio > 0.8 && v.throttle > 0.1 ? ' · ⚠ 동압이 높아요 → <kbd>Ctrl</kbd> 로 스로틀을 낮추세요' : '';

  // 1) 상승: 원지점을 목표까지 올린다
  if (orbit.escape === false && orbit.apoapsisAltitude < target - 1_000) {
    const progress = Math.max(0, Math.min(1, (alt - a.gravityTurnStartAltitude) / (a.gravityTurnEndAltitude - a.gravityTurnStartAltitude)));
    let angle = a.gravityTurnMaxAngleDeg * progress ** 0.7;
    if (progress > 0) {
      const wanted = 15 + 30 * progress;
      if (timeToApoapsis < wanted) angle -= (wanted - timeToApoapsis) * 2;
      else if (timeToApoapsis > wanted + 30) angle += (timeToApoapsis - wanted - 30) * 0.5;
      angle = Math.max(0, Math.min(88, angle));
    }
    const engine = v.engineOn && v.throttle > 0 ? '' : ' · <kbd>Z</kbd> 로 엔진을 켜세요';
    return {
      text: `상승 중: ${pitchAdvice(t.pitchDeg, 90 - angle)}. 원지점 ${km(orbit.apoapsisAltitude)} → 목표 ${km(target)}${engine}${throttleHint}${stageHint}`,
      direction: tilted(frame, angle, horizontal),
      level: throttleHint || stageEmpty ? 'warn' : 'info',
    };
  }

  // 2) 원지점 도달 → 관성 비행 → 원궤도 연소
  const stage = v.stages[v.currentStage];
  const mass = v.stages.slice(v.currentStage).reduce((m, st) => m + st.dryMass + st.fuel, 0);
  const thrustAcc = stage && mass > 0 ? stage.maxThrust / mass : 0;
  let burnTime = 0;
  if (!orbit.escape && thrustAcc > 0) {
    const ra = orbit.apoapsisRadius;
    burnTime = Math.max(0, Math.sqrt(c.planet.mu / ra) - vec3.length(orbit.angularMomentum) / ra) / thrustAcc;
  }
  const burning = v.engineOn && v.throttle > 0 && hasFuel(v);
  const startBurnIn = timeToApoapsis - burnTime / 2;
  // 이미 연소 중이면 원지점이 꽤 멀 때만 끄라고 한다 (경계에서 안내가 오락가락하지 않게)
  if (vs > 0 && startBurnIn > (burning ? 25 : 8)) {
    return {
      text: burning
        ? `원지점 ${km(orbit.apoapsisAltitude)} 도달 → <kbd>X</kbd> 로 엔진을 끄세요. 원지점까지 관성으로 올라가요.`
        : `관성 비행: 약 ${sec(startBurnIn)} 뒤 원궤도 연소. 기수를 수평 ◇(진행 방향)에 두세요 — <kbd>T</kbd> 자세 보조 「진행 방향」 · <kbd>.</kbd> 시간 가속`,
      direction: horizontal,
      level: burning ? 'warn' : 'info',
    };
  }
  // 원궤도 연소: 수평으로 밀면서 떨어지지 않을 만큼만 기수를 든다
  const upward = g + 0.1 * (alt < top + 5_000 ? Math.min(30, (top + 10_000 - alt) / 30) - vs : -vs);
  const lift = (Math.asin(Math.max(-0.26, Math.min(0.7, upward / Math.max(0.1, thrustAcc)))) * 180) / Math.PI;
  return {
    text: `원궤도 연소: ${burning ? '' : '<kbd>Z</kbd> 로 최대 추력 · '}기수는 ◇(수평에서 ${Math.round(lift)}° 위) — ${pitchAdvice(t.pitchDeg, lift)}. 근지점 ${km(orbit.periapsisAltitude)} → 70 km 이상${stageHint}`,
    direction: tilted(frame, 90 - lift, horizontal),
    level: stageEmpty ? 'warn' : 'info',
  };
}
