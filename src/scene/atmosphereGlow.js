/**
 * 우주에서 보이는 대기 빛 (행성 둘레의 푸른 테두리) — 시각 효과 전용
 * ------------------------------------------------------------
 * 행성보다 조금 큰 구의 안쪽 면을, 가장자리로 갈수록 밝게 칠해 대기층처럼 보이게 한다.
 * 로그 깊이 버퍼를 쓰는 장면이므로 해당 셰이더 조각을 포함해 다른 물체와 깊이가 맞게 한다.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    #include <logdepthbuf_fragment>
    // 안쪽 면(BackSide)을 그리므로 법선은 바깥을 향한다: 시선과 수직일수록(가장자리) 밝게
    float rim = 1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float intensity = pow(rim, 2.2);
    gl_FragColor = vec4(uColor * intensity * uOpacity, intensity * uOpacity);
    #include <colorspace_fragment>
  }
`;

/**
 * @param {number} radius 대기 빛 구 반지름 (화면 단위)
 */
export function createAtmosphereGlow(radius) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(0.35, 0.6, 1.0) },
      uOpacity: { value: 1 },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), material);
  mesh.name = 'atmosphere-glow';
  return {
    mesh,
    setOpacity(value) {
      material.uniforms.uOpacity.value = value;
      mesh.visible = value > 0.01;
    },
  };
}
