/**
 * 달 3D 표시 (비행 화면)
 * ------------------------------------------------------------
 * 1) 달 전체 구: 충돌구·바다 무늬 텍스처 (멀리서 볼 때, 행성에서 올려다볼 때)
 * 2) 고해상도 지표 조각: 달에 가까이 내려가면 비행체 바로 아래 지표를 촘촘한 메시로 그려,
 *    구가 각져 보이거나 착륙선이 떠 보이지 않게 한다. 비행체가 움직이면 새 위치에 다시 만든다.
 * 크기·위치는 물리 설정(config.moon)과 시각별 달 위치(moonState)를 그대로 쓴다.
 */
import * as THREE from 'three';
import { vec3 } from '../physics/vectorMath.js';
import { localFrame } from '../physics/referenceFrame.js';
import { moonState } from '../physics/celestialBodies.js';
import { toRenderPosition, toRenderLength } from './renderCoordinates.js';
import { GLOBE_ROTATION_X } from './proceduralTextures.js';
import { buildCapGeometry } from './planetView.js';
import { moonColorAt, createMoonTexture, createRegolithTexture } from './moonSurface.js';

// 화면 품질용 값 (물리와 무관)
const GLOBE_SEGMENTS = 160;
const PATCH_ANGLE = 0.08; // 지표 조각이 덮는 범위 (rad, 달 지표 약 12 km)
const PATCH_RINGS = 140;
const PATCH_SEGMENTS = 180;
const PATCH_SHOW_ALTITUDE = 20_000; // 달 고도(m) 가 이보다 낮으면 지표 조각을 그린다
const PATCH_REBUILD_ANGLE = 0.025; // 비행체 아래 지점이 조각 중심에서 이만큼(rad) 벗어나면 다시 만든다
const DETAIL_TILE = 24; // 근접 무늬 한 장이 덮는 크기 (m)

export function createMoonView(config) {
  const group = new THREE.Group();
  if (!config.moon) return { group, update() {} };
  const { radius } = config.moon;

  // ── 1) 달 전체 구 ────────────────────────────────────
  const globeRadius = toRenderLength(radius) * Math.cos(Math.PI / GLOBE_SEGMENTS);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(globeRadius, GLOBE_SEGMENTS, GLOBE_SEGMENTS / 2),
    // 지상 안개(대기 원근)를 받으면 낮에는 달이 사라지므로 안개를 끈다
    new THREE.MeshStandardMaterial({ map: createMoonTexture(), roughness: 1, metalness: 0, fog: false }),
  );
  globe.rotation.x = GLOBE_ROTATION_X;
  group.add(globe);

  // ── 2) 고해상도 지표 조각 ─────────────────────────────
  const patchMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: createRegolithTexture(), roughness: 1, fog: false });
  let patch = null; // { mesh, direction (달 중심 기준 단위벡터) }

  function buildPatch(direction) {
    if (patch) {
      group.remove(patch.mesh);
      patch.mesh.geometry.dispose();
    }
    const frame = localFrame(vec3.scale(direction, radius), config.planet.northPoleDirection);
    const geometry = buildCapGeometry(radius, frame, PATCH_ANGLE, PATCH_RINGS, PATCH_SEGMENTS);
    paintPatch(geometry, frame, radius);
    const mesh = new THREE.Mesh(geometry, patchMaterial);
    mesh.receiveShadow = true;
    group.add(mesh);
    patch = { mesh, direction };
  }

  return {
    group,
    /**
     * @param {number[]} origin 화면 원점 (물리 위치, m)
     * @param {number} time 시뮬레이션 시각 (s) — 달 위치
     */
    update(origin, time) {
      const moon = moonState(config, time);
      toRenderPosition(moon.position, origin, globe.position);
      // 화면 원점(비행체)이 달 가까이 있으면 그 아래에 지표 조각
      const relative = vec3.sub(origin, moon.position);
      const altitude = vec3.length(relative) - radius;
      const showPatch = altitude < PATCH_SHOW_ALTITUDE;
      if (showPatch) {
        const below = vec3.normalize(relative);
        if (!patch || vec3.dot(below, patch.direction) < Math.cos(PATCH_REBUILD_ANGLE)) buildPatch(below);
      }
      if (patch) {
        patch.mesh.visible = showPatch;
        toRenderPosition(vec3.add(moon.position, vec3.scale(patch.direction, radius)), origin, patch.mesh.position);
      }
    },
  };
}

/** 조각의 정점 색(달 표면 색)과 근접 무늬 좌표(m 단위 반복) */
function paintPatch(geometry, frame, radius) {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  const { up, east, north } = frame;
  const r = toRenderLength(radius);
  const p = [0, 0, 0];
  const relative = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    relative[0] = pos.getX(i);
    relative[1] = pos.getY(i);
    relative[2] = pos.getZ(i);
    p[0] = relative[0] + up[0] * r;
    p[1] = relative[1] + up[1] * r;
    p[2] = relative[2] + up[2] * r;
    const color = moonColorAt(vec3.normalize(p));
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
    uvs[i * 2] = vec3.dot(relative, east) / toRenderLength(DETAIL_TILE);
    uvs[i * 2 + 1] = vec3.dot(relative, north) / toRenderLength(DETAIL_TILE);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}
