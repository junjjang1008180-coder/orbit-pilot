/**
 * 발사대 3D 표시 (기본 도형 임시 모델)
 * ------------------------------------------------------------
 * 상판 높이·반지름은 물리 설정(launchSite)을 그대로 읽어
 * 로켓이 서는 높이와 화면의 상판 높이가 일치하게 한다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from './renderCoordinates.js';

export function createLaunchPadView(config, modelLibrary = null) {
  const { planet, launchSite } = config;
  const siteDirection = vec3.normalize(launchSite.direction);
  const sitePosition = vec3.scale(siteDirection, planet.radius); // 지표 위치 (m)
  const frame = localFrame(sitePosition, planet.northPoleDirection);

  const padHeight = toRenderLength(launchSite.padHeight);
  const padRadius = toRenderLength(launchSite.padRadius);

  const group = new THREE.Group();
  // 그룹 로컬 축: X = 동쪽, Y = 위, Z = 남쪽
  const south = vec3.scale(frame.north, -1);
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.east),
      new THREE.Vector3(...frame.up),
      new THREE.Vector3(...south),
    ),
  );

  // assets/models/launchPad.glb 가 있으면 상판 지름에 맞춰 그 모델을 쓴다
  const model = modelLibrary?.createFitted('launchPad', { diameter: padRadius * 2 });
  // 우주 왕복선용 이동식 발사대·빨간 철골 발사탑 (왕복선을 발사할 때만 보인다)
  const shuttleStructure = createShuttleStructure(padHeight);
  shuttleStructure.visible = false;
  group.add(shuttleStructure);

  if (model) {
    group.add(model);
    return {
      group,
      setShuttle(on) {
        shuttleStructure.visible = on;
      },
      update(origin) {
        toRenderPosition(sitePosition, origin, group.position);
      },
    };
  }

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb33a2e, roughness: 0.6, metalness: 0.3 });

  // 상판 (원기둥): 지면(0)부터 상판 높이까지
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(padRadius, padRadius * 1.08, padHeight, 48), concrete);
  pad.position.y = padHeight / 2;
  group.add(pad);

  // 화염 배출구 표시 (상판 중앙의 어두운 원)
  const flameHole = new THREE.Mesh(
    new THREE.CircleGeometry(padRadius * 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  flameHole.rotation.x = -Math.PI / 2;
  flameHole.position.y = padHeight + 0.02;
  group.add(flameHole);

  // 발사탑 (상판 북서쪽 가장자리 — 남쪽에서 보는 카메라를 가리지 않도록)
  const towerHeight = padRadius * 1.8;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, towerHeight, 1.6), steel);
  tower.position.set(-padRadius * 0.5, padHeight + towerHeight / 2, -padRadius * 0.5);
  group.add(tower);

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });

  return {
    group,
    /** 우주 왕복선 발사면 철골 발사탑으로 바꾼다 */
    setShuttle(on) {
      shuttleStructure.visible = on;
      tower.visible = !on;
    },
    update(origin) {
      toRenderPosition(sitePosition, origin, group.position);
    },
  };
}

/** 두 점 사이 막대 */
function beam(a, b, size, material) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, A.distanceTo(B), size), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
  return m;
}

/**
 * 우주 왕복선 발사 구조물 (발사대 그룹 좌표: X = 동, Y = 위, Z = 남)
 * 스택은 궤도선이 서쪽(−X), 고체 부스터가 남·북(±Z)에 선다. 발사탑은 북쪽, 승무원 통로가 궤도선 옆문으로 뻗는다.
 */
function createShuttleStructure(padHeight) {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb2321f, roughness: 0.6, metalness: 0.35 });
  const gray = new THREE.MeshStandardMaterial({ color: 0x8d8f8f, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xdedfdc, roughness: 0.7 });

  // 이동식 발사대 (회색 상자, 윗면 = 상판 높이) + 불꽃 구멍
  const mlp = new THREE.Mesh(new THREE.BoxGeometry(40, padHeight, 30), gray);
  mlp.position.y = padHeight / 2 + 0.01;
  g.add(mlp);
  for (const [x, z, w, d] of [[0, 6.55, 5, 5], [0, -6.55, 5, 5], [-9.5, 0, 6, 6]]) {
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dark);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, padHeight + 0.03, z);
    g.add(hole);
  }
  // 받침 기둥 (발사대 아래)
  for (const x of [-17, 17]) for (const z of [-12, 12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(3, padHeight, 3), gray);
    leg.position.set(x, padHeight / 2, z);
    g.add(leg);
  }
  // 꼬리 연결 기둥 2개 (궤도선 꼬리 양옆)
  for (const z of [-4.5, 4.5]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(3, 9, 2.5), white);
    mast.position.set(-10, padHeight + 4.5, z);
    g.add(mast);
  }

  // 고정 발사탑 (빨간 철골): 북쪽, 가로 10 m × 10 m, 높이 76 m
  const cx = -4;
  const cz = -17;
  const half = 5;
  const H = 76;
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (const [dx, dz] of corners) g.add(beam([cx + dx, 0, cz + dz], [cx + dx, H, cz + dz], 0.7, red));
  const LEVEL = 6;
  for (let y = LEVEL; y <= H; y += LEVEL) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      g.add(beam([cx + ax, y, cz + az], [cx + bx, y, cz + bz], 0.45, red));
      // X 자 버팀대
      g.add(beam([cx + ax, y - LEVEL, cz + az], [cx + bx, y, cz + bz], 0.25, red));
      g.add(beam([cx + bx, y - LEVEL, cz + bz], [cx + ax, y, cz + az], 0.25, red));
    }
    // 층 바닥 (철망 느낌의 얇은 판)
    if (y % (LEVEL * 2) === 0) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.15, half * 2), gray);
      floor.position.set(cx, y, cz);
      g.add(floor);
    }
  }
  // 꼭대기 피뢰 기둥 + 늘어진 피뢰선
  g.add(beam([cx, H, cz], [cx, H + 18, cz], 0.6, white));
  for (const [x, z] of [[cx - 60, cz - 40], [cx + 60, cz + 50]]) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(cx, H + 18, cz), new THREE.Vector3((cx + x) / 2, H - 10, (cz + z) / 2), new THREE.Vector3(x, 0, z));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.06, 4, false), dark));
  }
  // 승무원 통로 (궤도선 옆문 높이) + 끝의 하얀 방
  const armY = padHeight + 36.6;
  g.add(beam([-8.3, armY, cz + half], [-8.3, armY, -4.2], 1.8, red));
  const room = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2.4), white);
  room.position.set(-8.3, armY + 0.4, -3.4);
  g.add(room);
  // 외부 탱크 꼭대기 환기 팔 (산소 배출 덮개)
  g.add(beam([cx, padHeight + 53.5, cz + half], [0, padHeight + 53.5, -3.6], 0.9, red));
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 2.0, 16), white);
  hood.position.set(0, padHeight + 53.2, -3.6); // 발사 전 옆으로 젖혀 둔 상태
  g.add(hood);
  // 급수탑 (발사탑 옆)
  const waterTank = new THREE.Mesh(new THREE.SphereGeometry(4, 18, 12), white);
  waterTank.position.set(cx - 22, 55, cz - 12);
  g.add(waterTank);
  for (const [dx, dz] of [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]]) g.add(beam([cx - 22 + dx * 1.6, 0, cz - 12 + dz * 1.6], [cx - 22 + dx * 0.6, 52, cz - 12 + dz * 0.6], 0.5, gray));

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
