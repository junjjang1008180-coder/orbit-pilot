/**
 * 지도(궤도) 화면
 * ------------------------------------------------------------
 * 행성 전체, 대기권, 달(궤도·중력권), 로켓 현재 위치, 분리된 단, 예상 궤도선, 원지점·근지점을
 * 1 단위 = 1 km 로 줄인 별도 3D 장면에 그린다.
 * 궤도선과 원·근지점은 비행 화면 HUD 와 같은 궤도 계산(기준 천체에 대한 상대 궤도) 결과를 쓴다.
 *   - 달 중력권 안: 달 기준 궤도를 지금 달 위치에 겹쳐 그린다 (카메라도 달을 바라본다)
 *   - 달 조우가 예상되면: 조우 지점까지 궤도선 + 그 뒤 달 기준 경로를 "조우 순간의 달" 둘레에 그린다
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

const MAX_PATH_POINTS = 400; // 궤도선 최대 점 개수
const MARKER_SCREEN_SIZE = 0.012; // 마커 크기 (카메라 거리 대비 비율, 화면에서 일정한 크기)

/**
 * @param {object} config PHYSICS_CONFIG
 * @param {HTMLElement} labelRoot 원지점·근지점 글자를 붙일 HTML 요소
 */
export function createMapView(config, labelRoot) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03060d);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
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
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, wireframe: true, transparent: true, opacity: 0.07 }),
  );
  // 대기권: 대기 상한 고도의 아주 옅은 구 + 가장자리 빛
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(toMapLength(config.planet.radius + config.atmosphere.topAltitude), 96, 48),
    new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.05, depthWrite: false }),
  );
  const glow = createAtmosphereGlow(toMapLength(config.planet.radius + config.atmosphere.topAltitude) * 1.01);
  scene.add(planet, clouds, grid, atmosphere, glow.mesh);

  // 발사장 표시
  const site = makeMarker(0xff8844);
  toMapPosition(config.launchSite.direction.map((v) => v * config.planet.radius), site.position);
  scene.add(site);

  // 달: 구 + 중력권(옅은 구) + 공전 궤도선 + 조우 순간의 달(반투명)
  const moonConfig = config.moon;
  const moonGroup = new THREE.Group();
  const ghostMoon = new THREE.Group();
  if (moonConfig) {
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(toMapLength(moonConfig.radius), 96, 48),
      new THREE.MeshStandardMaterial({ map: createMoonTexture(), roughness: 1 }),
    );
    moonMesh.rotation.x = GLOBE_ROTATION_X;
    const soi = new THREE.Mesh(
      new THREE.SphereGeometry(toMapLength(moonConfig.soiRadius), 48, 24),
      new THREE.MeshBasicMaterial({ color: 0xb8a6ff, transparent: true, opacity: 0.06, depthWrite: false }),
    );
    const soiRing = new THREE.Mesh(
      new THREE.SphereGeometry(toMapLength(moonConfig.soiRadius), 24, 12),
      new THREE.MeshBasicMaterial({ color: 0xb8a6ff, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    moonGroup.add(moonMesh, soi, soiRing);
    scene.add(moonGroup);

    const orbitPoints = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      orbitPoints.push(new THREE.Vector3(Math.sin(a), Math.cos(a), 0).multiplyScalar(toMapLength(moonConfig.orbitRadius)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPoints), new THREE.LineBasicMaterial({ color: 0x8c8aa6, transparent: true, opacity: 0.45 })));

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

  // 선 하나 (점 버퍼를 미리 잡아 두고 매 프레임 점만 바꾼다)
  function makePath(material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PATH_POINTS * 3), 3));
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    return line;
  }
  const scratch = new THREE.Vector3();
  /** 점 목록(m)을 offset(m) 만큼 옮겨 선에 넣는다 */
  function setPath(line, points, offset = [0, 0, 0]) {
    const attr = line.geometry.getAttribute('position');
    const count = Math.min(points.length, MAX_PATH_POINTS);
    for (let i = 0; i < count; i++) {
      toMapPosition(vec3.add(points[i], offset), scratch);
      attr.setXYZ(i, scratch.x, scratch.y, scratch.z);
    }
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, count);
    if (line.material.isLineDashedMaterial) line.computeLineDistances();
    line.visible = count > 1;
  }

  // 예상 궤도선 (지금 궤도), 조우 뒤 달 기준 경로
  const pathLine = makePath(new THREE.LineBasicMaterial({ color: 0x4fd1ff }));
  const encounterPath = makePath(new THREE.LineBasicMaterial({ color: 0xc58cff }));

  // 로켓·원지점·근지점 마커
  const rocketMarker = makeMarker(0xffffff);
  const apMarker = makeMarker(0x5aa9ff);
  const peMarker = makeMarker(0xffb547);
  const encounterMarker = makeMarker(0xc58cff); // 달 근접 지점
  encounterMarker.visible = false;
  const zoneMarker = makeMarker(0xffd43b); // 부스터 착륙 지점
  zoneMarker.visible = false;
  const stationMarker = makeMarker(0xd65cff); // 우주 정거장
  stationMarker.visible = false;
  scene.add(rocketMarker, apMarker, peMarker, encounterMarker, zoneMarker, stationMarker);
  // 기동 노드: 노드 위치 마커 + 실행 후 예상 궤도(점선) + 실행 후 조우 경로(점선)
  const nodeMarker = makeMarker(0x2f80ed);
  nodeMarker.visible = false;
  scene.add(nodeMarker);
  const afterPath = makePath(new THREE.LineDashedMaterial({ color: 0xff9f43, dashSize: 25, gapSize: 15 }));
  const afterEncounterPath = makePath(new THREE.LineDashedMaterial({ color: 0xffc078, dashSize: 25, gapSize: 15 }));

  // 정거장 궤도선
  const stationPath = makePath(new THREE.LineBasicMaterial({ color: 0xd65cff, transparent: true, opacity: 0.7 }));
  const debrisMarkers = [];

  // HTML 글자 표시
  labelRoot.innerHTML = `
    <div class="map-label map-label-rocket" data-id="rocket">로켓</div>
    <div class="map-label map-label-ap" data-id="ap"></div>
    <div class="map-label map-label-pe" data-id="pe"></div>
    <div class="map-label map-label-zone" data-id="zone">착륙 지점</div>
    <div class="map-label map-label-station" data-id="station">우주 정거장</div>
    <div class="map-label map-label-node" data-id="node">기동 노드</div>
    <div class="map-label map-label-moon" data-id="moon">달</div>
    <div class="map-label map-label-encounter" data-id="encounter"></div>
    <div class="map-legend">지도 화면 · <kbd>M</kbd> 비행 화면으로 · 궤도선 클릭 = 기동 노드 · 우클릭 드래그 회전 · 휠 확대/축소</div>
  `;
  const labels = {
    rocket: labelRoot.querySelector('[data-id="rocket"]'),
    ap: labelRoot.querySelector('[data-id="ap"]'),
    pe: labelRoot.querySelector('[data-id="pe"]'),
    zone: labelRoot.querySelector('[data-id="zone"]'),
    station: labelRoot.querySelector('[data-id="station"]'),
    node: labelRoot.querySelector('[data-id="node"]'),
    moon: labelRoot.querySelector('[data-id="moon"]'),
    encounter: labelRoot.querySelector('[data-id="encounter"]'),
  };

  const projected = new THREE.Vector3();
  function placeLabel(label, object, camera, width, height, text) {
    if (!object.visible) {
      label.hidden = true;
      return;
    }
    object.getWorldPosition(projected).project(camera);
    label.hidden = projected.z > 1;
    label.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px)`;
    if (text !== undefined) label.textContent = text;
  }

  /**
   * 로켓 본체의 "앞으로 지나갈 궤도" (기준 천체 상대 위치·속도와, 조우가 있으면 그 시각까지)
   * @returns {{body:object, rel:{position:number[], velocity:number[]}, horizon:number}}
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

  return {
    scene,
    /** 카메라가 바라볼 중심 (지도 좌표)과 그 천체 반지름 (지도 단위) */
    focusFor(simulation) {
      const body = simulation.getReference(simulation.getControlled());
      return { id: body.id, target: toMapPosition(body.position, new THREE.Vector3()), radius: toMapLength(body.radius) };
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
     */
    update(simulation, camera, viewport) {
      const state = simulation.getControlled();
      // 마커 크기: 카메라와의 거리에 비례해 화면에서 일정하게
      const size = (marker, factor = 1) => marker.scale.setScalar(camera.position.distanceTo(marker.position) * MARKER_SCREEN_SIZE * factor);

      // 달 (지금 위치)
      const moonNow = moonConfig ? moonState(config, state.time) : null;
      if (moonNow) toMapPosition(moonNow.position, moonGroup.position);

      // 지금 궤도선: 기준 천체 기준 궤도를 그 천체의 지금 위치에 겹쳐 그린다
      const { body, rel, horizon, orbit, encounter } = futureTrack(simulation, state);
      const flying = !state.landed && !state.destroyed;
      if (encounter) {
        setPath(pathLine, samplePathByTime(rel.position, rel.velocity, body.mu, horizon, MAX_PATH_POINTS - 1));
      } else {
        const maxRadius = body.id === 'moon' ? moonConfig.soiRadius : config.planet.radius * 20;
        setPath(pathLine, sampleOrbitPath(orbit, rel.position, body.mu, { segments: MAX_PATH_POINTS - 1, maxRadius }), body.position);
      }
      if (!flying) pathLine.visible = false;

      toMapPosition(state.position, rocketMarker.position);
      size(rocketMarker);
      size(site, 0.7);

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
      if (encounter && flying) showEncounter(encounter, encounterPath, true);

      function showEncounter(e, line, withMarker) {
        const o = e.orbit;
        setPath(line, sampleOrbitPath(o, e.relativePosition, moonConfig.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: moonConfig.soiRadius }), e.moonPosition);
        toMapPosition(e.moonPosition, ghostMoon.position);
        ghostMoon.visible = true;
        if (withMarker) {
          encounterMarker.visible = true;
          toMapPosition(vec3.add(apsisPositions(o, e.relativePosition).periapsis, e.moonPosition), encounterMarker.position);
          size(encounterMarker, 0.8);
        }
      }

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
        setPath(stationPath, sampleOrbitPath(stationOrbit, station.position, config.planet.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: config.planet.radius * 20 }));
      }

      // 기동 노드와 실행 후 예상 궤도 (노드 위치·궤도는 지금 기준 천체 상대 좌표)
      const m = state === simulation.state ? simulation.getManeuverInfo() : null;
      const after = m && !m.executing ? m : null;
      nodeMarker.visible = Boolean(after);
      afterPath.visible = afterEncounterPath.visible = false;
      if (after) {
        const offset = body.position;
        toMapPosition(vec3.add(after.nodePosition, offset), nodeMarker.position);
        size(nodeMarker, 1.1);
        const afterEncounter = after.referenceBody === 'planet' ? simulation.getEncounters().afterManeuver : null;
        if (afterEncounter) {
          const duration = afterEncounter.time - after.nodeTime;
          setPath(afterPath, samplePathByTime(after.nodePosition, after.velocityAfter, body.mu, duration, MAX_PATH_POINTS - 1), offset);
          if (!encounter) showEncounter(afterEncounter, afterEncounterPath, false);
          else setPath(afterEncounterPath, sampleOrbitPath(afterEncounter.orbit, afterEncounter.relativePosition, moonConfig.mu, { segments: MAX_PATH_POINTS - 1, maxRadius: moonConfig.soiRadius }), afterEncounter.moonPosition);
        } else {
          const maxRadius = body.id === 'moon' ? moonConfig.soiRadius : config.planet.radius * 20;
          setPath(afterPath, sampleOrbitPath(after.orbitAfter, after.nodePosition, body.mu, { segments: MAX_PATH_POINTS - 1, maxRadius }), offset);
        }
        const dash = camera.position.distanceTo(nodeMarker.position) * MARKER_SCREEN_SIZE;
        for (const line of [afterPath, afterEncounterPath]) {
          line.material.dashSize = dash * 2;
          line.material.gapSize = dash * 1.2;
        }
      }

      // 글자
      const { width, height } = viewport;
      const afterEncounter = after && after.referenceBody === 'planet' ? simulation.getEncounters().afterManeuver : null;
      const nodeText = after
        ? `기동 노드 · Δv ${after.deltaV.toFixed(0)} m/s${afterEncounter ? ` · 달 근접 ${formatPeriapsisText(afterEncounter.periapsisAltitude)}` : ''}`
        : '';
      placeLabel(labels.node, nodeMarker, camera, width, height, nodeText);
      placeLabel(labels.station, stationMarker, camera, width, height);
      placeLabel(labels.rocket, rocketMarker, camera, width, height, state === simulation.state ? '로켓' : '부스터');
      placeLabel(labels.zone, zoneMarker, camera, width, height);
      placeLabel(labels.ap, apMarker, camera, width, height, `원지점 ${formatDistance(orbit.apoapsisAltitude)}`);
      placeLabel(labels.pe, peMarker, camera, width, height, `${body.id === 'moon' ? '달 ' : ''}근지점 ${formatDistance(orbit.periapsisAltitude)}`);
      placeLabel(labels.moon, moonGroup, camera, width, height, '달');
      placeLabel(labels.encounter, encounterMarker, camera, width, height, encounter ? `달 근접 ${formatPeriapsisText(encounter.periapsisAltitude)}` : '');
    },
  };
}

/** 달 근접 고도 글: 음수면 충돌 */
function formatPeriapsisText(altitude) {
  return altitude < 0 ? '충돌 궤도!' : formatDistance(altitude);
}

/** 지름 1 짜리 구 마커 (scale 로 크기 조절) */
function makeMarker(color) {
  return new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), new THREE.MeshBasicMaterial({ color }));
}
