/**
 * 비행 화면 미션 패널과 결과 창
 * ------------------------------------------------------------
 * 미션 추적기의 상태를 보여주고, 재시작·설계로 돌아가기 버튼을 제공한다.
 * 결과가 나오면(성공·실패) 점수 내역 창을 띄운다. 물리 상태는 바꾸지 않는다.
 */
import { formatNumber } from './format.js';

/**
 * @param {HTMLElement} panelRoot 왼쪽 위 미션 패널
 * @param {HTMLElement} resultRoot 결과 창
 * @param {{ onRestart: () => void, onBackToDesign: () => void, onToggleSound?: () => boolean }} actions
 */
export function createMissionPanel(panelRoot, resultRoot, actions) {
  panelRoot.innerHTML = `
    <div class="panel-title">🎯 <span data-id="name"></span></div>
    <div class="mission-progress" data-id="progress"></div>
    <div class="mission-status" data-id="status"></div>
    <div class="panel-buttons">
      <button type="button" data-id="restart">재시작</button>
      <button type="button" data-id="design">설계로</button>
      <button type="button" data-id="sound" aria-label="소리 켜기/끄기">🔊</button>
    </div>
  `;
  const $ = (id) => panelRoot.querySelector(`[data-id="${id}"]`);
  const blurAfter = (fn) => (e) => {
    e.currentTarget.blur(); // Space 가 버튼을 누르지 않게 포커스 해제
    fn();
  };
  $('restart').addEventListener('click', blurAfter(actions.onRestart));
  $('design').addEventListener('click', blurAfter(actions.onBackToDesign));
  $('sound').addEventListener('click', blurAfter(() => {
    const muted = actions.onToggleSound?.();
    $('sound').textContent = muted ? '🔇' : '🔊';
  }));

  resultRoot.hidden = true;
  let shownResultFor = null; // 이미 결과 창을 띄운 비행

  function showResult(status) {
    const r = status.result;
    const success = status.status === 'success';
    const scoreRows = success
      ? r.score.items
          .map((item) => `<tr><td>${item.label}</td><td>${describeValue(item)}</td><td>${item.points === null ? '해당 없음' : `${item.points} 점`}</td></tr>`)
          .join('')
      : '';
    resultRoot.innerHTML = `
      <div class="result-card" role="dialog" aria-label="미션 결과">
        <h2 class="${success ? 'ok' : 'bad'}">${success ? '🎉 미션 성공' : '💥 미션 실패'}</h2>
        <p><b>${status.name}</b> · ${r.reason} · 비행 시간 ${formatNumber(r.time, 0)} s</p>
        ${success ? `<table class="result-table"><thead><tr><th>항목</th><th>값</th><th>점수</th></tr></thead><tbody>${scoreRows}</tbody>
          <tfoot><tr><td colspan="2">총점</td><td>${r.score.total} 점</td></tr></tfoot></table>` : '<p>점수는 미션에 성공해야 계산됩니다.</p>'}
        <div class="panel-buttons">
          <button type="button" data-id="r-restart">다시 비행</button>
          <button type="button" data-id="r-design">설계로 돌아가기</button>
          <button type="button" data-id="r-close">닫고 계속 비행</button>
        </div>
      </div>`;
    resultRoot.hidden = false;
    resultRoot.querySelector('[data-id="r-restart"]').addEventListener('click', () => {
      resultRoot.hidden = true;
      actions.onRestart();
    });
    resultRoot.querySelector('[data-id="r-design"]').addEventListener('click', () => {
      resultRoot.hidden = true;
      actions.onBackToDesign();
    });
    resultRoot.querySelector('[data-id="r-close"]').addEventListener('click', () => {
      resultRoot.hidden = true;
    });
  }

  return {
    /**
     * @param {ReturnType<ReturnType<typeof import('../missions/missionTracker.js').createMissionTracker>['getStatus']>} status
     * @param {object} flightKey 지금 비행을 구분하는 값 (재시작하면 바뀜)
     */
    update(status, flightKey) {
      $('name').textContent = status.name;
      $('progress').textContent = status.progress;
      const label = { active: status.unsupported ? '판정 불가 (기능 미구현)' : '진행 중', success: '성공', failed: '실패' }[status.status];
      const statusEl = $('status');
      statusEl.textContent = status.status === 'failed' ? `${label} — ${status.result.reason}` : status.status === 'success' ? `${label} — ${status.result.score.total} 점` : label;
      statusEl.dataset.level = status.status === 'success' ? 'ok' : status.status === 'failed' ? 'danger' : status.unsupported ? 'warn' : 'info';

      if (status.status !== 'active' && shownResultFor !== flightKey) {
        shownResultFor = flightKey;
        showResult(status);
      }
    },
    hideResult() {
      resultRoot.hidden = true;
    },
  };
}

function describeValue(item) {
  if (item.id === 'fuel') return `${formatNumber(item.value * 100, 0)}%`;
  if (item.id === 'orbit') return item.value === null ? '해당 없음' : `${formatNumber(item.value * 100, 0)}%`;
  if (item.id === 'landing') return item.value === null ? '해당 없음' : item.value ? '성공' : '실패';
  return '-';
}
