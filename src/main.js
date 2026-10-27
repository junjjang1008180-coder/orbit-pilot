/**
 * ORBIT PILOT 앱 진입점
 * ------------------------------------------------------------
 * 시뮬레이션(물리), 3D 화면, 입력, UI, 효과·소리를 만들고 매 프레임 연결만 담당한다.
 * 물리 계산은 FlightSimulation, 화면은 각 view 모듈, 입력은 controls 모듈이 맡는다.
 *
 * 앱 흐름: 설계 화면(design) → 발사 → 비행 화면(flight, M 키로 지도, B 키로 부스터 조종)
 *          → 결과 → 재시작/설계
 */
import * as THREE from 'three';
import { PHYSICS_CONFIG } from './config/physicsConfig.js';
import { DIFFICULTY_LEVELS, DEFAULT_DIFFICULTY, applyDifficulty } from './config/difficulty.js';
import { computeGuide } from './autopilot/flightGuide.js';
import { MISSION_CONFIG } from './config/missionConfig.js';
import { ASSET_CONFIG } from './config/assetConfig.js';
import { FlightSimulation } from './core/simulation.js';
import { currentThrust, maxThrust } from './physics/flightPhysics.js';
import { airDensity } from './physics/aerodynamics.js';
import { vec3 } from './physics/vectorMath.js';
import { moonState } from './physics/celestialBodies.js';
import { createSceneSetup, SUN_DIRECTION } from './scene/sceneSetup.js';
import { updateSunView } from './scene/sunShading.js';
import { createPlanetView } from './scene/planetView.js';
import { createMoonView } from './scene/moonView.js';
import { createLaunchPadView } from './scene/launchPadView.js';
import { createLaunchSiteScenery } from './scene/launchSiteScenery.js';
import { createEnvironmentMap } from './scene/environmentMap.js';
import { toRenderPosition, toRenderQuaternion } from './scene/renderCoordinates.js';
import { createMapView } from './scene/mapView.js';
import { createRocketView } from './rocket/rocketView.js';
import { createShuttleView } from './rocket/shuttleView.js';
import { createDebrisViews } from './rocket/debrisView.js';
import { createChaseCamera } from './camera/chaseCamera.js';
import { createMapCamera } from './camera/mapCamera.js';
import { createFlightControls } from './controls/flightControls.js';
import { createCameraMouseInput } from './controls/cameraMouseInput.js';
import { createHud } from './ui/hud.js';
import { createNavball } from './ui/navball.js';
import { createMissionPanel } from './ui/missionPanel.js';
import { createDesignScreen } from './design/designScreen.js';
import { createMissionTracker } from './missions/missionTracker.js';
import { loadModelLibrary } from './assets/modelLibrary.js';
import { createEngineFlame } from './effects/engineFlame.js';
import { createExplosionEffects } from './effects/explosionEffect.js';
import { createSoundManager } from './audio/soundManager.js';
import { createLandingZoneView } from './landing/landingZoneView.js';
import { createTutorial } from './tutorial/tutorialOverlay.js';
import { createStationView } from './docking/stationView.js';
import { createManeuverPanel } from './ui/maneuverPanel.js';
import { createParachuteView } from './effects/parachuteView.js';
import { createReentryGlow } from './effects/reentryGlow.js';
import { createCockpitView } from './scene/cockpitView.js';
import { createShuttleCockpitView } from './scene/shuttleCockpit.js';
import { createRunwayView } from './landing/runwayView.js';
import { runwayList } from './landing/runway.js';

const config = PHYSICS_CONFIG;

// ── 외부 에셋 (없거나 실패하면 기본 도형) ─────────────────
const modelLibrary = await loadModelLibrary(ASSET_CONFIG, Object.keys(config.parts));
const sound = createSoundManager(ASSET_CONFIG);

