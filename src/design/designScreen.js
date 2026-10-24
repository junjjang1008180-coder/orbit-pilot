/**
 * 로켓 설계 화면
 * ------------------------------------------------------------
 * - 왼쪽 부품 목록에서 부품을 끌어다(드래그 앤 드롭) 가운데 조립대에 위아래로 쌓는다.
 * - 조립대 안에서 끌어 순서를 바꾸고, 휴지통으로 끌거나 × 로 뺀다.
 * - 부품(목록·조립대·3D 미리보기)을 클릭하면 부품 정보를 보여준다.
 * - 조립 내용이 바뀔 때마다 총질량·TWR·Δv 를 다시 계산해 표시한다.
 * - 미션을 고르고, 유효한 설계일 때만 발사 버튼이 켜진다.
 * 부품 수치는 PHYSICS_CONFIG.parts 에서만 읽는다.
 */
import { insertPart, removePart, movePart, analyzeDesign, stackFromDefinition } from './designModel.js';
import { createDesignPreview } from './designPreview.js';
import { createDesignStore, encodeDesign, decodeDesign, validateDesign } from './designStorage.js';
import { formatNumber } from '../ui/format.js';

const KIND_LABELS = { engine: '엔진', tank: '연료탱크', decoupler: '단 분리기', payload: '탑재물', heatShield: '열 차폐막', parachute: '낙하산' };
const KIND_ORDER = ['engine', 'tank', 'decoupler', 'payload', 'heatShield', 'parachute'];
const DRAG_TYPE = 'application/x-orbit-pilot-part';

/**
 * @param {HTMLElement} root
 * @param {{
 *   physicsConfig: object,
 *   missionConfig: object,
 *   presets: Record<string, {name:string, stages:{parts:string[]}[]}>,
 *   initialPreset: string,
 *   modelLibrary?: object,
 *   onLaunch: (launch: {definition:object, missionId:string, difficulty:string, analysis:object}) => void,
 *   difficulties?: Record<string, {name:string, description:string}>, initialDifficulty?: string,
 *   onTutorial?: () => void,
 * }} options
 */
