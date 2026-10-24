/**
 * 키보드 입력 처리
 * ------------------------------------------------------------
 * 어떤 키가 눌려 있는지만 추적하고, 이를 조종 입력 값으로 바꿔 준다.
 * 물리 상태는 전혀 건드리지 않는다 (명령 연결은 flightControls.js 가 한다).
 *
 * event.code(물리 키 위치)를 쓰므로 한글/영문 입력 상태와 관계없이 동작한다.
 */

// 누르고 있는 동안 계속 적용되는 입력
const HOLD_KEYS = {
  ShiftLeft: 'throttleUp',
  ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown',
  ControlRight: 'throttleDown',
  KeyW: 'pitchDown', // 기수 내리기
  KeyS: 'pitchUp', // 기수 올리기
  KeyA: 'yawLeft',
  KeyD: 'yawRight',
  KeyQ: 'rollLeft',
  KeyE: 'rollRight',
  // RCS 평행이동 (R 로 켠 상태에서)
  KeyH: 'moveForward',
  KeyN: 'moveBack',
  KeyJ: 'moveLeft',
  KeyL: 'moveRight',
  KeyI: 'moveDown',
  KeyK: 'moveUp',
};

// 한 번 누를 때마다 한 번 실행되는 동작 (키 반복 입력은 무시)
const ACTION_KEYS = {
  KeyZ: 'throttleMax',
  KeyX: 'engineCutoff',
  Backspace: 'abort',
  Space: 'stage', // 단 분리
  KeyM: 'toggleMap', // 지도 화면 전환
  KeyB: 'switchVehicle', // 로켓 ↔ 분리된 부스터 조종 전환
  KeyT: 'cycleSas', // 자세 보조(SAS) 모드 전환
  KeyG: 'toggleAutopilot', // 자동 비행 켜기/끄기
  KeyR: 'toggleRcs', // RCS 평행이동 켜기/끄기
  KeyU: 'undock', // 정거장에서 분리
  KeyP: 'deployParachute', // 낙하산 펼치기
  KeyC: 'toggleCamera', // 추적 ↔ 1인칭(조종석) 시점
  Period: 'warpUp', // 시간 가속 빠르게
  Comma: 'warpDown', // 시간 가속 느리게
};

// 물리 키 코드(event.code)를 알 수 없을 때(일부 환경) 글자(event.key)로 찾는 동작
const ACTION_BY_CHARACTER = {
  '.': 'warpUp',
  '>': 'warpUp',
  ',': 'warpDown',
  '<': 'warpDown',
};

/** 글자 입력 중인 요소에서는 게임 키를 처리하지 않는다 */
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * @param {{ onAction: (action: string) => void, target?: Window, isEnabled?: () => boolean }} options
 *   isEnabled 가 false 면(설계 화면 등) 키를 전혀 가로채지 않아 버튼·입력란이 평소처럼 동작한다.
 */
export function createKeyboardInput({ onAction, target = window, isEnabled = () => true }) {
  const held = new Set();

  function onKeyDown(event) {
    // macOS 는 ⌘ 를 누른 동안 다른 키의 keyup 을 보내지 않아 키가 눌린 채로 남는다 → ⌘ 조합은 무시하고 모두 해제
    if (event.metaKey || event.key === 'Meta') {
      releaseAll();
      return;
    }
    if (!isEnabled() || isTypingTarget(event.target)) return;
    // Ctrl·Option 과 함께 누른 동작 키(예: 한/영 전환 Ctrl+Space)는 게임 동작으로 보지 않는다
    if ((event.ctrlKey || event.altKey) && ACTION_KEYS[event.code]) return;
    const hold = HOLD_KEYS[event.code];
    const action = ACTION_KEYS[event.code] ?? (event.code ? undefined : ACTION_BY_CHARACTER[event.key]);
    if (!hold && !action) return;
    event.preventDefault(); // Backspace 뒤로 가기 등 브라우저 기본 동작 방지
    if (hold) held.add(hold);
    if (action && !event.repeat) onAction(action);
  }

  function onKeyUp(event) {
    if (event.key === 'Meta') {
      releaseAll();
      return;
    }
    const hold = HOLD_KEYS[event.code];
    if (hold) held.delete(hold);
  }

  // 창이 포커스를 잃으면 keyup 을 받지 못하므로 눌린 키를 모두 해제한다
  function releaseAll() {
    held.clear();
  }
  function onVisibility() {
    if (document.hidden) releaseAll();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);

  const axis = (positive, negative) => (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);

  return {
    /**
     * 현재 눌린 키를 조종 입력으로 (pitch +1 = 기수 올리기, yaw +1 = 오른쪽, roll +1 = 시계)
     * translate = RCS 평행이동 [로컬 X(오른쪽), 로컬 Y(앞), 로컬 Z(등 쪽 = 위)]
     */
    getInput() {
      return {
        throttleUp: held.has('throttleUp'),
        throttleDown: held.has('throttleDown'),
        pitch: axis('pitchUp', 'pitchDown'),
        yaw: axis('yawRight', 'yawLeft'),
        roll: axis('rollRight', 'rollLeft'),
        translate: [axis('moveRight', 'moveLeft'), axis('moveForward', 'moveBack'), axis('moveUp', 'moveDown')],
      };
    },
    releaseAll,
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
