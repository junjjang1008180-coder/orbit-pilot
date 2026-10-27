/**
 * 행성 3D 표시
 * ------------------------------------------------------------
 * 1) 행성 전체 구: 대륙·바다·사막·만년설 무늬 텍스처를 입힌 구 (멀리서 볼 때)
 * 2) 고해상도 지표 조각: 발사장(과 착륙 지점) 근처만 촘촘한 메시로 그려, 가까이서 볼 때
 *    구가 각져 보이거나 로켓이 땅에 묻혀 보이지 않게 한다. 색은 1) 과 같은 함수로 정하고
 *    가까이서 보이는 풀·흙 결 무늬를 더한다. 높이 올라가면(조각이 필요 없으면) 숨긴다.
 * 3) 구름층과 우주에서 보이는 대기 빛
 * 크기는 물리 설정의 행성 반지름을 그대로 읽어 물리와 화면이 일치한다. 지면 높이는 바꾸지 않는다.
 */
import * as THREE from 'three';
import { localFrame } from '../physics/referenceFrame.js';
import { vec3 } from '../physics/vectorMath.js';
import { toRenderPosition, toRenderLength } from './renderCoordinates.js';
import { planetColorAt } from './planetSurface.js';
import { createPlanetMaps, createGroundDetailTexture, GLOBE_ROTATION_X } from './proceduralTextures.js';
import { nightOnly, addSurfaceDetail } from './sunShading.js';
import { fbm3 } from './noise.js';
import { createCloudLayer } from './cloudLayer.js';
import { createAtmosphereGlow } from './atmosphereGlow.js';
import { runwayList, runwayFrame } from '../landing/runway.js';

// 화면 품질용 값 (물리와 무관)
const GLOBE_SEGMENTS = 128;
const CAP_ANGLE = 0.15; // 고해상도 조각이 덮는 범위 (rad, 지표 약 90 km)
const CAP_RINGS = 192;
const CAP_SEGMENTS = 256;
const LOCAL_PATCH_ANGLE = 0.02; // 착륙 지점 조각 범위 (rad, 지표 약 12 km)
const LOCAL_PATCH_RINGS = 96;
const LOCAL_PATCH_SEGMENTS = 128;
const RUNWAY_PATCH_ANGLE = 0.03; // 먼 활주로 둘레 조각 범위 (rad, 지표 약 18 km)
const PATCH_HIDE_ALTITUDE = 40_000; // 이 고도(m) 위에서는 고해상도 조각 대신 행성 구만 보인다
const DETAIL_TILE = 40; // 지면 근접 무늬 한 장이 덮는 크기 (m)

