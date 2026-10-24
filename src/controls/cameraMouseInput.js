/**
 * 카메라 마우스·터치 조작
 * ------------------------------------------------------------
 * - 드래그로 카메라를 회전한다: 왼쪽·오른쪽 버튼 모두 (Mac 트랙패드는 누른 채 끌기),
 *   터치는 한 손가락. 3픽셀 넘게 움직여야 드래그로 보므로 짧은 클릭(지도에서 기동 노드 만들기)과 겹치지 않는다.
 *   Ctrl+클릭은 Ctrl 이 스로틀 내리기 키라서 조종과 겹치므로 따로 쓰지 않는다.
 * - 마우스 휠 · 트랙패드 두 손가락 스크롤 · 트랙패드 핀치(브라우저가 ctrl+휠로 보냄) · 두 손가락 터치 핀치로 확대·축소.
 * - 더블클릭은 onDoubleClick 으로 알린다 (지도에서 천체로 초점 옮기기).
 * - 3D 화면(canvas) 위에서만 동작하므로 UI 버튼 클릭을 방해하지 않는다.
 */

const DRAG_THRESHOLD = 3; // px
const PINCH_WHEEL_GAIN = 6; // 트랙패드 핀치(ctrl+휠)는 값이 작아서 키운다

/**
 * @param {HTMLElement} element 3D 화면 canvas
 * @param {{ rotate:(dx:number, dy:number)=>void, zoom:(dy:number)=>void, onDoubleClick?:(x:number, y:number)=>void }} cameraController
 */
export function createCameraMouseInput(element, cameraController) {
  const pointers = new Map(); // pointerId → {x, y}
  let dragging = false;
  let downAt = null;
  let lastX = 0;
  let lastY = 0;
  let pinchDistance = 0;

  // 우클릭 메뉴가 뜨지 않게 막는다
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  element.style.touchAction = 'none'; // 터치 드래그·핀치를 브라우저 스크롤 대신 카메라로

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    downAt = { x: event.clientX, y: event.clientY };
    lastX = event.clientX;
    lastY = event.clientY;
    try {
      element.setPointerCapture(event.pointerId); // 화면 밖으로 나가도 계속 받는다
    } catch {
      /* 포인터 캡처를 못 해도 드래그는 동작한다 */
    }
  });

  element.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      // 두 손가락 핀치: 손가락 사이가 넓어지면 확대
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) cameraController.zoom((pinchDistance - d) * 4);
      pinchDistance = d;
      dragging = true;
      return;
    }
    if (!dragging && downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > DRAG_THRESHOLD) dragging = true;
    if (!dragging) return;
    cameraController.rotate(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  const stop = (event) => {
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      downAt = null;
      pinchDistance = 0;
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      lastX = p.x;
      lastY = p.y;
      pinchDistance = 0;
    }
  };
  element.addEventListener('pointerup', stop);
  element.addEventListener('pointercancel', stop);

  element.addEventListener('dblclick', (event) => cameraController.onDoubleClick?.(event.clientX, event.clientY));

  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault(); // 페이지 스크롤·확대 방지
      // deltaMode 1(줄 단위)이면 픽셀 단위로 환산
      let delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (event.ctrlKey) delta *= PINCH_WHEEL_GAIN;
      cameraController.zoom(delta);
    },
    { passive: false },
  );

  return {
    isDragging: () => dragging,
  };
}
