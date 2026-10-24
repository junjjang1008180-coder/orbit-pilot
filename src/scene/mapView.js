/**
 * 지도(궤도) 화면
 * ------------------------------------------------------------
 * 행성 전체, 대기권, 달(궤도·중력권), 로켓 현재 위치, 분리된 단, 예상 궤도선, 원지점·근지점을
 * 1 단위 = 1 km 로 줄인 별도 3D 장면에 그린다.
 * 궤도선과 원·근지점은 비행 화면 HUD 와 같은 궤도 계산(기준 천체에 대한 상대 궤도) 결과를 쓴다.
 *   - 달 중력권 안: 달 기준 궤도를 지금 달 위치에 겹쳐 그린다
 *   - 달 조우가 예상되면: 조우 지점까지 궤도선 + 그 뒤 달 기준 경로를 "조우 순간의 달" 둘레에 그린다
 * 보기 좋게: 궤도선은 화면 두께가 일정한 굵은 선(ThickLine), 지나온 길은 흐린 꼬리, 로켓은 진행 방향 화살표.
 * 조작: 초점 버튼(자동·로켓·행성·달·초기화), 천체 더블클릭으로 초점, 궤도 정보판.
 */
import * as THREE from 'three';
import { toMapPosition, toMapLength } from './renderCoordinates.js';
import { sampleOrbitPath, samplePathByTime, apsisPositions } from '../orbit/orbitPath.js';
import { formatDistance } from '../ui/format.js';
import { createPlanetTexture, createCloudTexture, GLOBE_ROTATION_X } from './proceduralTextures.js';
import { createMoonTexture } from './moonSurface.js';
import { createAtmosphereGlow } from './atmosphereGlow.js';
import { createStars } from './skyDome.js';
import { vec3 } from '../physics/vectorMath.js';
import { propagateKepler } from '../orbit/kepler.js';
import { moonState } from '../physics/celestialBodies.js';
import { ThickLine } from './thickLine.js';

const MAX_PATH_POINTS = 400; // 궤도선 최대 점 개수
const MARKER_SCREEN_SIZE = 0.012; // 마커 크기 (카메라 거리 대비 비율, 화면에서 일정한 크기)
const TRAIL_POINTS = 360; // 지나온 길 점 개수
const TRAIL_SPACING = 4; // 지나온 길 점 간격 (시뮬레이션 s)
const ROCKET_FOCUS_RADIUS = 20_000; // 로켓 초점일 때 "크기" (m) — 기본 거리·최소 거리 계산용

const FOCUS_LABELS = { auto: '자동', rocket: '🚀 로켓', planet: '🌍 행성', moon: '🌕 달' };

/**
 * @param {object} config PHYSICS_CONFIG
 * @param {HTMLElement} labelRoot 원지점·근지점 글자를 붙일 HTML 요소
 * @param {{onFocus?:(mode:string)=>void, onReset?:()=>void}} [actions] 초점 버튼 동작
 */
