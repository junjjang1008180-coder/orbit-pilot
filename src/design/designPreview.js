/**
 * 설계 화면 3D 미리보기
 * ------------------------------------------------------------
 * 비행 화면과 같은 로켓 모델(createRocketView)로 조립 중인 로켓을 보여준다.
 * - 마우스 왼쪽 드래그: 로켓 주위로 회전
 * - 휠: 확대·축소
 * - 부품 클릭: onPickPart(stack 위치) 호출
 */
import * as THREE from 'three';
import { buildRocket } from '../rocket/rocketDefinition.js';
import { createRocketView } from '../rocket/rocketView.js';
import { createEnvironmentMap } from '../scene/environmentMap.js';

const ROTATE_SPEED = 0.008; // rad / px
const CLICK_MOVE_LIMIT = 4; // 이 픽셀 이하로 움직이면 드래그가 아니라 클릭

/**
 * @param {HTMLElement} container
 * @param {{ onPickPart: (stackIndex:number) => void, modelLibrary?: object }} options
 */
export function createDesignPreview(container, { onPickPart, modelLibrary = null }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const envMap = createEnvironmentMap(renderer); // 금속 반사용 (이 렌더러 전용)

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x404850, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 8, 6);
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const view = { azimuth: 0.6, elevation: 0.15, distanceScale: 1 };
  let rocketView = null;
  let partIndexMap = []; // [stageIndex][partIndex] → stack 위치
  let height = 1;
  let selectedStackIndex = -1;

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function updateCamera() {
    const distance = Math.max(8, height * 1.6) * view.distanceScale;
    const target = new THREE.Vector3(0, height / 2, 0);
    camera.position.set(
      target.x + distance * Math.cos(view.elevation) * Math.sin(view.azimuth),
      target.y + distance * Math.sin(view.elevation),
      target.z + distance * Math.cos(view.elevation) * Math.cos(view.azimuth),
    );
    camera.lookAt(target);
  }

  // ── 마우스: 드래그 회전 / 클릭 선택 / 휠 확대 ─────────────
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 포인터 캡처 미지원 시 무시 */
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    view.azimuth -= dx * ROTATE_SPEED;
    view.elevation = THREE.MathUtils.clamp(view.elevation + dy * ROTATE_SPEED, -0.3, 1.3);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  el.addEventListener('pointerup', (e) => {
    if (drag && drag.moved <= CLICK_MOVE_LIMIT) pick(e);
    drag = null;
  });
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.distanceScale = THREE.MathUtils.clamp(view.distanceScale * Math.exp(e.deltaY * 0.0015), 0.4, 3);
    },
    { passive: false },
  );

  const raycaster = new THREE.Raycaster();
  function pick(e) {
    if (!rocketView) return;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(rocketView.group, true)[0];
    if (!hit) return;
    let obj = hit.object;
    while (obj && obj.userData.partId === undefined) obj = obj.parent;
    if (obj) onPickPart(partIndexMap[obj.userData.stageIndex]?.[obj.userData.partIndex] ?? -1);
  }

  return {
    /**
     * @param {{name:string, stages:{parts:string[]}[]}} definition 빈 단이 없는 로켓 구성
     * @param {object} partsCatalog
     */
    setDesign(definition, partsCatalog) {
      if (rocketView) scene.remove(rocketView.group);
      rocketView = null;
      partIndexMap = [];
      height = 1;
      if (!definition || definition.stages.length === 0) return;
      rocketView = createRocketView(buildRocket(definition, partsCatalog), modelLibrary, { envMap });
      scene.add(rocketView.group);
      height = Math.max(1, rocketView.height);
      let index = 0;
      partIndexMap = definition.stages.map((stage) => stage.parts.map(() => index++));
      this.setSelected(selectedStackIndex);
    },

    /** 선택한 부품을 밝게 표시 */
    setSelected(stackIndex) {
      selectedStackIndex = stackIndex;
      if (!rocketView) return;
      rocketView.group.traverse((obj) => {
        if (obj.userData.partId === undefined) return;
        const idx = partIndexMap[obj.userData.stageIndex]?.[obj.userData.partIndex];
        obj.traverse((child) => {
          if (child.material?.emissive) child.material.emissive.setHex(idx === stackIndex ? 0x335577 : 0x000000);
        });
      });
    },

    render() {
      updateCamera();
      renderer.render(scene, camera);
    },
  };
}