// ── 시뮬레이션 ─────────────────────────────────────────────
// 설계 화면에서 발사하기 전까지는 기본 예시 로켓을 발사대에 세워 둔다 (진행하지 않음)
const simulation = new FlightSimulation(config, config.testRockets[config.defaultTestRocket]);
let appMode = 'design'; // 'design' = 설계 화면, 'flight' = 비행 중
let missionTracker = null;
let lastMissionStatus = 'active';

// ── 3D 장면 ───────────────────────────────────────────────
const viewportElement = document.getElementById('viewport');
const { renderer, scene, camera, updateEnvironment, updatePlanetLight, updateMoonFill, registerCamera, updateSunGlare } = createSceneSetup(viewportElement);
const sunOccluders = [
  { center: new THREE.Vector3(), radius: config.planet.radius },
  { center: new THREE.Vector3(), radius: config.moon?.radius ?? 0 },
];
const planetView = createPlanetView(config, modelLibrary);
const moonView = createMoonView(config);
const launchPadView = createLaunchPadView(config, modelLibrary);
const scenery = createLaunchSiteScenery(config);
const rocketEnvMap = createEnvironmentMap(renderer); // 로켓 금속 부품 반사용
const stationView = createStationView(scene, config, { envMap: rocketEnvMap });
scene.add(planetView.group, moonView.group, launchPadView.group, scenery.group);
const debrisViews = createDebrisViews(scene, config);
const explosions = createExplosionEffects(scene);
const landingZoneView = createLandingZoneView(scene, config, planetView, modelLibrary);
const reentryGlow = createReentryGlow(scene);
const cockpitView = createCockpitView(scene); // 1인칭 조종석 실내 (캡슐)
const shuttleCockpitView = createShuttleCockpitView(scene); // 1인칭 조종석 실내 (우주 왕복선 비행 갑판)
const runwayViews = runwayList(config).map((r) => createRunwayView(config, r)); // 우주 왕복선 착륙 활주로들
for (const v of runwayViews) scene.add(v.group);
const parachuteView = createParachuteView();

let rocketView;
let rocketFlame = null; // 로켓 본체 엔진 불꽃 (현재 단 크기에 맞춤)
let rocketFlameStage = -1;
let viewedState = null; // 화면이 표시 중인 비행 (재시작·로켓 교체 감지용)

/** 새 비행이 시작되면(재시작·로켓 교체) 로켓 모델과 효과를 새로 만든다 */
function rebuildRocketView() {
  if (rocketView) scene.remove(rocketView.group);
  debrisViews.clear();
  explosions.clear();
  landingZoneView.clear();
  rocketView = simulation.rocket.isShuttle
    ? createShuttleView(simulation.rocket, config, { envMap: rocketEnvMap })
    : createRocketView(simulation.rocket, modelLibrary, { envMap: rocketEnvMap });
  launchPadView.setShuttle(simulation.rocket.isShuttle); // 왕복선이면 빨간 철골 발사탑
  rocketView.group.add(parachuteView.group); // 펼친 낙하산은 로켓 꼭대기에 매단다
  rocketView.group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true; // 발사대·지면에 그림자
  });
  scene.add(rocketView.group);
  rocketFlame = null;
  rocketFlameStage = -1;
  viewedState = simulation.state;
}
rebuildRocketView();

/** 현재 단이 바뀌면 그 단 크기에 맞는 불꽃으로 교체 */
function ensureRocketFlame(stageIndex) {
  if (rocketFlameStage === stageIndex) return;
  if (rocketFlame) rocketView.group.remove(rocketFlame.group);
  rocketFlame = createEngineFlame(rocketView.stageRadii[stageIndex] ?? 1);
  rocketView.group.add(rocketFlame.group);
  rocketFlameStage = stageIndex;
}

// ── 지도(궤도) 화면 ───────────────────────────────────────
const mapCameraObject = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
registerCamera(mapCameraObject);
const mapCamera = createMapCamera(mapCameraObject, config);
const mapView = createMapView(config, document.getElementById('map-labels'), {
  onFocus: (mode) => mapCamera.setFocusMode(mode),
  onReset: () => mapCamera.reset(),
});
const MAP_FOCUS_ORDER = ['auto', 'rocket', 'planet', 'moon'];
const mapKeysHeld = new Set(); // 지도 화면에서 누르고 있는 방향키

