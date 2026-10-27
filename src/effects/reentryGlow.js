/**
 * 재진입 플라스마 빛 (시각 효과 전용)
 * ------------------------------------------------------------
 * 공기를 맞는 앞면을 감싸는 충격파 덮개(반타원체 두 겹), 그 뒤로 흐르는 플라스마 꼬리(두 겹),
 * 덮개 가장자리에서 뒤로 뻗는 불꽃 혀(줄기) 여러 개.
 * 세기는 물리 상태의 열유속(heatFlux)으로 정하고, 방향은 속도 반대쪽(꼬리가 흐르는 쪽)이다.
 * 모양은 "진행 방향에서 본 기체의 단면" 에 맞춘다:
 *   - 캡슐·로켓: 앞면(꼬리가 진행 방향이면 아래 끝, 아니면 기수 끝)의 원
 *   - 우주 왕복선 궤도선: 받음각만큼 든 배 전체가 공기를 맞으므로, 기수 방향(진행 방향에 수직으로 투영) × 날개 폭의 타원.
 *     덮개는 배 쪽(진행 방향 앞)으로 기체를 감싸고, 꼬리는 날개 폭만큼 넓게 흐른다.
 * 덮개·꼬리에는 흐르는 얼룩 무늬를 입혀 불꽃이 일렁이게 한다.
 */
import * as THREE from 'three';
import { vec3, quat } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from '../scene/renderCoordinates.js';

const FLUX_START = 30_000; // 이 열유속(W/m²)부터 보이기 시작
const FLUX_FULL = 450_000; // 이 열유속에서 가장 밝게
// 궤도선은 양력으로 높은 곳에서 오래 감속해 열유속이 훨씬 낮다 (최대 약 5만 W/m²) → 따로 기준을 둔다
const WINGED_FLUX_START = 6_000;
const WINGED_FLUX_FULL = 45_000;
const ORBITER = { tail: -10, nose: 27.2, centerY: 8.6, centerZ: 4.6, halfSpan: 11.9, thickness: 5.2 }; // 궤도선 치수 (궤도선 좌표, m)

