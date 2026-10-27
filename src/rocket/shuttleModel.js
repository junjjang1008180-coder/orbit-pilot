/**
 * 우주 왕복선 3D 모델 (기본 도형 조합) — 시각 효과 전용
 * ------------------------------------------------------------
 * 사진 속 발사대 위 왕복선처럼: 흰 궤도선(검은 배·기수·창틀), 주황색 외부 탱크, 흰 고체 부스터 2개.
 * 진짜 기관 로고 대신 "ORBIT PILOT" 글자를 쓴다.
 *
 * 좌표 (단위 m = 화면 단위)
 *   스택 좌표 : 원점 = 고체 부스터 노즐 끝 높이의 외부 탱크 축, +Y 위, +Z = 궤도선 쪽(궤도선 윗면 방향), +X 오른쪽
 *   궤도선 좌표: 원점 = 주 바퀴 접지점(바퀴를 내렸을 때), +Y 기수, +Z 윗면, +X 오른쪽 날개
 *               스택에서는 physicsConfig.shuttle.orbiterOffset 만큼 옮겨 붙는다.
 * 궤도선 치수(대략): 동체 −9.6 ~ +27.2 m, 날개 폭 23.6 m, 꼬리 날개 끝 높이 15.2 m, 배 높이 2.5 m.
 */
import * as THREE from 'three';

const ORANGE = 0xc5682c;

function mats(envMap) {
  const std = (p) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.7, ...p });
  return {
    orbiter: std({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    white: std({ color: 0xf1f2f2, roughness: 0.5, metalness: 0.05 }),
    tile: std({ color: 0x1b1c1f, roughness: 0.85, metalness: 0.05 }),
    rcc: std({ color: 0x3a3c40, roughness: 0.7, metalness: 0.1 }),
    steel: std({ color: 0x9ea6b0, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }),
    darkMetal: std({ color: 0x34383e, roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide }),
    nozzleInner: std({ color: 0x4a3328, roughness: 0.6, metalness: 0.5, side: THREE.BackSide }),
    window: std({ color: 0x0a1420, roughness: 0.08, metalness: 0.7, emissive: 0x13283d, emissiveIntensity: 0.5 }),
    tire: std({ color: 0x151515, roughness: 0.95 }),
    strut: std({ color: 0xc4c8cc, roughness: 0.35, metalness: 0.8 }),
    tank: std({ map: foamTexture(), color: 0xffffff, roughness: 0.95, metalness: 0 }),
    intertank: std({ map: foamTexture(true), color: 0xe0d6cc, roughness: 0.9, metalness: 0.05 }),
    srb: std({ color: 0xeeeeea, roughness: 0.6, metalness: 0.05 }),
    srbJoint: std({ color: 0xb9bcbf, roughness: 0.5, metalness: 0.4 }),
    canopy: std({ color: 0xf3efe6, roughness: 0.9, side: THREE.DoubleSide }),
    canopyBand: std({ color: 0xd4572a, roughness: 0.9, side: THREE.DoubleSide }),
    line: new THREE.MeshBasicMaterial({ color: 0xd8d4c8 }),
  };
}

/** 외부 탱크 단열재(주황 폼) 무늬: 세로로 얼룩진 갈색 띠 */
function foamTexture(ribbed = false) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c5682c';
  ctx.fillRect(0, 0, 256, 512);
  let seed = ribbed ? 7 : 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = rand() * 256;
    const y = rand() * 512;
    const shade = rand() < 0.5 ? 'rgba(120, 55, 18, 0.10)' : 'rgba(235, 140, 70, 0.10)';
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, 2 + rand() * 6, 10 + rand() * 60);
  }
  if (ribbed) {
    // 중간 탱크(intertank)의 세로 보강재
    for (let x = 0; x < 256; x += 8) {
      ctx.fillStyle = 'rgba(90, 40, 12, 0.35)';
      ctx.fillRect(x, 0, 3, 512);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ribbed ? 6 : 3, 1);
  return t;
}

/** 글자판 (투명 배경) — 평면은 +Z 를 향하고 글자는 +X 방향으로 읽힌다 */
function textDecal(text, width, height, color = '#16181c', font = 'bold 120px system-ui, sans-serif') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * height) / width);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
}

