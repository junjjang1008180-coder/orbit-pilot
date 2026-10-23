/**
 * 지역 기준 좌표계 (위/동/북) 계산
 * ------------------------------------------------------------
 * 행성 위의 한 지점에서 "위(천정)", "동쪽", "북쪽" 방향을 구한다.
 * 고도, 수직 속도, 이후 단계의 자세 표시 등에 쓴다.
 */
import { vec3 } from './vectorMath.js';

/**
 * @param {number[]} position 행성 중심 기준 위치 (m)
 * @param {number[]} northPoleDirection 북극 방향 단위벡터
 * @returns {{up:number[], east:number[], north:number[]}}
 */
export function localFrame(position, northPoleDirection) {
  const up = vec3.normalize(position);
  // 북쪽 = 자전축을 지평면에 투영한 방향
  let north = vec3.addScaled(northPoleDirection, up, -vec3.dot(northPoleDirection, up));
  if (vec3.length(north) < 1e-9) {
    // 극점 바로 위에서는 북쪽이 정의되지 않으므로 임의의 수평 방향을 쓴다.
    north = Math.abs(up[0]) < 0.9 ? vec3.cross(up, [1, 0, 0]) : vec3.cross(up, [0, 1, 0]);
  }
  north = vec3.normalize(north);
  // 동쪽 × 북쪽 = 위  →  동쪽 = 북쪽 × 위
  const east = vec3.normalize(vec3.cross(north, up));
  return { up, east, north };
}

/**
 * 월드 방향 벡터를 지역 좌표계 성분(동, 위, 북)으로 바꾼다.
 * @param {number[]} vector
 * @param {{up:number[], east:number[], north:number[]}} frame
 */
export function toLocalENU(vector, frame) {
  return {
    east: vec3.dot(vector, frame.east),
    up: vec3.dot(vector, frame.up),
    north: vec3.dot(vector, frame.north),
  };
}

/**
 * 방향 벡터의 지평선 기준 고각(°, 위가 +)과 방위각(°, 북=0 동=90)
 * @param {number[]} direction
 * @param {{up:number[], east:number[], north:number[]}} frame
 */
export function elevationAndHeading(direction, frame) {
  const d = toLocalENU(vec3.normalize(direction), frame);
  const elevation = (Math.asin(Math.max(-1, Math.min(1, d.up))) * 180) / Math.PI;
  const horizontal = Math.hypot(d.east, d.north);
  const heading = horizontal < 1e-9 ? 0 : (((Math.atan2(d.east, d.north) * 180) / Math.PI) + 360) % 360;
  return { elevation, heading };
}
