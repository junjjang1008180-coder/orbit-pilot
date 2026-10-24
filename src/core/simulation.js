/**
 * 비행 시뮬레이션 관리자
 * ------------------------------------------------------------
 * - 화면 프레임 시간과 상관없이 고정 시간 간격으로 물리를 진행한다.
 * - 로켓 본체(state)와 분리된 단들(debris)은 모두 같은 구조의 비행체 상태이며,
 *   같은 물리 함수(stepFlight)로 움직인다. 엔진이 있는 분리 단(부스터)은 조종할 수 있다.
 * - UI·입력은 이 클래스의 명령 메서드(throttleMax, setControlInput 등)로만 상태를 바꾸며,
 *   명령은 "지금 조종 중인 비행체" 에 전달된다 (B 키로 로켓 ↔ 부스터 전환).
 * - 화면 표시용 값은 getTelemetry(), 미션 판정용 값은 getMissionTelemetry() 로 읽는다.
 */
import { buildRocket } from '../rocket/rocketDefinition.js';
import { createRocketState, createSeparatedVehicle, idleInput } from '../rocket/rocketState.js';
import {
  stepFlight,
  rocketMass,
  maxThrust,
  currentThrust,
  altitude,
  thrustToWeight,
  noseDirection,
  hasFuel,
  exhaustVelocity,
} from '../physics/flightPhysics.js';
import { airDensity } from '../physics/aerodynamics.js';
import { gravityMagnitudeAtRadius } from '../physics/gravity.js';
import { vec3 } from '../physics/vectorMath.js';
import { computeWarnings } from './flightWarnings.js';
import { computeOrbit, isCircularOrbitAchieved, timeToApsides } from '../orbit/orbitalElements.js';
import { localFrame, elevationAndHeading, toLocalENU } from '../physics/referenceFrame.js';
import { predictImpactPoint, judgeBoosterLanding, surfaceDistance } from '../landing/landing.js';
import { createManeuverNode, evaluateNode, estimateBurn, nodeDeltaV } from '../orbit/maneuver.js';
import { propagateKepler } from '../orbit/kepler.js';
import { predictMoonEncounter, planMoonTransfer, planMoonCorrection } from '../orbit/encounter.js';
import { referenceBodyAt, referenceBodyId, bodyAt, relativeTo } from '../physics/celestialBodies.js';
import { attachedParachute } from '../physics/heating.js';
import {
  createStationVehicle,
  computeStationPhase,
  evaluateDocking,
  dock,
  followStation,
  undock,
  portPosition,
  rocketHasDockingPort,
  dockingProgram,
} from '../docking/docking.js';
import {
  stepAutopilot,
  stopProgram,
  announce,
  SAS_MODES,
  SAS_TARGET_MODES,
  SAS_LABELS,
  PROGRAM_LABELS,
} from '../autopilot/autopilot.js';

/** 이 사건이 생기면 시간 가속을 멈춘다 */
const WARP_BREAK_EVENTS = new Set(['explosion', 'stage', 'landing', 'docked', 'touchdown', 'liftoff', 'soi', 'parachute', 'parachuteTorn']);

function clampUnit(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}


export class FlightSimulation {
  /**
   * @param {object} config PHYSICS_CONFIG
   * @param {{name:string, stages:{parts:string[]}[]}} definition 로켓 구성
   */
  constructor(config, definition, scenario = {}) {
    this.config = config;
    this.accumulator = 0;
    // station: 도킹 미션용 우주 정거장을 띄울지, boosterRecovery: 부스터 착륙 미션 (1단 연료를 남기고 분리)
    this.scenario = { station: false, boosterRecovery: false, ...scenario };
    this.stationPhaseCache = new Map(); // 로켓 구성별 정거장 위상각 (미리 계산 결과)
    this.loadRocket(definition);
  }

  /** 물리 설정 바꾸기 (난이도 적용 등, 다음 loadRocket/reset 부터 적용) */
  setConfig(config) {
    this.config = config;
    this.stationPhaseCache.clear(); // 정거장 위치 미리 계산은 설정(물리)에 따라 달라진다
  }

  /** 비행 조건 설정 (다음 loadRocket/reset 부터 적용) */
  setScenario(scenario) {
    this.scenario = { ...this.scenario, ...scenario };
  }

  /** 로켓 구성을 불러와 발사대 위에 새로 세운다. */
  loadRocket(definition) {
    this.definition = definition;
    this.rocket = buildRocket(definition, this.config.parts);
    this.state = createRocketState(this.config, this.rocket); // 로켓 본체
    this.debris = []; // 분리된 단들 (각각 독립 비행체)
    this.nextDebrisId = 1;
    this.controlledId = 'rocket'; // 지금 조종 중인 비행체: 'rocket' 또는 분리 단 id
    this.booster = null; // 착륙 미니게임 대상 부스터 (엔진이 있는 첫 분리 단)
    this.events = []; // 효과·소리용 사건 목록 (화면이 가져가면 비움)
    this.timeWarpSelected = 1; // 사용자가 고른 시간 가속 배율 (실제 배율은 상황에 따라 제한)
    this.maneuver = null; // 기동 노드 (로켓 본체 기준, 한 번에 하나)
    this.orbitAchievedAt = null; // 원궤도 진입 판정을 처음 만족한 시각 (s), 아직이면 null
    this.hasLiftedOff = false; // 한 번이라도 지면을 떠났는지
    this.liftoffTime = null; // 이륙 시각 (s) — 경과 시간 표시용
    // 달
    this.referenceBodyId = 'planet'; // 로켓 본체가 지금 있는 중력권 ('planet' | 'moon')
    this.moonEncounteredAt = null; // 달 중력권에 처음 들어간 시각 (s)
    this.moonOrbitAchievedAt = null; // 달 궤도 진입 판정을 처음 만족한 시각 (s)
    this.moonLandedAt = null; // 달에 안전하게 착륙한 시각 (s)
    this.encounterCache = new Map(); // 조우 예측 결과 (같은 시각·같은 노드면 다시 계산하지 않음)
    this.maxAltitude = altitude(this.state, this.config); // 이번 비행 최고 고도 (m)
    // 처음 전체 연료 (kg): 모든 단 연료 용량의 합 (점수 계산 기준)
    this.initialTotalFuel = this.state.stages.reduce((sum, st) => sum + st.fuelCapacity, 0);
    this.accumulator = 0;

    // 도킹: 우주 정거장 (발사 순간 기준 위상각으로 배치)
    this.station = null;
    this.dockLink = null; // 결합 중 우주선의 정거장 기준 상대 위치·자세
    this.dockedAt = null;
    // 분리 직후 바로 다시 붙지 않도록, 포트가 충분히 멀어진 뒤에만 다시 결합할 수 있다
    this.dockingArmed = true;
    this.hasDockingPort = rocketHasDockingPort(this.rocket);
    if (this.scenario.station) {
      if (!this.stationPhaseCache.has(definition)) {
        const phase = computeStationPhase(this.config, definition, (def) => new FlightSimulation(this.config, def));
        this.stationPhaseCache.set(definition, phase);
      }
      this.stationPhase = this.stationPhaseCache.get(definition);
      this.station = createStationVehicle(this.config, this.stationPhase);
    }
  }

  /** 같은 로켓으로 처음부터 다시 시작 */
  reset() {
    this.loadRocket(this.definition);
  }