// 지도 화면 키: 방향키 회전, +/− 확대·축소, F 초점 바꾸기, 0 초기화 (비행 키와 겹치지 않는 키만)
window.addEventListener('keydown', (e) => {
  if (viewMode !== 'map' || appMode !== 'flight' || e.metaKey || e.target instanceof HTMLInputElement) return;
  if (e.code.startsWith('Arrow')) {
    mapKeysHeld.add(e.code);
    e.preventDefault();
  } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
    mapCamera.zoom(-180);
  } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
    mapCamera.zoom(180);
  } else if (e.code === 'KeyF' && !e.repeat) {
    const i = MAP_FOCUS_ORDER.indexOf(mapCamera.getFocusMode());
    mapCamera.setFocusMode(MAP_FOCUS_ORDER[(i + 1) % MAP_FOCUS_ORDER.length]);
  } else if (e.code === 'Digit0' && !e.repeat) {
    mapCamera.reset();
  }
});
window.addEventListener('keyup', (e) => mapKeysHeld.delete(e.code));
window.addEventListener('blur', () => mapKeysHeld.clear());
let viewMode = 'flight'; // 'flight' = 비행 화면, 'map' = 지도 화면

function setViewMode(mode) {
  viewMode = mode;
  mapView.setVisible(mode === 'map' && appMode === 'flight');
  document.body.dataset.view = mode;
}

// ── 카메라와 입력 ─────────────────────────────────────────
const chaseCamera = createChaseCamera(camera, config);
// 마우스 조작은 지금 보고 있는 화면의 카메라로 전달 (튜토리얼은 조작 횟수만 센다)
let cameraInteractions = 0;
createCameraMouseInput(renderer.domElement, {
  rotate: (dx, dy) => {
    cameraInteractions++;
    (viewMode === 'map' ? mapCamera : chaseCamera).rotate(dx, dy);
  },
  zoom: (dy) => {
    cameraInteractions++;
    (viewMode === 'map' ? mapCamera : chaseCamera).zoom(dy);
  },
  // 지도에서 행성·달을 더블클릭하면 그 천체로 초점
  onDoubleClick: (x, y) => {
    if (viewMode !== 'map') return;
    const body = mapView.pickBody(x, y, mapCameraObject, { width: viewportElement.clientWidth, height: viewportElement.clientHeight });
    if (body) mapCamera.setFocusMode(body);
  },
});
const flightControls = createFlightControls(() => simulation, {
  isEnabled: () => appMode === 'flight', // 설계 화면에서는 비행 키를 무시
  onUiAction: (action) => {
    if (action === 'toggleMap') setViewMode(viewMode === 'map' ? 'flight' : 'map');
    if (action === 'toggleCamera') {
      const mode = chaseCamera.toggleMode();
      document.body.dataset.camera = mode;
      cockpitFrame.hidden = mode !== 'cockpit';
    }
  },
});

// 1인칭 시점 창틀 (화면 가장자리 어두운 테두리와 안내)
const cockpitFrame = document.createElement('div');
cockpitFrame.className = 'cockpit-frame';
cockpitFrame.hidden = true;
cockpitFrame.innerHTML = '<span>👨‍🚀 1인칭 시점 · 드래그 = 둘러보기 · 휠 = 시야각 · <kbd>C</kbd> 추적 시점</span>';
document.body.appendChild(cockpitFrame);

// ── UI ───────────────────────────────────────────────────
const hud = createHud(document.getElementById('hud'));
const navball = createNavball(document.getElementById('navball'), config);
const maneuverPanel = createManeuverPanel(hud.maneuverRoot, {
  create: (which) => simulation.addManeuverAtApsis(which),
  circularize: () => simulation.addCircularizeManeuver(),
  moonTransfer: () => simulation.planMoonTransfer(),
  adjust: (delta) => simulation.adjustManeuver(delta),
  remove: () => simulation.removeManeuver(),
  execute: () => {
    if (simulation.getControlled().autopilot.program !== 'maneuver') simulation.toggleAutopilot();
  },
});

