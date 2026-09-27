import type { ChecklistItem, Project } from '@/types';
import type { AppState } from './reducer';
import { CUR_MONTH, CUR_QUARTER, isQuarterEnd, monthsUntil } from '@/lib/date';

/** 로그인한 팀이 받는 알림 (team 이 없으면 전체 대상) */
export const myNotifications = (s: AppState) => s.notifications.filter(n => !n.team || n.team === s.session?.team);
export const unreadCount = (s: AppState) => myNotifications(s).filter(n => !n.read).length;

export const currentQuarter = (s: AppState) => s.quarters[CUR_QUARTER];

export const myActiveProjects = (s: AppState) => s.projects.filter(p => p.isMine && p.active);

/** 진행 중 프로젝트 = 활성 + 종료월이 지나지 않은 건 */
export const openProjects = (s: AppState) => s.projects.filter(p => p.active && monthsUntil(p.endDate) >= 0);

/** 다음 달 소멸 예정 금액 */
export function expiring(s: AppState) {
  const q = currentQuarter(s);
  // 분기 마지막 달이면 남은 회의비는 다음 달에 소멸
  const meeting = isQuarterEnd(CUR_MONTH) ? Math.max(0, q.budget - q.used) : 0;
  // 이번 달 종료 프로젝트의 잔액 소멸
  const project = myActiveProjects(s)
    .filter(p => monthsUntil(p.endDate) === 0)
    .reduce((sum, p) => sum + Math.max(0, p.allocPool - p.used), 0);
  return { meeting, project, total: meeting + project };
}

/** 홈 히어로: 이번 분기 회의비 + 내 활성 프로젝트 경비 */
export function budgetOverview(s: AppState) {
  const q = currentQuarter(s);
  const projects = myActiveProjects(s);
  const projBudget = projects.reduce((sum, p) => sum + p.allocPool, 0);
  const projUsed = projects.reduce((sum, p) => sum + p.used, 0);
  return {
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
