/**
 * 천체(행성·달)와 중력권 이어 붙이기
 * ------------------------------------------------------------
 * - 행성은 좌표 원점에 고정되어 있다.
 * - 달은 행성 둘레를 원궤도로 정해진 길(레일)을 따라 돈다. 시각 t 의 위치·속도는 식으로 바로 구한다.
 *     위치 = a·(sin φ·동(+X) + cos φ·위(+Y)),  φ = φ₀ + n·t,  n = √(μ_행성 / a³)
 * - 중력권(SOI) 이어 붙이기(patched conics):
 *     달 중력권 안 : 달 중력만 받는다 → 달 기준으로는 정확한 2체 궤도(케플러 예측과 일치)
 *                    행성 기준 좌표에서는 달이 원운동하며 받는 가속도(구심 가속도)를 더해 준다
 *     중력권 밖    : 행성 중력만 받는다 (지금까지와 같음)
 * - 설정에 moon 이 없으면 행성만 있는 것으로 동작한다.
 */
import { vec3 } from './vectorMath.js';
import { gravityAcceleration } from './gravity.js';

const PLANET_AT_REST = Object.freeze({ position: [0, 0, 0], velocity: [0, 0, 0], acceleration: [0, 0, 0] });

/** 달의 공전 각속도 n (rad/s) */
export function moonMeanMotion(config) {
  return Math.sqrt(config.planet.mu / config.moon.orbitRadius ** 3);
}

/**
 * 시각 time(s) 의 달 중심 위치·속도·가속도 (행성 중심 좌표)
 * @returns {{position:number[], velocity:number[], acceleration:number[], phase:number}}
 */
export function moonState(config, time) {
  const { orbitRadius: a, initialPhaseDeg } = config.moon;
  const n = moonMeanMotion(config);
  const phase = (initialPhaseDeg * Math.PI) / 180 + n * time;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    position: [a * s, a * c, 0],
    velocity: [a * n * c, -a * n * s, 0],
    acceleration: [-a * n * n * s, -a * n * n * c, 0],
    phase,
  };
}

/** 위치 position 이 달 중력권 안인지 */
export function insideMoonSoi(position, time, config) {
  if (!config.moon) return false;
  return vec3.length(vec3.sub(position, moonState(config, time).position)) < config.moon.soiRadius;
}

/** 위치의 기준 천체 id: 'moon' (달 중력권 안) 또는 'planet' */
export function referenceBodyId(position, time, config) {
  return insideMoonSoi(position, time, config) ? 'moon' : 'planet';
}

/**
 * 천체 정보 (시각 time 기준 위치·속도·가속도 포함)
 * @param {'planet'|'moon'} id
 */
export function bodyAt(id, time, config) {
  if (id === 'moon' && config.moon) {
    const m = config.moon;
    return { id, name: m.name, radius: m.radius, mu: m.mu, surfaceGravity: m.surfaceGravity, hasAtmosphere: false, ...moonState(config, time) };
  }
  const p = config.planet;
  return { id: 'planet', name: '행성', radius: p.radius, mu: p.mu, surfaceGravity: p.surfaceGravity, hasAtmosphere: true, ...PLANET_AT_REST };
}

/** 위치의 기준 천체 정보 */
export function referenceBodyAt(position, time, config) {
  return bodyAt(referenceBodyId(position, time, config), time, config);
}

/**
 * 중력가속도 (행성 중심 좌표, m/s²) — 중력권 이어 붙이기
 * @param {number[]} position
 * @param {number} time 시각 (s) — 달 위치 계산용
 */
export function gravityAt(position, time, config) {
  if (config.moon) {
    const moon = moonState(config, time);
    const relative = vec3.sub(position, moon.position);
    if (vec3.length(relative) < config.moon.soiRadius) {
      // 달 중력 + 달 자체의 가속도 (달 기준으로 보면 달 중력만 받는 것과 같다)
      return vec3.add(gravityAcceleration(relative, config.moon.mu), moon.acceleration);
    }
  }
  return gravityAcceleration(position, config.planet.mu);
}

/** 비행체의 기준 천체에 대한 상대 위치·속도 */
export function relativeTo(body, position, velocity) {
  return { position: vec3.sub(position, body.position), velocity: vec3.sub(velocity, body.velocity) };
}
