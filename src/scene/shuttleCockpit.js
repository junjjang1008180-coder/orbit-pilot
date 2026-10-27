/**
 * 1인칭 우주 왕복선 비행 갑판 (사령관 자리) — 시각 효과 전용
 * ------------------------------------------------------------
 * 좌표: 로컬 +Y = 앞(기수), +Z = 위(궤도선 윗면), +X = 오른쪽. 원점 = 사령관 눈.
 * 비행 갑판 가운데는 눈에서 오른쪽으로 CABIN_X 만큼 (오른쪽 자리는 조종사석, 비어 있음).
 *   - 앞쪽 창문 6장이 호를 이루며 둘러싼다 (창틀 기둥, 위로 기울어진 유리)
 *   - 창문 아래 차양(글레어실드)과 앞 계기판: 다기능 화면 6개 (비행 자세·수평 상황·접근·시스템)
 *   - 사령관 앞 HUD 유리판: 비행 경로 표지·수평선·피치 사다리·속도·고도 (초록 선)
 *   - 회전 조종간(RHC): 다리 사이 권총 손잡이 — W/S·A/D·Q/E 입력을 따라 기운다
 *   - 왼쪽 에어브레이크/추력 레버(SBTC): 궤도선만이면 에어브레이크, 상승 중이면 스로틀을 따라 움직인다
 *   - 착륙 바퀴(ARM/DN)·감속 낙하산(ARM/DPY)·브레이크 버튼 불빛
 *   - 머리 위 스위치 패널, 왼쪽 벽 차단기 패널, 가운데 조작대(키패드)
 *   - 승무원 의자 4개(사령관 · 조종사 · 뒤쪽 임무 전문가 2명)와 주황 여압복 우주비행사들, 조종 장치를 잡은 내 손·몸 (crew.js)
 * 물리 상태는 읽기만 한다.
 */
import * as THREE from 'three';
import { formatNumber } from '../ui/format.js';
import { createCrewSeat, createAstronaut, createPilotBody, createGlove } from './crew.js';

const CABIN_X = 0.78; // 눈 → 비행 갑판 가운데 (m, 오른쪽)
const ARC_R = 1.32; // 창문 호 반지름 (m)
const STEP_DEG = 22; // 창문 한 장이 차지하는 각
const WINDOW_ANGLES = [-55, -33, -11, 11, 33, 55]; // 창문 가운데 방향 (°, 앞 0 · 오른쪽 +, 비행 갑판 가운데 기준)
const DEG = Math.PI / 180;

/** 세로(Y)로 선 원기둥을 Z 축으로 눕혀 z 위치에 둔 막대 */
function zRod(radius, length, z, material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  m.rotation.x = Math.PI / 2;
  m.position.z = z;
  return m;
}

function canvasPlane(width, height, pxW, pxH, transparent = false) {
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = transparent
    ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  return { mesh, ctx: canvas.getContext('2d'), canvas, texture };
}

