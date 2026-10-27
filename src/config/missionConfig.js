/**
 * 미션·점수 설정 파일
 * ------------------------------------------------------------
 * 미션 목표와 점수 기준처럼 "게임 규칙" 에 해당하는 값을 모은다.
 * 물리 수치(궤도 판정 허용 이심률 등)는 physicsConfig.js 에 있고 여기서는 쓰지 않는다.
 * 단위: 고도 m, 점수 점(무차원)
 */

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

export const MISSION_CONFIG = deepFreeze({
  missions: {
    reach100km: {
      name: '고도 100 km 도달',
      description: '로켓을 고도 100 km 이상까지 올리세요. (궤도 진입은 필요 없음)',
      targetAltitude: 100_000, // 목표 고도 (m)
      usesOrbitAccuracy: false,
      usesLanding: false,
    },
    lowOrbit: {
      name: '저궤도 진입',
      description: '근지점이 대기권 밖인 닫힌 궤도에 들어가세요. (원지점·근지점이 모두 대기권 위)',
      usesOrbitAccuracy: true,
      usesLanding: false,
    },
    circularOrbit: {
      name: '고도 100 km 원궤도',
      description: '원지점과 근지점이 모두 100 km ± 10 km 이고 이심률이 원궤도 기준 이하인 궤도를 만드세요.',
      targetAltitude: 100_000, // 목표 원궤도 고도 (m)
      altitudeTolerance: 10_000, // 허용 고도 오차 (m)
      usesOrbitAccuracy: true,
      usesLanding: false,
    },
    docking: {
      name: '우주 정거장 도킹',
      description: '고도 85 km 원궤도의 우주 정거장에 도킹하세요. 맨 위에 캡슐(도킹 포트)이 있어야 해요. (궤도에 오른 뒤 정거장 근처에서 G = 자동 도킹)',
      usesOrbitAccuracy: false,
      usesLanding: false,
      spawnsStation: true, // 이 미션에서는 우주 정거장을 띄운다
    },
    boosterLanding: {
      name: '부스터 착륙 성공',
      description: '단 분리 후 1단 부스터를 착륙 지점에 수직으로 착륙시키세요.',
      usesOrbitAccuracy: false,
      usesLanding: true,
    },
    reentry: {
      name: '궤도 왕복 (재진입·낙하산 회수)',
      description: '원궤도에 오른 뒤 역추진으로 내려와, 열 차폐막을 앞세워 재진입하고 낙하산(P)으로 안전하게 착지하세요. 궤도에서 G = 자동 재진입·회수. (예시 설계 「회수 캡슐 로켓」 추천)',
      usesOrbitAccuracy: false,
      usesLanding: false,
    },
    moonFlyby: {
      name: '달 근접 비행',
      description: '달 중력권(약 640 km)까지 날아가세요. 궤도에 오른 뒤 기동 계획의 「달 전이 계획」 → G. (예시 설계 「달 탐사 로켓」 추천)',
      usesOrbitAccuracy: false,
      usesLanding: false,
    },
    moonOrbit: {
      name: '달 궤도 진입',
      description: '달 중력권 안에서 근지점 5 km 이상인 닫힌 궤도에 들어가세요. 달 중력권에서 「원궤도 만들기」 → G. (예시 설계 「달 탐사 로켓」 추천)',
      usesOrbitAccuracy: false,
      usesLanding: false,
    },
    shuttleOrbit: {
      name: '우주 왕복선 궤도 왕복',
      description: '우주 왕복선으로 궤도에 오른 뒤(G = 자동 궤도 진입, 외부 탱크 자동 분리) 역추진·재진입하고, 활공해 활주로에 바퀴로 착륙해 멈추세요. 궤도에서 G = 자동 귀환·착륙, Y = 바퀴, V = 브레이크, P = 감속 낙하산. (예시 설계 「우주 왕복선」)',
      usesOrbitAccuracy: false,
      usesLanding: false,
      requiresShuttle: true, // 예시 설계 「우주 왕복선」 으로만 할 수 있다
      landsOnRunway: true, // 활주로 위를 굴러가는 동안은 "지면 복귀 실패" 가 아니다
    },
    shuttleGlide: {
      name: '왕복선 활공 착륙 연습',
      description: '궤도선만 활주로 서쪽 37 km · 고도 12 km 에서 활공하며 시작해요. 엔진 없이 활공각 18° 로 내려와 Y 로 바퀴를 내리고, 기수를 들어(플레어) 활주로에 살며시 닿은 뒤 V(브레이크)·P(감속 낙하산)로 멈추세요. G = 자동 착륙. (예시 설계 「우주 왕복선」)',
      usesOrbitAccuracy: false,
      usesLanding: false,
      requiresShuttle: true,
      landsOnRunway: true,
      startsGliding: true, // 발사 대신 활공 시작점에서 출발
    },
    moonLanding: {
      name: '달 착륙',
      description: '달 표면에 안전하게 착륙하세요 (수직 6 m/s · 수평 3 m/s · 기울기 10° 이하). 달 중력권에서 G = 자동 달 착륙. (예시 설계 「달 탐사 로켓」 추천)',
      usesOrbitAccuracy: false,
      usesLanding: false,
    },
  },
  defaultMission: 'lowOrbit',

  scoring: {
    completionPoints: 500, // 미션 성공 기본 점수
    fuelPoints: 300, // 남은 연료 점수 = 비율(남은 연료 / 처음 전체 연료) × 이 값
    orbitAccuracyPoints: 200, // 궤도 정확도 점수 = 정확도(0~1) × 이 값
    landingPoints: 300, // 부스터 착륙 성공 점수
    // 저궤도 미션의 정확도: 이심률이 이 값 이상이면 정확도 0, 0 이면 정확도 1
    eccentricityForZeroAccuracy: 0.1,
  },
});
