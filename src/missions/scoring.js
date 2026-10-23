/**
 * 점수 계산
 * ------------------------------------------------------------
 * 점수 = 성공 기본 점수 + 남은 연료 점수 + 궤도 정확도 점수 + 착륙 점수
 *   - 남은 연료 = 현재 로켓에 남은 연료 / 처음 전체 연료 (0~1) × fuelPoints
 *   - 궤도 정확도 (궤도 미션만): 0~1 × orbitAccuracyPoints
 *       원궤도 미션: 1 − (|원지점−목표| + |근지점−목표|) / (2 × 허용 오차)
 *       저궤도 미션: 1 − 이심률 / eccentricityForZeroAccuracy
 *   - 착륙 (착륙 미션만): 성공 시 landingPoints
 * 해당하지 않는 항목은 null 로 두고 "해당 없음" 으로 표시한다.
 */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * @param {string} missionId
 * @param {object} t 미션 성공 순간의 텔레메트리
 * @param {object} missionConfig MISSION_CONFIG
 */
export function computeScore(missionId, t, missionConfig) {
  const rules = missionConfig.scoring;
  const mission = missionConfig.missions[missionId];

  const fuelRatio = t.initialTotalFuel > 0 ? clamp01(t.totalFuel / t.initialTotalFuel) : 0;

  let orbitAccuracy = null;
  if (mission.usesOrbitAccuracy) {
    if (missionId === 'circularOrbit') {
      const error = Math.abs(t.apoapsisAltitude - mission.targetAltitude) + Math.abs(t.periapsisAltitude - mission.targetAltitude);
      orbitAccuracy = clamp01(1 - error / (2 * mission.altitudeTolerance));
    } else {
      orbitAccuracy = clamp01(1 - t.eccentricity / rules.eccentricityForZeroAccuracy);
    }
  }

  // 착륙 점수: 착륙 미션이고 착륙 기능이 있을 때만 계산
  let landing = null;
  if (mission.usesLanding && t.landingSupported) landing = t.landingResult === 'success';

  const items = [
    { id: 'completion', label: '미션 성공', value: null, points: rules.completionPoints },
    { id: 'fuel', label: '남은 연료', value: fuelRatio, points: Math.round(fuelRatio * rules.fuelPoints) },
    {
      id: 'orbit',
      label: '궤도 정확도',
      value: orbitAccuracy,
      points: orbitAccuracy === null ? null : Math.round(orbitAccuracy * rules.orbitAccuracyPoints),
    },
    {
      id: 'landing',
      label: '부스터 착륙',
      value: landing,
      points: landing === null ? null : landing ? rules.landingPoints : 0,
    },
  ];
  return {
    items,
    total: items.reduce((sum, item) => sum + (item.points ?? 0), 0),
  };
}
