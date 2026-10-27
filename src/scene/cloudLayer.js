/**
 * 구름층 — 시각 효과 전용
 * ------------------------------------------------------------
 * 행성 위 일정 고도에 반투명 구름 구를 두어, 지상에서는 머리 위 구름으로,
 * 상승 중에는 구름을 뚫고 올라가는 모습으로, 우주에서는 행성 위 구름 무늬로 보인다.
 * 아주 천천히 돌아 살아 있는 느낌을 준다. 물리(항력 등)에는 영향이 없다.
 */
import * as THREE from 'three';
import { createCloudTexture, createGroundDetailTexture, GLOBE_ROTATION_X } from './proceduralTextures.js';
import { toRenderLength } from './renderCoordinates.js';
import { dayOnly, addSurfaceDetail } from './sunShading.js';

const CLOUD_ALTITUDE = 3_000; // 구름층 고도 (m, 시각 효과)
const DRIFT_SPEED = 0.0000025; // 회전 속도 (rad/s)

/** @param {number} planetRadius (m) */
export function createCloudLayer(planetRadius, { segments = 160 } = {}) {
  // 구름 밑면(안쪽 면)이 너무 어둡게 보이지 않도록 약하게 스스로 빛나게 한다
  // 밤쪽 구름은 어둡게 (스스로 빛남은 낮쪽에서만)
  const material = dayOnly(new THREE.MeshLambertMaterial({
    map: createCloudTexture(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    emissive: 0x8a96a8,
    emissiveIntensity: 0.45,
  }));
  addSurfaceDetail(material, createGroundDetailTexture(), 'alpha'); // 구름 가장자리를 잘게 쪼갠다
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(toRenderLength(planetRadius + CLOUD_ALTITUDE), segments, segments / 2),
    material,
  );
  mesh.name = 'clouds';
  mesh.rotation.x = GLOBE_ROTATION_X;
  mesh.renderOrder = 1;
  let spin = 0;
  return {
    mesh,
    altitude: CLOUD_ALTITUDE,
    /** @param {number} dt (s) */
    update(dt) {
      spin += dt * DRIFT_SPEED;
      mesh.rotation.y = spin;
    },
  };
}
