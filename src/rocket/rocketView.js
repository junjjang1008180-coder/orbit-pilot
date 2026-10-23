/**
 * 로켓 3D 표시 (부품 모델은 partModels.js — 노즐·배관·패널·창문 등을 기본 도형으로 조합)
 * ------------------------------------------------------------
 * 부품의 길이·반지름은 물리 설정의 부품 값을 읽어 쌓는다.
 * 그룹의 원점 = 로켓 맨 아래 끝(물리 위치 기준점과 같음), 로컬 +Y = 기수.
 * 단(stage)마다 하위 그룹을 두고, 각 단 그룹의 원점은 그 단의 아래 끝이다.
 * 단 분리 시 해당 단 그룹을 떼어 내 분리된 물체 표시에 넘긴다.
 * assets/models/<부품 id>.glb 가 불러와져 있으면 그 부품은 GLB 모델로, 아니면 partModels 의 모델로 그린다.
 */
import * as THREE from 'three';
import { toRenderLength } from '../scene/renderCoordinates.js';
import { createPartModel } from './partModels.js';

/**
 * @param {ReturnType<typeof import('./rocketDefinition.js').buildRocket>} rocket
 * @param {ReturnType<typeof import('../assets/modelLibrary.js').createModelLibrary>} [modelLibrary]
 * @param {{envMap?: THREE.Texture}} [options] envMap: 금속 반사용 주변 환경 (렌더러마다 따로 만든 것)
 */
export function createRocketView(rocket, modelLibrary = null, { envMap = null } = {}) {
  const group = new THREE.Group();
  const stageGroups = [];
  const stageHeights = [];

  rocket.stages.forEach((stage, stageIndex) => {
    const stageGroup = new THREE.Group();
    stageGroup.name = `stage-${stageIndex}`;
    let y = 0;
    stage.parts.forEach((part, partIndex) => {
      const isTopPart = stageIndex === rocket.stages.length - 1 && partIndex === stage.parts.length - 1;
      const mesh =
        modelLibrary?.createFitted(part.id, { height: toRenderLength(part.length) }) ??
        createPartModel(
          { ...part, length: toRenderLength(part.length), radius: toRenderLength(part.radius) },
          { isTopPart, envMap },
        );
      mesh.position.y = y;
      mesh.userData = { partId: part.id, stageIndex, partIndex }; // 클릭한 부품 찾기용
      stageGroup.add(mesh);
      y += toRenderLength(part.length);
    });
    group.add(stageGroup);
    stageGroups.push(stageGroup);
    stageHeights.push(y);
  });

  const view = {
    group,
    stageGroups,
    height: 0, // 현재 붙어 있는 단들의 전체 높이 (화면 단위)
    stageHeights, // 단별 높이 (화면 단위)
    // 단별 가장 굵은 반지름 (화면 단위) — 엔진 불꽃 크기에 쓴다
    stageRadii: rocket.stages.map((stage) => toRenderLength(stage.maxRadius)),

    /** 현재 단(currentStage)부터 위로 단 그룹을 다시 쌓는다 */
    layout(currentStage) {
      let y = 0;
      for (let i = currentStage; i < stageGroups.length; i++) {
        stageGroups[i].position.y = y;
        y += stageHeights[i];
      }
      view.height = y;
    },

    /** 분리된 단의 그룹을 로켓에서 떼어 돌려준다 (원점 = 그 단의 아래 끝) */
    detachStage(index) {
      const stageGroup = stageGroups[index];
      group.remove(stageGroup);
      stageGroup.position.set(0, 0, 0);
      return stageGroup;
    },
  };
  view.layout(0);
  return view;
}
