/**
 * 케플러 궤도 전파 (범용 변수 방법)
 * ------------------------------------------------------------
 * 중력만 받는 2체 궤도에서, 지금 위치·속도(r₀, v₀)로부터 dt 초 뒤의 위치·속도를 구한다.
 * 타원·포물선·쌍곡선 궤도 모두 같은 식으로 계산한다 (Curtis, Orbital Mechanics 알고리즘 3.3·3.4).
 *   범용 이각 χ 에 대한 케플러 방정식을 뉴턴 방법으로 풀고,
 *   라그랑주 계수 f, g, ḟ, ġ 로 r = f·r₀ + g·v₀,  v = ḟ·r₀ + ġ·v₀ 를 만든다.
 * 공기저항·추력은 넣지 않는다 (기동 계획·궤도 예측용).
 */
import { vec3 } from '../physics/vectorMath.js';

/** 스텀프 함수 C(z), S(z) */
function stumpffC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}
function stumpffS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * @param {number[]} r0 위치 (m)
 * @param {number[]} v0 속도 (m/s)
 * @param {number} mu 중력 파라미터 (m³/s²)
 * @param {number} dt 진행 시간 (s, 음수면 과거)
 * @returns {{position:number[], velocity:number[]}}
 */
export function propagateKepler(r0, v0, mu, dt) {
  if (dt === 0) return { position: vec3.clone(r0), velocity: vec3.clone(v0) };
  const r0n = vec3.length(r0);
  const v0n = vec3.length(v0);
  const vr0 = vec3.dot(r0, v0) / r0n; // 반지름 방향 속도
  const alpha = 2 / r0n - (v0n * v0n) / mu; // 반장축의 역수 (타원 > 0, 쌍곡선 < 0)
  const sqrtMu = Math.sqrt(mu);

  // 범용 이각 χ 를 뉴턴 방법으로 구한다
  let chi = sqrtMu * Math.abs(alpha) * dt;
  if (!Number.isFinite(chi) || Math.abs(alpha) < 1e-12) chi = (sqrtMu * dt) / r0n;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = ((r0n * vr0) / sqrtMu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sqrtMu * dt;
    const dF = ((r0n * vr0) / sqrtMu) * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - (chi * chi * chi * S) / sqrtMu;
  const position = vec3.add(vec3.scale(r0, f), vec3.scale(v0, g));
  const rn = vec3.length(position);
  const fDot = (sqrtMu / (rn * r0n)) * (alpha * chi * chi * chi * S - chi);
  const gDot = 1 - ((chi * chi) / rn) * C;
  const velocity = vec3.add(vec3.scale(r0, fDot), vec3.scale(v0, gDot));
  return { position, velocity };
}
