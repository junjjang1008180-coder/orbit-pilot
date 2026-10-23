/**
 * 착지 판정
 * ------------------------------------------------------------
 * 땅에 닿는 순간의 속도와 자세로 안전한 착지인지 판단한다.
 *   수직 속도  = 지면 방향(아래) 속도 성분 (m/s)
 *   수평 속도  = 지면과 나란한 속도 성분 (m/s)
 *   기울기     = 기수와 천정(위) 사이 각도 (°)
 * 기준은 PHYSICS_CONFIG.landing 에서 읽고, 각 항목을 따로따로 검사한다.
 */
import { vec3, quat } from './vectorMath.js';

/**
 * @param {number[]} position 접지 위치 (m)
 * @param {number[]} velocity 접지 직전 속도 (m/s)
 * @param {number[]} orientation 자세 쿼터니언
 * @param {object} landingConfig PHYSICS_CONFIG.landing
 */
export function evaluateTouchdown(position, velocity, orientation, landingConfig) {
  const up = vec3.normalize(position);
  const radial = vec3.dot(velocity, up);
  const verticalSpeed = Math.max(0, -radial); // 하강 속도 (양수)
  const horizontalSpeed = vec3.length(vec3.addScaled(velocity, up, -radial));
  const nose = quat.rotate(orientation, [0, 1, 0]);
  const tiltDeg = (Math.acos(Math.max(-1, Math.min(1, vec3.dot(nose, up)))) * 180) / Math.PI;

  const failures = [];
  if (verticalSpeed > landingConfig.maxVerticalSpeed) {
    failures.push(`수직 속도 ${verticalSpeed.toFixed(1)} m/s > ${landingConfig.maxVerticalSpeed}`);
  }
  if (horizontalSpeed > landingConfig.maxHorizontalSpeed) {
    failures.push(`수평 속도 ${horizontalSpeed.toFixed(1)} m/s > ${landingConfig.maxHorizontalSpeed}`);
  }
  if (tiltDeg > landingConfig.maxTiltDeg) {
    failures.push(`기울기 ${tiltDeg.toFixed(1)}° > ${landingConfig.maxTiltDeg}°`);
  }
  return { verticalSpeed, horizontalSpeed, tiltDeg, safe: failures.length === 0, failures };
}
