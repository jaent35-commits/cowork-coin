import { useSyncExternalStore } from 'react';

/** 글씨 크기 모드 — sm(기본) / lg(전체 텍스트 1.4배, tokens.css 의 --fs) */
export type FontMode = 'sm' | 'lg';

const KEY = 'cowork-coin-font';
const listeners = new Set<() => void>();

function read(): FontMode {
  try { return localStorage.getItem(KEY) === 'lg' ? 'lg' : 'sm'; } catch { return 'sm'; }
}

let mode: FontMode = read();

function apply() {
  document.documentElement.dataset.font = mode;
}

/** 첫 렌더 전에 호출해 깜빡임 없이 적용 */
export function initFontMode() {
  apply();
}

export function setFontMode(next: FontMode) {
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* 저장 불가 시 이번 세션만 */ }
  apply();
  listeners.forEach(l => l());
}

export function useFontMode(): [FontMode, (m: FontMode) => void] {
  const m = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => mode,
  );
  return [m, setFontMode];
}
