import type {
  AllocRow, ChecklistItem, ExecRecord, MonthlyExec, NotifItem, Project, QuarterData, Team,
} from '@/types';

export const DEFAULT_MEETING_RATE = 30000;
/** My 경비 구분 — 모든 팀 공통 고정값 (팀이 직접 만든 구분은 state.categories 에 팀별로) */
export const CATEGORIES = ['회의비(원가)', '업무비(원가)', '일반교통비(원가)', '기타(원가)'] as const;

export const SEED_TEAMS: Team[] = [];
export const SEED_PROJECTS: Project[] = [];
export const SEED_ALLOCS: Record<string, AllocRow[]> = {};
export const SEED_CHECKLIST: ChecklistItem[] = [];
export const SEED_QUARTERS: QuarterData[] = [1, 2, 3, 4].map(quarter => ({
  quarter,
  label: `${quarter}분기`,
  months: Array.from({ length: 3 }, (_, i) => `${(quarter - 1) * 3 + i + 1}월`),
  headcounts: [0, 0, 0],
  budget: 0,
  used: 0,
}));
export const SEED_NOTIFICATIONS: NotifItem[] = [];
export const SEED_MONTHLY: MonthlyExec[] = Array.from({ length: 12 }, (_, month) => ({ month, meeting: 0, project: 0 }));
export const SEED_PROJECT_MONTHLY: Record<string, number[]> = {};
export const YEARLY_HISTORY: { year: number; meeting: number; project: number }[] = [];
export const YEARLY_BUDGET: { year: number; budget: number; used: number }[] = [];
export const SEED_WORK_BUDGETS: Record<string, number> = {};
export const SEED_RECORDS: ExecRecord[] = [];
