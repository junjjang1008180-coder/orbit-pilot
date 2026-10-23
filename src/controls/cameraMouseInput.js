/**
 * 카메라 마우스 조작
 * ------------------------------------------------------------
 * - 우클릭(Mac 트랙패드는 두 손가락 클릭)으로 드래그하는 동안에만 카메라를 회전한다.
 *   Ctrl+클릭은 Ctrl 이 스로틀 내리기 키라서 조종과 겹치므로 카메라 회전에 쓰지 않는다.
 * - 마우스 휠 / 트랙패드 스크롤로 확대·축소한다.
 * - 3D 화면(canvas) 위에서만 동작하므로 UI 버튼 클릭을 방해하지 않는다.
 */

/**
 * @param {HTMLElement} element 3D 화면 canvas
 * @param {{ rotate:(dx:number, dy:number)=>void, zoom:(dy:number)=>void }} cameraController
 */
export function createCameraMouseInput(element, cameraController) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // 우클릭 메뉴가 뜨지 않게 막는다
  element.addEventListener('contextmenu', (event) => event.preventDefault());

  element.addEventListener('pointerdown', (event) => {
    // button 2 = 우클릭
    if (event.button !== 2) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    // 드래그 중 포인터가 화면 밖으로 나가도 이벤트를 계속 받는다 (지원하지 않으면 생략)
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* 포인터 캡처를 못 해도 드래그는 동작한다 */
    }
  });

  element.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    cameraController.rotate(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };
  element.addEventListener('pointerup', stop);
  element.addEventListener('pointercancel', stop);

  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault(); // 페이지 스크롤·확대 방지
      // deltaMode 1(줄 단위)이면 픽셀 단위로 환산
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      cameraController.zoom(delta);
    },
    { passive: false },
  );

  return {
    isDragging: () => dragging,
  };
}
