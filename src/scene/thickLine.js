/**
 * 화면에서 일정한 두께로 보이는 선 (지도 궤도선용) — 시각 효과 전용
 * ------------------------------------------------------------
 * WebGL 의 기본 선은 대부분 1 픽셀로만 그려지므로, 점마다 정점 두 개를 두고
 * 정점 셰이더에서 화면 좌표의 선 방향에 수직으로 (픽셀 단위) 벌려 띠를 만든다.
 * 점마다 투명도(alpha)를 줄 수 있고(앞쪽 진하게·뒤쪽 흐리게), 월드 길이 기준 점선도 된다.
 * 렌더러가 로그 깊이 버퍼를 쓰므로 셰이더에 logdepthbuf 조각을 넣는다.
 */
import * as THREE from 'three';

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 prev;
  attribute vec3 next;
  attribute float side;
  attribute float alpha;
  attribute float dist;
  uniform vec2 resolution;
  uniform float width;
  varying float vAlpha;
  varying float vDist;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(position, 1.0);
    vec4 p = mvp * vec4(prev, 1.0);
    vec4 n = mvp * vec4(next, 1.0);
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    vec2 cs = c.xy / c.w * aspect;
    vec2 ps = p.xy / p.w * aspect;
    vec2 ns = n.xy / n.w * aspect;
    vec2 d1 = cs - ps;
    vec2 d2 = ns - cs;
    if (length(d1) < 1e-6) d1 = d2;
    if (length(d2) < 1e-6) d2 = d1;
    vec2 dir = normalize(normalize(d1) + normalize(d2) + vec2(1e-6, 0.0));
    vec2 normal = vec2(-dir.y, dir.x) / aspect;
    c.xy += normal * (width / resolution.y) * side * c.w;
    gl_Position = c;
    vAlpha = alpha;
    vDist = dist;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 color;
  uniform float opacity;
  uniform float dashSize;
  uniform float gapSize;
  varying float vAlpha;
  varying float vDist;
  void main() {
    #include <logdepthbuf_fragment>
    if (dashSize > 0.0 && mod(vDist, dashSize + gapSize) > dashSize) discard;
    gl_FragColor = vec4(color, opacity * vAlpha);
    #include <colorspace_fragment>
  }
`;

export class ThickLine {
  /**
   * @param {{color:number, width?:number, opacity?:number, maxPoints?:number}} options width 는 픽셀
   */
  constructor({ color, width = 3, opacity = 1, maxPoints = 512 }) {
    this.maxPoints = maxPoints;
    const n = maxPoints * 2;
    const geometry = new THREE.BufferGeometry();
    this.attrs = {
      position: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
      prev: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
      next: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
      side: new THREE.BufferAttribute(new Float32Array(n), 1),
      alpha: new THREE.BufferAttribute(new Float32Array(n), 1),
      dist: new THREE.BufferAttribute(new Float32Array(n), 1),
    };
    for (const [name, attr] of Object.entries(this.attrs)) {
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }
    for (let i = 0; i < maxPoints; i++) {
      this.attrs.side.array[i * 2] = 1;
      this.attrs.side.array[i * 2 + 1] = -1;
    }
    const index = new Uint32Array((maxPoints - 1) * 6);
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: opacity },
        width: { value: width },
        resolution: { value: new THREE.Vector2(1, 1) },
        dashSize: { value: 0 },
        gapSize: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.count = 0;
  }

  get visible() {
    return this.mesh.visible;
  }

  set visible(value) {
    this.mesh.visible = value;
  }

  /** 화면 크기 (px) — 두께 계산용 */
  setResolution(width, height) {
    this.material.uniforms.resolution.value.set(width, height);
  }

  /** 점선 (월드 길이 단위, 0 이면 실선) */
  setDash(dashSize, gapSize) {
    this.material.uniforms.dashSize.value = dashSize;
    this.material.uniforms.gapSize.value = gapSize;
  }

  /**
   * 점 목록으로 선을 바꾼다
   * @param {ArrayLike<{x:number,y:number,z:number}>} points 지도 좌표 점들
   * @param {(i:number, count:number) => number} [alphaAt] 점마다 투명도 (기본 1)
   */
  setPoints(points, alphaAt = null) {
    const count = Math.min(points.length, this.maxPoints);
    const { position, prev, next, alpha, dist } = this.attrs;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const p = points[i];
      const pp = points[Math.max(0, i - 1)];
      const np = points[Math.min(count - 1, i + 1)];
      if (i > 0) total += Math.hypot(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      const a = alphaAt ? alphaAt(i, count) : 1;
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        position.setXYZ(j, p.x, p.y, p.z);
        prev.setXYZ(j, pp.x, pp.y, pp.z);
        next.setXYZ(j, np.x, np.y, np.z);
        alpha.setX(j, a);
        dist.setX(j, total);
      }
    }
    for (const attr of Object.values(this.attrs)) attr.needsUpdate = true;
    this.count = count;
    this.mesh.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    this.mesh.visible = count > 1;
  }
}