// 지도 화면에서 궤도선을 왼쪽 클릭하면 그 지점에 기동 노드를 만든다 (드래그는 무시)
{
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 0) down = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !down || viewMode !== 'map' || appMode !== 'flight') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 3 || simulation.getControlled() !== simulation.state) return;
    const time = mapView.pickOrbitTime(e.clientX, e.clientY, simulation, mapCameraObject, {
      width: viewportElement.clientWidth,
      height: viewportElement.clientHeight,
    });
    if (time !== null) {
      simulation.removeManeuver();
      simulation.addManeuver({ time });
    }
  });
}
const missionPanel = createMissionPanel(document.getElementById('mission-panel'), document.getElementById('mission-result'), {
  onRestart: () => startFlight(),
  onBackToDesign: () => openDesign(),
  onToggleSound: () => {
    sound.setMuted(!sound.isMuted());
    return sound.isMuted();
  },
});

let currentMissionId = MISSION_CONFIG.defaultMission;
const designScreen = createDesignScreen(document.getElementById('design-screen'), {
  physicsConfig: config,
  missionConfig: MISSION_CONFIG,
  presets: config.testRockets,
  initialPreset: config.defaultTestRocket,
  difficulties: DIFFICULTY_LEVELS,
  initialDifficulty: loadDifficulty(),
  onDifficultyChange: saveDifficulty,
  modelLibrary,
  onTutorial: () => tutorial.start(),
  onLaunch: ({ definition, missionId, difficulty }) => {
    currentMissionId = missionId;
    saveDifficulty(difficulty);
    // 난이도: 기준값을 바꾼 물리 설정으로 비행한다 (원래 설정은 그대로)
    simulation.setConfig(applyDifficulty(config, difficulty));
    landingZoneView.setRadius(simulation.config.landing.landingZoneRadius);
    // 도킹 미션이면 우주 정거장을 띄운다
    const mission = MISSION_CONFIG.missions[missionId];
    simulation.setScenario({ station: Boolean(mission.spawnsStation), boosterRecovery: Boolean(mission.usesLanding), glideStart: Boolean(mission.startsGliding) });
    simulation.loadRocket(definition); // 설계한 부품·질량·연료·단 구성이 그대로 비행에 쓰인다
    startFlight();
  },
});

// ── 튜토리얼 ─────────────────────────────────────────────
const tutorial = createTutorial(document.getElementById('tutorial'), {
  // 튜토리얼 시작: 설계 화면에 연습용 2단 로켓과 저궤도 미션을 준비
  onStart: () => {
    openDesign();
    designScreen.loadPreset(config.defaultTestRocket);
    designScreen.setMission('lowOrbit');
  },
});

