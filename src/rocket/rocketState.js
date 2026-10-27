/**
 * 비행 중인 로켓의 상태(시뮬레이션의 유일한 기준 데이터)
 * ------------------------------------------------------------
 * 위치·속도·자세·단별 연료 등 물리 상태를 한 객체에 모은다.
 * 화면(Three.js)과 UI 는 이 상태를 읽기만 하고 직접 바꾸지 않는다.
 *
 * 로켓 위치 기준점: 로켓 맨 아래 끝(엔진 노즐 끝). 지면 접촉 판정에 쓴다.
 * 로켓 로컬 축: +Y = 기수(앞), -Z = 배(W 키로 기수를 내리면 향하는 쪽), +X = 오른쪽.
 * 발사대에서는 기수가 위, 배가 동쪽을 보도록 세운다.
 */
import { vec3, quat } from '../physics/vectorMath.js';
import { localFrame } from '../physics/referenceFrame.js';
import { createAutopilotState } from '../autopilot/autopilot.js';

/**
 * @param {typeof import('../config/physicsConfig.js').PHYSICS_CONFIG} config
 * @param {ReturnType<typeof import('./rocketDefinition.js').buildRocket>} rocket
 */
export function createRocketState(config, rocket) {
  const { planet, launchSite } = config;
  const siteDirection = vec3.normalize(launchSite.direction);
  const position = vec3.scale(siteDirection, planet.radius + launchSite.padHeight);
  const frame = localFrame(position, planet.northPoleDirection);

  // 로컬 축 배치: Y(기수)=위, Z=서쪽(배가 동쪽), X = Y × Z
  const yAxis = frame.up;
  const zAxis = vec3.scale(frame.east, -1);
  const xAxis = vec3.cross(yAxis, zAxis);

  return {
    time: 0, // 시뮬레이션 경과 시간 (s)
    position, // 행성 중심 기준 위치 (m)
    velocity: [0, 0, 0], // 관성 좌표계 속도 (m/s)
    orientation: quat.fromBasis(xAxis, yAxis, zAxis), // 자세 쿼터니언
    stages: rocket.stages.map((stage) => ({
      index: stage.index,
      dryMass: stage.dryMass,
      fuel: stage.fuelCapacity, // 남은 연료 (kg)
      fuelCapacity: stage.fuelCapacity,
      maxThrust: stage.maxThrust,
      isp: stage.isp,
      length: stage.length, // 단 길이 (m) — 분리 후 로켓 아래 끝 위치 계산에 쓴다
      maxRadius: stage.maxRadius, // 단 최대 반지름 (m) — 항력 단면적 계산에 쓴다
      bottomShieldTemperature: stage.bottomShieldTemperature, // 맨 아래 열 차폐막 최고 온도 (K, 없으면 0)
      maxTemperature: stage.maxTemperature, // 단 부품이 버티는 최고 온도 (K)
      parachuteArea: stage.parachuteArea, // 낙하산 다 펼친 면적 합 (m²)
      parachuteSemiArea: stage.parachuteSemiArea, // 보조 낙하산 면적 합 (m²)
      parachuteMaxDeploySpeed: stage.parachuteMaxDeploySpeed, // 낙하산을 펼칠 수 있는 최대 속도 (m/s)
      sideMounted: stage.sideMounted, // 옆에 붙은 단 (우주 왕복선)
      ignitesWithStageBelow: stage.ignitesWithStageBelow, // 아래 단과 함께 점화 (주 엔진)
      winged: stage.winged, // 날개 달린 궤도선
    })),
    angularVelocity: [0, 0, 0], // 로컬 축 기준 회전 속도 (rad/s)
    currentStage: 0, // 현재 점화 대상 단 (0 = 맨 아래)
    engineOn: false, // 엔진 점화 여부
    throttle: config.controls.initialThrottle, // 스로틀 0~1
    // 사람이 누르는 조종 입력 (키보드 → setControlInput 명령으로만 바뀐다)
    manualInput: idleInput(),
    // 물리에 실제로 적용되는 조종 입력 (자동조종이 없으면 manualInput 과 같다)
    controls: idleInput(),
    autopilot: createAutopilotState(),
    rcsEnabled: false, // RCS 평행이동 켜짐 (R 키)
    docked: false, // 다른 비행체에 도킹해 함께 움직이는 중
    aborted: false, // 비상 중단 여부 (엔진 정지 + 조종 잠금, 리셋 전까지 유지)
    landed: true, // 지면(발사대) 위에 정지해 있는지
    liftoffBlocked: false, // 엔진을 켰지만 추력이 무게보다 작아 못 뜨는 상태
    lastImpactSpeed: 0, // 마지막 지면 접촉 시 속도 (m/s)
    dynamicPressure: 0, // 현재 동압 (Pa)
    maxDynamicPressureSeen: 0, // 비행 중 최대 동압 (Pa)
    destroyed: false, // 기체 파손 여부 (Max-Q 초과, 지면 충돌)
    destroyedReason: '', // 파손 원인 설명
    touchdown: null, // 마지막 착지 판정 결과 (속도·기울기·안전 여부)
    properAcceleration: planet.surfaceGravity, // 몸으로 느끼는 가속도 (m/s²) — 발사대 위에서는 1 g
    // 우주 왕복선 궤도선
    gearDown: false, // 착륙 바퀴를 내렸는지 (Y)
    brakes: false, // 바퀴 브레이크 / 공중에서는 에어브레이크 (V 를 누르는 동안)
    speedbrake: 0, // 에어브레이크 펼침 (0~1, 자동 착륙이 조절)
    rolling: false, // 바퀴로 활주로를 달리는 중
    ...thermalAndParachuteState(config),
  };
}

