/**
 * 활주로 (우주 왕복선 착륙) — 여러 곳
 * ------------------------------------------------------------
 * config.runways 의 각 활주로는 발사장에서 동쪽으로 distanceEast (북쪽으로 distanceNorth) 만큼 떨어진 곳에
 * 동서 방향으로 놓인다. 적도 궤도의 지상 궤적을 따라 있으므로 궤도를 돌 때마다 위를 지나간다.
 * 길이·너비·여유는 모두 같다 (config.runway).
 * 활주로 좌표: along = 활주로 가운데에서 동쪽(+)으로 잰 거리, cross = 북쪽(+)으로 잰 거리 (m, 지표를 따라),
 *              height = 해수면 고도. 서쪽 끝(along = −length/2)이 착륙 진입 쪽(시작점)이다.
 * 행성 곡률(4.5 km 에서 약 4 m 처짐)을 따라 각도로 계산한다.
 * runway 인자를 빼면 첫 번째 활주로(발사장 활주로)를 쓴다. isOnRunway 는 runway 를 빼면 "어느 활주로든" 이다.
 */
import { vec3 } from '../physics/vectorMath.js';
import { localFrame } from '../physics/referenceFrame.js';

const cache = new WeakMap(); // config → Map(id → frame)

/** 활주로 목록 (설정에 목록이 없으면 config.runway 하나) */
export function runwayList(config) {
  return config.runways ?? [{ id: 'home', name: '활주로', distanceEast: config.runway.distanceEast, distanceNorth: 0 }];
}

/** id 로 활주로 찾기 (없거나 빼면 첫 번째) */
export function getRunway(config, id = null) {
  const list = runwayList(config);
  return (id && list.find((r) => r.id === id)) || list[0];
}

/** 활주로 기준 방향들 (가운데 지점의 위·동·북 단위벡터) */
export function runwayFrame(config, runway = null) {
  const r = runway ?? runwayList(config)[0];
  if (!cache.has(config)) cache.set(config, new Map());
  const byId = cache.get(config);
  if (byId.has(r.id)) return byId.get(r.id);
  const R = config.planet.radius;
  const site = vec3.normalize(config.launchSite.direction);
  const siteFrame = localFrame(vec3.scale(site, R), config.planet.northPoleDirection);
  const theta = r.distanceEast / R;
  const phi = (r.distanceNorth ?? 0) / R;
  const eastward = vec3.add(vec3.scale(site, Math.cos(theta)), vec3.scale(siteFrame.east, Math.sin(theta)));
  const up = vec3.normalize(vec3.add(vec3.scale(eastward, Math.cos(phi)), vec3.scale(siteFrame.north, Math.sin(phi))));
  const frame = localFrame(vec3.scale(up, R), config.planet.northPoleDirection);
  const result = {
    id: r.id,
    name: r.name,
    terrain: r.terrain ?? 'grass',
    up, // 가운데 지점의 위 (행성 중심 → 활주로 가운데)
    east: frame.east, // 활주로 방향 (착륙하며 달리는 쪽)
    north: frame.north,
    halfLength: config.runway.length / 2,
    halfWidth: config.runway.width / 2,
  };
  byId.set(r.id, result);
  return result;
}

/** 활주로 좌표 → 물리 위치 (m) */
export function runwayPoint(config, along, cross = 0, height = 0, runway = null) {
  const f = runwayFrame(config, runway);
  const R = config.planet.radius;
  const a = along / R;
  const c = cross / R;
  // 가운데에서 동쪽으로 a, 북쪽으로 c 만큼 돈 방향
  const dir = vec3.normalize(vec3.add(vec3.add(vec3.scale(f.up, Math.cos(a) * Math.cos(c)), vec3.scale(f.east, Math.sin(a) * Math.cos(c))), vec3.scale(f.north, Math.sin(c))));
  return vec3.scale(dir, R + height);
}

/** 물리 위치 → 활주로 좌표 {along, cross, height} */
export function runwayCoords(config, position, runway = null) {
  const f = runwayFrame(config, runway);
  const R = config.planet.radius;
  const r = vec3.length(position);
  const d = vec3.scale(position, 1 / r);
  const along = R * Math.atan2(vec3.dot(d, f.east), vec3.dot(d, f.up));
  const cross = R * Math.asin(Math.max(-1, Math.min(1, vec3.dot(d, f.north))));
  return { along, cross, height: r - R };
}

/**
 * 활주로 위인지 (margin: 너비·길이에 더하는 여유, m)
 * @param {object|null} [runway] 빼면 어느 활주로든 — 위에 있는 활주로를 돌려준다
 * @returns {boolean|object} runway 를 주면 true/false, 빼면 그 활주로 또는 null
 */
export function isOnRunway(config, position, margin = 0, runway = undefined) {
  const check = (r) => {
    const f = runwayFrame(config, r);
    const { along, cross } = runwayCoords(config, position, r);
    return Math.abs(along) <= f.halfLength + margin && Math.abs(cross) <= f.halfWidth + margin;
  };
  if (runway !== undefined) return check(runway);
  return runwayList(config).find(check) ?? null;
}

/** 가장 가까운 활주로 (지표 거리 기준) */
export function nearestRunway(config, position) {
  const d = vec3.normalize(position);
  let best = null;
  let bestDot = -Infinity;
  for (const r of runwayList(config)) {
    const dot = vec3.dot(d, runwayFrame(config, r).up);
    if (dot > bestDot) {
      bestDot = dot;
      best = r;
    }
  }
  return best;
}
