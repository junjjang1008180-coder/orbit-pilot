/**
 * 지도(궤도) 화면 카메라
 * ------------------------------------------------------------
 * 초점 천체(행성, 달 중력권 안이면 달) 중심을 바라보며 주위를 도는 카메라. 우클릭 드래그로 회전, 휠로 확대·축소.
 * 초점 천체가 바뀌면 그 천체 크기에 맞는 거리로 다시 맞춘다.
 * 각도 기준: 월드 +Y 를 위로 두고, 방위각 0 = +Z 쪽(남쪽)에서 바라봄.
 */
import * as THREE from 'three';
import { toMapLength } from '../scene/renderCoordinates.js';

// 지도 카메라 조작 한계 (화면 연출 값)
const MIN_ELEVATION = THREE.MathUtils.degToRad(-85);
const MAX_ELEVATION = THREE.MathUtils.degToRad(85);
const ROTATE_SPEED = 0.005; // rad / px
const ZOOM_SPEED = 0.0015;

export function createMapCamera(camera, config) {
  const planetRadius = toMapLength(config.planet.radius);
  let minDistance = planetRadius * 1.3;
  const maxDistance = planetRadius * 60;
  const view = {
    azimuth: 0,
    elevation: THREE.MathUtils.degToRad(25),
    distance: planetRadius * 4.2,
  };
  const target = new THREE.Vector3();
  let focusId = 'planet';

  return {
    camera,
    rotate(deltaX, deltaY) {
      view.azimuth -= deltaX * ROTATE_SPEED;
      view.elevation = THREE.MathUtils.clamp(view.elevation + deltaY * ROTATE_SPEED, MIN_ELEVATION, MAX_ELEVATION);
    },
    zoom(deltaY) {
      view.distance = THREE.MathUtils.clamp(view.distance * Math.exp(deltaY * ZOOM_SPEED), minDistance, maxDistance);
    },
    getView() {
      return { ...view, minDistance, maxDistance, focusId };
    },
    /**
     * @param {{id:string, target:THREE.Vector3, radius:number}} [focus] 바라볼 천체 (지도 좌표). 없으면 행성.
     */
    update(focus = { id: 'planet', target: new THREE.Vector3(), radius: planetRadius }) {
      minDistance = focus.radius * 1.3;
      if (focus.id !== focusId) {
        focusId = focus.id;
        view.distance = focus.radius * (focus.id === 'planet' ? 4.2 : 6);
      }
      view.distance = THREE.MathUtils.clamp(view.distance, minDistance, maxDistance);
      target.copy(focus.target);
      const cosE = Math.cos(view.elevation);
      camera.position.set(
        view.distance * cosE * Math.sin(view.azimuth),
        view.distance * Math.sin(view.elevation),
        view.distance * cosE * Math.cos(view.azimuth),
      ).add(target);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
    },
  };
}
