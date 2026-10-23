/**
 * 발사장 주변 풍경 (조립동, 관제센터, 연료탱크, 급수탑, 도로, 조명탑, 숲) — 시각 효과 전용
 * ------------------------------------------------------------
 * 발사대 기준 지역 좌표(X = 동, Y = 위, Z = 남, 단위 m)에 배치한다.
 * 행성이 둥글어서 발사대에서 멀어질수록 지면이 d²/(2R) 만큼 내려가므로,
 * 각 물체를 그만큼 내려 실제 지표 위에 서게 한다. 물리 계산(충돌 등)에는 포함되지 않는다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from './renderCoordinates.js';

const TREE_COUNT = 2200;
const TREE_INNER = 260; // 발사대에서 이 거리(m) 안에는 나무를 심지 않는다
const TREE_OUTER = 3500;

export function createLaunchSiteScenery(config) {
  const { planet, launchSite } = config;
  const siteDirection = vec3.normalize(launchSite.direction);
  const sitePosition = vec3.scale(siteDirection, planet.radius);
  const frame = localFrame(sitePosition, planet.northPoleDirection);
  const R = toRenderLength(planet.radius);

  const group = new THREE.Group();
  group.name = 'launch-site-scenery';
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.east),
      new THREE.Vector3(...frame.up),
      new THREE.Vector3(...vec3.scale(frame.north, -1)),
    ),
  );

  /** 발사대에서 수평 거리 d 만큼 떨어진 곳의 지면 높이 (곡률 보정) */
  const groundY = (x, z) => -(x * x + z * z) / (2 * R);
  const place = (object, x, z, yOffset = 0) => {
    object.position.set(x, groundY(x, z) + yOffset, z);
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(object);
    return object;
  };

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  const concrete = mat(0xb9b8b2);
  const white = mat(0xe8eaec);
  const darkMetal = mat(0x4a4f57, { metalness: 0.4, roughness: 0.5 });
  const windowsTexture = createWindowsTexture();

  // ── 조립동 (거대한 상자 건물 + 큰 문 + 줄무늬) ─────────
  const vab = new THREE.Group();
  const vabBody = new THREE.Mesh(new THREE.BoxGeometry(70, 95, 60), white);
  vabBody.position.y = 47.5;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(26, 80), mat(0x6d7480));
  door.position.set(0, 40, 30.05);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(70.4, 6, 60.4), mat(0x1d4f91));
  stripe.position.y = 82;
  vab.add(vabBody, door, stripe);
  place(vab, -520, -380).rotation.y = Math.PI / 5;

  // ── 관제센터 (낮은 건물 + 창문 빛) ──────────────────────
  const control = new THREE.Group();
  const controlBody = new THREE.Mesh(
    new THREE.BoxGeometry(60, 14, 28),
    new THREE.MeshStandardMaterial({ color: 0xd2d6db, roughness: 0.6, emissive: 0xffffff, emissiveMap: windowsTexture, emissiveIntensity: 0.35, map: windowsTexture }),
  );
  controlBody.position.y = 7;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(0xf2f2f2, { side: THREE.DoubleSide }));
  dish.position.set(18, 20, 0);
  dish.rotation.x = Math.PI * 0.8;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 8, 12), darkMetal);
  mast.position.set(18, 16, 0);
  control.add(controlBody, mast, dish);
  place(control, 820, 380).rotation.y = -Math.PI / 9;

  // ── 연료탱크 (다리 달린 구형 탱크 3개) ──────────────────
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Group();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 16), white);
    sphere.position.y = 14;
    tank.add(sphere);
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 10, 8), darkMetal);
      leg.position.set(Math.cos((k * Math.PI) / 2) * 7, 5, Math.sin((k * Math.PI) / 2) * 7);
      tank.add(leg);
    }
    place(tank, 150 + i * 26, -170);
  }

  // ── 급수탑 (발사대 소음 억제용 물탱크) ─────────────────
  const tower = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 10, 24), white);
  tank.position.y = 34;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 4, 24), mat(0x8c9198));
  roof.position.y = 41;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 29, 12), concrete);
  column.position.y = 14.5;
  tower.add(column, tank, roof);
  place(tower, -95, 70);

  // ── 조명탑 (발사대 둘레 4개, 꼭대기가 빛남) ─────────────
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  for (let k = 0; k < 4; k++) {
    const angle = Math.PI / 4 + (k * Math.PI) / 2;
    const pole = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 40, 8), darkMetal);
    shaft.position.y = 20;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.4), lampMaterial);
    lamp.position.y = 40.5;
    pole.add(shaft, lamp);
    place(pole, Math.cos(angle) * 75, Math.sin(angle) * 75);
  }

  // ── 도로 (지면 곡률을 따라 휘는 띠) ─────────────────────
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 });
  const roadPaths = [
    [[20, 0], [-200, -140], [-500, -360]],
    [[20, 0], [300, 120], [800, 370]],
    [[0, -20], [120, -150], [180, -170]],
  ];
  for (const path of roadPaths) group.add(buildRoad(path, 9, roadMaterial, groundY));
  // 발사대 둘레 콘크리트 마당
  const apron = new THREE.Mesh(new THREE.CircleGeometry(60, 48), mat(0xa7a6a0, { roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.05;
  apron.receiveShadow = true;
  group.add(apron);

  // ── 숲 (원뿔 나무, 인스턴스로 많이 그리기) ──────────────
  group.add(buildForest(groundY, roadPaths));

  return {
    group,
    /** @param {number[]} origin 화면 원점 (m) */
    update(origin) {
      toRenderPosition(sitePosition, origin, group.position);
    },
  };
}

/** 지면 곡률을 따르는 도로 띠 */
function buildRoad(points, width, material, groundY) {
  const positions = [];
  const indices = [];
  const STEP = 20; // 한 조각 길이 (m)
  let n = 0;
  for (let p = 0; p < points.length - 1; p++) {
    const [x0, z0] = points[p];
    const [x1, z1] = points[p + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / STEP));
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    for (let s = 0; s <= steps; s++) {
      if (p > 0 && s === 0) continue;
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      for (const side of [-1, 1]) {
        const px = x + nx * side * width * 0.5;
        const pz = z + nz * side * width * 0.5;
        positions.push(px, groundY(px, pz) + 0.12, pz);
      }
      if (n > 0) {
        const a = (n - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      n++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // 위를 향하도록 법선 방향 확인 (뒤집혔으면 면 순서 반전)
  if (geometry.getAttribute('normal').getY(0) < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** 원뿔 나무 숲 (도로·건물 근처는 비움) */
function buildForest(groundY, roadPaths) {
  const foliage = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 7),
    new THREE.MeshStandardMaterial({ color: 0x24451f, roughness: 0.9, flatShading: true }),
    TREE_COUNT,
  );
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 5), new THREE.MeshStandardMaterial({ color: 0x4a3524 }), TREE_COUNT);
  foliage.castShadow = trunk.castShadow = true;
  foliage.receiveShadow = true;

  const keepClear = [
    [-520, -380, 110], // 조립동
    [820, 380, 90], // 관제센터
    [180, -170, 60], // 연료탱크
  ];
  const nearRoad = (x, z) =>
    roadPaths.some((path) =>
      path.slice(0, -1).some(([x0, z0], i) => {
        const [x1, z1] = path[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < 25;
      }),
    );

  let seed = 98765;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let count = 0;
  for (let tries = 0; tries < TREE_COUNT * 4 && count < TREE_COUNT; tries++) {
    // 숲은 군데군데 모여 있도록: 각도·거리 무작위 + 무리 짓기
    const angle = rand() * Math.PI * 2;
    const dist = TREE_INNER + (TREE_OUTER - TREE_INNER) * Math.sqrt(rand());
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const cluster = Math.sin(x * 0.004) * Math.cos(z * 0.005) + Math.sin((x + z) * 0.0021);
    if (cluster < 0.15) continue;
    if (keepClear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r) || nearRoad(x, z)) continue;
    const h = 9 + rand() * 9;
    const r = h * (0.22 + rand() * 0.08);
    const y = groundY(x, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(pos.set(x, y + 2 + h / 2, z), q, scale.set(r, h, r));
    foliage.setMatrixAt(count, m);
    m.compose(pos.set(x, y + 1.2, z), q, scale.set(1, 2.4, 1));
    trunk.setMatrixAt(count, m);
    count++;
  }
  foliage.count = trunk.count = count;
  const forest = new THREE.Group();
  forest.add(foliage, trunk);
  return forest;
}

/** 관제센터 창문 무늬 (밝은 창 줄) */
function createWindowsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#20252c';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffe9a8';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 16; col++) {
      if ((row * 7 + col * 3) % 5 === 0) continue; // 일부 창은 꺼둠
      ctx.fillRect(4 + col * 16, 8 + row * 18, 10, 9);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