export function createPlanetView(config, modelLibrary = null) {
  const { radius, northPoleDirection } = config.planet;
  const siteDirection = vec3.normalize(config.launchSite.direction);

  const group = new THREE.Group();

  // ── 1) 행성 전체 구 ───────────────────────────────────
  // 저해상도 구의 면이 실제 지표보다 위로 튀어나오지 않도록 아주 조금 작게 그린다.
  // 구의 극(±Y)을 실제 북극(−Z)에 맞춰 돌려, 발사장(+Y)이 텍스처가 찌그러지는 극에 놓이지 않게 한다.
  const globeRadius = toRenderLength(radius) * Math.cos(Math.PI / GLOBE_SEGMENTS);
  // 표면 색 + 지형 굴곡(bump) + 거칠기(바다는 매끈해 햇빛이 반짝인다) + 밤쪽 도시 불빛
  const maps = createPlanetMaps(siteDirection, northPoleDirection);
  const globeMaterial = nightOnly(new THREE.MeshStandardMaterial({
    map: maps.color,
    bumpMap: maps.surface,
    bumpScale: 3,
    roughnessMap: maps.surface,
    roughness: 1,
    metalness: 0,
    emissiveMap: maps.lights,
    emissive: 0xffffff,
    emissiveIntensity: 1.4,
  }));
  addSurfaceDetail(globeMaterial, createGroundDetailTexture());
  const globe = new THREE.Mesh(new THREE.SphereGeometry(globeRadius, GLOBE_SEGMENTS, GLOBE_SEGMENTS / 2), globeMaterial);
  globe.rotation.x = GLOBE_ROTATION_X;
  globe.receiveShadow = true;
  group.add(globe);

  // assets/models/planet.glb 가 있으면 멀리서 보이는 행성 구를 그 모델로 바꾼다 (반지름에 맞춰 크기 조절)
  const planetModel = modelLibrary?.createFitted('planet', { diameter: globeRadius * 2, center: true });
  if (planetModel) {
    globe.visible = false;
    group.add(planetModel);
  }

  // ── 3) 구름층·대기 빛 ─────────────────────────────────
  const clouds = createCloudLayer(radius);
  // 대기 빛: 대기 상한까지의 구, 지표 위 약 9 km 마다 옅어진다 (화면 효과용 높이)
  const glow = createAtmosphereGlow(toRenderLength(radius + config.atmosphere.topAltitude), toRenderLength(radius + 4_000), {
    planetRadius: toRenderLength(radius),
    scaleHeight: toRenderLength(9_000),
  });
  group.add(clouds.mesh, glow.mesh);

  // ── 2) 고해상도 지표 조각 (발사장, 이후 착륙 지점) ──────
  // 정점 좌표를 조각 중심 기준 상대 좌표로 만들어 32비트 정밀도 문제를 피한다.
  const detail = createGroundDetailTexture();
  const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 1 });
  const patches = []; // { mesh, center(m) }
  function addSurfacePatch(direction, angle, rings, segments) {
    const center = vec3.scale(vec3.normalize(direction), radius);
    const frame = localFrame(center, northPoleDirection);
    const geometry = buildCapGeometry(radius, frame, angle, rings, segments);
    paintPatch(geometry, frame, radius, siteDirection, northPoleDirection);
    const mesh = new THREE.Mesh(geometry, groundMaterial);
    mesh.receiveShadow = true;
    group.add(mesh);
    patches.push({ mesh, center });
    return mesh;
  }
  addSurfacePatch(siteDirection, CAP_ANGLE, CAP_RINGS, CAP_SEGMENTS);
  // 멀리 있는 우주 왕복선 활주로 둘레 (발사장 조각 밖에 있는 것만)
  if (config.runway) {
    for (const r of runwayList(config)) {
      const up = runwayFrame(config, r).up;
      if (Math.acos(Math.min(1, vec3.dot(up, siteDirection))) > CAP_ANGLE * 0.8) addSurfacePatch(up, RUNWAY_PATCH_ANGLE, LOCAL_PATCH_RINGS, LOCAL_PATCH_SEGMENTS);
    }
  }
  const basePatchCount = patches.length;

  return {
    group,
    /**
     * 지정한 방향의 지표에 고해상도 조각을 추가한다 (착륙 지점 등).
     * @param {number[]} direction 행성 중심 기준 방향
     */
    addLocalPatch(direction) {
      return addSurfacePatch(direction, LOCAL_PATCH_ANGLE, LOCAL_PATCH_RINGS, LOCAL_PATCH_SEGMENTS);
    },
    /** 추가했던 조각 제거 (재시작 시) */
    clearLocalPatches() {
      while (patches.length > basePatchCount) {
        const { mesh } = patches.pop();
        group.remove(mesh);
        mesh.geometry.dispose();
      }
    },
    /**
     * 화면 원점(origin, 물리 위치 m)에 맞춰 행성 위치를 옮긴다
     * @param {number[]} origin
     * @param {number} [viewerAltitude] 보는 위치의 고도 (m) — 높으면 고해상도 조각을 숨긴다
     * @param {number} [dt] 프레임 시간 (s) — 구름 회전
     */
    update(origin, viewerAltitude = 0, dt = 0) {
      toRenderPosition([0, 0, 0], origin, globe.position);
      if (planetModel) planetModel.position.copy(globe.position);
      clouds.mesh.position.copy(globe.position);
      glow.mesh.position.copy(globe.position);
      clouds.update(dt);
      // 대기 빛은 대기 밖에서 내려다볼 때만 (안에서는 하늘 셰이더가 대신한다)
      glow.setOpacity(Math.min(1, Math.max(0, (viewerAltitude - 25_000) / 40_000)));
      const showPatches = viewerAltitude < PATCH_HIDE_ALTITUDE;
      for (const p of patches) {
        p.mesh.visible = showPatches;
        toRenderPosition(p.center, origin, p.mesh.position);
      }
    },
  };
}

