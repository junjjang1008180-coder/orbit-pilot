/**
 * 비행 경고 판정
 * ------------------------------------------------------------
 * 텔레메트리(실제 시뮬레이션 값)와 설정의 경고 기준만으로 경고 목록을 만든다.
 * 화면 표시 모듈은 이 목록을 그대로 보여주기만 한다.
 */

/**
 * @param {object} t getTelemetry() 결과 (warnings 제외)
 * @param {object} config PHYSICS_CONFIG
 * @returns {{id:string, level:'warn'|'danger', text:string}[]}
 */
export function computeWarnings(t, config) {
  const w = config.warnings;
  const list = [];

  if (t.destroyed) {
    list.push({ id: 'destroyed', level: 'danger', text: `기체 파손 — ${t.destroyedReason}` });
    return list;
  }

  // Max-Q: 한계에 가까워지면 경고
  const qRatio = t.maxQLimit > 0 ? t.dynamicPressure / t.maxQLimit : 0;
  if (qRatio >= w.maxQWarningRatio) {
    list.push({
      id: 'maxq',
      level: 'danger',
      text: `Max-Q 근접: 동압 ${Math.round(qRatio * 100)}% — ${t.thrust > 0 ? '스로틀을 낮추세요' : '너무 빠르게 공기에 부딪히고 있어요'}`,
    });
  }

  // 연료 부족 / 연소 종료
  if (t.flameout) {
    list.push({ id: 'flameout', level: 'danger', text: '연료 없음 — 엔진 연소 종료' + (t.canStage ? ' (Space 로 단 분리)' : '') });
  } else if (t.fuelCapacity > 0 && t.fuelRatio < w.lowFuelRatio) {
    list.push({ id: 'lowfuel', level: 'warn', text: `연료 부족: 현재 단 ${Math.round(t.fuelRatio * 100)}%` });
  }

  // 재진입 과열: 표면 온도가 한계에 가까움
  if (Number.isFinite(t.thermalLimit) && t.skinTemperature > (t.thermalWarningRatio ?? 0.8) * t.thermalLimit) {
    list.push({
      id: 'overheat',
      level: 'danger',
      text: `과열: 표면 온도 ${Math.round(t.skinTemperature)} K / 한계 ${Math.round(t.thermalLimit)} K${t.heatShielded ? '' : ' — 열 차폐막을 앞으로(역진행)'}`,
    });
  }

  // 자세 불안정: 공기가 있는 곳에서 기수가 진행 방향과 크게 어긋남
  // (열 차폐막을 앞세운 재진입과 낙하산에 매달린 하강은 일부러 뒤로 가는 자세라 제외)
  const intentionallyBackward = t.heatShielded || t.parachute?.state === 'deployed';
  if (!intentionallyBackward && t.dynamicPressure >= w.unstableMinDynamicPressure && t.angleOfAttackDeg > w.unstableAngleOfAttackDeg) {
    list.push({
      id: 'unstable',
      level: 'warn',
      text: `자세 불안정: 받음각 ${t.angleOfAttackDeg.toFixed(0)}° — 기수를 진행 방향에 맞추세요`,
    });
  }
  return list;
}
