/**
 * 로켓 부품 3D 모델 (기본 도형을 조합한 정교한 임시 모델) — 시각 효과 전용
 * ------------------------------------------------------------
 * 모든 부품은 물리 설정의 길이(length)·반지름(radius)에 맞춰 만들며,
 * 원점 = 부품 아래 끝, +Y = 기수 방향이다. 질량·항력 등 물리 계산에는 영향이 없다.
 * (엔진 꼬리 날개는 반지름 밖으로 조금 나오지만 시각 효과일 뿐이다.)
 *
 *   엔진      : 엔진 마운트(볼트 링) + 연소실 + 터보펌프·배관 + 종 모양 노즐(열 변색), 1단은 꼬리 날개
 *   연료탱크  : 패널 이음선·줄무늬·글자 텍스처 + 보강 링 + 케이블 통로
 *   단 분리기 : 볼트가 둘린 분리 링 + 금색 분리면
 *   캡슐      : 곡면 캡슐 + 열 차폐막 + 창문 + 자세제어 추진기 + 도킹 링
 *   화물      : 금박 단열재 (맨 위면 오지브 페어링)
 *   열 차폐막 : 그을린 갈색 접시 + 금속 테두리 링
 *   낙하산    : 둥근 덮개의 낙하산 통 + 고정 띠 (펼친 모습은 effects/parachuteView.js)
 */
import * as THREE from 'three';

// ── 재질 ─────────────────────────────────────────────────
// envMap(주변 반사)은 렌더러마다 따로 만들어야 하므로 옵션으로 받는다.
function materials(envMap) {
  const std = (params) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.8, ...params });
  return {
    white: std({ color: 0xf2f3f5, roughness: 0.42, metalness: 0.05 }),
    lightGray: std({ color: 0xc9cdd3, roughness: 0.5, metalness: 0.2 }),
    darkMetal: std({ color: 0x3b3f46, roughness: 0.45, metalness: 0.75 }),
    steel: std({ color: 0x9aa1ab, roughness: 0.3, metalness: 0.9 }),
    black: std({ color: 0x1c1e22, roughness: 0.7, metalness: 0.2 }),
    gold: std({ color: 0xd4a537, roughness: 0.32, metalness: 0.95 }),
    copper: std({ color: 0xb8733e, roughness: 0.35, metalness: 0.9 }),
    heatShield: std({ color: 0x4a3426, roughness: 0.9, metalness: 0.05 }),
    window: std({ color: 0x0d1a2a, roughness: 0.1, metalness: 0.6, emissive: 0x1a3550, emissiveIntensity: 0.6 }),
    blue: std({ color: 0x1d4f91, roughness: 0.45, metalness: 0.1 }),
  };
}

/**
 * 부품 하나의 3D 모델
 * @param {{id:string, kind:string, length:number, radius:number, isp:number}} part 화면 단위로 바꾼 길이·반지름
 * @param {{isTopPart:boolean, envMap?:THREE.Texture}} options
 */
export function createPartModel(part, { isTopPart = false, envMap = null } = {}) {
  const m = materials(envMap);
  const L = part.length;
  const r = part.radius;
  const g = new THREE.Group();
  g.name = part.id;

  switch (part.kind) {
    case 'engine':
      buildEngine(g, L, r, part.isp >= 320, m);
      break;
    case 'tank':
      buildTank(g, L, r, part.id, m);
      break;
    case 'decoupler':
      buildDecoupler(g, L, r, m);
      break;
    case 'heatShield':
      buildHeatShield(g, L, r, m);
      break;
    case 'parachute':
      buildParachutePack(g, L, r, m);
      break;
    default:
      if (part.id === 'capsule' || (isTopPart && L < r * 3)) buildCapsule(g, L, r, m);
      else if (isTopPart) buildFairing(g, L, r, m);
      else buildCargo(g, L, r, m);
  }
  return g;
}

