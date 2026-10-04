import { useSyncExternalStore } from 'react';

/**
 * 앱(PWA) 설치 상태 — 브라우저의 설치 이벤트(beforeinstallprompt)는 화면이 그려지기 전에 올 수 있어
 * main.tsx 에서 initInstall() 로 먼저 받아 두고, 안내 UI(모바일 바텀 시트·PC 홈 카드)는 useInstall() 로 읽는다.
 * - canPrompt: 버튼 한 번으로 설치 창을 띄울 수 있음 (안드로이드 크롬·PC 크롬/엣지 등)
 * - 아이폰 사파리 등은 브라우저가 설치 창을 열어 주지 않아 '공유 → 홈 화면에 추가' 안내만 가능
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
export const isMobileDevice = isIOS || /Android|Mobile/i.test(ua);

/** 이미 설치된 앱(홈 화면 아이콘)으로 실행 중인지 */
function runningInstalled() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = runningInstalled();
let snap = { canPrompt: false, installed };
const subs = new Set<() => void>();
const emit = () => { snap = { canPrompt: !!deferred, installed }; subs.forEach(f => f()); };

export function initInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

/** 설치 이벤트가 아직 안 왔으면 잠깐(ms) 기다림 — 화면을 연 직후 바로 눌러도 안내 대신 설치 창이 뜨도록 */
function waitForPrompt(ms: number): Promise<void> {
  if (deferred) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); subs.delete(check); resolve(); };
    const check = () => { if (deferred) done(); };
    const t = setTimeout(done, ms);
    subs.add(check);
  });
}

/**
 * 설치 창 바로 띄우기 — 누르면 안내 없이 브라우저 설치 창(= 바로 설치)
 * 'unavailable' 이면 이 브라우저는 설치 창을 열어 주지 않음(아이폰 사파리 등) → 수동 안내
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  // 아이폰은 설치 창이 없어 기다려도 오지 않음 (버튼을 누른 직후여야 설치 창을 열 수 있어 짧게만)
  if (!deferred && !isIOS) await waitForPrompt(1500);
  if (!deferred) return 'unavailable';
  const e = deferred;
  await e.prompt();
  const { outcome } = await e.userChoice;
  deferred = null; // 설치 창은 한 번만 쓸 수 있음
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome;
}

export function useInstall() {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
}

/** 수동 설치 방법 (설치 창을 못 띄우는 브라우저) */
export const INSTALL_GUIDE = isIOS
  ? ['화면 아래 공유 버튼(□↑)을 누르세요', '\'홈 화면에 추가\'를 누르세요', '오른쪽 위 \'추가\'를 누르면 설치 완료']
  : isMobileDevice
    ? ['브라우저 메뉴(⋮)를 누르세요', '\'앱 설치\' 또는 \'홈 화면에 추가\'를 누르세요']
    : ['주소창 오른쪽의 설치 아이콘(⊕)을 누르세요', '또는 브라우저 메뉴 → \'앱 설치\'를 누르세요'];
