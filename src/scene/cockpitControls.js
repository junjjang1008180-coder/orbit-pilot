/**
 * 조종석 조종 장치·패널 (1인칭 실내 세부) — 시각 효과 전용
 * ------------------------------------------------------------
 * cockpitView 의 실내 그룹(원점 = 눈, +Y 앞, +Z 위, +X 오른쪽)에 붙는 부품들:
 *   - 조종간(오른쪽): W/S 로 앞뒤, A/D 로 좌우로 기울고, Q/E 로 비틀린다 (실제 조종 입력을 따라 움직임)
 *   - 스로틀 레버(왼쪽): 스로틀 0~100% 만큼 앞으로 밀린다, 눈금·손잡이
 *   - 머리 위 스위치 패널: 자세 보조·RCS·자동 비행·낙하산·지도·조명 스위치가 상태에 따라 젖혀지고 불이 켜짐
 *   - 계기판 표시등 줄(상태 글자), 마스터 경고등(경고가 있으면 깜빡임), 경과 시간 시계
 *   - 승무원 의자 3개와 흰 비행복 우주비행사(양옆 2명), 조종간·스로틀을 쥔 내 손·몸 (crew.js)
 *   - 옆 벽 차단기 패널·명판, 천장 배선
 * 물리 상태는 읽기만 한다.
 */
import * as THREE from 'three';
import { createCrewSeat, createAstronaut, createPilotBody, createGlove } from './crew.js';

/** 캔버스 글자판 (평면은 +Z 를 향한다) */
function canvasPlane(width, height, pxW, pxH) {
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true }));
  return { mesh, ctx: canvas.getContext('2d'), canvas, texture };
}

/** 면(로컬 +Z)이 방향 dir 을 향하도록 돌린 그룹 */
function facing(dir, up = new THREE.Vector3(0, 0, 1)) {
  const g = new THREE.Group();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...dir).negate(), up);
  g.quaternion.setFromRotationMatrix(m);
  return g;
}

/**
 * @param {THREE.Group} cabin 실내 그룹
 * @param {{metal:THREE.Material, darkMetal:THREE.Material, padMat:THREE.Material}} mats
 */
