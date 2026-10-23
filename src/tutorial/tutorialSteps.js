/**
 * 튜토리얼 단계 정의
 * ------------------------------------------------------------
 * 각 단계는 안내 문구와 "완료 조건" 으로 이루어진다.
 * 완료 조건은 실제 게임 상태(텔레메트리, 화면 모드, 카메라 조작 여부)만 보고 판단하며,
 * 조건이 없는 단계는 "다음" 버튼으로 넘어간다.
 *
 * ctx = {
 *   appMode: 'design' | 'flight',
 *   viewMode: 'flight' | 'map',
 *   telemetry: 조종 중인 비행체 텔레메트리 (비행 중일 때),
 *   cameraMoved: 이 단계에서 카메라를 돌리거나 확대했는지,
 * }
 * 단계의 숫자 기준(고도·피치 등)은 안내용이며, 판정 기준(원궤도 등)은 게임의 실제 판정을 그대로 쓴다.
 */

export const TUTORIAL_STEPS = [
  // ── 설계 화면 ─────────────────────────────────────────
  {
    id: 'design-intro',
    phase: 'design',
    title: '로켓 설계 화면',
    body: '왼쪽 <b>부품 목록</b>에서 엔진·연료탱크·단 분리기·탑재물을 가운데 <b>조립대</b>로 끌어다 놓아 로켓을 쌓아요. 아래가 엔진, 위가 기수예요. 지금은 연습용 <b>2단 로켓</b>이 준비되어 있어요.',
    highlight: '.design-palette',
  },
  {
    id: 'design-stats',
    phase: 'design',
    title: '로켓 성능 읽기',
    body: '<b>발사 TWR</b>(추력 ÷ 무게)이 1보다 커야 땅을 박차고 오를 수 있어요. <b>예상 Δv</b>는 연료로 낼 수 있는 속도 변화예요. 이 행성의 저궤도에는 약 3,300 m/s 가 필요해요.',
    highlight: '.design-info',
  },
  {
    id: 'design-launch',
    phase: 'design',
    title: '발사!',
    body: '미션은 <b>저궤도 진입</b>으로 맞춰 두었어요. 오른쪽 위 <b>발사 ▶</b> 버튼을 누르세요.',
    highlight: '.design-launch',
    done: (ctx) => ctx.appMode === 'flight',
  },

  // ── 비행 ──────────────────────────────────────────────
  {
    id: 'flight-intro',
    phase: 'flight',
    title: '비행 화면 둘러보기',
    body: '왼쪽 아래는 <b>고도·속도·궤도</b>, 가운데는 자세를 보여주는 <b>네비볼</b>, 오른쪽 아래는 <b>스로틀·연료·엔진</b> 정보예요. 오른쪽 위에 조작 키가 정리되어 있어요.',
    highlight: '.hud-flight',
  },
  {
    id: 'flight-camera',
    phase: 'flight',
    title: '카메라 돌려보기',
    body: '<b>우클릭 드래그</b>(트랙패드는 두 손가락 클릭 후 드래그)로 로켓 주위를 돌아보고, <b>휠</b>로 확대·축소해 보세요.',
    done: (ctx) => ctx.cameraMoved,
    skippable: true,
  },
  {
    id: 'flight-ignite',
    phase: 'flight',
    title: '엔진 점화',
    body: '<kbd>Z</kbd> 를 누르면 스로틀이 최대가 되어 엔진이 켜져요. (<kbd>Shift</kbd> 를 누르고 있으면 천천히 올라가요)',
    highlight: '.hud-engine',
    done: (ctx) => ctx.telemetry && ctx.telemetry.thrust > 0,
  },
  {
    id: 'flight-maxq',
    phase: 'flight',
    title: '동압을 보며 상승',
    body: '공기가 짙은 낮은 고도에서 너무 빠르면 <b>동압</b>이 한계(15 kPa)를 넘어 기체가 부서져요. 동압 막대가 노랗게 되면 <kbd>Ctrl</kbd> 로 스로틀을 낮추세요. <b>고도 2 km</b> 까지 올라가 보세요.',
    highlight: '.hud-q',
    done: (ctx) => ctx.telemetry && ctx.telemetry.altitude >= 2_000,
  },
  {
    id: 'flight-gravity-turn',
    phase: 'flight',
    title: '중력 선회',
    body: '궤도에 오르려면 위로만이 아니라 <b>옆(동쪽)으로 빨라져야</b> 해요. <kbd>W</kbd> 를 조금씩 눌러 기수를 동쪽으로 기울이세요. 네비볼 아래 <b>피치가 75° 이하</b>가 되면 돼요. 너무 급히 눕히면 공기에 부딪혀 불안정해져요.',
    highlight: '.navball',
    done: (ctx) => ctx.telemetry && ctx.telemetry.pitchDeg <= 75 && !ctx.telemetry.landed,
  },
  {
    id: 'flight-stage',
    phase: 'flight',
    title: '단 분리',
    body: '1단 연료가 다 떨어지면(엔진 칸에 <b>연소 종료</b> 경고) <kbd>Space</kbd> 로 1단을 떼어 내세요. 무거운 빈 탱크를 버리면 2단이 훨씬 빨라져요. 기다리는 동안 고도가 오를수록 기수를 더 눕혀 주세요.',
    highlight: '.hud-engine',
    done: (ctx) => ctx.telemetry && ctx.telemetry.currentStage >= 1,
  },
  {
    id: 'flight-apoapsis',
    phase: 'flight',
    title: '원지점 80 km 만들기',
    body: '<b>원지점</b>은 이대로 날아갈 때 가장 높은 지점이에요. 기수를 거의 수평(피치 10~20°)으로 두고 엔진을 계속 켜서, 원지점이 <b>80 km</b> 를 넘으면 <kbd>X</kbd> 로 엔진을 끄세요.',
    highlight: '.hud-flight',
    done: (ctx) => ctx.telemetry && ctx.telemetry.apoapsisAltitude >= 80_000 && ctx.telemetry.thrust === 0,
  },
  {
    id: 'flight-map',
    phase: 'flight',
    title: '지도 화면',
    body: '<kbd>M</kbd> 을 눌러 지도 화면을 열어 보세요. 파란 선이 지금 궤도예요. 근지점이 땅속에 있으면 아직 떨어지는 중이에요.',
    done: (ctx) => ctx.viewMode === 'map',
  },
  {
    id: 'flight-map-back',
    phase: 'flight',
    title: '비행 화면으로',
    body: '궤도선과 원지점·근지점 표시를 확인했으면 다시 <kbd>M</kbd> 을 눌러 비행 화면으로 돌아오세요.',
    done: (ctx) => ctx.viewMode === 'flight',
  },
  {
    id: 'flight-coast',
    phase: 'flight',
    title: '원지점까지 기다리기',
    body: '엔진을 끈 채 올라가요. <b>수직 속도</b>가 0 에 가까워지면 원지점 근처예요. 기다리는 동안 기수를 <b>수평(피치 0°)</b>으로 맞춰 두세요. 네비볼의 흰 지평선이 가운데 오면 수평이에요.',
    highlight: '.hud-flight',
    done: (ctx) => ctx.telemetry && ctx.telemetry.altitude > 70_000 && ctx.telemetry.verticalSpeed < 40,
  },
  {
    id: 'flight-circularize',
    phase: 'flight',
    title: '원궤도 만들기',
    body: '수평을 유지한 채 <kbd>Z</kbd> 로 다시 점화하세요. <b>근지점</b>이 올라가는 게 보여요. 떨어지기 시작하면(수직 속도 −) 기수를 살짝 들어(<kbd>S</kbd>) 주세요. 궤도 칸에 <b>원궤도 진입 성공</b>이 뜨면 <kbd>X</kbd> 로 끄세요.',
    highlight: '.hud-flight',
    done: (ctx) => ctx.telemetry && ctx.telemetry.orbitAchieved,
  },
  {
    id: 'finish',
    phase: 'flight',
    title: '🎉 궤도 진입 성공!',
    body: '축하해요, 로켓을 궤도에 올렸어요! 다음엔 <b>부스터 착륙</b> 미션에 도전해 보세요. 1단 연료를 30~40% 남기고 분리한 뒤 <kbd>B</kbd> 로 부스터를 조종해 노란 착륙 지점에 내리면 돼요.',
    final: true,
  },
];

/** 비행이 다시 시작되면(재시작) 돌아갈 단계 */
export const RESTART_STEP_ID = 'flight-ignite';

/**
 * 현재 단계 완료 여부
 * @param {object} step
 * @param {object} ctx
 */
export function isStepDone(step, ctx) {
  return typeof step.done === 'function' ? Boolean(step.done(ctx)) : false;
}