  /** 지금 조종 중인 비행체 상태 */
  getControlled() {
    if (this.controlledId === 'rocket') return this.state;
    return this.debris.find((d) => d.id === this.controlledId)?.vehicle ?? this.state;
  }

  // ── 명령 (조종 중인 비행체에 적용) ─────────────────────────
  /**
   * 누르고 있는 조종 입력을 전달한다. 실제 반영은 다음 물리 스텝에서 한다.
   * @param {{throttleUp:boolean, throttleDown:boolean, pitch:number, yaw:number, roll:number}} input
   */
  setControlInput(input) {
    const c = this.getControlled().manualInput;
    c.throttleUp = Boolean(input.throttleUp);
    c.throttleDown = Boolean(input.throttleDown);
    c.pitch = clampUnit(input.pitch);
    c.yaw = clampUnit(input.yaw);
    c.roll = clampUnit(input.roll);
    const t = input.translate ?? [0, 0, 0];
    c.translate = [clampUnit(t[0]), clampUnit(t[1]), clampUnit(t[2])];
  }

  /** R: RCS(평행이동 추진기) 켜기/끄기 */
  toggleRcs() {
    const v = this.getControlled();
    v.rcsEnabled = !v.rcsEnabled;
    announce(v, `RCS ${v.rcsEnabled ? '켜짐 — H/N 앞뒤 · J/L 좌우 · I/K 아래위' : '꺼짐'}`);
    return v.rcsEnabled;
  }

  /** Z: 스로틀 최대 (엔진 점화) — 자동 비행 중이면 해제 */
  throttleMax() {
    const v = this.getControlled();
    if (v.aborted || v.destroyed) return;
    stopProgram(v, '조종 키 입력 — 자동 비행을 해제했어요');
    v.throttle = 1;
    v.engineOn = true;
  }

  /** X: 엔진 끄기 (스로틀 0) — 자동 비행 중이면 해제 */
  engineCutoff() {
    const v = this.getControlled();
    stopProgram(v, '조종 키 입력 — 자동 비행을 해제했어요');
    v.throttle = 0;
    v.engineOn = false;
    v.liftoffBlocked = false;
  }

  /** P: 낙하산 펼치기 (조종 중인 비행체) */
  deployParachute() {
    return this.deployParachuteFor(this.getControlled());
  }

  /**
   * 낙하산 펼치기. 너무 빠르거나 동압이 크면 찢어진다.
   * @returns {boolean} 펼쳤으면 true
   */
  deployParachuteFor(v) {
    if (v.destroyed) return false;
    if (attachedParachute(v).full <= 0) {
      announce(v, '낙하산이 없어요 (설계 화면에서 낙하산 부품을 맨 위 단에 올리세요)');
      return false;
    }
    if (v.parachute !== 'packed') {
      announce(v, v.parachute === 'torn' ? '낙하산이 찢어져 쓸 수 없어요' : '낙하산은 이미 펼쳤어요');
      return false;
    }
    const pc = this.config.parachute;
    const speed = vec3.length(v.velocity);
    if (speed > pc.maxDeploySpeed || v.dynamicPressure > pc.maxDeployDynamicPressure) {
      v.parachute = 'torn';
      announce(v, `낙하산이 찢어졌어요 — 너무 빨라요 (${Math.round(speed)} m/s, 펼칠 수 있는 속도 ${pc.maxDeploySpeed} m/s 이하)`);
      this.events.push({ type: 'parachuteTorn' });
      return false;
    }
    v.parachute = 'deployed';
    announce(v, `낙하산 펼침 — 보조 낙하산, 고도 ${(pc.fullDeployAltitude / 1000).toFixed(1)} km 아래에서 다 펼쳐져요`);
    this.events.push({ type: 'parachute' });
    return true;
  }

  /** Backspace: 비상 중단 — 엔진을 끄고 재시작 전까지 엔진·자세 조종을 잠근다 */
  abort() {
    this.engineCutoff();
    this.getControlled().aborted = true;
  }

  /**
   * B: 조종 대상 전환 (로켓 ↔ 부스터). 떠나는 비행체의 누르던 입력은 해제되고,
   * 스로틀은 그대로 유지된다.
   * @returns {boolean} 전환했으면 true
   */
  switchControl() {
    if (this.controlledId === 'rocket') {
      if (!this.booster || this.booster.landingResult) return false;
      this.state.manualInput = idleInput();
      this.controlledId = this.booster.id;
      this.booster.attempted = true;
    } else {
      this.getControlled().manualInput = idleInput();
      this.controlledId = 'rocket';
    }
    return true;
  }

  // ── 자동조종 명령 ───────────────────────────────────────
  /** T: 자세 보조(SAS) 모드를 다음으로 바꾼다 (도킹 목표가 있으면 목표 기준 모드도 포함) */
  cycleSas() {
    const v = this.getControlled();
    const modes = [...SAS_MODES];
    if (v === this.state && this.maneuver) modes.push('maneuver');
    if (this.getTarget(v)) modes.push(...SAS_TARGET_MODES);
    const next = modes[(modes.indexOf(v.autopilot.sas) + 1) % modes.length];
    v.autopilot.sas = next;
    v.autopilot.holdDirection = null;
    announce(v, `자세 보조: ${SAS_LABELS[next]}`);
    return next;
  }

  /** 자세 보조 모드를 직접 고른다 */
  setSasMode(mode) {
    const v = this.getControlled();
    v.autopilot.sas = mode;
    v.autopilot.holdDirection = null;
  }

  /**
   * G: 자동 비행 켜기/끄기. 상황에 맞는 프로그램을 고른다.
   *   부스터 조종 중 → 자동 착륙, 도킹 목표 근처 → 자동 도킹, 그 밖의 로켓 → 자동 궤도 진입
   * @returns {string|null} 켠 프로그램 이름 (껐거나 켤 수 없으면 null)
   */
  toggleAutopilot() {
    const v = this.getControlled();
    const ap = v.autopilot;
    if (ap.program) {
      // 자동조종이 올려 둔 스로틀이 남아 연료를 태우지 않도록 엔진도 끈다
      v.throttle = 0;
      v.engineOn = false;
      stopProgram(v, '자동 비행을 껐어요 (엔진 정지)');
      return null;
    }
    if (v.destroyed || v.aborted) return null;
    let program = null;
    if (v !== this.state) {
      if (this.booster?.landingZone && !this.booster.landingResult) {
        if (!hasFuel(v)) {
          announce(v, '부스터에 연료가 없어 자동 착륙을 할 수 없어요 (1단 연료를 남기고 분리하세요)');
          return null;
        }
        program = 'landing';
      }
    } else if (this.maneuver && !v.landed) {
      program = 'maneuver';
    } else if (this.canAutoDock?.(v)) {
      program = 'docking';
    } else if (this.getReference(v).id === 'moon') {
      if (!v.landed) program = 'moonLanding';
    } else if (!v.landed && this.orbitAchievedAt !== null && attachedParachute(v).full > 0) {
      program = 'reentry';
    } else if (this.orbitAchievedAt === null || v.landed) {
      program = 'orbit';
    }
    if (!program) {
      announce(v, '지금은 쓸 수 있는 자동 비행이 없어요');
      return null;
    }
    ap.program = program;
    ap.phase = '';
    announce(v, `${PROGRAM_LABELS[program]} 시작`);
    return program;
  }



