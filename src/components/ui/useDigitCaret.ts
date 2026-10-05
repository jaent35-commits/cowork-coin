import { useEffect, useLayoutEffect, useRef } from 'react';

const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';

/**
 * 콤마·하이픈을 넣어 다시 그리는 숫자 입력칸의 커서 유지
 * — 값이 다시 그려져도 입력하던 자리(앞쪽 숫자 개수 기준)에 커서를 두어 중간 숫자도 바로 고칠 수 있게
 * — 지우기(Backspace·Delete)는 구분 기호(, -)를 건너뛰고 숫자만 지움
 *   (콤마만 지우면 다시 그려질 때 콤마가 돌아와 아무것도 안 지워진 것처럼 보임)
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
    while (pos < el.value.length && seen < digits) { if (isDigit(el.value[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
  });

  // 지우기: 커서 바로 앞(뒤)이 구분 기호면 그 너머 숫자 하나를 지움 — beforeinput 은 모바일 키보드(keydown 이 Unidentified)에서도 옴
  //   입력칸이 다시 만들어질 수 있어(DateField 등) 그릴 때마다 현재 입력칸에 붙임
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      const back = e.inputType === 'deleteContentBackward', fwd = e.inputType === 'deleteContentForward';
      const start = el.selectionStart, end = el.selectionEnd;
      if ((!back && !fwd) || start == null || start !== end) return;
      const v = el.value;
      let i = back ? start - 1 : start;
      if (i < 0 || i >= v.length || isDigit(v[i])) return; // 숫자를 지우는 경우는 기본 동작
      while (i >= 0 && i < v.length && !isDigit(v[i])) i += back ? -1 : 1;
      if (i < 0 || i >= v.length) return;
      e.preventDefault();
      const next = v.slice(0, i) + v.slice(i + 1);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, next);
      el.setSelectionRange(i, i); // 지운 숫자 자리에 커서
      el.dispatchEvent(new Event('input', { bubbles: true })); // React onChange → mark → 다시 그린 뒤 같은 자리
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  });

  const mark = (el: HTMLInputElement) => {
    pending.current = (el.value.slice(0, el.selectionStart ?? el.value.length).match(/\d/g) ?? []).length;
  };
  return { ref, mark };
}