/**
 * 조각의 정점 색(행성 표면 색 × 잔무늬)과 근접 무늬 좌표(m 단위 반복)를 칠한다.
 */
function paintPatch(geometry, frame, radius, siteDir, northDir) {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  const { up, east, north } = frame;
  const r = toRenderLength(radius);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    // 정점은 조각 중심 기준 상대 좌표 → 행성 중심 기준 방향
    p[0] = pos.getX(i) + up[0] * r;
    p[1] = pos.getY(i) + up[1] * r;
    p[2] = pos.getZ(i) + up[2] * r;
    const dir = vec3.normalize(p);
    const { color, water } = planetColorAt(dir, siteDir, northDir);
    // 수 km 크기의 들판·숲 얼룩 (육지만)
    // 가까이서 보는 땅은 우주에서 본 색보다 밝게 (멀리서는 대기가 어둡게·푸르게 덮어 보인다)
    const patchNoise = (water ? 1 : 0.75 + 0.5 * fbm3(dir[0] * 900, dir[1] * 900, dir[2] * 900, 4)) * (water ? 1.2 : 1.7);
    colors[i * 3] = color[0] * patchNoise;
    colors[i * 3 + 1] = color[1] * patchNoise;
    colors[i * 3 + 2] = color[2] * patchNoise;
    // 근접 무늬 좌표: 동·북 방향 거리(m) / 타일 크기
    const relative = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    uvs[i * 2] = vec3.dot(relative, east) / toRenderLength(DETAIL_TILE);
    uvs[i * 2 + 1] = vec3.dot(relative, north) / toRenderLength(DETAIL_TILE);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

/** 한 지점 중심의 구면 조각 지오메트리 (정점은 그 지점 지표 기준 상대 좌표) */
export function buildCapGeometry(radius, frame, angle, rings, segments) {
  const { up, east, north } = frame;
  const r = toRenderLength(radius);
  const positions = [];
  const normals = [];
  const indices = [];

  // 중심점 하나 + 링 rings 개 × 링마다 segments 개
  positions.push(0, 0, 0);
  normals.push(up[0], up[1], up[2]);
  for (let ring = 1; ring <= rings; ring++) {
    const theta = (ring / rings) * angle;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let seg = 0; seg < segments; seg++) {
      const phi = (seg / segments) * Math.PI * 2;
      // 구면 위 방향 n = sinθ(cosφ·동 + sinφ·북) + cosθ·위
      const n = [
        sinT * (Math.cos(phi) * east[0] + Math.sin(phi) * north[0]) + cosT * up[0],
        sinT * (Math.cos(phi) * east[1] + Math.sin(phi) * north[1]) + cosT * up[1],
        sinT * (Math.cos(phi) * east[2] + Math.sin(phi) * north[2]) + cosT * up[2],
      ];
      positions.push((n[0] - up[0]) * r, (n[1] - up[1]) * r, (n[2] - up[2]) * r);
      normals.push(n[0], n[1], n[2]);
    }
  }

  // 위에서 내려다볼 때 반시계 방향(앞면)이 되도록 정점 순서를 정한다.
  const vertexIndex = (ring, seg) => 1 + (ring - 1) * segments + (seg % segments);
  for (let seg = 0; seg < segments; seg++) {
    indices.push(0, vertexIndex(1, seg), vertexIndex(1, seg + 1));
  }
  for (let ring = 1; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const a = vertexIndex(ring, seg);
      const b = vertexIndex(ring, seg + 1);
      const c = vertexIndex(ring + 1, seg);
      const d = vertexIndex(ring + 1, seg + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
