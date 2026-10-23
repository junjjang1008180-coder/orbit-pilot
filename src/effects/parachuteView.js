/**
 * 펼친 낙하산 표시 (시각 효과 전용)
 * ------------------------------------------------------------
 * 주황·흰 줄무늬 캐노피(반구 모양)와 기체 꼭대기에서 캐노피 테두리로 이어지는 줄.
 * 크기는 물리 상태의 펼친 면적(parachuteArea, m²)으로 정한다: 캐노피 반지름 = √(면적 / π).
 * 로켓 그룹(원점 = 로켓 아래 끝, +Y = 기수) 안에 붙여, 기수 위쪽에 매단다.
 */
import * as THREE from 'three';
import { toRenderLength } from '../scene/renderCoordinates.js';

const GORES = 16; // 캐노피 조각 수
const LINE_RATIO = 1.6; // 줄 길이 = 캐노피 반지름 × 이 값

export function createParachuteView() {
  const group = new THREE.Group();
  group.visible = false;

  // 캐노피: 반지름 1 짜리 납작한 반구, 조각마다 주황/흰색
  const canopy = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: 0xf06a28, roughness: 0.8, side: THREE.DoubleSide });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < GORES; i++) {
    const gore = new THREE.Mesh(
      new THREE.SphereGeometry(1, 4, 10, (i / GORES) * Math.PI * 2, (Math.PI * 2) / GORES, 0, Math.PI * 0.42),
      i % 2 ? orange : white,
    );
    canopy.add(gore);
  }
  canopy.scale.set(1, 0.55, 1);
  group.add(canopy);

  // 줄: 꼭대기(0,0,0) → 캐노피 테두리
  const rimAngle = Math.PI * 0.42;
  const linePositions = new Float32Array(GORES * 2 * 3);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.8 }));
  lines.frustumCulled = false;
  group.add(lines);

  return {
    group,
    /**
     * @param {number} area 펼친 면적 (m²), 0 이면 숨김
     * @param {number} topHeight 로켓 꼭대기 높이 (화면 단위)
     */
    update(area, topHeight) {
      group.visible = area > 0;
      if (!group.visible) return;
      const radius = toRenderLength(Math.sqrt(area / Math.PI));
      const lineLength = radius * LINE_RATIO;
      group.position.set(0, topHeight, 0);
      // 캐노피 테두리 높이 = 줄 끝
      const rimY = lineLength;
      const rimR = radius * Math.sin(rimAngle);
      canopy.scale.set(radius, radius * 0.55, radius);
      canopy.position.y = rimY - radius * 0.55 * Math.cos(rimAngle);
      for (let i = 0; i < GORES; i++) {
        const a = (i / GORES) * Math.PI * 2;
        linePositions.set([0, 0, 0, Math.cos(a) * rimR, rimY, -Math.sin(a) * rimR], i * 6);
      }
      lineGeometry.getAttribute('position').needsUpdate = true;
    },
  };
}
