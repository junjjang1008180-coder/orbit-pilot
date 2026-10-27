/**
 * 미션 진행 추적
 * ------------------------------------------------------------
 * 매 프레임 텔레메트리를 받아 미션 상태를 갱신한다.
 *   진행 중(active) → 성공(success) : 목표 달성 순간의 상태로 점수를 확정
 *   진행 중(active) → 실패(failed)  : 기체 파손, 비상 중단, 이륙 후 지면 복귀
 *   부스터 착륙 미션은 부스터를 분리한 뒤에는 로켓 본체의 상태와 관계없이
 *   부스터 착륙 결과로만 성공·실패가 정해진다.
 * 결과가 정해지면 더 이상 바뀌지 않는다 (재시작하면 새 추적기를 만든다).
 */
import { checkMission } from './missions.js';
import { computeScore } from './scoring.js';

/**
 * @param {string} missionId
 * @param {{missions:object, physics:object}} configs MISSION_CONFIG, PHYSICS_CONFIG
 */
export function createMissionTracker(missionId, configs) {
  const mission = configs.missions.missions[missionId];
  let status = 'active';
  let result = null; // { score, time, reason }
  let progress = '';
  let unsupported = false;

  return {
    missionId,
    mission,
    /** @param {object} t 텔레메트리 */
    update(t) {
      if (status !== 'active') return this.getStatus();
      const check = checkMission(missionId, t, configs);
      progress = check.progress;
      unsupported = Boolean(check.unsupported);

      // 착륙 미션에서 부스터를 분리한 뒤에는 로켓 본체의 파손·추락은 실패 사유가 아니다
      const bodyMatters = !mission.usesLanding || !t.boosterSeparated;
      if (check.achieved) {
        status = 'success';
        result = { time: t.time, score: computeScore(missionId, t, configs.missions), reason: '목표 달성' };
      } else if (mission.usesLanding && t.landingResult === 'failure') {
        status = 'failed';
        result = { time: t.time, score: null, reason: `부스터 착륙 실패 (${t.landingReason})` };
      } else if (!bodyMatters) {
        // 부스터 착륙 결과를 기다린다
      } else if (t.destroyed) {
        status = 'failed';
        result = { time: t.time, score: null, reason: `기체 파손 (${t.destroyedReason})` };
      } else if (t.aborted) {
        status = 'failed';
        result = { time: t.time, score: null, reason: '비상 중단' };
      } else if (t.hasLiftedOff && t.landed && !(mission.landsOnRunway && (t.shuttle?.rolling || t.shuttleLanded))) {
        status = 'failed';
        result = { time: t.time, score: null, reason: '목표 달성 전에 지면으로 돌아옴' };
      }
      return this.getStatus();
    },
    getStatus() {
      return { missionId, name: mission.name, description: mission.description, status, progress, unsupported, result };
    },
  };
}
