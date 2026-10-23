/**
 * 튜토리얼 화면 (안내 카드 + 강조 표시)
 * ------------------------------------------------------------
 * - 매 프레임 update(ctx) 로 현재 단계의 완료 조건을 검사하고, 끝나면 잠시 ✓ 를 보여 준 뒤 다음 단계로 넘어간다.
 * - 설명하는 화면 요소에는 강조 테두리(.tutorial-highlight)를 붙인다.
 * - 기체가 부서지거나 비상 중단하면 재시작하라고 알려 주고, 재시작하면 점화 단계부터 다시 안내한다.
 * - 처음 방문한 사용자에게는 튜토리얼을 권하는 카드를 한 번 보여 준다.
 * 게임 상태는 읽기만 하며, 조작은 사용자가 직접 한다.
 */
import { TUTORIAL_STEPS, RESTART_STEP_ID, isStepDone } from './tutorialSteps.js';

const ADVANCE_DELAY = 0.9; // 완료 후 다음 단계로 넘어가기까지 (s)
const SEEN_KEY = 'orbitPilot.tutorialSeen';

/**
 * @param {HTMLElement} root
 * @param {{ onStart: () => void }} actions 튜토리얼 시작 (설계 화면 준비)
 */
export function createTutorial(root, actions) {
  let active = false;
  let index = 0;
  let completedAt = null; // 현재 단계를 끝낸 시각 (s)
  let cameraBase = 0; // 단계 시작 시점의 카메라 조작 횟수
  let highlighted = [];
  let lastCtx = null;

  root.classList.add('tutorial');
  root.hidden = true;

  function clearHighlight() {
    for (const el of highlighted) el.classList.remove('tutorial-highlight');
    highlighted = [];
  }

  function applyHighlight(selector) {
    clearHighlight();
    if (!selector) return;
    highlighted = [...document.querySelectorAll(selector)];
    for (const el of highlighted) el.classList.add('tutorial-highlight');
  }

  function render(ctx) {
    const step = TUTORIAL_STEPS[index];
    const done = completedAt !== null;
    const crashed = ctx?.telemetry && (ctx.telemetry.destroyed || ctx.telemetry.aborted) && step.phase === 'flight' && !step.final;
    const needsButton = !step.done || step.skippable;
    root.dataset.phase = step.phase;
    root.innerHTML = `
      <div class="tutorial-card" role="dialog" aria-label="튜토리얼">
        <div class="tutorial-progress">📘 튜토리얼 ${index + 1} / ${TUTORIAL_STEPS.length}</div>
        <h3>${done ? '✅ ' : ''}${step.title}</h3>
        <p>${step.body}</p>
        ${crashed ? '<p class="tutorial-alert">💥 기체가 부서졌거나 비상 중단했어요. 미션 패널의 <b>재시작</b>을 누르면 점화 단계부터 다시 안내할게요.</p>' : ''}
        ${!needsButton && !done && !step.final ? '<p class="tutorial-wait">⏳ 직접 해 보세요 — 끝나면 자동으로 다음 단계로 넘어가요.</p>' : ''}
        <div class="tutorial-buttons">
          ${step.final ? '<button type="button" data-act="close" class="primary">튜토리얼 끝내기</button>' : ''}
          ${!step.final && needsButton ? `<button type="button" data-act="next" class="primary">${step.skippable ? '건너뛰기' : '다음'}</button>` : ''}
          ${!step.final && !needsButton ? '<button type="button" data-act="next">이 단계 건너뛰기</button>' : ''}
          ${!step.final ? '<button type="button" data-act="close">튜토리얼 끝내기</button>' : ''}
        </div>
      </div>`;
    root.querySelector('[data-act="next"]')?.addEventListener('click', (e) => {
      e.currentTarget.blur();
      goTo(index + 1);
    });
    root.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', () => stop()));
    root.dataset.signature = signature(ctx);
  }

  /** 다시 그려야 하는지 판단할 요약값 (매 프레임 innerHTML 을 바꾸지 않도록) */
  function signature(ctx) {
    const t = ctx?.telemetry;
    return [index, completedAt !== null, Boolean(t && (t.destroyed || t.aborted))].join('|');
  }

  function goTo(i) {
    index = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, i));
    completedAt = null;
    cameraBase = lastCtx?.cameraInteractions ?? 0;
    const step = TUTORIAL_STEPS[index];
    // 단계 화면(설계/비행)에 맞는 요소가 그려진 뒤 강조
    requestAnimationFrame(() => applyHighlight(step.highlight));
    render(lastCtx);
  }

  function stop() {
    active = false;
    root.hidden = true;
    clearHighlight();
    markSeen();
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* 저장소를 쓸 수 없으면 무시 */
    }
  }

  return {
    isActive: () => active,
    getStep: () => TUTORIAL_STEPS[index],

    /** 튜토리얼 처음부터 시작 */
    start() {
      active = true;
      root.hidden = false;
      actions.onStart();
      goTo(0);
    },

    stop,

    /** 비행을 재시작했을 때: 점화 단계보다 뒤였다면 점화 단계로 돌아간다 */
    onFlightRestart() {
      if (!active) return;
      const restartIndex = TUTORIAL_STEPS.findIndex((s) => s.id === RESTART_STEP_ID);
      if (index > restartIndex) goTo(restartIndex);
    },

    /** 설계 화면으로 돌아갔을 때: 발사 단계로 */
    onBackToDesign() {
      if (!active) return;
      goTo(TUTORIAL_STEPS.findIndex((s) => s.id === 'design-launch'));
    },

    /**
     * 매 프레임 호출
     * @param {{appMode:string, viewMode:string, telemetry:object|null, cameraInteractions:number}} ctx
     * @param {number} time 현재 시각 (s)
     */
    update(ctx, time) {
      lastCtx = ctx;
      if (!active) return;
      const step = TUTORIAL_STEPS[index];
      const fullCtx = { ...ctx, cameraMoved: ctx.cameraInteractions > cameraBase };
      if (completedAt === null && isStepDone(step, fullCtx)) completedAt = time;
      if (completedAt !== null && time - completedAt >= ADVANCE_DELAY && !step.final) {
        goTo(index + 1);
        return;
      }
      if (root.dataset.signature !== signature(ctx)) render(ctx);
    },

    /** 처음 방문이면 튜토리얼을 권하는 카드를 보여 준다 */
    offerIfFirstVisit() {
      let seen = false;
      try {
        seen = localStorage.getItem(SEEN_KEY) === '1';
      } catch {
        seen = false;
      }
      if (seen) return false;
      root.hidden = false;
      root.dataset.phase = 'design';
      root.innerHTML = `
        <div class="tutorial-card tutorial-offer" role="dialog" aria-label="튜토리얼 권유">
          <h3>🚀 ORBIT PILOT 이 처음이세요?</h3>
          <p>로켓 설계부터 궤도 진입까지 한 단계씩 안내하는 <b>튜토리얼</b>로 시작해 보세요. 약 5분 걸려요.</p>
          <div class="tutorial-buttons">
            <button type="button" data-act="start" class="primary">튜토리얼 시작</button>
            <button type="button" data-act="dismiss">괜찮아요</button>
          </div>
        </div>`;
      root.querySelector('[data-act="start"]').addEventListener('click', () => this.start());
      root.querySelector('[data-act="dismiss"]').addEventListener('click', () => {
        root.hidden = true;
        markSeen();
      });
      return true;
    },
  };
}
