import { useSyncExternalStore } from 'react';

/**
 * 화면 모드 — light / dark / system(기기 설정을 따름, 기본값).
 * <html data-theme="light|dark"> 로 적용하고 tokens.css 의 :root[data-theme="dark"] 가 색을 바꾼다.
 * 첫 페인트 깜빡임을 막으려고 index.html 의 인라인 스크립트가 같은 키로 먼저 적용한다 (키·규칙을 바꾸면 함께 수정).
 */
export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'cowork-coin-theme';
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

let pref: ThemePref = read();
const systemTheme = (): Theme => (mq?.matches ? 'dark' : 'light');
const resolve = (): Theme => (pref === 'system' ? systemTheme() : pref);
/** 라이트로 고정 중인 화면 수 — 로그인 화면(Figma 라이트 전용 디자인)은 다크 모드에서도 라이트 */
let lightHold = 0;
/** theme: 설정대로 계산한 모드 · shown: 실제로 보이는 모드 */
let snap = { pref, theme: resolve(), shown: resolve() };

/** 주소창·상태 표시줄 색 (manifest theme_color 와 같은 흰색 / 다크는 앱 바탕색) */
const BAR = { light: '#FFFFFF', dark: '#17110E' };

function apply(fade = false) {
  const theme = resolve();
  snap = { pref, theme, shown: lightHold ? 'light' : theme };
  const root = document.documentElement;
  const change = () => {
    root.dataset.theme = snap.shown;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[snap.shown]);
  };
  if (fade && root.dataset.theme && root.dataset.theme !== snap.shown) crossfade(change);
  else change();
  listeners.forEach(l => l());
}

/**
 * 라이트 ↔ 다크 전환을 디졸브로 (한 번에 확 바뀌면 눈이 부심)
 * - View Transitions 지원 브라우저: 이전·다음 화면을 겹쳐 서서히 (tokens.css ::view-transition 시간)
 * - 미지원: 잠시 모든 색에 전환 효과를 걸어 천천히 바뀌게
 * - '동작 줄이기' 설정이면 바로 바꿈
 */
const FADE_MS = 450;
function crossfade(change: () => void) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { change(); return; }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition) { doc.startViewTransition(change); return; }
  const root = document.documentElement;
  root.classList.add('theme-fading');
  change();
  window.setTimeout(() => root.classList.remove('theme-fading'), FADE_MS);
}

/** 첫 렌더 전에 호출 — 시스템 설정이 바뀌면(시스템 모드일 때) 바로 따라간다 */
export function initTheme() {
  apply();
  mq?.addEventListener('change', () => { if (pref === 'system') apply(true); });
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* 저장 불가 시 이번 세션만 */ }
  apply(true);
}

/** 화면이 떠 있는 동안 라이트로 고정 — 반환 함수로 해제 (useEffect 에서 사용) */
export function holdLightTheme() {
  lightHold++;
  apply();
  return () => { lightHold--; apply(true); };
}

export function useTheme() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => snap);
}
