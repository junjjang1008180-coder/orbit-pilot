/**
 * 조종석 승무원 — 우주비행사 의자와 앉은 우주비행사 (기본 도형, 시각 효과 전용)
 * ------------------------------------------------------------
 * 좌표: 로컬 +Y = 앞, +Z = 위, +X = 오른쪽 (조종석 실내와 같다). 단위 m.
 *   createCrewSeat   : 원점 = 엉덩이(앉는 면 가운데). 등받이·머리 받침·옆 지지대·다리 받침·5점 안전띠·받침 다리
 *   createAstronaut  : 원점 = 엉덩이. 앉은 자세(허벅지 앞으로, 정강이 아래로), 헬멧(얼굴 가리개), 장갑·장화, 휘장
 *   createPilotBody  : 플레이어 자신의 몸(머리 없음 — 눈이 헬멧 안). 손은 조종 장치 그룹에 따로 붙인다(createGlove).
 * update(time) 로 숨쉬기·고개 돌리기처럼 살짝 움직인다.
 */
import * as THREE from 'three';

const SUITS = {
  // 우주 왕복선 여압복 (주황)
  orange: { suit: 0xdd6a24, dark: 0x8e3d12, glove: 0xc9c9c4, boot: 0x2b2b2b, helmet: 0xf1f1ee, visor: 0xb8862c, patch: '#1d4f91' },
  // 캡슐 비행복 (흰색 + 파랑)
  white: { suit: 0xe9ebee, dark: 0x2f5ea8, glove: 0xf4f4f4, boot: 0xdcdcdc, helmet: 0xf6f6f6, visor: 0x2a2f3a, patch: '#c0392b' },
};

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...extra });
}

/** 두 점 a, b 사이의 둥근 막대 (팔·다리) */
function limb(a, b, radius, material) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = Math.max(0.01, A.distanceTo(B));
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 12), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/** 작은 글자·무늬 휘장 */
function patch(text, color, size = 0.07) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2d16b';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.CircleGeometry(size / 2, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
}

/** 장갑 (손바닥 + 엄지 + 손목 고리). 원점 = 손바닥 가운데, 손가락은 +Y */
export function createGlove(suitName = 'white') {
  const s = SUITS[suitName];
  const g = new THREE.Group();
  const gloveMat = std(s.glove, { roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), gloveMat);
  palm.scale.set(0.042, 0.055, 0.03);
  g.add(palm);
  const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.04, 4, 10), gloveMat);
  fingers.rotation.x = 0.6; // 손잡이를 감싸듯 구부림
  fingers.position.set(0, 0.05, -0.012);
  fingers.scale.set(1.7, 1, 1);
  g.add(fingers);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), gloveMat);
  thumb.position.set(-0.04, 0.02, 0.01);
  thumb.rotation.z = 0.8;
  g.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.05, 16), std(s.dark, { metalness: 0.4, roughness: 0.4 }));
  cuff.position.y = -0.06;
  g.add(cuff);
  return g;
}

/**
 * 우주비행사 의자 (원점 = 엉덩이)
 * @param {{color?:number, frame?:number, recline?:number, ownSeat?:boolean}} [opt]
 *   recline: 등받이가 뒤로 누운 각 (rad), ownSeat: 플레이어 자리 — 눈 가까이 오는 등받이 날개·머리 받침·어깨띠를 뺀다
 */
export function createCrewSeat({ color = 0x3b4450, frame = 0x8a9099, recline = 0.22, ownSeat = false } = {}) {
  const g = new THREE.Group();
  const cushion = std(color, { roughness: 1 });
  const metal = std(frame, { metalness: 0.8, roughness: 0.4 });
  const strapMat = std(0x2c4a7a, { roughness: 0.95 });
  // 앉는 면
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.08), cushion);
  pan.position.set(0, 0.12, -0.06);
  g.add(pan);
  // 등받이 (뒤로 누움) + 머리 받침
  const back = new THREE.Group();
  back.position.set(0, -0.16, -0.04);
  back.rotation.x = -recline;
  g.add(back);
  const backPad = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.78), cushion);
  backPad.position.z = 0.39;
  back.add(backPad);
  if (!ownSeat) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.24), cushion);
    head.position.set(0, -0.01, 0.92);
    back.add(head);
  }
  for (const side of [-1, 1]) {
    // 옆 지지대 (몸을 잡아 주는 날개)
    if (!ownSeat) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.55), cushion);
      wing.position.set(side * 0.26, 0.05, 0.32);
      back.add(wing);
      const headWing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), cushion);
      headWing.position.set(side * 0.16, 0.04, 0.92);
      back.add(headWing);
    }
    // 등받이 테 + 받침 다리
    back.add(limb([side * 0.25, -0.06, 0], [side * 0.25, -0.06, 0.85], 0.018, metal));
    g.add(limb([side * 0.22, 0.3, -0.1], [side * 0.22, 0.25, -0.55], 0.02, metal));
    g.add(limb([side * 0.22, -0.15, -0.1], [side * 0.22, -0.1, -0.55], 0.02, metal));
    // 팔걸이
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.05), cushion);
    arm.position.set(side * 0.3, 0.05, 0.2);
    g.add(arm);
    // 어깨 안전띠 (등받이 위에서 가슴으로)
    if (!ownSeat) back.add(limb([side * 0.12, 0.08, 0.72], [side * 0.05, 0.2, 0.18], 0.012, strapMat));
    else g.add(limb([side * 0.1, 0.12, 0.42], [side * 0.05, 0.2, 0.12], 0.012, strapMat)); // 가슴 아래 띠만
    // 허리띠
    g.add(limb([side * 0.22, 0.06, 0.02], [0, 0.17, 0.08], 0.012, strapMat));
  }
  g.add(limb([0, 0.3, -0.02], [0, 0.17, 0.08], 0.012, strapMat)); // 가랑이 띠
  const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 20), metal);
  buckle.rotation.x = Math.PI / 2 - 0.3;
  buckle.position.set(0, 0.19, 0.1);
  g.add(buckle);
  // 다리 받침 (무릎 아래)
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), cushion);
  leg.position.set(0, 0.44, -0.28);
  leg.rotation.x = 0.25;
  g.add(leg);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

