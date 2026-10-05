import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { reducer, seedState, type Action, type AppState } from './reducer';
import { shouldDropSession } from '@/lib/remember';
import { splitRecords } from '@/lib/records';
import { CUR_YEAR, toEndDate, toStartDate } from '@/lib/date';
import { LEGACY_INITIAL_PASSWORD } from '@/lib/password';
import { REMOTE_AUTH } from '@/lib/supabase';
import { EMPTY_DATA, SyncError, loadRemote, pushAction } from '@/lib/dataApi';
import { uid } from '@/lib/format';

/** 시드/스키마를 바꾸면 버전을 올려 저장본을 무효화한다. */
const STORAGE_KEY = 'cowork-coin-v5'; // 데모 데이터 제거: 이전 버전의 로컬 저장본은 가져오지 않음

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const seed = seedState();
      const state = { ...seed, ...(JSON.parse(raw) as Partial<AppState>) };
      // 관리자 권한 필드가 없던 저장본 → 시드 기본값으로 보정
      // 알림 설정이 없던 저장본 보정
      state.notifPrefs = state.notifPrefs ?? {};
      // 팀이 만든 My 경비 구분이 없던 저장본
      state.categories = state.categories ?? {};
      // 다음 해 분기 계획 — 해가 바뀌면 그 해 계획(없으면 빈 분기)을 올해 분기로, 집행액은 집행 이력에서 다시 계산
      state.plannedQuarters = state.plannedQuarters ?? {};
      state.quartersYear = state.quartersYear ?? CUR_YEAR;
      if (state.quartersYear !== CUR_YEAR) {
        const { [String(CUR_YEAR)]: plan, ...rest } = state.plannedQuarters;
        state.quarters = (plan ?? seed.quarters).map((q, qi) => ({
          ...q,
          used: state.records.filter(r => r.type === 'meeting' && r.month.startsWith(`${CUR_YEAR}-`) && Math.floor((Number(r.month.slice(5, 7)) - 1) / 3) === qi)
            .reduce((s, r) => s + r.total, 0),
        }));
        state.plannedQuarters = rest;
        state.quartersYear = CUR_YEAR;
      }
      // 팀 업무비가 없던 저장본 → 시드 월 예산으로 시작
      state.workBudgets = state.workBudgets ?? seed.workBudgets;
      state.records = splitRecords(state.records ?? []);
      // 착수월·종료월(YYYY-MM) 저장본 → 착수일(1일)·종료일(말일)
      state.projects = state.projects.map(p => ({ ...p, startDate: toStartDate(p.startDate), endDate: toEndDate(p.endDate) }));
      state.teams = state.teams.map(t => ('isAdmin' in t ? t : { ...t, isAdmin: seed.teams.find(s => s.id === t.id)?.isAdmin ?? false }));
      // 임시 비밀번호 상태가 없던 저장본 → 예전 고정 초기 비밀번호(1234)를 쓰는 팀은 변경 필요
      state.teams = state.teams.map(t => ('mustChangePassword' in t ? t : { ...t, mustChangePassword: t.password === LEGACY_INITIAL_PASSWORD }));
      return shouldDropSession() ? { ...state, session: null } : state;
    }
  } catch {
    /* 손상된 저장본은 무시하고 시드로 시작 */
  }
  return seedState();
}

const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

/** 로그인한 팀 기준 화면용 값: 주관(isMine) · 배분받은 참여(joined) */
function withTeamView(s: AppState): AppState {
  const team = s.session?.team;
  return {
    ...s,
    projects: s.projects.map(p => {
      const isMine = !!team && p.ownerTeam === team;
      return { ...p, isMine, joined: !isMine && !!team && !!s.allocs[p.id]?.some(a => a.teamName === team) };
    }),
  };
}

/** 서버에 반영하지 않는 동작 — 로그인·팀 계정은 Edge Function, 구분은 체크리스트 추가 때 서버가 만듦 */
const LOCAL_ONLY = new Set<Action['type']>([
  'INITIALIZE', 'LOGIN', 'LOGOUT', 'HYDRATE', 'SYNC_TEAMS', 'TOGGLE_TEAM', 'ADD_TEAM', 'RENAME_TEAM', 'DELETE_TEAM',
  'SET_TEAM_ADMIN', 'SET_TEAM_PASSWORD', 'ADD_CATEGORY',
]);
/**
 * 새 집행·체크리스트 id 를 동작에 미리 넣음 — 리듀서가 두 번 돌아도(낙관적 계산 + 화면) 같은 id 가 되어,
 * 서버 반영 전에 그 항목을 고치거나 지워도 서버 id 와 이어짐 (dataApi serverIdOf)
 */
function withIds(a: Action): Action {
  if (a.type === 'ADD_RECORD' && !a.id) return { ...a, id: uid('e') };
  if (a.type === 'ADD_RECORDS' && !a.ids) return { ...a, ids: a.records.map(() => uid('e')) };
  if (a.type === 'ADD_CHECK' && !a.id) return { ...a, id: uid('c') };
  return a;
}

