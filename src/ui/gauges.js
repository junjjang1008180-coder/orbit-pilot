/**
 * 다이얼 계기판 (네비볼 양옆)
 * ------------------------------------------------------------
 * 왼쪽: 속도계 · 수직 속도계(가운데가 0) · 고도계
 * 오른쪽: G 미터 · 현재 단 연료 · TWR   (화면이 좁으면 세 번째 계기는 숨긴다)
 * 텔레메트리를 읽어 캔버스에 바늘과 눈금을 그리기만 한다 (물리 상태를 바꾸지 않음).
 * 값의 범위가 넓은 속도·고도는 제곱근 눈금이라 낮은 값도 바늘이 잘 움직인다.
 */
import { formatNumber } from './format.js';

const SIZE = 84; // 캔버스 한 변 (CSS px)
const START = (135 * Math.PI) / 180; // 눈금 시작 각 (왼쪽 아래)
const SWEEP = (270 * Math.PI) / 180; // 눈금 범위

/**
 * @typedef {object} DialSpec
 * @property {string} label 계기 이름
 * @property {(t:object)=>number} value 텔레메트리 → 값
 * @property {number} min
 * @property {number} max
 * @property {'linear'|'sqrt'|'signedSqrt'} [scale]
 * @property {number[]} ticks 눈금 값 (글자로 표시)
 * @property {(v:number)=>string} text 가운데 글자
 * @property {string} unit 단위
 * @property {{from:number, to:number, color:string}[]} [zones] 색 구간
 */

/** @type {DialSpec[]} */
const LEFT = [
  {
    label: '속도',
    value: (t) => t.speed,
    min: 0,
    max: 4000,
    scale: 'sqrt',
    ticks: [0, 250, 1000, 2250, 4000],
    text: (v) => formatNumber(v, 0),
    unit: 'm/s',
  },
  {
    label: '수직 속도',
    value: (t) => t.verticalSpeed,
    min: -300,
    max: 300,
    scale: 'signedSqrt',
    ticks: [-300, -50, 0, 50, 300],
    text: (v) => `${v > 0 ? '+' : ''}${formatNumber(v, 0)}`,
    unit: 'm/s',
    zones: [{ from: -300, to: -50, color: 'rgba(255,181,71,0.45)' }],
  },
  {
    label: '고도',
    value: (t) => Math.max(0, t.altitude / 1000),
    min: 0,
    max: 200,
    scale: 'sqrt',
    ticks: [0, 10, 50, 100, 200],
    text: (v) => (v < 10 ? formatNumber(v, 2) : formatNumber(v, 1)),
    unit: 'km',
    zones: [{ from: 0, to: 70, color: 'rgba(90,169,255,0.35)' }], // 대기권
  },
];

/** @type {DialSpec[]} */
const RIGHT = [
  {
    label: 'G',
    value: (t) => t.gForce,
    min: 0,
    max: 8,
    ticks: [0, 2, 4, 6, 8],
    text: (v) => formatNumber(v, 1),
    unit: 'g',
    zones: [{ from: 5, to: 8, color: 'rgba(255,91,91,0.5)' }],
  },
  {
    label: '연료',
    value: (t) => t.fuelRatio * 100,
    min: 0,
    max: 100,
    ticks: [0, 25, 50, 75, 100],
    text: (v) => `${formatNumber(v, 0)}%`,
    unit: '현재 단',
    zones: [{ from: 0, to: 10, color: 'rgba(255,91,91,0.5)' }],
  },
  {
    label: 'TWR',
    value: (t) => t.twr,
    min: 0,
    max: 4,
    ticks: [0, 1, 2, 3, 4],
    text: (v) => formatNumber(v, 2),
    unit: '추력/무게',
    zones: [{ from: 0, to: 1, color: 'rgba(255,181,71,0.35)' }],
  },
];

/** 값 → 0~1 위치 */
function fraction(spec, value) {
  const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(value) ? value : 0));
  if (spec.scale === 'sqrt') return Math.sqrt((v - spec.min) / (spec.max - spec.min));
  if (spec.scale === 'signedSqrt') {
    const half = Math.max(Math.abs(spec.min), spec.max);
    return 0.5 + 0.5 * Math.sign(v) * Math.sqrt(Math.abs(v) / half);
  }
  return (v - spec.min) / (spec.max - spec.min);
}

function drawDial(ctx, spec, value) {
  const s = SIZE;
  const cx = s / 2;
  const cy = s / 2 + 2;
  const r = s / 2 - 8;
  ctx.clearRect(0, 0, s, s);
  const angleAt = (f) => START + SWEEP * f;

  // 바탕 원
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 12, 20, 0.75)';
  ctx.fill();
  // 색 구간
  for (const z of spec.zones ?? []) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, angleAt(fraction(spec, z.from)), angleAt(fraction(spec, z.to)));
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  // 눈금 테두리
  ctx.beginPath();
  ctx.arc(cx, cy, r, START, START + SWEEP);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 눈금
  ctx.fillStyle = 'rgba(220,230,245,0.75)';
  ctx.font = '8px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tick of spec.ticks) {
    const a = angleAt(fraction(spec, tick));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 양 끝(아래쪽) 눈금 글자는 가운데 값 글자와 겹치므로 생략
    const f = fraction(spec, tick);
    if (f > 0.01 && f < 0.99) {
      const label = Math.abs(tick) >= 1000 ? `${tick / 1000}k` : String(tick);
      ctx.fillText(label, cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13));
    }
  }
  // 바늘
  const needle = angleAt(fraction(spec, value));
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(needle) * 6, cy - Math.sin(needle) * 6);
  ctx.lineTo(cx + Math.cos(needle) * (r - 4), cy + Math.sin(needle) * (r - 4));
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd43b';
  ctx.fill();
  // 가운데 값과 이름
  ctx.fillStyle = '#e8eef7';
  ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
  ctx.fillText(spec.text(Number.isFinite(value) ? value : 0), cx, cy + 17);
  ctx.fillStyle = 'rgba(200,212,230,0.7)';
  ctx.font = '8px system-ui, sans-serif';
  ctx.fillText(spec.unit, cx, cy + 28);
}

/**
 * @param {HTMLElement} leftRoot 네비볼 왼쪽 자리
 * @param {HTMLElement} rightRoot 네비볼 오른쪽 자리
 */
export function createGauges(leftRoot, rightRoot) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const make = (root, specs) =>
    specs.map((spec) => {
      const wrap = document.createElement('figure');
      wrap.className = 'gauge';
      const canvas = document.createElement('canvas');
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
      canvas.style.width = `${SIZE}px`;
      canvas.style.height = `${SIZE}px`;
      const caption = document.createElement('figcaption');
      caption.textContent = spec.label;
      wrap.append(canvas, caption);
      root.appendChild(wrap);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      return { spec, ctx, last: null };
    });
  const dials = [...make(leftRoot, LEFT), ...make(rightRoot, RIGHT)];

  return {
    /** @param {object} t 텔레메트리 */
    update(t) {
      for (const d of dials) {
        const value = d.spec.value(t);
        // 바늘이 거의 그대로면 다시 그리지 않는다
        if (d.last !== null && Math.abs(fraction(d.spec, value) - fraction(d.spec, d.last)) < 0.002 && d.spec.text(value) === d.spec.text(d.last)) continue;
        d.last = value;
        drawDial(d.ctx, d.spec, value);
      }
    },
  };
}
