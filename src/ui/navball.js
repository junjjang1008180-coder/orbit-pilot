/**
 * 자세 지시계 (네비볼)
 * ------------------------------------------------------------
 * 하늘(파랑)·땅(갈색) 반구와 방위(N/E/S/W)가 그려진 구를, 로켓 기수 쪽에서 바라본다.
 *   - 가운데 노란 표시 = 기수가 향하는 방향
 *   - 녹색 원 = 진행 방향(prograde), 빨간 X = 역진행 방향(retrograde)
 *   - 노란 사각형 = 부스터 착륙 지점 방향 (착륙 지점이 있을 때)
 *   - 자주색 원 = 도킹 목표 방향, 자주색 X = 목표 반대, 하늘색 원 = 목표 기준 상대 진행 방향
 *   - 파란 ◇ = 기동 노드 연소 방향
 * 구의 축: +Y = 천정(위), +X = 동, −Z = 북 (지역 좌표계 기준).
 * 로켓 물리 상태를 읽기만 하며, 별도의 작은 렌더러로 HUD 안에 그린다.
 */
import * as THREE from 'three';
import { vec3, quat } from '../physics/vectorMath.js';
import { localFrame, toLocalENU } from '../physics/referenceFrame.js';

const SIZE = 150; // 네비볼 크기 (px)

/** 월드 방향 → 네비볼 구 좌표 (동, 위, −북) */
export function toNavballVector(direction, frame) {
  const d = toLocalENU(direction, frame);
  return [d.east, d.up, -d.north];
}

