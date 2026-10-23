/**
 * 하늘 (그라데이션 하늘 + 태양 + 우주에서 보이는 지평선 빛 + 별) — 시각 효과 전용
 * ------------------------------------------------------------
 * 카메라를 둘러싼 큰 구에 셰이더로 하늘색을 칠한다.
 *   - 지상: 천정은 짙은 파랑, 지평선은 밝은 하늘색, 태양 주변은 밝게
 *   - 고도가 오르면 하늘이 검게 바뀌고 별이 나타나며, 행성 가장자리에 얇은 대기 빛이 남는다
 * 가장 먼저 그려지고(renderOrder) 깊이를 쓰지 않으므로, 행성·로켓이 항상 그 위에 그려진다.
 */
import * as THREE from 'three';

const DOME_RADIUS = 1e7; // 하늘 구 반지름 (카메라 far 보다 작게)
const STAR_COUNT = 4000;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uUp;          // 카메라 위치의 천정 방향
  uniform vec3 uSunDir;      // 태양 방향
  uniform float uSpace;      // 0 = 지상 하늘, 1 = 우주
  uniform float uHorizonSin; // 우주에서 본 행성 가장자리(지평선)의 고각 sin 값
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dot(dir, uUp);
    vec3 zenith = vec3(0.04, 0.16, 0.55);
    vec3 horizon = vec3(0.45, 0.65, 0.9);
    vec3 below = vec3(0.35, 0.42, 0.5);
    vec3 day = h >= 0.0
      ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45))
      : mix(horizon, below, clamp(-h * 5.0, 0.0, 1.0));

    // 우주: 검은 하늘 + 행성 가장자리의 얇은 푸른 대기 띠
    float limb = exp(-abs(h - uHorizonSin) * 60.0);
    vec3 space = vec3(0.25, 0.5, 1.0) * limb * 0.6;
    vec3 color = mix(day, space, uSpace);

    // 태양: 작은 원반 + 넓은 빛무리 (우주에서는 빛무리가 약해진다)
    float s = max(dot(dir, uSunDir), 0.0);
    color += vec3(1.0, 0.95, 0.85) * (pow(s, 2000.0) * 6.0 + pow(s, 12.0) * 0.35 * (1.0 - uSpace * 0.8));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * @param {number[]} sunDirection 태양 방향 (월드)
 */
export function createSkyDome(sunDirection) {
  const group = new THREE.Group();
  group.name = 'sky';

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunDir: { value: new THREE.Vector3(...sunDirection).normalize() },
      uSpace: { value: 0 },
      uHorizonSin: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), material);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  group.add(dome);

  const stars = createStars(DOME_RADIUS * 0.9);
  stars.renderOrder = -1;
  group.add(stars);

  return {
    group,
    stars,
    /**
     * @param {THREE.Vector3} cameraPosition 화면 좌표의 카메라 위치
     * @param {number[]} up 카메라(조종 중인 비행체) 위치의 천정 방향
     * @param {number} altitude 고도 (m)
     * @param {number} planetRadius 행성 반지름 (m)
     * @param {number} atmosphereTop 대기 상한 고도 (m)
     */
    update(cameraPosition, up, altitude, planetRadius, atmosphereTop) {
      group.position.copy(cameraPosition);
      const u = material.uniforms;
      u.uUp.value.set(up[0], up[1], up[2]);
      // 대기 밀도는 지수적으로 줄어드므로, 하늘색도 대기 상한의 40% 쯤에서 거의 우주가 된다
      const space = Math.min(1, Math.max(0, altitude / (atmosphereTop * 0.45)));
      u.uSpace.value = space * space * (3 - 2 * space);
      const r = planetRadius + Math.max(0, altitude);
      u.uHorizonSin.value = -Math.sqrt(Math.max(0, 1 - (planetRadius / r) ** 2));
      // 별: 낮 하늘에서는 안 보이고 높이 오를수록 밝아진다
      stars.material.color.setScalar(Math.max(0, u.uSpace.value - 0.25) / 0.75);
    },
  };
}

/** 별: 크기와 색이 조금씩 다른 점들 (거리와 관계없이 화면에서 일정한 크기) */
export function createStars(radius, count = STAR_COUNT) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 12345;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    // 구 위에 고르게
    const z = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(t) * radius, z * radius, r * Math.sin(t) * radius], i * 3);
    const brightness = 0.35 + 0.65 * rand() ** 3;
    const tint = rand();
    colors.set(tint < 0.15 ? [brightness * 0.8, brightness * 0.9, brightness] : tint > 0.9 ? [brightness, brightness * 0.9, brightness * 0.75] : [brightness, brightness, brightness], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false, // 안개 색이 별에 섞이지 않게
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