/** 재진입 가열·낙하산 상태 초기값 */
function thermalAndParachuteState(config) {
  return {
    skinTemperature: config.heating?.ambientTemperature ?? 250, // 표면 온도 (K)
    heatFlux: 0, // 현재 열유속 (W/m²)
    heatShielded: false, // 지금 열 차폐막이 앞면인지
    thermalLimit: Infinity, // 지금 버틸 수 있는 최고 온도 (K)
    maxSkinTemperature: config.heating?.ambientTemperature ?? 250, // 이번 비행 최고 표면 온도 (K)
    parachute: 'packed', // 'packed' 접힘 · 'deployed' 펼침 · 'torn' 찢어짐 (낙하산이 없으면 의미 없음)
    parachuteArea: 0, // 지금 펼쳐진 낙하산 면적 (m²)
  };
}

/**
 * 분리된 단으로 독립 비행체 상태를 만든다 (로켓 상태와 같은 구조).
 * 엔진이 있는 단(부스터)은 이 상태로 직접 조종할 수 있다.
 * @param {object} parent 분리 직전 로켓 상태
 * @param {object} stage 분리되는 단 (parent.stages 의 항목)
 * @param {{position:number[], velocity:number[]}} motion 분리 직후 위치·속도
 */
export function createSeparatedVehicle(parent, stage, motion) {
  return {
    time: parent.time,
    position: motion.position,
    velocity: motion.velocity,
    orientation: [...parent.orientation],
    angularVelocity: [...parent.angularVelocity],
    stages: [{ ...stage }],
    currentStage: 0,
    engineOn: false, // 분리되면 엔진은 꺼진 상태로 시작
    throttle: 0,
    manualInput: idleInput(),
    controls: idleInput(),
    autopilot: createAutopilotState(),
    rcsEnabled: false,
    docked: false,
    aborted: false,
    landed: parent.landed,
    liftoffBlocked: false,
    lastImpactSpeed: 0,
    dynamicPressure: 0,
    maxDynamicPressureSeen: 0,
    destroyed: false,
    destroyedReason: '',
    touchdown: null,
    properAcceleration: parent.properAcceleration ?? 0,
    gearDown: false,
    brakes: false,
    speedbrake: 0,
    rolling: false,
    skinTemperature: parent.skinTemperature,
    heatFlux: 0,
    heatShielded: false,
    thermalLimit: Infinity,
    maxSkinTemperature: parent.skinTemperature,
    parachute: 'packed',
    parachuteArea: 0,
  };
}

/**
 * 아무것도 누르지 않은 조종 입력
 * translate: RCS 평행이동 [로컬 X(오른쪽), 로컬 Y(앞=기수), 로컬 Z(등쪽)] 각 −1~1
 */
export function idleInput() {
  return { throttleUp: false, throttleDown: false, pitch: 0, yaw: 0, roll: 0, translate: [0, 0, 0], brake: false };
}
