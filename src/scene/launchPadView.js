/**
 * 발사대 3D 표시 (기본 도형 임시 모델)
 * ------------------------------------------------------------
 * 상판 높이·반지름은 물리 설정(launchSite)을 그대로 읽어
 * 로켓이 서는 높이와 화면의 상판 높이가 일치하게 한다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from './renderCoordinates.js';

export function createLaunchPadView(config, modelLibrary = null) {
  const { planet, launchSite } = config;
  const siteDirection = vec3.normalize(launchSite.direction);
  const sitePosition = vec3.scale(siteDirection, planet.radius); // 지표 위치 (m)
  const frame = localFrame(sitePosition, planet.northPoleDirection);

  const padHeight = toRenderLength(launchSite.padHeight);
  const padRadius = toRenderLength(launchSite.padRadius);

  const group = new THREE.Group();
  // 그룹 로컬 축: X = 동쪽, Y = 위, Z = 남쪽
  const south = vec3.scale(frame.north, -1);
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.east),
      new THREE.Vector3(...frame.up),
      new THREE.Vector3(...south),
    ),
  );

  // assets/models/launchPad.glb 가 있으면 상판 지름에 맞춰 그 모델을 쓴다
  const model = modelLibrary?.createFitted('launchPad', { diameter: padRadius * 2 });
  if (model) {
    group.add(model);
    return {
      group,
      update(origin) {
        toRenderPosition(sitePosition, origin, group.position);
      },
    };
  }

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb33a2e, roughness: 0.6, metalness: 0.3 });

  // 상판 (원기둥): 지면(0)부터 상판 높이까지
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(padRadius, padRadius * 1.08, padHeight, 48), concrete);
  pad.position.y = padHeight / 2;
  group.add(pad);

  // 화염 배출구 표시 (상판 중앙의 어두운 원)
  const flameHole = new THREE.Mesh(
    new THREE.CircleGeometry(padRadius * 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  flameHole.rotation.x = -Math.PI / 2;
  flameHole.position.y = padHeight + 0.02;
  group.add(flameHole);

  // 발사탑 (상판 북서쪽 가장자리 — 남쪽에서 보는 카메라를 가리지 않도록)
  const towerHeight = padRadius * 1.8;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, towerHeight, 1.6), steel);
  tower.position.set(-padRadius * 0.5, padHeight + towerHeight / 2, -padRadius * 0.5);
  group.add(tower);

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });

  return {
    group,
    update(origin) {
      toRenderPosition(sitePosition, origin, group.position);
    },
  };
}
