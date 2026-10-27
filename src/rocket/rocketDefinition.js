/**
 * 로켓 구성 데이터 → 단(stage)별 물리 수치 계산
 * ------------------------------------------------------------
 * 부품 id 목록으로 된 로켓 구성을 받아, 설정 파일의 부품 수치를 읽어
 * 단별 건조 질량, 연료량, 엔진 추력·비추력을 합산한다.
 * 부품 수치는 PHYSICS_CONFIG.parts 에만 있고 여기서는 읽기만 한다.
 */

/**
 * @param {{name:string, stages:{parts:string[]}[]}} definition 로켓 구성
 * @param {Record<string, object>} partsCatalog PHYSICS_CONFIG.parts
 */
export function buildRocket(definition, partsCatalog) {
  const stages = definition.stages.map((stageDef, index) => {
    const parts = stageDef.parts.map((partId) => {
      const part = partsCatalog[partId];
      if (!part) throw new Error(`알 수 없는 부품 id: ${partId}`);
      return { id: partId, ...part };
    });
    // 추력이 있는 부품 (엔진, 궤도 조종 엔진이 달린 궤도선 등)
    const engines = parts.filter((p) => p.thrust > 0);
    return {
      index,
      parts,
      dryMass: sum(parts, (p) => p.dryMass), // 단 건조 질량 (kg)
      fuelCapacity: sum(parts, (p) => p.fuelMass), // 단 연료 용량 (kg)
      maxThrust: sum(engines, (p) => p.thrust), // 단 엔진 최대 추력 합 (N)
      // 여러 엔진의 합성 비추력: Isp = ΣF / Σ(F/Isp)  (같은 연료 소모율 기준)
      isp: combinedIsp(engines),
      length: sum(parts, (p) => p.length), // 단 길이 (m)
      maxRadius: Math.max(0, ...parts.map((p) => p.radius)), // 단에서 가장 굵은 반지름 (m)
      // 재진입 가열: 맨 아래 부품이 열 차폐막이면 그 최고 온도, 나머지 부품 중 가장 약한 최고 온도
      bottomShieldTemperature: parts[0]?.kind === 'heatShield' ? parts[0].maxTemperature : 0,
      maxTemperature: Math.min(Infinity, ...parts.filter((p) => p.kind !== 'heatShield').map((p) => p.maxTemperature ?? Infinity)),
      // 낙하산 면적 합 (m²): 다 펼친 면적, 보조 낙하산 면적
      parachuteArea: sum(parts, (p) => (p.kind === 'parachute' ? p.canopyArea : 0)),
      parachuteSemiArea: sum(parts, (p) => (p.kind === 'parachute' ? p.semiArea : 0)),
      // 낙하산을 펼칠 수 있는 최대 속도 (부품마다 다르면 가장 낮은 값, 없으면 설정 기본값)
      parachuteMaxDeploySpeed: Math.min(Infinity, ...parts.filter((p) => p.kind === 'parachute' && p.maxDeploySpeed).map((p) => p.maxDeploySpeed)),
      // 우주 왕복선: 옆에 붙는 단(떼어 내도 기준점이 그대로), 아래 단과 함께 점화되는 단, 날개 달린 궤도선
      sideMounted: parts.some((p) => p.mount === 'side'),
      ignitesWithStageBelow: parts.some((p) => p.ignitesWithStageBelow),
      winged: parts.some((p) => p.winged),
    };
  });
  // 우주 왕복선 (날개 달린 궤도선 단이 있으면) — 화면 모델·조종석이 따로 있다
  return { name: definition.name, stages, isShuttle: stages.some((s) => s.winged) };
}

function sum(list, pick) {
  return list.reduce((total, item) => total + pick(item), 0);
}

function combinedIsp(engines) {
  const thrust = sum(engines, (e) => e.thrust);
  const flowWeight = sum(engines, (e) => (e.isp > 0 ? e.thrust / e.isp : 0));
  return flowWeight > 0 ? thrust / flowWeight : 0;
}
