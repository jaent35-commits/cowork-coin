import type { AllocRow, BudgetType, ChecklistItem, ExecRecord, MonthlyExec, NotifItem, NotifPrefs, NotifType, Project, ProjectDraft, QuarterData, Team } from '@/types';
import type { Action, AppState } from '@/store/reducer';
import { DEFAULT_MEETING_RATE, SEED_QUARTERS } from '@/data/seed';
import { CUR_QUARTER, CUR_YEAR, CUR_YYYYMM, ym } from './date';
import { splitRecords } from './records';
import { supabase } from './supabase';
import { listTeams } from './authApi';

/**
 * 앱 데이터 ↔ Supabase (db/migrations/20261004_app_data_v2_5.sql)
 * - 읽기: 로그인한 팀이 볼 수 있는 행만 (RLS) → 앱 저장 구조로 바꿔 HYDRATE
 * - 쓰기: 화면은 먼저 바꾸고(낙관적), 같은 내용을 서버 함수·테이블에 반영 → 끝나면 다시 읽어 서버 값으로 맞춤
 *   실패하면 다시 읽어 되돌리고 오류 안내 (StoreContext)
 */

export class SyncError extends Error {}

const db = () => {
  if (!supabase) throw new SyncError('Supabase 연결 설정이 없습니다');
  return supabase;
};
type Res<T> = { data: T | null; error: { message: string } | null };
/** 서버 오류 → 화면 안내 문구 (DB 함수·트리거가 한국어 메시지를 줌) */
function must<T>(r: Res<T>, what: string): T {
  if (r.error) throw new SyncError(r.error.message?.match(/[가-힣]/) ? r.error.message : `${what}에 실패했습니다`);
  return r.data as T;
}

/** 서버에서 받아 앱 상태에 넣는 부분 */
export type RemoteData = Pick<AppState,
  'projects' | 'allocs' | 'checklist' | 'records' | 'quarters' | 'plannedQuarters' | 'quartersYear' | 'monthly' |
  'projectMonthly' | 'workBudgets' | 'meetingRate' | 'categories' | 'notifications' | 'notifPrefs'>;

/** 로그아웃 · 팀 전환 때 비우는 값 (이전 팀 데이터가 보이지 않게) */
export const EMPTY_DATA: RemoteData = {
  projects: [], allocs: {}, checklist: [], records: [], quarters: structuredClone(SEED_QUARTERS), plannedQuarters: {},
  quartersYear: CUR_YEAR, monthly: Array.from({ length: 12 }, (_, month) => ({ month, meeting: 0, project: 0 })),
  projectMonthly: {}, workBudgets: {}, meetingRate: DEFAULT_MEETING_RATE, categories: {}, notifications: [], notifPrefs: {},
};

/* ── 읽기 ── */

interface ProjectRow { id: number; name: string; client: string | null; start_date: string; end_date: string; total_amount: number; alloc_pool: number; owner_team_id: number; is_active: boolean; memo: string | null }
interface AllocDbRow { id: number; project_id: number; team_id: number; amount: number; use_end_date: string | null }
interface UsageRow { project_id: number; team_id: number; used: number }
interface CheckRow { id: number; project_id: number; title: string; amount: number; due_date: string | null; visibility: 'public' | 'private'; is_checked: boolean; spent_amount: number | null; spent_date: string | null; checked_by_team_id: number | null; category: { name: string } | null }
interface RecRow { id: number; team_id: number; budget_type: BudgetType; project_id: number | null; use_date: string; registered_at: string; exec_items: { line_no: number; name: string; amount: number }[] }
interface NotifRow { id: number; type: NotifType; title: string; body: string; target_team_id: number | null; dedupe_key: string | null; created_at: string }
interface PrefRow { push_enabled: boolean; push_exec: boolean; push_setting: boolean; push_alloc: boolean; push_deadline: boolean }

/** 한국 시간 날짜 'YYYY-MM-DD' */
const kstDate = (ts: string) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

