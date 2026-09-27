/**
 * 로그인 화면의 '로그인 정보 저장' 옵션.
 * - 체크: 브라우저를 닫았다 열어도 로그인 유지 + 마지막 팀 기억
 * - 해제: 이번 브라우저 세션(탭/앱을 닫을 때까지)만 로그인 유지
 */
const REMEMBER_KEY = 'cowork-coin-remember';
const LAST_TEAM_KEY = 'cowork-coin-last-team';
const ALIVE_KEY = 'cowork-coin-alive';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
export const getLastTeam = () => safe(() => localStorage.getItem(LAST_TEAM_KEY), null);

export function saveLoginPrefs(remember: boolean, team: string) {
  safe(() => {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    if (remember) localStorage.setItem(LAST_TEAM_KEY, team);
    else localStorage.removeItem(LAST_TEAM_KEY);
    sessionStorage.setItem(ALIVE_KEY, '1');
  }, undefined);
}

/** 저장 안 함 + 새 브라우저 세션이면 저장된 로그인을 버린다 */
export const shouldDropSession = () => safe(() => !getRemember() && !sessionStorage.getItem(ALIVE_KEY), false);
