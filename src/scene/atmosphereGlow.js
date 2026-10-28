/**
 * 우주에서 보이는 대기 (행성 둘레의 빛) — 시각 효과 전용
 * ------------------------------------------------------------
 * 1) 바깥 테두리: 행성보다 조금 큰 구의 안쪽 면을 가장자리로 갈수록 밝게 — 행성 둘레의 푸른 띠
 * 2) 안쪽 안개: 지표 바로 위 구의 바깥 면 — 행성 원판 가장자리가 푸르스름하게 흐려지는 대기층
 * 둘 다 해가 비치는 쪽만 밝고(밤쪽은 거의 안 보임), 낮과 밤의 경계에서는 노을처럼 주황빛이 섞인다
 * (공기가 파란빛을 흩뜨리고, 빛이 비스듬히 길게 지나는 경계에서는 붉은빛이 남는 것을 흉내).
 * 로그 깊이 버퍼를 쓰는 장면이므로 해당 셰이더 조각을 포함해 다른 물체와 깊이가 맞게 한다.
 */
import * as THREE from 'three';
import { SUN_VIEW } from './sunShading.js';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vPosView;    // 이 점의 시점 좌표 (카메라 = 원점)
  varying vec3 vCenterView; // 행성 중심의 시점 좌표 (구의 원점 = 행성 중심)
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    vPosView = mvPosition.xyz;
    vCenterView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = (inner) => /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunView;
  uniform float uOpacity;
  uniform float uPlanetRadius; // 행성 반지름 (화면 단위)
  uniform float uShellRadius;  // 이 구의 반지름
  uniform float uScaleHeight;  // 빛이 옅어지는 높이 (화면 단위)
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vPosView;
  varying vec3 vCenterView;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalView);
    float facing = abs(dot(n, normalize(vViewDir)));
    ${inner
      // 행성 원판 위: 비스듬히 볼수록 대기를 길게 지나 푸르게 (가운데는 거의 투명)
      ? 'float density = 1.0 - exp(-0.05 / max(facing, 0.02));'
      // 행성 둘레: 시선이 행성에 가장 가까이 지나는 높이가 낮을수록 밝다 (지표 바로 위가 가장 밝고 위로 빠르게 옅어짐)
      // 카메라 → 이 점 구간에서 행성 중심에 가장 가까운 거리 (카메라가 대기 안에 있으면 위를 볼 때 카메라 자리 = 내 고도)
      : 'vec3 rayDir = normalize(vPosView); float tc = clamp(dot(vCenterView, rayDir), 0.0, length(vPosView)); float closest = length(vCenterView - rayDir * tc); float density = exp(-max(0.0, closest - uPlanetRadius) / uScaleHeight);'}
    float sun = dot(n, uSunView);
    float day = smoothstep(-0.3, 0.4, sun);
    float dusk = exp(-pow(sun / 0.2, 2.0)); // 낮·밤 경계
    vec3 blue = vec3(0.22, 0.5, 1.0);
    vec3 sunset = vec3(1.0, 0.42, 0.16);
    vec3 color = mix(blue, sunset, dusk * 0.7) * (0.03 + day * 1.25 + dusk * 0.4);
    float a = density * uOpacity * ${inner ? '0.55' : '1.1'};
    gl_FragColor = vec4(color * a, a);
    #include <colorspace_fragment>
  }
`;

/**
 * @param {number} radius 바깥 테두리 구 반지름 (화면 단위)
 * @param {number} [innerRadius] 안쪽 안개 구 반지름 (화면 단위) — 빼면 안쪽 안개 없음
 * @param {{planetRadius?:number, scaleHeight?:number}} [opt] 행성 반지름·빛이 옅어지는 높이 (화면 단위)
 */
export function createAtmosphereGlow(radius, innerRadius = null, { planetRadius = radius / 1.05, scaleHeight = (radius - planetRadius) / 3 } = {}) {
  const make = (inner) => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShader(inner),
    uniforms: {
      uSunView: SUN_VIEW,
      uOpacity: { value: 1 },
      uPlanetRadius: { value: planetRadius },
      uShellRadius: { value: inner ? innerRadius : radius },
      uScaleHeight: { value: scaleHeight },
    },
    side: inner ? THREE.FrontSide : THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const outerMaterial = make(false);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), outerMaterial);
  mesh.name = 'atmosphere-glow';
  let innerMaterial = null;
  if (innerRadius) {
    innerMaterial = make(true);
    const haze = new THREE.Mesh(new THREE.SphereGeometry(innerRadius, 128, 64), innerMaterial);
    haze.name = 'atmosphere-haze';
    haze.renderOrder = 2;
    mesh.add(haze);
  }
  return {
    mesh,
    setOpacity(value) {
      outerMaterial.uniforms.uOpacity.value = value;
      if (innerMaterial) innerMaterial.uniforms.uOpacity.value = value;
      mesh.visible = value > 0.01;
    },
  };
}
