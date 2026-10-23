/**
 * 에셋 폴더에 어떤 파일이 있는지 알아내기
 * ------------------------------------------------------------
 * 없는 파일을 하나씩 요청하면 브라우저 콘솔에 404 오류가 쌓이므로,
 * 개발 서버(python http.server)의 폴더 목록 페이지를 읽어 실제로 있는 파일만 요청한다.
 * 폴더 목록을 주지 않는 서버라면 빈 목록을 돌려주어 기본 도형·합성음을 쓴다.
 */

/**
 * @param {string} folder 예: 'assets/models/'
 * @returns {Promise<Set<string>>} 폴더 안 파일 이름들
 */
export async function listAssetFolder(folder) {
  try {
    const response = await fetch(folder, { cache: 'no-store' });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return new Set();
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const names = [...doc.querySelectorAll('a[href]')]
      .map((a) => decodeURIComponent(a.getAttribute('href')))
      .filter((href) => href && !href.includes('/') && !href.startsWith('?'));
    return new Set(names);
  } catch {
    return new Set();
  }
}