/** 두 점 a, b 사이의 막대 */
function rod(a, b, radius, material, segments = 10) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, segments), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/** 아래(−Y)를 향하는 엔진 노즐 (원점 = 목, 길이 len) */
function nozzle(throat, exit, len, m) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(throat, exit, len, 28, 1, true), m.steel);
  outer.position.y = -len / 2;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(throat * 0.96, exit * 0.97, len, 28, 1, true), m.nozzleInner);
  inner.position.y = -len / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(exit, exit * 0.03, 6, 28), m.darkMetal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -len;
  const chamber = new THREE.Mesh(new THREE.CylinderGeometry(throat * 1.25, throat, throat * 1.6, 16), m.darkMetal);
  chamber.position.y = throat * 0.8;
  g.add(outer, inner, ring, chamber);
  return g;
}

// ── 궤도선 동체 (단면을 이어 붙인 매끈한 몸통) ─────────────
// [y, 반폭, 반높이, 단면 중심 z]  — 배 = 중심 − 반높이
const FUSELAGE = [
  [-9.6, 2.45, 2.45, 5.0],
  [-8.5, 2.6, 2.55, 5.05],
  [17, 2.6, 2.55, 5.05],
  [19, 2.6, 2.65, 5.15],
  [21, 2.55, 2.75, 5.25],
  [22.5, 2.35, 2.5, 5.1],
  [24, 1.95, 2.0, 4.75],
  [25.3, 1.5, 1.5, 4.45],
  [26.3, 0.95, 0.95, 4.2],
  [26.9, 0.45, 0.45, 4.05],
];
const NOSE_TIP = [0, 27.2, 4.0];

function fuselageGeometry() {
  const seg = 40;
  const pos = [];
  const col = [];
  const idx = [];
  const white = new THREE.Color(0xf2f3f3);
  const black = new THREE.Color(0x1b1c1f);
  const gray = new THREE.Color(0x45474b);
  const colorAt = (y, s) => {
    if (y > 25.9) return gray; // 기수 덮개 (탄소 복합재)
    if (s < -0.42) return black; // 배 쪽 열 차폐 타일
    if (y > 21.4 && y < 24.4 && s > 0.15) return black; // 조종석 창틀 둘레
    return white;
  };
  const ring = (y, w, h, zc) => {
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = w * Math.sign(c) * Math.abs(c) ** 0.7;
      const z = zc + h * Math.sign(s) * Math.abs(s) ** (s < 0 ? 0.35 : 0.85);
      pos.push(x, y, z);
      const k = colorAt(y, s);
      col.push(k.r, k.g, k.b);
    }
  };
  FUSELAGE.forEach(([y, w, h, zc]) => ring(y, w, h, zc));
  for (let i = 0; i < FUSELAGE.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // 기수 끝
  const tip = pos.length / 3;
  pos.push(...NOSE_TIP);
  col.push(gray.r, gray.g, gray.b);
  const last = (FUSELAGE.length - 1) * (seg + 1);
  for (let j = 0; j < seg; j++) idx.push(tip, last + j + 1, last + j);
  // 꼬리 끝 (어두운 판)
  const aft = pos.length / 3;
  pos.push(0, FUSELAGE[0][0], FUSELAGE[0][3]);
  col.push(gray.r, gray.g, gray.b);
  for (let j = 0; j < seg; j++) idx.push(aft, j, j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 모양(Shape, x·y)을 y→Y, x→... 로 돌려 굽는 행렬: 모양 x → 월드 Y, 모양 y → 월드 Z, 두께 → 월드 X */
const YZ_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));

/**
 * 궤도선 (궤도선 좌표)
 * @returns {{group:THREE.Group, gear:object[], elevons:object[], rudder:THREE.Object3D[], ssmeExits:number[][], omsExits:number[][], chuteMount:number[]}}
 */
