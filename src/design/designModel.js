/**
 * 로켓 설계 데이터와 분석
 * ------------------------------------------------------------
 * 설계 = 부품 id 를 아래→위 순서로 쌓은 목록(stack).
 * 단 분리기(kind: 'decoupler')가 단의 경계이며, 분리기는 아래 단에 속해 함께 떨어진다.
 *   예) [엔진, 대형탱크, 분리기, 2단엔진, 소형탱크, 캡슐]
 *       → 1단 [엔진, 대형탱크, 분리기], 2단 [2단엔진, 소형탱크, 캡슐]
 *
 * 질량·추력 합산은 비행에 쓰는 buildRocket 을, 배기속도·중력은 물리 모듈을 그대로 써서
 * 설계 화면과 실제 비행의 계산이 서로 다르지 않게 한다.
 */
import { buildRocket } from '../rocket/rocketDefinition.js';
import { exhaustVelocity } from '../physics/flightPhysics.js';
import { gravityMagnitudeAtRadius } from '../physics/gravity.js';

// ── 쌓기 편집 (모두 새 배열을 돌려준다) ─────────────────────
export function insertPart(stack, index, partId) {
  const next = [...stack];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, partId);
  return next;
}

export function removePart(stack, index) {
  return stack.filter((_, i) => i !== index);
}

/** from 위치의 부품을 꺼내 to 위치(꺼내기 전 기준 틈 번호)에 넣는다 */
export function movePart(stack, from, to) {
  if (from < 0 || from >= stack.length) return [...stack];
  const next = [...stack];
  const [part] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, part);
  return next;
}

/** 로켓 구성(단 목록) → 설계 stack (아래→위) */
export function stackFromDefinition(definition) {
  return definition.stages.flatMap((stage) => stage.parts);
}

/**
 * 설계 stack → 비행용 로켓 구성 { name, stages:[{parts}] }
 * @param {string[]} stack 아래→위 부품 id
 */
export function toRocketDefinition(stack, partsCatalog, name = '내가 설계한 로켓') {
  const stages = [];
  let current = [];
  for (const partId of stack) {
    current.push(partId);
    if (partsCatalog[partId]?.kind === 'decoupler') {
      stages.push({ parts: current });
      current = [];
    }
  }
  stages.push({ parts: current }); // 맨 위 단 (분리기 위가 비어 있으면 빈 단)
  return { name, stages };
}

/**
 * 설계 분석: 질량, 발사 TWR, 단별·전체 Δv, 발사 가능 여부
 * @param {string[]} stack
 * @param {object} config PHYSICS_CONFIG
 */
export function analyzeDesign(stack, config) {
  const errors = [];
  const warnings = [];
  const parts = config.parts;

  if (stack.length === 0) {
    return { valid: false, errors: ['부품이 없습니다. 왼쪽 목록에서 부품을 끌어다 놓으세요.'], warnings, stages: [], totalMass: 0, totalFuel: 0, launchTwr: 0, totalDeltaV: 0 };
  }

  const definition = toRocketDefinition(stack, parts);
  // 분리기는 자기 단에 들어가므로 빈 단은 "맨 위가 분리기" 인 경우에만 생긴다
  if (definition.stages[definition.stages.length - 1].parts.length === 0) {
    errors.push('단 분리기 위에 아무 부품도 없습니다. 분리기 위에 부품을 올리거나 분리기를 빼세요.');
  }
  const usableStages = definition.stages.filter((s) => s.parts.length > 0);
  const rocket = buildRocket({ name: definition.name, stages: usableStages }, parts);

  // 단별 Δv: 단 i 점화 시 질량 m₀ = (i 단부터 위 모든 단 질량), 연소 후 m_f = m₀ − 단 i 연료
  const stageCount = rocket.stages.length;
  const stageInfo = rocket.stages.map((stage, i) => {
    let ignitionMass = 0;
    for (let j = i; j < stageCount; j++) ignitionMass += rocket.stages[j].dryMass + rocket.stages[j].fuelCapacity;
    const burnoutMass = ignitionMass - stage.fuelCapacity;
    const hasEngine = stage.maxThrust > 0;
    const deltaV = hasEngine && stage.fuelCapacity > 0 ? exhaustVelocity(stage.isp, config) * Math.log(ignitionMass / burnoutMass) : 0;
    const twr = stage.maxThrust / (ignitionMass * config.planet.surfaceGravity); // 해수면 중력 기준
    return {
      index: i,
      parts: stage.parts.map((p) => p.id),
      dryMass: stage.dryMass,
      fuel: stage.fuelCapacity,
      thrust: stage.maxThrust,
      isp: stage.isp,
      ignitionMass,
      burnoutMass,
      deltaV,
      twr,
      hasEngine,
    };
  });

  const totalMass = stageInfo.length ? stageInfo[0].ignitionMass : 0;
  const totalFuel = stageInfo.reduce((s, st) => s + st.fuel, 0);
  // 발사 TWR: 발사대 상판 높이의 실제 중력으로 계산 (비행 화면 TWR 과 같은 방식)
  const padGravity = gravityMagnitudeAtRadius(config.planet.radius + config.launchSite.padHeight, config.planet.mu);
  const launchTwr = stageInfo.length ? stageInfo[0].thrust / (totalMass * padGravity) : 0;

  if (!stack.some((id) => parts[id]?.kind === 'payload')) {
    errors.push('탑재물이 없습니다. 탑재물(캡슐 등)을 하나 이상 올리세요.');
  }
  if (stageInfo.length && !stageInfo[0].hasEngine) {
    errors.push('1단(맨 아래 단)에 엔진이 없습니다.');
  } else if (stageInfo.length && launchTwr <= 1) {
    errors.push(`이륙 불가: 발사 TWR ${launchTwr.toFixed(2)} ≤ 1 — 추력이 무게보다 작습니다.`);
  }
  stageInfo.forEach((st) => {
    const label = `${st.index + 1}단`;
    if (st.hasEngine && st.fuel === 0) warnings.push(`${label}: 엔진은 있지만 연료가 없습니다 (Δv 0).`);
    if (!st.hasEngine && st.fuel > 0) warnings.push(`${label}: 연료가 있지만 엔진이 없어 쓸 수 없습니다.`);
    const isRecovery = st.parts.some((id) => parts[id]?.kind === 'parachute' || parts[id]?.kind === 'heatShield');
    if (st.index > 0 && !st.hasEngine && st.index === stageInfo.length - 1 && stageInfo.length > 1 && !isRecovery) {
      warnings.push(`${label}: 엔진이 없는 맨 위 단입니다.`);
    }
  });
  // 재진입 부품 배치 안내
  const shieldIndex = stack.findIndex((id) => parts[id]?.kind === 'heatShield');
  if (shieldIndex >= 0) {
    const shieldStage = definition.stages.findIndex((s) => s.parts.includes(stack[shieldIndex]));
    if (definition.stages[shieldStage]?.parts[0] !== stack[shieldIndex]) {
      warnings.push('열 차폐막은 자기 단의 맨 아래에 있어야 재진입 열을 막아요.');
    }
  }
  if (stack.some((id) => parts[id]?.kind === 'parachute') && shieldIndex < 0) {
    warnings.push('낙하산은 있지만 열 차폐막이 없어요 — 궤도에서 돌아올 때 탈 수 있어요.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    definition: { name: definition.name, stages: usableStages },
    stages: stageInfo,
    totalMass,
    totalFuel,
    launchTwr,
    totalDeltaV: stageInfo.reduce((s, st) => s + st.deltaV, 0),
  };
}
