/** 현재 기기의 날짜를 기준으로 연도·월·분기를 계산한다. */
export const TODAY = new Date();

export const CUR_YEAR = TODAY.getFullYear();
/** 0 ~ 11 */
export const CUR_MONTH = TODAY.getMonth();
/** 0 ~ 3 */
export const CUR_QUARTER = Math.floor(CUR_MONTH / 3);
export const CUR_YYYYMM = ym(CUR_YEAR, CUR_MONTH);
export const TODAY_ISO = `${CUR_YYYYMM}-${String(TODAY.getDate()).padStart(2, '0')}`;

/** (2026, 8) → "2026-09" */
export function ym(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}

/** "2026-09" → { year: 2026, month: 8 } */
export function parseYm(v: string): { year: number; month: number } {
  const [y, m] = v.split('-').map(Number);
  return { year: y, month: m - 1 };
}

/** 기준월에서 endDate 까지 남은 개월 수 (지났으면 음수) */
export function monthsUntil(endDate: string, from = CUR_YYYYMM): number {
  const e = parseYm(endDate);
  const f = parseYm(from);
  return (e.year - f.year) * 12 + (e.month - f.month);
}

export function quarterOf(monthIdx: number): number {
  return Math.floor(monthIdx / 3);
}

export function isQuarterEnd(monthIdx: number): boolean {
  return monthIdx % 3 === 2;
}

export function todayLabel(): string {
  return `${CUR_YEAR}년 ${CUR_MONTH + 1}월 ${TODAY.getDate()}일`;
}

/** 전월 비용 등록 마감일 — 매월 이 날까지는 지난달 사용 건도 등록할 수 있음 */
export const PREV_MONTH_DEADLINE = 15;
/**
 * 집행 등록·수정에서 고를 수 있는 가장 이른 사용일자 (YYYY-MM-DD)
 * 1~15일: 지난달 1일부터 · 16일~: 이번 달 1일부터
 */
export function execMinDate(today = TODAY): string {
  const prev = today.getDate() <= PREV_MONTH_DEADLINE;
  const d = new Date(today.getFullYear(), today.getMonth() - (prev ? 1 : 0), 1);
  return `${ym(d.getFullYear(), d.getMonth())}-01`;
}

/** 집행 사용일자 — 저장된 값, 없으면(예전 기록) 같은 달 등록일, 그것도 아니면 사용월 1일 */
export function spentDateOf(r: { month: string; date: string; useDate?: string }): string {
  return r.useDate ?? (r.date.startsWith(r.month) ? r.date : `${r.month}-01`);
}

/** 'YYYY-MM' 또는 'YYYY-MM-DD' → 그 달 1일 'YYYY-MM-DD' (일자가 있으면 그대로) */
export function toStartDate(v: string): string {
  return !v || v.length > 7 ? v : `${v}-01`;
}
/** 'YYYY-MM' 또는 'YYYY-MM-DD' → 그 달 말일 'YYYY-MM-DD' (일자가 있으면 그대로) */
export function toEndDate(v: string): string {
  if (!v || v.length > 7) return v;
  const { year, month } = parseYm(v);
  return `${v}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
}

/** '2026-09-05' → '26/9/5' (PC 큰 글씨 표의 짧은 날짜) */
export function shortYmd(v: string): string {
  const [y, m, d] = v.split('-');
  return d ? `${y.slice(2)}/${Number(m)}/${Number(d)}` : v;
}
/** '2026-09-05' → '9/5' */
export function shortMd(v: string): string {
  const [, m, d] = v.split('-');
  return d ? `${Number(m)}/${Number(d)}` : v;
}
