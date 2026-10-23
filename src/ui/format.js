/**
 * 화면 표시용 숫자 포맷 함수 (한국어 표기)
 */

/** 소수점 자리수를 고정한 숫자 문자열. 숫자가 아니면 '-' */
export function formatNumber(value, digits = 0) {
  return Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '-';
}

/** 거리(m): 10 km 이상이면 km 로 표시 */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '-';
  return Math.abs(meters) >= 10_000 ? `${formatNumber(meters / 1000, 2)} km` : `${formatNumber(meters, 1)} m`;
}

/** 속도(m/s) */
export function formatSpeed(metersPerSecond) {
  return `${formatNumber(metersPerSecond, 1)} m/s`;
}