/** 난이도 기억 (이 브라우저) */
function loadDifficulty() {
  try {
    const saved = localStorage.getItem('orbitPilot.difficulty');
    return DIFFICULTY_LEVELS[saved] ? saved : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}
function saveDifficulty(level) {
  try {
    localStorage.setItem('orbitPilot.difficulty', level);
  } catch {
    /* 저장할 수 없으면 무시 */
  }
}

/** 현재 로켓으로 새 비행 시작 (발사대에서) */
function startFlight() {
  simulation.reset();
  missionTracker = createMissionTracker(currentMissionId, { missions: MISSION_CONFIG, physics: simulation.config });
  lastMissionStatus = 'active';
  missionPanel.hideResult();
  flightControls.keyboard.releaseAll();
  appMode = 'flight';
  designScreen.hide();
  setViewMode('flight');
  document.body.dataset.app = 'flight';
  tutorial.onFlightRestart();
}

/** 설계 화면 열기 (비행은 멈춘다) */
function openDesign() {
  appMode = 'design';
  missionPanel.hideResult();
  setViewMode('flight');
  designScreen.show();
  document.body.dataset.app = 'design';
  sound.updateEngine(0);
  tutorial.onBackToDesign();
}
openDesign();
tutorial.offerIfFirstVisit();

/** 실제 추력 비율 (0~1) */
function thrustFraction(vehicle) {
  const max = maxThrust(vehicle);
  return max > 0 ? currentThrust(vehicle) / max : 0;
}

/** 해수면 대비 공기 밀도 비율 (불꽃 퍼짐용) */
function densityRatio(vehicle) {
  const alt = vec3.length(vehicle.position) - config.planet.radius;
  return airDensity(alt, config.atmosphere) / config.atmosphere.seaLevelDensity;
}

// ── 프레임 루프 ───────────────────────────────────────────
let lastTime = performance.now();
function frame(now) {
  const realDt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;

  if (appMode === 'design') {
    designScreen.render();
    tutorial.update({ appMode, viewMode, telemetry: null, cameraInteractions }, now / 1000);
    requestAnimationFrame(frame);
    return;
  }

  flightControls.update();
  simulation.advance(realDt);
  if (simulation.state !== viewedState) rebuildRocketView();

  // 효과·소리용 사건 처리
  for (const event of simulation.drainEvents()) {
    sound.play(event);
    if (event.type === 'explosion') explosions.spawn(event.position);
  }

  const state = simulation.state;
  const controlled = simulation.getControlled();
  const telemetry = simulation.getTelemetry();

  // 화면 원점 = 조종 중인 비행체 위치 (그 비행체가 항상 화면 원점에 온다)
  const origin = controlled.position;
  planetView.update(origin, telemetry.planetAltitude, realDt);
  moonView.update(origin, controlled.time);
  const reference = simulation.getReference(controlled); // 기준 천체 (행성 또는 달)
  launchPadView.update(origin);
  scenery.update(origin);
  for (const v of runwayViews) v.update(origin, now / 1000);
  debrisViews.sync(simulation.debris, rocketView, origin, now / 1000);
  landingZoneView.update(simulation.booster?.landingZone ?? null, origin);
  stationView.update(simulation.station, origin, now / 1000);
  explosions.update(realDt, origin);

  rocketView.layout(state.currentStage);
  toRenderPosition(state.position, origin, rocketView.group.position);
  rocketView.group.visible = !state.destroyed; // 파손되면 로켓을 숨긴다
  toRenderQuaternion(state.orientation, rocketView.group.quaternion);
  if (rocketView.isShuttle) {
    // 우주 왕복선: 불꽃 7개·바퀴·에어브레이크·감속 낙하산을 모델이 직접 움직인다
    rocketView.update(state, densityRatio(state), now / 1000, realDt);
    parachuteView.update(0, rocketView.height);
  } else {
    ensureRocketFlame(state.currentStage);
    rocketFlame.update(state.destroyed ? 0 : thrustFraction(state), densityRatio(state), now / 1000);
    parachuteView.update(state.landed || state.destroyed ? 0 : state.parachuteArea, rocketView.height);
  }
  reentryGlow.update(state, origin, now / 1000);

  const controlledHeight = controlled === state
    ? rocketView.height
    : rocketView.stageHeights[simulation.booster.stageIndex];
  const shuttleCabin = Boolean(rocketView.isShuttle && controlled === state);
  chaseCamera.update(controlled, controlledHeight, reference.position, shuttleCabin ? rocketView.cockpitEye(state.currentStage) : null);
  // 1인칭: 조종석 실내를 눈 위치·로켓 자세에 맞춰 두고, 로켓 겉모습은 숨긴다 (눈이 조종석 안)
  const inCockpit = chaseCamera.getMode() === 'cockpit' && viewMode === 'flight';
  cockpitView.update(inCockpit && !shuttleCabin, camera.position, controlled, telemetry, now / 1000, realDt);
  shuttleCockpitView.update(inCockpit && shuttleCabin, camera.position, controlled, telemetry, now / 1000, realDt);
  if (inCockpit && controlled === state) rocketView.group.visible = false;
  updateEnvironment(
    vec3.normalize(controlled.position),
    telemetry.planetAltitude,
    { planetRadius: config.planet.radius, atmosphereTop: config.atmosphere.topAltitude },
    telemetry.altitude,
  );
  updatePlanetLight(vec3.scale(vec3.normalize(controlled.position), -1), telemetry.planetAltitude);
  updateMoonFill(reference.id === 'moon' ? vec3.normalize(vec3.sub(controlled.position, reference.position)) : null, telemetry.altitude);
  sound.updateEngine(controlled.destroyed ? 0 : thrustFraction(controlled));

  hud.update(telemetry);
  // 비행 가이드 (난이도에서 켰을 때)
  const guide = simulation.config.difficulty?.assists.guide ? computeGuide(simulation, telemetry) : null;
  hud.setGuide(guide);
  maneuverPanel.update(telemetry);
  // 부스터를 조종 중이면 착륙 지점 방향, 로켓이면 도킹 목표(정거장) 방향을 네비볼에 표시
  navball.update(
    controlled,
    telemetry,
    controlled === state ? (telemetry.shuttle?.winged ? telemetry.shuttle.threshold : null) : simulation.booster?.landingZone ?? null,
    simulation.getTarget(controlled),
    telemetry.maneuver?.direction ?? null,
    reference,
    guide?.direction ?? null,
  );
  const missionStatus = missionTracker.update(simulation.getMissionTelemetry());
  // 미션 결과가 처음 나온 순간 시간 가속을 멈춘다
  if (missionStatus.status !== 'active' && lastMissionStatus === 'active') simulation.setTimeWarp(1);
  lastMissionStatus = missionStatus.status;
  missionPanel.update(missionStatus, viewedState);
  tutorial.update({ appMode, viewMode, telemetry, cameraInteractions }, now / 1000);

  if (viewMode === 'map') {
    // 방향키로 회전 (누르고 있는 동안)
    const keyRotate = 220 * realDt;
    if (mapKeysHeld.has('ArrowLeft')) mapCamera.rotate(-keyRotate, 0);
    if (mapKeysHeld.has('ArrowRight')) mapCamera.rotate(keyRotate, 0);
    if (mapKeysHeld.has('ArrowUp')) mapCamera.rotate(0, keyRotate);
    if (mapKeysHeld.has('ArrowDown')) mapCamera.rotate(0, -keyRotate);
    mapCamera.update(mapView.focusFor(simulation, mapCamera.getFocusMode()), realDt);
    mapView.update(
      simulation,
      mapCameraObject,
      { width: viewportElement.clientWidth, height: viewportElement.clientHeight },
      mapCamera.getFocusMode(),
    );
    updateSunView(mapCameraObject, SUN_DIRECTION);
    renderer.render(mapView.scene, mapCameraObject);
  } else {
    updateSunView(camera, SUN_DIRECTION);
    toRenderPosition([0, 0, 0], origin, sunOccluders[0].center);
    if (config.moon) toRenderPosition(moonState(config, controlled.time).position, origin, sunOccluders[1].center);
    updateSunGlare(sunOccluders, !inCockpit);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.getElementById('boot')?.remove(); // 준비 끝 — 로딩 화면 치우기

// 브라우저 콘솔·자동 검수용 읽기 창구 (게임 로직에서는 쓰지 않는다)
window.orbitPilot = {
  simulation,
  scene,
  renderer,
  config,
  chaseCamera,
  mapCamera,
  keyboard: flightControls.keyboard,
  designScreen,
  modelLibrary,
  sound,
  explosions,
  getViewMode: () => viewMode,
  getAppMode: () => appMode,
  getMissionStatus: () => missionTracker?.getStatus() ?? null,
  tutorial,
};
