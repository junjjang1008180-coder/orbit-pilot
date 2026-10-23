/**
 * 엔진 없이 떨어지는 물체(분리된 단 등)의 물리
 * ------------------------------------------------------------
 * 중력 + 공기저항만 받아 움직인다. 로켓 본체와 같은 중력·대기·지면 함수를 쓴다.
 */
import { vec3 } from './vectorMath.js';
import { gravityAcceleration } from './gravity.js';
import { airDensity, dragForce } from './aerodynamics.js';
import { resolveGroundContact } from './terrain.js';

/**
 * @param {{position:number[], velocity:number[], mass:number, dragArea:number, landed:boolean}} body
 * @param {object} config PHYSICS_CONFIG
 * @param {number} dt (s)
 */
export function stepBallisticBody(body, config, dt) {
  if (body.landed) return;
  const altitude = vec3.length(body.position) - config.planet.radius;
  const density = airDensity(altitude, config.atmosphere);
  const drag = dragForce(body.velocity, density, config.aerodynamics.dragCoefficient, body.dragArea);
  // 도약법: 중력은 처음·끝 절반씩, 항력은 처음에 (flightPhysics 와 같은 방식)
  const gravityStart = gravityAcceleration(body.position, config.planet.mu);
  const velocityHalf = vec3.addScaled(vec3.addScaled(body.velocity, drag, dt / body.mass), gravityStart, dt / 2);
  body.position = vec3.addScaled(body.position, velocityHalf, dt);
  body.velocity = vec3.addScaled(velocityHalf, gravityAcceleration(body.position, config.planet.mu), dt / 2);
  const contact = resolveGroundContact(body, config);
  if (contact) {
    body.landed = true;
    body.impactSpeed = contact.impactSpeed;
  }
}