/** 면(+Z)이 눈 쪽(−Y)을 향하게 세운 판 (XZ 평면) */
function upright(mesh) {
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** 비행 갑판 가운데에서 각도 deg 방향, 반지름 r 에 있는 그룹 (로컬 +Y = 바깥, 판 앞면은 −Y 로 눈을 향함) */
function arcFrame(deg, r, z = 0) {
  const g = new THREE.Group();
  const a = deg * DEG;
  g.position.set(CABIN_X + Math.sin(a) * r, Math.cos(a) * r, z);
  g.rotation.z = -a;
  return g;
}

export function createShuttleCockpitView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1, ...extra });
  const panelGray = std(0x5f6670, { emissive: 0x1a1d21 }); // 계기판 회색
  const wallBeige = std(0xb9b2a2, { emissive: 0x2a2722, side: THREE.DoubleSide }); // 벽 안감
  const black = std(0x15171a, { emissive: 0x050506 });
  const frameMat = std(0x2a2d31, { metalness: 0.5, roughness: 0.5, emissive: 0x08090a });
  const metal = std(0xa7adb5, { metalness: 0.85, roughness: 0.35, emissive: 0x141518 });

  // ── 실내 벽 (상자 안쪽 면) ──────────────────────────────
  const room = new THREE.BoxGeometry(3.6, 4.4, 2.8); // 앞면은 창문 벽이 대신한다 (호보다 앞까지 덮어 틈이 없게)
  room.translate(CABIN_X, -0.1, 0.1);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const shell = new THREE.Mesh(room, [wallBeige, wallBeige, invisible, wallBeige, wallBeige, std(0x3e434a, { emissive: 0x0c0e10, side: THREE.BackSide })]);
  shell.material = shell.material.map((m) => {
    if (m === invisible) return m;
    const c = m.clone();
    c.side = THREE.BackSide;
    return c;
  });
  group.add(shell);

  // ── 앞쪽 창문 6장 (호) ──────────────────────────────────
  const paneW = 2 * ARC_R * Math.tan((STEP_DEG / 2) * DEG);
  const TILT = 0.32; // 위가 눈 쪽으로 기운 각 (rad)
  for (const deg of WINDOW_ANGLES) {
    const f = arcFrame(deg, ARC_R);
    const tilt = new THREE.Group();
    tilt.rotation.x = TILT;
    f.add(tilt);
    // 창문 구멍이 있는 벽판
    const side = Math.abs(deg) > 40;
    const hw = paneW / 2 - (side ? 0.07 : 0.045);
    const zb = side ? -0.06 : -0.16;
    const zt = side ? 0.36 : 0.46;
    const shape = new THREE.Shape([[-paneW / 2 - 0.01, -1.6], [paneW / 2 + 0.01, -1.6], [paneW / 2 + 0.01, 1.3], [-paneW / 2 - 0.01, 1.3]].map(([x, y]) => new THREE.Vector2(x, y)));
    // 사다리꼴 창 (위가 조금 좁다)
    shape.holes.push(new THREE.Path([[-hw, zb], [hw, zb], [hw - 0.04, zt], [-hw + 0.04, zt]].map(([x, y]) => new THREE.Vector2(x, y))));
    tilt.add(upright(new THREE.Mesh(new THREE.ShapeGeometry(shape), panelGray)));
    // 창틀 (안쪽 테두리)
    const rim = [[-hw, zb], [hw, zb], [hw - 0.04, zt], [-hw + 0.04, zt]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = rim[i];
      const [bx, bz] = rim[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len + 0.03, 0.035, 0.03), frameMat);
      bar.position.set((ax + bx) / 2, -0.02, (az + bz) / 2);
      bar.rotation.y = -Math.atan2(bz - az, bx - ax);
      tilt.add(bar);
    }
    // 유리 (옅은 반사)
    const glass = upright(new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, zt - zb), new THREE.MeshBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide })));
    glass.position.set(0, 0.02, (zt + zb) / 2);
    tilt.add(glass);
    group.add(f);
  }
  // 창문 사이 기둥 (굵은 창틀)
  for (let k = 0; k <= WINDOW_ANGLES.length; k++) {
    const deg = WINDOW_ANGLES[0] - STEP_DEG / 2 + k * STEP_DEG;
    const f = arcFrame(deg, ARC_R / Math.cos((STEP_DEG / 2) * DEG) - 0.01);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 1.1), frameMat);
    post.position.z = 0.12;
    post.rotation.x = TILT;
    f.add(post);
    group.add(f);
  }

  // ── 차양(글레어실드) + 앞 계기판 ─────────────────────────
  const screens = [];
  const SCREEN_KINDS = ['hsi', 'pfd', 'approach', 'systems', 'pfd', 'hsi'];
  WINDOW_ANGLES.forEach((deg, i) => {
    const f = arcFrame(deg, ARC_R - 0.06);
    // 차양: 창문 바로 아래에서 눈 쪽으로 튀어나온 검은 선반
    const shade = new THREE.Mesh(new THREE.BoxGeometry(paneW + 0.02, 0.13, 0.03), black);
    shade.position.set(0, -0.065, -0.22);
    f.add(shade);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(paneW + 0.02, 0.03, 0.09), frameMat);
    lip.position.set(0, -0.13, -0.23);
    f.add(lip);
    // 계기판 면 (아래로 갈수록 멀어지게 기울임)
    const panel = new THREE.Group();
    panel.position.set(0, -0.02, -0.52);
    panel.rotation.x = -0.28;
    const face = upright(new THREE.Mesh(new THREE.PlaneGeometry(paneW + 0.02, 0.6), panelGray));
    panel.add(face);
    // 다기능 화면 (네모 CRT/LCD + 베젤 버튼)
    const s = canvasPlane(0.24, 0.24, 256, 256);
    upright(s.mesh);
    s.mesh.position.set(0, -0.022, 0.06); // 베젤(두께 2 cm) 앞
    const bezel = upright(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02), black));
    bezel.position.set(0, -0.004, 0.06);
    panel.add(bezel, s.mesh);
    for (let b = 0; b < 5; b++) {
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.018), frameMat);
      btn.position.set(-0.1 + b * 0.05, -0.016, -0.115);
      panel.add(btn);
    }
    // 아래 줄 작은 스위치
    for (let b = 0; b < 4; b++) {
      const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.03, 8), metal);
      sw.position.set(-0.09 + b * 0.06, -0.025, -0.22);
      panel.add(sw);
    }
    f.add(panel);
    group.add(f);
    screens.push({ kind: SCREEN_KINDS[i], ...s });
  });

  // 착륙 버튼 줄 (사령관 앞 왼쪽 아래): 바퀴 ARM/DN, 감속 낙하산 ARM/DPY, 브레이크
  const buttonPanel = canvasPlane(0.34, 0.09, 512, 136);
  const bp = arcFrame(-30, ARC_R - 0.2, -0.86);
  bp.rotation.x = -0.6;
  upright(buttonPanel.mesh);
  bp.add(buttonPanel.mesh);
  group.add(bp);

  // ── HUD 유리판 (사령관 눈 앞) ────────────────────────────
  const HUD_DIST = 0.62;
  const HUD_W = 0.2;
  const HUD_FOV_DEG = 2 * Math.atan(HUD_W / 2 / HUD_DIST) / DEG; // HUD 가 덮는 시야 (°)
  const hud = canvasPlane(HUD_W, HUD_W * 0.8, 512, 410, true);
  upright(hud.mesh);
  hud.mesh.position.set(0, HUD_DIST, 0.05);
  group.add(hud.mesh);
  const hudFrame = new THREE.Mesh(new THREE.BoxGeometry(HUD_W + 0.02, 0.012, 0.012), frameMat);
  hudFrame.position.set(0, HUD_DIST + 0.01, 0.05 - HUD_W * 0.4 - 0.008);
  const hudPost = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), frameMat);
  hudPost.position.set(0, HUD_DIST + 0.02, 0.05 - HUD_W * 0.4 - 0.06);
  group.add(hudFrame, hudPost);

  // ── 회전 조종간 RHC (다리 사이) ──────────────────────────
  const rhcBase = new THREE.Group();
  rhcBase.position.set(0, 0.42, -0.62);
  group.add(rhcBase);
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.06), frameMat);
  rhcBase.add(pedestal);
  const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.06, 16, 3), black);
  gaiter.rotation.x = Math.PI / 2;
  gaiter.position.z = 0.055;
  rhcBase.add(gaiter);
  const rhc = new THREE.Group();
  rhc.position.z = 0.07;
  rhcBase.add(rhc);
  rhc.add(zRod(0.012, 0.07, 0.035, metal));
  // 권총 손잡이 (앞으로 기울어진 몸통 + 엄지 스위치 + 방아쇠 + 덮개 달린 버튼)
  const gripShape = new THREE.Shape();
  gripShape.moveTo(-0.022, 0);
  gripShape.lineTo(0.026, 0);
  gripShape.quadraticCurveTo(0.036, 0.06, 0.028, 0.12);
  gripShape.quadraticCurveTo(0.0, 0.15, -0.03, 0.125);
  gripShape.quadraticCurveTo(-0.03, 0.06, -0.022, 0);
  const gripGeo = new THREE.ExtrudeGeometry(gripShape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3 });
  gripGeo.translate(0, 0, -0.0225);
  // 모양 x → 앞뒤(Y), 모양 y → 위(Z), 두께 → 좌우(X)
  gripGeo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  const grip = new THREE.Mesh(gripGeo, black);
  grip.position.z = 0.06;
  grip.rotation.x = -0.25; // 손잡이 윗부분이 앞으로 기운 권총 모양
  rhc.add(grip);
  const thumbHat = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 12), metal);
  thumbHat.position.set(0, -0.012, 0.205);
  thumbHat.rotation.x = 0;
  rhc.add(thumbHat);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.008), std(0xd9a62b, { emissive: 0x2a1f00 }));
  trim.position.set(-0.016, 0.008, 0.2);
  rhc.add(trim);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.035), metal);
  trigger.position.set(0, 0.034, 0.13);
  rhc.add(trigger);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 16, Math.PI), metal);
  guard.rotation.set(0, Math.PI / 2, 0);
  guard.position.set(0, 0.03, 0.125);
  rhc.add(guard);

  // ── 왼쪽 에어브레이크/추력 레버 SBTC ─────────────────────
  const sbtc = new THREE.Group();
  sbtc.position.set(-0.46, 0.2, -0.42);
  group.add(sbtc);
  const sbtcBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.08), frameMat);
  sbtc.add(sbtcBox);
  const sbtcSlot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.26, 0.005), black);
  sbtcSlot.position.z = 0.042;
  sbtc.add(sbtcSlot);
  const sbtcLabel = canvasPlane(0.09, 0.28, 96, 300);
  sbtcLabel.ctx.fillStyle = '#d6dde6';
  sbtcLabel.ctx.font = 'bold 22px system-ui, sans-serif';
  sbtcLabel.ctx.textAlign = 'center';
  ['CLOSE', '', '', '', 'OPEN'].forEach((txt, i) => sbtcLabel.ctx.fillText(txt, 48, 290 - i * 66));
  for (let i = 0; i <= 10; i++) sbtcLabel.ctx.fillRect(64, 270 - i * 25, i % 5 === 0 ? 26 : 14, 3);
  sbtcLabel.texture.needsUpdate = true;
  sbtcLabel.mesh.position.set(0, 0, 0.0425);
  sbtc.add(sbtcLabel.mesh);
  const sbtcPivot = new THREE.Group();
  sbtcPivot.position.z = -0.02;
  sbtc.add(sbtcPivot);
  sbtcPivot.add(zRod(0.009, 0.14, 0.09, metal));
  const sbtcHandle = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.05, 6, 12), black);
  sbtcHandle.rotation.z = Math.PI / 2;
  sbtcHandle.position.z = 0.17;
  sbtcPivot.add(sbtcHandle);
  const takeover = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.01), std(0xd33a2c, { emissive: 0x3a0a06 }));
  takeover.position.set(-0.03, 0, 0.17);
  sbtcPivot.add(takeover);

  // ── 가운데 조작대 (두 자리 사이 키패드) ──────────────────
  const consoleGroup = new THREE.Group();
  consoleGroup.position.set(CABIN_X, 0.5, -0.66);
  consoleGroup.rotation.x = -0.5;
  group.add(consoleGroup);
  consoleGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.08), panelGray));
  const keyMat = std(0xd5d9de, { emissive: 0x202225 });
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.02), (r + c) % 7 === 0 ? std(0x3b6fb6, { emissive: 0x0a1a33 }) : keyMat);
      key.position.set(-0.12 + c * 0.06, 0.15 - r * 0.055, 0.045);
      consoleGroup.add(key);
    }
  }

  // ── 머리 위 스위치 패널 (두 장, 앞으로 기울어짐) ──────────
  const toggleGeo = new THREE.CylinderGeometry(0.004, 0.006, 0.03, 8);
  const flagMats = [];
  for (const [x, y, z, rx] of [[CABIN_X, 0.25, 1.02, 0.25], [CABIN_X, -0.35, 1.13, 0.05]]) {
    const oh = new THREE.Group();
    oh.position.set(x, y, z);
    oh.rotation.x = Math.PI + rx; // 앞면이 아래(눈 쪽)
    group.add(oh);
    oh.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.04), panelGray));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 16; c++) {
        const sw = new THREE.Mesh(toggleGeo, metal);
        sw.rotation.x = Math.PI / 2 + (((r * 7 + c * 3) % 3) - 1) * 0.4;
        sw.position.set(-0.7 + c * 0.093, 0.2 - r * 0.1, 0.03);
        oh.add(sw);
      }
      // 상태 표시 깃발 (줄무늬/회색 작은 창)
      const flag = new THREE.MeshBasicMaterial({ color: 0x3a3f46, toneMapped: false });
      flagMats.push(flag);
      const fm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.01), flag);
      fm.position.set(0.76, 0.2 - r * 0.1, 0.025);
      oh.add(fm);
    }
  }

  // ── 왼쪽 벽 차단기 패널 ───────────────────────────────────
  const leftWall = new THREE.Group();
  leftWall.position.set(CABIN_X - 1.68, -0.1, -0.05);
  leftWall.rotation.set(0, Math.PI / 2, 0); // 앞면(+Z)이 오른쪽(눈 쪽)
  group.add(leftWall);
  leftWall.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.03), panelGray));
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 14; c++) {
      const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 8), black);
      cb.rotation.x = Math.PI / 2;
      cb.position.set(-0.45 + c * 0.07, 0.28 - r * 0.1, 0.02);
      leftWall.add(cb);
    }
  }

  // ── 승무원: 사령관(나) · 조종사(오른쪽) · 임무 전문가 2명(뒤) — 모두 의자에 안전띠를 매고 앉아 있다 ──
  const HIP = [0, -0.12, -0.76]; // 사령관 엉덩이 (눈 기준)
  const rel = (p) => [p[0] - HIP[0], p[1] - HIP[1], p[2] - HIP[2]];
  const crewSeat = (x, y) => {
    const seat = createCrewSeat({ color: 0x3b4450 });
    seat.position.set(x, y, HIP[2]);
    group.add(seat);
    return seat;
  };
  const mySeat = createCrewSeat({ color: 0x3b4450, ownSeat: true });
  mySeat.position.set(...HIP);
  group.add(mySeat);
  // 내 몸: 오른손은 회전 조종간, 왼손은 에어브레이크/추력 레버를 잡는다 (장갑은 각 장치에 붙어 함께 움직임)
  const me = createPilotBody({ suit: 'orange', rightHand: rel([0, 0.42, -0.43]), leftHand: rel([-0.46, 0.2, -0.27]) });
  me.position.set(...HIP);
  group.add(me);
  const rightGlove = createGlove('orange');
  rightGlove.position.set(0, -0.03, 0.12);
  rightGlove.rotation.x = -0.25;
  rhc.add(rightGlove);
  const leftGlove = createGlove('orange');
  leftGlove.position.set(0.005, -0.03, 0.17);
  leftGlove.rotation.set(-0.4, 0, -0.3);
  sbtcPivot.add(leftGlove);
  // 조종사 (오른쪽 자리) — 손은 무릎 위
  crewSeat(CABIN_X * 2, HIP[1]);
  const pilot = createAstronaut({ suit: 'orange', name: 'PLT', hands: 'lap' });
  pilot.group.position.set(CABIN_X * 2, HIP[1], HIP[2]);
  group.add(pilot.group);
  // 임무 전문가 2명 (뒤쪽 자리, 고개를 돌려 뒤를 보면 보인다)
  const crew = [pilot];
  for (const [dx, name] of [[-0.42, 'MS1'], [0.42, 'MS2']]) {
    crewSeat(CABIN_X + dx, -1.35);
    const ms = createAstronaut({ suit: 'orange', name, hands: 'lap' });
    ms.group.position.set(CABIN_X + dx, -1.35, HIP[2]);
    group.add(ms.group);
    crew.push(ms);
  }

  // 실내등 (형광등 느낌의 흰빛 + 계기 불빛)
  const lamp = new THREE.PointLight(0xe8eefc, 7, 5, 2);
  lamp.position.set(CABIN_X, -0.3, 0.8);
  const glow = new THREE.PointLight(0x6fb6ff, 1.5, 2, 2);
  glow.position.set(CABIN_X, 0.7, -0.4);
  group.add(lamp, glow);

  // ── 화면 그리기 ───────────────────────────────────────────
  const GREEN = '#57f28c';
  const CYAN = '#5fd6ff';
  const MAGENTA = '#ff6bd6';
  const AMBER = '#ffb547';

  function clear(ctx) {
    ctx.fillStyle = '#030806';
    ctx.fillRect(0, 0, 256, 256);
  }
  function title(ctx, text) {
    ctx.fillStyle = CYAN;
    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(text, 8, 18);
  }
  function rows(ctx, list, y0 = 44) {
    ctx.font = '17px ui-monospace, Menlo, monospace';
    list.forEach(([k, v, color], i) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(170, 230, 200, 0.8)';
      ctx.fillText(k, 10, y0 + i * 26);
      ctx.textAlign = 'right';
      ctx.fillStyle = color ?? GREEN;
      ctx.fillText(v, 246, y0 + i * 26);
    });
  }

  /** 자세 지시기 (ADI 공) + 받음각·속도·고도 띠 */
  function drawPfd(ctx, vehicle, t) {
    clear(ctx);
    const q = new THREE.Quaternion(...vehicle.orientation);
    const up = new THREE.Vector3(...vehicle.position).normalize().applyQuaternion(q.clone().invert()); // 기체 좌표의 위
    const pitch = Math.asin(Math.max(-1, Math.min(1, up.y))) / DEG; // 기수 고각
    const roll = Math.atan2(up.x, up.z); // 오른쪽 날개가 내려가면 +
    ctx.save();
    ctx.beginPath();
    ctx.arc(128, 128, 78, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(128, 128);
    ctx.rotate(roll);
    const pxPerDeg = 2.2;
    ctx.fillStyle = '#2d6fb3'; // 하늘
    ctx.fillRect(-150, -300, 300, 300 + pitch * pxPerDeg);
    ctx.fillStyle = '#7a4a24'; // 땅
    ctx.fillRect(-150, pitch * pxPerDeg, 300, 300);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-150, pitch * pxPerDeg);
    ctx.lineTo(150, pitch * pxPerDeg);
    ctx.stroke();
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#fff';
    for (let k = -90; k <= 90; k += 10) {
      if (k === 0) continue;
      const y = (pitch - k) * pxPerDeg;
      if (Math.abs(y) > 90) continue;
      ctx.beginPath();
      ctx.moveTo(-22, y);
      ctx.lineTo(22, y);
      ctx.stroke();
      ctx.fillText(String(k), 26, y + 4);
    }
    ctx.restore();
    // 기체 표지
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(92, 128);
    ctx.lineTo(116, 128);
    ctx.lineTo(128, 138);
    ctx.lineTo(140, 128);
    ctx.lineTo(164, 128);
    ctx.stroke();
    ctx.strokeStyle = '#8b96a5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(128, 128, 79, 0, Math.PI * 2);
    ctx.stroke();
    // 띠: 왼쪽 속도, 오른쪽 고도, 아래 받음각
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(4, 108, 46, 40);
    ctx.fillRect(206, 108, 46, 40);
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = GREEN;
    ctx.fillText(formatNumber(t.speed, 0), 27, 133);
    ctx.fillText(t.altitude > 9999 ? `${formatNumber(t.altitude / 1000, 0)}k` : formatNumber(t.altitude, 0), 229, 133);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = CYAN;
    ctx.fillText('M/S', 27, 104);
    ctx.fillText('ALT', 229, 104);
    const sh = t.shuttle;
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = GREEN;
    ctx.fillText(`α ${formatNumber(sh?.alphaDeg ?? t.angleOfAttackDeg, 1)}°   H↕ ${formatNumber(t.verticalSpeed, 0)}`, 128, 232);
    ctx.fillStyle = CYAN;
    ctx.fillText(`G ${formatNumber(t.gForce, 1)}   q ${formatNumber((t.dynamicPressure ?? 0) / 1000, 1)}k`, 128, 250);
    title(ctx, 'ADI');
  }

  /** 수평 상황 지시기: 활주로 방향·거리 */
  function drawHsi(ctx, vehicle, t) {
    clear(ctx);
    title(ctx, 'HSI');
    const sh = t.shuttle;
    const heading = t.headingDeg ?? 90;
    ctx.save();
    ctx.translate(128, 136);
    ctx.strokeStyle = '#8b96a5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(-heading * DEG);
    ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (let d = 0; d < 360; d += 30) {
      ctx.save();
      ctx.rotate(d * DEG);
      ctx.fillStyle = d % 90 === 0 ? '#fff' : '#9aa6b5';
      ctx.fillRect(-1, -86, 2, 10);
      ctx.fillText(d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10), 0, -64);
      ctx.restore();
    }
    if (sh) {
      // 활주로 시작점 방향 (자홍색 화살표)
      ctx.rotate(sh.bearingDeg * DEG);
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 50);
      ctx.lineTo(0, -50);
      ctx.moveTo(-10, -38);
      ctx.lineTo(0, -52);
      ctx.lineTo(10, -38);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.moveTo(128, 120);
    ctx.lineTo(120, 146);
    ctx.lineTo(136, 146);
    ctx.fill();
    ctx.font = 'bold 15px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = GREEN;
    ctx.fillText(`HDG ${formatNumber(heading, 0)}`, 8, 40);
    if (sh) {
      ctx.textAlign = 'right';
      ctx.fillStyle = MAGENTA;
      const d = sh.distanceToThreshold;
      ctx.fillText(d > 9999 ? `${formatNumber(d / 1000, 0)} km` : `${formatNumber(d / 1000, 1)} km`, 248, 40);
      ctx.fillText(`RWY 09`, 248, 248);
    }
  }

  /** 접근: 활공각·옆 벗어남·에너지 */
  function drawApproach(ctx, vehicle, t) {
    clear(ctx);
    title(ctx, 'APPROACH');
    const sh = t.shuttle;
    if (!sh) {
      rows(ctx, [['상승', '—'], ['원지점', `${formatNumber(t.apoapsisAltitude / 1000, 0)} km`], ['근지점', `${formatNumber(t.periapsisAltitude / 1000, 0)} km`]]);
      return;
    }
    const gs = sh.glideSlopeDeg;
    rows(ctx, [
      ['활공각', `${formatNumber(gs, 1)}°`, Math.abs(gs - 18) < 3 ? GREEN : AMBER],
      ['옆 벗어남', `${formatNumber(sh.runwayCross, 0)} m`, Math.abs(sh.runwayCross) < 100 ? GREEN : AMBER],
      ['뱅크', `${formatNumber(sh.bankDeg, 0)}°`],
      ['에어브레이크', `${formatNumber(sh.speedbrake * 100, 0)} %`],
    ]);
    // 활공각 막대 (18° 기준)
    ctx.strokeStyle = '#8b96a5';
    ctx.strokeRect(226, 160, 16, 86);
    ctx.fillStyle = MAGENTA;
    const y = 203 - Math.max(-40, Math.min(40, (gs - 18) * 6));
    ctx.fillRect(222, y - 3, 24, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(220, 202, 28, 2);
    // 옆 벗어남 막대
    ctx.strokeRect(20, 220, 180, 16);
    ctx.fillStyle = MAGENTA;
    const x = 110 + Math.max(-86, Math.min(86, -sh.runwayCross / 20));
    ctx.fillRect(x - 3, 216, 6, 24);
    ctx.fillStyle = '#fff';
    ctx.fillRect(109, 214, 2, 28);
  }

  /** 시스템: 연료·단·바퀴·브레이크·낙하산 */
  function drawSystems(ctx, vehicle, t) {
    clear(ctx);
    title(ctx, 'SYSTEMS');
    const sh = t.shuttle;
    const stageName = ['고체부스터+주엔진', '주엔진 (외부탱크)', '궤도선 OMS'][vehicle.currentStage] ?? '—';
    rows(ctx, [
      ['단', stageName, CYAN],
      ['연료', `${formatNumber(t.fuelRatio * 100, 0)} %`, t.fuelRatio < 0.1 ? AMBER : GREEN],
      ['Δv', `${formatNumber(t.deltaVTotal, 0)} m/s`],
      ['바퀴', sh?.gearDown ? 'DOWN' : 'UP', sh?.gearDown ? GREEN : '#9aa6b5'],
      ['브레이크', sh?.brakes ? 'ON' : 'OFF', sh?.brakes ? AMBER : '#9aa6b5'],
      ['타일 온도', `${formatNumber(t.skinTemperature ?? 0, 0)} K`, Number.isFinite(t.thermalLimit) && t.skinTemperature > 0.8 * t.thermalLimit ? AMBER : GREEN],
    ], 42);
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(170, 230, 200, 0.8)';
    ctx.fillText(`T+ ${formatNumber(t.missionTime, 0)} s`, 10, 246);
  }

  function drawButtons(t) {
    const { ctx, texture } = buttonPanel;
    const sh = t.shuttle;
    ctx.fillStyle = '#4a5058';
    ctx.fillRect(0, 0, 512, 136);
    const items = [
      ['GEAR', 'ARM', Boolean(sh && t.altitude < 3000 && !sh.gearDown), '#ffd43b'],
      ['GEAR', 'DN', Boolean(sh?.gearDown), '#3ddc84'],
      ['CHUTE', 'ARM', Boolean(sh?.gearDown && t.parachute?.state === 'packed'), '#ffd43b'],
      ['CHUTE', 'DPY', t.parachute?.state === 'deployed', '#3ddc84'],
      ['BRAKE', 'ON', Boolean(sh?.brakes), '#ff8a3d'],
    ];
    items.forEach(([top, bottom, on, color], i) => {
      const x = 8 + i * 101;
      ctx.fillStyle = on ? color : '#1c2026';
      ctx.fillRect(x, 10, 92, 116);
      ctx.strokeStyle = '#11151a';
      ctx.lineWidth = 4;
      ctx.strokeRect(x, 10, 92, 116);
      ctx.fillStyle = on ? '#111' : '#69737f';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(top, x + 46, 58);
      ctx.fillText(bottom, x + 46, 98);
    });
    texture.needsUpdate = true;
  }

  /** HUD: 비행 경로 표지(진행 방향), 수평선, 피치 사다리, 속도·고도 */
  function drawHud(vehicle, t) {
    const { ctx, canvas, texture } = hud;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const pxPerRad = W / (HUD_FOV_DEG * DEG);
    const q = new THREE.Quaternion(...vehicle.orientation).invert();
    const up = new THREE.Vector3(...vehicle.position).normalize().applyQuaternion(q);
    const toScreen = (bx, by, bz) => [W / 2 + Math.atan2(bx, by) * pxPerRad, H / 2 - Math.atan2(bz, by) * pxPerRad];
    ctx.strokeStyle = '#59ff8f';
    ctx.fillStyle = '#59ff8f';
    ctx.lineWidth = 3;
    // 수평선·피치 사다리: 기체 좌표에서 고도각 k 인 방향들의 화면 선
    const roll = Math.atan2(up.x, up.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, up.y)));
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(roll);
    ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
    for (let k = -30; k <= 30; k += 5) {
      const y = (pitch - k * DEG) * pxPerRad;
      if (Math.abs(y) > H * 0.7) continue;
      const w = k === 0 ? W : 120;
      ctx.setLineDash(k < 0 ? [12, 10] : []);
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(-30, y);
      ctx.moveTo(30, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
      if (k !== 0) ctx.fillText(String(k), w / 2 + 6, y + 8);
    }
    ctx.setLineDash([]);
    ctx.restore();
    // 비행 경로 표지 (진행 방향)
    const v = new THREE.Vector3(...vehicle.velocity);
    if (v.length() > 5) {
      v.applyQuaternion(q);
      if (v.y > 0) {
        const [x, y] = toScreen(v.x, v.y, v.z);
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.moveTo(x - 34, y);
        ctx.lineTo(x - 14, y);
        ctx.moveTo(x + 14, y);
        ctx.lineTo(x + 34, y);
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x, y - 28);
        ctx.stroke();
      }
    }
    // 기체 기준 (가운데 작은 W)
    ctx.beginPath();
    ctx.moveTo(W / 2 - 24, H / 2);
    ctx.lineTo(W / 2 - 10, H / 2);
    ctx.lineTo(W / 2, H / 2 + 10);
    ctx.lineTo(W / 2 + 10, H / 2);
    ctx.lineTo(W / 2 + 24, H / 2);
    ctx.stroke();
    // 글자
    ctx.font = 'bold 26px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${formatNumber(t.speed, 0)}`, 12, H / 2 + 8);
    ctx.textAlign = 'right';
    ctx.fillText(t.altitude > 9999 ? `${formatNumber(t.altitude / 1000, 1)}K` : `${formatNumber(t.altitude, 0)}`, W - 12, H / 2 + 8);
    ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    const sh = t.shuttle;
    if (sh) {
      ctx.fillText(`α ${formatNumber(sh.alphaDeg, 0)}`, 12, 30);
      ctx.textAlign = 'right';
      ctx.fillText(sh.gearDown ? 'GEAR DN' : '', W - 12, 30);
      ctx.fillText(sh.speedbrake > 0.05 ? `SB ${formatNumber(sh.speedbrake * 100, 0)}` : '', W - 12, H - 14);
      ctx.textAlign = 'left';
      ctx.fillText(`${formatNumber(sh.distanceToThreshold / 1000, 1)} KM`, 12, H - 14);
    } else {
      ctx.fillText(`G ${formatNumber(t.gForce, 1)}`, 12, 30);
    }
    texture.needsUpdate = true;
  }

  const DRAW = { pfd: drawPfd, hsi: drawHsi, approach: drawApproach, systems: drawSystems };
  const control = { pitch: 0, yaw: 0, roll: 0, lever: 0 };
  const approachTo = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  let lastScreens = -1;
  let lastHud = -1;
  let buttonKey = '';

  return {
    group,
    update(visible, eye, vehicle, t, time, dt) {
      group.visible = visible;
      if (!visible) return;
      group.position.copy(eye);
      const o = vehicle.orientation;
      group.quaternion.set(o[0], o[1], o[2], o[3]);

      for (const member of crew) member.update(time);
      const c = vehicle.controls ?? {};
      control.pitch = approachTo(control.pitch, c.pitch ?? 0, 12, dt);
      control.yaw = approachTo(control.yaw, c.yaw ?? 0, 12, dt);
      control.roll = approachTo(control.roll, c.roll ?? 0, 12, dt);
      // 조종간: 당기면(기수 올리기) 뒤로, 굴림은 좌우로, 빗놀이는 비틀기
      rhc.rotation.set(-control.pitch * 0.3, control.yaw * 0.3, -control.roll * 0.4);
      // 레버: 궤도선만이면 에어브레이크, 아니면 스로틀
      const leverTarget = t.shuttle?.winged ? t.shuttle.speedbrake : vehicle.throttle ?? 0;
      control.lever = approachTo(control.lever, leverTarget, 8, dt);
      sbtcPivot.rotation.x = -(control.lever * 70 - 35) * DEG;

      if (time - lastHud > 0.05) {
        lastHud = time;
        drawHud(vehicle, t);
      }
      const key = [t.shuttle?.gearDown, t.shuttle?.brakes, t.parachute?.state, t.altitude < 3000].join();
      if (key !== buttonKey) {
        buttonKey = key;
        drawButtons(t);
      }
      flagMats.forEach((m, i) => m.color.setHex((i + Math.floor(time / 4)) % 3 === 0 ? 0xd8d8d8 : 0x3a3f46));
      if (time - lastScreens < 0.2) return;
      lastScreens = time;
      for (const s of screens) {
        DRAW[s.kind](s.ctx, vehicle, t);
        s.texture.needsUpdate = true;
      }
    },
  };
}
