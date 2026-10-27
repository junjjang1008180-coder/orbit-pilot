/**
 * 우주 왕복선 착륙 활주로 3D 표시 — 시각 효과 전용
 * ------------------------------------------------------------
 * 행성 곡률을 따라 휘어진 긴 띠(아스팔트) + 표시(시작점 줄무늬, 번호, 중심선, 접지 구역) + 가장자리 등.
 * 그룹 좌표: 활주로 가운데 지표 기준, X = 동쪽(활주로 방향), Y = 위, Z = 남쪽 (m).
 * 서쪽 끝(X = −길이/2)이 착륙 시작점이며, 시작점 등(초록)·끝 등(빨강)·진입 경로 지시등(PAPI)이 있다.
 */
import * as THREE from 'three';
import { runwayFrame, runwayPoint } from './runway.js';
import { toRenderPosition } from '../scene/renderCoordinates.js';

const LIFT = 0.25; // 지면 위로 띄우는 높이 (m, 겹침 깜빡임 방지)

/** 활주로 표시 그림 (가로 = 길이, 세로 = 너비) */
function markingTexture(length, width) {
  const W = 4096;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const sx = W / length; // px per m (길이)
  const sy = H / width; // px per m (너비)
  // 아스팔트 + 얼룩
  ctx.fillStyle = '#2b2d30';
  ctx.fillRect(0, 0, W, H);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 10, 1 + rand() * 3);
  }
  // 접지 구역 타이어 자국 (양 끝 앞쪽)
  for (const x0 of [300, length - 1300]) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0 * sx, H * 0.3, 1000 * sx, H * 0.4);
  }
  ctx.fillStyle = '#eef0f2';
  // 가장자리 줄
  ctx.fillRect(0, 2 * sy, W, 1.2 * sy);
  ctx.fillRect(0, H - 3.2 * sy, W, 1.2 * sy);
  // 중심선 (30 m 줄, 20 m 띄움)
  for (let x = 120; x < length - 120; x += 50) ctx.fillRect(x * sx, H / 2 - 0.6 * sy, 30 * sx, 1.2 * sy);
  const thresholdBars = (x0, dir) => {
    for (let i = 0; i < 8; i++) {
      for (const side of [-1, 1]) {
        const y = H / 2 + side * (6 + i * 4.5) * sy - (side < 0 ? 3 * sy : 0);
        ctx.fillRect(Math.min(x0, x0 + dir * 45) * sx, y, 45 * sx, 3 * sy);
      }
    }
    // 접지 구역 표시 (짧은 줄 3쌍)
    for (let k = 0; k < 3; k++) {
      for (const side of [-1, 1]) {
        const x = x0 + dir * (150 + k * 150);
        ctx.fillRect(Math.min(x, x + dir * 22) * sx, H / 2 + side * 14 * sy - 1.5 * sy, 22 * sx, 3 * sy);
      }
    }
    // 겨냥점 표시 (굵은 사각형 한 쌍)
    for (const side of [-1, 1]) {
      const x = x0 + dir * 300;
      ctx.fillRect(Math.min(x, x + dir * 50) * sx, H / 2 + side * 16 * sy - 4 * sy, 50 * sx, 8 * sy);
    }
  };
  thresholdBars(10, 1);
  thresholdBars(length - 10, -1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 활주로 번호 글자판 */
function numberDecal(text, rotate) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eef0f2';
  ctx.font = 'bold 200px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(128, 128);
  ctx.rotate(rotate);
  ctx.fillText(text, 0, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
}

/** @param {object} [runwayDef] config.runways 의 한 항목 (빼면 첫 번째) */
export function createRunwayView(config, runwayDef = null) {
  const f = runwayFrame(config, runwayDef);
  const R = config.planet.radius;
  const L = config.runway.length;
  const W = config.runway.width;
  const center = runwayPoint(config, 0, 0, 0, runwayDef);

  const group = new THREE.Group();
  group.name = 'runway';
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.east), new THREE.Vector3(...f.up), new THREE.Vector3(...f.north).negate()),
  );
  const ground = (x, z) => -(x * x + z * z) / (2 * R) + LIFT; // 곡률만큼 내려간 지면

  // 휘어진 띠: 길이 방향 120 칸 (갓길 포함 폭 W + 30)
  const strip = (width, segs, material, y = 0) => {
    const geo = new THREE.PlaneGeometry(L + 120, width, segs, 2);
    geo.rotateX(-Math.PI / 2); // XZ 평면, 법선 +Y
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)) + y);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // 활주로 둘레 땅 (섬은 모래 + 얕은 바다 띠, 사막은 모래빛, 그 밖은 풀밭)
  // [땅 색, 땅 반지름, 둘레 바다 띠들 [색, 반지름]]
  const TERRAIN = {
    grass: [0x4f7a34, 3_200, []],
    sand: [0xd9c48d, 3_200, [[0x37b3c4, 4_600], [0x15628c, 9_000]]], // 모래섬 + 얕은 바다 + 깊은 바다
    desert: [0xc49a62, 7_000, []],
  };
  const [landColor, landRadius, seas] = TERRAIN[f.terrain] ?? TERRAIN.grass;
  const disc = (radius, color, y, units) => {
    const geo = new THREE.RingGeometry(0.01, radius, 96, 48); // 고리 여러 겹 — 곡률을 따라 휘게
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      // 가장자리로 갈수록 살짝 아래로 (지면에 스며들게)
      const edge = Math.hypot(x, z) / radius;
      p.setY(i, ground(x, z) - LIFT + y - Math.max(0, (edge - 0.92) / 0.08) * 0.25);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: units }));
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  if (f.id !== 'home') {
    seas.forEach(([color, radius], i) => disc(radius, color, 0.06 - i * 0.02, -6 + i));
    disc(landRadius, landColor, 0.1, -10);
  }
  strip(W + 40, 120, new THREE.MeshStandardMaterial({ color: 0x8c8a7e, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -14 }), -0.05); // 갓길
  const runwayGeo = new THREE.PlaneGeometry(L, W, 120, 2);
  runwayGeo.rotateX(-Math.PI / 2);
  {
    const p = runwayGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)) + 0.05);
    runwayGeo.computeVertexNormals();
  }
  const runway = new THREE.Mesh(
    runwayGeo,
    new THREE.MeshStandardMaterial({ map: markingTexture(L, W), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -20 }),
  );
  runway.receiveShadow = true;
  group.add(runway);

  // 활주로 번호 (서쪽 끝 = 동쪽으로 착륙 = "09", 동쪽 끝 = "27")
  const n09 = numberDecal('09', -Math.PI / 2);
  n09.rotation.x = -Math.PI / 2;
  n09.position.set(-L / 2 + 75, ground(-L / 2 + 75, 0) + 0.12, 0);
  const n27 = numberDecal('27', Math.PI / 2);
  n27.rotation.x = -Math.PI / 2;
  n27.position.set(L / 2 - 75, ground(L / 2 - 75, 0) + 0.12, 0);
  group.add(n09, n27);

  // 가장자리 등 (흰색), 시작점 등 (초록), 끝 등 (빨강) — 작은 발광 구
  const lightGeo = new THREE.SphereGeometry(0.6, 8, 6);
  const addLights = (points, color) => {
    const mesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }), points.length);
    const m = new THREE.Matrix4();
    points.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, ground(x, z) + 0.6, z)));
    group.add(mesh);
    return mesh;
  };
  const edge = [];
  for (let x = -L / 2; x <= L / 2; x += 60) for (const z of [-W / 2 - 3, W / 2 + 3]) edge.push([x, z]);
  addLights(edge, 0xfff3d6);
  const ends = (x) => Array.from({ length: 14 }, (_, i) => [x, -W / 2 + (i + 0.5) * (W / 14)]);
  addLights(ends(-L / 2 - 4), 0x4dff7a);
  addLights(ends(L / 2 + 4), 0xff4a3a);
  // 진입 등 줄 (서쪽으로 900 m, 30 m 마다)
  const approachLights = [];
  for (let x = -L / 2 - 60; x > -L / 2 - 900; x -= 30) for (const z of [-4, 0, 4]) approachLights.push([x, z]);
  const approach = addLights(approachLights, 0xfff7e8);

  // 진입 경로 지시등 (PAPI) 4개: 시작점 왼쪽 — 위에서 보면 흰색, 아래에서 보면 빨강 (가파른 왕복선 경로라 활공각 18° 기준)
  const papi = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.6), mat);
    const x = -L / 2 + 300;
    const z = -W / 2 - 18 - i * 9;
    box.position.set(x, ground(x, z) + 0.6, z);
    group.add(box);
    papi.push({ mat, angleDeg: config.shuttle.autopilot.glideSlopeDeg + (i - 1.5) * 1.2 });
  }

  // 관제탑 (활주로 남쪽 가운데)
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 6), new THREE.MeshStandardMaterial({ color: 0xd9dbd6, roughness: 0.8 }));
  shaft.position.y = 14;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(6, 5, 5, 8), new THREE.MeshStandardMaterial({ color: 0x1d3a52, roughness: 0.2, metalness: 0.6, emissive: 0x0d2233 }));
  cab.position.y = 30.5;
  tower.add(shaft, cab);
  tower.position.set(200, ground(200, 260), 260);
  tower.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  group.add(tower);

  const local = new THREE.Vector3();
  const inv = new THREE.Quaternion();

  return {
    group,
    /**
     * @param {number[]} origin 화면 원점 물리 위치 (m)
     * @param {number} time 화면 시각 (s, 진입 등 깜빡임)
     */
    update(origin, time = 0) {
      toRenderPosition(center, origin, group.position);
      // 화면 원점(조종 중인 비행체)이 시작점에서 보이는 각도로 PAPI 색을 정한다
      inv.copy(group.quaternion).invert();
      local.copy(group.position).negate().applyQuaternion(inv); // 그룹 좌표의 비행체 위치
      const dx = Math.max(1, -L / 2 + 300 - local.x);
      const angle = (Math.atan2(local.y, dx) * 180) / Math.PI;
      for (const p of papi) p.mat.color.setHex(angle > p.angleDeg ? 0xffffff : 0xff3b2f);
      // 진입 등: 반짝이며 활주로 쪽으로 흐르는 효과 (밝기만)
      approach.material.color.setScalar(0.65 + 0.35 * Math.max(0, Math.sin(time * 6)));
    },
  };
}
