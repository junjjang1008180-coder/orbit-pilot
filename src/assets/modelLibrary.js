/**
 * GLB 3D 모델 불러오기와 크기 맞추기
 * ------------------------------------------------------------
 * - assets/models 폴더에 있는 GLB 만 불러온다. 없거나 읽기에 실패하면 그 모델은 건너뛰고
 *   해당 물체는 기본 도형(원기둥·원뿔)으로 그린다. 오류가 나도 게임은 멈추지 않는다.
 * - 모델 크기는 물리 설정의 부품 길이·지름에 맞게 자동으로 맞춘다 (모델 원래 크기와 무관).
 *   모델의 위쪽은 +Y 축이어야 한다 (glTF 기본).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { listAssetFolder } from './assetDirectory.js';

/**
 * @param {typeof import('../config/assetConfig.js').ASSET_CONFIG} assetConfig
 * @param {string[]} partIds 부품 id 목록
 */
export async function loadModelLibrary(assetConfig, partIds) {
  const models = new Map(); // 키 → 원본 장면
  const errors = [];
  const available = await listAssetFolder(assetConfig.modelFolder);
  const wanted = [...partIds, ...assetConfig.extraModels].filter((key) => available.has(key + assetConfig.modelExtension));
  const loader = new GLTFLoader();

  await Promise.all(
    wanted.map(async (key) => {
      const url = assetConfig.modelFolder + key + assetConfig.modelExtension;
      try {
        const gltf = await loader.loadAsync(url);
        models.set(key, gltf.scene);
      } catch (error) {
        errors.push({ key, url, message: String(error?.message || error) });
        console.warn(`[ORBIT PILOT] 모델을 불러오지 못해 기본 도형을 사용합니다: ${url}`, error);
      }
    }),
  );
  return createModelLibrary(models, errors);
}

/** 불러온 모델 묶음 (테스트에서도 직접 만들 수 있게 분리) */
export function createModelLibrary(models = new Map(), errors = []) {
  return {
    loaded: [...models.keys()],
    errors,
    has: (key) => models.has(key),
    /**
     * 모델 복사본을 크기에 맞춰 돌려준다. 모델이 없으면 null.
     * @param {string} key
     * @param {{height?:number, diameter?:number, center?:boolean}} fit
     *   height: 높이를 이 값에 맞춤 / diameter: 가로 폭(가장 넓은 쪽)을 이 값에 맞춤
     *   center: true 면 중심을 원점에, 아니면 바닥 가운데를 원점에 둔다
     */
    createFitted(key, fit) {
      const source = models.get(key);
      if (!source) return null;
      // 원본 루트의 위치·크기를 그대로 둔 채 감싸서, 감싼 그룹 기준으로 크기·위치를 맞춘다
      const inner = new THREE.Group();
      inner.add(source.clone(true));
      // 재질은 복사본마다 따로 둔다 (설계 화면에서 부품 하나만 강조할 수 있도록)
      inner.traverse((obj) => {
        if (obj.isMesh) obj.material = Array.isArray(obj.material) ? obj.material.map((m) => m.clone()) : obj.material.clone();
      });
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      let scale = 1;
      if (fit.height && size.y > 0) scale = fit.height / size.y;
      else if (fit.diameter) {
        const width = fit.center ? Math.max(size.x, size.y, size.z) : Math.max(size.x, size.z);
        if (width > 0) scale = fit.diameter / width;
      }
      inner.scale.setScalar(scale);
      inner.position.set(-center.x * scale, fit.center ? -center.y * scale : -box.min.y * scale, -center.z * scale);
      const wrapper = new THREE.Group();
      wrapper.name = `model:${key}`;
      wrapper.add(inner);
      return wrapper;
    },
  };
}
