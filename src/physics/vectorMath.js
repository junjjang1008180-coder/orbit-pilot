/**
 * 물리 계산용 3차원 벡터·쿼터니언 함수 모음
 * ------------------------------------------------------------
 * 물리 코드는 Three.js 에 의존하지 않도록 배열 [x, y, z] 와
 * 쿼터니언 [x, y, z, w] 를 직접 다룬다. 모든 함수는 새 배열을 돌려준다.
 */

export const vec3 = {
  create: (x = 0, y = 0, z = 0) => [x, y, z],
  clone: (a) => [a[0], a[1], a[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  /** a + b·s */
  addScaled: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const len = Math.hypot(a[0], a[1], a[2]);
    return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
  },
};

export const quat = {
  identity: () => [0, 0, 0, 1],
  clone: (q) => [q[0], q[1], q[2], q[3]],

  /** 단위 회전축 axis 를 기준으로 angle(rad) 만큼 도는 회전 */
  fromAxisAngle: (axis, angle) => {
    const s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  },

  /** 두 회전의 합성 a·b (b 를 먼저 적용한 뒤 a 를 적용) */
  multiply: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],

  conjugate: (q) => [-q[0], -q[1], -q[2], q[3]],

  normalize: (q) => {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    return len > 0 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
  },

  /** 벡터 v 를 쿼터니언 q 로 회전 */
  rotate: (q, v) => {
    const [qx, qy, qz, qw] = q;
    // t = 2·(q.xyz × v)
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    // v' = v + w·t + q.xyz × t
    return [
      v[0] + qw * tx + (qy * tz - qz * ty),
      v[1] + qw * ty + (qz * tx - qx * tz),
      v[2] + qw * tz + (qx * ty - qy * tx),
    ];
  },

  /**
   * 서로 직교하는 단위벡터 세 개(로컬 X, Y, Z 축이 월드에서 가리키는 방향)로
   * 회전 쿼터니언을 만든다.
   */
  fromBasis: (xAxis, yAxis, zAxis) => {
    const m00 = xAxis[0], m01 = yAxis[0], m02 = zAxis[0];
    const m10 = xAxis[1], m11 = yAxis[1], m12 = zAxis[1];
    const m20 = xAxis[2], m21 = yAxis[2], m22 = zAxis[2];
    const trace = m00 + m11 + m22;
    let x, y, z, w;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      w = 0.25 / s;
      x = (m21 - m12) * s;
      y = (m02 - m20) * s;
      z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      w = (m21 - m12) / s;
      x = 0.25 * s;
      y = (m01 + m10) / s;
      z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      w = (m02 - m20) / s;
      x = (m01 + m10) / s;
      y = 0.25 * s;
      z = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      w = (m10 - m01) / s;
      x = (m02 + m20) / s;
      y = (m12 + m21) / s;
      z = 0.25 * s;
    }
    return quat.normalize([x, y, z, w]);
  },
};
