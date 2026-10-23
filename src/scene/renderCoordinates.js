/**
 * 물리 좌표 ↔ Three.js 화면 좌표 변환 (이 파일에서만 변환한다)
 * ------------------------------------------------------------
 * 물리 좌표: 행성 중심이 원점, 단위 m, 배열 [x, y, z].
 * 화면 좌표: 카메라가 따라가는 기준점(보통 로켓)을 원점으로 옮긴 좌표.
 *   - 행성 반지름(수십만 m) 같은 큰 좌표를 GPU(32비트 float)에 그대로 넘기면
 *     화면이 떨리는 정밀도 문제가 생기므로, 기준점을 빼서 작은 값으로 만든다.
 *   - 축 방향은 물리 좌표와 같다 (발사장에서 +Y 가 위).
 */
import * as THREE from 'three';

/** 화면 1 단위가 몇 m 인지 (시각화 배율, 물리와 무관) */
export const RENDER_UNITS_PER_METER = 1;

/**
 * 물리 위치를 기준점(origin) 상대 화면 위치로 바꾼다.
 * @param {number[]} physicsPosition 물리 위치 (m)
 * @param {number[]} origin 화면 원점으로 쓸 물리 위치 (m)
 * @param {THREE.Vector3} [target]
 */
export function toRenderPosition(physicsPosition, origin, target = new THREE.Vector3()) {
  return target.set(
    (physicsPosition[0] - origin[0]) * RENDER_UNITS_PER_METER,
    (physicsPosition[1] - origin[1]) * RENDER_UNITS_PER_METER,
    (physicsPosition[2] - origin[2]) * RENDER_UNITS_PER_METER,
  );
}

/** 물리 방향 벡터(크기 없음)를 Three.js 벡터로 */
export function toRenderDirection(direction, target = new THREE.Vector3()) {
  return target.set(direction[0], direction[1], direction[2]);
}

/** 물리 쿼터니언 [x,y,z,w] 를 Three.js 쿼터니언으로 */
export function toRenderQuaternion(q, target = new THREE.Quaternion()) {
  return target.set(q[0], q[1], q[2], q[3]);
}

/** 물리 길이(m)를 화면 길이로 */
export function toRenderLength(meters) {
  return meters * RENDER_UNITS_PER_METER;
}

// ── 지도(궤도) 화면 좌표 ─────────────────────────────────────
// 지도 화면은 행성 전체를 보여주므로 1 단위 = 1 km 로 줄이고, 행성 중심을 원점으로 둔다.
export const MAP_UNITS_PER_METER = 1 / 1000;

/** 물리 위치(m)를 지도 화면 위치로 */
export function toMapPosition(physicsPosition, target = new THREE.Vector3()) {
  return target.set(
    physicsPosition[0] * MAP_UNITS_PER_METER,
    physicsPosition[1] * MAP_UNITS_PER_METER,
    physicsPosition[2] * MAP_UNITS_PER_METER,
  );
}

/** 물리 길이(m)를 지도 화면 길이로 */
export function toMapLength(meters) {
  return meters * MAP_UNITS_PER_METER;
}