/** 알림 시각 → '방금 전 · 3시간 전 · 2일 전 · 9월 25일' */
function relTime(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 60000;
  if (diff < 1) return '방금 전';
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}시간 전`;
  if (diff < 60 * 24 * 7) return `${Math.floor(diff / 1440)}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export async function loadRemote(me: Team): Promise<RemoteData & { teams: Team[] }> {
  const c = db();
  const [teams, pRes, aRes, uRes, cRes, rRes, hRes, wRes, mRes, catRes, nRes, readRes, prefRes] = await Promise.all([
    listTeams(),
    c.from('projects').select('id, name, client, start_date, end_date, total_amount, alloc_pool, owner_team_id, is_active, memo').order('id'),
    c.from('project_allocations').select('id, project_id, team_id, amount, use_end_date').order('id'),
    c.rpc('project_usage'),
    c.from('checklist_items').select('id, project_id, title, amount, due_date, visibility, is_checked, spent_amount, spent_date, checked_by_team_id, category:expense_categories(name)').order('id'),
    c.from('exec_records').select('id, team_id, budget_type, project_id, use_date, registered_at, exec_items(line_no, name, amount)').order('use_date', { ascending: false }).order('id', { ascending: false }),
    c.from('team_headcounts').select('month, headcount'),
    c.from('work_budgets').select('effective_month, amount'),
    c.from('meeting_rates').select('effective_from, rate').order('effective_from'),
    c.from('expense_categories').select('name, team_id'),
    c.from('notifications').select('id, type, title, body, target_team_id, dedupe_key, created_at').order('created_at', { ascending: false }).limit(200),
    c.from('notification_reads').select('notification_id'),
    c.from('notification_prefs').select('push_enabled, push_exec, push_setting, push_alloc, push_deadline').maybeSingle(),
  ]);
  const myId = Number(me.id);
  const nameOf = (id: number | null) => teams.find(t => t.id === String(id))?.name ?? `팀 ${id}`;
  const usage = must(uRes as Res<UsageRow[]>, '프로젝트 사용액 조회') ?? [];
  const usedOf = (pid: number, tid?: number) => usage.filter(u => u.project_id === pid && (tid == null || u.team_id === tid)).reduce((s, u) => s + Number(u.used), 0);

  const projects: Project[] = (must(pRes as Res<ProjectRow[]>, '프로젝트 조회') ?? []).map(p => ({
    id: String(p.id), name: p.name, client: p.client ?? '', startDate: p.start_date, endDate: p.end_date,
    totalAmount: Number(p.total_amount), allocPool: Number(p.alloc_pool), used: usedOf(p.id), active: p.is_active,
    ownerTeam: nameOf(p.owner_team_id), memo: p.memo ?? '', isMine: p.owner_team_id === myId,
  }));
  const allocs: Record<string, AllocRow[]> = Object.fromEntries(projects.map(p => [p.id, [] as AllocRow[]]));
  for (const a of must(aRes as Res<AllocDbRow[]>, '팀 배분 조회') ?? []) {
    (allocs[String(a.project_id)] ??= []).push({
      id: String(a.id), teamName: nameOf(a.team_id), amount: Number(a.amount), used: usedOf(a.project_id, a.team_id), endDate: a.use_end_date ?? undefined,
    });
  }
  const checklist: ChecklistItem[] = (must(cRes as unknown as Res<CheckRow[]>, '체크리스트 조회') ?? []).map(r => ({
    id: String(r.id), projectId: String(r.project_id), title: r.title, amount: Number(r.amount), category: r.category?.name ?? '',
    date: r.due_date ?? undefined, checked: r.is_checked, spent: r.spent_amount == null ? undefined : Number(r.spent_amount),
    spentDate: r.spent_date ?? undefined, visibility: r.visibility,
    checkedBy: r.is_checked && r.checked_by_team_id != null ? nameOf(r.checked_by_team_id) : undefined,
  }));

  const allRecs = must(rRes as unknown as Res<RecRow[]>, '집행 조회') ?? [];
  const toRecord = (r: RecRow): ExecRecord => {
    const items = [...r.exec_items].sort((x, y) => x.line_no - y.line_no).map(i => ({ name: i.name, amount: Number(i.amount) }));
    return {
      id: String(r.id), month: r.use_date.slice(0, 7), useDate: r.use_date, date: kstDate(r.registered_at), type: r.budget_type,
      projectId: r.project_id == null ? undefined : String(r.project_id), team: nameOf(r.team_id), items, total: items.reduce((s, i) => s + i.amount, 0),
    };
  };
  // 집행 현황·예산은 우리 팀 집행만 (주관 프로젝트에 다른 팀이 집행한 건은 프로젝트 월별 집계에만)
  const records = splitRecords(allRecs.filter(r => r.team_id === myId).map(toRecord));
  const projectMonthly: Record<string, number[]> = Object.fromEntries(projects.map(p => [p.id, Array(12).fill(0)]));
  const monthly: MonthlyExec[] = Array.from({ length: 12 }, (_, month) => ({ month, meeting: 0, project: 0 }));
  for (const r of allRecs) {
    if (!r.use_date.startsWith(`${CUR_YEAR}-`)) continue;
    const mi = Number(r.use_date.slice(5, 7)) - 1;
    const total = r.exec_items.reduce((s, i) => s + Number(i.amount), 0);
    if (r.project_id != null) (projectMonthly[String(r.project_id)] ??= Array(12).fill(0))[mi] += total;
    if (r.team_id !== myId) continue;
    if (r.budget_type === 'meeting') monthly[mi].meeting += total;
    else if (r.budget_type === 'project') monthly[mi].project += total;
  }

  // 회의비: 월 인원 × 그 달 단가 → 분기 예산 (올해 + 미리 입력한 다음 해)
  const rates = (must(mRes as Res<{ effective_from: string; rate: number }[]>, '회의비 단가 조회') ?? []);
  const rateOf = (m: string) => rates.filter(r => r.effective_from.slice(0, 7) <= m).pop()?.rate ?? 0;
  const heads = new Map((must(hRes as Res<{ month: string; headcount: number }[]>, '팀 인원 조회') ?? []).map(h => [h.month.slice(0, 7), h.headcount]));
  const quartersOf = (year: number): QuarterData[] => SEED_QUARTERS.map((q, qi) => {
    const months = [0, 1, 2].map(k => ym(year, qi * 3 + k));
    const headcounts = months.map(m => heads.get(m) ?? 0);
    return {
      ...q, headcounts: [...headcounts],
      budget: months.reduce((s, m, k) => s + headcounts[k] * rateOf(m), 0),
      used: year === CUR_YEAR ? monthly.slice(qi * 3, qi * 3 + 3).reduce((s, m) => s + m.meeting, 0) : 0,
    };
  });
  const plannedQuarters: Record<string, QuarterData[]> = {};
  for (const y of new Set([...heads.keys()].map(m => Number(m.slice(0, 4))).filter(y => y > CUR_YEAR))) plannedQuarters[String(y)] = quartersOf(y);

  const workBudgets = Object.fromEntries((must(wRes as Res<{ effective_month: string; amount: number }[]>, '업무비 예산 조회') ?? [])
    .map(w => [w.effective_month.slice(0, 7), Number(w.amount)]));
  const custom = (must(catRes as Res<{ name: string; team_id: number | null }[]>, '경비 구분 조회') ?? []).filter(x => x.team_id === myId).map(x => x.name);

  const read = new Set((must(readRes as Res<{ notification_id: number }[]>, '알림 읽음 조회') ?? []).map(r => r.notification_id));
  const notifications: NotifItem[] = (must(nRes as Res<NotifRow[]>, '알림 조회') ?? []).map(n => ({
    id: String(n.id), title: n.title, desc: n.body, type: n.type, time: relTime(n.created_at), read: read.has(n.id),
    team: n.target_team_id == null ? undefined : nameOf(n.target_team_id), key: n.dedupe_key ?? undefined,
  }));
  const pref = must(prefRes as Res<PrefRow>, '알림 설정 조회');
  const notifPrefs: Record<string, NotifPrefs> = pref
    ? { [me.name]: { push: pref.push_enabled, kinds: { exec: pref.push_exec, setting: pref.push_setting, alloc: pref.push_alloc, deadline: pref.push_deadline } } }
    : {};

  return {
    teams, projects, allocs, checklist, records, quarters: quartersOf(CUR_YEAR), plannedQuarters, quartersYear: CUR_YEAR,
    monthly, projectMonthly, workBudgets, meetingRate: rateOf(CUR_YYYYMM) || DEFAULT_MEETING_RATE,
    categories: { [me.name]: custom }, notifications, notifPrefs,
  };
}

