/**
 * ORBIT PILOT 물리 설정 파일
 * ------------------------------------------------------------
 * 게임에서 쓰는 모든 물리 수치와 부품 수치를 이 파일 한 곳에 모은다.
 * 다른 파일에서는 물리 숫자를 직접 적지 말고 반드시 이 설정을 읽어서 사용한다.
 *
 * 단위 체계 (SI 단위로 통일)
 *   길이 m, 질량 kg, 시간 s, 힘 N, 속도 m/s, 가속도 m/s²
 *   각도는 이름에 Deg 가 붙은 값만 도(°) 단위이고, 나머지는 라디안(rad)이다.
 *
 * 좌표계 (행성 중심 관성 좌표계, 행성 자전은 무시)
 *   행성 중심이 원점이다. 발사장은 +Y 방향 적도 위에 있다.
 *   발사장 기준으로 위(천정) = +Y, 동쪽 = +X, 북쪽 = -Z 이다.
 *   Three.js 화면 좌표로의 변환은 src/scene/renderCoordinates.js 에서만 한다.
 */

// ── 축소 행성 기본값 ─────────────────────────────────────────
// 실제 지구(반지름 6,371 km)보다 작게 줄여 궤도 진입 시간을 줄인다.
// 지표 중력은 지구와 같게 두고, 중력 상수 μ 는 μ = g·R² 로 계산해
// "행성 크기"와 "중력 계산"이 항상 서로 맞도록 한다.
const PLANET_RADIUS = 600_000; // 행성 반지름 (m)
const PLANET_SURFACE_GRAVITY = 9.81; // 해수면 중력가속도 (m/s²)
const PLANET_MU = PLANET_SURFACE_GRAVITY * PLANET_RADIUS * PLANET_RADIUS;

// ── 달 기본값 ──────────────────────────────────────────────
// 행성처럼 줄인 달. 중력 상수는 μ = g·R², 행성 둘레를 원궤도로 정해진 길(레일)을 따라 돈다.
const MOON_RADIUS = 150_000; // 달 반지름 (m)
const MOON_SURFACE_GRAVITY = 1.62; // 달 표면 중력가속도 (m/s²)
const MOON_MU = MOON_SURFACE_GRAVITY * MOON_RADIUS * MOON_RADIUS;
const MOON_ORBIT_RADIUS = 4_000_000; // 행성 중심에서 달 중심까지 거리 (m)

/** 중첩 객체까지 모두 얼려서 실행 중 실수로 값이 바뀌지 않게 한다. */
function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

