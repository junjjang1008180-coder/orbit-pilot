/**
 * 로켓 추적 카메라
 * ------------------------------------------------------------
 * - 로켓을 중심으로 궤도처럼 도는 카메라: 방위각·고각·거리로 위치를 정한다.
 * - 각도는 로켓 위치의 지역 좌표계(위/동/남) 기준이라 지평선이 기울지 않는다.
 * - 우클릭 드래그(rotate)와 휠(zoom) 입력은 cameraMouseInput.js 가 전달한다.
 * - 화면 원점이 로켓 위치이므로 카메라 위치는 로켓 기준 상대 좌표다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderDirection } from '../scene/renderCoordinates.js';

// 카메라 조작 한계 (화면 연출 값, 물리와 무관)
const MIN_ELEVATION = THREE.MathUtils.degToRad(-80); // 아래에서 올려다보는 최대 각
const MAX_ELEVATION = THREE.MathUtils.degToRad(85); // 위에서 내려다보는 최대 각 (뒤집힘 방지)
const MAX_DISTANCE = 5000; // 최대 거리 (화면 단위)
const ROTATE_SPEED = 0.005; // 드래그 1픽셀당 회전 (rad)
const ZOOM_SPEED = 0.0015; // 휠 한 단위당 거리 배율 지수

export function createChaseCamera(camera, config) {
  const up = new THREE.Vector3();
  const east = new THREE.Vector3();
  const south = new THREE.Vector3();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();

  const view = {
    azimuth: 0, // 0 = 남쪽에서 북쪽을 바라봄, + 는 동쪽으로 돈다 (rad)
    elevation: THREE.MathUtils.degToRad(8), // 지평선 위 각도 (rad)
    distance: null, // null 이면 로켓 크기에 맞춘 기본 거리
  };
  let minDistance = 5;
  let defaultDistance = 30; // 로켓 크기에 맞춘 기본 거리 (update 에서 갱신)

  return {
    /** 드래그한 픽셀만큼 카메라를 로켓 주위로 돌린다 */
    rotate(deltaX, deltaY) {
      view.azimuth -= deltaX * ROTATE_SPEED;
      view.elevation = THREE.MathUtils.clamp(view.elevation + deltaY * ROTATE_SPEED, MIN_ELEVATION, MAX_ELEVATION);
    },

    /** 휠 입력만큼 확대(음수)·축소(양수) */
    zoom(deltaY) {
      const current = view.distance ?? defaultDistance;
      view.distance = THREE.MathUtils.clamp(current * Math.exp(deltaY * ZOOM_SPEED), minDistance, MAX_DISTANCE);
    },

    /** 현재 카메라 조작 상태 (검수용) */
    getView() {
      return { ...view, minDistance, maxDistance: MAX_DISTANCE };
    },

    /**
     * @param {object} state 로켓 물리 상태 (읽기 전용)
     * @param {number} rocketHeight 로켓 모델 높이 (화면 단위)
     * @param {number[]} [bodyCenter] 지평선 기준 천체 중심 (달 근처에서는 달 중심, m)
     */
    update(state, rocketHeight, bodyCenter = [0, 0, 0]) {
      minDistance = Math.max(5, rocketHeight * 0.8);
      defaultDistance = Math.max(30, rocketHeight * 2.6);
      if (view.distance === null) view.distance = defaultDistance;
      view.distance = THREE.MathUtils.clamp(view.distance, minDistance, MAX_DISTANCE);

      const frame = localFrame(vec3.sub(state.position, bodyCenter), config.planet.northPoleDirection);
      toRenderDirection(frame.up, up);
      toRenderDirection(frame.east, east);
      toRenderDirection(frame.north, south).negate();

      // 로켓 중앙(높이의 절반)을 바라본다. 로켓이 기울어도 중앙을 따라간다.
      const noseHalf = new THREE.Vector3(0, rocketHeight * 0.5, 0).applyQuaternion(
        new THREE.Quaternion(...state.orientation),
      );
      target.copy(noseHalf);

      const cosE = Math.cos(view.elevation);
      offset
        .copy(south)
        .multiplyScalar(cosE * Math.cos(view.azimuth))
        .addScaledVector(east, cosE * Math.sin(view.azimuth))
        .addScaledVector(up, Math.sin(view.elevation))
        .multiplyScalar(view.distance);

      camera.position.copy(target).add(offset);
      camera.up.copy(up);
      camera.lookAt(target);
    },
  };
}