export function createOrbiterModel(envMap) {
  const m = mats(envMap);
  const g = new THREE.Group();
  g.name = 'orbiter';

  const body = new THREE.Mesh(fuselageGeometry(), m.orbiter);
  g.add(body);

  // 화물칸 문 이음선 (윗면 가운데 + 양옆)
  for (const x of [0, -1.7, 1.7]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 25.5, 0.04), m.rcc);
    seam.position.set(x, 4.2, x === 0 ? 7.62 : 7.42);
    g.add(seam);
  }
  for (let y = -7; y <= 16; y += 4.6) {
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 0.03), m.rcc);
    hinge.position.set(0, y, 7.6);
    g.add(hinge);
  }

  // 조종석 창문 6장 (앞 2 · 옆 앞 2 · 옆 2) + 위쪽 작은 창 2장
  const addWindow = (x, y, z, w, h, normal) => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), m.window);
    win.position.set(x, y, z);
    win.lookAt(new THREE.Vector3(x, y, z).add(new THREE.Vector3(...normal)));
    g.add(win);
  };
  addWindow(-0.48, 23.15, 7.25, 0.8, 0.62, [0, 0.55, 0.84]);
  addWindow(0.48, 23.15, 7.25, 0.8, 0.62, [0, 0.55, 0.84]);
  addWindow(-1.35, 22.95, 7.05, 0.75, 0.55, [-0.5, 0.45, 0.74]);
  addWindow(1.35, 22.95, 7.05, 0.75, 0.55, [0.5, 0.45, 0.74]);
  addWindow(-2.05, 22.4, 6.55, 0.62, 0.5, [-0.85, 0.25, 0.46]);
  addWindow(2.05, 22.4, 6.55, 0.62, 0.5, [0.85, 0.25, 0.46]);
  addWindow(-0.5, 21.4, 7.95, 0.55, 0.4, [0, -0.1, 1]);
  addWindow(0.5, 21.4, 7.95, 0.55, 0.4, [0, -0.1, 1]);
  // 옆 출입문 (왼쪽 둥근 해치)
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24), m.rcc);
  hatch.rotation.z = Math.PI / 2;
  hatch.position.set(-2.58, 19.6, 5.6);
  g.add(hatch);

  // ── 날개 (이중 삼각 날개) ─────────────────────────────
  const wingPts = [
    [2.4, -8.6], [11.8, -8.0], [11.8, -6.2], [4.6, 3.5], [2.5, 14.5],
    [-2.5, 14.5], [-4.6, 3.5], [-11.8, -6.2], [-11.8, -8.0], [-2.4, -8.6],
  ];
  const wingShape = new THREE.Shape(wingPts.map(([x, y]) => new THREE.Vector2(x, y)));
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.12, bevelSegments: 2 }), m.white);
  wing.position.z = 2.6;
  g.add(wing);
  const belly = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), m.tile);
  belly.rotation.y = Math.PI; // 아래(−Z)를 향하게 (모양이 좌우 대칭이라 그대로 맞는다)
  belly.position.z = 2.5;
  g.add(belly);
  // 앞전 (탄소 복합재, 짙은 회색)
  const le = [[11.8, -6.2], [4.6, 3.5], [2.5, 14.5]];
  for (const side of [1, -1]) {
    for (let i = 0; i < le.length - 1; i++) {
      g.add(rod([side * le[i][0], le[i][1], 2.82], [side * le[i + 1][0], le[i + 1][1], 2.82], 0.3, m.rcc));
    }
    // 날개 끝 검은 띠
    const tipCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.62), m.tile);
    tipCap.position.set(side * 11.85, -7.1, 2.82);
    g.add(tipCap);
  }
  // 엘레본 (뒷전 조종면 — 좌우 안쪽·바깥쪽)
  const elevons = [];
  for (const side of [1, -1]) {
    for (const [x0, x1] of [[3.0, 7.2], [7.4, 11.6]]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * ((x0 + x1) / 2), -8.35, 2.82);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.5, 0.3), m.white);
      flap.position.y = -0.75;
      const under = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.5, 0.02), m.tile);
      under.position.set(0, -0.75, -0.16);
      pivot.add(flap, under);
      g.add(pivot);
      elevons.push({ pivot, side, outer: x0 > 5 });
    }
  }
  // 몸통 플랩 (주 엔진 아래)
  const bodyFlap = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.6, 0.35), m.rcc);
  bodyFlap.position.set(0, -10.3, 2.75);
  g.add(bodyFlap);

  // 날개 위 글자
  const wingText = textDecal('ORBIT PILOT', 6.2, 1.1);
  wingText.position.set(-7.4, -4.4, 3.08);
  g.add(wingText);
  const wingMark = textDecal('OP', 1.7, 1.2, '#1d4f91', 'bold 300px system-ui, sans-serif');
  wingMark.position.set(7.2, -4.2, 3.08);
  g.add(wingMark);
  // 몸통 옆 글자 (양쪽에서 바로 읽히게)
  const sideR = textDecal('ORBIT PILOT', 9, 1.3);
  sideR.geometry.applyMatrix4(YZ_BASIS);
  sideR.position.set(2.63, 10.5, 6.2);
  g.add(sideR);
  const sideL = textDecal('ORBIT PILOT', 9, 1.3);
  sideL.geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
  sideL.position.set(-2.63, 10.5, 6.2);
  g.add(sideL);

  // ── 수직 꼬리 날개 + 방향타·에어브레이크(두 쪽으로 벌어짐) ─────
  const finShape = new THREE.Shape([[-2.2, 7.4], [-8.0, 15.2], [-8.9, 15.2], [-8.4, 7.4]].map(([y, z]) => new THREE.Vector2(y, z)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.1, bevelSegments: 2 });
  finGeo.applyMatrix4(YZ_BASIS);
  finGeo.translate(-0.225, 0, 0);
  g.add(new THREE.Mesh(finGeo, m.white));
  g.add(rod([0, -2.2, 7.4], [0, -8.0, 15.2], 0.2, m.rcc)); // 앞전
  const rudder = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.05, -8.4, 0);
    const panelShape = new THREE.Shape([[0, 7.4], [-0.5, 15.2], [-1.9, 15.2], [-1.6, 7.4]].map(([y, z]) => new THREE.Vector2(y, z)));
    const geo = new THREE.ExtrudeGeometry(panelShape, { depth: 0.2, bevelEnabled: false });
    geo.applyMatrix4(YZ_BASIS);
    if (side < 0) geo.translate(-0.2, 0, 0);
    pivot.add(new THREE.Mesh(geo, m.white));
    g.add(pivot);
    rudder.push({ pivot, side });
  }

  // ── 궤도 조종 엔진 꼬투리(OMS) 2개 + 노즐 ────────────────
  const omsExits = [];
  for (const side of [1, -1]) {
    const pod = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), m.white);
    pod.scale.set(0.95, 4.0, 0.85);
    pod.position.set(side * 1.75, -6.0, 7.45);
    g.add(pod);
    const n = nozzle(0.18, 0.38, 0.9, m);
    n.position.set(side * 1.75, -9.9, 7.5);
    g.add(n);
    omsExits.push([side * 1.75, -10.8, 7.5]);
  }

  // ── 주 엔진 3개 (외부 탱크 연료) ─────────────────────────
  const ssmeExits = [];
  for (const [x, z] of [[0, 6.3], [-1.35, 4.15], [1.35, 4.15]]) {
    const n = nozzle(0.42, 1.12, 2.9, m);
    n.position.set(x, -9.7, z);
    g.add(n);
    ssmeExits.push([x, -12.6, z]);
  }

  // ── 착륙 바퀴 (주 바퀴 2, 앞바퀴 1) ──────────────────────
  const gear = [];
  const addGear = (x, y, bellyZ, wheelR) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, bellyZ);
    const strutLen = bellyZ - wheelR;
    pivot.add(rod([0, 0, 0], [0, 0, -strutLen], 0.13, m.strut));
    pivot.add(rod([0, 0, -strutLen * 0.3], [0, 0.9, -0.05], 0.06, m.strut)); // 버팀대
    for (const dx of [-0.3, 0.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.36, 22), m.tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, 0, -strutLen);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.38, 14), m.strut);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      pivot.add(wheel, hub);
    }
    // 바퀴 문 (열린 상태)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.0, 1.2), m.tile);
    door.position.set(x > 0 ? 0.75 : -0.75, 0, -0.55);
    pivot.add(door);
    g.add(pivot);
    gear.push(pivot);
  };
  addGear(-3.2, 0, 2.5, 0.55);
  addGear(3.2, 0, 2.5, 0.55);
  addGear(0, 21.5, 2.5, 0.42);

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { group: g, gear, elevons, rudder, ssmeExits, omsExits, chuteMount: [0, -9.8, 8.0], materials: m };
}

