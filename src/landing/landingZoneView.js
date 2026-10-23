/**
 * 착륙 지점 3D 표시
 * ------------------------------------------------------------
 * 부스터 분리 때 정해진 착륙 지점에 착륙 패드(반지름 = 설정 landingZoneRadius)를 그리고,
 * 그 주변 지표는 고해상도 조각으로 바꿔 부스터가 실제 지면 높이에 내려앉게 보이게 한다.
 * assets/models/landingPad.glb 가 있으면 그 모델을 패드 지름에 맞춰 쓴다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from '../scene/renderCoordinates.js';

/**
 * @param {THREE.Scene} scene
 * @param {object} config PHYSICS_CONFIG
 * @param {ReturnType<typeof import('../scene/planetView.js').createPlanetView>} planetView
 */
export function createLandingZoneView(scene, config, planetView, modelLibrary = null) {
  let zone = null; // { group, position }

  function build(position) {
    const frame = localFrame(position, config.planet.northPoleDirection);
    const group = new THREE.Group();
    group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...frame.east),
        new THREE.Vector3(...frame.up),
        new THREE.Vector3(...vec3.scale(frame.north, -1)),
      ),
    );
    const radius = toRenderLength(config.landing.landingZoneRadius);
    const model = modelLibrary?.createFitted('landingPad', { diameter: radius * 2 });
    if (model) {
      group.add(model);
    } else {
      // 패드 바닥
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 0.4, 64),
        new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }),
      );
      pad.position.y = 0.2;
      group.add(pad);
      // 노란 테두리와 X 표시
      const yellow = new THREE.MeshBasicMaterial({ color: 0xffd43b });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 64), yellow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.42;
      group.add(ring);
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.2, radius * 0.12), yellow);
        bar.rotation.set(-Math.PI / 2, 0, angle);
        bar.position.y = 0.43;
        group.add(bar);
      }
    }
    // 멀리서도 보이는 표시 기둥 (빛나는 세로 막대)
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 400, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    beacon.position.y = 200;
    group.add(beacon);
    scene.add(group);
    planetView.addLocalPatch(position);
    return { group, position };
  }

  return {
    /**
     * @param {number[] | null} position 착륙 지점 지표 위치 (m), 없으면 null
     * @param {number[]} origin 화면 원점 (m)
     */
    update(position, origin) {
      if (position && !zone) zone = build(position);
      if (zone) toRenderPosition(zone.position, origin, zone.group.position);
    },
    clear() {
      if (zone) scene.remove(zone.group);
      zone = null;
      planetView.clearLocalPatches();
    },
  };
}
