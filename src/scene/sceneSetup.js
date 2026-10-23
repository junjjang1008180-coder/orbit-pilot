/**
 * Three.js 렌더러·장면·카메라·조명·하늘 기본 세팅
 * ------------------------------------------------------------
 * 행성(수십만 m)부터 로켓(수 m)까지 한 화면에 그리므로
 * 로그 깊이 버퍼를 켜서 먼 물체가 겹쳐 깜빡이는 현상을 막는다.
 * 하늘·안개·그림자는 모두 시각 효과이며 물리 계산에는 쓰지 않는다.
 */
import * as THREE from 'three';
import { createSkyDome } from './skyDome.js';

// 태양 방향 (월드, 시각 효과). 발사장에서 남동쪽 높이 약 50°
export const SUN_DIRECTION = new THREE.Vector3(0.6, 0.8, 0.35).normalize();

const HAZE_COLOR_GROUND = new THREE.Color(0x9fc2e6); // 지상 안개(대기 원근) 색
const HAZE_DENSITY_GROUND = 1 / 60_000; // 지상 안개 밀도 (1/m)
const SHADOW_ALTITUDE = 3_000; // 이 고도(m) 아래에서만 그림자를 계산한다
const SHADOW_RANGE = 70; // 그림자 영역 반경 (m, 카메라가 따라가는 비행체 주변)

export function createSceneSetup(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(HAZE_COLOR_GROUND.clone(), HAZE_DENSITY_GROUND);

  // near 는 아주 작게, far 는 행성 전체가 보이도록 크게
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    5e7,
  );

  // 하늘 (그라데이션·태양·별)
  const sky = createSkyDome(SUN_DIRECTION.toArray());
  scene.add(sky.group);

  // 태양광(방향광, 그림자) + 하늘/지면 반사광
  const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -SHADOW_RANGE, right: SHADOW_RANGE, top: SHADOW_RANGE, bottom: -SHADOW_RANGE, near: 1, far: 800 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3b4a2a, 0.9);
  scene.add(hemi);
  // 행성광(지구조): 행성에서 멀리(달 근처) 있을 때 햇빛을 받은 행성이 비추는 은은한 푸른 빛.
  // 달의 밤쪽에서도 지형이 보이게 한다.
  const planetLight = new THREE.DirectionalLight(0x9fc4ff, 0);
  scene.add(planetLight, planetLight.target);
  // 달 근처 보조광: 달 표면 기준 위쪽에서 오는 약한 빛 (밤쪽에서도 착륙할 땅이 보이도록 하는 게임용 조명)
  const moonFill = new THREE.HemisphereLight(0xb7c4d6, 0x2a2a2e, 0);
  scene.add(moonFill);

  const cameras = [camera]; // 창 크기에 맞춰 비율을 갱신할 카메라들
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    for (const cam of cameras) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', resize);

  /**
   * 고도에 따라 하늘·안개·반사광·그림자를 바꾼다
   * @param {number[]} up 카메라가 따라가는 비행체 위치의 천정 방향
   * @param {number} altitude 그 비행체 고도 (m)
   * @param {{planetRadius:number, atmosphereTop:number}} world
   * @param {number} [surfaceAltitude] 가장 가까운 지표(행성 또는 달)까지 높이 (m) — 그림자 계산 여부
   */
  function updateEnvironment(up, altitude, world, surfaceAltitude = altitude) {
    sky.update(camera.position, up, altitude, world.planetRadius, world.atmosphereTop);
    const air = Math.max(0, 1 - altitude / (world.atmosphereTop * 0.45)); // 1 = 지상, 0 = 우주
    scene.fog.density = HAZE_DENSITY_GROUND * air * air;
    hemi.intensity = 0.25 + 0.65 * air; // 우주에서는 하늘 반사광이 거의 없다

    // 그림자: 화면 원점(비행체) 주변만, 낮은 고도에서만
    const shadows = surfaceAltitude < SHADOW_ALTITUDE;
    sun.castShadow = shadows;
    sun.position.copy(SUN_DIRECTION).multiplyScalar(400);
    sun.target.position.set(0, 0, 0);
  }

  /** 지도 화면 등 다른 카메라도 창 크기 변경에 맞추도록 등록 */
  function registerCamera(cam) {
    cameras.push(cam);
    cam.aspect = container.clientWidth / container.clientHeight;
    cam.updateProjectionMatrix();
  }

  /**
   * 행성광 방향·세기
   * @param {number[]} towardPlanet 비행체에서 행성 중심 쪽 단위벡터
   * @param {number} planetAltitude 행성 해수면 고도 (m) — 멀수록(달 근처) 밝게
   */
  function updatePlanetLight(towardPlanet, planetAltitude) {
    const far = Math.min(1, Math.max(0, (planetAltitude - 600_000) / 1_500_000));
    planetLight.intensity = 0.9 * far;
    planetLight.position.set(towardPlanet[0], towardPlanet[1], towardPlanet[2]).multiplyScalar(400);
    planetLight.target.position.set(0, 0, 0);
  }

  /**
   * 달 근처 보조광
   * @param {number[] | null} moonUp 달 중심에서 비행체 쪽 단위벡터 (달 중력권 밖이면 null)
   * @param {number} moonAltitude 달 표면 고도 (m)
   */
  function updateMoonFill(moonUp, moonAltitude) {
    const near = moonUp ? Math.min(1, Math.max(0, 1 - moonAltitude / 400_000)) : 0;
    moonFill.intensity = 0.7 * near;
    if (moonUp) moonFill.position.set(moonUp[0], moonUp[1], moonUp[2]);
  }

  return { renderer, scene, camera, updateEnvironment, updatePlanetLight, updateMoonFill, registerCamera };
}
