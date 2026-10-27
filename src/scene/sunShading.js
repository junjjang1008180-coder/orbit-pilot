/**
 * 태양 방향에 따른 셰이더 보정 (시각 효과 전용)
 * ------------------------------------------------------------
 * 재질의 스스로 빛남(emissive)을 해가 비치는 쪽/반대쪽에서만 보이게 한다.
 *   - nightOnly: 행성 도시 불빛 — 밤쪽(해를 등진 면)에서만
 *   - dayOnly  : 구름 밑면이 너무 어둡지 않게 주는 은은한 빛 — 낮쪽에서만 (밤쪽 구름은 어둡게)
 * 태양 방향은 카메라(시점) 좌표로 매 프레임 SUN_VIEW 에 넣는다 (updateSunView).
 */
import * as THREE from 'three';

/** 시점 좌표의 태양 방향 (모든 보정 재질이 함께 쓴다) */
export const SUN_VIEW = { value: new THREE.Vector3(0, 1, 0) };

/** 매 프레임 렌더 전에: 월드 태양 방향 → 카메라 좌표 */
export function updateSunView(camera, sunWorld) {
  camera.updateMatrixWorld();
  SUN_VIEW.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
}

function patchEmissive(material, expression) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunView = SUN_VIEW;
    shader.fragmentShader = `uniform vec3 uSunView;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float sunFacing = dot(normalize(vNormal), uSunView);
      totalEmissiveRadiance *= ${expression};`,
    );
  };
  material.customProgramCacheKey = () => `sun-${expression}`;
  return material;
}

/** 밤쪽에서만 빛나게 (경계는 부드럽게) */
export const nightOnly = (material) => patchEmissive(material, '(1.0 - smoothstep(-0.2, 0.06, sunFacing))');
/** 낮쪽에서만 빛나게 */
export const dayOnly = (material) => patchEmissive(material, 'smoothstep(-0.15, 0.35, sunFacing)');

/**
 * 가까이서 볼 때 흐릿하지 않게, 반복되는 잔무늬(회색 0.72~1)를 두 크기로 겹친다.
 * mode 'color': 표면 색에 곱한다 (행성 지표) · 'alpha': 투명도 가장자리를 쪼갠다 (구름)
 * 이미 onBeforeCompile 이 있으면(밤·낮 빛 보정) 이어서 적용한다.
 */
export function addSurfaceDetail(material, detailTexture, mode = 'color') {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uDetail = { value: detailTexture };
    const sample = `
      float d1 = texture2D(uDetail, vMapUv * vec2(96.0, 48.0)).r / 0.86;
      float d2 = texture2D(uDetail, vMapUv * vec2(512.0, 256.0)).r / 0.86;`;
    const apply = mode === 'alpha'
      ? `${sample}
      diffuseColor.a = clamp((diffuseColor.a - (1.16 - d1) * 0.45) * 1.25, 0.0, 1.0);`
      : `${sample}
      diffuseColor.rgb *= d1 * d2;`;
    shader.fragmentShader = `uniform sampler2D uDetail;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>${apply}`);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-detail-${mode}`;
  return material;
}
