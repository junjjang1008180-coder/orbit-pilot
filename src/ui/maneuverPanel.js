/**
 * 기동 노드 패널
 * ------------------------------------------------------------
 * - 노드가 없을 때: 원지점·근지점에 노드, 원궤도 만들기, 달 전이 계획(또는 달 근접 보정) 버튼과 지도 클릭 안내
 * - 노드가 있을 때: 진행·법선·방사 Δv 와 시각을 단위(1/10/100)별로 조절, 연소 시간·실행 후 궤도 표시,
 *   자동 실행(G 와 같음)과 삭제 버튼
 * 버튼은 한 번만 만들고 글자만 매 프레임 바꾼다 (다시 그리면 누르는 도중 클릭이 사라지므로).
 * 물리 상태는 전달받은 명령 함수로만 바꾼다.
 */
import { formatNumber, formatDistance } from './format.js';

const STEPS = [1, 10, 100]; // Δv 조절 단위 (m/s)
const TIME_STEP_FOR = { 1: 10, 10: 60, 100: 300 }; // 단위별 시각 조절 (s)

/**
 * @param {HTMLElement} root
 * @param {{
 *   create: (which: 'apoapsis'|'periapsis') => void,
 *   circularize: () => void,
 *   moonTransfer: () => void,
 *   adjust: (delta: object) => void,
 *   remove: () => void,
 *   execute: () => void,
 * }} actions
 */
