/**
 * 우주 왕복선 3D 표시 — rocketView 와 같은 모양의 창구(group, stageGroups, layout, detachStage …)
 * ------------------------------------------------------------
 * 단 0 = 고체 부스터 한 쌍, 단 1 = 외부 탱크, 단 2 = 궤도선(+ 감속 낙하산).
 * 붙어 있는 동안 모든 단 그룹의 원점은 스택 기준점(물리 위치와 같다)이고, 궤도선 그룹만 orbiterOffset 만큼 옮겨 둔다.
 * 외부 탱크를 떼면 물리 위치가 궤도선 기준점(주 바퀴 접지점)으로 옮겨지므로 궤도선 그룹을 원점으로 돌린다.
 * 불꽃(고체 부스터 2 · 주 엔진 3 · 궤도 조종 엔진 2), 바퀴 내림, 에어브레이크, 엘레본, 감속 낙하산을 상태에 맞춰 움직인다.
 */
import * as THREE from 'three';
import { createOrbiterModel, createExternalTankModel, createSrbPairModel, createDragChuteModel, SRB_X } from './shuttleModel.js';
import { createEngineFlame } from '../effects/engineFlame.js';
import { vec3 } from '../physics/vectorMath.js';

const STACK_HEIGHT = 52; // 외부 탱크 꼭대기까지 (m)
const ORBITER_FRAME_HEIGHT = 20; // 궤도선만 있을 때 카메라가 보는 높이(가운데 = 동체 가운데 근처)
const EYE = [-0.55, 21.7, 6.9]; // 사령관 눈 위치 (궤도선 좌표)