  /**
   * Space: 단 분리 — 로켓 본체의 현재(맨 아래) 단을 떼어 독립 비행체로 만든다.
   * - 분리된 단의 건조 질량과 남은 연료가 로켓에서 빠진다.
   * - 두 물체는 설정된 상대 속도로 멀어지며, 운동량은 보존된다.
   * - 로켓 위치 기준점(맨 아래 끝)은 다음 단의 아래 끝으로 옮겨진다.
   * - 엔진이 있는 첫 분리 단은 부스터가 되며, 조종 없이 떨어질 지점에 착륙 지점을 정한다.
   * @returns {boolean} 분리했으면 true (분리할 단이 없거나, 파손·부스터 조종 중이면 false)
   */
  separateStage({ force = false } = {}) {
    const s = this.state;
    if ((!force && this.controlledId !== 'rocket') || s.destroyed || s.currentStage >= s.stages.length - 1) return false;

    const stage = s.stages[s.currentStage];
    const nose = noseDirection(s);
    const totalMass = rocketMass(s);
    const stageMass = stage.dryMass + stage.fuel;
    const upperMass = totalMass - stageMass;
    const separationSpeed = this.config.staging.separationSpeed;

    // 운동량 보존: m_단·Δv_단 + m_위·Δv_위 = 0, 상대 속도 = separationSpeed
    const vehicle = createSeparatedVehicle(s, stage, {
      position: vec3.clone(s.position),
      velocity: vec3.addScaled(s.velocity, nose, (-separationSpeed * upperMass) / totalMass),
    });
    const debris = {
      id: this.nextDebrisId++,
      stageIndex: s.currentStage,
      separatedAt: s.time,
      vehicle,
      // 아래는 화면·이전 코드 호환용 읽기 값 (vehicle 을 그대로 가리킨다)
      get position() { return vehicle.position; },
      get velocity() { return vehicle.velocity; },
      get orientation() { return vehicle.orientation; },
      get landed() { return vehicle.landed; },
      get mass() { return vehicle.stages[0].dryMass + vehicle.stages[0].fuel; },
      isBooster: false,
      landingZone: null,
      landingResult: null,
      landingReason: '',
      landingDistance: null,
    };
    // 부스터 착륙 미니게임은 행성에서만 (달 근처에서 떼어 낸 단은 그냥 분리된 단)
    if (!this.booster && stage.maxThrust > 0 && !s.landed && this.getReference(s).id === 'planet') {
      debris.isBooster = true;
      debris.landingZone = predictImpactPoint(vehicle, this.config);
      this.booster = debris;
    }
    this.debris.push(debris);

    s.velocity = vec3.addScaled(s.velocity, nose, (separationSpeed * stageMass) / totalMass);
    s.position = vec3.addScaled(s.position, nose, stage.length);
    s.currentStage += 1;
    s.landed = false;
    s.liftoffBlocked = false;
    this.events.push({ type: 'stage' });
    return true;
  }

  // ── 시간 진행 ───────────────────────────────────────────
  /**
   * 실제 경과 시간 realDt(s)만큼 고정 간격 스텝을 실행한다.
   * @returns {number} 실행한 스텝 수
   */
  advance(realDt) {
    const { fixedTimeStep, maxFrameTime } = this.config.simulation;
    const warp = this.getTimeWarp();
    this.accumulator += Math.min(realDt, maxFrameTime) * warp;
    let steps = 0;
    const maxSteps = this.config.timeWarp.maxStepsPerFrame;
    while (this.accumulator >= fixedTimeStep) {
      const eventCount = this.events.length;
      this.step(fixedTimeStep);
      this.accumulator -= fixedTimeStep;
      steps++;
      // 중요한 사건이 생기면 시간 가속을 멈춘다 (나머지 가속분은 버림)
      // (경고 등으로 지금은 1× 로 제한되어 있어도, 고른 배율이 1 보다 크면 1 로 되돌린다)
      if (this.timeWarpSelected > 1 && this.events.slice(eventCount).some((e) => this.breaksTimeWarp(e))) {
        this.timeWarpSelected = 1;
        this.accumulator = Math.min(this.accumulator, fixedTimeStep);
      }
      if (steps >= maxSteps) {
        this.accumulator = 0; // 너무 밀리면 따라잡기를 포기 (화면 멈춤 방지)
        break;
      }
    }
    return steps;
  }

  // ── 시간 가속 ───────────────────────────────────────────
  /** 이 사건이 시간 가속을 멈춰야 하는지 (조종 중인 비행체·로켓 본체와 관련된 사건만) */
  breaksTimeWarp(event) {
    if (!WARP_BREAK_EVENTS.has(event.type)) return false;
    if (event.type === 'explosion') return event.vehicleId === 'rocket' || event.vehicleId === this.controlledId;
    if (event.type === 'landing') return this.controlledId !== 'rocket'; // 부스터를 조종 중일 때만
    return true;
  }

  /** 지금 상황에서 허용되는 최대 배율과 그 이유 */
  getTimeWarpLimit() {
    const c = this.config;
    const levels = c.timeWarp.levels;
    let max = levels[levels.length - 1];
    let reason = '';
    const v = this.getControlled();
    const t = this.vehicleTelemetry(v, v === this.state);
    const vehicles = [this.state, ...this.debris.map((d) => d.vehicle)];
    const thrusting = vehicles.some(
      (x) => !x.destroyed && (currentThrust(x) > 0 || (x.rcsEnabled && x.controls.translate?.some((a) => a !== 0))),
    );
    if (t.warnings.some((w) => w.id === 'maxq' || w.id === 'unstable' || w.id === 'overheat')) {
      max = 1;
      reason = '경고 중';
    } else if (thrusting && max > c.timeWarp.maxWhileThrusting) {
      max = c.timeWarp.maxWhileThrusting;
      reason = '엔진 가동 중';
    }
    if (t.planetAltitude < c.atmosphere.topAltitude && !t.landed && max > c.timeWarp.maxInAtmosphere) {
      max = c.timeWarp.maxInAtmosphere;
      reason = '대기권 안';
    }
    if (t.altitude < c.timeWarp.nearSurfaceAltitude && max > c.timeWarp.maxNearSurface) {
      max = c.timeWarp.maxNearSurface;
      reason = `${t.referenceBody.name} 가까이`;
    }
    return { max, reason };
  }

  /** 실제로 적용되는 시간 가속 배율 */
  getTimeWarp() {
    return Math.min(this.timeWarpSelected, this.getTimeWarpLimit().max);
  }

  /** . : 한 단계 빠르게 */
  increaseTimeWarp() {
    const levels = this.config.timeWarp.levels;
    const i = levels.indexOf(this.timeWarpSelected);
    this.timeWarpSelected = levels[Math.min(levels.length - 1, i + 1)];
    return this.timeWarpSelected;
  }

  /** , : 한 단계 느리게 */
  decreaseTimeWarp() {
    const levels = this.config.timeWarp.levels;
    const i = levels.indexOf(this.timeWarpSelected);
    this.timeWarpSelected = levels[Math.max(0, i - 1)];
    return this.timeWarpSelected;
  }

  /** 배율 직접 지정 (설정 목록에 있는 값만) */
  setTimeWarp(factor) {
    if (this.config.timeWarp.levels.includes(factor)) this.timeWarpSelected = factor;
  }