export function createCockpitControls(cabin, { metal, darkMetal, padMat }) {
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, emissive: 0x050506 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 1, emissive: 0x040405 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd33a2c, roughness: 0.45, emissive: 0x3a0a06 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, emissive: 0x2a1f00 });

  // ── 조종간 (오른쪽): 권총형 손잡이 + 주름 고무 덮개 + 방아쇠·덮개·트림 스위치 ──
  const stickBase = new THREE.Group();
  stickBase.position.set(0.3, 0.36, -0.44);
  cabin.add(stickBase);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.018), darkMetal);
  plate.position.z = -0.002;
  stickBase.add(plate);
  for (let i = 0; i < 4; i++) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), metal);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(i % 2 ? 0.062 : -0.062, i < 2 ? 0.062 : -0.062, 0.008);
    stickBase.add(screw);
  }
  // 축 방향 표시 (PITCH ↕ · ROLL ↔)
  const stickLabel = canvasPlane(0.14, 0.14, 256, 256);
  stickLabel.ctx.strokeStyle = '#cfd6de';
  stickLabel.ctx.lineWidth = 6;
  stickLabel.ctx.beginPath();
  stickLabel.ctx.arc(128, 128, 92, 0, Math.PI * 2);
  stickLabel.ctx.stroke();
  stickLabel.ctx.fillStyle = '#cfd6de';
  stickLabel.ctx.font = 'bold 26px system-ui, sans-serif';
  stickLabel.ctx.textAlign = 'center';
  stickLabel.ctx.fillText('PITCH', 128, 30);
  stickLabel.ctx.fillText('ROLL', 222, 136);
  stickLabel.ctx.fillText('ROLL', 34, 136);
  stickLabel.ctx.fillText('PITCH', 128, 246);
  stickLabel.texture.needsUpdate = true;
  stickLabel.mesh.position.z = 0.0075;
  stickBase.add(stickLabel.mesh);
  // 주름 고무 덮개 (위로 갈수록 가늘어지는 고리 여러 개)
  for (let i = 0; i < 6; i++) {
    const r = 0.045 - i * 0.0045;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 24), rubber);
    ring.position.z = 0.012 + i * 0.011;
    stickBase.add(ring);
  }
  const stickPivot = new THREE.Group(); // 이 그룹이 입력에 따라 기운다
  stickPivot.position.z = 0.03;
  stickBase.add(stickPivot);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.09, 12), metal);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.045;
  stickPivot.add(shaft);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), darkMetal);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.09;
  stickPivot.add(collar);
  // 권총형 손잡이: 옆모습(앞뒤 × 높이)을 두께만큼 밀어 만든다 — 손가락 홈 3개, 위가 앞으로 휜다
  const gs = new THREE.Shape();
  gs.moveTo(-0.022, 0);
  gs.lineTo(0.02, 0);
  gs.quadraticCurveTo(0.028, 0.012, 0.022, 0.024);
  gs.quadraticCurveTo(0.03, 0.036, 0.024, 0.048);
  gs.quadraticCurveTo(0.032, 0.06, 0.027, 0.072);
  gs.quadraticCurveTo(0.036, 0.096, 0.03, 0.112);
  gs.quadraticCurveTo(0.012, 0.128, -0.02, 0.118);
  gs.quadraticCurveTo(-0.036, 0.08, -0.03, 0.04);
  gs.quadraticCurveTo(-0.028, 0.012, -0.022, 0);
  const gripGeo = new THREE.ExtrudeGeometry(gs, { depth: 0.038, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.007, bevelSegments: 3, curveSegments: 10 });
  gripGeo.translate(0, 0, -0.019);
  gripGeo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  const grip = new THREE.Mesh(gripGeo, black);
  grip.position.z = 0.095;
  grip.rotation.x = -0.18;
  stickPivot.add(grip);
  const gripTop = new THREE.Group(); // 손잡이 머리 (스위치들)
  gripTop.position.set(0, 0.02, 0.215);
  gripTop.rotation.x = -0.18;
  stickPivot.add(gripTop);
  // 4방향 트림 스위치 (작은 십자 모자)
  const hatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.006, 14), darkMetal);
  hatBase.rotation.x = Math.PI / 2;
  hatBase.position.set(-0.006, -0.004, 0);
  gripTop.add(hatBase);
  for (const [w, h] of [[0.016, 0.005], [0.005, 0.016]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.006), metal);
    arm.position.set(-0.006, -0.004, 0.005);
    gripTop.add(arm);
  }
  // 덮개 달린 빨간 단추 (엄지)
  const redBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), red);
  redBtn.rotation.x = Math.PI / 2;
  redBtn.position.set(0.012, 0.01, -0.002);
  gripTop.add(redBtn);
  const btnGuard = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0018, 6, 16, Math.PI * 1.3), metal);
  btnGuard.position.set(0.012, 0.01, 0.002);
  gripTop.add(btnGuard);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.008), yellow); // 노란 엄지 단추
  thumb.position.set(-0.024, -0.016, -0.012);
  gripTop.add(thumb);
  // 방아쇠 + 방아쇠 울
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.008, 0.028), metal);
  trigger.position.set(0, 0.04, 0.165);
  trigger.rotation.x = 0.35;
  stickPivot.add(trigger);
  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0025, 6, 18, Math.PI), darkMetal);
  triggerGuard.rotation.set(0, Math.PI / 2, Math.PI / 2);
  triggerGuard.position.set(0, 0.035, 0.155);
  stickPivot.add(triggerGuard);

  // ── 스로틀 레버 (왼쪽): 호 모양 눈금판 + 멈춤 홈 + T 자 손잡이 + 마찰 잠금 ──
  const quadrant = new THREE.Group();
  quadrant.position.set(-0.3, 0.36, -0.44);
  cabin.add(quadrant);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.06), darkMetal);
  housing.position.z = 0.015;
  quadrant.add(housing);
  // 옆 눈금판 (레버가 도는 호를 따라 눈금)
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.25, 0.03), black);
    cheek.position.set(side * 0.05, 0, 0.05);
    quadrant.add(cheek);
  }
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.22, 0.005), black);
  slot.position.z = 0.046;
  quadrant.add(slot);
  // 멈춤 홈: 0 %(끄기)와 100 % 에서 레버가 걸린다 (빨간 띠)
  for (const y of [-0.105, 0.105]) {
    const detent = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), red);
    detent.position.set(0, y, 0.047);
    quadrant.add(detent);
  }
  const thrLabel = canvasPlane(0.085, 0.24, 128, 360);
  thrLabel.ctx.fillStyle = '#d9e1ea';
  thrLabel.ctx.font = 'bold 22px system-ui, sans-serif';
  thrLabel.ctx.textAlign = 'right';
  ['끄기', '25', '50', '75', '최대'].forEach((txt, i) => thrLabel.ctx.fillText(txt, 54, 350 - i * 82));
  for (let i = 0; i <= 20; i++) thrLabel.ctx.fillRect(66, 340 - i * 16.4, i % 5 === 0 ? 30 : 16, 3);
  thrLabel.ctx.font = 'bold 24px system-ui, sans-serif';
  thrLabel.ctx.textAlign = 'center';
  thrLabel.texture.needsUpdate = true;
  thrLabel.mesh.position.set(0.004, 0, 0.0465);
  quadrant.add(thrLabel.mesh);
  const leverPivot = new THREE.Group();
  leverPivot.position.set(0, 0, -0.03);
  quadrant.add(leverPivot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.17), metal);
  arm.position.z = 0.085;
  leverPivot.add(arm);
  // T 자 손잡이 (가로 막대 + 고무 감은 끝)
  const tBar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.085, 16), black);
  tBar.rotation.z = Math.PI / 2;
  tBar.position.z = 0.175;
  leverPivot.add(tBar);
  for (const side of [-1, 1]) {
    const endCap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), red);
    endCap.position.set(side * 0.045, 0, 0.175);
    leverPivot.add(endCap);
  }
  const knobCap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.01), yellow); // 엔진 차단 단추
  knobCap.position.set(0, 0, 0.192);
  leverPivot.add(knobCap);
  // 마찰 잠금 손잡이 (옆)
  const friction = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 14), metal);
  friction.rotation.z = Math.PI / 2;
  friction.position.set(0.062, -0.08, -0.01);
  quadrant.add(friction);
  const frictionLabel = canvasPlane(0.07, 0.025, 160, 56);
  frictionLabel.ctx.fillStyle = '#d9e1ea';
  frictionLabel.ctx.font = 'bold 30px system-ui, sans-serif';
  frictionLabel.ctx.textAlign = 'center';
  frictionLabel.ctx.fillText('추력', 80, 40);
  frictionLabel.texture.needsUpdate = true;
  frictionLabel.mesh.position.set(0, -0.145, 0.046);
  quadrant.add(frictionLabel.mesh);

  // ── 승무원: 나(가운데) + 양옆 승무원 2명 — 의자에 안전띠를 매고 앉아 있다 ──
  const HIP = [0, -0.15, -0.78]; // 내 엉덩이 (눈 기준)
  const rel = (p) => [p[0] - HIP[0], p[1] - HIP[1], p[2] - HIP[2]];
  const mySeat = createCrewSeat({ color: 0x39424e, recline: 0.15, ownSeat: true });
  mySeat.position.set(...HIP);
  cabin.add(mySeat);
  const me = createPilotBody({ suit: 'white', rightHand: rel([0.3, 0.35, -0.26]), leftHand: rel([-0.3, 0.36, -0.29]), recline: 0.15 });
  me.position.set(...HIP);
  cabin.add(me);
  const rightGlove = createGlove('white'); // 조종간을 쥔 오른손 (조종간과 함께 기운다)
  rightGlove.position.set(0, -0.035, 0.15);
  rightGlove.rotation.x = -0.2;
  stickPivot.add(rightGlove);
  const leftGlove = createGlove('white'); // 스로틀 T 자 손잡이를 쥔 왼손
  leftGlove.position.set(0.01, -0.03, 0.17);
  leftGlove.rotation.set(-0.5, 0, 0.2);
  leverPivot.add(leftGlove);
  const crew = [];
  for (const [x, name] of [[-0.98, 'CM2'], [0.98, 'CM3']]) {
    const seat = createCrewSeat({ color: 0x39424e, recline: 0.15 });
    seat.position.set(x, HIP[1] - 0.1, HIP[2]);
    seat.rotation.z = -Math.sign(x) * 0.12; // 가운데 쪽으로 살짝 돌려 앉음
    cabin.add(seat);
    const astro = createAstronaut({ suit: 'white', name, hands: x < 0 ? 'lap' : 'panel', recline: 0.15 });
    astro.group.position.copy(seat.position);
    astro.group.rotation.z = seat.rotation.z;
    cabin.add(astro.group);
    crew.push(astro);
  }

  // ── 머리 위 스위치 패널 ─────────────────────────────────
  const overhead = facing([0, -0.62, -0.78]);
  overhead.position.set(0, 0.48, 0.64);
  cabin.add(overhead);
  const ohPanel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.34, 0.03), darkMetal);
  overhead.add(ohPanel);
  const ohTrim = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.36, 0.01), metal);
  ohTrim.position.z = -0.016;
  overhead.add(ohTrim);
  const SWITCHES = ['자세보조', 'RCS', '자동비행', '낙하산', '지도', '실내등'];
  const switchGeoBase = new THREE.CylinderGeometry(0.014, 0.016, 0.012, 6);
  const switchGeoBat = new THREE.CylinderGeometry(0.0045, 0.006, 0.04, 10);
  const lampGeo = new THREE.SphereGeometry(0.009, 12, 8);
  const toggles = SWITCHES.map((name, i) => {
    const x = -0.4 + i * 0.16;
    const base = new THREE.Mesh(switchGeoBase, metal);
    base.rotation.x = Math.PI / 2;
    base.position.set(x, 0.03, 0.02);
    overhead.add(base);
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.03, 0.026);
    overhead.add(pivot);
    const bat = new THREE.Mesh(switchGeoBat, metal);
    bat.rotation.x = Math.PI / 2;
    bat.position.z = 0.02;
    pivot.add(bat);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x1a2a1f, toneMapped: false });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x, 0.1, 0.02);
    overhead.add(lamp);
    return { name, pivot, lampMat, angle: -0.4 };
  });
  // 스위치 이름표 줄
  const ohLabels = canvasPlane(1.0, 0.06, 1024, 64);
  ohLabels.ctx.fillStyle = '#e3e9f0';
  ohLabels.ctx.font = 'bold 26px system-ui, sans-serif';
  ohLabels.ctx.textAlign = 'center';
  SWITCHES.forEach((name, i) => ohLabels.ctx.fillText(name, 512 + (-0.4 + i * 0.16) * 1024, 42));
  ohLabels.texture.needsUpdate = true;
  ohLabels.mesh.position.set(0, -0.045, 0.017);
  overhead.add(ohLabels.mesh);
  // 아래 줄: 회로 차단기 (작은 검은 단추 12개)
  for (let i = 0; i < 12; i++) {
    const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 10), black);
    cb.rotation.x = Math.PI / 2;
    cb.position.set(-0.44 + i * 0.08, -0.11, 0.02);
    overhead.add(cb);
  }

  // ── 계기판 위 표시등 줄 + 마스터 경고등 + 시계 (계기판 그룹은 cockpitView 가 넘겨줌) ──
  const annunciator = canvasPlane(1.5, 0.045, 1536, 46);

  // ── 옆 벽: 왼쪽 차단기 패널, 오른쪽 명판 ─────────────────
  const leftPanel = facing([1, 0, 0]);
  leftPanel.position.set(-1.53, 0.25, 0.05);
  cabin.add(leftPanel);
  leftPanel.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.03), darkMetal));
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), (r + c) % 5 === 0 ? yellow : black);
      b.rotation.x = Math.PI / 2;
      b.position.set(-0.22 + c * 0.088, 0.15 - r * 0.1, 0.022);
      leftPanel.add(b);
    }
  }
  const plaque = canvasPlane(0.5, 0.18, 512, 184);
  plaque.ctx.fillStyle = '#1b2430';
  plaque.ctx.fillRect(0, 0, 512, 184);
  plaque.ctx.strokeStyle = '#c9a54a';
  plaque.ctx.lineWidth = 6;
  plaque.ctx.strokeRect(6, 6, 500, 172);
  plaque.ctx.fillStyle = '#e8d9a8';
  plaque.ctx.textAlign = 'center';
  plaque.ctx.font = 'bold 44px system-ui, sans-serif';
  plaque.ctx.fillText('ORBIT PILOT', 256, 78);
  plaque.ctx.font = '28px system-ui, sans-serif';
  plaque.ctx.fillText('유인 캡슐 1호 · 승무원 3명', 256, 130);
  plaque.texture.needsUpdate = true;
  const rightPanel = facing([-1, 0, 0]);
  rightPanel.position.set(-0.0 + 1.53, 0.25, 0.1);
  rightPanel.add(plaque.mesh);
  cabin.add(rightPanel);

  // ── 천장 배선 (벽 모서리를 따라 휘어진 굵은 선 세 가닥) ───
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.7, emissive: 0x08090b });
  const cableColors = [cableMat, new THREE.MeshStandardMaterial({ color: 0x8c2f2a, roughness: 0.7, emissive: 0x160605 }), cableMat];
  [-1, 1].forEach((side) => {
    cableColors.forEach((mat, k) => {
      const x = side * (1.45 - k * 0.04);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, -0.9, 0.9 - k * 0.03),
        new THREE.Vector3(x, -0.2, 0.98 - k * 0.03),
        new THREE.Vector3(x - side * 0.1, 0.5, 0.92 - k * 0.03),
        new THREE.Vector3(x - side * 0.25, 0.85, 0.75 - k * 0.03),
      ]);
      cabin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 6, false), mat));
    });
  });

  // ── 움직임 ─────────────────────────────────────────────
  const stick = { pitch: 0, yaw: 0, roll: 0, throttle: 0 };
  let annunciatorKey = '';
  const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

  function drawAnnunciator(items) {
    const { ctx, canvas, texture } = annunciator;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cell = canvas.width / items.length;
    items.forEach(({ text, on, color }, i) => {
      const x = i * cell + 6;
      ctx.fillStyle = on ? color : '#1a1f26';
      ctx.fillRect(x, 4, cell - 12, canvas.height - 8);
      ctx.strokeStyle = '#3a4350';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 4, cell - 12, canvas.height - 8);
      ctx.fillStyle = on ? '#111' : '#5b6675';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, x + (cell - 12) / 2, 33);
    });
    texture.needsUpdate = true;
  }

  return {
    /** 계기판 그룹에 표시등 줄·경고등·시계를 붙인다 */
    attachToDash(dash) {
      annunciator.mesh.position.set(0, 0.19, 0.05);
      dash.add(annunciator.mesh);
      // 마스터 경고등 (왼쪽 끝): 테두리 + 빨간 단추
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.025), black);
      bezel.position.set(-0.88, 0.05, 0.045);
      dash.add(bezel);
      const cautionMat = new THREE.MeshBasicMaterial({ color: 0x3a0d0a, toneMapped: false });
      const caution = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), cautionMat);
      caution.position.set(-0.88, 0.05, 0.06);
      dash.add(caution);
      const cautionLabel = canvasPlane(0.1, 0.03, 160, 48);
      cautionLabel.ctx.fillStyle = '#ffe0dc';
      cautionLabel.ctx.font = 'bold 30px system-ui, sans-serif';
      cautionLabel.ctx.textAlign = 'center';
      cautionLabel.ctx.fillText('주의', 80, 34);
      cautionLabel.texture.needsUpdate = true;
      cautionLabel.mesh.position.set(-0.88, 0.05, 0.071);
      dash.add(cautionLabel.mesh);
      // 경과 시간 시계 (오른쪽 끝)
      const clock = canvasPlane(0.13, 0.13, 160, 160);
      clock.mesh.position.set(0.88, 0.05, 0.06);
      const clockBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.02, 32), metal);
      clockBezel.rotation.x = Math.PI / 2;
      clockBezel.position.set(0.88, 0.05, 0.045);
      dash.add(clockBezel, clock.mesh);
      this.cautionMat = cautionMat;
      this.clock = clock;
    },

    /**
     * @param {object} vehicle 조종 중인 비행체 상태 (controls, throttle, rcsEnabled, autopilot, parachute)
     * @param {object} t 텔레메트리
     * @param {number} time 화면 시각 (s)
     * @param {number} dt 화면 프레임 시간 (s)
     */
    update(vehicle, t, time, dt) {
      for (const member of crew) member.update(time);
      const c = vehicle.controls ?? {};
      stick.pitch = approach(stick.pitch, c.pitch ?? 0, 12, dt);
      stick.yaw = approach(stick.yaw, c.yaw ?? 0, 12, dt);
      stick.roll = approach(stick.roll, c.roll ?? 0, 12, dt);
      stick.throttle = approach(stick.throttle, vehicle.throttle ?? 0, 10, dt);
      // 조종간: S(기수 올리기) = 당김, W = 밂 · D = 오른쪽 · E(시계) = 비틀기
      stickPivot.rotation.set(stick.pitch * 0.35, stick.yaw * 0.35, -stick.roll * 0.5);
      // 스로틀: 0% = 뒤로 35°, 100% = 앞으로 35°
      leverPivot.rotation.x = -(stick.throttle * 70 - 35) * (Math.PI / 180);

      // 머리 위 스위치: 켜지면 앞으로 젖혀지고 초록 불
      const states = [t.autopilot.sas !== 'off', t.rcsEnabled, Boolean(t.autopilot.program), t.parachute?.state === 'deployed', document.body.dataset.view === 'map', true];
      toggles.forEach((s, i) => {
        s.angle = approach(s.angle, states[i] ? 0.45 : -0.45, 14, dt);
        s.pivot.rotation.x = s.angle;
        s.lampMat.color.setHex(states[i] ? 0x3ddc84 : 0x1a2a1f);
      });

      // 마스터 경고등: 경고가 있으면 깜빡임
      const danger = t.warnings?.some((w) => w.level === 'danger');
      if (this.cautionMat) {
        const blink = (danger || t.warnings?.length) && Math.sin(time * 8) > 0;
        this.cautionMat.color.setHex(blink ? (danger ? 0xff3b2f : 0xffb547) : 0x3a0d0a);
      }

      // 표시등 줄 (바뀔 때만 다시 그림)
      const items = [
        { text: '엔진', on: t.engineOn && t.throttle > 0, color: '#3ddc84' },
        { text: '자세보조', on: t.autopilot.sas !== 'off', color: '#4fd1ff' },
        { text: '자동', on: Boolean(t.autopilot.program), color: '#4fd1ff' },
        { text: 'RCS', on: t.rcsEnabled, color: '#4fd1ff' },
        { text: '단분리 가능', on: t.canStage, color: '#ffd43b' },
        { text: '연료 부족', on: t.fuelCapacity > 0 && t.fuelRatio < 0.1, color: '#ffb547' },
        { text: '과열', on: Number.isFinite(t.thermalLimit) && t.skinTemperature > 0.8 * t.thermalLimit, color: '#ff5b5b' },
        { text: '낙하산', on: t.parachute?.state === 'deployed', color: '#3ddc84' },
      ];
      const key = items.map((x) => (x.on ? 1 : 0)).join('');
      if (key !== annunciatorKey) {
        annunciatorKey = key;
        drawAnnunciator(items);
      }

      // 경과 시간 시계 (1초마다)
      if (this.clock && Math.floor(t.missionTime) !== this.lastClock) {
        this.lastClock = Math.floor(t.missionTime);
        const { ctx, texture } = this.clock;
        ctx.clearRect(0, 0, 160, 160);
        ctx.fillStyle = '#0c1016';
        ctx.beginPath();
        ctx.arc(80, 80, 76, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8b96a5';
        ctx.lineWidth = 3;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(80 + Math.sin(a) * 62, 80 - Math.cos(a) * 62);
          ctx.lineTo(80 + Math.sin(a) * 72, 80 - Math.cos(a) * 72);
          ctx.stroke();
        }
        const s = this.lastClock;
        const hand = (frac, len, width, color) => {
          const a = frac * Math.PI * 2;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(80, 80);
          ctx.lineTo(80 + Math.sin(a) * len, 80 - Math.cos(a) * len);
          ctx.stroke();
        };
        hand(((s / 60) % 60) / 60, 46, 5, '#e3e9f0'); // 분
        hand((s % 60) / 60, 60, 2, '#ff6b5b'); // 초
        ctx.fillStyle = '#3ddc84';
        ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        const pad = (n) => String(n).padStart(2, '0');
        ctx.fillText(`${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`, 80, 122);
        texture.needsUpdate = true;
      }
    },
  };
}
