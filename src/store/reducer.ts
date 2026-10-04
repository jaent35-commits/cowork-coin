import type { CheckVisibility,
  AllocRow, ChecklistItem, ExecRecord, MonthlyExec, NotifItem, NotifPrefs, Project, ProjectDraft, PushKind, QuarterData, Session, Team,
} from '@/types';
import { splitRecords } from '@/lib/records';
import {
  CATEGORIES, DEFAULT_MEETING_RATE, SEED_ALLOCS, SEED_CHECKLIST, SEED_MONTHLY, SEED_NOTIFICATIONS,
  SEED_PROJECT_MONTHLY, SEED_PROJECTS, SEED_QUARTERS, SEED_RECORDS, SEED_TEAMS, SEED_WORK_BUDGETS,
} from '@/data/seed';
import { CUR_QUARTER, CUR_YEAR, TODAY_ISO, monthsUntil, parseYm, quarterOf, toEndDate } from '@/lib/date';
import { fmt, uid } from '@/lib/format';
import { budgetName, workBudgetOf } from '@/lib/budget';

export interface AppState {
  session: Session | null;
  teams: Team[];
  projects: Project[];
  allocs: Record<string, AllocRow[]>;
  checklist: ChecklistItem[];
  quarters: QuarterData[];
  monthly: MonthlyExec[];
  /** 프로젝트별 올해 월별 집행액 (길이 12) */
  projectMonthly: Record<string, number[]>;
  records: ExecRecord[];
  notifications: NotifItem[];
  /** 팀명 → 알림 설정 */
  notifPrefs: Record<string, NotifPrefs>;
  meetingRate: number;
  /** 팀 업무비 월 예산 'YYYY-MM' → 금액 (입력한 달만. 사용액은 집행 이력에서 계산) */
  workBudgets: Record<string, number>;
  /** 팀명 → 팀이 직접 만든 My 경비 구분 (그 팀만 보고 씀) */
  categories: Record<string, string[]>;
  /** 다음 연도 분기 인원·예산 미리 입력 (연도 → 분기 4개) — 그 해가 되면 quarters 로 옮김 */
  plannedQuarters: Record<string, QuarterData[]>;
  /** quarters 가 몇 년 것인지 — 해가 바뀌면 그 해 계획(plannedQuarters)으로 교체 */
  quartersYear: number;
}

export const DEFAULT_PREFS: NotifPrefs = { push: false, kinds: { exec: true, setting: true, alloc: true, deadline: true } };

export function seedState(): AppState {
  return structuredClone({
    session: null,
    teams: SEED_TEAMS,
    projects: SEED_PROJECTS,
    allocs: SEED_ALLOCS,
    checklist: SEED_CHECKLIST,
    quarters: SEED_QUARTERS,
    monthly: SEED_MONTHLY,
    projectMonthly: SEED_PROJECT_MONTHLY,
    records: splitRecords(SEED_RECORDS),
    notifications: SEED_NOTIFICATIONS,
    notifPrefs: {},
    meetingRate: DEFAULT_MEETING_RATE,
    workBudgets: SEED_WORK_BUDGETS,
    categories: {},
    plannedQuarters: {},
    quartersYear: CUR_YEAR,
  });
}

