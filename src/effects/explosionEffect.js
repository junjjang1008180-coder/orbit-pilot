/**
 * 폭발 효과 (Max-Q 파손, 지면 충돌, 착륙 실패)
 * ------------------------------------------------------------
 * 물리 위치에 불덩이(커지며 사라지는 구)와 파편 조각을 잠시 보여준다.
 * 시각 효과일 뿐 물리 계산에는 영향을 주지 않는다.
 */
import * as THREE from 'three';
import { toRenderPosition } from '../scene/renderCoordinates.js';

const DURATION = 2.5; // 효과 지속 시간 (s)
const FIREBALL_SIZE = 18; // 최대 불덩이 반지름 (화면 단위)
const FRAGMENT_COUNT = 24;

/** @param {THREE.Scene} scene */
export function createExplosionEffects(scene) {
  const active = [];
  const fireGeometry = new THREE.SphereGeometry(1, 24, 16);
  const fragmentGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);

  return {
    /** @param {number[]} position 폭발 물리 위치 (m) */
    spawn(position) {
      const group = new THREE.Group();
      const fire = new THREE.Mesh(
        fireGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      group.add(fire);
      const fragments = [];
      const fragmentMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, transparent: true });
      for (let i = 0; i < FRAGMENT_COUNT; i++) {
        const mesh = new THREE.Mesh(fragmentGeometry, fragmentMaterial);
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        fragments.push({ mesh, velocity: dir.multiplyScalar(10 + Math.random() * 25) });
        group.add(mesh);
      }
      const light = new THREE.PointLight(0xff8833, 300, 400);
      group.add(light);
      scene.add(group);
      active.push({ group, fire, fragments, fragmentMaterial, light, age: 0, position: [...position] });
    },

    /**
     * @param {number} dt 화면 프레임 시간 (s)
     * @param {number[]} origin 화면 원점 물리 위치 (m)
     */
    update(dt, origin) {
      for (let i = active.length - 1; i >= 0; i--) {
        const e = active[i];
        e.age += dt;
        const t = Math.min(1, e.age / DURATION);
        toRenderPosition(e.position, origin, e.group.position);
        e.fire.scale.setScalar(FIREBALL_SIZE * Math.sqrt(t) + 1);
        e.fire.material.opacity = 1 - t;
        e.fire.material.color.setHSL(0.08 - 0.06 * t, 1, 0.6 - 0.35 * t);
        e.light.intensity = 300 * (1 - t);
        e.fragmentMaterial.opacity = 1 - t;
        for (const f of e.fragments) f.mesh.position.copy(f.velocity).multiplyScalar(e.age);
        if (t >= 1) {
          scene.remove(e.group);
          e.fire.material.dispose();
          e.fragmentMaterial.dispose();
          active.splice(i, 1);
        }
      }
    },

    clear() {
      for (const e of active) scene.remove(e.group);
      active.length = 0;
    },
    count: () => active.length,
  };
}
