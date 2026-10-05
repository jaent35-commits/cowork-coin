import { useSyncExternalStore } from 'react';

/**
 * 글꼴 — default(기본: Inter·Nunito + 시스템 한글 글꼴) / pretendard(프리텐다드)
 * 프리텐다드는 고른 기기에서만 CDN(jsDelivr)에서 내려받음 — 기본 글꼴 사용자는 추가 다운로드 없음
 * 적용: <html data-font-family="pretendard"> → tokens.css 에서 --font-body·--font-display 교체
 */
export type FontFamily = 'default' | 'pretendard';

const KEY = 'cowork-coin-font-family';
const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
const listeners = new Set<() => void>();

function read(): FontFamily {
  try { return localStorage.getItem(KEY) === 'pretendard' ? 'pretendard' : 'default'; } catch { return 'default'; }
}

let family: FontFamily = read();

function loadPretendard() {
  if (document.getElementById('pretendard-css')) return;
  const link = document.createElement('link');
  link.id = 'pretendard-css';
  link.rel = 'stylesheet';
  link.crossOrigin = 'anonymous';
  link.href = PRETENDARD_CSS;
  document.head.appendChild(link);
}

function apply() {
  if (family === 'pretendard') loadPretendard();
  document.documentElement.dataset.fontFamily = family;
}

/** 첫 렌더 전에 호출해 깜빡임 없이 적용 */
export function initFontFamily() {
  apply();
}

export function setFontFamily(next: FontFamily) {
  family = next;
  try { localStorage.setItem(KEY, next); } catch { /* 저장 불가 시 이번 세션만 */ }
  apply();
  listeners.forEach(l => l());
}

export function useFontFamily(): [FontFamily, (f: FontFamily) => void] {
  const f = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => family,
  );
  return [f, setFontFamily];
}
