/**
 * 금속 반사용 주변 환경 텍스처 — 시각 효과 전용
 * ------------------------------------------------------------
 * 밝은 실내 조명 환경(RoomEnvironment)을 미리 흐리게 계산(PMREM)해,
 * 로켓의 금속 부품(노즐·볼트·금박)이 검게 죽지 않고 반짝이게 한다.
 * 렌더러마다 따로 만들어야 하므로(텍스처가 렌더러에 묶임) 렌더러를 받아서 만든다.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** @param {THREE.WebGLRenderer} renderer */
export function createEnvironmentMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}