/** 서버 반영 실패 안내 — App 이 토스트로 보여 줌 */
export const SYNC_ERROR_EVENT = 'cowork-sync-error';
const syncError = (e: unknown) =>
  window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: e instanceof SyncError ? e.message : '서버에 저장하지 못했습니다. 네트워크를 확인하세요' }));
/** 서버 팀 id 를 가진 로그인 팀 (브라우저 저장본 로그인이면 없음) */
const remoteTeam = (s: AppState) => {
  const t = s.teams.find(x => x.name === s.session?.team);
  return t && /^\d+$/.test(t.id) && !t.mustChangePassword ? t : null;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, loadInitial);
  const view = useMemo(() => withTeamView(state), [state]);
  // 비동기 반영에서 쓰는 최신 상태 (같은 이벤트에서 연달아 보낸 동작도 이어서 계산)
  //   그리는 즉시 갱신 — 자식 화면의 effect(기한 임박 확인 등)가 이 컴포넌트 effect 보다 먼저 돌기 때문
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 저장 공간 부족/비공개 모드 — 메모리 상태로만 동작 */
    }
  }, [state]);

  /* ── Supabase 연동: 로그인한 팀 데이터 읽기 · 바꾼 내용 반영 (src/lib/dataApi.ts) ── */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const reloadTimer = useRef<number | undefined>(undefined);
  const lastLoad = useRef(0);
  /** 상태를 바꾼 동작 수 — 다시 읽는 사이에 바뀐 내용이 있으면 읽은 값으로 덮지 않음 */
  const changes = useRef(0);

  const reload = useCallback(async () => {
    const team = remoteTeam(latest.current);
    if (!REMOTE_AUTH || !team) return;
    const startedAt = changes.current;
    try {
      const { teams, ...data } = await loadRemote(team);
      if (latest.current.session?.team !== team.name) return; // 읽는 사이 팀이 바뀜
      // 읽는 사이에 화면에서 바꾼 내용(아직 서버 반영 대기)이 있으면 덮지 않고, 그 반영이 끝난 뒤 다시 읽음
      if (changes.current !== startedAt) { scheduleReloadRef.current(); return; }
      lastLoad.current = Date.now();
      rawDispatch({ type: 'SYNC_TEAMS', teams });
      rawDispatch({ type: 'HYDRATE', data });
    } catch (e) {
      syncError(e);
    }
  }, []);
  /** 연달아 바꿔도 마지막에 한 번만 다시 읽기 (반영 대기열 뒤에서) */
  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => { queue.current = queue.current.then(reload); }, 400);
  }, [reload]);
  const scheduleReloadRef = useRef(scheduleReload);
  scheduleReloadRef.current = scheduleReload;

  const dispatch = useCallback<Dispatch<Action>>(input => {
    const action = withIds(input);
    if (!REMOTE_AUTH) { rawDispatch(action); return; }
    // 로그인·로그아웃(팀 전환): 이전 팀 데이터를 먼저 비움 — 다른 팀의 비공개 항목 등이 남지 않게
    if (action.type === 'LOGIN' || action.type === 'LOGOUT') rawDispatch({ type: 'HYDRATE', data: EMPTY_DATA });
    const before = latest.current;
    const after = reducer(action.type === 'LOGIN' || action.type === 'LOGOUT' ? { ...before, ...EMPTY_DATA } : before, action);
    latest.current = after;
    if (after !== before && action.type !== 'HYDRATE' && action.type !== 'SYNC_TEAMS') changes.current++;
    rawDispatch(action);
    if (LOCAL_ONLY.has(action.type)) return;
    const team = remoteTeam(before);
    if (!team) return;
    queue.current = queue.current.then(async () => {
      try {
        if (await pushAction(action, before, after, team)) scheduleReload();
      } catch (e) {
        syncError(e);
        scheduleReload(); // 서버 값으로 되돌림
      }
    });
  }, [scheduleReload]);

  // 로그인(팀이 정해지면) 바로 읽기 · 앱으로 돌아오면 다시 읽기(다른 팀이 바꾼 배분·알림 반영, 20초에 한 번까지)
  const teamKey = remoteTeam(state)?.id;
  useEffect(() => { if (teamKey) void reload(); }, [teamKey, reload]);
  useEffect(() => {
    if (!REMOTE_AUTH) return;
    const onShow = () => { if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > 20_000) scheduleReload(); };
    document.addEventListener('visibilitychange', onShow);
    // 화면을 켜 둔 채로 있어도 다른 팀이 보낸 알림(배분 변경 등)·바꾼 배분이 1분 안에 보이도록
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > 55_000) scheduleReload();
    }, 60_000);
    return () => { document.removeEventListener('visibilitychange', onShow); window.clearInterval(timer); };
  }, [scheduleReload]);

  return (
    <StateCtx.Provider value={view}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useAppState must be used within StoreProvider');
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error('useDispatch must be used within StoreProvider');
  return d;
}
