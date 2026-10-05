import type { ChecklistItem, Project } from '@/types';
import type { AppState } from './reducer';
import { CUR_MONTH, CUR_QUARTER, isQuarterEnd, monthsUntil } from '@/lib/date';

/** 로그인한 팀이 받는 알림 (team 이 없으면 전체 대상) — 집행 등록 완료(exec)는 없앤 알림이라 예전 것도 숨김 */
export const myNotifications = (s: AppState) => s.notifications.filter(n => n.type !== 'exec' && (!n.team || n.team === s.session?.team));
export const unreadCount = (s: AppState) => myNotifications(s).filter(n => !n.read).length;

export const currentQuarter = (s: AppState) => s.quarters[CUR_QUARTER];

export const myActiveProjects = (s: AppState) => s.projects.filter(p => p.isMine && p.active);

/**
 * 로그인한 팀의 이 프로젝트 예산 = 우리 팀 배분 행 (주관 팀은 My 경비) — 배분이 없으면 null
 * 다른 팀 배분액은 우리 팀이 쓸 수 없으므로 프로젝트 전체(배분 가능 금액·전체 사용액)가 아닌 이 값을 예산으로 본다
 */
export function teamAllocOf(s: Pick<AppState, 'allocs' | 'session'>, p: Pick<Project, 'id' | 'endDate'>) {
  const a = s.allocs[p.id]?.find(x => x.teamName === s.session?.team);
  if (!a) return null;
  const used = a.used ?? 0;
  return { amount: a.amount, used, remain: a.amount - used, endDate: a.endDate || p.endDate };
}
/** 우리 팀이 예산을 가진 활성 프로젝트 — 주관(My 경비) + 배분받은 참여 프로젝트 */
export const myBudgetProjects = (s: AppState) => s.projects.filter(p => p.active && !!teamAllocOf(s, p));

/** 진행 중 프로젝트 = 활성 + 종료월이 지나지 않은 건 */
export const openProjects = (s: AppState) => s.projects.filter(p => p.active && monthsUntil(p.endDate) >= 0);

/** 로그인한 팀의 이 프로젝트 경비 사용 종료일 — 팀 배분에 정한 날, 없으면 프로젝트 종료일 */
export function useEndOf(s: Pick<AppState, 'allocs' | 'session'>, p: Pick<Project, 'id' | 'endDate'>): string {
  return s.allocs[p.id]?.find(a => a.teamName === s.session?.team)?.endDate || p.endDate;
}

/**
 * 집행 등록에서 고를 수 있는 프로젝트 — 활성 + 우리 팀 배분이 있음(주관 팀은 My 경비 배분) + 사용일자가 사용 종료일 이내
 * (DB 규칙: 프로젝트 경비는 배분받은 팀만 집행 — exec_records → project_allocations 외래키)
 * (등록하는 날이 아니라 사용일자 기준: 9/30 종료면 10/1 사용 건은 안 보이고, 10/1 에 9/28 사용 건을 등록하면 보임)
 */
export const execProjects = (s: AppState, useDate: string) =>
  s.projects.filter(p => p.active && !!s.allocs[p.id]?.some(a => a.teamName === s.session?.team) && useDate <= useEndOf(s, p));

/** 다음 달 소멸 예정 금액 */
export function expiring(s: AppState) {
  const q = currentQuarter(s);
  // 분기 마지막 달이면 남은 회의비는 다음 달에 소멸
  const meeting = isQuarterEnd(CUR_MONTH) ? Math.max(0, q.budget - q.used) : 0;
  // 이번 달에 사용 종료되는 프로젝트의 우리 팀 배분 잔액 소멸 (팀별 사용 종료일, 없으면 프로젝트 종료일)
  const project = myBudgetProjects(s).reduce((sum, p) => {
    const a = teamAllocOf(s, p)!;
    return monthsUntil(a.endDate) === 0 ? sum + Math.max(0, a.remain) : sum;
  }, 0);
  return { meeting, project, total: meeting + project };
}

/** 홈 히어로: 이번 분기 회의비 + 우리 팀 배분 프로젝트 경비 (주관 My 경비 + 참여 배분) */
export function budgetOverview(s: AppState) {
  const q = currentQuarter(s);
  const projects = myBudgetProjects(s);
  const projBudget = projects.reduce((sum, p) => sum + teamAllocOf(s, p)!.amount, 0);
  const projUsed = projects.reduce((sum, p) => sum + teamAllocOf(s, p)!.used, 0);
  return {
    projectCount: projects.length,
    meetingBudget: q.budget,
    meetingUsed: q.used,
    projBudget,
    projUsed,
    total: q.budget + projBudget,
    used: q.used + projUsed,
  };
}

/** 체크리스트 공개 여부 (값이 없던 기존 항목은 공개) */
export const isPublicCheck = (c: Pick<ChecklistItem, 'visibility'>) => c.visibility !== 'private';
/** 체크리스트 기준 날짜 — 완료는 집행일(없으면 예정일), 미완료는 예정일 */
export const checkDateOf = (c: Pick<ChecklistItem, 'checked' | 'date' | 'spentDate'>) => (c.checked ? c.spentDate ?? c.date : c.date);

/** 로그인한 팀이 볼 수 있는 체크리스트 — 주관 프로젝트는 전부, 배분받은 참여 프로젝트는 공개 항목만 */
export function visibleChecklist(s: AppState): ChecklistItem[] {
  const byId = new Map(s.projects.map(p => [p.id, p]));
  return s.checklist.filter(c => {
    const p = byId.get(c.projectId);
    return !!p && (p.isMine || (!!p.joined && isPublicCheck(c)));
  });
}

/**
 * 체크리스트 기준 예산 = 주관 팀의 My 경비 배분 금액 (코웍 팀 배분 중 주관 팀 몫)
 * 참여 팀이 보는 코웍 체크리스트도 이 금액 기준 — 참여 팀 자신의 배분 예산과는 별개
 */
export function ownerBudget(s: Pick<AppState, 'allocs'>, p: Pick<Project, 'id' | 'ownerTeam'>) {
  const a = s.allocs[p.id]?.find(x => x.teamName === p.ownerTeam);
  const amount = a?.amount ?? 0, used = a?.used ?? 0;
  return { team: p.ownerTeam, amount, used, remain: amount - used };
}