/** 세로 그라데이션: 아래(uv.y = 0, 충격파 쪽) 밝고 위(하류)로 갈수록 검정 */
function gradientTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, canvas.height, 0, 0);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 흐르는 불꽃 얼룩 (흐름 방향으로 길쭉한 밝은 줄기들) — 반복 무늬, 투명도 지도로 쓴다 */
function streakTexture(seed) {
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(0, 0, W, H);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const w = 2 + rand() * 9;
    const h = 20 + rand() * 90;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    const bright = 150 + Math.floor(rand() * 105);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.3, `rgba(${bright},${bright},${bright},0.9)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    // 가로로 이어지게 양쪽에 그린다
    for (const dx of [0, -W, W]) ctx.fillRect(x + dx - w / 2, y, w, h);
    for (const dx of [0, -W, W]) ctx.fillRect(x + dx - w / 2, y - H, w, h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * 빛나는 껍질 재질: 가장자리(시선과 비스듬한 면)일수록 밝고(rimMix), 길이 방향 그라데이션(gradient)과
 * 흐르는 줄기 무늬(streaks)로 밝기를 바꾼다. 더하기 섞기라 겹칠수록 밝아진다.
 */
function glowMaterial(color, gradient, streaks, { rimPower = 1.6, rimMix = 0.8, noiseMix = 0.6, repeat = [3, 1] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: 0 },
      gradient: { value: gradient },
      streaks: { value: streaks },
      offset: { value: new THREE.Vector2() },
      repeat: { value: new THREE.Vector2(...repeat) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform sampler2D gradient;
      uniform sampler2D streaks;
      uniform vec2 offset;
      uniform vec2 repeat;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = mix(1.0, pow(1.0 - facing, ${rimPower.toFixed(2)}), ${rimMix.toFixed(2)});
        float g = texture2D(gradient, vUv).r;
        float n = texture2D(streaks, vUv * repeat + offset).r;
        float a = opacity * g * rim * mix(1.0, n * 1.7, ${noiseMix.toFixed(2)});
        gl_FragColor = vec4(color * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createReentryGlow(scene) {
  const group = new THREE.Group();
  group.visible = false;

  const shockFade = gradientTexture([[0, '#ffffff'], [0.5, '#cfcfcf'], [1, '#202020']]);
  const trailFade = gradientTexture([[0, '#ffffff'], [0.15, '#bdbdbd'], [0.5, '#3c3c3c'], [1, '#000000']]);
  const tongueFade = gradientTexture([[0, '#ffffff'], [0.4, '#7a7a7a'], [1, '#000000']]);
  const streaks = streakTexture(7);

  // 반타원체 덮개: 극(가장 앞) = −Y, 가장자리 = y 0. 그룹 +Y = 하류. (uv.y: 극 0 → 가장자리 0.5)
  const capGeo = (seg) => new THREE.SphereGeometry(1, seg, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const shockMat = glowMaterial(0xff6a2a, shockFade, streaks, { rimPower: 1.4, rimMix: 0.85, repeat: [4, 2] });
  const shock = new THREE.Mesh(capGeo(48), shockMat);
  const coreMat = glowMaterial(0xffc890, shockFade, streaks, { rimMix: 0, noiseMix: 0.35, repeat: [2, 1] }); // 앞면 한가운데 뜨거운 빛
  const core = new THREE.Mesh(capGeo(32), coreMat);
  const rimMat = glowMaterial(0xff4a7a, trailFade, streaks, { rimMix: 0.5, repeat: [6, 1] }); // 가장자리 분홍빛 (공기 분자가 내는 빛)
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1, 1, 48, 1, true), rimMat);
  // 꼬리: 덮개 가장자리에서 하류로 가늘어지는 껍질 두 겹
  const trailMat = glowMaterial(0xff4a32, trailFade, streaks, { rimPower: 1.2, rimMix: 0.9, repeat: [5, 1.2] });
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1, 1, 48, 12, true), trailMat);
  const innerTrailMat = glowMaterial(0xffa050, trailFade, streaks, { rimPower: 1.0, rimMix: 0.7, repeat: [7, 1.6] });
  const innerTrail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.72, 1, 40, 12, true), innerTrailMat);
  // 불꽃 혀: 가장자리에서 뒤로 뻗는 가는 원뿔들 (길이·밝기가 제각각 일렁인다)
  const tongueGeo = new THREE.ConeGeometry(1, 1, 16, 1, true);
  tongueGeo.translate(0, 0.5, 0); // 밑면(굵은 쪽, uv.y 0 = 밝음) = 원점, 끝 = +Y(하류)
  const tongues = Array.from({ length: 10 }, (_, i) => {
    const mat = glowMaterial(i % 3 === 0 ? 0xffb060 : 0xff5030, tongueFade, streaks, { rimPower: 0.8, rimMix: 0.6, repeat: [2, 1] });
    const mesh = new THREE.Mesh(tongueGeo, mat);
    group.add(mesh);
    return { mesh, mat, angle: (i / 10) * Math.PI * 2 + (i % 2) * 0.25, phase: i * 1.37 };
  });
  group.add(shock, core, rim, trail, innerTrail);
  scene.add(group);
  const allMats = [shockMat, coreMat, rimMat, trailMat, innerTrailMat, ...tongues.map((x) => x.mat)];

  // 그룹 기준: X = 단면 첫째 축, Y = 하류, Z = 단면 둘째 축
  const basis = new THREE.Matrix4();
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const az = new THREE.Vector3();

  /** 진행 방향(dir)에 수직인 두 축과 단면 반지름, 덮개 가장자리 중심·깊이 */
  function frontalShape(state, dir) {
    const stage = state.stages[state.currentStage];
    const q = state.orientation;
    const nose = quat.rotate(q, [0, 1, 0]);
    if (stage?.winged) {
      const top = quat.rotate(q, [0, 0, 1]);
      const right = quat.rotate(q, [1, 0, 0]);
      // 기수를 진행 방향에 수직인 면에 투영한 축 (받음각이 크면 기체 길이가 그대로 보인다)
      let a1 = vec3.addScaled(nose, dir, -vec3.dot(nose, dir));
      if (vec3.length(a1) < 1e-3) a1 = vec3.addScaled(top, dir, -vec3.dot(top, dir));
      a1 = vec3.normalize(a1);
      const a2 = vec3.normalize(vec3.cross(dir, a1));
      const L = ORBITER.nose - ORBITER.tail;
      const sinT = Math.sqrt(Math.max(0, 1 - vec3.dot(nose, dir) ** 2));
      const cosT = Math.abs(vec3.dot(nose, dir));
      const e1 = (L * sinT + ORBITER.thickness * cosT) / 2 + 1.5;
      const e2 = ORBITER.halfSpan * Math.max(0.35, Math.abs(vec3.dot(right, a2))) + 1.5;
      const halfDepth = (L * cosT + ORBITER.thickness * sinT) / 2; // 가운데에서 가장 앞(배)까지
      const center = vec3.add(state.position, vec3.add(vec3.scale(nose, ORBITER.centerY), vec3.scale(top, ORBITER.centerZ)));
      // 덮개 가장자리를 기체 가운데보다 조금 하류에 두어, 배·날개 앞전 전체가 덮개 안에 들어오게 한다
      const shift = halfDepth * 0.5;
      return { a1, a2, e1, e2, depth: halfDepth + shift + 2.5, rimCenter: vec3.addScaled(center, dir, -shift), length: L };
    }
    // 캡슐·로켓: 붙어 있는 단들의 높이·가장 굵은 반지름
    let height = 0;
    let radius = 0;
    for (let i = state.currentStage; i < state.stages.length; i++) {
      height += state.stages[i].length;
      radius = Math.max(radius, state.stages[i].maxRadius);
    }
    const tailFirst = vec3.dot(nose, dir) < 0;
    const front = tailFirst ? state.position : vec3.addScaled(state.position, nose, height);
    let a1 = vec3.cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    a1 = vec3.normalize(a1);
    const a2 = vec3.normalize(vec3.cross(dir, a1));
    const r = radius * 1.25;
    return { a1, a2, e1: r, e2: r, depth: radius * 0.6, rimCenter: vec3.addScaled(front, dir, radius * 0.05), length: height };
  }

  return {
    /**
     * @param {object} state 비행체 상태 (position, velocity, orientation, heatFlux, stages)
     * @param {number[]} origin 화면 원점 (m)
     * @param {number} time 화면 시각 (s) — 일렁임
     */
    update(state, origin, time) {
      const winged = Boolean(state.stages[state.currentStage]?.winged);
      const [start, full] = winged ? [WINGED_FLUX_START, WINGED_FLUX_FULL] : [FLUX_START, FLUX_FULL];
      const intensity = Math.min(1, Math.max(0, ((state.heatFlux ?? 0) - start) / (full - start)));
      const speed = vec3.length(state.velocity);
      group.visible = intensity > 0 && speed > 1 && !state.destroyed && !state.landed;
      if (!group.visible) return;
      const dir = vec3.scale(state.velocity, 1 / speed); // 진행 방향
      const f = frontalShape(state, dir);
      toRenderPosition(f.rimCenter, origin, group.position);
      ax.set(...f.a1);
      ay.set(-dir[0], -dir[1], -dir[2]);
      az.set(...f.a2);
      basis.makeBasis(ax, ay, az);
      group.quaternion.setFromRotationMatrix(basis);

      // 밝기는 열유속에 비례하지 않고 조금 빨리 차오르게 (약한 열에서도 보이게)
      const flicker = (0.88 + 0.12 * Math.sin(time * 37) * Math.sin(time * 23)) * intensity ** -0.45;
      const grow = 1 + 0.15 * intensity;
      const e1 = toRenderLength(f.e1) * grow;
      const e2 = toRenderLength(f.e2) * grow;
      const depth = toRenderLength(f.depth);
      shock.scale.set(e1, depth * 1.15, e2);
      core.scale.set(e1 * 0.8, depth * 1.05, e2 * 0.8);
      const rimLen = depth * 0.35;
      rim.scale.set(e1, rimLen, e2);
      rim.position.y = rimLen / 2;
      // 줄기 무늬가 하류로 흐른다
      for (const m of allMats) m.uniforms.offset.value.set(time * 0.02, -time * 1.4);

      const length = toRenderLength(f.length) * (0.9 + 2.2 * intensity);
      trail.scale.set(e1 * 1.02, length, e2 * 1.02);
      trail.position.y = length / 2;
      const innerLength = length * 0.6;
      innerTrail.scale.set(e1 * 0.85, innerLength, e2 * 0.85);
      innerTrail.position.y = innerLength / 2;
      shockMat.uniforms.opacity.value = 1.6 * intensity * flicker;
      coreMat.uniforms.opacity.value = 0.45 * intensity * flicker;
      rimMat.uniforms.opacity.value = 1.0 * intensity * flicker;
      trailMat.uniforms.opacity.value = 0.9 * intensity * flicker;
      innerTrailMat.uniforms.opacity.value = 0.7 * intensity * flicker;
      for (const tg of tongues) {
        const wobble = 0.6 + 0.4 * Math.sin(time * 9 + tg.phase) * Math.sin(time * 5.3 + tg.phase * 2);
        const tl = length * (0.15 + 0.3 * wobble);
        const w = Math.min(e1, e2) * 0.06;
        const a = tg.angle + 0.15 * Math.sin(time * 3 + tg.phase);
        tg.mesh.position.set(Math.cos(a) * e1 * 0.95, 0, Math.sin(a) * e2 * 0.95);
        tg.mesh.scale.set(w, tl, w);
        tg.mesh.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1); // 살짝 바깥으로 벌어진다
        tg.mat.uniforms.opacity.value = 0.45 * intensity * wobble;
      }
    },
    clear() {
      group.visible = false;
    },
  };
}
