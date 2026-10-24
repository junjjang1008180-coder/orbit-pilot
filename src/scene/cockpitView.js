/**
 * 1인칭(조종석) 실내 — 시각 효과 전용
 * ------------------------------------------------------------
 * 캡슐 안에서 기수 방향으로 난 창문을 내다보는 실내를 기본 도형으로 만든다.
 *   - 실내 벽(안쪽 면만 그림), 앞 벽에 둥근 사각 창문 구멍
 *   - 금속 창틀 + 볼트 + 살짝 비치는 유리, 창문 가운데 얇은 창살
 *   - 창문 아래 비스듬한 계기판: 실시간 화면 3개(비행 · 엔진 · 궤도)와 작은 버튼·표시등
 *   - 따뜻한 실내등 (밤이나 우주에서도 실내가 보이게)
 * 좌표: 로컬 +Y = 앞(기수), +Z = 위(로켓 등 쪽, 네비볼 위와 같음), +X = 오른쪽. 원점 = 눈 위치.
 * 실내는 로켓 자세를 따라 돌고, 고개를 돌려도(카메라만 돌아감) 창문은 제자리에 있다.
 */
import * as THREE from 'three';
import { formatNumber } from '../ui/format.js';

const WALL_DISTANCE = 0.9; // 눈에서 앞 벽까지 (m)
const WINDOW_W = 1.3; // 창문 너비 (m)
const WINDOW_H = 0.72; // 창문 높이 (m)
const WINDOW_Z = 0.06; // 창문 가운데 높이 (눈 기준, m)
const SCREEN_W = 256; // 계기 화면 캔버스 크기 (px)
const SCREEN_H = 160;

