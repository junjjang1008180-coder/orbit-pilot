/**
 * 비행 HUD (헤드업 디스플레이)
 * ------------------------------------------------------------
 * 시뮬레이션 텔레메트리를 읽어서 보여주기만 한다. 물리 상태를 바꾸지 않는다.
 * 아직 구현되지 않은 값은 숫자를 지어내지 않고 "미구현" 으로 표시한다.
 */
import { formatNumber, formatDistance, formatSpeed } from './format.js';

/** @param {HTMLElement} root */
export function createHud(root) {
  root.innerHTML = `
    <div class="hud-banner" data-id="banner" role="status" aria-live="polite"></div>
    <ul class="hud-warnings" data-id="warnings" aria-live="polite"></ul>
    <div class="hud-warp" data-id="warp"></div>

    <div class="hud-left-stack">
      <section class="hud-box hud-landing" data-id="landing-box" aria-label="부스터 착륙 안내" hidden>
        <div class="hud-landing-title" data-id="landing-title"></div>
        <dl class="hud-values" data-id="landing"></dl>
      </section>
      <section class="hud-box hud-maneuver" data-id="maneuver-box" aria-label="기동 계획" hidden></section>
      <section class="hud-box hud-target" data-id="target-box" aria-label="도킹 목표" hidden>
        <div class="hud-target-title" data-id="target-title"></div>
        <dl class="hud-values" data-id="target"></dl>
        <div class="hud-target-hint" data-id="target-hint"></div>
      </section>
    </div>

    <section class="hud-box hud-flight" aria-label="비행 정보">
      <dl class="hud-values" data-id="flight"></dl>
      <div class="hud-q">
        <div class="hud-throttle-label">동압 <b data-id="q-text"></b></div>
        <div class="hud-throttle-bar"><div class="hud-q-fill" data-id="q-fill"></div></div>
      </div>
    </section>

    <section class="hud-box hud-engine" aria-label="엔진 정보">
      <div class="hud-autopilot" data-id="autopilot"></div>
      <div class="hud-throttle">
        <div class="hud-throttle-label">스로틀 <b data-id="throttle-text"></b></div>
        <div class="hud-throttle-bar"><div class="hud-throttle-fill" data-id="throttle-fill"></div></div>
      </div>
      <dl class="hud-values" data-id="engine"></dl>
    </section>

    <section class="hud-box hud-keys" aria-label="조작 키">
      <div class="hud-keys-title">조작</div>
      <ul>
        <li><kbd>Shift</kbd>/<kbd>Ctrl</kbd> 스로틀 ↑/↓</li>
        <li><kbd>Z</kbd> 스로틀 최대 · <kbd>X</kbd> 엔진 끄기</li>
        <li><kbd>W</kbd>/<kbd>S</kbd> 기수 내리기/올리기</li>
        <li><kbd>A</kbd>/<kbd>D</kbd> 요 좌/우 · <kbd>Q</kbd>/<kbd>E</kbd> 롤</li>
        <li><kbd>Space</kbd> 단 분리 · <kbd>Backspace</kbd> 비상 중단</li>
        <li><kbd>M</kbd> 지도(궤도) 화면 전환</li>
        <li><kbd>B</kbd> 로켓 ↔ 분리된 부스터 조종 전환</li>
        <li><kbd>T</kbd> 자세 보조 모드 · <kbd>G</kbd> 자동 비행</li>
        <li><kbd>.</kbd>/<kbd>,</kbd> 시간 가속 빠르게/느리게</li>
        <li><kbd>R</kbd> RCS · <kbd>H</kbd>/<kbd>N</kbd> 앞뒤 · <kbd>J</kbd>/<kbd>L</kbd> 좌우 · <kbd>I</kbd>/<kbd>K</kbd> 아래위 · <kbd>U</kbd> 분리</li>
        <li><kbd>P</kbd> 낙하산 펼치기</li>
        <li>우클릭 드래그 카메라 회전 · 휠 확대/축소</li>
      </ul>
    </section>
  `;
  const $ = (id) => root.querySelector(`[data-id="${id}"]`);
  const banner = $('banner');
  const flight = $('flight');
  const engine = $('engine');
  const throttleText = $('throttle-text');
  const throttleFill = $('throttle-fill');
  const qText = $('q-text');
  const qFill = $('q-fill');
  const warnings = $('warnings');
  const landingBox = $('landing-box');
  const landingTitle = $('landing-title');
  const landingRows = $('landing');
  const autopilotBox = $('autopilot');
  const warpBox = $('warp');
  const targetBox = $('target-box');
  const targetTitle = $('target-title');
  const targetRows = $('target');
  const targetHint = $('target-hint');

  const rows = (list) =>
    list.map(([k, v, cls = '']) => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`).join('');

  /** 부스터 착륙 안내: 부스터를 조종 중일 때 기준과 현재 값을 나란히 보여준다 */
  function updateLanding(t) {
    const L = t.landing;
    const show = L.active && (t.controlledVehicle === 'booster' || L.result);
    landingBox.hidden = !show;
    if (!show) return;
    const lim = L.limits;
    // 착륙 결과가 나왔으면 땅에 닿던 순간의 기록값을, 아니면 현재 값을 보여준다
    const td = L.result && t.touchdown ? t.touchdown : null;
    const descent = td ? td.verticalSpeed : Math.max(0, -t.verticalSpeed);
    const horizontal = td ? td.horizontalSpeed : t.horizontalSpeed;
    const tilt = td ? td.tiltDeg : L.tiltDeg;
    const check = (ok) => (ok ? 'hud-ok' : 'hud-warn');
    landingTitle.textContent = L.result
      ? L.result === 'success' ? '✅ 부스터 착륙 성공' : `💥 부스터 착륙 실패 — ${L.reason}`
      : '부스터 착륙: 노란 표시(착륙 지점)에 수직으로 내리세요';
    landingBox.dataset.result = L.result ?? '';
    if (t.controlledVehicle !== 'booster') {
      landingRows.innerHTML = '';
      return;
    }
    landingRows.innerHTML = rows([
      ['착륙 지점까지', L.distanceToZone === null ? '예측 불가' : formatDistance(L.distanceToZone), L.distanceToZone !== null && L.distanceToZone <= lim.landingZoneRadius ? 'hud-ok' : ''],
      ['착륙 지점 방위', L.bearingDeg === null ? '-' : `${formatNumber(L.bearingDeg, 0).padStart(3, '0')}° <small>(네비볼 노란 □)</small>`],
      [td ? '착지 하강 속도' : '하강 속도', `${formatNumber(descent, 1)} / ${lim.maxVerticalSpeed} m/s`, check(descent <= lim.maxVerticalSpeed)],
      [td ? '착지 수평 속도' : '수평 속도', `${formatNumber(horizontal, 1)} / ${lim.maxHorizontalSpeed} m/s`, check(horizontal <= lim.maxHorizontalSpeed)],
      [td ? '착지 기울기' : '기울기', `${formatNumber(tilt, 1)}° / ${lim.maxTiltDeg}°`, check(tilt <= lim.maxTiltDeg)],
    ]);
  }

  /** 도킹 목표 안내: 포트 거리·상대 속도·접근 속도·정렬을 기준과 함께 보여준다 */
  function updateTarget(t) {
    const g = t.target;
    targetBox.hidden = !g;
    if (!g) return;
    const lim = g.limits;
    const check = (ok) => (ok ? 'hud-ok' : '');
    targetBox.dataset.docked = String(t.docked);
    targetTitle.textContent = t.docked ? '🛰 정거장에 도킹됨' : `🎯 목표: ${g.name}`;
    if (t.docked) {
      targetRows.innerHTML = '';
      targetHint.innerHTML = '<kbd>U</kbd> 로 분리할 수 있어요';
      return;
    }
    const near = g.portDistance < 300;
    targetRows.innerHTML = rows([
      ['포트까지 거리', formatDistance(g.portDistance), check(g.portDistance <= lim.captureDistance)],
      ['상대 속도', `${formatNumber(g.relativeSpeed, 2)} m/s${near ? ` <small>/ ${lim.maxRelativeSpeed}</small>` : ''}`, near ? check(g.relativeSpeed <= lim.maxRelativeSpeed) : ''],
      ['접근 속도', `${formatNumber(g.closingSpeed, 2)} m/s`, g.closingSpeed < 0 ? 'hud-warn' : ''],
      ...(near
        ? [
            ['정렬', `${formatNumber(g.alignmentDeg, 1)}° <small>/ ${lim.maxAlignmentDeg}°</small>`, check(g.alignmentDeg <= lim.maxAlignmentDeg)],
            ['축에서 벗어남', `${formatNumber(g.lateralOffset, 2)} m`],
          ]
        : []),
      ['RCS', t.rcsEnabled ? '켜짐 <small>(H/N·J/L·I/K)</small>' : '꺼짐 <small>(R)</small>', t.rcsEnabled ? 'hud-ok' : ''],
    ]);
    targetHint.innerHTML = !g.hasDockingPort
      ? '⚠ 맨 위에 도킹 포트(캡슐)가 없어 도킹할 수 없어요'
      : g.autoDockAvailable && t.autopilot.program !== 'docking'
        ? '<kbd>G</kbd> 자동 도킹 가능 · 네비볼 자주색 ○ = 정거장 방향'
        : '네비볼 자주색 ○ = 정거장 방향 · 하늘색 ○ = 상대 진행';
  }

  return {
    /** 기동 패널을 붙일 자리 (main 에서 패널을 만든다) */
    maneuverRoot: $('maneuver-box'),
    /** @param {ReturnType<import('../core/simulation.js').FlightSimulation['getTelemetry']>} t */
    update(t) {
      // 달 중력권 안에서는 고도·속도·궤도가 모두 달 기준이다
      const onMoon = t.referenceBody?.id === 'moon';
      const tag = onMoon ? ' <span class="hud-body-chip">달 기준</span>' : '';
      const e = t.encounter;
      flight.innerHTML = rows([
        [`고도${tag}`, formatDistance(t.altitude)],
        ['속도', formatSpeed(t.speed)],
        ['수직 속도', formatSpeed(t.verticalSpeed)],
        ['수평 속도', formatSpeed(t.horizontalSpeed)],
        ['원지점', apoapsisText(t)],
        ['근지점', periapsisText(t), t.impactTrajectory && !t.landed ? 'hud-warn' : ''],
        ['궤도', orbitStatusText(t), (onMoon ? t.moonOrbitAchieved : t.orbitAchieved) ? 'hud-ok' : ''],
        ...thermalRows(t),
        ...(e
          ? [['달 조우', `${formatDuration(e.timeToEncounter)} 뒤 · 근접 ${e.periapsisAltitude < 0 ? '충돌!' : formatDistance(e.periapsisAltitude)}`, e.periapsisAltitude < 0 ? 'hud-warn' : 'hud-ok']]
          : []),
      ]);

      // 경고 기준은 설정 파일에 있으므로, 색상도 경고 판정 결과(t.warnings)를 그대로 따른다
      const hasWarning = (id) => t.warnings.some((w) => w.id === id);
      const qRatio = t.maxQLimit > 0 ? t.dynamicPressure / t.maxQLimit : 0;
      qText.textContent = `${formatNumber(t.dynamicPressure / 1000, 2)} kPa / ${formatNumber(t.maxQLimit / 1000, 0)}`;
      qFill.style.width = `${Math.min(100, qRatio * 100)}%`;
      qFill.dataset.level = t.destroyed ? 'danger' : hasWarning('maxq') ? 'warn' : 'ok';

      const throttlePercent = t.throttle * 100;
      throttleText.textContent = `${formatNumber(throttlePercent, 0)}%`;
      throttleFill.style.width = `${throttlePercent}%`;

      engine.innerHTML = rows([
        ['엔진', engineLabel(t)],
        ['추력', `${formatNumber(t.thrust / 1000, 1)} kN`],
        ['TWR', `${formatNumber(t.twr, 2)} <small>(최대 ${formatNumber(t.maxTwr, 2)})</small>`, t.canLiftOff ? '' : 'hud-warn'],
        ['남은 연료', `${formatNumber(t.fuel, 0)} kg <small>(${formatNumber(t.fuelRatio * 100, 0)}%)</small>`, hasWarning('lowfuel') || hasWarning('flameout') ? 'hud-warn' : ''],
        ['연료 소모', `${formatNumber(t.massFlow, 1)} kg/s`],
        ['총질량', `${formatNumber(t.mass, 0)} kg`],
        t.controlledVehicle === 'booster'
          ? ['조종 중', '1단 부스터 <small>(B: 로켓으로)</small>']
          : ['현재 단계', `${t.currentStage + 1} / ${t.stageCount} 단${t.canStage ? ' <small>(Space 분리)</small>' : ''}`],
      ]);

      warnings.innerHTML = t.warnings
        .filter((w) => w.id !== 'destroyed') // 파손은 상단 배너에 표시
        .map((w) => `<li data-level="${w.level}">⚠ ${w.text}</li>`)
        .join('');

      updateLanding(t);
      updateTarget(t);

      // 시간 가속 표시
      const w = t.timeWarp;
      warpBox.dataset.on = String(w.selected > 1);
      warpBox.innerHTML = `⏩ 시간 <b>×${w.factor}</b>${w.selected > w.factor ? ` <small>(×${w.selected} 선택 · ${w.reason}이라 제한)</small>` : ''} <kbd>,</kbd><kbd>.</kbd>`;

      // 자동조종 상태
      const ap = t.autopilot;
      autopilotBox.innerHTML = `
        <span class="hud-ap-chip" data-on="${ap.sas !== 'off'}">자세 보조 <b>${ap.sasLabel}</b> <kbd>T</kbd></span>
        <span class="hud-ap-chip" data-on="${Boolean(ap.program)}">자동 비행 <b>${ap.program ? `${ap.programLabel}${ap.phase ? ` · ${PHASE_LABELS[ap.phase] ?? ap.phase}` : ''}` : '꺼짐'}</b> <kbd>G</kbd></span>`;

      const status = bannerStatus(t);
      banner.textContent = status.text;
      banner.dataset.level = status.level;
      banner.hidden = !status.text;
    },
  };
}

const PHASE_LABELS = {
  ascent: '상승·중력 선회',
  coast: '관성 비행',
  circularize: '원궤도 연소',
  descent: '감속 하강',
  final: '최종 착륙',
  approach: '접근',
  align: '정렬',
  dock: '도킹 접근',
  waitBurn: '점화 대기',
  burn: '연소 중',
  deorbit: '수평 속도 줄이기',
  retroBurn: '역추진 (근지점 낮추기)',
  separate: '회수 캡슐만 남기기',
  entry: '재진입 (열 차폐막 앞으로)',
  chute: '낙하산 하강',
};

/** 초 → "1시간 05분" · "12분 30초" · "45초" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${String(m).padStart(2, '0')}분`;
  if (m > 0) return `${m}분 ${String(sec).padStart(2, '0')}초`;
  return `${sec}초`;
}

/** 표면 온도(뜨거울 때)와 낙하산 상태 줄 */
function thermalRows(t) {
  const list = [];
  const hot = t.skinTemperature > 500 || t.heatFlux > 1_000;
  if (hot) {
    const limit = Number.isFinite(t.thermalLimit) ? `${formatNumber(t.thermalLimit, 0)} K` : '-';
    const ratio = Number.isFinite(t.thermalLimit) ? t.skinTemperature / t.thermalLimit : 0;
    list.push([
      '표면 온도',
      `🔥 ${formatNumber(t.skinTemperature, 0)} / ${limit} <small>${t.heatShielded ? '(열 차폐막)' : '(차폐 없음)'}</small>`,
      ratio > t.thermalWarningRatio ? 'hud-warn' : t.heatShielded ? 'hud-ok' : '',
    ]);
  }
  const p = t.parachute;
  if (p?.available) {
    const text =
      p.state === 'torn' ? '찢어짐'
      : p.state === 'deployed' ? (p.area >= p.fullArea - 1e-6 ? '다 펼침' : `펼치는 중 (${formatNumber(p.area, 0)} m²)`)
      : p.safeToDeploy ? '접힘 — <kbd>P</kbd> 로 펼칠 수 있어요'
      : `접힘 <small>(${formatNumber(p.maxDeploySpeed, 0)} m/s 아래에서 P)</small>`;
    list.push(['낙하산', text, p.state === 'torn' ? 'hud-warn' : p.state === 'deployed' || p.safeToDeploy ? 'hud-ok' : '']);
  }
  return list;
}

function apoapsisText(t) {
  if (t.landed) return '-';
  if (t.escapeTrajectory) return '탈출 궤도 (∞)';
  return formatDistance(t.apoapsisAltitude);
}

function periapsisText(t) {
  if (t.landed) return '-';
  if (t.periapsisAltitude < 0) return '지표 아래 (충돌 궤도)';
  return formatDistance(t.periapsisAltitude);
}

function orbitStatusText(t) {
  if (t.landed) return t.landedOn === 'moon' ? '달 표면' : '지상';
  if (t.referenceBody?.id === 'moon') {
    if (t.escapeTrajectory) return '달 근접 비행 (감속하면 달 궤도)';
    if (t.impactTrajectory) return '달로 하강 중';
    return `달 궤도 (이심률 ${t.eccentricity.toFixed(3)})`;
  }
  if (t.orbitAchieved) return t.orbitCircularNow ? '원궤도 진입 성공' : '진입 성공 (현재 조건 벗어남)';
  if (t.escapeTrajectory) return '탈출 궤도';
  if (t.impactTrajectory) return '탄도 비행';
  return `궤도 (이심률 ${t.eccentricity.toFixed(3)})`;
}

function engineLabel(t) {
  if (t.destroyed) return '파손';
  if (t.aborted) return '비상 중단';
  if (t.flameout) return '연소 종료 (연료 없음)';
  if (!t.engineOn) return '꺼짐';
  return t.throttle > 0 ? '가동 중' : '점화 (스로틀 0%)';
}

function bannerStatus(t) {
  if (t.autopilot?.message && !t.destroyed) return { text: `🤖 ${t.autopilot.message}`, level: 'info' };
  if (t.destroyed) return { text: `기체 파손 — ${t.destroyedReason} (재시작 버튼으로 다시 시작)`, level: 'danger' };
  if (t.aborted) return { text: '비상 중단 — 엔진 정지, 조종 잠김 (재시작 버튼으로 다시 시작)', level: 'danger' };
  if (t.landed && t.hasLiftedOff && t.landedOn !== 'moon' && t.touchdown?.safe) {
    return { text: t.parachute?.state === 'deployed' ? '🪂 낙하산으로 안전하게 내려왔어요 — 회수 완료' : '안전하게 착지했어요', level: 'success' };
  }
  if (t.landed && !t.canLiftOff && !t.hasLiftedOff) {
    return { text: `이륙 불가: 최대 TWR ${formatNumber(t.maxTwr, 2)} ≤ 1 — 추력이 무게보다 작습니다`, level: 'warn' };
  }
  if (t.liftoffBlocked) return { text: '추력 부족 — 스로틀을 더 올리세요 (Shift 또는 Z)', level: 'warn' };
  if (t.landed && t.landedOn === 'moon') return { text: '🌕 달 표면에 착륙했어요 — Shift 또는 Z 로 다시 이륙할 수 있어요', level: 'success' };
  if (t.landed && !t.engineOn) return { text: '발사 준비 완료 — Shift 또는 Z 로 엔진 점화', level: 'info' };
  if (t.orbitAchieved && t.orbitCircularNow) return { text: '🛰 원궤도 진입 성공!', level: 'success' };
  if (t.controlledVehicle === 'rocket' && t.boosterAvailable) return { text: '부스터 분리됨 — B 키로 부스터를 조종해 착륙시킬 수 있습니다', level: 'info' };
  return { text: '', level: 'info' };
}
