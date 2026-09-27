/**
 * 팀 비밀번호 규칙 (DB 설계 db/ERD.md §2-1 · Supabase Auth 최소 6자보다 강하게)
 * - 새 비밀번호: 8자 이상
 * - 팀 추가·관리자 초기화: 임의의 임시 비밀번호 8자를 만들어 관리자에게 한 번만 보여 줌 → 첫 로그인 때 변경 필수
 */
export const MIN_PASSWORD_LENGTH = 8;
const TEMP_LENGTH = 8;

// 헷갈리는 글자(0/O, 1/l/I) 제외 — 관리자가 받아 적어 전달하기 쉽게
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LETTERS + DIGITS;

const pick = (chars: string) => {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return chars[n[0] % chars.length];
};

/** 임시 비밀번호 — 글자·숫자를 모두 포함한 8자 */
export function makeTempPassword(): string {
  const out = [pick(LETTERS), pick(DIGITS), ...Array.from({ length: TEMP_LENGTH - 2 }, () => pick(ALL))];
  // 첫 두 자리가 항상 글자·숫자로 고정되지 않도록 섞기
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** 새 비밀번호 검사 — 문제가 없으면 '' */
export function passwordError(next: string, confirm: string, current?: string): string {
  if (!next || !confirm) return '새 비밀번호를 두 번 입력하세요.';
  if (next.length < MIN_PASSWORD_LENGTH) return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  if (current != null && next === current) return '지금 비밀번호와 다른 비밀번호를 입력하세요.';
  if (next !== confirm) return '새 비밀번호가 서로 일치하지 않습니다.';
  return '';
}

/** 예전 고정 초기 비밀번호 — 이 값을 쓰는 저장본의 팀은 변경이 필요한 팀으로 봄 */
export const LEGACY_INITIAL_PASSWORD = '1234';
