/**
 * 로켓 설계 저장·불러오기·공유 코드
 * ------------------------------------------------------------
 * - 저장소: 브라우저 localStorage (이 브라우저에만 남는다). 쓸 수 없으면 조용히 실패를 알려 준다.
 * - 공유 코드: "OP1-" + 설계(JSON)를 base64url 로 바꾼 문자열. 다른 사람이 붙여 넣어 가져올 수 있다.
 * - 가져올 때는 부품 이름이 실제 부품 목록에 있는지 확인한다.
 */

const STORE_KEY = 'orbitPilot.designs';
const LAST_KEY = 'orbitPilot.lastDesign';
const CODE_PREFIX = 'OP1-';
const MAX_PARTS = 40; // 한 설계의 최대 부품 수 (잘못된 코드 방지)
const MAX_NAME = 30;

/** 설계 이름 다듬기 (앞뒤 공백 제거, 길이 제한) */
export function cleanName(name) {
  return String(name ?? '').trim().slice(0, MAX_NAME);
}

/**
 * 설계가 올바른지 확인하고 정리한 결과를 돌려준다. 문제가 있으면 한국어 메시지로 오류를 던진다.
 * @param {{name?:string, stack:string[]}} design
 * @param {Record<string, object>} partsCatalog
 */
export function validateDesign(design, partsCatalog) {
  if (!design || !Array.isArray(design.stack)) throw new Error('설계 형식이 올바르지 않아요.');
  if (design.stack.length === 0) throw new Error('부품이 하나도 없는 설계예요.');
  if (design.stack.length > MAX_PARTS) throw new Error(`부품이 너무 많아요 (최대 ${MAX_PARTS}개).`);
  const unknown = design.stack.filter((id) => typeof id !== 'string' || !partsCatalog[id]);
  if (unknown.length) throw new Error(`알 수 없는 부품이 있어요: ${[...new Set(unknown)].join(', ')}`);
  return { name: cleanName(design.name) || '가져온 설계', stack: [...design.stack] };
}

// ── 공유 코드 ────────────────────────────────────────────
function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '==='.slice((base64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** 설계 → 공유 코드 */
export function encodeDesign({ name, stack }) {
  return CODE_PREFIX + toBase64Url(JSON.stringify({ n: cleanName(name), s: stack }));
}

/**
 * 공유 코드 → 설계 (잘못된 코드면 오류)
 * @param {string} code
 * @param {Record<string, object>} partsCatalog
 */
export function decodeDesign(code, partsCatalog) {
  const text = String(code ?? '').trim();
  if (!text.startsWith(CODE_PREFIX)) throw new Error('ORBIT PILOT 설계 코드가 아니에요 (OP1- 로 시작해야 해요).');
  let data;
  try {
    data = JSON.parse(fromBase64Url(text.slice(CODE_PREFIX.length)));
  } catch {
    throw new Error('코드가 깨졌어요. 처음부터 끝까지 다시 복사해 주세요.');
  }
  return validateDesign({ name: data?.n, stack: data?.s }, partsCatalog);
}

// ── 저장소 ───────────────────────────────────────────────
/**
 * @param {Storage | null} storage 보통 window.localStorage (테스트에서는 가짜 저장소)
 */
export function createDesignStore(storage = safeLocalStorage()) {
  const read = () => {
    try {
      const list = JSON.parse(storage?.getItem(STORE_KEY) ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      storage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };

  return {
    available: Boolean(storage),
    /** 저장된 설계 목록 (최근 저장 순) */
    list() {
      // 저장 시각이 같으면(같은 밀리초) 나중에 저장한 것(배열 뒤쪽)을 앞에
      return read()
        .map((d, i) => ({ d, i }))
        .sort((a, b) => b.d.savedAt - a.d.savedAt || b.i - a.i)
        .map(({ d }) => d);
    },
    /**
     * 같은 이름이 있으면 덮어쓴다
     * @returns {{ok:boolean, overwritten:boolean, message:string}}
     */
    save(name, stack) {
      const clean = cleanName(name);
      if (!clean) return { ok: false, overwritten: false, message: '설계 이름을 입력해 주세요.' };
      const list = read();
      const overwritten = list.some((d) => d.name === clean);
      const next = list.filter((d) => d.name !== clean);
      next.push({ name: clean, stack: [...stack], savedAt: Date.now() });
      const ok = write(next);
      return {
        ok,
        overwritten,
        message: ok ? `「${clean}」 ${overwritten ? '덮어써서 ' : ''}저장했어요.` : '이 브라우저에서는 저장할 수 없어요 (저장소 사용 불가).',
      };
    },
    /** @returns {{name:string, stack:string[]} | null} */
    load(name) {
      return read().find((d) => d.name === name) ?? null;
    },
    remove(name) {
      return write(read().filter((d) => d.name !== name));
    },
    /** 마지막 작업 설계 (새로고침 후 복원용) */
    saveLast(stack) {
      try {
        storage?.setItem(LAST_KEY, JSON.stringify(stack));
      } catch {
        /* 무시 */
      }
    },
    loadLast() {
      try {
        const stack = JSON.parse(storage?.getItem(LAST_KEY) ?? 'null');
        return Array.isArray(stack) ? stack : null;
      } catch {
        return null;
      }
    },
  };
}

function safeLocalStorage() {
  try {
    const s = window.localStorage;
    const probe = '__orbitPilotProbe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