export type Action =
  | { type: 'INITIALIZE'; name: string; password: string }
  | { type: 'LOGIN'; session: Session }
  | { type: 'LOGOUT' }
  | { type: 'TOGGLE_TEAM'; id: string }
  | { type: 'ADD_TEAM'; name: string; password: string }
  | { type: 'RENAME_TEAM'; id: string; name: string }
  | { type: 'DELETE_TEAM'; id: string }
  | { type: 'SET_TEAM_ADMIN'; id: string; isAdmin: boolean }
  /** by: self = 본인 변경, reset = 관리자 초기화 */
  /** password: 브라우저 저장본 로그인일 때만 (Supabase 로그인은 비밀번호를 앱에 두지 않음 — 알림·상태만) */
  | { type: 'SET_TEAM_PASSWORD'; teamName: string; password?: string; by: 'self' | 'reset' }
  /** Supabase 팀 목록으로 교체 — 이름이 바뀐 팀은 배분·집행·주관 팀 이름도 함께 변경 */
  | { type: 'SYNC_TEAMS'; teams: Team[] }
  | { type: 'SET_RATE'; rate: number }
  /** year: 올해가 아닌(다음) 연도면 plannedQuarters 에 저장 — 9월부터 다음 해 인원을 미리 입력 */
  | { type: 'SAVE_HEADCOUNTS'; quarterIdx: number; headcounts: number[]; year?: number }
  /** scope: after = 이후 달도 같은 금액(이후에 따로 입력한 달은 지움), only = 이 달만 (다음 달은 기존 금액 유지) */
  | { type: 'SAVE_WORK_BUDGET'; month: string; amount: number; scope: 'after' | 'only' }
  | { type: 'ADD_PROJECT'; id: string; draft: ProjectDraft; team: string }
  /** reactivate: 비활성 프로젝트를 편집에서 다시 활성화 */
  | { type: 'UPDATE_PROJECT'; id: string; draft: ProjectDraft; allocs: AllocRow[]; reactivate?: boolean }
  /** 코웍 팀 미사용 금액을 주관 팀으로 — 코웍 팀 배분액 = 사용액(잔액 0), 남은 금액은 주관 팀 배분에 더함 */
  | { type: 'RECLAIM_ALLOCS'; id: string }
  | { type: 'DEACTIVATE_PROJECT'; id: string; month: string }
  | { type: 'TOGGLE_CHECK'; id: string }
  /** 완료 항목의 집행 금액 · 집행일 수정 */
  | { type: 'SET_CHECK_EXEC'; id: string; patch: Pick<ChecklistItem, 'spent' | 'spentDate'> }
  | { type: 'ADD_CHECK'; item: Omit<ChecklistItem, 'id' | 'checked'> }
  | { type: 'DELETE_CHECK'; id: string }
  /** 팀이 직접 만든 My 경비 구분 추가 (고정 구분·이미 있는 이름이면 무시) */
  | { type: 'ADD_CATEGORY'; team: string; name: string }
  | { type: 'SET_CHECK_VISIBILITY'; id: string; visibility: CheckVisibility }
  | { type: 'ADD_RECORD'; record: Omit<ExecRecord, 'id' | 'total'> }
  /** 집행 등록 화면: 여러 줄(1줄 = 1건)을 한 번에 — 알림은 1개로 묶음 */
  | { type: 'ADD_RECORDS'; records: Omit<ExecRecord, 'id' | 'total'>[] }
  | { type: 'UPDATE_RECORD'; record: ExecRecord }
  | { type: 'DELETE_RECORD'; id: string }
  | { type: 'DELETE_RECORDS'; ids: string[] }
  | { type: 'READ_NOTIF'; id: string }
  | { type: 'READ_ALL_NOTIF' }
  | { type: 'CHECK_DEADLINES' }
  | { type: 'SET_PUSH'; team: string; push: boolean }
  | { type: 'SET_PUSH_KIND'; team: string; kind: PushKind; on: boolean };

const sumItems = (r: Pick<ExecRecord, 'items'>) => r.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

function notify(state: AppState, n: Omit<NotifItem, 'id' | 'time' | 'read'>): NotifItem[] {
  return [{ ...n, id: uid('n'), time: '방금 전', read: false }, ...state.notifications];
}

/** 프로젝트 배분 변경 → 새로 배분되거나 금액이 바뀐 팀에게 알림 */
function allocNotices(state: AppState, p: Pick<Project, 'name'>, prev: AllocRow[], next: AllocRow[]): NotifItem[] {
  let list = state.notifications;
  for (const a of next) {
    if (!a.teamName.trim()) continue;
    const before = prev.find(x => x.teamName === a.teamName)?.amount ?? 0;
    // 0원 → 0원은 알릴 것 없음 (배분액이 0원으로 줄어든 팀은 '변경'으로 알림)
    if (before === a.amount || (a.amount <= 0 && before <= 0)) continue;
    list = notify({ ...state, notifications: list }, before > 0
      ? { type: 'alloc', team: a.teamName, title: '프로젝트 배분 변경', desc: `${p.name} 프로젝트의 우리 팀 배분 금액이 ${fmt(before)} → ${fmt(a.amount)}으로 변경되었습니다.` }
      : { type: 'alloc', team: a.teamName, title: '새 프로젝트 배분', desc: `${p.name} 프로젝트에 우리 팀 예산 ${fmt(a.amount)}이 배분되었습니다.` });
  }
  return list;
}