  /** 테스트용: 정해진 시뮬레이션 시간(s)을 즉시 진행 */
  runFor(seconds) {
    const dt = this.config.simulation.fixedTimeStep;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) this.step(dt);
  }

  /** 로켓과 분리된 단들을 한 스텝 진행 */
  step(dt) {
    // 1) 모든 비행체의 조종 입력을 같은 시점(스텝 시작)의 상태로 먼저 정한다.
    //    (한 비행체를 움직인 뒤 다른 비행체의 자동조종이 그 위치를 보면, 궤도 속도 × dt 만큼 어긋난다)
    if (this.station && this.hasLiftedOff) stepAutopilot(this.station, this.autopilotContext(this.station, 'station', dt));
    stepAutopilot(this.state, this.autopilotContext(this.state, 'rocket', dt));
    for (const d of this.debris) stepAutopilot(d.vehicle, this.autopilotContext(d.vehicle, d.id, dt));
    this.applyAssists(this.getControlled(), dt);

    // 2) 물리 진행
    if (this.station) this.stepStation(dt);
    this.stepVehicle(this.state, 'rocket', dt);
    this.updateManeuver();
    if (this.station) this.updateDocking();
    for (const d of this.debris) {
      this.stepVehicle(d.vehicle, d.id, dt);
      if (d.isBooster && !d.landingResult && d.vehicle.destroyed && !d.vehicle.touchdown) {
        // 땅에 닿기 전에 부서짐 (Max-Q·과열 등)
        d.landingResult = 'failure';
        d.landingReason = d.vehicle.destroyedReason;
        this.events.push({ type: 'landing', result: 'failure' });
      } else if (d.isBooster && !d.landingResult && d.vehicle.touchdown) {
        const judged = judgeBoosterLanding(d.vehicle, d.landingZone, this.config);
        d.landingResult = judged.result;
        d.landingReason = judged.reason;
        d.landingDistance = judged.distance;
        this.events.push({ type: 'landing', result: judged.result });
      }
    }
    if (!this.state.landed && !this.hasLiftedOff) {
      this.hasLiftedOff = true;
      this.liftoffTime = this.state.time;
    }
    this.maxAltitude = Math.max(this.maxAltitude, altitude(this.state, this.config));
    this.checkOrbitAchieved();
    this.updateReferenceBody();
  }

  /**
   * 난이도 보조 기능 (직접 조종 중일 때만, 자동 비행 중에는 자동조종이 알아서 한다)
   *   자동 스로틀 제한: 동압이 한계의 75% 를 넘으면 스로틀을 빠르게 낮춘다
   *   자동 단 분리: 로켓 본체의 현재 단 연료가 다 떨어지면 다음 단으로
   */
  applyAssists(vehicle, dt) {
    const assists = this.config.difficulty?.assists;
    if (!assists || vehicle.autopilot.program || vehicle.destroyed || vehicle.aborted || vehicle.landed) return;
    if (assists.throttleLimit && vehicle.engineOn && vehicle.throttle > 0.05) {
      const limit = this.config.aerodynamics.maxDynamicPressure;
      if (vehicle.dynamicPressure > 0.75 * limit) {
        vehicle.throttle = Math.max(0.05, vehicle.throttle - 2 * this.config.controls.throttleRate * dt);
        if (!vehicle.throttleLimited) announce(vehicle, '자동 스로틀 제한: 동압이 높아 스로틀을 낮췄어요');
        vehicle.throttleLimited = true;
      } else vehicle.throttleLimited = false;
    }
    if (assists.autoStage && vehicle === this.state && vehicle.engineOn && !hasFuel(vehicle) && vehicle.currentStage < vehicle.stages.length - 1) {
      const throttle = vehicle.throttle;
      if (this.separateStage({ force: true })) {
        vehicle.throttle = throttle;
        vehicle.engineOn = true;
        announce(vehicle, '자동 단 분리 — 다음 단 점화');
      }
    }
  }

  /** 중력권이 바뀌었는지 확인하고, 달 미션용 기록(조우·달 궤도·달 착륙)을 남긴다 */
  updateReferenceBody() {
    const s = this.state;
    const id = referenceBodyId(s.position, s.time, this.config);
    if (id !== this.referenceBodyId) {
      this.referenceBodyId = id;
      this.events.push({ type: 'soi', bodyId: id });
      if (id === 'moon' && this.moonEncounteredAt === null) this.moonEncounteredAt = s.time;
      // 노드는 "지금 중력권" 기준으로 계산하므로, 중력권이 바뀌면 (실행 중이 아니면) 지운다
      const dropped = this.maneuver && !this.maneuver.executing;
      if (dropped) {
        this.maneuver = null;
        if (s.autopilot.program === 'maneuver') stopProgram(s);
      }
      announce(
        s,
        (id === 'moon' ? '달 중력권에 들어왔어요 — 이제 궤도는 달 기준이에요' : '달 중력권을 벗어났어요 — 다시 행성 기준이에요') +
          (dropped ? ' (기동 노드는 지웠어요)' : ''),
      );
    }
    if (id !== 'moon' || s.destroyed) return;
    if (s.landed) {
      if (this.moonLandedAt === null && s.landedOn === 'moon' && s.touchdown?.safe) this.moonLandedAt = s.time;
      return;
    }
    if (this.moonOrbitAchievedAt === null) {
      const o = this.getOrbit(s);
      if (!o.escape && o.periapsisAltitude >= this.config.moon.minOrbitPeriapsisAltitude && o.apoapsisRadius < this.config.moon.soiRadius) {
        this.moonOrbitAchievedAt = s.time;
      }
    }
  }

  /** 비행체 하나의 물리를 진행하고, 파손·이륙·착지 사건을 기록한다 (조종 입력은 step 에서 미리 정함) */
  stepVehicle(vehicle, id, dt) {
    const wasDestroyed = vehicle.destroyed;
    const wasLanded = vehicle.landed;
    stepFlight(vehicle, this.config, dt);
    if (!wasDestroyed && vehicle.destroyed) {
      this.events.push({ type: 'explosion', vehicleId: id, position: vec3.clone(vehicle.position) });
    }
    if (id === 'rocket' && wasLanded && !vehicle.landed && !this.hasLiftedOff) this.events.push({ type: 'liftoff' });
    if (id === 'rocket' && !wasLanded && vehicle.landed) this.events.push({ type: 'touchdown' });
  }

  // ── 기동 노드 ───────────────────────────────────────────
  /** 지금부터 secondsAhead 초 뒤(또는 절대 시각 time)에 기동 노드를 만든다 */
  addManeuver({ time, secondsAhead } = {}) {
    if (this.state.landed || this.state.docked) return null;
    const at = time ?? this.state.time + (secondsAhead ?? 60);
    if (at <= this.state.time) return null;
    this.maneuver = createManeuverNode(at);
    announce(this.state, '기동 노드를 만들었어요 — Δv 를 조절하세요');
    return this.maneuver;
  }

  /**
   * 노드 조절 (실행 시작 전에만). 값은 더하기로 바뀐다.
   * @param {{prograde?:number, normal?:number, radial?:number, time?:number}} delta
   */
  adjustManeuver(delta) {
    const n = this.maneuver;
    if (!n || n.executing) return false;
    n.prograde += delta.prograde ?? 0;
    n.normal += delta.normal ?? 0;
    n.radial += delta.radial ?? 0;
    if (delta.time) n.time = Math.max(this.state.time + 1, n.time + delta.time);
    return true;
  }

  /**
   * 다음 원지점('apoapsis') 또는 근지점('periapsis') 의 시각 (지금부터 몇 초 뒤). 없으면 null.
   * 지금 중력권 기준 궤도를 한 주기 촘촘히 나눠 찾은 뒤, 그 근처를 삼분 탐색으로 다듬는다.
   */
  timeToApsis(which, vehicle = this.state) {
    const orbit = this.getOrbit(vehicle);
    if (which === 'apoapsis' && orbit.escape) return null;
    const body = this.getReference(vehicle);
    const rel = relativeTo(body, vehicle.position, vehicle.velocity);
    const radiusAt = (t) => vec3.length(propagateKepler(rel.position, rel.velocity, body.mu, t).position);
    const better = (a, b) => (which === 'apoapsis' ? a > b : a < b);
    const horizon = Number.isFinite(orbit.period) ? orbit.period : 3 * 3600;
    const samples = 720;
    let best = null;
    for (let i = 1; i <= samples; i++) {
      const t = (horizon * i) / samples;
      const r = radiusAt(t);
      if (!best || better(r, best.r)) best = { t, r };
    }
    let lo = Math.max(1e-3, best.t - horizon / samples);
    let hi = best.t + horizon / samples;
    for (let k = 0; k < 60; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (better(radiusAt(m1), radiusAt(m2))) hi = m2;
      else lo = m1;
    }
    return (lo + hi) / 2;
  }

  /** 다음 원지점·근지점에 노드를 만든다 */
  addManeuverAtApsis(which) {
    const s = this.state;
    if (s.landed || s.docked) return null;
    const dt = this.timeToApsis(which);
    return dt === null ? null : this.addManeuver({ time: s.time + dt });
  }

  /**
   * 원궤도 만들기 노드: 닫힌 궤도면 원지점, 탈출 궤도(예: 달에 다가가는 중)면 근지점에서
   * 그 높이의 원궤도 속도가 되도록 진행 방향 Δv 를 준다 (음수 = 감속).
   */
  addCircularizeManeuver() {
    const s = this.state;
    if (s.landed || s.docked) return null;
    const orbit = this.getOrbit(s);
    const which = orbit.escape ? 'periapsis' : 'apoapsis';
    const dt = this.timeToApsis(which);
    if (dt === null) return null;
    const body = this.getReference(s);
    const rel = relativeTo(body, s.position, s.velocity);
    const at = propagateKepler(rel.position, rel.velocity, body.mu, dt);
    const r = vec3.length(at.position);
    const node = this.addManeuver({ time: s.time + dt });
    if (!node) return null;
    node.prograde = Math.sqrt(body.mu / r) - vec3.length(at.velocity);
    announce(s, `원궤도 노드 (${which === 'apoapsis' ? '원지점' : '근지점'}, Δv ${node.prograde.toFixed(0)} m/s)`);
    return node;
  }

  /**
   * 달 전이 노드 자동 계획 (행성 궤도에서): 달 근접 고도가 목표에 가장 가까운 시각·Δv.
   * 이미 달까지 닿는 전이 궤도라면, 2분 뒤 작은 보정 노드로 근접 고도를 목표에 맞춘다.
   * @returns {object|null} 만든 노드 (계획할 수 없으면 null, 안내 문구를 남긴다)
   */
  planMoonTransfer() {
    const s = this.state;
    if (!this.config.moon || s.landed || s.docked) return null;
    if (this.getReference(s).id !== 'planet') {
      announce(s, '이미 달 중력권 안이에요');
      return null;
    }
    const target = this.config.moon.transferTargetPeriapsisAltitude;
    const orbit = this.getOrbit(s);
    if (orbit.escape || orbit.apoapsisRadius > this.config.moon.orbitRadius - this.config.moon.soiRadius) {
      const fix = planMoonCorrection(s, this.config, { targetPeriapsisAltitude: target });
      if (!fix) {
        announce(s, '이 궤도로는 달을 만날 수 없어요 — 보정할 수 없어요');
        return null;
      }
      const node = this.addManeuver({ time: fix.time });
      node.prograde = fix.prograde;
      node.radial = fix.radial;
      announce(s, `궤도 보정 계획: Δv ${Math.hypot(fix.prograde, fix.radial).toFixed(1)} m/s · 달 근접 ${(fix.encounter.periapsisAltitude / 1000).toFixed(0)} km`);
      return node;
    }
    const plan = planMoonTransfer(s, this.config, { targetPeriapsisAltitude: target });
    if (!plan) {
      announce(s, '달 전이를 계획할 수 없어요 — 먼저 낮은 원궤도에 오르세요');
      return null;
    }
    const node = this.addManeuver({ time: plan.time });
    node.prograde = plan.prograde;
    announce(s, `달 전이 계획: Δv ${plan.prograde.toFixed(0)} m/s · 달 근접 ${(plan.encounter.periapsisAltitude / 1000).toFixed(0)} km`);
    return node;
  }

  removeManeuver() {
    if (!this.maneuver) return false;
    this.maneuver = null;
    stopProgram(this.state, '기동 노드를 지웠어요');
    return true;
  }

  /** 기동 노드 계산 결과 (화면·자동조종용). 노드가 없으면 null */
  getManeuverInfo() {
    const n = this.maneuver;
    if (!n) return null;
    const s = this.state;
    const body = this.getReference(s);
    const rel = relativeTo(body, s.position, s.velocity);
    // 노드 계산은 지금 중력권(행성 또는 달) 기준 상대 위치·속도로 한다
    const evalNow = evaluateNode({ ...rel, time: s.time }, n, body.mu, body.radius);
    const stage = s.stages[s.currentStage];
    const total = n.executing ? vec3.length(n.remaining) : nodeDeltaV(n);
    const burn = estimateBurn(total, {
      mass: rocketMass(s),
      thrust: stage?.maxThrust ?? 0,
      exhaustVelocity: stage ? exhaustVelocity(stage.isp, this.config) : 0,
      fuel: stage?.fuel ?? 0,
    });
    const direction = n.executing ? n.remaining : evalNow.deltaV;
    // 실행 중에는 이미 밀린 만큼이 지금 궤도에 들어 있으므로, 지금 속도 + 남은 Δv 로 예측한다
    const velocityAfter = n.executing ? vec3.add(rel.velocity, n.remaining) : evalNow.velocityAfter;
    const orbitAfter = n.executing ? computeOrbit(rel.position, velocityAfter, body.mu, body.radius) : evalNow.orbitAfter;
    return {
      node: n,
      executing: n.executing,
      timeToNode: n.time - s.time,
      timeToBurnStart: n.time - burn.burnTime / 2 - s.time,
      deltaV: nodeDeltaV(n),
      remaining: total,
      direction, // 월드 기준 연소 방향 (크기 = 남은 Δv)
      burnTime: burn.burnTime,
      enoughFuel: burn.enoughFuel,
      referenceBody: body.id, // 아래 위치·속도의 기준 천체 (상대 좌표)
      nodeTime: n.executing ? s.time : n.time,
      nodePosition: n.executing ? rel.position : evalNow.position,
      orbitAfter,
      velocityAfter,
    };
  }

  /** 매 스텝: 연소 시작 시점이 되면 방향을 고정하고, 실제로 밀린 Δv 만큼 남은 양을 줄인다 */
  updateManeuver() {
    const n = this.maneuver;
    const s = this.state;
    if (!n) return;
    if (!n.executing) {
      const info = this.getManeuverInfo();
      if (info.timeToBurnStart <= 0) {
        n.executing = true;
        n.executionVector = vec3.clone(info.direction);
        // 이번 스텝에 이미 밀린 만큼은 빼고 시작
        n.remaining = vec3.sub(info.direction, s.lastDeltaV ?? [0, 0, 0]);
      }
      return;
    }
    n.remaining = vec3.sub(n.remaining, s.lastDeltaV ?? [0, 0, 0]);
    const left = vec3.length(n.remaining);
    if (left < 0.05 || vec3.dot(n.remaining, n.executionVector) <= 0) {
      this.maneuver = null;
      announce(s, `기동 완료 (오차 ${left.toFixed(2)} m/s)`);
    }
  }

  /** 정거장 진행. 발사 전에는 "발사 순간 기준" 위치에 머문다 (발사 시각을 기다릴 필요가 없도록) */
  stepStation(dt) {
    if (!this.hasLiftedOff) {
      this.station = createStationVehicle(this.config, this.stationPhase);
      return;
    }
    this.stepVehicle(this.station, 'station', dt);
  }

  /** 도킹 판정·충돌·결합 유지 */
  updateDocking() {
    const craft = this.state;
    const station = this.station;
    if (craft.docked && this.dockLink) {
      followStation(craft, station, this.dockLink);
      return;
    }
    if (!this.hasDockingPort || craft.destroyed || craft.landed) return;
    const check = evaluateDocking(craft, station, this.config);
    if (!this.dockingArmed) {
      if (check.portDistance > this.config.docking.captureDistance * 3) this.dockingArmed = true;
      return;
    }
    if (check.canDock) {
      this.dockLink = dock(craft, station);
      this.dockedAt = craft.time;
      stopProgram(craft);
      announce(craft, '🛰 도킹 성공! (U 키로 분리)');
      this.events.push({ type: 'docked' });
    } else if (check.crash) {
      craft.destroyed = true;
      craft.destroyedReason = `도킹 포트 충돌: 상대 속도 ${check.relativeSpeed.toFixed(1)} m/s > ${this.config.docking.crashSpeed} m/s`;
      craft.engineOn = false;
      craft.throttle = 0;
      this.events.push({ type: 'explosion', vehicleId: 'rocket', position: vec3.clone(craft.position) });
    }
  }

  /** U: 정거장에서 분리 */
  undockFromStation() {
    if (!this.state.docked || !this.station) return false;
    undock(this.state, this.station, this.config);
    this.dockLink = null;
    this.dockingArmed = false;
    announce(this.state, '정거장에서 분리했어요');
    return true;
  }

  /** 도킹 목표 정보 (로켓 본체에만 정거장이 목표가 된다) */
  getTarget(vehicle) {
    if (!this.station || vehicle !== this.state) return null;
    return { station: this.station, position: portPosition(this.station), velocity: this.station.velocity, name: '우주 정거장' };
  }

  /** 자동 도킹을 시작할 수 있는지 */
  canAutoDock(vehicle) {
    if (!this.station || vehicle !== this.state || vehicle.docked || vehicle.landed || !this.hasDockingPort) return false;
    const alt = vec3.length(vehicle.position) - this.config.planet.radius;
    if (alt < this.config.atmosphere.topAltitude) return false;
    return vec3.length(vec3.sub(portPosition(vehicle), portPosition(this.station))) <= this.config.docking.autoDockRange;
  }

  /** 자동 도킹 프로그램 (autopilot 이 부른다) */
  dockingStep(vehicle, ctx) {
    return dockingProgram(vehicle, ctx);
  }

  /** 자동조종이 쓰는 주변 정보와 명령 */
  autopilotContext(vehicle, id, dt) {
    const isRocket = id === 'rocket';
    const debris = isRocket ? null : this.debris.find((d) => d.id === id);
    return {
      config: this.config,
      dt,
      orbit: () => this.getOrbit(vehicle),
      reference: () => this.getReference(vehicle),
      orbitCircularNow: () => !vehicle.landed && isCircularOrbitAchieved(this.getOrbit(vehicle), this.config.orbit),
      canStage: isRocket && !vehicle.destroyed && vehicle.currentStage < vehicle.stages.length - 1,
      separateStage: ({ landBooster = false } = {}) => {
        const ok = this.separateStage({ force: true });
        // 착륙용 연료를 남기고 떼어 낸 1단은 바로 자동 착륙을 시작한다
        if (ok && landBooster && this.booster && !this.booster.vehicle.autopilot.program) {
          this.booster.vehicle.autopilot.program = 'landing';
          this.booster.vehicle.autopilot.phase = '';
          this.booster.attempted = true;
        }
        return ok;
      },
      // 부스터 착륙 미션에서 1단에 남길 연료 비율 (0 = 다 쓴다)
      boosterReserve: isRocket && this.scenario.boosterRecovery && !this.booster ? this.config.autopilot.boosterReserveFuelRatio : 0,
      deployParachute: () => this.deployParachuteFor(vehicle),
      landingZone: debris?.isBooster ? debris.landingZone : null,
      target: this.getTarget(vehicle),
      dockingStep: this.dockingStep ? (v, ctx) => this.dockingStep(v, ctx) : null,
      // 기동 노드 (로켓 본체만)
      maneuver: isRocket && this.maneuver ? () => this.getManeuverInfo() : null,
      stopWarp: () => {
        this.timeWarpSelected = 1;
      },
    };
  }

  /** 효과·소리 모듈이 사건을 가져간다 */
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 원궤도 진입 판정 (설정 orbit 기준, 로켓 본체). 한 번 만족하면 그 시각을 기록한다. */
  checkOrbitAchieved() {
    const s = this.state;
    if (this.orbitAchievedAt !== null || s.landed || s.destroyed || this.referenceBodyId !== 'planet') return;
    if (isCircularOrbitAchieved(this.getOrbit(s), this.config.orbit)) this.orbitAchievedAt = s.time;
  }

  /** 비행체의 기준 천체 (달 중력권 안이면 달, 아니면 행성) — 지금 시각의 위치·속도 포함 */
  getReference(vehicle = this.state) {
    return referenceBodyAt(vehicle.position, vehicle.time, this.config);
  }

  /** 비행체(기본: 로켓 본체)의 현재 위치·속도로 계산한 궤도 요소 (기준 천체에 대한 상대 궤도) */
  getOrbit(vehicle = this.state) {
    const body = this.getReference(vehicle);
    const rel = relativeTo(body, vehicle.position, vehicle.velocity);
    const orbit = computeOrbit(rel.position, rel.velocity, body.mu, body.radius);
    orbit.bodyId = body.id;
    return orbit;
  }

  /**
   * 달 조우 예측 (로켓 본체, 행성 중력권에서만). 노드가 있으면 실행 후 궤도 기준 예측도 함께.
   * 같은 시각·같은 노드 값이면 저장해 둔 결과를 쓴다 (한 프레임에 여러 곳에서 불러도 한 번만 계산).
   * @returns {{current: object|null, afterManeuver: object|null}}
   */
  getEncounters() {
    const s = this.state;
    const none = { current: null, afterManeuver: null };
    if (!this.config.moon || s.landed || s.destroyed || this.getReference(s).id !== 'planet') return none;
    const n = this.maneuver;
    const key = `${s.time}|${n ? `${n.time},${n.prograde},${n.normal},${n.radial},${n.executing}` : ''}`;
    if (this.encounterCache.has(key)) return this.encounterCache.get(key);
    const current = predictMoonEncounter(s.position, s.velocity, s.time, this.config);
    let afterManeuver = null;
    const info = n ? this.getManeuverInfo() : null;
    if (info && info.referenceBody === 'planet') {
      afterManeuver = predictMoonEncounter(info.nodePosition, info.velocityAfter, info.nodeTime, this.config);
    }
    const result = { current, afterManeuver };
    this.encounterCache.clear();
    this.encounterCache.set(key, result);
    return result;
  }

  // ── 표시용 값 ───────────────────────────────────────────
  /** 화면(HUD) 용: 지금 조종 중인 비행체의 값 + 부스터 착륙 안내 */
  getTelemetry() {
    const controlled = this.getControlled();
    const isRocket = controlled === this.state;
    const t = this.vehicleTelemetry(controlled, isRocket);
    t.controlledVehicle = isRocket ? 'rocket' : 'booster';
    t.vehicleName = isRocket ? this.rocket.name : '1단 부스터';
    t.boosterAvailable = Boolean(this.booster && !this.booster.landingResult);
    t.landing = this.landingInfo(controlled);
    const limit = this.getTimeWarpLimit();
    t.timeWarp = { factor: Math.min(this.timeWarpSelected, limit.max), selected: this.timeWarpSelected, max: limit.max, reason: limit.reason };
    const encounters = isRocket ? this.getEncounters() : { current: null, afterManeuver: null };
    t.encounter = encounters.current; // 지금 궤도의 달 조우 예측
    t.moonAvailable = Boolean(this.config.moon);
    if (t.maneuver) t.maneuver.encounter = encounters.afterManeuver; // 노드 실행 후 달 조우 예측
    return t;
  }

  /** 미션 판정용: 항상 로켓 본체의 값 + 부스터 착륙 결과 */
  getMissionTelemetry() {
    const t = this.vehicleTelemetry(this.state, true);
    t.boosterSeparated = Boolean(this.booster);
    t.encounter = this.getEncounters().current;
    return t;
  }

  /** 부스터 착륙 안내 (착륙 지점까지 거리, 기준, 결과) */
  landingInfo(vehicle) {
    const b = this.booster;
    const limits = this.config.landing;
    if (!b) return { active: false, limits };
    const zone = b.landingZone;
    // 착륙 지점 방위 (°, 북 0 · 동 90) — 지금 보고 있는 비행체 기준
    let bearingDeg = null;
    if (zone) {
      const d = toLocalENU(vec3.sub(zone, vehicle.position), localFrame(vehicle.position, this.config.planet.northPoleDirection));
      bearingDeg = ((Math.atan2(d.east, d.north) * 180) / Math.PI + 360) % 360;
    }
    return {
      active: true,
      bearingDeg,
      zone, // 착륙 지점 지표 위치 (m) 또는 null
      distanceToZone: zone ? surfaceDistance(b.vehicle.position, zone, this.config.planet.radius) : null,
      // 지금 보고 있는 비행체 기준 기울기 (°)
      tiltDeg: (Math.acos(Math.max(-1, Math.min(1, vec3.dot(noseDirection(vehicle), vec3.normalize(vehicle.position))))) * 180) / Math.PI,
      result: b.landingResult,
      reason: b.landingReason,
      attempted: Boolean(b.attempted), // 조종했거나 자동 착륙을 켠 적이 있는지
      limits,
    };
  }

  /** 도킹 목표까지의 정보 (목표가 없으면 null) */
  targetInfo(vehicle) {
    if (!this.station) return null;
    const check = evaluateDocking(vehicle, this.station, this.config);
    return {
      name: '우주 정거장',
      hasDockingPort: this.hasDockingPort,
      ...check,
      stationAltitude: vec3.length(this.station.position) - this.config.planet.radius,
      autoDockAvailable: this.canAutoDock(vehicle),
      limits: this.config.docking,
    };
  }

  /**
   * 남은 Δv: 단마다 치올콥스키 식 (그 단 점화 때 질량 → 연료를 다 태운 질량)
   * @returns {{stage:number, total:number, burnTime:number}}
   */
  deltaVBudget(s) {
    let total = 0;
    let stageDv = 0;
    let burnTime = 0;
    for (let i = s.currentStage; i < s.stages.length; i++) {
      const st = s.stages[i];
      if (st.maxThrust <= 0 || st.isp <= 0 || st.fuel <= 0) continue;
      let m0 = 0;
      for (let j = i; j < s.stages.length; j++) m0 += s.stages[j].dryMass + s.stages[j].fuel;
      const ve = exhaustVelocity(st.isp, this.config);
      const dv = ve * Math.log(m0 / (m0 - st.fuel));
      total += dv;
      if (i === s.currentStage) {
        stageDv = dv;
        burnTime = (st.fuel * ve) / st.maxThrust;
      }
    }
    return { stage: stageDv, total, burnTime };
  }

  /** 비행체 하나의 표시용 값 */
  vehicleTelemetry(s, isRocket) {
    const c = this.config;
    // 속도·고도·자세는 기준 천체(행성 또는 달) 기준 상대 값
    const body = this.getReference(s);
    const rel = relativeTo(body, s.position, s.velocity);
    const up = vec3.normalize(rel.position);
    const verticalSpeed = vec3.dot(rel.velocity, up);
    const speed = vec3.length(rel.velocity);
    const stage = s.stages[s.currentStage];
    const thrust = currentThrust(s);
    const maxTwr = thrustToWeight(s, c, maxThrust(s));
    const alt = vec3.length(rel.position) - body.radius;
    const planetAlt = altitude(s, c);
    // 받음각: 기수 방향과 진행 방향 사이 각 (속도가 거의 0 이면 0)
    const angleOfAttackDeg = speed > 1
      ? (Math.acos(Math.min(1, Math.max(-1, vec3.dot(noseDirection(s), vec3.scale(rel.velocity, 1 / speed))))) * 180) / Math.PI
      : 0;
    const orbit = this.getOrbit(s);
    const frame = localFrame(rel.position, c.planet.northPoleDirection);
    const attitude = elevationAndHeading(noseDirection(s), frame); // 기수 고각·방위
    const moon = c.moon ? bodyAt('moon', s.time, c) : null;
    const apsides = s.landed ? { toPeriapsis: null, toApoapsis: null } : timeToApsides(rel.position, rel.velocity, body.mu);
    const budget = this.deltaVBudget(s);
    const telemetry = {
      time: s.time,
      referenceBody: { id: body.id, name: body.name }, // 기준 천체 (중력권)
      altitude: alt, // 기준 천체 표면 기준 고도 (m)
      planetAltitude: planetAlt, // 행성 해수면 고도 (m) — 대기 계산용
      moonDistance: moon ? vec3.length(vec3.sub(s.position, moon.position)) - moon.radius : null, // 달 표면까지 거리 (m)
      speed, // 속력 (m/s)
      verticalSpeed, // 수직 속도, 위가 + (m/s)
      horizontalSpeed: Math.sqrt(Math.max(0, speed * speed - verticalSpeed * verticalSpeed)),
      mass: rocketMass(s), // 총질량 (kg)
      // 계기판
      gForce: (s.properAcceleration ?? 0) / c.constants.standardGravity, // 몸으로 느끼는 가속도 (g)
      deltaVStage: budget.stage, // 현재 단으로 낼 수 있는 Δv (m/s, 진공 기준)
      deltaVTotal: budget.total, // 남은 모든 단의 Δv 합 (m/s)
      burnTimeLeft: budget.burnTime, // 현재 단 최대 추력 연소 가능 시간 (s)
      timeToApoapsis: apsides.toApoapsis, // 다음 원지점까지 (s) 또는 null
      timeToPeriapsis: apsides.toPeriapsis, // 다음 근지점까지 (s) 또는 null
      missionTime: this.liftoffTime === null ? 0 : s.time - this.liftoffTime, // 이륙 후 경과 시간 (s)
      thrust, // 현재 추력 (N)
      maxThrust: maxThrust(s), // 현재 단 최대 추력 (N)
      localGravity: gravityMagnitudeAtRadius(vec3.length(rel.position), body.mu), // m/s²
      twr: thrustToWeight(s, c, thrust), // 현재 추력 기준 TWR
      maxTwr, // 최대 추력 기준 TWR
      canLiftOff: maxTwr > 1, // TWR > 1 이어야 이륙 가능
      fuel: stage ? stage.fuel : 0, // 현재 단 남은 연료 (kg)
      fuelCapacity: stage ? stage.fuelCapacity : 0, // 현재 단 연료 용량 (kg)
      fuelRatio: stage && stage.fuelCapacity > 0 ? stage.fuel / stage.fuelCapacity : 0,
      massFlow: stage && stage.isp > 0 ? thrust / exhaustVelocity(stage.isp, c) : 0, // 연료 소모율 ṁ (kg/s)
      flameout: s.engineOn && s.throttle > 0 && !hasFuel(s), // 연료가 없어 엔진이 꺼진 상태
      airDensity: airDensity(planetAlt, c.atmosphere), // 공기 밀도 (kg/m³)
      dynamicPressure: s.dynamicPressure, // 동압 (Pa)
      maxDynamicPressureSeen: s.maxDynamicPressureSeen, // 이번 비행 최대 동압 (Pa)
      maxQLimit: c.aerodynamics.maxDynamicPressure, // Max-Q 한계 (Pa)
      angleOfAttackDeg, // 받음각 (°)
      // 재진입 가열
      skinTemperature: s.skinTemperature, // 표면 온도 (K)
      maxSkinTemperature: s.maxSkinTemperature, // 이번 비행 최고 표면 온도 (K)
      thermalLimit: s.thermalLimit, // 지금 버틸 수 있는 최고 온도 (K)
      heatShielded: s.heatShielded, // 열 차폐막이 앞면인지
      heatFlux: s.heatFlux, // 열유속 (W/m²)
      thermalWarningRatio: c.heating?.warningRatio ?? 0.8,
      // 낙하산
      parachute: {
        available: attachedParachute(s).full > 0,
        state: s.parachute, // 'packed' | 'deployed' | 'torn'
        area: s.parachuteArea, // 지금 펼쳐진 면적 (m²)
        fullArea: attachedParachute(s).full,
        maxDeploySpeed: c.parachute?.maxDeploySpeed ?? 0,
        safeToDeploy: s.parachute === 'packed' && speed <= (c.parachute?.maxDeploySpeed ?? 0) && s.dynamicPressure <= (c.parachute?.maxDeployDynamicPressure ?? 0),
      },
      destroyed: s.destroyed,
      destroyedReason: s.destroyedReason,
      canStage: isRocket && !s.destroyed && !s.docked && s.currentStage < s.stages.length - 1,
      debrisCount: this.debris.length,
      touchdown: s.touchdown,
      // 궤도
      apoapsisAltitude: orbit.apoapsisAltitude, // 원지점 고도 (m), 탈출 궤도면 Infinity
      periapsisAltitude: orbit.periapsisAltitude, // 근지점 고도 (m), 음수면 지표 아래
      eccentricity: orbit.eccentricity,
      orbitalPeriod: orbit.period, // (s)
      escapeTrajectory: orbit.escape,
      impactTrajectory: orbit.impact,
      orbitCircularNow: isRocket && !s.landed && body.id === 'planet' && isCircularOrbitAchieved(orbit, c.orbit), // 지금 원궤도 조건 충족
      orbitAchieved: isRocket && this.orbitAchievedAt !== null, // 이번 비행에서 원궤도 진입 성공 여부
      orbitAchievedAt: isRocket ? this.orbitAchievedAt : null,
      // 미션·점수용 (로켓 본체 기준)
      hasLiftedOff: this.hasLiftedOff,
      maxAltitude: this.maxAltitude, // 이번 비행 최고 고도 (m)
      moonEncountered: isRocket && this.moonEncounteredAt !== null, // 달 중력권에 들어간 적이 있는지
      moonOrbitAchieved: isRocket && this.moonOrbitAchievedAt !== null, // 달 궤도 진입 판정을 만족한 적이 있는지
      moonLanded: isRocket && this.moonLandedAt !== null, // 달에 안전하게 착륙했는지
      totalFuel: s.stages.slice(s.currentStage).reduce((sum, st) => sum + st.fuel, 0), // 남은 전체 연료 (kg)
      initialTotalFuel: this.initialTotalFuel, // 처음 전체 연료 (kg)
      landingSupported: true, // 부스터 착륙 판정 기능
      landingResult: this.booster?.landingResult ?? null, // 'success' | 'failure' | null
      landingReason: this.booster?.landingReason ?? '',
      // 도킹
      rcsEnabled: s.rcsEnabled,
      docked: isRocket && s.docked,
      dockedAt: isRocket ? this.dockedAt : null,
      target: isRocket ? this.targetInfo(s) : null,
      maneuver: isRocket ? this.getManeuverInfo() : null,
      // 자동조종
      autopilot: {
        sas: s.autopilot.sas,
        sasLabel: SAS_LABELS[s.autopilot.sas],
        program: s.autopilot.program,
        programLabel: s.autopilot.program ? PROGRAM_LABELS[s.autopilot.program] : '',
        phase: s.autopilot.phase,
        // 최근 6초 안의 안내 문구만 보여준다
        message: s.autopilot.message && s.time - s.autopilot.messageTime < 6 ? s.autopilot.message : '',
      },
      // 자세
      pitchDeg: attitude.elevation, // 기수의 지평선 위 각도 (°)
      headingDeg: attitude.heading, // 기수 방위 (°, 북 0 · 동 90)
      engineOn: s.engineOn,
      throttle: s.throttle,
      aborted: s.aborted,
      angularVelocity: s.angularVelocity, // 로컬 축 회전 속도 (rad/s)
      landed: s.landed,
      landedOn: s.landed ? s.landedOn ?? 'planet' : null, // 서 있는 천체
      liftoffBlocked: s.liftoffBlocked,
      currentStage: isRocket ? s.currentStage : 0,
      stageCount: isRocket ? s.stages.length : 1,
      rocketName: this.rocket.name,
    };
    telemetry.warnings = computeWarnings(telemetry, c);
    return telemetry;
  }
}
