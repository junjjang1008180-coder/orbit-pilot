/**
 * 우주 정거장 3D 표시 (기본 도형 조합) — 시각 효과 전용
 * ------------------------------------------------------------
 * 원점 = 정거장 아래 끝(물리 위치 기준점), +Y = 도킹 포트 방향. 길이는 물리 설정(station.length)을 따른다.
 * 모듈·노드·트러스·태양전지판·방열판·도킹 포트(노란 정렬 표시)·깜빡이는 항행등으로 구성한다.
 */
import * as THREE from 'three';
import { toRenderPosition, toRenderQuaternion, toRenderLength } from '../scene/renderCoordinates.js';

/**
 * @param {THREE.Scene} scene
 * @param {object} config PHYSICS_CONFIG
 * @param {{envMap?: THREE.Texture}} [options]
 */
export function createStationView(scene, config, { envMap = null } = {}) {
  const L = toRenderLength(config.station.length);
  const r = toRenderLength(config.station.radius);
  const std = (params) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.8, ...params });
  const white = std({ color: 0xeef0f3, roughness: 0.45, metalness: 0.1 });
  const gray = std({ color: 0x9aa1ab, roughness: 0.4, metalness: 0.8 });
  const dark = std({ color: 0x2f333a, roughness: 0.5, metalness: 0.6 });
  const gold = std({ color: 0xd4a537, roughness: 0.3, metalness: 0.95 });
  const solar = std({ map: solarTexture(), roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffd43b });

  const group = new THREE.Group();
  group.name = 'space-station';
  const add = (mesh, y, x = 0, z = 0) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // 아래 모듈 (금박 단열재) → 노드 → 위 모듈 → 도킹 어댑터 → 도킹 포트
  add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.3, 40), gold), L * 0.15);
  add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 32, 16), white), L * 0.34);
  add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, L * 0.36, 40), white), L * 0.56);
  for (const y of [0.42, 0.56, 0.7]) {
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.91, r * 0.03, 6, 40), gray), L * y);
    ring.rotation.x = Math.PI / 2;
  }
  add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.9, L * 0.12, 40), white), L * 0.8);
  add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.45, L * 0.08, 32), gray), L * 0.9);
  // 도킹 포트 테두리 + 노란 정렬 표시 (포트 면 = y L)
  const portRing = add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.42, r * 0.05, 8, 32), yellow), L * 0.995);
  portRing.rotation.x = Math.PI / 2;
  for (const angle of [0, Math.PI / 2]) {
    const bar = add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.7, r * 0.03, r * 0.05), yellow), L);
    bar.rotation.y = angle;
  }

  // 트러스 (가로 막대) + 태양전지판 4장 + 방열판
  add(new THREE.Mesh(new THREE.BoxGeometry(L * 2.2, r * 0.35, r * 0.35), dark), L * 0.34);
  for (const side of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const panel = add(new THREE.Mesh(new THREE.BoxGeometry(L * 0.75, r * 0.04, r * 1.8), solar), L * 0.34, side * L * 0.75, zSide * r * 1.1);
      panel.rotation.x = 0.15 * zSide;
    }
    const radiator = add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.08, L * 0.25, r * 1.2), white), L * 0.34 + L * 0.16, side * L * 0.32, 0);
    radiator.castShadow = true;
  }

  // 항행등 (빨강·초록, 깜빡임)
  const lights = [];
  for (const [x, color] of [[-L * 1.1, 0xff3030], [L * 1.1, 0x30ff60]]) {
    const light = add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 8, 6), new THREE.MeshBasicMaterial({ color })), L * 0.34, x, 0);
    lights.push(light);
  }

  group.visible = false;
  scene.add(group);

  return {
    group,
    /**
     * @param {object|null} station 정거장 물리 상태 (없으면 숨김)
     * @param {number[]} origin 화면 원점 (m)
     * @param {number} time (s) 깜빡임용
     */
    update(station, origin, time) {
      group.visible = Boolean(station);
      if (!station) return;
      toRenderPosition(station.position, origin, group.position);
      toRenderQuaternion(station.orientation, group.quaternion);
      const on = Math.sin(time * 4) > 0.6;
      for (const light of lights) light.visible = on;
    },
  };
}

/** 태양전지판 무늬 (짙은 파랑 셀 + 은색 격자) */
function solarTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9ced6';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#102a5c' : '#163773';
      ctx.fillRect(i * 16 + 1, j * 16 + 1, 14, 14);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