/** 감속 낙하산 (궤도선 좌표, 꼬리 뒤로 끌린다) */
export function createDragChuteModel(envMap) {
  const m = mats(envMap);
  const g = new THREE.Group();
  const RISER = 16;
  const R = 4;
  const canopyGroup = new THREE.Group();
  canopyGroup.position.y = -RISER;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), m.canopy);
  canopy.rotation.x = Math.PI; // 둥근 쪽이 뒤(−Y), 입구가 궤도선 쪽
  canopy.position.y = R * 0.6;
  const band = new THREE.Mesh(new THREE.SphereGeometry(R * 1.005, 28, 3, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.08), m.canopyBand);
  band.rotation.x = Math.PI;
  band.position.y = R * 0.6;
  canopyGroup.add(canopy, band);
  // 줄: 낙하산 테두리 → 모이는 점
  const rimY = R * 0.6 - R * Math.cos(Math.PI * 0.42); // 뒤집은 덮개의 테두리 높이
  const rimR = R * Math.sin(Math.PI * 0.42);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    canopyGroup.add(rod([Math.cos(a) * rimR, rimY, Math.sin(a) * rimR], [0, R * 2.2, 0], 0.025, m.line, 4));
  }
  g.add(rod([0, 0, 0], [0, -RISER + R * 2.2, 0], 0.05, m.line, 5));
  g.add(canopyGroup);
  return { group: g, canopy: canopyGroup };
}