export function createManeuverPanel(root, actions) {
  root.innerHTML = `
    <div class="hud-maneuver-title">🧭 기동 계획</div>
    <div data-id="empty">
      <p class="hud-maneuver-hint">지도(<kbd>M</kbd>)에서 궤도선을 클릭하거나, 아래 버튼으로 노드를 만드세요.</p>
      <div class="hud-maneuver-buttons">
        <button type="button" data-act="create-apo">원지점에 노드</button>
        <button type="button" data-act="create-peri">근지점에 노드</button>
        <button type="button" data-act="circularize">원궤도 만들기</button>
        <button type="button" data-act="moon" class="primary">🌕 달 전이 계획</button>
      </div>
    </div>
    <div data-id="edit" hidden>
      <div class="hud-maneuver-time" data-id="time"></div>
      <div class="hud-maneuver-steps" role="group" aria-label="조절 단위">
        ${STEPS.map((s) => `<button type="button" data-step="${s}">${s} m/s</button>`).join('')}
      </div>
      ${[
        ['prograde', '진행'],
        ['normal', '법선'],
        ['radial', '방사'],
        ['time', '시각'],
      ]
        .map(
          ([key, label]) => `
        <div class="hud-maneuver-row">
          <span>${label}</span>
          <button type="button" data-adj="${key}" data-sign="-1" aria-label="${label} 줄이기">−</button>
          <b data-id="v-${key}"></b>
          <button type="button" data-adj="${key}" data-sign="1" aria-label="${label} 늘리기">+</button>
        </div>`,
        )
        .join('')}
      <dl class="hud-values" data-id="summary"></dl>
      <div class="hud-maneuver-warn" data-id="warn"></div>
      <div class="hud-maneuver-buttons">
        <button type="button" data-act="execute" class="primary">자동 실행 <kbd>G</kbd></button>
        <button type="button" data-act="remove">삭제</button>
      </div>
    </div>`;
  const $ = (id) => root.querySelector(`[data-id="${id}"]`);
  let step = 10;

  const blur = (e) => e.currentTarget.blur(); // Space·키 입력이 버튼으로 가지 않게
  root.querySelector('[data-act="create-apo"]').addEventListener('click', (e) => {
    blur(e);
    actions.create('apoapsis');
  });
  root.querySelector('[data-act="create-peri"]').addEventListener('click', (e) => {
    blur(e);
    actions.create('periapsis');
  });
  root.querySelector('[data-act="circularize"]').addEventListener('click', (e) => {
    blur(e);
    actions.circularize();
  });
  root.querySelector('[data-act="moon"]').addEventListener('click', (e) => {
    blur(e);
    actions.moonTransfer();
  });
  root.querySelector('[data-act="execute"]').addEventListener('click', (e) => {
    blur(e);
    actions.execute();
  });
  root.querySelector('[data-act="remove"]').addEventListener('click', (e) => {
    blur(e);
    actions.remove();
  });
  root.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', (e) => {
      blur(e);
      step = Number(b.dataset.step);
      renderSteps();
    }),
  );
  root.querySelectorAll('[data-adj]').forEach((b) =>
    b.addEventListener('click', (e) => {
      blur(e);
      const key = b.dataset.adj;
      const sign = Number(b.dataset.sign);
      actions.adjust(key === 'time' ? { time: sign * TIME_STEP_FOR[step] } : { [key]: sign * step });
    }),
  );
  function renderSteps() {
    root.querySelectorAll('[data-step]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.step) === step)));
    $('v-time').dataset.unit = `±${TIME_STEP_FOR[step]} s`;
  }
  renderSteps();

  return {
    /** @param {object} t 텔레메트리 (조종 중인 비행체) */
    update(t) {
      const canPlan = t.controlledVehicle === 'rocket' && !t.landed && !t.docked && !t.destroyed;
      root.hidden = !canPlan && !t.maneuver;
      if (root.hidden) return;
      const m = t.maneuver;
      $('empty').hidden = Boolean(m);
      $('edit').hidden = !m;
      if (!m) {
        // 달 전이: 행성 중력권에서만. 이미 달까지 가는 궤도면 근접 고도 보정
        const moonButton = root.querySelector('[data-act="moon"]');
        moonButton.hidden = !t.moonAvailable || t.referenceBody?.id !== 'planet';
        moonButton.textContent = t.encounter ? '🌕 달 근접 보정' : '🌕 달 전이 계획';
        return;
      }
      const n = m.node;
      $('time').innerHTML = m.executing
        ? `🔥 실행 중 · 남은 Δv <b>${formatNumber(m.remaining, 1)} m/s</b>`
        : `노드까지 <b>T−${formatDuration(m.timeToNode)}</b> · 점화 T−${formatDuration(Math.max(0, m.timeToBurnStart))}`;
      $('v-prograde').textContent = `${formatNumber(n.prograde, 1)}`;
      $('v-normal').textContent = `${formatNumber(n.normal, 1)}`;
      $('v-radial').textContent = `${formatNumber(n.radial, 1)}`;
      $('v-time').textContent = `${$('v-time').dataset.unit}`;
      root.querySelectorAll('[data-adj]').forEach((b) => (b.disabled = m.executing));
      const o = m.orbitAfter;
      $('summary').innerHTML = [
        ['Δv 합계', `${formatNumber(m.deltaV, 1)} m/s`],
        ['연소 시간', Number.isFinite(m.burnTime) ? `${formatNumber(m.burnTime, 1)} s` : '엔진 없음'],
        ['실행 후 원지점', o.escape ? '탈출 궤도 (∞)' : formatDistance(o.apoapsisAltitude)],
        ['실행 후 근지점', o.periapsisAltitude < 0 ? '지표 아래' : formatDistance(o.periapsisAltitude)],
        ...(m.encounter
          ? [['실행 후 달 근접', m.encounter.periapsisAltitude < 0 ? '⚠ 달 충돌 궤도' : `${formatDistance(m.encounter.periapsisAltitude)} <small>(${formatDuration(m.encounter.time - t.time)} 뒤 진입)</small>`]]
          : []),
      ]
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('');
      $('warn').textContent = m.enoughFuel ? '' : '⚠ 현재 단 연료로는 부족해요 (다음 단으로 이어서 연소)';
    },
  };
}

/** 초 → "1분 05초" 같은 표시 */
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${String(m).padStart(2, '0')}분`;
  if (m > 0) return `${m}분 ${String(sec).padStart(2, '0')}초`;
  return `${sec}초`;
}
