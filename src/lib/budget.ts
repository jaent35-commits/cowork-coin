import type { BudgetType, ExecRecord } from '@/types';
import type { AppState } from '@/store/reducer';
import { CUR_YEAR, parseYm, quarterOf } from './date';

/** 예산 유형 선택값: 'meeting' | 'work' | 'p:<프로젝트 id>' */
export const typeKeyOf = (type: BudgetType, projectId?: string) => (type === 'project' ? `p:${projectId}` : type);
export const recordTypeKey = (r: ExecRecord) => typeKeyOf(r.type, r.projectId);
export const parseTypeKey = (key: string): { type: BudgetType; projectId?: string } =>
  key === 'meeting' || key === 'work' ? { type: key } : { type: 'project', projectId: key.slice(2) };

/** 대메뉴 그룹 — [팀 운영 › 팀 회의비·팀 업무비] / [프로젝트 운영 › 프로젝트명] */
export const TEAM_GROUP = '팀 운영';
export const PROJECT_GROUP = '프로젝트 운영';
export const TEAM_TYPES = [
  { key: 'meeting', name: '팀 회의비', icon: '👥' },
  { key: 'work', name: '팀 업무비', icon: '💼' },
] as const;
export const groupOf = (type: BudgetType) => (type === 'project' ? PROJECT_GROUP : TEAM_GROUP);
export const typeIcon = (type: BudgetType) => (type === 'meeting' ? '👥' : type === 'work' ? '💼' : '📁');

/** 집행 이력의 예산 이름 (팀 회의비 / 팀 업무비 / 프로젝트명) */
export function budgetName(state: Pick<AppState, 'projects'>, r: Pick<ExecRecord, 'type' | 'projectId'>): string {
  if (r.type === 'meeting') return '팀 회의비';
  if (r.type === 'work') return '팀 업무비';
  return state.projects.find(p => p.id === r.projectId)?.name ?? '삭제된 프로젝트';
}

/**
 * 팀 업무비 월 예산 — 입력한 달은 그 금액, 입력하지 않은 달은 가장 가까운 이전 달 금액
 * (from = 금액을 가져온 달, 직접 입력한 달이면 month 와 같음)
 */
export function workBudgetOf(state: Pick<AppState, 'workBudgets'>, month: string): { amount: number; saved: boolean; from: string | null } {
  const wb = state.workBudgets ?? {};
  if (month in wb) return { amount: wb[month], saved: true, from: month };
  const prev = Object.keys(wb).filter(m => m < month).sort().pop();
  return prev ? { amount: wb[prev], saved: false, from: prev } : { amount: 0, saved: false, from: null };
}
/** 팀 업무비 사용액 = 그 달(사용월) 업무비 집행 합 */
export const workUsedOf = (state: Pick<AppState, 'records'>, month: string) =>
  state.records.filter(r => r.type === 'work' && r.month === month).reduce((s, r) => s + r.total, 0);

export interface Bucket {
  /** 같은 예산에서 나가는지 비교용 (회의비는 분기별, 업무비는 월별) */
  id: string;
  name: string;
  sub: string;
  budget: number;
  used: number;
  /** 알 수 없으면 null (올해가 아닌 회의비 등) */
  remain: number | null;
}

/** 사용월 + 예산 유형 → 차감되는 예산 (회의비 = 사용월의 분기, 업무비 = 사용월, 프로젝트 = 배분 경비) */
export function bucketOf(state: AppState, key: string, month: string): Bucket | null {
  const { type, projectId } = parseTypeKey(key);
  if (type === 'meeting') {
    const { year, month: mi } = parseYm(month);
    if (year !== CUR_YEAR) return { id: `meeting:${year}`, name: '팀 회의비', sub: `${year}년`, budget: 0, used: 0, remain: null };
    const qi = quarterOf(mi);
    const q = state.quarters[qi];
    return { id: `meeting:q${qi}`, name: '팀 회의비', sub: q.label, budget: q.budget, used: q.used, remain: q.budget - q.used };
  }
  if (type === 'work') {
    const { year, month: mi } = parseYm(month);
    const budget = workBudgetOf(state, month).amount, used = workUsedOf(state, month);
    return { id: `work:${month}`, name: '팀 업무비', sub: `${year}년 ${mi + 1}월`, budget, used, remain: budget - used };
  }
  const p = state.projects.find(x => x.id === projectId);
  if (!p) return null;
  // 배분받은 코웍 팀은 우리 팀 배분액에서 차감 (주관 팀은 프로젝트 배분 경비 전체)
  const team = state.session?.team;
  const mine = p.ownerTeam !== team ? state.allocs[p.id]?.find(a => a.teamName === team) : undefined;
  if (mine) {
    const used = mine.used ?? 0;
    return { id: p.id, name: p.name, sub: '우리 팀 배분 경비', budget: mine.amount, used, remain: mine.amount - used };
  }
  return { id: p.id, name: p.name, sub: '프로젝트 경비', budget: p.allocPool, used: p.used, remain: p.allocPool - p.used };
}
