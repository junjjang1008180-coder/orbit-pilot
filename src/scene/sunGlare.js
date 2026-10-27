/**
 * 태양 (눈부신 원반 · 빛무리 · 회절 빛줄기 · 렌즈 반사) — 시각 효과 전용
 * ------------------------------------------------------------
 * 하늘 셰이더가 그리는 작은 태양 원반 위에, 카메라에서 태양 방향으로 아주 멀리 둔 판(Sprite)들을 겹친다.
 *   - 원반·빛무리: 깊이 검사를 하므로 행성·달·조종석 벽에 가려진다
 *   - 회절 빛줄기(별 모양): 우주(공기 없음)에서 더 뚜렷하다
 *   - 렌즈 반사: 화면에서 태양과 화면 가운데를 잇는 선을 따라 늘어선 색 고리·육각형
 * 행성·달이 태양을 가리면(해 질 녘 행성 가장자리 포함) 부드럽게 사라진다.
 */
import * as THREE from 'three';

const SUN_DISTANCE = 2.5e7; // 화면 단위 (카메라 far 보다 가깝게, 달보다 멀게)

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const radialTexture = (stops) => canvasTexture(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

/** 회절 빛줄기: 가는 선 6개 + 짧은 선 여러 개, 가운데로 갈수록 밝게 */
const raysTexture = () => canvasTexture(512, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  ctx.globalCompositeOperation = 'lighter';
  const ray = (angle, length, width, alpha) => {
    ctx.save();
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, length, 0);
    g.addColorStop(0, `rgba(255,250,235,${alpha})`);
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, width);
    ctx.fill();
    ctx.restore();
  };
  for (let i = 0; i < 6; i++) ray((i / 6) * Math.PI * 2 + 0.26, s * 0.5, 3, 0.9);
  for (let i = 0; i < 24; i++) ray((i / 24) * Math.PI * 2 + 0.1, s * (0.16 + 0.14 * ((i * 7) % 5) / 5), 1.2, 0.5);
});

/** 육각형 렌즈 반사 */
const hexTexture = () => canvasTexture(128, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * s * 0.48, Math.sin(a) * s * 0.48);
  }
  ctx.closePath();
  ctx.fill();
});

export function createSunGlare() {
  const group = new THREE.Group();
  group.name = 'sun-glare';
  const sprite = (map, color, { depthTest = true, opacity = 1 } = {}) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, fog: false }));
    s.frustumCulled = false;
    group.add(s);
    return s;
  };
  const glow = radialTexture([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,230,190,0.45)'], [0.5, 'rgba(255,200,150,0.12)'], [1, 'rgba(255,190,140,0)']]);
  const ring = radialTexture([[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0.5)'], [0.9, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
  const soft = radialTexture([[0, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
  const core = sprite(glow, 0xffffff);
  const halo = sprite(glow, 0xffe2b8, { opacity: 0.5 });
  const rays = sprite(raysTexture(), 0xfff3dc);
  const hex = hexTexture();
  // 렌즈 반사: [화면 위치 비율(1 = 태양, 0 = 가운데, 음수 = 반대편), 크기(시야 비율), 색, 무늬]
  const GHOSTS = [
    [0.55, 0.05, 0xffd49a, soft], [0.25, 0.025, 0x9fd4ff, hex], [-0.15, 0.06, 0x7cff9e, hex],
    [-0.4, 0.035, 0xff9a7a, soft], [-0.7, 0.12, 0x8aa8ff, ring], [-1.05, 0.08, 0xffc88a, hex],
  ];
  const ghosts = GHOSTS.map(([at, size, color, map]) => ({ at, size, sprite: sprite(map, color, { depthTest: false }) }));
  for (const g of ghosts) g.sprite.renderOrder = 10;

  const sunPos = new THREE.Vector3();
  const toCenter = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    group,
    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {THREE.Vector3} sunDirection 태양 방향 (월드 단위벡터)
     * @param {{center:THREE.Vector3, radius:number}[]} occluders 태양을 가릴 수 있는 천체 (화면 좌표)
     * @param {number} space 0 = 지상 하늘, 1 = 우주
     * @param {boolean} flares 렌즈 반사를 그릴지 (조종석 안에서는 끈다)
     */
    update(camera, sunDirection, occluders, space, flares = true) {
      // 가려짐: 카메라 → 태양 반직선이 천체 구를 지나는지 (가장자리는 부드럽게)
      let visible = 1;
      for (const o of occluders) {
        toCenter.copy(o.center).sub(camera.position);
        const t = toCenter.dot(sunDirection);
        if (t <= 0) continue;
        const miss = Math.sqrt(Math.max(0, toCenter.lengthSq() - t * t));
        visible = Math.min(visible, THREE.MathUtils.smoothstep(miss, o.radius * 0.998, o.radius * 1.012));
      }
      sunPos.copy(camera.position).addScaledVector(sunDirection, SUN_DISTANCE);
      for (const s of [core, halo, rays]) s.position.copy(sunPos);
      const d = SUN_DISTANCE;
      core.scale.setScalar(d * 0.032);
      halo.scale.setScalar(d * (0.5 - 0.3 * space));
      rays.scale.setScalar(d * (0.2 + 0.25 * space));
      rays.material.rotation += 0.0006;
      core.material.opacity = visible;
      halo.material.opacity = visible * (0.55 - 0.25 * space);
      rays.material.opacity = visible * (0.3 + 0.7 * space) * 1.4;
      core.visible = halo.visible = rays.visible = visible > 0.001;

      // 렌즈 반사
      ndc.copy(sunPos).project(camera);
      const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 1.15 && Math.abs(ndc.y) < 1.15;
      const edgeFade = onScreen ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.75, 1.15) : 0;
      const strength = flares ? visible * edgeFade * (0.35 + 0.65 * space) : 0;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      for (const g of ghosts) {
        g.sprite.visible = strength > 0.01;
        if (!g.sprite.visible) continue;
        dir.set(ndc.x * g.at, ndc.y * g.at, 0.5).unproject(camera).sub(camera.position).normalize();
        g.sprite.position.copy(camera.position).addScaledVector(dir, 10);
        g.sprite.scale.setScalar(10 * g.size * tanHalf * 2);
        g.sprite.material.opacity = strength * 0.6;
      }
    },
  };
}
