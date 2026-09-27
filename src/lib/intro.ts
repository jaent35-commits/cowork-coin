import { useSyncExternalStore } from 'react';

/**
 * 홈 화면 소개 팝업(IntroPopup) 노출 규칙.
 * - '오늘 하루 안 보기' 체크 후 닫기 → 그날(기기 날짜)은 다시 안 나옴
 * - X · 닫기 → 이번 접속(브라우저 세션) 동안만 숨김
 * 열려 있는 동안에는 모바일 앱 설치 바텀 시트(PwaPrompt)가 겹쳐 뜨지 않도록 열림 상태를 공유한다.
 */
const HIDE_DAY_KEY = 'cowork-coin-intro-hide-day';
const CLOSED_KEY = 'cowork-coin-intro-closed';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function shouldShowIntro() {
  try {
    return localStorage.getItem(HIDE_DAY_KEY) !== today() && sessionStorage.getItem(CLOSED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function hideIntro(forToday: boolean) {
  try {
    sessionStorage.setItem(CLOSED_KEY, '1');
    if (forToday) localStorage.setItem(HIDE_DAY_KEY, today());
  } catch { /* 저장 불가 — 이번 화면에서만 닫힘 */ }
}

/** open: 팝업 열림 · sawInstall: 마지막 카드(앱 다운로드)를 이번 접속에서 봤음 → 설치 바텀 시트를 또 띄우지 않음 */
let snap = { open: false, sawInstall: false };
const subs = new Set<() => void>();
export function setIntroState(next: Partial<typeof snap>) {
  const merged = { ...snap, ...next };
  if (merged.open === snap.open && merged.sawInstall === snap.sawInstall) return;
  snap = merged;
  subs.forEach(f => f());
}
export const useIntroState = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
