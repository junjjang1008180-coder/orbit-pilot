/**
 * 재진입 플라스마 빛 (시각 효과 전용)
 * ------------------------------------------------------------
 * 공기를 맞는 앞면에 충격파 덮개(반구), 그 뒤로 길게 빛나는 꼬리.
 * 세기는 물리 상태의 열유속(heatFlux)으로 정하고, 방향은 속도 반대쪽(꼬리가 흐르는 쪽)이다.
 * 앞면: 꼬리가 진행 방향을 향하면(열 차폐막 앞) 로켓 아래 끝, 아니면 기수 끝.
 */
import * as THREE from 'three';
import { vec3, quat } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from '../scene/renderCoordinates.js';

const FLUX_START = 30_000; // 이 열유속(W/m²)부터 보이기 시작
const FLUX_FULL = 450_000; // 이 열유속에서 가장 밝게

/** 꼬리 밝기 그라데이션: 아래(충격파 쪽, uv.y = 0) 밝고 위(하류, uv.y = 1)로 갈수록 검정(= 더해지는 빛 없음) */
function createTrailGradient() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, canvas.height, 0, 0); // 캔버스 아래 = uv.y 0
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#bdbdbd');
  g.addColorStop(0.6, '#3a3a3a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createReentryGlow(scene) {
  const group = new THREE.Group();
  group.visible = false;
  const gradient = createTrailGradient();
  const additive = (color, map = null) =>
    new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

  // 충격파 덮개: 앞(−Y)을 향한 반구
  const shockMaterial = additive(0xff8a3d);
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shockMaterial);
  const coreMaterial = additive(0xffd0a0);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), coreMaterial);
  // 꼬리: +Y(하류)로 가늘어지는 원뿔 껍질 두 겹
  const trailMaterial = additive(0xff6a4a, gradient);
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1, 1, 32, 1, true), trailMaterial);
  const innerTrailMaterial = additive(0xffc078, gradient);
  const innerTrail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.7, 1, 24, 1, true), innerTrailMaterial);
  group.add(shock, core, trail, innerTrail);
  scene.add(group);

  const up = new THREE.Vector3(0, 1, 0);
  const downstream = new THREE.Vector3();

  return {
    /**
     * @param {object} state 비행체 상태 (position, velocity, orientation, heatFlux, stages)
     * @param {number[]} origin 화면 원점 (m)
     * @param {number} time 화면 시각 (s) — 깜빡임
     */
    update(state, origin, time) {
      const intensity = Math.min(1, Math.max(0, (state.heatFlux - FLUX_START) / (FLUX_FULL - FLUX_START)));
      const speed = vec3.length(state.velocity);
      group.visible = intensity > 0 && speed > 1 && !state.destroyed && !state.landed;
      if (!group.visible) return;
      // 붙어 있는 단들의 높이·가장 굵은 반지름 (m)
      let height = 0;
      let radius = 0;
      for (let i = state.currentStage; i < state.stages.length; i++) {
        height += state.stages[i].length;
        radius = Math.max(radius, state.stages[i].maxRadius);
      }
      const dir = vec3.scale(state.velocity, 1 / speed); // 진행 방향
      const nose = quat.rotate(state.orientation, [0, 1, 0]);
      const tailFirst = vec3.dot(nose, dir) < 0;
      // 앞면 위치 (m) 와 그 조금 앞
      const front = tailFirst ? state.position : vec3.addScaled(state.position, nose, height);
      toRenderPosition(vec3.addScaled(front, dir, radius * 0.35), origin, group.position);
      downstream.set(-dir[0], -dir[1], -dir[2]);
      group.quaternion.setFromUnitVectors(up, downstream);

      const flicker = 0.88 + 0.12 * Math.sin(time * 37) * Math.sin(time * 23);
      const r = toRenderLength(radius) * (1.25 + 0.25 * intensity);
      shock.scale.set(r, r * 0.55, r);
      core.scale.set(r * 0.8, r * 0.35, r * 0.8);
      shockMaterial.opacity = 0.55 * intensity * flicker;
      coreMaterial.opacity = 0.45 * intensity * flicker;
      const length = toRenderLength(height) * (0.8 + 2.4 * intensity);
      trail.scale.set(r * 1.1, length, r * 1.1);
      trail.position.y = length / 2;
      trailMaterial.opacity = 0.5 * intensity * flicker;
      const innerLength = length * 0.7;
      innerTrail.scale.set(r, innerLength, r);
      innerTrail.position.y = innerLength / 2;
      innerTrailMaterial.opacity = 0.6 * intensity * flicker;
    },
    clear() {
      group.visible = false;
    },
  };
}