/** @param {HTMLElement} root */
export function createNavball(root, config) {
  root.innerHTML = `
    <div class="navball-view" data-id="view"></div>
    <div class="navball-center" aria-hidden="true"></div>
    <div class="navball-readout" data-id="readout"></div>
  `;
  const readout = root.querySelector('[data-id="readout"]');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.querySelector('[data-id="view"]').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.02, 1.02, 1.02, -1.02, 0.1, 10);
  const texture = new THREE.CanvasTexture(drawNavballTexture());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ map: texture }));
  scene.add(ball);

  const prograde = makeRing(0x3ddc84);
  const retrograde = makeCross(0xff5b5b);
  const target = makeSquare(0xffd43b);
  const dockTarget = makeRing(0xd65cff);
  const dockAntiTarget = makeCross(0xd65cff);
  const relativePrograde = makeRing(0x5ce1ff);
  const maneuverMarker = makeSquare(0x2f80ed);
  maneuverMarker.scale.setScalar(1.3);
  // 비행 가이드 방향: 하늘색 마름모 (가운데 점이 있는 굵은 모양)
  const guideMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.115, 4, 1, 0),
    new THREE.MeshBasicMaterial({ color: 0x4fd1ff, side: THREE.DoubleSide }),
  );
  guideMarker.add(new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), guideMarker.material));
  scene.add(prograde, retrograde, target, dockTarget, dockAntiTarget, relativePrograde, maneuverMarker, guideMarker);

  const v = new THREE.Vector3();
  function placeMarker(marker, direction) {
    v.set(direction[0], direction[1], direction[2]).normalize();
    marker.position.copy(v).multiplyScalar(1.01);
    marker.lookAt(v.multiplyScalar(2));
  }

  return {
    /**
     * @param {object} state 조종 중인 비행체 물리 상태 (읽기 전용)
     * @param {object} telemetry
     * @param {number[] | null} [targetPosition] 방향을 표시할 목표 지점 (착륙 지점, m)
     * @param {{position:number[], velocity:number[]} | null} [dockingTarget] 도킹 목표 (포트 위치·속도)
     * @param {number[] | null} [maneuverDirection] 기동 노드 연소 방향
     * @param {{position:number[], velocity:number[]} | null} [reference] 기준 천체(행성·달)의 위치·속도 —
     *   지평선과 진행 방향은 이 천체 기준으로 그린다
     * @param {number[] | null} [guideDirection] 비행 가이드 방향 (하늘색 ◇)
     */
    update(state, telemetry, targetPosition = null, dockingTarget = null, maneuverDirection = null, reference = null, guideDirection = null) {
      const center = reference?.position ?? [0, 0, 0];
      const velocity = reference ? vec3.sub(state.velocity, reference.velocity) : state.velocity;
      const frame = localFrame(vec3.sub(state.position, center), config.planet.northPoleDirection);
      maneuverMarker.visible = Boolean(maneuverDirection) && vec3.length(maneuverDirection) > 1e-6;
      if (maneuverMarker.visible) placeMarker(maneuverMarker, toNavballVector(vec3.normalize(maneuverDirection), frame));
      guideMarker.visible = Boolean(guideDirection) && vec3.length(guideDirection) > 1e-6;
      if (guideMarker.visible) placeMarker(guideMarker, toNavballVector(vec3.normalize(guideDirection), frame));
      const nose = toNavballVector(quat.rotate(state.orientation, [0, 1, 0]), frame);
      const top = toNavballVector(quat.rotate(state.orientation, [0, 0, 1]), frame); // 화면 위쪽 = 로켓 등(+Z)

      // 카메라를 기수 방향 바깥에 두고 구 중심을 바라본다
      camera.position.set(nose[0] * 3, nose[1] * 3, nose[2] * 3);
      camera.up.set(top[0], top[1], top[2]);
      camera.lookAt(0, 0, 0);

      const speed = vec3.length(velocity);
      const moving = speed > 1;
      prograde.visible = retrograde.visible = moving;
      if (moving) {
        const dir = toNavballVector(vec3.scale(velocity, 1 / speed), frame);
        placeMarker(prograde, dir);
        placeMarker(retrograde, dir.map((x) => -x));
      }
      target.visible = Boolean(targetPosition);
      if (targetPosition) placeMarker(target, toNavballVector(vec3.normalize(vec3.sub(targetPosition, state.position)), frame));

      dockTarget.visible = dockAntiTarget.visible = Boolean(dockingTarget);
      relativePrograde.visible = false;
      if (dockingTarget) {
        const toTarget = toNavballVector(vec3.normalize(vec3.sub(dockingTarget.position, state.position)), frame);
        placeMarker(dockTarget, toTarget);
        placeMarker(dockAntiTarget, toTarget.map((x) => -x));
        const relV = vec3.sub(state.velocity, dockingTarget.velocity);
        if (vec3.length(relV) > 0.05) {
          relativePrograde.visible = true;
          placeMarker(relativePrograde, toNavballVector(vec3.normalize(relV), frame));
        }
      }
      renderer.render(scene, camera);

      readout.textContent = `피치 ${telemetry.pitchDeg.toFixed(1)}° · 방위 ${telemetry.headingDeg.toFixed(0).padStart(3, '0')}°`;
    },
  };
}

/** 네비볼 표면 그림 (정거원통 도법: 가로 = 방위, 세로 = 고각) */
function drawNavballTexture() {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 위 반구 하늘, 아래 반구 땅
  ctx.fillStyle = '#2f7fd1';
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(0, H / 2, W, H / 2);

  // 고각 선 (30° 마다), 지평선은 굵게
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (const deg of [-60, -30, 30, 60]) {
    const y = H / 2 - (deg / 90) * (H / 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  // 방위: SphereGeometry 의 u 좌표에서 북 = 0.75, 동 = 0.5, 남 = 0.25, 서 = 0
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headingToX = (heading) => ((((0.75 - heading / 360) % 1) + 1) % 1) * W;
  for (let heading = 0; heading < 360; heading += 45) {
    const x = headingToX(heading);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = heading % 90 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (const [label, heading] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const x = headingToX(heading);
    for (const y of [H / 2 - 40, H / 2 + 40]) ctx.fillText(label, x, y);
    if (x < 30) for (const y of [H / 2 - 40, H / 2 + 40]) ctx.fillText(label, x + W, y);
  }
  return canvas;
}

function makeRing(color) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.1, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  return mesh;
}

function makeSquare(color) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.1, 4, 1, Math.PI / 4),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  return mesh;
}

function makeCross(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.035), mat);
    bar.rotation.z = angle;
    group.add(bar);
  }
  return group;
}