// ── 엔진 ─────────────────────────────────────────────────
function buildEngine(g, L, r, vacuum, m) {
  const bellH = L * (vacuum ? 0.66 : 0.55); // 노즐 높이
  const mountH = L * 0.2; // 맨 위 엔진 마운트 높이
  const chamberTop = L - mountH;

  // 엔진 마운트(추력 구조물) + 볼트 링
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, mountH, 48), m.darkMetal);
  mount.position.y = L - mountH / 2;
  g.add(mount);
  addBoltRing(g, r * 1.0, L - mountH * 0.15, 20, r * 0.035, m.steel);
  // 마운트 아래쪽을 가리는 차폐판 (위에서 본 단의 바닥)
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, L * 0.015, 48), m.black);
  plate.position.y = chamberTop;
  g.add(plate);

  // 연소실 + 짐벌
  const chamberR = r * 0.26;
  const chamber = new THREE.Mesh(new THREE.CylinderGeometry(chamberR * 0.85, chamberR, chamberTop - bellH, 32), m.steel);
  chamber.position.y = (chamberTop + bellH) / 2;
  g.add(chamber);
  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(chamberR * 0.7, 16, 12), m.darkMetal);
  gimbal.position.y = chamberTop - chamberR * 0.3;
  g.add(gimbal);

  // 터보펌프 (옆에 붙은 작은 원통) + 배관
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.11, r * 0.11, (chamberTop - bellH) * 0.8, 20), m.copper);
  pump.position.set(r * 0.45, (chamberTop + bellH) / 2, 0);
  g.add(pump);
  const pipeMaterial = m.copper;
  const pipes = [
    [[r * 0.45, chamberTop - L * 0.01, 0], [r * 0.4, chamberTop - L * 0.08, r * 0.15], [chamberR, bellH + (chamberTop - bellH) * 0.6, r * 0.05]],
    [[-r * 0.5, chamberTop - L * 0.01, r * 0.2], [-r * 0.4, (chamberTop + bellH) / 2, r * 0.3], [-chamberR, bellH + (chamberTop - bellH) * 0.3, 0]],
    [[r * 0.45, bellH + (chamberTop - bellH) * 0.15, 0], [r * 0.5, bellH * 0.85, r * 0.1], [r * 0.32, bellH * 0.62, r * 0.12]], // 터보펌프 배기관
  ];
  for (const pts of pipes) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r * 0.028, 8, false), pipeMaterial));
  }

  // 종 모양 노즐 (회전체). 위(목) → 아래(출구)로 갈수록 넓어지고, 열 변색 그라데이션
  const exitR = r * (vacuum ? 0.96 : 0.82);
  const throatR = chamberR * 0.75;
  const points = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 = 출구(아래), 1 = 목(위)
    points.push(new THREE.Vector2(throatR + (exitR - throatR) * Math.pow(1 - t, vacuum ? 2.2 : 1.7), bellH * t));
  }
  const bellGeometry = new THREE.LatheGeometry(points, 48);
  const colors = [];
  const pos = bellGeometry.getAttribute('position');
  const hot = vacuum ? new THREE.Color(0x77736c) : new THREE.Color(0x5a3a22); // 출구 쪽
  const cool = vacuum ? new THREE.Color(0xd8d5cf) : new THREE.Color(0x9aa1ab); // 목 쪽
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / bellH;
    c.copy(vacuum ? cool : hot).lerp(vacuum ? hot : cool, vacuum ? 1 - t : t);
    colors.push(c.r, c.g, c.b);
  }
  bellGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const bell = new THREE.Mesh(
    bellGeometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide, envMap: m.steel.envMap, envMapIntensity: 0.8 }),
  );
  g.add(bell);
  // 노즐 출구 테두리
  const lip = new THREE.Mesh(new THREE.TorusGeometry(exitR, r * 0.018, 8, 48), m.darkMetal);
  lip.rotation.x = Math.PI / 2;
  g.add(lip);
  // 노즐 냉각관 띠 (1단 엔진)
  if (!vacuum) {
    for (const t of [0.3, 0.55]) {
      const rr = throatR + (exitR - throatR) * Math.pow(1 - t, 1.7);
      const band = new THREE.Mesh(new THREE.TorusGeometry(rr + r * 0.008, r * 0.012, 6, 48), m.darkMetal);
      band.rotation.x = Math.PI / 2;
      band.position.y = bellH * t;
      g.add(band);
    }
    addFins(g, L, r, m);
  }
}

/** 1단 꼬리 날개 4개 (엔진 마운트 옆에서 바깥으로) */
function addFins(g, L, r, m) {
  const shape = new THREE.Shape();
  const root = L * 0.75; // 붙는 쪽 길이
  const span = r * 0.55; // 바깥으로 나온 길이
  shape.moveTo(0, 0);
  shape.lineTo(span, L * 0.05);
  shape.lineTo(span, L * 0.32);
  shape.lineTo(0, root);
  shape.lineTo(0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: r * 0.05, bevelEnabled: true, bevelThickness: r * 0.01, bevelSize: r * 0.01, bevelSegments: 1 });
  geometry.translate(0, 0, -r * 0.025);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(geometry, m.white);
    const angle = Math.PI / 4 + (k * Math.PI) / 2;
    fin.position.set(Math.cos(angle) * r * 0.9, L * 0.2, Math.sin(angle) * r * 0.9);
    fin.rotation.y = -angle;
    g.add(fin);
  }
}

