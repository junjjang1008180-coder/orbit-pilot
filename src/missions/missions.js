/**
 * 미션 목표 판정
 * ------------------------------------------------------------
 * 각 미션은 텔레메트리(실제 비행 상태)만 보고 목표 달성 여부와 진행 상황을 판단한다.
 * 목표 값은 missionConfig.js, 궤도 판정 허용치는 physicsConfig.js 에서 읽는다.
 */
import { formatDistance } from '../ui/format.js';

/** 근지점 고도 표시: 지표 아래(충돌 궤도)면 숫자 대신 글로 */
const formatPeriapsis = (alt) => (alt < 0 ? '지표 아래' : formatDistance(alt));

/**
 * @typedef {object} MissionCheck
 * @property {boolean} achieved   목표 달성
 * @property {string} progress    진행 상황 설명
 * @property {boolean} [unsupported] 아직 판정할 수 없는 미션 (구현 전 기능 필요)
 */

/**
 * @param {string} missionId
 * @param {object} t 텔레메트리
 * @param {{missions:object, physics:object}} configs
 * @returns {MissionCheck}
 */
export function checkMission(missionId, t, { missions, physics }) {
  const m = missions.missions[missionId];
  switch (missionId) {
    case 'reach100km': {
      const best = Math.max(t.maxAltitude ?? t.altitude, t.altitude);
      return {
        achieved: best >= m.targetAltitude,
        progress: `최고 고도 ${formatDistance(best)} / ${formatDistance(m.targetAltitude)}`,
      };
    }
    case 'lowOrbit': {
      const closed = !t.escapeTrajectory && !t.landed;
      const achieved = closed && t.periapsisAltitude >= physics.orbit.minPeriapsisAltitude;
      return {
        achieved,
        progress: t.landed
          ? `근지점을 ${formatDistance(physics.orbit.minPeriapsisAltitude)} 이상으로`
          : t.escapeTrajectory
            ? '탈출 궤도 — 닫힌 궤도가 아님'
            : `근지점 ${formatPeriapsis(t.periapsisAltitude)} / ${formatDistance(physics.orbit.minPeriapsisAltitude)} 이상`,
      };
    }
    case 'circularOrbit': {
      const low = m.targetAltitude - m.altitudeTolerance;
      const high = m.targetAltitude + m.altitudeTolerance;
      const inBand = (alt) => alt >= low && alt <= high;
      const achieved =
        !t.landed &&
        !t.escapeTrajectory &&
        inBand(t.apoapsisAltitude) &&
        inBand(t.periapsisAltitude) &&
        t.eccentricity <= physics.orbit.maxCircularEccentricity;
      return {
        achieved,
        progress: t.landed
          ? `원지점·근지점 ${formatDistance(low)} ~ ${formatDistance(high)}`
          : `원지점 ${t.escapeTrajectory ? '∞' : formatDistance(t.apoapsisAltitude)} · 근지점 ${formatPeriapsis(t.periapsisAltitude)} (목표 ${formatDistance(low)}~${formatDistance(high)})`,
      };
    }
    case 'docking': {
      const target = t.target;
      if (t.docked) return { achieved: true, progress: '도킹 완료' };
      if (!target) return { achieved: false, progress: '정거장 없음' };
      if (!target.hasDockingPort) return { achieved: false, progress: '맨 위에 도킹 포트(캡슐)가 없어요' };
      return {
        achieved: false,
        progress: `정거장까지 ${formatDistance(target.portDistance)} · 상대 속도 ${target.relativeSpeed.toFixed(1)} m/s`,
      };
    }
    case 'boosterLanding': {
      // 부스터 착륙 판정은 착륙 미니게임(landingResult)이 있어야 가능하다
      if (!t.landingSupported) {
        return { achieved: false, unsupported: true, progress: '부스터 착륙 기능 미구현 — 판정 불가' };
      }
      return {
        achieved: t.landingResult === 'success',
        progress: t.landingResult === 'success'
          ? '부스터 착륙 성공'
          : t.landingResult === 'failure'
            ? '부스터 착륙 실패'
            : '단 분리 후 부스터를 착륙시키세요',
      };
    }
    case 'reentry': {
      if (!t.orbitAchieved) {
        return { achieved: false, progress: t.landed && !t.hasLiftedOff ? '먼저 원궤도에 오르세요 (G = 자동 궤도 진입)' : '원궤도에 오르는 중' };
      }
      if (t.landed && t.landedOn === 'planet' && t.touchdown?.safe && !t.destroyed) return { achieved: true, progress: '회수 성공' };
      const chute = t.parachute?.available ? (t.parachute.state === 'deployed' ? '낙하산 펼침' : t.parachute.state === 'torn' ? '낙하산 찢어짐' : '낙하산 접힘') : '낙하산 없음';
      return {
        achieved: false,
        progress: `고도 ${formatDistance(t.altitude)} · 표면 온도 ${Math.round(t.skinTemperature ?? 0)} K · ${chute}`,
      };
    }
    case 'moonFlyby': {
      if (t.moonEncountered) return { achieved: true, progress: '달 중력권 도착' };
      return { achieved: false, progress: moonProgress(t) };
    }
    case 'moonOrbit': {
      if (t.moonOrbitAchieved) return { achieved: true, progress: '달 궤도 진입' };
      if (t.referenceBody?.id === 'moon') {
        return {
          achieved: false,
          progress: `달 기준 근지점 ${formatPeriapsis(t.periapsisAltitude)} · 원지점 ${t.escapeTrajectory ? '탈출 궤도' : formatDistance(t.apoapsisAltitude)} — 감속해 닫힌 궤도로`,
        };
      }
      return { achieved: false, progress: moonProgress(t) };
    }
    case 'moonLanding': {
      if (t.moonLanded) return { achieved: true, progress: '달 착륙 성공' };
      if (t.referenceBody?.id === 'moon') {
        return { achieved: false, progress: `달 고도 ${formatDistance(t.altitude)} · 하강 ${Math.max(0, -t.verticalSpeed).toFixed(1)} m/s` };
      }
      return { achieved: false, progress: moonProgress(t) };
    }
    default:
      return { achieved: false, progress: '알 수 없는 미션' };
  }
}

/** 달로 가는 중 진행 상황: 조우 예정이면 남은 시간·근접 고도, 아니면 달까지 거리 */
function moonProgress(t) {
  if (t.referenceBody?.id === 'moon') return `달 고도 ${formatDistance(t.altitude)}`;
  if (t.encounter) {
    const minutes = Math.round(t.encounter.timeToEncounter / 60);
    return `달 조우 예정 (약 ${minutes}분 뒤 · 근접 ${formatPeriapsis(t.encounter.periapsisAltitude)})`;
  }
  return t.moonDistance === null || t.moonDistance === undefined
    ? '달 없음'
    : `달까지 ${formatDistance(t.moonDistance)} — 궤도에 오른 뒤 「달 전이 계획」`;
}