export function createShuttleView(rocket, config, { envMap = null } = {}) {
  const offset = config.shuttle.orbiterOffset;
  const orbiterIndex = rocket.stages.findIndex((s) => s.winged);
  const group = new THREE.Group();

  const srb = createSrbPairModel(envMap);
  const et = createExternalTankModel(envMap, offset);
  const orbiter = createOrbiterModel(envMap);
  const chute = createDragChuteModel(envMap);
  chute.group.position.set(...orbiter.chuteMount);
  chute.group.visible = false;
  orbiter.group.add(chute.group);

  const stageGroups = [srb, et, orbiter.group].map((model, i) => {
    const sg = new THREE.Group();
    sg.name = `stage-${i}`;
    sg.add(model);
    group.add(sg);
    return sg;
  });

  // 불꽃
  const srbFlames = [-1, 1].map((side) => {
    const f = createEngineFlame(2.3, { outer: 0xffa040, core: 0xfffbe8, lengthScale: 2.2 });
    f.group.position.set(side * SRB_X, 0, 0);
    srb.add(f.group);
    return f;
  });
  const ssmeFlames = orbiter.ssmeExits.map((p) => {
    const f = createEngineFlame(1.05, { outer: 0x7f9dff, core: 0xfff4e0, lengthScale: 1.1 });
    f.group.position.set(...p);
    orbiter.group.add(f.group);
    return f;
  });
  const omsFlames = orbiter.omsExits.map((p) => {
    const f = createEngineFlame(0.36, { outer: 0x9fb4ff, core: 0xe8f0ff });
    f.group.position.set(...p);
    orbiter.group.add(f.group);
    return f;
  });

  // 재진입 열: 배 쪽 타일·앞전·기수가 달아오른다 (표면 온도 800 K 부터)
  const glowColor = new THREE.Color(1, 0.32, 0.08);
  const om = orbiter.materials;
  let gearDeploy = 0;
  let speedbrake = 0;
  const elevator = { pitch: 0, roll: 0 };
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  const view = {
    group,
    stageGroups,
    height: STACK_HEIGHT,
    stageHeights: [STACK_HEIGHT, STACK_HEIGHT, ORBITER_FRAME_HEIGHT],
    stageRadii: [2.5, 4.2, 2.6],
    isShuttle: true,

    layout(currentStage) {
      const stacked = currentStage < orbiterIndex;
      // 아직 떼어 내지 않았는데 현재 단보다 아래인 단(활공 연습처럼 궤도선만으로 시작)은 숨긴다
      stageGroups.forEach((sg, i) => {
        if (sg.parent === group) sg.visible = i >= currentStage;
      });
      stageGroups[orbiterIndex].position.set(...(stacked ? offset : [0, 0, 0]));
      view.height = stacked ? STACK_HEIGHT : ORBITER_FRAME_HEIGHT;
    },

    detachStage(index) {
      const sg = stageGroups[index];
      group.remove(sg);
      sg.position.set(0, 0, 0);
      // 떼어 낸 고체 부스터는 연료가 다 탄 뒤라 불꽃을 끈다
      for (const f of index === 0 ? srbFlames : []) f.update(0, 1, 0);
      sg.userData.noFlame = true;
      return sg;
    },

    /** 1인칭 눈 위치 (로켓 그룹 로컬 좌표, m) */
    cockpitEye(currentStage) {
      return currentStage < orbiterIndex ? vec3.add(EYE, offset) : EYE;
    },

    /**
     * @param {object} state 로켓 본체 상태
     * @param {number} densityRatio 해수면 대비 공기 밀도
     * @param {number} time 화면 시각 (s)
     * @param {number} dt 화면 프레임 시간 (s)
     */
    update(state, densityRatio, time, dt) {
      const st = state.stages;
      const burning = state.engineOn && !state.destroyed ? state.throttle : 0;
      const srbOn = state.currentStage === 0 && st[0].fuel > 0 ? burning : 0;
      const ssmeOn = state.currentStage <= 1 && st[1].fuel > 0 ? burning : 0;
      const omsOn = state.currentStage === orbiterIndex && st[orbiterIndex].fuel > 0 ? burning : 0;
      for (const f of srbFlames) f.update(srbOn, densityRatio, time);
      for (const f of ssmeFlames) f.update(ssmeOn, densityRatio, time);
      for (const f of omsFlames) f.update(omsOn, densityRatio, time);

      const heat = Math.max(0, Math.min(1, ((state.skinTemperature ?? 0) - 800) / 1100));
      om.tile.emissive.copy(glowColor).multiplyScalar(heat * 0.9);
      om.rcc.emissive.copy(glowColor).multiplyScalar(heat * 1.3);
      om.orbiter.emissive.copy(glowColor).multiplyScalar(heat * 0.12);

      // 바퀴: 2 초 동안 아래로 펼쳐진다 (접으면 배 속으로)
      gearDeploy = Math.max(0, Math.min(1, gearDeploy + (state.gearDown ? 1 : -1) * dt * 0.5));
      for (const p of orbiter.gear) {
        p.visible = gearDeploy > 0.02;
        p.rotation.x = (1 - gearDeploy) * (Math.PI / 2);
      }
      // 에어브레이크: 방향타가 두 쪽으로 벌어진다
      speedbrake = approach(speedbrake, state.speedbrake ?? 0, 4, dt);
      for (const r of orbiter.rudder) r.pivot.rotation.z = r.side * speedbrake * 0.75;
      // 엘레본: 기수 올리기(S) = 위로, 굴림 = 좌우 반대로
      const c = state.controls ?? {};
      elevator.pitch = approach(elevator.pitch, c.pitch ?? 0, 6, dt);
      elevator.roll = approach(elevator.roll, c.roll ?? 0, 6, dt);
      for (const e of orbiter.elevons) e.pivot.rotation.x = -(elevator.pitch * 0.3 + e.side * elevator.roll * (e.outer ? 0.3 : 0.18));

      // 감속 낙하산: 펼친 면적 비율만큼 부풀고, 거의 멈추면 접힌다
      const full = st[orbiterIndex]?.parachuteArea ?? 0;
      const frac = full > 0 && state.parachute === 'deployed' ? Math.min(1, (state.parachuteArea ?? 0) / full) : 0;
      const moving = vec3.length(state.velocity) > 2;
      chute.group.visible = frac > 0.01 && moving && !state.destroyed;
      if (chute.group.visible) {
        const s = 0.25 + 0.75 * frac;
        chute.canopy.scale.set(s, 0.6 + 0.4 * frac, s);
        chute.canopy.rotation.y = Math.sin(time * 2.3) * 0.05;
        chute.canopy.position.x = Math.sin(time * 1.7) * 0.25;
      }
    },
  };
  for (const p of orbiter.gear) p.visible = false; // 처음에는 바퀴를 올린 상태
  view.layout(0);
  return view;
}