/** 집행 이력 1건을 예산(분기 회의비 / 프로젝트 사용액 / 월별 집계)에 sign 방향으로 반영한다. */
function applyRecord(state: AppState, r: ExecRecord, sign: 1 | -1): AppState {
  const { year, month } = parseYm(r.month);
  const delta = r.total * sign;
  const clamp = (v: number) => Math.max(0, v + delta);
  let { quarters, projects, monthly, projectMonthly, allocs } = state;

  if (r.type === 'meeting' && year === CUR_YEAR) {
    const qi = quarterOf(month);
    quarters = quarters.map((q, i) => (i === qi ? { ...q, used: clamp(q.used) } : q));
  }
  if (r.type === 'project' && r.projectId) {
    const pid = r.projectId;
    projects = projects.map(p => (p.id === pid ? { ...p, used: clamp(p.used) } : p));
    if (year === CUR_YEAR) {
      const row = projectMonthly[pid] ?? Array(12).fill(0);
      projectMonthly = { ...projectMonthly, [pid]: row.map((v, i) => (i === month ? clamp(v) : v)) };
    }
    // 집행 팀의 배분 사용액 반영
    if (r.team && allocs[pid]?.some(a => a.teamName === r.team)) {
      allocs = { ...allocs, [pid]: allocs[pid].map(a => (a.teamName === r.team ? { ...a, used: clamp(a.used ?? 0) } : a)) };
    }
  }
  if (year === CUR_YEAR && r.type !== 'work') {
    const k = r.type;
    monthly = monthly.map(m => (m.month === month ? { ...m, [k]: clamp(m[k]) } : m));
  }
  return { ...state, quarters, projects, monthly, projectMonthly, allocs };
}

