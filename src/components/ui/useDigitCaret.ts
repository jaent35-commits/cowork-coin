import { useLayoutEffect, useRef } from 'react';

/**
 * 콤마·하이픈을 넣어 다시 그리는 숫자 입력칸의 커서 유지
 * — 값이 다시 그려져도 입력하던 자리(앞쪽 숫자 개수 기준)에 커서를 두어 중간 숫자도 바로 고칠 수 있게
 * 사용: onChange 에서 mark(e.target) 를 부른 뒤 값을 바꿈
 */
export function useDigitCaret() {
  const ref = useRef<HTMLInputElement>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current, digits = pending.current;
    if (!el || digits == null) return;
    pending.current = null;
    if (document.activeElement !== el) return;
    let pos = 0, seen = 0;
    while (pos < el.value.length && seen < digits) { if (/\d/.test(el.value[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
  });

  const mark = (el: HTMLInputElement) => {
    pending.current = (el.value.slice(0, el.selectionStart ?? el.value.length).match(/\d/g) ?? []).length;
  };
  return { ref, mark };
}