/** 외부 탱크 (스택 좌표) */
export function createExternalTankModel(envMap, orbiterOffset) {
  const m = mats(envMap);
  const g = new THREE.Group();
  g.name = 'external-tank';
  const profile = [
    [0, 4.0], [2.2, 4.4], [3.5, 5.2], [4.1, 6.0], [4.2, 7], [4.2, 41], [4.05, 43], [3.6, 45],
    [2.8, 47], [1.8, 49], [0.9, 50.4], [0.35, 51.0], [0, 51.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tank = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), m.tank);
  g.add(tank);
  // 중간 탱크(산소 탱크와 수소 탱크 사이) 띠
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(4.24, 4.24, 3.6, 48, 1, true), m.intertank);
  inter.position.y = 33.2;
  g.add(inter);
  // 꼭대기 피뢰침
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.2, 10), m.darkMetal);
  spike.position.y = 51.8;
  g.add(spike);
  // 산소 공급관·케이블 통로 (궤도선 쪽 옆면을 따라 아래로)
  const tankMat = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.9 });
  g.add(rod([1.7, 8.5, 3.95], [1.7, 34, 3.95], 0.24, tankMat));
  g.add(rod([-1.9, 8, 3.85], [-1.9, 40, 3.85], 0.16, tankMat));
  // 궤도선 연결 지지대 (앞 2갈래, 뒤 좌우)
  const [ox, oy, oz] = orbiterOffset;
  const bellyZ = oz + 2.5;
  g.add(rod([-1.0, oy + 17.6, 4.1], [ox, oy + 19.3, bellyZ], 0.13, m.strut));
  g.add(rod([1.0, oy + 17.6, 4.1], [ox, oy + 19.3, bellyZ], 0.13, m.strut));
  for (const side of [-1, 1]) {
    g.add(rod([side * 1.9, oy - 7.5, 3.75], [side * 1.9, oy - 6.2, bellyZ], 0.2, m.strut));
    g.add(rod([side * 1.9, oy - 6.2, bellyZ], [side * 0.6, oy - 7.7, 4.15], 0.12, m.strut));
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

export const SRB_X = 4.2 + 1.86 + 0.5; // 고체 부스터 축의 좌우 위치 (m)

/** 고체 부스터 한 개 (원점 = 노즐 끝, 축 = Y) */
function createSrbModel(m) {
  const g = new THREE.Group();
  const profile = [
    [0, 2.0], [2.5, 2.05], [2.48, 2.6], [2.1, 4.5], [1.86, 6.0], [1.86, 36.5], [1.75, 37.5], [1.5, 39.5],
    [1.1, 41.5], [0.6, 43.3], [0.25, 44.4], [0, 44.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), m.srb));
  // 분절 이음매 고리
  for (const y of [12.5, 19.5, 26.5, 33.5]) {
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.35, 40, 1, true), m.srbJoint);
    joint.position.y = y;
    g.add(joint);
  }
  // 위쪽 검은 띠
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.79, 1.86, 0.9, 40, 1, true), m.tile);
  band.position.y = 37.0;
  g.add(band);
  // 노즐 (아래 치마 안쪽으로 걸린다)
  const n = nozzle(0.8, 1.45, 2.0, m);
  n.position.y = 2.0;
  g.add(n);
  // 옆 배선 통로
  g.add(rod([0, 6, 1.88], [0, 36, 1.88], 0.12, m.srbJoint, 6));
  return g;
}

/** 고체 부스터 한 쌍 (스택 좌표) */
export function createSrbPairModel(envMap) {
  const m = mats(envMap);
  const g = new THREE.Group();
  g.name = 'srb-pair';
  for (const side of [-1, 1]) {
    const srb = createSrbModel(m);
    srb.position.x = side * SRB_X;
    srb.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; // 배선 통로가 바깥쪽
    g.add(srb);
    // 외부 탱크에 붙는 지지대 (앞·뒤)
    g.add(rod([side * (SRB_X - 1.8), 39.5, 0], [side * 4.1, 40.5, 0], 0.18, m.strut));
    g.add(rod([side * (SRB_X - 1.85), 8.5, 0.6], [side * 4.15, 8.0, 0.6], 0.14, m.strut));
    g.add(rod([side * (SRB_X - 1.85), 8.5, -0.6], [side * 4.15, 8.0, -0.6], 0.14, m.strut));
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
