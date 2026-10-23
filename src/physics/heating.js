/**
 * 재진입 가열과 낙하산
 * ------------------------------------------------------------
 * 가열
 *   열유속 (Sutton–Graves): q̇ = k · √(ρ / r_n) · v³   [W/m²]
 *   표면 온도 (한 덩어리 모델): C · dT/dt = q̇ − ε·σ·(T⁴ − T_주변⁴)
 *   앞면 판정: 붙어 있는 맨 아래 부품이 열 차폐막이고, 꼬리가 진행 방향을 향하면(역진행에서
 *   shieldMaxAngleDeg 안) 열 차폐막이 열을 받는다 → 한계 = 열 차폐막 최고 온도.
 *   아니면 한계 = 붙어 있는 부품 중 가장 약한 부품의 최고 온도.
 * 낙하산
 *   P 로 펼치면 먼저 보조 낙하산 면적, 다 펼침 고도 아래에서 전체 면적으로 openingTime 동안 늘어난다.
 *   항력 D = ½ρv²·Cd·A 를 기체 항력에 더한다. 너무 빠르거나 동압이 크면 펼치는 순간 찢어진다.
 */
import { vec3 } from './vectorMath.js';

const STEFAN_BOLTZMANN = 5.670374419e-8; // σ (W/m²·K⁴)

/**
 * 열유속 (W/m²)
 * @param {number} density 공기 밀도 (kg/m³)
 * @param {number} speed 공기에 대한 속력 (m/s)
 * @param {number} noseRadius 앞면 반지름 (m)
 */
export function heatFlux(density, speed, noseRadius, heatingConfig) {
  if (!(density > 0) || !(speed > 0)) return 0;
  return heatingConfig.fluxCoefficient * Math.sqrt(density / Math.max(0.1, noseRadius)) * speed ** 3;
}

/** 표면 온도를 dt 만큼 진행 (K) */
export function stepSkinTemperature(temperature, flux, dt, heatingConfig) {
  const { emissivity, heatCapacityPerArea, ambientTemperature } = heatingConfig;
  const radiated = emissivity * STEFAN_BOLTZMANN * (temperature ** 4 - ambientTemperature ** 4);
  return Math.max(ambientTemperature, temperature + ((flux - radiated) / heatCapacityPerArea) * dt);
}

/**
 * 지금 버틸 수 있는 최고 온도와 열 차폐막 보호 여부
 * @param {object} state 비행체 상태
 * @param {number[]} nose 기수 방향 단위벡터
 * @param {number[]} airVelocity 공기에 대한 속도 (m/s)
 * @returns {{limit:number, shielded:boolean}}
 */
export function thermalLimit(state, nose, airVelocity, heatingConfig) {
  const attached = state.stages.slice(state.currentStage);
  const weakest = Math.min(Infinity, ...attached.map((s) => s.maxTemperature ?? Infinity));
  const shield = attached[0]?.bottomShieldTemperature ?? 0;
  const speed = vec3.length(airVelocity);
  if (shield > 0 && speed > 1) {
    // 꼬리(−기수)와 진행 방향 사이 각
    const tailFirst = -vec3.dot(nose, airVelocity) / speed;
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, tailFirst))) * 180) / Math.PI;
    if (angleDeg <= heatingConfig.shieldMaxAngleDeg) return { limit: shield, shielded: true };
  }
  return { limit: weakest, shielded: false };
}

/** 붙어 있는 단들의 낙하산 면적 합 (다 펼친 면적, 보조 면적) */
export function attachedParachute(state) {
  let full = 0;
  let semi = 0;
  for (let i = state.currentStage; i < state.stages.length; i++) {
    full += state.stages[i].parachuteArea ?? 0;
    semi += state.stages[i].parachuteSemiArea ?? 0;
  }
  return { full, semi };
}

/**
 * 펼친 낙하산 면적을 목표(보조/전체)까지 openingTime 동안 늘린다 (m²)
 * @param {number} altitude 해수면 고도 (m)
 */
export function stepParachuteArea(state, altitude, dt, parachuteConfig) {
  const chute = attachedParachute(state);
  if (state.parachute !== 'deployed' || chute.full <= 0) {
    state.parachuteArea = 0;
    return 0;
  }
  const target = altitude < parachuteConfig.fullDeployAltitude ? chute.full : chute.semi;
  const rate = chute.full / parachuteConfig.openingTime; // m²/s
  state.parachuteArea = Math.min(target, state.parachuteArea + rate * dt);
  return state.parachuteArea;
}