// ── 연료탱크 ─────────────────────────────────────────────
function buildTank(g, L, r, id, m) {
  const texture = tankTexture(L, r, id);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, L, 64, 1, false),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.42, metalness: 0.08, envMap: m.white.envMap, envMapIntensity: 0.6 }),
  );
  body.position.y = L / 2;
  g.add(body);
  // 위·아래 보강 링 + 중간 링
  const ringCount = Math.max(1, Math.round(L / (r * 2.6)));
  const ringYs = [L * 0.012, L * 0.988];
  for (let i = 1; i < ringCount; i++) ringYs.push((L * i) / ringCount);
  for (const y of ringYs) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.004, r * 0.016, 6, 64), m.lightGray);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  // 케이블 통로 (옆면을 따라 세로로)
  const raceway = new THREE.Mesh(new THREE.BoxGeometry(r * 0.1, L * 0.9, r * 0.06), m.lightGray);
  raceway.position.set(-r * 1.02, L / 2, 0);
  g.add(raceway);
}

const textureCache = new Map();

/** 탱크 표면 텍스처: 패널 이음선, 줄무늬, 세로 글자, 엠블럼 */
function tankTexture(L, r, id) {
  const key = `${id}-${L.toFixed(2)}-${r.toFixed(2)}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const circumference = Math.PI * 2 * r;
  const W = 1024;
  const H = Math.min(2048, Math.max(256, Math.round((W * L) / circumference)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // 바탕: 아주 옅은 세로 음영 (원통 느낌)
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#f4f5f7');
  grad.addColorStop(0.5, '#eceef1');
  grad.addColorStop(1, '#f4f5f7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 패널 이음선
  ctx.strokeStyle = 'rgba(80,90,105,0.35)';
  ctx.lineWidth = 2;
  const rows = Math.max(2, Math.round(L / (r * 1.3)));
  for (let i = 1; i < rows; i++) {
    const y = (H * i) / rows;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const x = (W * i) / 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  // 위쪽 파란 줄무늬 (캔버스 위 = 원통 위)
  ctx.fillStyle = '#1d4f91';
  ctx.fillRect(0, H * 0.06, W, Math.max(10, H * 0.035));
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, H * 0.06 + Math.max(10, H * 0.035) + 4, W, Math.max(4, H * 0.01));
  // 세로 글자 (u ≈ 0.25 쪽: 카메라가 보는 남쪽 면)
  const label = id === 'tankLarge' ? 'ORBIT PILOT' : 'OP-2';
  ctx.save();
  ctx.translate(W * 0.25, H * 0.55);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#1b2430';
  const fontSize = Math.min(W * 0.09, (H * 0.7) / (label.length * 0.62));
  ctx.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
  // 엠블럼 (원 + 궤도선) — 반대편
  const ex = W * 0.75;
  const ey = H * 0.3;
  const er = Math.min(W * 0.06, H * 0.08);
  ctx.fillStyle = '#1d4f91';
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, er * 0.12);
  ctx.beginPath();
  ctx.ellipse(ex, ey, er * 1.35, er * 0.45, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.arc(ex + er * 0.9, ey - er * 0.35, er * 0.18, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

// ── 단 분리기 ────────────────────────────────────────────
function buildDecoupler(g, L, r, m) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 64), m.black);
  ring.position.y = L / 2;
  g.add(ring);
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.006, r * 1.006, L * 0.18, 64), m.gold);
  seam.position.y = L / 2;
  g.add(seam);
  addBoltRing(g, r * 1.01, L * 0.25, 24, r * 0.03, m.steel);
  addBoltRing(g, r * 1.01, L * 0.75, 24, r * 0.03, m.steel);
}

// ── 캡슐 ─────────────────────────────────────────────────
function buildCapsule(g, L, r, m) {
  // 옆면 윤곽 (아래 → 위): 열 차폐막 → 원뿔 몸체 → 둥근 어깨 → 도킹 링
  const profile = [
    [0.0, 0.0], [r * 0.96, 0.0], [r, L * 0.05], [r * 0.98, L * 0.09],
    [r * 0.62, L * 0.62], [r * 0.45, L * 0.78], [r * 0.36, L * 0.86], [r * 0.34, L * 0.9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), m.lightGray);
  g.add(body);
  // 열 차폐막 (아래 둥근 접시)
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.99, r * 0.9, L * 0.05, 64), m.heatShield);
  shield.position.y = L * 0.025;
  g.add(shield);
  // 몸체 가운데 검은 띠
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.835, r * 0.9, L * 0.06, 64, 1, true), m.black);
  band.position.y = L * 0.25;
  g.add(band);
  // 도킹 링
  const dock = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.33, L * 0.1, 32), m.steel);
  dock.position.y = L * 0.95;
  g.add(dock);
  const dockRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.29, r * 0.025, 8, 32), m.darkMetal);
  dockRing.rotation.x = Math.PI / 2;
  dockRing.position.y = L;
  g.add(dockRing);

  // 원뿔 면 위의 위치·방향 계산 (높이 y 에서 반지름과 바깥 법선)
  const coneR0 = r * 0.98;
  const coneY0 = L * 0.09;
  const coneR1 = r * 0.62;
  const coneY1 = L * 0.62;
  const slope = Math.atan2(coneR0 - coneR1, coneY1 - coneY0); // 원뿔면 기울기
  const onCone = (y, angle, mesh, outset) => {
    const t = (y - coneY0) / (coneY1 - coneY0);
    const rr = coneR0 + (coneR1 - coneR0) * t + outset;
    mesh.position.set(Math.cos(angle) * rr, y, Math.sin(angle) * rr);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = -angle + Math.PI / 2;
    mesh.rotation.x = -slope;
    g.add(mesh);
  };
  // 창문 (남쪽 면을 중심으로 3개 + 반대편 1개)
  const windowGeometry = new THREE.BoxGeometry(r * 0.2, L * 0.1, r * 0.02);
  for (const angle of [Math.PI / 2 - 0.45, Math.PI / 2, Math.PI / 2 + 0.45, -Math.PI / 2]) {
    onCone(L * 0.42, angle, new THREE.Mesh(windowGeometry, m.window), r * 0.005);
  }
  // 자세제어 추진기 (작은 상자 4개)
  const rcsGeometry = new THREE.BoxGeometry(r * 0.12, L * 0.06, r * 0.08);
  for (let k = 0; k < 4; k++) {
    onCone(L * 0.56, (k * Math.PI) / 2 + Math.PI / 4, new THREE.Mesh(rcsGeometry, m.darkMetal), r * 0.03);
  }
}

// ── 열 차폐막 ────────────────────────────────────────────
function buildHeatShield(g, L, r, m) {
  // 아래로 볼록한 접시 (구의 일부) + 옆면 띠
  const capHeight = L * 0.45;
  const sphereR = (r * r + capHeight * capHeight) / (2 * capHeight);
  const theta = Math.asin(Math.min(1, r / sphereR));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(sphereR, 64, 12, 0, Math.PI * 2, Math.PI - theta, theta), m.heatShield);
  dish.position.y = sphereR;
  g.add(dish);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, L - capHeight, 64), m.heatShield);
  side.position.y = capHeight + (L - capHeight) / 2;
  g.add(side);
  // 위쪽 금속 테두리와 볼트
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, L * 0.06, 8, 64), m.darkMetal);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = L * 0.95;
  g.add(rim);
  addBoltRing(g, r * 1.0, L * 0.7, 24, r * 0.025, m.steel);
}

// ── 낙하산 통 ────────────────────────────────────────────
function buildParachutePack(g, L, r, m) {
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8692c, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.55, 40), m.white);
  base.position.y = L * 0.275;
  g.add(base);
  // 둥근 덮개
  const lid = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), orange);
  lid.scale.y = (L * 0.45) / r;
  lid.position.y = L * 0.55;
  g.add(lid);
  // 고정 띠 (십자)
  for (const angle of [0, Math.PI / 2]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, r * 0.03, 6, 40, Math.PI), m.black);
    strap.rotation.y = angle;
    strap.scale.y = (L * 0.45) / r;
    strap.position.y = L * 0.55;
    g.add(strap);
  }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, L * 0.08, 40, 1, true), m.darkMetal);
  band.position.y = L * 0.06;
  g.add(band);
}

// ── 화물 · 페어링 ────────────────────────────────────────
function buildCargo(g, L, r, m) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 48), m.gold);
  body.position.y = L / 2;
  g.add(body);
  // 금박 이음선 (가로 링)
  for (const t of [0.2, 0.5, 0.8]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(r * 1.003, r * 0.01, 6, 48), m.copper);
    seam.rotation.x = Math.PI / 2;
    seam.position.y = L * t;
    g.add(seam);
  }
  for (const y of [0, L]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, r * 0.022, 6, 48), m.darkMetal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
}

function buildFairing(g, L, r, m) {
  // 오지브(총알 모양) 페어링
  const points = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(new THREE.Vector2(Math.max(0.0001, r * Math.sqrt(1 - t * t * 0.98)), L * t));
  }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(points, 48), m.white));
  // 세로 이음선 (두 쪽으로 갈라지는 선)
  for (const angle of [0, Math.PI]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(r * 0.02, L * 0.85, r * 0.02), m.lightGray);
    seam.position.set(Math.cos(angle) * r * 0.86, L * 0.42, Math.sin(angle) * r * 0.86);
    g.add(seam);
  }
}

// ── 공통 ─────────────────────────────────────────────────
/** 원통 둘레에 볼트 머리를 고르게 붙인다 */
function addBoltRing(g, radius, y, count, size, material) {
  const geometry = new THREE.CylinderGeometry(size, size, size * 0.8, 6);
  geometry.rotateZ(Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const bolt = new THREE.Mesh(geometry, material);
    bolt.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
    bolt.rotation.y = -a;
    g.add(bolt);
  }
}