/**
 * 앉은 우주비행사 (원점 = 엉덩이)
 * @param {{suit?:'orange'|'white', name?:string, hands?:'lap'|'panel', recline?:number}} [opt]
 */
export function createAstronaut({ suit = 'orange', name = 'OP', hands = 'lap', recline = 0.22 } = {}) {
  const s = SUITS[suit];
  const g = new THREE.Group();
  const suitMat = std(s.suit);
  const darkMat = std(s.dark);
  const bootMat = std(s.boot, { roughness: 0.6 });
  const upper = new THREE.Group(); // 상체 (숨쉬기·고개 움직임)
  upper.rotation.x = -recline;
  g.add(upper);
  // 골반·몸통
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), suitMat);
  pelvis.scale.set(0.19, 0.15, 0.12);
  pelvis.position.set(0, 0.02, 0.06);
  g.add(pelvis);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 6, 16), suitMat);
  torso.rotation.x = Math.PI / 2;
  torso.position.set(0, 0, 0.36);
  torso.scale.set(1.15, 1, 0.85); // 어깨가 넓고 앞뒤가 얇게
  upper.add(torso);
  // 가슴 장비 (산소 연결구·버튼) + 지퍼선 + 휘장·이름표
  const chestBox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.09), darkMat);
  chestBox.position.set(0.04, 0.15, 0.36);
  upper.add(chestBox);
  for (const [x, c] of [[0.01, 0xd33a2c], [0.05, 0x3ddc84], [0.09, 0xf2c230]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10), std(c, { emissive: c, emissiveIntensity: 0.3 }));
    b.rotation.x = Math.PI / 2;
    b.position.set(x - 0.04, 0.178, 0.37);
    upper.add(b);
  }
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 20, Math.PI), std(0x3a6fb0));
  hose.position.set(0.12, 0.13, 0.28);
  hose.rotation.set(0, Math.PI / 2, 0);
  upper.add(hose);
  const flag = patch(name, s.patch, 0.07);
  flag.position.set(-0.19, 0.04, 0.48);
  flag.rotation.y = -Math.PI / 2 + 0.3;
  upper.add(flag);
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.005, 0.025), std(0xf2f2f2));
  tag.position.set(-0.07, 0.16, 0.44);
  upper.add(tag);
  // 목 고리 + 헬멧(뒤통수 흰 껍질 + 앞 얼굴 가리개)
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 10, 24), std(0x9aa3ad, { metalness: 0.8, roughness: 0.3 }));
  neck.position.set(0, 0, 0.6);
  upper.add(neck);
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0, 0.74);
  upper.add(headGroup);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 18), std(s.helmet, { roughness: 0.35, metalness: 0.1 }));
  headGroup.add(helmet);
  // 얼굴 가리개: 앞(+Y)을 향한 구면 조각 (금빛·검은 반사), 가장자리 테
  const VISOR = Math.PI * 0.3;
  const VR = 0.158; // 헬멧(0.15)보다 살짝 크게 — 겹쳐 깜빡이지 않게
  const visor = new THREE.Mesh(new THREE.SphereGeometry(VR, 28, 12, 0, Math.PI * 2, 0, VISOR), std(s.visor, { metalness: 0.95, roughness: 0.08 }));
  visor.position.z = -0.01;
  headGroup.add(visor);
  const visorRim = new THREE.Mesh(new THREE.TorusGeometry(VR * Math.sin(VISOR), 0.009, 6, 30), std(0x9aa3ad, { metalness: 0.8 }));
  visorRim.rotation.x = Math.PI / 2;
  visorRim.position.set(0, VR * Math.cos(VISOR), -0.01);
  headGroup.add(visorRim);

  // 팔: 어깨 → 팔꿈치 → 손 (무릎 위 또는 계기판 쪽)
  const handsAt = hands === 'panel' ? [[-0.2, 0.52, 0.12], [0.2, 0.55, 0.15]] : [[-0.14, 0.38, 0.08], [0.14, 0.38, 0.08]];
  [-1, 1].forEach((side, i) => {
    const shoulder = [side * 0.21, 0.02, 0.5];
    const elbow = [side * 0.27, 0.16, 0.26];
    upper.add(limb(shoulder, elbow, 0.055, suitMat));
    const hand = handsAt[i];
    // 손은 상체가 기운 것을 되돌린 좌표에 두어 무릎·패널에 맞는다
    const handLocal = new THREE.Vector3(...hand).applyAxisAngle(new THREE.Vector3(1, 0, 0), recline);
    upper.add(limb(elbow, handLocal.toArray(), 0.045, suitMat));
    const glove = createGlove(suit);
    glove.position.copy(handLocal);
    glove.rotation.x = hands === 'panel' ? -0.3 : -1.2;
    upper.add(glove);
    // 다리: 엉덩이 → 무릎(앞) → 발(아래)
    const hip = [side * 0.1, 0.05, 0.02];
    const knee = [side * 0.12, 0.45, 0.06];
    const ankle = [side * 0.12, 0.52, -0.36];
    g.add(limb(hip, knee, 0.075, suitMat));
    g.add(limb(knee, ankle, 0.06, suitMat));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.09), bootMat);
    boot.position.set(side * 0.12, 0.6, -0.42);
    g.add(boot);
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), darkMat);
    kneePad.position.set(...knee);
    kneePad.position.y += 0.02;
    kneePad.scale.set(1, 0.8, 0.9);
    g.add(kneePad);
  });
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  const phase = Math.random() * 10;
  return {
    group: g,
    /** 숨쉬기(어깨가 살짝 오르내림)와 가끔 고개 돌리기 */
    update(time) {
      const t = time + phase;
      upper.position.z = Math.sin(t * 1.4) * 0.004;
      headGroup.rotation.z = Math.sin(t * 0.23) * 0.35 * Math.max(0, Math.sin(t * 0.11));
      headGroup.rotation.x = Math.sin(t * 0.31) * 0.06;
    },
  };
}

