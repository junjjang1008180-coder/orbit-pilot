/**
 * 지도(궤도) 화면 카메라
 * ------------------------------------------------------------
 * 초점(행성·달·로켓, 또는 "자동" = 지금 중력권의 천체)을 바라보며 주위를 도는 카메라.
 *   드래그(왼쪽·오른쪽 버튼, 한 손가락 터치) = 회전, 휠·두 손가락 스크롤·핀치 = 확대·축소,
 *   방향키 = 회전, +/− = 확대·축소 (입력 연결은 main.js / cameraMouseInput.js)
 * 확대·축소와 초점 이동은 부드럽게 따라간다 (갑자기 튀지 않게).
 * 각도 기준: 월드 +Y 를 위로 두고, 방위각 0 = +Z 쪽에서 바라봄.
 */
import * as THREE from 'three';
import { toMapLength } from '../scene/renderCoordinates.js';

// 지도 카메라 조작 한계 (화면 연출 값)
const MIN_ELEVATION = THREE.MathUtils.degToRad(-85);
const MAX_ELEVATION = THREE.MathUtils.degToRad(85);
const ROTATE_SPEED = 0.005; // rad / px
const ZOOM_SPEED = 0.0015;
const FOLLOW_RATE = 10; // 거리·초점이 목표를 따라가는 빠르기 (1/s)
const DEFAULT_ELEVATION = THREE.MathUtils.degToRad(25);

/** 초점 종류별 기본 거리 (천체 반지름의 몇 배) */
const DEFAULT_DISTANCE_FACTOR = { planet: 4.2, moon: 6, rocket: 15 };

export function createMapCamera(camera, config) {
  const planetRadius = toMapLength(config.planet.radius);
  const maxDistance = planetRadius * 60;
  let minDistance = planetRadius * 1.3;
  const view = {
    azimuth: 0,
    elevation: DEFAULT_ELEVATION,
    distance: planetRadius * 4.2,
    targetDistance: planetRadius * 4.2,
  };
  const target = new THREE.Vector3(); // 지금 바라보는 점 (부드럽게 이동)
  let focusId = 'planet';
  let focusKind = 'planet';
  let focusRadius = planetRadius;
  let mode = 'auto'; // 사용자가 고른 초점: 'auto' | 'rocket' | 'planet' | 'moon'
  let transition = 0; // 초점이 바뀐 뒤 부드럽게 옮겨 가는 남은 시간 (s)

  return {
    camera,
    rotate(deltaX, deltaY) {
      view.azimuth -= deltaX * ROTATE_SPEED;
      view.elevation = THREE.MathUtils.clamp(view.elevation + deltaY * ROTATE_SPEED, MIN_ELEVATION, MAX_ELEVATION);
    },
    zoom(deltaY) {
      view.targetDistance = THREE.MathUtils.clamp(view.targetDistance * Math.exp(deltaY * ZOOM_SPEED), minDistance, maxDistance);
    },
    /** 초점 고르기 ('auto' 는 지금 중력권의 천체) */
    setFocusMode(next) {
      mode = next;
    },
    getFocusMode: () => mode,
    /** 시점 초기화: 지금 초점의 기본 거리·각도 */
    reset() {
      view.azimuth = 0;
      view.elevation = DEFAULT_ELEVATION;
      view.targetDistance = focusRadius * (DEFAULT_DISTANCE_FACTOR[focusKind] ?? 4.2);
    },
    getView() {
      return { ...view, minDistance, maxDistance, focusId, mode };
    },
    /**
     * @param {{id:string, kind:string, target:THREE.Vector3, radius:number}} [focus] 바라볼 대상 (지도 좌표)
     * @param {number} [dt] 화면 프레임 시간 (s)
     */
    update(focus = { id: 'planet', kind: 'planet', target: new THREE.Vector3(), radius: planetRadius }, dt = 1 / 60) {
      if (focus.id !== focusId) {
        focusId = focus.id;
        focusKind = focus.kind;
        focusRadius = focus.radius;
        view.targetDistance = focus.radius * (DEFAULT_DISTANCE_FACTOR[focus.kind] ?? 4.2);
        transition = 0.8;
      }
      minDistance = focus.radius * 1.3;
      view.targetDistance = THREE.MathUtils.clamp(view.targetDistance, minDistance, maxDistance);
      const blend = 1 - Math.exp(-FOLLOW_RATE * Math.min(dt, 0.1));
      view.distance += (view.targetDistance - view.distance) * blend;
      // 초점이 바뀐 직후에는 부드럽게 옮겨 가고, 그 뒤에는 대상(움직이는 로켓·달)을 그대로 따라간다
      if (transition > 0) {
        transition -= dt;
        target.lerp(focus.target, Math.min(1, blend * 1.5));
      } else {
        target.copy(focus.target);
      }
      const cosE = Math.cos(view.elevation);
      camera.position
        .set(view.distance * cosE * Math.sin(view.azimuth), view.distance * Math.sin(view.elevation), view.distance * cosE * Math.cos(view.azimuth))
        .add(target);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
    },
  };
}
