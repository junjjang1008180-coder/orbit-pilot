/**
 * 지면 높이와 지면 접촉 처리
 * ------------------------------------------------------------
 * 행성 표면은 해수면(반지름 R)이고, 발사대 상판 위에서만 상판 높이가 지면이다.
 * 달 표면은 반지름 R_달 인 구이다 (달 중력권 안에서만 본다).
 * 로켓과 분리된 단이 함께 쓴다.
 */
import { vec3 } from './vectorMath.js';
import { moonState } from './celestialBodies.js';

/**
 * 위치 position 에서 지면의 해수면 기준 높이 (m).
 * 발사대 상판 반지름 안이면 상판 높이, 아니면 해수면(0)이다.
 */
export function surfaceAltitudeAt(position, config) {
  const { planet, launchSite } = config;
  const up = vec3.normalize(position);
  const site = vec3.normalize(launchSite.direction);
  const angle = Math.acos(Math.min(1, Math.max(-1, vec3.dot(up, site))));
  const groundDistance = angle * planet.radius; // 발사대 중심에서 지표 거리 (m)
  return groundDistance <= launchSite.padRadius ? launchSite.padHeight : 0;
}

/**
 * 물체 body({position, velocity})가 지면 아래로 내려가면 지면 위로 되돌리고 정지시킨다.
 * 달 중력권 안이면 달 표면을 기준으로 하고, 달과 함께 움직이도록 달의 속도를 준다.
 * @param {number|null} [time] 시각 (s) — 달 위치 계산용. null 이면 행성만 본다.
 * @returns {null | {impactSpeed:number, impactVelocity:number[], bodyId:string, surfaceOffset:number[]}}
 *   이번 스텝에 땅에 닿았으면 충돌 정보 (impactVelocity 는 그 천체 표면에 대한 상대 속도,
 *   surfaceOffset 은 천체 중심에서 접지 위치까지 벡터)
 */
export function resolveGroundContact(body, config, time = null) {
  if (time !== null && config.moon) {
    const moon = moonState(config, time);
    const relative = vec3.sub(body.position, moon.position);
    const r = vec3.length(relative);
    if (r < config.moon.soiRadius) {
      if (r >= config.moon.radius) return null;
      const up = vec3.normalize(relative);
      const impactVelocity = vec3.sub(body.velocity, moon.velocity);
      const impactSpeed = vec3.dot(impactVelocity, up) < 0 ? vec3.length(impactVelocity) : 0;
      const surfaceOffset = vec3.scale(up, config.moon.radius);
      body.position = vec3.add(moon.position, surfaceOffset);
      body.velocity = vec3.clone(moon.velocity);
      return { impactSpeed, impactVelocity, bodyId: 'moon', surfaceOffset };
    }
  }
  const ground = surfaceAltitudeAt(body.position, config);
  const r = vec3.length(body.position);
  if (r - config.planet.radius >= ground) return null;

  const up = vec3.normalize(body.position);
  const impactVelocity = body.velocity;
  const impactSpeed = vec3.dot(impactVelocity, up) < 0 ? vec3.length(impactVelocity) : 0;
  body.position = vec3.scale(up, config.planet.radius + ground);
  body.velocity = [0, 0, 0];
  return { impactSpeed, impactVelocity, bodyId: 'planet', surfaceOffset: vec3.clone(body.position) };
}