export function createMapView(config, labelRoot, actions = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03060d);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.6, 0.8, 0.35);
  scene.add(sun);

  const planetRadius = toMapLength(config.planet.radius);

  // 별 배경
  const stars = createStars(planetRadius * 400);
  stars.renderOrder = -1;
  scene.add(stars);

  // 행성 (비행 화면과 같은 표면 텍스처) + 구름 + 위경도 격자
  const siteDirection = vec3.normalize(config.launchSite.direction);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius, 128, 64),
    new THREE.MeshStandardMaterial({ map: createPlanetTexture(siteDirection, config.planet.northPoleDirection), roughness: 0.95 }),
  );
  planet.rotation.x = GLOBE_ROTATION_X;
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius * 1.004, 128, 64),
    new THREE.MeshLambertMaterial({ map: createCloudTexture(), transparent: true, opacity: 0.8, depthWrite: false }),
  );
  clouds.rotation.x = GLOBE_ROTATION_X;
  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius * 1.006, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, wireframe: true, transparent: true, opacity: 0.06 }),
  );
  // 대기권: 대기 상한 고도의 아주 옅은 구 + 가장자리 빛
  const atmosphereRadius = toMapLength(config.planet.radius + config.atmosphere.topAltitude);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(atmosphereRadius, 96, 48),
    new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.05, depthWrite: false }),
  );
  const glow = createAtmosphereGlow(atmosphereRadius * 1.01);
  scene.add(planet, clouds, grid, atmosphere, glow.mesh);

  // 발사장 표시
  const site = makeMarker(0xff8844);
  toMapPosition(config.launchSite.direction.map((v) => v * config.planet.radius), site.position);
  scene.add(site);

  // 굵은 선 (화면 두께 일정)
  const lines = [];
  const makeLine = (options) => {
    const line = new ThickLine({ maxPoints: MAX_PATH_POINTS + 1, ...options });
    scene.add(line.mesh);
    lines.push(line);
    return line;
  };
  // 궤도면의 둥근 고리 (점 목록)
  const ringPoints = (radius, segments = 256) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a) * radius, Math.cos(a) * radius, 0));
    }
    return pts;
  };
  // 대기권 경계 고리 (점선)
  const atmosphereRing = makeLine({ color: 0x5aa9ff, width: 1.5, opacity: 0.55 });
  atmosphereRing.setPoints(ringPoints(atmosphereRadius));

  // 달: 구 + 중력권(옅은 구) + 공전 궤도선 + 조우 순간의 달(반투명)
  const moonConfig = config.moon;
  const moonGroup = new THREE.Group();
  const ghostMoon = new THREE.Group();
  let moonMesh = null;
  if (moonConfig) {
    moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(toMapLength(moonConfig.radius), 96, 48),
      new THREE.MeshStandardMaterial({ map: createMoonTexture(), roughness: 1 }),
    );
    moonMesh.rotation.x = GLOBE_ROTATION_X;
    const soi = new THREE.Mesh(
      new THREE.SphereGeometry(toMapLength(moonConfig.soiRadius), 48, 24),
      new THREE.MeshBasicMaterial({ color: 0xb8a6ff, transparent: true, opacity: 0.05, depthWrite: false }),
    );
    moonGroup.add(moonMesh, soi);
    scene.add(moonGroup);
    const soiRing = makeLine({ color: 0xb8a6ff, width: 1.5, opacity: 0.5 });
    soiRing.setPoints(ringPoints(toMapLength(moonConfig.soiRadius), 128));
    moonGroup.add(soiRing.mesh); // 달과 함께 움직인다
    const moonOrbit = makeLine({ color: 0x9a97b8, width: 1.5, opacity: 0.5 });
    moonOrbit.setPoints(ringPoints(toMapLength(moonConfig.orbitRadius)));
    ghostMoon.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(toMapLength(moonConfig.radius), 48, 24),
        new THREE.MeshBasicMaterial({ color: 0xc9c4e6, transparent: true, opacity: 0.25, depthWrite: false }),
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(toMapLength(moonConfig.soiRadius), 24, 12),
        new THREE.MeshBasicMaterial({ color: 0xb8a6ff, wireframe: true, transparent: true, opacity: 0.1 }),
      ),
    );
    ghostMoon.visible = false;
    scene.add(ghostMoon);
  }

  // 지나온 길 (흐린 꼬리) · 예상 궤도선 · 조우 뒤 달 기준 경로
  const trailLine = makeLine({ color: 0x7fb8ff, width: 2, opacity: 0.55, maxPoints: TRAIL_POINTS + 2 });
  const pathLine = makeLine({ color: 0x4fd1ff, width: 3.2 });
  const encounterPath = makeLine({ color: 0xc58cff, width: 3 });

  // 로켓(진행 방향 화살표)·원지점·근지점 마커
  const rocketMarker = makeMarker(0xffffff);
  const rocketArrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  rocketArrow.geometry.translate(0, 0.9, 0); // 원점에서 앞으로 튀어나오게
  const apMarker = makeMarker(0x5aa9ff);
  const peMarker = makeMarker(0xffb547);
  const encounterMarker = makeMarker(0xc58cff); // 달 근접 지점
  encounterMarker.visible = false;
  const zoneMarker = makeMarker(0xffd43b); // 부스터 착륙 지점
  zoneMarker.visible = false;
  const stationMarker = makeMarker(0xd65cff); // 우주 정거장
  stationMarker.visible = false;
  scene.add(rocketMarker, rocketArrow, apMarker, peMarker, encounterMarker, zoneMarker, stationMarker);
  // 기동 노드: 노드 위치 마커 + 실행 후 예상 궤도(점선) + 실행 후 조우 경로(점선)
  const nodeMarker = makeMarker(0x2f80ed);
  nodeMarker.visible = false;
  scene.add(nodeMarker);
  const afterPath = makeLine({ color: 0xff9f43, width: 2.6 });
  const afterEncounterPath = makeLine({ color: 0xffc078, width: 2.6 });

  // 정거장 궤도선
  const stationPath = makeLine({ color: 0xd65cff, width: 2, opacity: 0.7 });
  const debrisMarkers = [];

  // HTML 글자·버튼
  labelRoot.innerHTML = `
    <div class="map-label map-label-rocket" data-id="rocket">로켓</div>
    <div class="map-label map-label-ap" data-id="ap"></div>
    <div class="map-label map-label-pe" data-id="pe"></div>
    <div class="map-label map-label-zone" data-id="zone">착륙 지점</div>
    <div class="map-label map-label-station" data-id="station">우주 정거장</div>
    <div class="map-label map-label-node" data-id="node">기동 노드</div>
    <div class="map-label map-label-moon" data-id="moon">달</div>
    <div class="map-label map-label-planet" data-id="planet">행성</div>
    <div class="map-label map-label-encounter" data-id="encounter"></div>
    <div class="map-legend"><kbd>M</kbd> 비행 화면으로 · 궤도선 클릭 = 기동 노드 · 드래그 회전 · 휠/핀치 확대 · 천체 더블클릭 = 초점</div>
    <nav class="map-toolbar" aria-label="지도 초점">
      ${Object.entries(FOCUS_LABELS).map(([id, label]) => `<button type="button" data-focus="${id}">${label}</button>`).join('')}
      <button type="button" data-act="reset" title="시점 초기화">↺ 초기화</button>
    </nav>
    <section class="map-info" data-id="info" aria-label="궤도 정보"></section>
    <section class="map-help" aria-label="지도 조작">
      <b>지도 조작</b>
      <ul>
        <li>드래그 (왼쪽·오른쪽 버튼) · <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> 회전</li>
        <li>휠 · 두 손가락 스크롤 · 핀치 · <kbd>+</kbd>/<kbd>−</kbd> 확대·축소</li>
        <li><kbd>F</kbd> 초점 바꾸기 · 천체 더블클릭 · <kbd>0</kbd> 초기화</li>
        <li>궤도선 클릭 = 기동 노드</li>
      </ul>
    </section>
  `;
  const $ = (id) => labelRoot.querySelector(`[data-id="${id}"]`);
  const labels = {
    rocket: $('rocket'),
    ap: $('ap'),
    pe: $('pe'),
    zone: $('zone'),
    station: $('station'),
    node: $('node'),
    moon: $('moon'),
    planet: $('planet'),
    encounter: $('encounter'),
  };
  const info = $('info');
  for (const button of labelRoot.querySelectorAll('[data-focus]')) {
    button.addEventListener('click', (e) => {
      e.currentTarget.blur();
      actions.onFocus?.(button.dataset.focus);
    });
  }
  labelRoot.querySelector('[data-act="reset"]').addEventListener('click', (e) => {
    e.currentTarget.blur();
    actions.onReset?.();
  });

  const projected = new THREE.Vector3();
  function placeLabel(label, object, camera, width, height, text) {
    if (!object.visible) {
      label.hidden = true;
      return;
    }
    object.getWorldPosition(projected).project(camera);
    label.hidden = projected.z > 1;
    label.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px)`;
    if (text !== undefined && label.textContent !== text) label.textContent = text;
  }

  /** 점 목록(m)을 offset(m) 만큼 옮긴 지도 좌표 점들 */
  const toMapPoints = (points, offset = [0, 0, 0]) => points.map((p) => toMapPosition(vec3.add(p, offset), new THREE.Vector3()));

  /**
   * 로켓 본체의 "앞으로 지나갈 궤도" (기준 천체 상대 위치·속도와, 조우가 있으면 그 시각까지)
   */
  function futureTrack(simulation, vehicle) {
    const body = simulation.getReference(vehicle);
    const rel = { position: vec3.sub(vehicle.position, body.position), velocity: vec3.sub(vehicle.velocity, body.velocity) };
    const orbit = simulation.getOrbit(vehicle);
    let horizon = Number.isFinite(orbit.period) ? orbit.period : 3 * 3600;
    const encounter = vehicle === simulation.state ? simulation.getEncounters().current : null;
    if (encounter) horizon = Math.min(horizon, encounter.timeToEncounter);
    return { body, rel, horizon, orbit, encounter };
  }

  // 지나온 길 기록 (물리 위치, m)
  let trail = [];
  let trailVehicle = null;
  let lastTrailTime = -Infinity;
  function recordTrail(vehicle) {
    if (vehicle !== trailVehicle || vehicle.time < lastTrailTime) {
      trail = [];
      trailVehicle = vehicle;
      lastTrailTime = -Infinity;
    }
    if (vehicle.landed) return;
    if (vehicle.time - lastTrailTime >= TRAIL_SPACING) {
      trail.push(vec3.clone(vehicle.position));
      if (trail.length > TRAIL_POINTS) trail.shift();
      lastTrailTime = vehicle.time;
    }
  }

  return {
    scene,
    /**
     * 카메라가 바라볼 대상 (지도 좌표)
     * @param {'auto'|'rocket'|'planet'|'moon'} mode
     */
    focusFor(simulation, mode = 'auto') {
      const vehicle = simulation.getControlled();
      if (mode === 'rocket') {
        return { id: 'rocket', kind: 'rocket', target: toMapPosition(vehicle.position, new THREE.Vector3()), radius: toMapLength(ROCKET_FOCUS_RADIUS) };
      }
      const id = mode === 'auto' ? simulation.getReference(vehicle).id : mode;
      if (id === 'moon' && moonConfig) {
        return { id: 'moon', kind: 'moon', target: toMapPosition(moonState(config, vehicle.time).position, new THREE.Vector3()), radius: toMapLength(moonConfig.radius) };
      }
      return { id: 'planet', kind: 'planet', target: new THREE.Vector3(), radius: planetRadius };
    },
    /** 화면 좌표의 천체 (더블클릭 초점용): 'planet' | 'moon' | null */
    pickBody(clientX, clientY, camera, viewport) {
      const ndc = new THREE.Vector2((clientX / viewport.width) * 2 - 1, -(clientY / viewport.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const targets = [planet, ...(moonMesh ? [moonMesh] : [])];
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return null;
      return hit.object === planet ? 'planet' : 'moon';
    },
    /**
     * 화면 좌표(clientX, clientY)에 가장 가까운 "현재 궤도 위 미래 지점" 의 시각 (s). 가까운 점이 없으면 null.
     * 궤도를 시간 순으로 촘촘히 나눠 화면에 투영해 비교한다.
     */
    pickOrbitTime(clientX, clientY, simulation, camera, viewport) {
      const state = simulation.state;
      if (state.landed) return null;
      const { body, rel, horizon } = futureTrack(simulation, state);
      const maxRadius = body.id === 'moon' ? moonConfig.soiRadius : config.planet.radius * 20;
      const samples = 480;
      const p = new THREE.Vector3();
      let best = null;
      for (let i = 1; i <= samples; i++) {
        const t = (horizon * i) / samples;
        const at = propagateKepler(rel.position, rel.velocity, body.mu, t);
        if (vec3.length(at.position) > maxRadius) break;
        toMapPosition(vec3.add(at.position, body.position), p).project(camera);
        if (p.z > 1) continue;
        const sx = ((p.x + 1) / 2) * viewport.width;
        const sy = ((1 - p.y) / 2) * viewport.height;
        const d = Math.hypot(sx - clientX, sy - clientY);
        if (!best || d < best.d) best = { d, t };
      }
      return best && best.d <= 18 ? state.time + best.t : null;
    },
    setVisible(visible) {
      labelRoot.hidden = !visible;
    },
    /**
     * @param {import('../core/simulation.js').FlightSimulation} simulation (읽기 전용)
     * @param {THREE.PerspectiveCamera} camera 지도 카메라
     * @param {{width:number, height:number}} viewport 화면 크기 (px)
     * @param {string} [focusMode] 지금 초점 버튼 (강조 표시용)
     */
    update(simulation, camera, viewport, focusMode = 'auto') {
      const state = simulation.getControlled();
      for (const line of lines) line.setResolution(viewport.width, viewport.height);
      // 마커 크기: 카메라와의 거리에 비례해 화면에서 일정하게
      const size = (marker, factor = 1) => marker.scale.setScalar(camera.position.distanceTo(marker.position) * MARKER_SCREEN_SIZE * factor);

      // 달 (지금 위치)
      const moonNow = moonConfig ? moonState(config, state.time) : null;
      if (moonNow) toMapPosition(moonNow.position, moonGroup.position);

      // 지나온 길 (오래될수록 흐리게)
      recordTrail(state);
      const trailPts = toMapPoints([...trail, state.position]);
      trailLine.setPoints(trailPts, (i, n) => 0.1 + 0.9 * (i / Math.max(1, n - 1)));
      trailLine.visible = trailPts.length > 1;

      // 지금 궤도선: 기준 천체 기준 궤도를 그 천체의 지금 위치에 겹쳐 그린다
      const { body, rel, horizon, orbit, encounter } = futureTrack(simulation, state);
      const flying = !state.landed && !state.destroyed;
      if (encounter) {
        // 조우까지: 시간 순 점이라 앞쪽(로켓 근처)을 진하게
        pathLine.setPoints(toMapPoints(samplePathByTime(rel.position, rel.velocity, body.mu, horizon, MAX_PATH_POINTS - 1)), (i, n) => 1 - 0.55 * (i / n));
      } else {
        const maxRadius = body.id === 'moon' ? moonConfig.soiRadius : config.planet.radius * 20;
        pathLine.setPoints(toMapPoints(sampleOrbitPath(orbit, rel.position, body.mu, { segments: MAX_PATH_POINTS - 1, maxRadius }), body.position));
      }
      if (!flying) pathLine.visible = false;

      // 로켓 마커 + 진행 방향 화살표 (기준 천체에 대한 속도)
      toMapPosition(state.position, rocketMarker.position);
      size(rocketMarker, 0.9);
      size(site, 0.7);
      const speed = vec3.length(rel.velocity);
      rocketArrow.visible = flying && speed > 1;
      if (rocketArrow.visible) {
        rocketArrow.position.copy(rocketMarker.position);
        rocketArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...vec3.scale(rel.velocity, 1 / speed)));
        size(rocketArrow, 1.2);
      }

      // 원지점·근지점 (조우가 예정되어 있으면 행성 궤도의 원지점은 숨긴다)
      const apsis = apsisPositions(orbit, rel.position);
      peMarker.visible = pathLine.visible && orbit.periapsisAltitude > 0 && !encounter;
      apMarker.visible = pathLine.visible && apsis.apoapsis !== null && !encounter &&
        (body.id !== 'moon' || orbit.apoapsisRadius < moonConfig.soiRadius);
      toMapPosition(vec3.add(apsis.periapsis, body.position), peMarker.position);
      size(peMarker, 0.8);
      if (apsis.apoapsis) toMapPosition(vec3.add(apsis.apoapsis, body.position), apMarker.position);
      size(apMarker, 0.8);

      // 달 조우: 조우 순간의 달(반투명) 둘레에 달 기준 경로 + 근접 지점
      ghostMoon.visible = encounterPath.visible = encounterMarker.visible = false;
      const showEncounter = (e, line, withMarker) => {
        const o = e.orbit;
        line.setPoints(toMapPoints(sampleOrbitPath(o, e.relativePosition, moonConfig.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: moonConfig.soiRadius }), e.moonPosition));
        toMapPosition(e.moonPosition, ghostMoon.position);
        ghostMoon.visible = true;
        if (withMarker) {
          encounterMarker.visible = true;
          toMapPosition(vec3.add(apsisPositions(o, e.relativePosition).periapsis, e.moonPosition), encounterMarker.position);
          size(encounterMarker, 0.8);
        }
      };
      if (encounter && flying) showEncounter(encounter, encounterPath, true);

      // 분리된 단
      simulation.debris.forEach((d, i) => {
        if (!debrisMarkers[i]) {
          debrisMarkers[i] = makeMarker(0x888888);
          scene.add(debrisMarkers[i]);
        }
        toMapPosition(d.position, debrisMarkers[i].position);
        size(debrisMarkers[i], 0.6);
        debrisMarkers[i].visible = true;
      });
      for (let i = simulation.debris.length; i < debrisMarkers.length; i++) debrisMarkers[i].visible = false;

      // 부스터 착륙 지점
      const zone = simulation.booster?.landingZone;
      zoneMarker.visible = Boolean(zone);
      if (zone) {
        toMapPosition(zone, zoneMarker.position);
        size(zoneMarker, 0.8);
      }

      // 우주 정거장과 그 궤도선
      const station = simulation.station;
      stationMarker.visible = Boolean(station);
      stationPath.visible = false;
      if (station) {
        toMapPosition(station.position, stationMarker.position);
        size(stationMarker, 0.9);
        const stationOrbit = simulation.getOrbit(station);
        stationPath.setPoints(toMapPoints(sampleOrbitPath(stationOrbit, station.position, config.planet.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: config.planet.radius * 20 })));
      }

      // 기동 노드와 실행 후 예상 궤도 (노드 위치·궤도는 지금 기준 천체 상대 좌표)
      const m = state === simulation.state ? simulation.getManeuverInfo() : null;
      const after = m && !m.executing ? m : null;
      nodeMarker.visible = Boolean(after);
      afterPath.visible = afterEncounterPath.visible = false;
      const afterEncounter = after && after.referenceBody === 'planet' ? simulation.getEncounters().afterManeuver : null;
      if (after) {
        const offset = body.position;
        toMapPosition(vec3.add(after.nodePosition, offset), nodeMarker.position);
        size(nodeMarker, 1.1);
        if (afterEncounter) {
          const duration = afterEncounter.time - after.nodeTime;
          afterPath.setPoints(toMapPoints(samplePathByTime(after.nodePosition, after.velocityAfter, body.mu, duration, MAX_PATH_POINTS - 1), offset));
          if (!encounter) showEncounter(afterEncounter, afterEncounterPath, false);
          else afterEncounterPath.setPoints(toMapPoints(sampleOrbitPath(afterEncounter.orbit, afterEncounter.relativePosition, moonConfig.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: moonConfig.soiRadius }), afterEncounter.moonPosition));
        } else {
          const maxRadius = body.id === 'moon' ? moonConfig.soiRadius : config.planet.radius * 20;
          afterPath.setPoints(toMapPoints(sampleOrbitPath(after.orbitAfter, after.nodePosition, body.mu, { segments: MAX_PATH_POINTS - 1, maxRadius }), offset));
        }
        // 점선 간격: 노드까지 거리에 비례 (화면에서 비슷한 길이)
        const dash = camera.position.distanceTo(nodeMarker.position) * MARKER_SCREEN_SIZE;
        afterPath.setDash(dash * 2, dash * 1.2);
        afterEncounterPath.setDash(dash * 2, dash * 1.2);
      }
      // 대기권 고리 점선
      const atmoDash = camera.position.length() * MARKER_SCREEN_SIZE;
      atmosphereRing.setDash(atmoDash * 1.5, atmoDash);

      // 글자
      const { width, height } = viewport;
      const t = simulation.getTelemetry();
      const nodeText = after
        ? `기동 노드 · Δv ${after.deltaV.toFixed(0)} m/s${afterEncounter ? ` · 달 근접 ${formatPeriapsisText(afterEncounter.periapsisAltitude)}` : ''}`
        : '';
      placeLabel(labels.node, nodeMarker, camera, width, height, nodeText);
      placeLabel(labels.station, stationMarker, camera, width, height);
      placeLabel(labels.rocket, rocketMarker, camera, width, height, state === simulation.state ? `로켓 · ${formatDistance(t.altitude)}` : '부스터');
      placeLabel(labels.zone, zoneMarker, camera, width, height);
      placeLabel(labels.ap, apMarker, camera, width, height, `원지점 ${formatDistance(orbit.apoapsisAltitude)}${t.timeToApoapsis !== null ? ` · ${shortTime(t.timeToApoapsis)} 뒤` : ''}`);
      placeLabel(labels.pe, peMarker, camera, width, height, `${body.id === 'moon' ? '달 ' : ''}근지점 ${formatDistance(orbit.periapsisAltitude)}${t.timeToPeriapsis !== null ? ` · ${shortTime(t.timeToPeriapsis)} 뒤` : ''}`);
      placeLabel(labels.moon, moonGroup, camera, width, height, '🌕 달');
      placeLabel(labels.planet, planet, camera, width, height, '🌍 행성');
      placeLabel(labels.encounter, encounterMarker, camera, width, height, encounter ? `달 근접 ${formatPeriapsisText(encounter.periapsisAltitude)}` : '');

      // 초점 버튼 강조
      for (const button of labelRoot.querySelectorAll('[data-focus]')) button.setAttribute('aria-pressed', String(button.dataset.focus === focusMode));

      // 궤도 정보판
      const incl = orbitInclinationDeg(orbit);
      const rows = [
        ['기준 천체', body.id === 'moon' ? '🌕 달' : '🌍 행성'],
        ['원지점', orbit.escape ? '탈출 궤도 (∞)' : formatDistance(orbit.apoapsisAltitude)],
        ['근지점', orbit.periapsisAltitude < 0 ? '지표 아래 (충돌)' : formatDistance(orbit.periapsisAltitude)],
        ['이심률', orbit.eccentricity.toFixed(3)],
        ['공전 주기', Number.isFinite(orbit.period) ? shortTime(orbit.period) : '-'],
        ['궤도 경사', `${incl.toFixed(1)}°`],
        ...(encounter ? [['달 조우', `${shortTime(encounter.timeToEncounter)} 뒤 · ${formatPeriapsisText(encounter.periapsisAltitude)}`]] : []),
        ...(m ? [['기동 노드', `${shortTime(Math.max(0, m.timeToNode))} 뒤 · Δv ${m.deltaV.toFixed(0)} m/s`]] : []),
      ];
      const html = `<b>궤도 정보</b><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
      if (info.innerHTML !== html) info.innerHTML = html;
      info.hidden = !flying;
    },
  };
}

/** 궤도 경사 (적도면 = 발사 궤도면 기준, °) */
function orbitInclinationDeg(orbit) {
  const h = orbit.angularMomentum;
  const hl = vec3.length(h);
  if (hl < 1e-9) return 0;
  // 발사 궤도면의 법선은 −Z (북극 방향), 반대로 돌면 180°
  return (Math.acos(Math.max(-1, Math.min(1, -h[2] / hl))) * 180) / Math.PI;
}

/** 짧은 시간 표시 */
function shortTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}시간 ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}분`;
  if (s >= 60) return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
  return `${s}초`;
}

/** 달 근접 고도 글: 음수면 충돌 */
function formatPeriapsisText(altitude) {
  return altitude < 0 ? '충돌 궤도!' : formatDistance(altitude);
}

/** 지름 1 짜리 구 마커 (scale 로 크기 조절) */
function makeMarker(color) {
  return new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), new THREE.MeshBasicMaterial({ color }));
}