export function createDesignScreen(root, options) {
  const { physicsConfig, missionConfig } = options;
  const parts = physicsConfig.parts;
  const store = options.designStore ?? createDesignStore();
  // 마지막으로 작업한 설계가 있으면 복원 (없거나 깨졌으면 기본 예시)
  let stack = stackFromDefinition(options.presets[options.initialPreset]);
  const last = store.loadLast();
  if (last) {
    try {
      stack = validateDesign({ stack: last }, parts).stack;
    } catch {
      /* 기본 예시 사용 */
    }
  }
  let selected = null; // { source: 'palette'|'stack', partId, index? }
  let missionId = missionConfig.defaultMission;
  const difficulties = options.difficulties ?? {};
  let difficulty = options.initialDifficulty ?? Object.keys(difficulties)[0] ?? 'normal';
  let analysis = null;

  root.innerHTML = `
    <header class="design-header">
      <div class="design-title">ORBIT PILOT <span>로켓 설계</span></div>
      <button type="button" class="design-tutorial" data-id="tutorial">📘 튜토리얼</button>
      <label class="design-mission">미션
        <select data-id="mission"></select>
      </label>
      <label class="design-mission design-difficulty">난이도
        <select data-id="difficulty"></select>
      </label>
      <button type="button" class="design-launch" data-id="launch">발사 ▶</button>
    </header>
    <p class="design-mission-desc" data-id="mission-desc"></p>
    <p class="design-mission-desc design-difficulty-desc" data-id="difficulty-desc"></p>
    <div class="design-body">
      <section class="design-palette" aria-label="부품 목록">
        <h2>부품 <small>끌어서 조립대에 놓기</small></h2>
        <div data-id="palette"></div>
        <div class="design-presets">
          <label>예시 설계 <select data-id="preset"></select></label>
          <button type="button" data-id="load-preset">불러오기</button>
          <button type="button" data-id="clear">모두 비우기</button>
        </div>
        <div class="design-saves">
          <h3>내 설계 <small>(이 브라우저에 저장)</small></h3>
          <div class="design-save-row">
            <input type="text" data-id="save-name" placeholder="설계 이름" maxlength="30" aria-label="설계 이름">
            <button type="button" data-id="save">저장</button>
          </div>
          <div class="design-save-row">
            <select data-id="saved" aria-label="저장된 설계"></select>
            <button type="button" data-id="load-saved">불러오기</button>
            <button type="button" data-id="delete-saved" aria-label="저장된 설계 삭제">삭제</button>
          </div>
          <button type="button" data-id="copy-code">공유 코드 복사</button>
          <div class="design-save-row">
            <input type="text" data-id="code-input" placeholder="OP1-… 코드 붙여넣기" aria-label="공유 코드">
            <button type="button" data-id="import">가져오기</button>
          </div>
          <p class="design-save-msg" data-id="save-msg" role="status"></p>
        </div>
      </section>
      <section class="design-preview" aria-label="3D 미리보기">
        <div class="design-preview-canvas" data-id="preview"></div>
        <div class="design-preview-hint">드래그: 회전 · 휠: 확대 · 클릭: 부품 정보</div>
      </section>
      <section class="design-stack" aria-label="조립대">
        <h2>조립대 <small>위 = 기수, 아래 = 엔진</small></h2>
        <ol class="design-stack-list" data-id="stack"></ol>
        <div class="design-trash" data-id="trash">🗑 여기로 끌어 놓으면 제거</div>
      </section>
      <section class="design-info" aria-label="설계 정보">
        <h2>부품 정보</h2>
        <div class="design-part-info" data-id="part-info">부품을 클릭하면 정보가 표시됩니다.</div>
        <h2>로켓 성능</h2>
        <div data-id="stats"></div>
        <ul class="design-issues" data-id="issues"></ul>
      </section>
    </div>
  `;
  const $ = (id) => root.querySelector(`[data-id="${id}"]`);

  // ── 미션 선택 ────────────────────────────────────────────
  const missionSelect = $('mission');
  for (const [id, m] of Object.entries(missionConfig.missions)) {
    missionSelect.add(new Option(m.name, id));
  }
  missionSelect.value = missionId;
  missionSelect.addEventListener('change', () => {
    missionId = missionSelect.value;
    renderMissionDesc();
  });
  function renderMissionDesc() {
    $('mission-desc').textContent = `🎯 ${missionConfig.missions[missionId].description}`;
  }

  // ── 난이도 선택 ──────────────────────────────────────────
  const difficultySelect = $('difficulty');
  for (const [id, d] of Object.entries(difficulties)) difficultySelect.add(new Option(d.name, id));
  difficultySelect.value = difficulty;
  difficultySelect.addEventListener('change', () => {
    difficulty = difficultySelect.value;
    renderDifficultyDesc();
    options.onDifficultyChange?.(difficulty);
  });
  function renderDifficultyDesc() {
    const d = difficulties[difficulty];
    $('difficulty-desc').textContent = d ? `🎚 난이도 ${d.name}: ${d.description}` : '';
  }
  renderDifficultyDesc();

  // ── 예시 설계 ────────────────────────────────────────────
  const presetSelect = $('preset');
  for (const [id, p] of Object.entries(options.presets)) presetSelect.add(new Option(p.name, id));
  presetSelect.value = options.initialPreset;
  $('load-preset').addEventListener('click', () => {
    stack = stackFromDefinition(options.presets[presetSelect.value]);
    selected = null;
    update();
  });
  $('clear').addEventListener('click', () => {
    stack = [];
    selected = null;
    update();
  });

  // ── 내 설계: 저장·불러오기·삭제·공유 코드 ─────────────────
  const savedSelect = $('saved');
  const saveMsg = $('save-msg');
  const say = (text, level = 'ok') => {
    saveMsg.textContent = text;
    saveMsg.dataset.level = level;
  };
  function renderSaved(selectName) {
    const list = store.list();
    savedSelect.innerHTML = list.length
      ? list.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)} (${d.stack.length}개)</option>`).join('')
      : '<option value="">저장된 설계 없음</option>';
    if (selectName) savedSelect.value = selectName;
    $('load-saved').disabled = $('delete-saved').disabled = list.length === 0;
  }
  if (!store.available) say('이 브라우저에서는 설계를 저장할 수 없어요. 공유 코드는 쓸 수 있어요.', 'warn');
  $('save').addEventListener('click', () => {
    if (stack.length === 0) return say('부품이 없는 설계는 저장할 수 없어요.', 'warn');
    const result = store.save($('save-name').value, stack);
    say(result.message, result.ok ? 'ok' : 'warn');
    if (result.ok) renderSaved($('save-name').value.trim());
  });
  $('load-saved').addEventListener('click', () => {
    const design = store.load(savedSelect.value);
    if (!design) return;
    try {
      stack = validateDesign(design, parts).stack;
      selected = null;
      $('save-name').value = design.name;
      update();
      say(`「${design.name}」 불러왔어요.`);
    } catch (error) {
      say(error.message, 'warn');
    }
  });
  $('delete-saved').addEventListener('click', () => {
    const name = savedSelect.value;
    if (!name) return;
    // 되돌릴 수 없으므로 한 번 더 확인
    if (!window.confirm(`저장된 설계 「${name}」 을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;
    store.remove(name);
    renderSaved();
    say(`「${name}」 삭제했어요.`);
  });
  $('copy-code').addEventListener('click', async () => {
    if (stack.length === 0) return say('부품이 없는 설계는 공유할 수 없어요.', 'warn');
    const code = encodeDesign({ name: $('save-name').value || '내 로켓', stack });
    try {
      await navigator.clipboard.writeText(code);
      say('공유 코드를 복사했어요. 다른 사람이 「가져오기」에 붙여 넣으면 같은 로켓이 돼요.');
    } catch {
      // 클립보드를 쓸 수 없으면 입력칸에 넣어 직접 복사하게 한다
      $('code-input').value = code;
      $('code-input').select();
      say('자동 복사가 막혀 있어요. 아래 칸의 코드를 직접 복사(⌘C)해 주세요.', 'warn');
    }
  });
  $('import').addEventListener('click', () => {
    try {
      const design = decodeDesign($('code-input').value, parts);
      stack = design.stack;
      selected = null;
      $('save-name').value = design.name;
      update();
      say(`「${design.name}」 가져왔어요. 저장하려면 「저장」을 누르세요.`);
    } catch (error) {
      say(error.message, 'warn');
    }
  });
  renderSaved();

  // ── 부품 목록 (드래그 시작점) ─────────────────────────────
  const palette = $('palette');
  for (const kind of KIND_ORDER) {
    const ids = Object.keys(parts).filter((id) => parts[id].kind === kind);
    if (!ids.length) continue;
    const group = document.createElement('div');
    group.className = 'design-palette-group';
    group.innerHTML = `<h3>${KIND_LABELS[kind]}</h3>`;
    for (const id of ids) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `design-part design-part-${kind}`;
      card.draggable = true;
      card.dataset.partId = id;
      card.innerHTML = `<b>${parts[id].name}</b><small>${shortSpec(parts[id])}</small>`;
      card.addEventListener('dragstart', (e) => startDrag(e, { source: 'palette', partId: id }));
      card.addEventListener('click', () => select({ source: 'palette', partId: id }));
      group.appendChild(card);
    }
    palette.appendChild(group);
  }

  function startDrag(event, payload) {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.partId);
    event.dataTransfer.effectAllowed = 'move';
    root.classList.add('is-dragging');
  }
  root.addEventListener('dragend', () => root.classList.remove('is-dragging'));

  function readDrag(event) {
    try {
      return JSON.parse(event.dataTransfer.getData(DRAG_TYPE));
    } catch {
      return null;
    }
  }

  /** gap 번호(아래에서부터 0..length)에 놓기 */
  function dropAt(event, gap) {
    event.preventDefault();
    root.classList.remove('is-dragging');
    const payload = readDrag(event);
    if (!payload) return;
    if (payload.source === 'palette') {
      stack = insertPart(stack, gap, payload.partId);
      selected = { source: 'stack', partId: payload.partId, index: gap };
    } else if (payload.source === 'stack') {
      stack = movePart(stack, payload.index, gap);
      const newIndex = gap > payload.index ? gap - 1 : gap;
      selected = { source: 'stack', partId: payload.partId, index: newIndex };
    }
    update();
  }

  // ── 휴지통 ───────────────────────────────────────────────
  const trash = $('trash');
  trash.addEventListener('dragover', (e) => {
    e.preventDefault();
    trash.classList.add('is-over');
  });
  trash.addEventListener('dragleave', () => trash.classList.remove('is-over'));
  trash.addEventListener('drop', (e) => {
    e.preventDefault();
    trash.classList.remove('is-over');
    root.classList.remove('is-dragging');
    const payload = readDrag(e);
    if (payload?.source === 'stack') {
      stack = removePart(stack, payload.index);
      selected = null;
      update();
    }
  });

  // ── 조립대 그리기 (화면 위 = 스택 위) ─────────────────────
  const stackList = $('stack');
  function makeGap(gap) {
    const li = document.createElement('li');
    li.className = 'design-gap';
    li.dataset.gap = String(gap);
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('is-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('is-over'));
    li.addEventListener('drop', (e) => dropAt(e, gap));
    return li;
  }

  function renderStack() {
    stackList.innerHTML = '';
    // 단 번호: 분리기를 지날 때마다 1 증가 (분리기는 아래 단에 속함)
    const stageOf = [];
    let stageNo = 1;
    stack.forEach((id, i) => {
      stageOf[i] = stageNo;
      if (parts[id].kind === 'decoupler') stageNo++;
    });

    stackList.appendChild(makeGap(stack.length));
    for (let i = stack.length - 1; i >= 0; i--) {
      const id = stack[i];
      const li = document.createElement('li');
      li.className = `design-stack-item design-part-${parts[id].kind}`;
      if (selected?.source === 'stack' && selected.index === i) li.classList.add('is-selected');
      li.draggable = true;
      li.dataset.index = String(i);
      li.innerHTML = `
        <span class="design-stage-tag">${stageOf[i]}단</span>
        <b>${parts[id].name}</b>
        <button type="button" class="design-remove" aria-label="${parts[id].name} 제거">×</button>`;
      li.addEventListener('dragstart', (e) => startDrag(e, { source: 'stack', partId: id, index: i }));
      li.addEventListener('click', (e) => {
        if (e.target.closest('.design-remove')) return;
        select({ source: 'stack', partId: id, index: i });
      });
      li.querySelector('.design-remove').addEventListener('click', () => {
        stack = removePart(stack, i);
        selected = null;
        update();
      });
      // 항목 위에 놓으면 그 항목 바로 위(gap i+1)에 넣는다
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => dropAt(e, i + 1));
      stackList.appendChild(li);
      stackList.appendChild(makeGap(i));
    }
    if (stack.length === 0) {
      stackList.firstChild.classList.add('design-gap-empty');
      stackList.firstChild.textContent = '여기에 부품을 끌어다 놓으세요';
    }
  }

  // ── 부품 정보 ────────────────────────────────────────────
  function select(sel) {
    selected = sel;
    renderStack();
    renderPartInfo();
    preview.setSelected(sel?.source === 'stack' ? sel.index : -1);
  }

  function renderPartInfo() {
    const box = $('part-info');
    if (!selected) {
      box.textContent = '부품을 클릭하면 정보가 표시됩니다.';
      return;
    }
    const p = parts[selected.partId];
    const rows = [
      ['종류', KIND_LABELS[p.kind]],
      ['건조 질량', `${formatNumber(p.dryMass, 0)} kg`],
      ['연료량', `${formatNumber(p.fuelMass, 0)} kg`],
      ['추력', p.thrust > 0 ? `${formatNumber(p.thrust / 1000, 0)} kN` : '-'],
      ['비추력', p.isp > 0 ? `${formatNumber(p.isp, 0)} s` : '-'],
      ['크기', `길이 ${formatNumber(p.length, 1)} m · 지름 ${formatNumber(p.radius * 2, 1)} m`],
      ['최고 온도', p.maxTemperature ? `${formatNumber(p.maxTemperature, 0)} K` : '-'],
      ...(p.kind === 'parachute' ? [['낙하산 면적', `${formatNumber(p.canopyArea, 0)} m² <small>(보조 ${formatNumber(p.semiArea, 0)} m²)</small>`]] : []),
      ...(p.kind === 'heatShield' ? [['쓰는 법', '회수 단 맨 아래에 두고, 재진입 때 꼬리를 진행 방향으로(역진행)']] : []),
    ];
    // 끌어 놓기가 어려운 경우(트랙패드·키보드)를 위한 버튼 조작
    const actions = selected.source === 'palette'
      ? '<button type="button" data-act="add-top">조립대 맨 위에 추가</button>'
      : `<button type="button" data-act="up" ${selected.index >= stack.length - 1 ? 'disabled' : ''}>▲ 위로</button>
         <button type="button" data-act="down" ${selected.index <= 0 ? 'disabled' : ''}>▼ 아래로</button>
         <button type="button" data-act="remove">제거</button>`;
    box.innerHTML = `<b>${p.name}</b>${selected.source === 'stack' ? ` <small>(조립대 ${selected.index + 1}번째, 아래부터)</small>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="design-part-actions">${actions}</div>`;
    box.querySelector('[data-act="add-top"]')?.addEventListener('click', () => {
      stack = insertPart(stack, stack.length, selected.partId);
      selected = { source: 'stack', partId: selected.partId, index: stack.length - 1 };
      update();
    });
    box.querySelector('[data-act="up"]')?.addEventListener('click', () => {
      stack = movePart(stack, selected.index, selected.index + 2);
      selected = { ...selected, index: selected.index + 1 };
      update();
    });
    box.querySelector('[data-act="down"]')?.addEventListener('click', () => {
      stack = movePart(stack, selected.index, selected.index - 1);
      selected = { ...selected, index: selected.index - 1 };
      update();
    });
    box.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
      stack = removePart(stack, selected.index);
      selected = null;
      update();
    });
  }

  // ── 성능·문제 표시 ────────────────────────────────────────
  function renderStats() {
    const a = analysis;
    const stageRows = a.stages
      .map((st) => `<tr><td>${st.index + 1}단</td><td>${formatNumber(st.ignitionMass, 0)}</td><td>${formatNumber(st.fuel, 0)}</td><td>${formatNumber(st.thrust / 1000, 0)}</td><td>${formatNumber(st.twr, 2)}</td><td>${formatNumber(st.deltaV, 0)}</td></tr>`)
      .join('');
    $('stats').innerHTML = `
      <dl class="design-summary">
        <dt>총질량</dt><dd>${formatNumber(a.totalMass, 0)} kg</dd>
        <dt>발사 TWR</dt><dd class="${a.launchTwr > 1 ? 'ok' : 'bad'}">${formatNumber(a.launchTwr, 2)}${a.launchTwr > 1 ? '' : ' (이륙 불가)'}</dd>
        <dt>예상 Δv</dt><dd>${formatNumber(a.totalDeltaV, 0)} m/s</dd>
        <dt>단 수</dt><dd>${a.stages.length}</dd>
      </dl>
      ${a.stages.length ? `<table class="design-stage-table">
        <thead><tr><th>단</th><th>점화 질량 kg</th><th>연료 kg</th><th>추력 kN</th><th>TWR</th><th>Δv m/s</th></tr></thead>
        <tbody>${stageRows}</tbody></table>` : ''}
      <p class="design-note">Δv = Isp·g₀·ln(m₀/m_f) (치올콥스키). 단 TWR 은 해수면 중력 기준입니다.</p>`;
    $('issues').innerHTML = [
      ...a.errors.map((e) => `<li class="error">⛔ ${e}</li>`),
      ...a.warnings.map((w) => `<li class="warning">⚠ ${w}</li>`),
    ].join('');
    const launch = $('launch');
    launch.disabled = !a.valid;
    launch.title = a.valid ? '설계한 로켓으로 발사' : '설계 문제를 먼저 해결하세요';
  }

  $('tutorial').addEventListener('click', (e) => {
    e.currentTarget.blur();
    options.onTutorial?.();
  });

  $('launch').addEventListener('click', () => {
    if (!analysis.valid) return;
    options.onLaunch({ definition: analysis.definition, missionId, difficulty, analysis });
  });

  // ── 3D 미리보기 ──────────────────────────────────────────
  const preview = createDesignPreview($('preview'), {
    modelLibrary: options.modelLibrary,
    onPickPart: (index) => {
      if (index >= 0) select({ source: 'stack', partId: stack[index], index });
    },
  });

  function update() {
    store.saveLast(stack); // 새로고침해도 이어서 작업할 수 있게
    analysis = analyzeDesign(stack, physicsConfig);
    renderStack();
    renderPartInfo();
    renderStats();
    preview.setDesign(analysis.definition ?? null, parts);
    preview.setSelected(selected?.source === 'stack' ? selected.index : -1);
  }

  renderMissionDesc();
  update();

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    isVisible: () => !root.hidden,
    render() {
      if (!root.hidden) preview.render();
    },
    /** 예시 설계를 불러온다 (튜토리얼 준비용) */
    loadPreset(id) {
      if (!options.presets[id]) return;
      stack = stackFromDefinition(options.presets[id]);
      presetSelect.value = id;
      selected = null;
      update();
    },
    /** 미션을 고른다 (튜토리얼 준비용) */
    setMission(id) {
      if (!missionConfig.missions[id]) return;
      missionId = id;
      missionSelect.value = id;
      renderMissionDesc();
    },
    /** 난이도를 고른다 */
    setDifficulty(id) {
      if (!difficulties[id]) return;
      difficulty = id;
      difficultySelect.value = id;
      renderDifficultyDesc();
    },
    getDifficulty: () => difficulty,
    /** 검수용 읽기 창구 */
    getStack: () => [...stack],
    getAnalysis: () => analysis,
    getMissionId: () => missionId,
  };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function shortSpec(p) {
  const bits = [`${formatNumber(p.dryMass + p.fuelMass, 0)} kg`];
  if (p.fuelMass > 0) bits.push(`연료 ${formatNumber(p.fuelMass, 0)}`);
  if (p.thrust > 0) bits.push(`${formatNumber(p.thrust / 1000, 0)} kN · Isp ${p.isp}`);
  return bits.join(' · ');
}
