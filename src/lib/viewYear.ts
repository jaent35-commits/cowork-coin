import { useSyncExternalStore } from 'react';
import { CUR_YEAR } from './date';

/** 화면 전체 조회 연도 — 집행 현황·프로젝트·리포트(운영일지·차트)가 따른다. 탭(세션) 동안만 유지 */
const KEY = 'cowork-coin-view-year';
const listeners = new Set<() => void>();

function read(): number {
  try {
    const v = Number(sessionStorage.getItem(KEY));
    return Number.isInteger(v) && v > 2000 ? v : CUR_YEAR;
  } catch { return CUR_YEAR; }
}

let year = read();

export function setViewYear(next: number) {
  if (next === year) return;
  year = next;
  try { sessionStorage.setItem(KEY, String(next)); } catch { /* 무시 */ }
  listeners.forEach(l => l());
}

export function useViewYear(): [number, (y: number) => void] {
  const y = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => year);
  return [y, setViewYear];
}

/** 기간(YYYY-MM ~ YYYY-MM)이 해당 연도에 걸치는지 */
export const overlapsYear = (start: string, end: string, y: number) =>
  Number(start.slice(0, 4)) <= y && Number((end || start).slice(0, 4)) >= y;