/* ── 쓰기 ── */

const projectPayload = (p: ProjectDraft & { active?: boolean }, inactiveFrom = '') => ({
  name: p.name, client: p.client, start_date: p.startDate, end_date: p.endDate, total_amount: p.totalAmount,
  alloc_pool: p.allocPool, memo: p.memo ?? '', is_active: p.active ?? true, inactive_from: inactiveFrom,
});
const allocPayload = (rows: AllocRow[]) => rows.filter(a => a.teamName.trim())
  .map(a => ({ team: a.teamName.trim(), amount: a.amount, use_end_date: a.endDate ?? '' }));

/** 프로젝트 등록 — 화면에서 새 프로젝트를 바로 고를 수 있게 서버 id 를 먼저 받음 */
export async function createProject(draft: ProjectDraft): Promise<string> {
  const id = must(await db().rpc('save_project', { p_id: null, p: projectPayload(draft), p_allocs: null }) as Res<number>, '프로젝트 등록');
  return String(id);
}

/** 집행 id → DB 집행 id ('15-2' = 15번 집행의 3번째 항목을 앱에서 나눠 보여 준 것) */
const baseId = (id: string) => Number(id.split('-')[0]);
const recordPayload = (r: Pick<ExecRecord, 'type' | 'projectId' | 'useDate' | 'month' | 'items'>) => ({
  type: r.type, project_id: r.type === 'project' ? r.projectId ?? '' : '', use_date: r.useDate ?? `${r.month}-01`, items: r.items,
});

