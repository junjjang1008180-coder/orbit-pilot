/**
 * 엔진 불꽃 효과
 * ------------------------------------------------------------
 * 로켓(또는 부스터) 그룹의 아래 끝(원점)에 붙여, 실제 추력이 있을 때만 보인다.
 * 길이는 스로틀에 비례하고, 공기가 옅어지면 불꽃이 넓게 퍼진다. 약간씩 깜빡인다.
 * 시각 효과일 뿐 물리 계산에는 영향을 주지 않는다.
 */
import * as THREE from 'three';

const BASE_LENGTH_PER_RADIUS = 7; // 스로틀 100% 일 때 불꽃 길이 = 엔진 반지름 × 이 값
const FLICKER = 0.08; // 길이 깜빡임 비율

/**
 * @param {number} radius 엔진(단) 반지름 (화면 단위)
 * @param {{outer?:number, core?:number, lengthScale?:number}} [style] 불꽃 색·길이 (액체 수소 엔진은 푸르스름)
 */
export function createEngineFlame(radius, { outer: outerColor = 0xff7a1a, core: coreColor = 0xfff1b0, lengthScale = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'engine-flame';

  // 바깥 불꽃(주황) + 안쪽 코어(밝은 노랑). 원뿔 꼭짓점이 아래(-Y)를 향하게 한다.
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: outerColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  for (const mesh of [outer, core]) {
    mesh.rotation.x = Math.PI; // 꼭짓점을 아래로
    group.add(mesh);
  }
  const light = new THREE.PointLight(0xffa040, 0, radius * 40);
  light.position.y = -radius * 2;
  group.add(light);
  group.visible = false;

  return {
    group,
    /**
     * @param {number} throttleFraction 실제 추력 / 최대 추력 (0~1)
     * @param {number} airDensityRatio 현재 공기 밀도 / 해수면 밀도 (0~1)
     * @param {number} time 경과 시간 (s, 깜빡임용)
     */
    update(throttleFraction, airDensityRatio, time) {
      const on = throttleFraction > 0.001;
      group.visible = on;
      if (!on) {
        light.intensity = 0;
        return;
      }
      const flicker = 1 + FLICKER * Math.sin(time * 53) * Math.sin(time * 31);
      const length = radius * BASE_LENGTH_PER_RADIUS * lengthScale * (0.35 + 0.65 * throttleFraction) * flicker;
      const spread = 0.75 + 0.9 * (1 - airDensityRatio); // 진공에 가까울수록 넓게 퍼짐
      outer.scale.set(radius * 0.8 * spread, length, radius * 0.8 * spread);
      outer.position.y = -length / 2;
      core.scale.set(radius * 0.45 * spread, length * 0.55, radius * 0.45 * spread);
      core.position.y = -length * 0.275;
      light.intensity = 30 * throttleFraction;
    },
  };
}
