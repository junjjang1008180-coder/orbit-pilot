/**
 * 키보드 입력 → 시뮬레이션 명령 연결
 * ------------------------------------------------------------
 * 키보드 모듈이 알려 준 입력을 FlightSimulation 의 명령 메서드로만 전달한다.
 */
import { createKeyboardInput } from './keyboardInput.js';

/**
 * @param {() => import('../core/simulation.js').FlightSimulation} getSimulation
 * @param {{ onUiAction?: (action: string) => void, isEnabled?: () => boolean }} [options]
 *   onUiAction: 화면 전환 등 시뮬레이션 밖의 동작, isEnabled: false 면 키 입력을 무시 (설계 화면 등)
 */
export function createFlightControls(getSimulation, { onUiAction, isEnabled = () => true } = {}) {
  const actions = {
    throttleMax: (sim) => sim.throttleMax(),
    engineCutoff: (sim) => sim.engineCutoff(),
    abort: (sim) => sim.abort(),
    stage: (sim) => sim.separateStage(),
    switchVehicle: (sim) => sim.switchControl(),
    cycleSas: (sim) => sim.cycleSas(),
    toggleAutopilot: (sim) => sim.toggleAutopilot(),
    toggleRcs: (sim) => sim.toggleRcs(),
    undock: (sim) => sim.undockFromStation(),
    deployParachute: (sim) => sim.deployParachute(),
    warpUp: (sim) => sim.increaseTimeWarp(),
    warpDown: (sim) => sim.decreaseTimeWarp(),
  };

  const keyboard = createKeyboardInput({
    isEnabled,
    onAction: (action) => {
      if (!isEnabled()) return;
      if (actions[action]) actions[action](getSimulation());
      else onUiAction?.(action);
    },
  });

  return {
    /** 매 프레임 호출: 누르고 있는 키 상태를 시뮬레이션에 전달 */
    update() {
      const idle = { throttleUp: false, throttleDown: false, pitch: 0, yaw: 0, roll: 0, translate: [0, 0, 0] };
      getSimulation().setControlInput(isEnabled() ? keyboard.getInput() : idle);
    },
    keyboard,
  };
}
