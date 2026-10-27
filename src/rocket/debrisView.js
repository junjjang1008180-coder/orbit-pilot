/**
 * 분리된 단(독립 비행체) 3D 표시
 * ------------------------------------------------------------
 * 시뮬레이션의 debris 목록을 매 프레임 따라가며,
 * 새로 분리된 단은 로켓 모델에서 해당 단 그룹을 떼어 와 장면에 따로 붙인다.
 * 위치·자세는 분리된 비행체의 물리 상태를 그대로 읽는다.
 * 엔진이 있는 단(부스터)은 엔진 불꽃도 함께 그리고, 파손되면 숨긴다.
 */
import { toRenderPosition, toRenderQuaternion } from '../scene/renderCoordinates.js';
import { createEngineFlame } from '../effects/engineFlame.js';
import { currentThrust, maxThrust } from '../physics/flightPhysics.js';
import { airDensity } from '../physics/aerodynamics.js';
import { vec3 } from '../physics/vectorMath.js';

/**
 * @param {import('three').Scene} scene
 * @param {object} config PHYSICS_CONFIG
 */
export function createDebrisViews(scene, config) {
  const views = new Map(); // debris id → { group, flame }

  return {
    /**
     * @param {object[]} debrisList simulation.debris (읽기 전용)
     * @param {ReturnType<typeof import('./rocketView.js').createRocketView>} rocketView
     * @param {number[]} origin 화면 원점 물리 위치 (m)
     * @param {number} time 경과 시간 (s, 불꽃 깜빡임용)
     */
    sync(debrisList, rocketView, origin, time = 0) {
      for (const debris of debrisList) {
        let view = views.get(debris.id);
        if (!view) {
          const group = rocketView.detachStage(debris.stageIndex);
          const vehicle = debris.vehicle;
          const flame = maxThrust(vehicle) > 0 && !group.userData.noFlame ? createEngineFlame(rocketView.stageRadii[debris.stageIndex]) : null;
          if (flame) group.add(flame.group);
          scene.add(group);
          view = { group, flame };
          views.set(debris.id, view);
        }
        const vehicle = debris.vehicle;
        toRenderPosition(vehicle.position, origin, view.group.position);
        toRenderQuaternion(vehicle.orientation, view.group.quaternion);
        view.group.visible = !vehicle.destroyed;
        if (view.flame) {
          const max = maxThrust(vehicle);
          const alt = vec3.length(vehicle.position) - config.planet.radius;
          view.flame.update(
            vehicle.destroyed || max === 0 ? 0 : currentThrust(vehicle) / max,
            airDensity(alt, config.atmosphere) / config.atmosphere.seaLevelDensity,
            time,
          );
        }
      }
    },

    /** 모든 분리 물체 표시 제거 (재시작 시) */
    clear() {
      for (const view of views.values()) scene.remove(view.group);
      views.clear();
    },
  };
}