/**
 * 플레이어 자신의 몸 (머리 없음). 원점 = 엉덩이. 팔은 어깨에서 rightHand·leftHand(같은 좌표계) 근처까지.
 * 장갑은 조종 장치 그룹에 createGlove 로 따로 붙여 조종간과 함께 움직이게 한다.
 */
export function createPilotBody({ suit = 'orange', rightHand, leftHand, recline = 0.15 } = {}) {
  const s = SUITS[suit];
  const g = new THREE.Group();
  const suitMat = std(s.suit);
  const darkMat = std(s.dark);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.28, 6, 16), suitMat);
  torso.rotation.x = Math.PI / 2 - recline;
  torso.position.set(0, -0.04, 0.36);
  torso.scale.set(1.15, 1, 0.85);
  g.add(torso);
  const chestBox = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.1), darkMat);
  chestBox.position.set(0.03, 0.12, 0.36);
  g.add(chestBox);
  for (const [x, c] of [[-0.02, 0xd33a2c], [0.03, 0x3ddc84], [0.08, 0xf2c230]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.012, 10), std(c, { emissive: c, emissiveIntensity: 0.4 }));
    b.rotation.x = Math.PI / 2 - 0.3;
    b.position.set(x, 0.155, 0.39);
    g.add(b);
  }
  [-1, 1].forEach((side) => {
    const hand = side > 0 ? rightHand : leftHand;
    const shoulder = [side * 0.21, -0.08, 0.5];
    const elbow = [side * 0.3, 0.12, 0.22];
    g.add(limb(shoulder, elbow, 0.058, suitMat));
    if (hand) {
      // 손목은 장갑보다 조금 뒤·아래 (장갑은 조종 장치에 붙어 있다)
      const wrist = [hand[0], hand[1] - 0.07, hand[2] - 0.05];
      g.add(limb(elbow, wrist, 0.048, suitMat));
    }
    const hip = [side * 0.1, 0.0, 0.02];
    const knee = [side * 0.13, 0.46, 0.1];
    const ankle = [side * 0.13, 0.56, -0.34];
    g.add(limb(hip, knee, 0.08, suitMat));
    g.add(limb(knee, ankle, 0.062, suitMat));
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), darkMat);
    kneePad.position.set(knee[0], knee[1] + 0.02, knee[2] + 0.01);
    kneePad.scale.set(1, 0.8, 0.9);
    g.add(kneePad);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.02), darkMat);
    pocket.position.set(side * 0.16, 0.25, 0.12);
    pocket.rotation.x = -0.2;
    g.add(pocket);
  });
  return g;
}
