/**
 * 난이도 설정
 * ------------------------------------------------------------
 * 난이도는 물리 설정(PHYSICS_CONFIG)의 일부 기준값을 바꾸고, 직접 조종을 돕는 보조 기능을 켜고 끈다.
 *   쉬움   : 기체가 더 튼튼하고(Max-Q·열·착지 기준 완화), 보조 기능을 모두 켠다
 *   보통   : 원래 기준 + 비행 가이드
 *   어려움 : 기준이 더 엄격하고 보조 기능 없음
 * 보조 기능
 *   guide        : 비행 가이드 — 지금 할 일을 글로 알려 주고, 네비볼에 가이드 방향(◇)을 표시
 *   throttleLimit: 자동 스로틀 제한 — 직접 조종 중 동압이 한계에 가까우면 스로틀을 자동으로 낮춤
 *   autoStage    : 자동 단 분리 — 직접 조종 중 현재 단 연료가 다 떨어지면 자동으로 분리
 */

export const DIFFICULTY_LEVELS = Object.freeze({
  easy: {
    name: '쉬움',
    description: '기체가 튼튼해요 (Max-Q 25 kPa · 착지 수직 10 m/s · 수평 5 m/s · 기울기 20° · 열 60%). 비행 가이드 · 자동 스로틀 제한 · 자동 단 분리가 켜져요.',
    assists: { guide: true, throttleLimit: true, autoStage: true },
    physics: {
      aerodynamics: { maxDynamicPressure: 25_000 },
      landing: { maxVerticalSpeed: 10, maxHorizontalSpeed: 5, maxTiltDeg: 20, landingZoneRadius: 80 },
      heatingFluxScale: 0.6,
      parachute: { maxDeploySpeed: 450, maxDeployDynamicPressure: 18_000 },
    },
  },
  normal: {
    name: '보통',
    description: '원래 기준이에요. 비행 가이드가 지금 할 일을 알려 줘요.',
    assists: { guide: true, throttleLimit: false, autoStage: false },
    physics: {},
  },
  hard: {
    name: '어려움',
    description: '기준이 엄격해요 (Max-Q 12 kPa · 착지 수직 4 m/s · 수평 2 m/s · 기울기 7° · 열 130%). 보조 기능이 없어요. 낙하산 회수는 낙하산 2개가 필요해요.',
    assists: { guide: false, throttleLimit: false, autoStage: false },
    physics: {
      aerodynamics: { maxDynamicPressure: 12_000 },
      landing: { maxVerticalSpeed: 4, maxHorizontalSpeed: 2, maxTiltDeg: 7, landingZoneRadius: 25 },
      heatingFluxScale: 1.3,
    },
  },
});

export const DEFAULT_DIFFICULTY = 'normal';

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

/**
 * 난이도를 적용한 새 물리 설정 (원래 설정은 바꾸지 않는다)
 * @param {object} baseConfig PHYSICS_CONFIG
 * @param {string} level 'easy' | 'normal' | 'hard'
 */
export function applyDifficulty(baseConfig, level) {
  const d = DIFFICULTY_LEVELS[level] ?? DIFFICULTY_LEVELS[DEFAULT_DIFFICULTY];
  const config = structuredClone(baseConfig);
  const p = d.physics;
  if (p.aerodynamics) Object.assign(config.aerodynamics, p.aerodynamics);
  if (p.landing) Object.assign(config.landing, p.landing);
  if (p.parachute && config.parachute) Object.assign(config.parachute, p.parachute);
  if (p.heatingFluxScale && config.heating) config.heating.fluxCoefficient *= p.heatingFluxScale;
  config.difficulty = { level: DIFFICULTY_LEVELS[level] ? level : DEFAULT_DIFFICULTY, name: d.name, assists: { ...d.assists } };
  return deepFreeze(config);
}
