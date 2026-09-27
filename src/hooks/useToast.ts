import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'ok' | 'warn';
export interface ToastState { msg: string; tone: ToastTone }

/** 짧게 떴다 사라지는 토스트 메시지 — tone 'warn' 은 안내·오류(주황 !), 기본은 완료(초록 ✓) */
export function useToast(duration = 2500): [ToastState, (msg: string, tone?: ToastTone) => void] {
  const [state, setState] = useState<ToastState>({ msg: '', tone: 'ok' });
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((msg: string, tone: ToastTone = 'ok') => {
    window.clearTimeout(timer.current);
    setState({ msg, tone });
    timer.current = window.setTimeout(() => setState(s => ({ ...s, msg: '' })), tone === 'warn' ? duration + 1000 : duration);
  }, [duration]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [state, show];
}