/** 둥근 사각형 경로 (가운데 cx, cy · 너비 w · 높이 h · 모서리 r) */
function roundedRect(path, cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** XZ 평면(2D x, z)에 만든 모양을 눈을 향하도록(앞 y 거리) 세운다 */
function standUp(mesh, y) {
  mesh.rotation.x = Math.PI / 2; // (x, s, 0) → (x, 0, s): 법선 +Z → −Y (눈 쪽)
  mesh.position.y = y;
  return mesh;
}

export function createCockpitView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5b636e, roughness: 0.85, metalness: 0.15, emissive: 0x1c2127, side: THREE.DoubleSide });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x2e333b, roughness: 0.95, emissive: 0x0b0d10 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85, emissive: 0x121416 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.5, metalness: 0.7, emissive: 0x0a0b0d });

  // ── 실내 벽: 상자 안쪽 면 (앞면은 창문 구멍이 있는 벽으로 따로) ─────
  const room = new THREE.BoxGeometry(3.2, 2.4, 2.2); // x, y(앞뒤), z
  room.translate(0, WALL_DISTANCE - 1.2, 0);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  // BoxGeometry 면 순서: +x, −x, +y(앞), −y, +z, −z
  const shell = new THREE.Mesh(room, [wallMat, wallMat, invisible, wallMat, padMat, padMat]);
  shell.material = shell.material.map((m) => (m === invisible ? m : m.clone()));
  for (const m of shell.material) m.side = THREE.BackSide;
  group.add(shell);

  // 앞 벽 (창문 구멍)
  const frontShape = roundedRect(new THREE.Shape(), 0, 0, 3.2, 2.2, 0.05);
  frontShape.holes.push(roundedRect(new THREE.Path(), 0, WINDOW_Z, WINDOW_W, WINDOW_H, 0.12));
  group.add(standUp(new THREE.Mesh(new THREE.ShapeGeometry(frontShape, 12), wallMat), WALL_DISTANCE));

  // 벽 이음선·보강 띠 (앞 벽 위아래, 옆 벽)
  for (const z of [0.62, -0.62]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.04, 0.05), darkMetal);
    rib.position.set(0, WALL_DISTANCE - 0.03, z);
    group.add(rib);
  }
  for (const x of [-1.55, 1.55]) {
    for (const y of [0.3, -0.5]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 2.0), darkMetal);
      rib.position.set(x, y, 0);
      group.add(rib);
    }
  }

  // ── 창틀 + 볼트 + 창살 + 유리 ────────────────────────────
  const frameShape = roundedRect(new THREE.Shape(), 0, WINDOW_Z, WINDOW_W + 0.16, WINDOW_H + 0.16, 0.18);
  frameShape.holes.push(roundedRect(new THREE.Path(), 0, WINDOW_Z, WINDOW_W, WINDOW_H, 0.12));
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 12 });
  group.add(standUp(new THREE.Mesh(frameGeo, metal), WALL_DISTANCE - 0.005));
  const boltGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10);
  const boltCount = 22;
  for (let i = 0; i < boltCount; i++) {
    // 창틀 둘레(둥근 사각형에 가깝게)를 따라 볼트
    const a = (i / boltCount) * Math.PI * 2;
    const hx = (WINDOW_W + 0.08) / 2;
    const hz = (WINDOW_H + 0.08) / 2;
    const k = 1 / Math.max(Math.abs(Math.cos(a)) / hx, Math.abs(Math.sin(a)) / hz);
    const bolt = new THREE.Mesh(boltGeo, darkMetal);
    bolt.position.set(Math.cos(a) * k * 0.97, WALL_DISTANCE - 0.07, WINDOW_Z + Math.sin(a) * k * 0.97);
    group.add(bolt);
  }
  // 가운데 얇은 세로 창살
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, WINDOW_H), metal);
  mullion.position.set(0, WALL_DISTANCE - 0.01, WINDOW_Z);
  group.add(mullion);
  // 유리: 아주 옅은 푸른빛 + 위쪽에 비치는 반사 띠
  const glass = standUp(new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW_W, WINDOW_H),
    new THREE.MeshBasicMaterial({ color: 0x9fc6ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }),
  ), WALL_DISTANCE + 0.01);
  glass.position.z = WINDOW_Z;
  group.add(glass);
  const glare = standUp(new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW_W * 0.42, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }),
  ), WALL_DISTANCE + 0.005);
  glare.position.set(-WINDOW_W * 0.18, WALL_DISTANCE + 0.005, WINDOW_Z + WINDOW_H * 0.32);
  glare.rotateZ(0.25); // 유리 면 안에서 비스듬히
  group.add(glare);

  // ── 계기판 (창문 아래, 눈 쪽으로 비스듬히) ───────────────
  const dash = new THREE.Group();
  dash.position.set(0, 0.62, -0.38);
  dash.rotation.x = 0.75; // 앞면(로컬 +Z)이 눈과 위쪽을 향하게
  dash.scale.setScalar(0.85); // 창문 아래 가장자리를 가리지 않을 만큼
  group.add(dash);
  const dashBody = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 0.08), padMat);
  dash.add(dashBody);
  const dashTrim = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.03, 0.1), metal);
  dashTrim.position.set(0, 0.21, 0);
  dash.add(dashTrim);

  // 실시간 화면 3개 (캔버스 → 스스로 빛나는 재질)
  const screens = ['비행', '엔진', '궤도'].map((title, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    // 계기판 앞면(로컬 +Z)이 눈을 향하므로, +Z 를 향하는 평면을 그 면 위에 붙인다
    mesh.position.set((i - 1) * 0.52, 0.02, 0.05);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.02), darkMetal);
    bezel.position.set(mesh.position.x, mesh.position.y, 0.035);
    dash.add(bezel, mesh);
    return { title, canvas, ctx: canvas.getContext('2d'), texture, mesh };
  });
  // 작은 버튼·표시등
  const buttonGeo = new THREE.BoxGeometry(0.035, 0.035, 0.02);
  const lamps = [];
  const lampColors = [0x3ddc84, 0xffb547, 0x4fd1ff, 0xff5b5b];
  for (let i = 0; i < 16; i++) {
    const color = lampColors[i % lampColors.length];
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const b = new THREE.Mesh(buttonGeo, mat);
    b.position.set(-0.78 + i * 0.104, -0.16, 0.05);
    dash.add(b);
    lamps.push({ mat, color: new THREE.Color(color), phase: i * 1.7 });
  }
  for (const x of [-0.92, 0.92]) {
    // 양 끝 손잡이 스위치
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), metal);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.05, 0.06);
    dash.add(knob);
  }

  // 위쪽 손잡이 막대 (머리 위)
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 10), metal);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.55, 0.78);
  group.add(handle);

  // 실내등 (따뜻한 빛, 가까운 곳만)
  const lamp = new THREE.PointLight(0xffd9a8, 9, 5, 2);
  lamp.position.set(0, -0.2, 0.7);
  group.add(lamp);

  let lastScreenTime = -1;

  function drawScreen(s, rows, color = '#3ddc84') {
    const { ctx, canvas } = s;
    ctx.fillStyle = '#04110a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 주사선
    ctx.fillStyle = 'rgba(61, 220, 132, 0.05)';
    for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
    ctx.fillStyle = color;
    ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
    ctx.fillText(s.title, 12, 28);
    ctx.fillRect(12, 36, canvas.width - 24, 2);
    ctx.font = '19px ui-monospace, Menlo, monospace';
    rows.forEach(([k, v], i) => {
      ctx.fillStyle = 'rgba(160, 240, 190, 0.75)';
      ctx.fillText(k, 12, 64 + i * 30);
      ctx.fillStyle = color;
      const w = ctx.measureText(v).width;
      ctx.fillText(v, canvas.width - 12 - w, 64 + i * 30);
    });
    s.texture.needsUpdate = true;
  }

  return {
    group,
    /**
     * @param {boolean} visible 1인칭 시점인지
     * @param {THREE.Vector3} eye 눈 위치 (화면 좌표)
     * @param {number[]} orientation 로켓 자세 쿼터니언
     * @param {object} t 텔레메트리 (화면 글자)
     * @param {number} time 화면 시각 (s)
     */
    update(visible, eye, orientation, t, time) {
      group.visible = visible;
      if (!visible) return;
      group.position.copy(eye);
      group.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
      // 로컬 축 맞추기: 그룹의 +Y = 기수, +Z = 로켓 등 (로켓 로컬 축과 같다)
      for (const l of lamps) l.mat.color.copy(l.color).multiplyScalar(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 1.3 + l.phase)));
      if (time - lastScreenTime < 0.2) return; // 화면 글자는 0.2 초마다
      lastScreenTime = time;
      const km = (m) => `${formatNumber(m / 1000, 1)} km`;
      drawScreen(screens[0], [
        ['고도', km(t.altitude)],
        ['속도', `${formatNumber(t.speed, 0)} m/s`],
        ['수직', `${formatNumber(t.verticalSpeed, 0)} m/s`],
      ]);
      drawScreen(screens[1], [
        ['추력', `${formatNumber(t.throttle * 100, 0)} %`],
        ['연료', `${formatNumber(t.fuelRatio * 100, 0)} %`],
        ['Δv', `${formatNumber(t.deltaVTotal, 0)} m/s`],
      ], t.fuelRatio < 0.1 ? '#ffb547' : '#3ddc84');
      drawScreen(screens[2], [
        ['원지점', t.escapeTrajectory ? '∞' : km(t.apoapsisAltitude)],
        ['근지점', t.periapsisAltitude < 0 ? '지표 아래' : km(t.periapsisAltitude)],
        ['G', `${formatNumber(t.gForce, 1)} g`],
      ], t.warnings?.length ? '#ffb547' : '#3ddc84');
    },
  };
}