export const PHYSICS_CONFIG = deepFreeze({
  // ── 물리 상수 ──────────────────────────────────────────────
  constants: {
    // 표준 중력가속도 g₀ (m/s²). 비추력(Isp, s)을 배기속도(m/s)로 바꿀 때만 쓴다.
    // 행성 중력과는 별개인 정의상 상수이다.
    standardGravity: 9.80665,
  },

  // ── 행성 ──────────────────────────────────────────────────
  planet: {
    radius: PLANET_RADIUS, // 행성 반지름 (m)
    surfaceGravity: PLANET_SURFACE_GRAVITY, // 해수면 중력가속도 (m/s²)
    // 중력 파라미터 μ = G·M (m³/s²). 축소 행성에 맞춰 g·R² 로 계산한다.
    mu: PLANET_MU,
    // 북극 방향 단위벡터 (자전축). 북쪽/동쪽 방향 계산에 쓴다.
    northPoleDirection: [0, 0, -1],
  },

  // ── 달 ────────────────────────────────────────────────────
  // 중력권(SOI) 이어 붙이기: 달 중력권 안에서는 달 중력만, 밖에서는 행성 중력만 받는다.
  //   중력권 반지름 r_SOI = a · (μ_달 / μ_행성)^(2/5)  (라플라스 중력권)
  // 달은 자전하지 않고, 대기가 없다. 행성 적도면(발사 궤도면)에서 같은 방향으로 돈다.
  moon: {
    name: '달',
    radius: MOON_RADIUS, // 반지름 (m)
    surfaceGravity: MOON_SURFACE_GRAVITY, // 표면 중력가속도 (m/s²)
    mu: MOON_MU, // 중력 파라미터 (m³/s²)
    orbitRadius: MOON_ORBIT_RADIUS, // 궤도 반지름 (m)
    // 처음(t = 0) 위치: 발사장 천정(+Y)에서 동쪽(+X)으로 이 각도만큼 앞 (°)
    initialPhaseDeg: 70,
    soiRadius: MOON_ORBIT_RADIUS * (MOON_MU / PLANET_MU) ** 0.4, // 중력권 반지름 (m) — 약 636 km
    // 달 궤도 진입 판정: 근지점이 이 고도 이상이고 원지점이 중력권 안인 닫힌 궤도
    minOrbitPeriapsisAltitude: 5_000, // (m)
    transferTargetPeriapsisAltitude: 30_000, // 달 전이 자동 계획의 목표 근접 고도 (m)
  },

  // ── 시뮬레이션 시간 간격 ──────────────────────────────────
  simulation: {
    fixedTimeStep: 1 / 120, // 물리 고정 시간 간격 (s). 화면 프레임과 무관하게 일정하다.
    maxFrameTime: 0.25, // 한 화면 프레임에서 따라잡을 최대 시간 (s). 탭 전환 후 폭주 방지.
  },

  // ── 대기 ──────────────────────────────────────────────────
  // 공기 밀도 ρ(h) = ρ₀ · e^(−h / H)  (지수 대기 모델), 대기 상한 위에서는 0
  atmosphere: {
    seaLevelDensity: 1.225, // 해수면 공기 밀도 ρ₀ (kg/m³)
    scaleHeight: 5_600, // 척도 높이 H (m). 이만큼 올라갈 때마다 밀도가 1/e 로 준다.
    topAltitude: 70_000, // 대기 상한 고도 (m). 이 위는 진공으로 본다.
  },

  // ── 공기역학 ──────────────────────────────────────────────
  // 항력 D = ½ · ρ · v² · Cd · A  (방향: 공기에 대한 상대 속도의 반대)
  // 동압 q = ½ · ρ · v²
  aerodynamics: {
    dragCoefficient: 0.4, // 항력 계수 Cd (무차원). 단면적 A 는 가장 굵은 부품의 원 면적 π·r².
    // Max-Q 한계 동압 (Pa). 이를 넘으면 기체가 파손된다.
    // 기본 2단 로켓이 최대 스로틀로 수직 상승하면 고도 약 2 km 에서 이 한계를 넘도록 정해,
    // 저고도에서 스로틀을 조절해야 하게 했다. (스로틀을 조절한 중력 선회는 최대 약 11 kPa)
    maxDynamicPressure: 15_000,
  },

  // ── 단 분리 ───────────────────────────────────────────────
  staging: {
    // 분리 시 두 물체가 서로 멀어지는 상대 속도 (m/s). 운동량 보존으로 나눠 갖는다.
    separationSpeed: 1.5,
  },

  // ── 궤도 진입 판정 ────────────────────────────────────────
  // 아래 두 조건을 동시에 만족하면 "원궤도 진입 성공" 으로 판정한다.
  orbit: {
    // 근지점 최소 고도 (m). 대기 상한(70 km) 이상이어야 공기저항 없이 계속 돈다.
    minPeriapsisAltitude: 70_000,
    // 원궤도 허용 이심률 (무차원, 0 = 완전한 원). 0.02 는 고도 80 km 기준
    // 원지점·근지점 차이 약 27 km 이내에 해당한다.
    maxCircularEccentricity: 0.02,
  },

  // ── 착륙 판정 ─────────────────────────────────────────────
  // 땅에 닿는 순간 아래 기준을 하나라도 넘으면 폭발(실패)로 처리한다.
  // 부스터는 추가로 착륙 지점 반지름 안에 내려야 "착륙 성공" 이다.
  // 로켓 본체도 같은 기준으로 지면 충돌 여부를 판정한다.
  landing: {
    maxVerticalSpeed: 6, // 허용 수직 하강 속도 (m/s)
    maxHorizontalSpeed: 3, // 허용 수평 속도 (m/s)
    maxTiltDeg: 10, // 허용 기울기 (°, 수직에서 벗어난 각도)
    landingZoneRadius: 40, // 착륙 지점 반지름 (m)
    // 착륙 지점 예측: 분리 순간 부스터가 조종 없이 떨어질 곳(중력+항력)을 미리 계산한다
    predictionTimeStep: 0.25, // 예측 계산 시간 간격 (s)
    predictionMaxTime: 1_800, // 최대 예측 시간 (s)
  },

  // ── 자동조종 ──────────────────────────────────────────────
  autopilot: {
    // 자세 제어: 목표 방향과의 차이(rad)에 곱하는 값과, 회전 속도(rad/s)를 줄이는 감쇠 값
    attitudeGain: 4,
    attitudeDamping: 1.5,
    // 자동 궤도 진입
    gravityTurnStartAltitude: 1_000, // 이 고도(m)부터 기울이기 시작
    gravityTurnEndAltitude: 41_000, // 이 고도(m)에서 최대 기울기에 도달
    gravityTurnMaxAngleDeg: 80, // 수직에서 기울이는 최대 각도 (°)
    maxQThrottleDownRatio: 0.7, // 동압이 Max-Q 한계의 이 비율을 넘으면 스로틀을 낮춤
    maxQThrottleUpRatio: 0.6, // 이 비율 아래로 내려오면 다시 최대로
    targetApoapsisAltitude: 85_000, // 목표 원지점 고도 (m)
    circularizeStartVerticalSpeed: 120, // 수직 속도(m/s)가 이 값보다 작아지면 원궤도 연소 시작
    circularizePitchPerVerticalSpeed: 0.25, // 떨어지는 속도 1 m/s 당 기수를 드는 각도 (°)
    reentryPeriapsisAltitude: 30_000, // 자동 재진입: 역추진으로 낮출 근지점 고도 (m)
    // 부스터 착륙 미션: 자동 궤도 진입이 1단 연료를 이 비율만큼 남기고 분리한다 (착륙용 연료)
    boosterReserveFuelRatio: 0.35,
  },

  // ── 재진입 가열 ───────────────────────────────────────────
  // 대류 열유속 (Sutton–Graves 식): q̇ = k · √(ρ / r_n) · v³   [W/m²]
  //   r_n = 앞면(공기를 맞는 면) 반지름 (m) — 붙어 있는 가장 굵은 부품의 반지름을 쓴다
  //   실제 지구 대기의 k 는 1.7415e-4 이다. 축소 행성은 궤도 속도가 실제의 약 1/3 이라
  //   (v³ 이므로 열이 약 1/30), 재진입이 실감 나도록 게임 배율을 곱한다.
  // 표면 온도 (한 덩어리 모델): C · dT/dt = q̇ − ε·σ·(T⁴ − T_주변⁴)
  // 온도가 앞면 부품이 버티는 최고 온도를 넘으면 기체가 탄다(파손).
  heating: {
    fluxCoefficient: 1.7415e-4 * 8, // k (SI, 게임 배율 8 포함)
    emissivity: 0.8, // 방사율 ε (0~1)
    heatCapacityPerArea: 25_000, // 면적당 열용량 C (J/m²·K) — 클수록 천천히 뜨거워진다
    ambientTemperature: 250, // 우주·고층 대기 기준 온도 (K)
    // 열 차폐막 보호 각도: 맨 아래가 열 차폐막이고, 꼬리가 진행 방향을 향한 각도(역진행에서 벗어난 각)가
    // 이 값 이하이면 열 차폐막이 열을 받는다 (한계 = 열 차폐막 최고 온도)
    shieldMaxAngleDeg: 40,
    // 열 차폐막(뭉툭한 면)이 앞일 때 항력 계수 — 높은 곳에서 크게 감속해 동압·열이 줄어든다
    shieldDragCoefficient: 1.2,
    warningRatio: 0.8, // 온도가 한계의 이 비율을 넘으면 경고
  },

  // ── 낙하산 ────────────────────────────────────────────────
  // P 로 펼친다. 처음에는 작은 면적(보조 낙하산)만 펴지고, 아래 고도에서 다 펼쳐진다.
  // 항력 D = ½ρv²·Cd·A 로 기체 항력에 더해지고, 펼친 동안 기체는 낙하산 아래로 매달려 기수가 위를 향한다.
  parachute: {
    dragCoefficient: 1.3, // 낙하산 항력 계수 Cd
    maxDeploySpeed: 350, // 이보다 빠르면(공기 기준) 펼치는 순간 찢어진다 (m/s)
    maxDeployDynamicPressure: 12_000, // 이보다 동압이 크면 찢어진다 (Pa)
    fullDeployAltitude: 1_500, // 이 고도(m) 아래에서 다 펼친다 — 위에서는 보조 낙하산 면적만
    openingTime: 3, // 면적이 다 펼쳐지는 데 걸리는 시간 (s)
    alignRateDeg: 45, // 펼친 동안 기체가 낙하산 아래로 돌아가는 최대 속도 (°/s)
  },

  // ── RCS (자세제어 추진기로 평행이동) ──────────────────────
  // R 로 켜고, H/N(앞/뒤)·J/L(좌/우)·I/K(아래/위)로 기체를 돌리지 않고 밀어 움직인다.
  rcs: {
    thrust: 1_500, // 축마다 최대 추력 (N)
    isp: 240, // 비추력 (s) — 현재 단의 연료를 쓴다
  },

  // ── 도킹 ──────────────────────────────────────────────────
  // 도킹 포트끼리 아래 조건을 모두 만족하면 결합한다.
  docking: {
    captureDistance: 1.0, // 포트 사이 거리 (m)
    maxRelativeSpeed: 0.5, // 상대 속도 (m/s)
    maxAlignmentDeg: 10, // 두 포트 축이 마주 보는 방향에서 벗어난 각도 (°)
    crashSpeed: 2.0, // 포트 근처(1.5 m)에서 이보다 빠르면 충돌·파손 (m/s)
    undockSpeed: 0.3, // 분리할 때 서로 밀어내는 상대 속도 (m/s)
    autoDockRange: 20_000, // 자동 도킹을 시작할 수 있는 최대 거리 (m)
    // 자동 도킹 접근 단계
    approachStandoff: 30, // 포트 앞 대기 지점까지 거리 (m)
    maxApproachSpeed: 40, // 접근 중 최대 상대 속도 (m/s)
    finalApproachSpeed: 0.3, // 포트에 닿기 직전 접근 속도 (m/s)
    closingSpeedPerMeter: 0.03, // 포트에서 1 m 멀어질 때마다 더 빨리 다가가는 속도 (m/s)
    maxClosingSpeed: 1.2, // 포트 접근 최대 속도 (m/s)
  },

  // ── 우주 정거장 (도킹 미션 목표) ──────────────────────────
  station: {
    orbitAltitude: 85_000, // 원궤도 고도 (m)
    mass: 15_000, // 질량 (kg)
    length: 14, // 길이 (m) — 아래 끝에서 도킹 포트(맨 위)까지
    radius: 2, // 몸통 반지름 (m)
    // 자동 궤도 진입을 마친 순간 정거장이 이만큼 앞(m)에 있도록 처음 위치를 정한다
    rendezvousLead: 3_000,
    fallbackPhaseDeg: 25, // 미리 계산이 실패하면 발사장보다 이 각도만큼 앞에 둔다 (°)
  },

  // ── 경고 기준 ─────────────────────────────────────────────
  warnings: {
    maxQWarningRatio: 0.8, // 동압이 Max-Q 한계의 이 비율을 넘으면 경고 (0~1)
    lowFuelRatio: 0.1, // 현재 단 연료가 용량의 이 비율 아래면 연료 부족 경고 (0~1)
    // 자세 불안정: 받음각(기수와 진행 방향 사이 각)이 이 값을 넘고,
    // 동압이 아래 최소값 이상일 때 경고한다.
    unstableAngleOfAttackDeg: 10, // (°)
    unstableMinDynamicPressure: 1_000, // (Pa)
  },

  // ── 시간 가속 ────────────────────────────────────────────
  // 같은 고정 시간 간격을 한 프레임에 여러 번 돌려 빠르게 진행한다 (물리 정확도는 1× 와 같다).
  timeWarp: {
    levels: [1, 2, 5, 10, 50, 100, 1_000], // 선택할 수 있는 배율
    maxInAtmosphere: 10, // 대기권 안(대기 상한 아래)에서 최대 배율
    maxWhileThrusting: 5, // 엔진·RCS 를 쓰는 중 최대 배율
    maxNearSurface: 100, // 기준 천체 지표에서 아래 고도보다 가까우면 최대 배율
    nearSurfaceAltitude: 150_000, // (m)
    maxStepsPerFrame: 2_500, // 한 화면 프레임에 돌릴 최대 물리 스텝 수 (화면 멈춤 방지)
  },

  // ── 조종 ──────────────────────────────────────────────────
  controls: {
    initialThrottle: 0, // 발사대 대기 시 스로틀 (0~1)
    throttleRate: 0.5, // Shift/Ctrl 을 누르고 있을 때 스로틀 변화 속도 (1/s, 0.5 = 초당 50%)
    pitchRateDeg: 20, // W/S 최대 피치 회전 속도 (°/s)
    yawRateDeg: 20, // A/D 최대 요 회전 속도 (°/s)
    rollRateDeg: 40, // Q/E 최대 롤 회전 속도 (°/s)
    // 회전 속도가 목표값을 따라가는 빠르기 (1/s). 클수록 즉각, 작을수록 부드럽다.
    // 키를 떼면 목표 회전 속도가 0 이 되어 같은 빠르기로 회전이 멈춘다.
    attitudeResponse: 4,
  },

  // ── 발사장 ────────────────────────────────────────────────
  launchSite: {
    direction: [0, 1, 0], // 행성 중심에서 발사장 쪽 단위벡터
    padHeight: 3, // 발사대 상판 높이 (m, 해수면 기준)
    padRadius: 15, // 발사대 상판 반지름 (m). 이 안에서는 상판 높이가 지면이다.
  },

  // ── 부품 목록 ─────────────────────────────────────────────
  // dryMass: 연료를 뺀 질량 (kg)        fuelMass: 실을 수 있는 연료 질량 (kg)
  // thrust:  최대 추력 (N)               isp:      비추력 (s)
  // length:  부품 길이 (m)               radius:   부품 반지름 (m)
  parts: {
    capsule: {
      name: '탑재물 캡슐 (도킹 포트)',
      kind: 'payload',
      dockingPort: true, // 맨 위에 있으면 도킹 포트로 쓸 수 있다
      dryMass: 600,
      fuelMass: 0,
      thrust: 0,
      isp: 0,
      length: 2.2,
      radius: 1.0,
      maxTemperature: 1_400, // 버티는 최고 표면 온도 (K)
    },
    heavyPayload: {
      name: '중량 화물',
      kind: 'payload',
      dryMass: 25_000,
      fuelMass: 0,
      thrust: 0,
      isp: 0,
      length: 3.0,
      radius: 1.25,
      maxTemperature: 1_200, // 버티는 최고 표면 온도 (K)
    },
    tankLarge: {
      name: '대형 연료탱크',
      kind: 'tank',
      dryMass: 550,
      fuelMass: 6_500,
      thrust: 0,
      isp: 0,
      length: 8.0,
      radius: 1.25,
      maxTemperature: 1_300, // 버티는 최고 표면 온도 (K)
    },
    tankSmall: {
      name: '소형 연료탱크',
      kind: 'tank',
      dryMass: 150,
      fuelMass: 1_500,
      thrust: 0,
      isp: 0,
      length: 3.5,
      radius: 1.0,
      maxTemperature: 1_300, // 버티는 최고 표면 온도 (K)
    },
    engineLifter: {
      name: '1단 엔진 LV-200',
      kind: 'engine',
      dryMass: 1_500,
      fuelMass: 0,
      thrust: 200_000,
      isp: 290,
      length: 2.4,
      radius: 1.25,
      maxTemperature: 1_700, // 버티는 최고 표면 온도 (K)
    },
    engineVacuum: {
      name: '2단 엔진 VX-60',
      kind: 'engine',
      dryMass: 500,
      fuelMass: 0,
      thrust: 60_000,
      isp: 340,
      length: 1.6,
      radius: 0.8,
      maxTemperature: 1_700, // 버티는 최고 표면 온도 (K)
    },
    engineVacuumHeavy: {
      name: '2단 엔진 VX-120',
      kind: 'engine',
      dryMass: 900,
      fuelMass: 0,
      thrust: 120_000,
      isp: 335,
      length: 1.9,
      radius: 1.0,
      maxTemperature: 1_700, // 버티는 최고 표면 온도 (K)
    },
    engineHeavy: {
      name: '대형 1단 엔진 LV-450',
      kind: 'engine',
      dryMass: 3_000,
      fuelMass: 0,
      thrust: 450_000,
      isp: 290,
      length: 3.0,
      radius: 1.25,
      maxTemperature: 1_700, // 버티는 최고 표면 온도 (K)
    },
    engineLander: {
      name: '착륙 엔진 LM-15',
      kind: 'engine',
      dryMass: 250,
      fuelMass: 0,
      thrust: 15_000, // 달 중력에서 천천히 조절하기 좋은 작은 추력
      isp: 320,
      length: 1.1,
      radius: 0.8,
      maxTemperature: 1_600, // 버티는 최고 표면 온도 (K)
    },
    heatShield: {
      name: '열 차폐막',
      kind: 'heatShield', // 맨 아래(꼬리 쪽)에 있고 꼬리가 진행 방향을 향하면 재진입 열을 막는다
      dryMass: 300,
      fuelMass: 0,
      thrust: 0,
      isp: 0,
      length: 0.35,
      radius: 1.05,
      maxTemperature: 3_000,
    },
    parachute: {
      name: '낙하산',
      kind: 'parachute', // P 로 펼친다
      dryMass: 100,
      fuelMass: 0,
      thrust: 0,
      isp: 0,
      length: 0.6,
      radius: 0.55,
      maxTemperature: 1_300,
      canopyArea: 400, // 다 펼친 면적 (m²) — 1톤이면 해수면에서 약 5.5 m/s 로 내려온다
      semiArea: 25, // 보조 낙하산(처음) 면적 (m²)
    },
    decoupler: {
      name: '단 분리기',
      kind: 'decoupler',
      dryMass: 100,
      fuelMass: 0,
      thrust: 0,
      isp: 0,
      length: 0.4,
      radius: 1.25,
      maxTemperature: 1_400, // 버티는 최고 표면 온도 (K)
    },
  },

  // ── 테스트용 로켓 구성 ───────────────────────────────────
  // stages[0] 이 맨 아래(먼저 점화되는) 단이다. 각 단의 parts 는 아래→위 순서이다.
  testRockets: {
    basic: {
      name: '기본 1단 로켓',
      stages: [{ parts: ['engineLifter', 'tankLarge', 'capsule'] }],
    },
    overloaded: {
      name: '과적재 로켓 (TWR < 1)',
      stages: [{ parts: ['engineLifter', 'tankLarge', 'heavyPayload', 'capsule'] }],
    },
    // 단 분리기는 아래 단에 속해 함께 떨어져 나간다.
    twoStage: {
      name: '2단 로켓',
      stages: [
        { parts: ['engineLifter', 'tankLarge', 'decoupler'] },
        { parts: ['engineVacuum', 'tankSmall', 'capsule'] },
      ],
    },
    // 재진입·회수용: 1단 → 2단(궤도 진입·역추진) → 회수 캡슐(열 차폐막 + 캡슐 + 낙하산)
    recovery: {
      name: '회수 캡슐 로켓 (3단)',
      stages: [
        { parts: ['engineLifter', 'tankLarge', 'decoupler'] },
        { parts: ['engineVacuum', 'tankSmall', 'decoupler'] },
        { parts: ['heatShield', 'capsule', 'parachute'] },
      ],
    },
    // 달 미션용: 1단(대형 엔진) → 2단(궤도 진입·달 전이·달 궤도 진입) → 착륙선
    moonRocket: {
      name: '달 탐사 로켓 (3단)',
      stages: [
        { parts: ['engineHeavy', 'tankLarge', 'tankLarge', 'decoupler'] },
        { parts: ['engineVacuumHeavy', 'tankLarge', 'decoupler'] },
        { parts: ['engineLander', 'tankSmall', 'capsule'] },
      ],
    },
  },
  defaultTestRocket: 'twoStage',
});