/** 집행 수정·삭제 — 나눠 보여 준 항목들을 원래 집행 단위로 다시 합쳐 저장 (남은 항목이 없으면 삭제) */
async function syncRecordGroups(before: AppState, after: AppState, ids: string[]) {
  const bases = [...new Set(ids.map(baseId))].filter(n => Number.isFinite(n));
  const toDelete: number[] = [];
  for (const b of bases) {
    const parts = after.records.filter(r => baseId(r.id) === b);
    if (!before.records.some(r => baseId(r.id) === b)) continue; // 아직 서버에 없는 임시 집행
    if (!parts.length) { toDelete.push(b); continue; }
    const head = parts[0];
    must(await db().rpc('exec_update', { p_id: b, r: { ...recordPayload(head), items: parts.flatMap(p => p.items) } }) as Res<null>, '집행 수정');
  }
  if (toDelete.length) must(await db().rpc('exec_delete', { p_ids: toDelete }) as Res<null>, '집행 삭제');
}

/** 화면에서 바뀐 내용을 서버에 반영 — 반영한 것이 있으면 true (그 뒤 다시 읽기) */
export async function pushAction(action: Action, before: AppState, after: AppState, me: Team): Promise<boolean> {
  const c = db();
  const myId = Number(me.id);
  let pushed = false;
  switch (action.type) {
    case 'ADD_PROJECT':
      pushed = true; // createProject 로 이미 등록 — 다시 읽기만
      break;
    case 'UPDATE_PROJECT': case 'RECLAIM_ALLOCS': case 'DEACTIVATE_PROJECT': {
      const p = after.projects.find(x => x.id === action.id);
      if (!p) break;
      const inactiveFrom = !p.active ? (action.type === 'DEACTIVATE_PROJECT' ? `${action.month}-01` : `${p.endDate.slice(0, 7)}-01`) : '';
      const allocs = action.type === 'DEACTIVATE_PROJECT' ? null : allocPayload(after.allocs[p.id] ?? []);
      must(await c.rpc('save_project', { p_id: Number(p.id), p: projectPayload(p, inactiveFrom), p_allocs: allocs }) as Res<number>, '프로젝트 저장');
      pushed = true;
      break;
    }
    case 'TOGGLE_CHECK': case 'SET_CHECK_EXEC': {
      const it = after.checklist.find(x => x.id === action.id);
      if (!it) break;
      must(await c.rpc('checklist_set_exec', { p_id: Number(it.id), p_checked: it.checked, p_spent: it.spent ?? null, p_date: it.spentDate ?? null }) as Res<null>, '체크리스트 집행');
      pushed = true;
      break;
    }
    case 'ADD_CHECK': {
      const it = action.item;
      must(await c.rpc('checklist_save', { p_id: null, p: {
        project_id: Number(it.projectId), title: it.title, amount: it.amount, category: it.category, due_date: it.date ?? '', visibility: it.visibility ?? 'public',
      } }) as Res<number>, '체크리스트 추가');
      pushed = true;
      break;
    }
    case 'SET_CHECK_VISIBILITY':
      must(await c.rpc('checklist_save', { p_id: Number(action.id), p: { visibility: action.visibility } }) as Res<number>, '공개 범위 변경');
      pushed = true;
      break;
    case 'DELETE_CHECK':
      must(await c.rpc('checklist_delete', { p_id: Number(action.id) }) as Res<null>, '체크리스트 삭제');
      pushed = true;
      break;
    case 'ADD_RECORD': case 'ADD_RECORDS': {
      const recs = action.type === 'ADD_RECORD' ? [action.record] : action.records;
      if (!recs.length) break;
      must(await c.rpc('exec_add', { p: recs.map(recordPayload) }) as Res<number[]>, '집행 등록');
      pushed = true;
      break;
    }
    case 'UPDATE_RECORD':
      await syncRecordGroups(before, after, [action.record.id]);
      pushed = true;
      break;
    case 'DELETE_RECORD': case 'DELETE_RECORDS':
      await syncRecordGroups(before, after, action.type === 'DELETE_RECORD' ? [action.id] : action.ids);
      pushed = true;
      break;
    case 'SAVE_HEADCOUNTS': {
      const year = action.year ?? CUR_YEAR;
      const rows = action.headcounts.map((headcount, k) => ({ team_id: myId, month: `${ym(year, action.quarterIdx * 3 + k)}-01`, headcount }));
      must(await c.from('team_headcounts').upsert(rows, { onConflict: 'team_id,month' }) as Res<null>, '팀 인원 저장');
      pushed = true;
      break;
    }
    case 'SAVE_WORK_BUDGET': {
      const prev = before.workBudgets, next = after.workBudgets;
      const upserts = Object.entries(next).filter(([m, v]) => prev[m] !== v).map(([m, amount]) => ({ team_id: myId, effective_month: `${m}-01`, amount }));
      const removed = Object.keys(prev).filter(m => !(m in next)).map(m => `${m}-01`);
      if (upserts.length) must(await c.from('work_budgets').upsert(upserts, { onConflict: 'team_id,effective_month' }) as Res<null>, '업무비 예산 저장');
      if (removed.length) must(await c.from('work_budgets').delete().eq('team_id', myId).in('effective_month', removed) as Res<null>, '업무비 예산 저장');
      pushed = true;
      break;
    }
    case 'SET_RATE':
      // 이번 분기 첫 달부터 새 단가 (앱 규칙: 이번 분기부터 즉시 반영)
      must(await c.rpc('set_meeting_rate', { p_from: `${ym(CUR_YEAR, CUR_QUARTER * 3)}-01`, p_rate: action.rate }) as Res<null>, '회의비 단가 변경');
      pushed = true;
      break;
    case 'READ_NOTIF': case 'READ_ALL_NOTIF': {
      const newly = after.notifications.filter(n => n.read && !before.notifications.find(b => b.id === n.id)?.read && /^\d+$/.test(n.id));
      if (newly.length) {
        must(await c.from('notification_reads').upsert(newly.map(n => ({ notification_id: Number(n.id), team_id: myId })), { onConflict: 'notification_id,team_id', ignoreDuplicates: true }) as Res<null>, '알림 읽음');
        pushed = true;
      }
      break;
    }
    case 'SET_PUSH': case 'SET_PUSH_KIND': {
      const pr = after.notifPrefs[me.name];
      if (!pr) break;
      must(await c.from('notification_prefs').upsert({
        team_id: myId, push_enabled: pr.push, push_exec: pr.kinds.exec, push_setting: pr.kinds.setting, push_alloc: pr.kinds.alloc, push_deadline: pr.kinds.deadline,
      }, { onConflict: 'team_id' }) as Res<null>, '알림 설정 저장');
      pushed = true;
      break;
    }
    default:
      break;
  }
  // 이 동작으로 새로 생긴 알림(배분 변경·집행 등록·예산 경고·기한 임박) → 받는 팀 앞으로 서버에 남김
  //   비밀번호 알림은 Edge Function 이 남기므로 제외
  if (action.type !== 'SET_TEAM_PASSWORD') {
    const old = new Set(before.notifications.map(n => n.id));
    const added = after.notifications.filter(n => !old.has(n.id));
    if (added.length) {
      const teamId = (name?: string) => (name ? Number(after.teams.find(t => t.name === name)?.id) || null : null);
      must(await c.rpc('notify_add', { p: added.map(n => ({
        type: n.type, title: n.title, body: n.desc, target_team_id: teamId(n.team) ?? '', dedupe_key: n.key ?? '',
      })) }) as Res<null>, '알림 저장');
      pushed = true;
    }
  }
  return pushed;
}

/** 새 프로젝트 id — Supabase 로그인이면 서버에 먼저 등록해 받은 id, 아니면 브라우저 임시 id */
export async function newProjectId(draft: ProjectDraft, localId: () => string): Promise<string> {
  return supabase ? createProject(draft) : localId();
}