function budgetWarning(state: AppState, r: ExecRecord): NotifItem[] {
  if (r.type !== 'project') return state.notifications;
  const p = state.projects.find(x => x.id === r.projectId);
  if (!p || p.allocPool <= 0) return state.notifications;
  const remainRatio = (p.allocPool - p.used) / p.allocPool;
  if (remainRatio >= 0.15) return state.notifications;
  return notify(state, {
    type: 'budget',
    title: `예산 경고: ${p.name}`,
    desc: `프로젝트 경비 잔액이 ${Math.max(0, Math.round(remainRatio * 100))}%(${fmt(Math.max(0, p.allocPool - p.used))}) 남았습니다. 추가 집행에 주의하세요.`,
  });
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INITIALIZE':
      if (state.teams.length) return state;
      return {
        ...state,
        teams: [{ id: uid('t'), name: action.name, password: action.password, active: true, isAdmin: true, mustChangePassword: false }],
        session: { team: action.name, isAdmin: true },
      };
    case 'LOGIN':
      return { ...state, session: action.session };
    case 'LOGOUT':
      return { ...state, session: null };

    case 'TOGGLE_TEAM':
      return { ...state, teams: state.teams.map(t => (t.id === action.id ? { ...t, active: !t.active } : t)) };
    case 'ADD_TEAM':
      // password = 관리자에게 한 번 보여 준 임시 비밀번호 → 첫 로그인 때 변경 필수
      return { ...state, teams: [...state.teams, { id: uid('t'), name: action.name, password: action.password, active: true, isAdmin: false, mustChangePassword: true }] };
    case 'RENAME_TEAM': {
      const prev = state.teams.find(t => t.id === action.id);
      if (!prev || prev.name === action.name) return state;
      const from = prev.name;
      const rn = (n?: string) => (n === from ? action.name : n);
      // 팀명을 참조하는 곳(배분·집행 팀·주관 팀·세션)도 함께 변경
      return {
        ...state,
        teams: state.teams.map(t => (t.id === action.id ? { ...t, name: action.name } : t)),
        allocs: Object.fromEntries(Object.entries(state.allocs).map(([k, rows]) => [k, rows.map(a => ({ ...a, teamName: rn(a.teamName)! }))])),
        records: state.records.map(r => (r.team === from ? { ...r, team: action.name } : r)),
        projects: state.projects.map(p => (p.ownerTeam === from ? { ...p, ownerTeam: action.name } : p)),
        categories: Object.fromEntries(Object.entries(state.categories).map(([k, v]) => [rn(k)!, v])),
        session: state.session && state.session.team === from ? { ...state.session, team: action.name } : state.session,
      };
    }
    case 'SYNC_TEAMS': {
      let s = state;
      for (const t of action.teams) {
        const prev = s.teams.find(x => x.id === t.id);
        if (prev && prev.name !== t.name) s = reducer(s, { type: 'RENAME_TEAM', id: t.id, name: t.name });
      }
      const me = action.teams.find(t => t.name === s.session?.team);
      return { ...s, teams: action.teams, session: s.session && me ? { ...s.session, isAdmin: !!me.isAdmin } : s.session };
    }
    case 'DELETE_TEAM':
      return { ...state, teams: state.teams.filter(t => t.id !== action.id) };
    case 'SET_TEAM_ADMIN':
      return { ...state, teams: state.teams.map(t => (t.id === action.id ? { ...t, isAdmin: action.isAdmin } : t)) };
    case 'SET_TEAM_PASSWORD':
      return {
        ...state,
        // 관리자 초기화 = 임시 비밀번호 → 다음 로그인 때 변경 필수 / 팀 본인 변경 = 해제
        teams: state.teams.map(t => (t.name === action.teamName ? { ...t, password: action.password ?? t.password, mustChangePassword: action.by === 'reset' } : t)),
        // 비밀번호 주인 팀에게 알림 (관리자가 초기화한 경우도 해당 팀이 받음)
        notifications: notify(state, action.by === 'reset'
          ? { type: 'setting', team: action.teamName, title: '비밀번호 초기화', desc: `관리자가 ${action.teamName} 계정의 비밀번호를 초기화했습니다. 관리자에게 받은 임시 비밀번호로 로그인하면 새 비밀번호로 변경한 뒤 시작합니다.` }
          : { type: 'setting', team: action.teamName, title: '비밀번호 변경 완료', desc: `${action.teamName} 계정의 비밀번호가 성공적으로 변경되었습니다.` }),
      };

    case 'SET_RATE':
      // 이번 분기부터 즉시 반영 — 현재·이후 분기 예산 재산정
      return {
        ...state,
        meetingRate: action.rate,
        quarters: state.quarters.map((q, i) =>
          i < CUR_QUARTER ? q : { ...q, budget: q.headcounts.reduce((s, n) => s + n, 0) * action.rate }),
      };

    case 'SAVE_HEADCOUNTS': {
      const save = (qs: QuarterData[]) => qs.map((q, i) => i !== action.quarterIdx ? q : {
        ...q,
        headcounts: [...action.headcounts],
        budget: action.headcounts.reduce((s, n) => s + n, 0) * state.meetingRate,
      });
      if (action.year && action.year !== CUR_YEAR) {
        const key = String(action.year);
        return { ...state, plannedQuarters: { ...state.plannedQuarters, [key]: save(state.plannedQuarters[key] ?? structuredClone(SEED_QUARTERS)) } };
      }
      return { ...state, quarters: save(state.quarters) };
    }

    case 'SAVE_WORK_BUDGET': {
      const { month, scope } = action;
      const amount = Math.max(0, action.amount);
      let wb = { ...state.workBudgets };
      if (scope === 'after') {
        wb = Object.fromEntries(Object.entries(wb).filter(([m]) => m <= month));
      } else {
        // 다음 달이 이 달 금액을 물려받고 있었다면, 바꾸기 전 금액으로 고정
        const [y, m] = month.split('-').map(Number);
        const t = new Date(y, m, 1);
        const next = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
        if (!(next in wb)) wb[next] = workBudgetOf(state, next).amount;
      }
      wb[month] = amount;
      return { ...state, workBudgets: wb };
    }

    case 'ADD_PROJECT': {
      const { id } = action;
      return {
        ...state,
        projects: [...state.projects, { ...action.draft, id, active: true, isMine: true, ownerTeam: action.team }],
        allocs: { ...state.allocs, [id]: [] },
        projectMonthly: { ...state.projectMonthly, [id]: Array(12).fill(0) },
      };
    }
    case 'UPDATE_PROJECT': {
      const allocs = action.allocs.filter(a => a.teamName.trim() || a.amount);
      return {
        ...state,
        projects: state.projects.map(p => (p.id === action.id ? { ...p, ...action.draft, ...(action.reactivate ? { active: true } : {}) } : p)),
        allocs: { ...state.allocs, [action.id]: allocs },
        notifications: allocNotices(state, action.draft, state.allocs[action.id] ?? [], allocs),
      };
    }
    case 'RECLAIM_ALLOCS': {
      const p = state.projects.find(x => x.id === action.id);
      const prev = state.allocs[action.id] ?? [];
      if (!p) return state;
      let freed = 0;
      let next = prev.map(a => {
        if (a.teamName === p.ownerTeam) return a;
        const used = a.used ?? 0;
        if (a.amount <= used) return a;
        freed += a.amount - used;
        return { ...a, amount: used };
      });
      if (!freed) return state;
      next = next.some(a => a.teamName === p.ownerTeam)
        ? next.map(a => (a.teamName === p.ownerTeam ? { ...a, amount: a.amount + freed } : a))
        : [{ id: uid('a'), teamName: p.ownerTeam, amount: freed, used: 0 }, ...next];
      return { ...state, allocs: { ...state.allocs, [action.id]: next }, notifications: allocNotices(state, p, prev, next) };
    }
    case 'DEACTIVATE_PROJECT':
      return { ...state, projects: state.projects.map(p => (p.id === action.id ? { ...p, active: false, endDate: toEndDate(action.month) } : p)) };

    case 'TOGGLE_CHECK':
      // 체크하면 집행 금액 = 예산 · 집행일 = 오늘로 시작, 체크 해제하면 둘 다 지움 (예정일로 돌아감)
      return { ...state, checklist: state.checklist.map(c => (c.id === action.id
        ? c.checked ? { ...c, checked: false, spent: undefined, spentDate: undefined } : { ...c, checked: true, spent: c.amount, spentDate: TODAY_ISO }
        : c)) };
    case 'SET_CHECK_EXEC':
      return { ...state, checklist: state.checklist.map(c => (c.id === action.id && c.checked ? { ...c, ...action.patch } : c)) };
    case 'ADD_CHECK':
      return { ...state, checklist: [...state.checklist, { ...action.item, id: uid('c'), checked: false }] };
    case 'SET_CHECK_VISIBILITY':
      return { ...state, checklist: state.checklist.map(c => (c.id === action.id ? { ...c, visibility: action.visibility } : c)) };
    case 'DELETE_CHECK':
      return { ...state, checklist: state.checklist.filter(c => c.id !== action.id) };
    case 'ADD_CATEGORY': {
      const name = action.name.trim();
      const mine = state.categories[action.team] ?? [];
      if (!name || (CATEGORIES as readonly string[]).includes(name) || mine.includes(name)) return state;
      return { ...state, categories: { ...state.categories, [action.team]: [...mine, name] } };
    }

    case 'ADD_RECORD': {
      const record: ExecRecord = { ...action.record, id: uid('e'), total: sumItems(action.record) };
      let next = applyRecord({ ...state, records: [record, ...state.records] }, record, 1);
      const label = budgetName(state, record);
      next = { ...next, notifications: notify(next, { type: 'exec', team: record.team ?? state.session?.team, title: '집행 등록 완료', desc: `${label} ${fmt(record.total)}이 정상 등록되었습니다.` }) };
      return { ...next, notifications: budgetWarning(next, record) };
    }
    case 'ADD_RECORDS': {
      if (!action.records.length) return state;
      let next = state;
      const added: ExecRecord[] = [];
      for (const r of action.records) {
        const record: ExecRecord = { ...r, id: uid('e'), total: sumItems(r) };
        added.push(record);
        next = applyRecord({ ...next, records: [record, ...next.records] }, record, 1);
      }
      const total = added.reduce((s, r) => s + r.total, 0);
      const first = added[0];
      const label = budgetName(state, first);
      const desc = added.length === 1 ? `${label} ${fmt(total)}이 정상 등록되었습니다.` : `${label} 외 ${added.length - 1}건, 합계 ${fmt(total)}이 정상 등록되었습니다.`;
      next = { ...next, notifications: notify(next, { type: 'exec', team: first.team ?? state.session?.team, title: '집행 등록 완료', desc }) };
      for (const r of added) next = { ...next, notifications: budgetWarning(next, r) };
      return next;
    }
    case 'UPDATE_RECORD': {
      const prev = state.records.find(r => r.id === action.record.id);
      if (!prev) return state;
      const record = { ...action.record, total: sumItems(action.record) };
      const reverted = applyRecord(state, prev, -1);
      return applyRecord({ ...reverted, records: state.records.map(r => (r.id === record.id ? record : r)) }, record, 1);
    }
    case 'DELETE_RECORDS': {
      let next = state;
      for (const id of action.ids) {
        const prev = next.records.find(r => r.id === id);
        if (prev) next = applyRecord({ ...next, records: next.records.filter(r => r.id !== id) }, prev, -1);
      }
      return next;
    }
    case 'DELETE_RECORD': {
      const prev = state.records.find(r => r.id === action.id);
      if (!prev) return state;
      return applyRecord({ ...state, records: state.records.filter(r => r.id !== action.id) }, prev, -1);
    }

    case 'READ_NOTIF':
      return { ...state, notifications: state.notifications.map(n => (n.id === action.id ? { ...n, read: true } : n)) };
    case 'READ_ALL_NOTIF':
      // 로그인한 팀이 받는 알림만 읽음 처리
      return { ...state, notifications: state.notifications.map(n => (!n.team || n.team === state.session?.team ? { ...n, read: true } : n)) };

    case 'CHECK_DEADLINES': {
      // 다음 달 종료되는 My 프로젝트 → 1개월 전 기한 임박 알림 (팀·프로젝트·종료월당 1회)
      const team = state.session?.team;
      if (!team) return state;
      let list = state.notifications;
      for (const p of state.projects) {
        if (p.ownerTeam !== team || !p.active || monthsUntil(p.endDate) !== 1) continue;
        const key = `deadline:${team}:${p.id}:${p.endDate.slice(0, 7)}`;
        if (list.some(n => n.key === key)) continue;
        const mine = state.allocs[p.id]?.find(a => a.teamName === team);
        const teamRemain = mine ? ` (우리 팀 잔액 ${fmt(Math.max(0, mine.amount - (mine.used ?? 0)))})` : '';
        list = notify({ ...state, notifications: list }, {
          type: 'deadline', team, key, title: `기한 임박: ${p.name}`,
          desc: `다음 달(${p.endDate}) 종료 예정입니다. 잔여 금액 ${fmt(Math.max(0, p.allocPool - p.used))}${teamRemain} — 기한 내 집행을 확인하세요.`,
        });
      }
      return list === state.notifications ? state : { ...state, notifications: list };
    }
    case 'SET_PUSH': {
      const cur = state.notifPrefs[action.team] ?? DEFAULT_PREFS;
      return { ...state, notifPrefs: { ...state.notifPrefs, [action.team]: { ...cur, push: action.push } } };
    }
    case 'SET_PUSH_KIND': {
      const cur = state.notifPrefs[action.team] ?? DEFAULT_PREFS;
      return { ...state, notifPrefs: { ...state.notifPrefs, [action.team]: { ...cur, kinds: { ...cur.kinds, [action.kind]: action.on } } } };
    }

  }
}
