import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { reducer, seedState, type Action, type AppState } from './reducer';
import { shouldDropSession } from '@/lib/remember';
import { splitRecords } from '@/lib/records';
import { toEndDate, toStartDate } from '@/lib/date';

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
      // 팀 업무비가 없던 저장본 → 시드 월 예산으로 시작
      state.workBudgets = state.workBudgets ?? seed.workBudgets;
      state.records = splitRecords(state.records ?? []);
      // 착수월·종료월(YYYY-MM) 저장본 → 착수일(1일)·종료일(말일)
      state.projects = state.projects.map(p => ({ ...p, startDate: toStartDate(p.startDate), endDate: toEndDate(p.endDate) }));
      state.teams = state.teams.map(t => ('isAdmin' in t ? t : { ...t, isAdmin: seed.teams.find(s => s.id === t.id)?.isAdmin ?? false }));
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const view = useMemo(() => withTeamView(state), [state]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 저장 공간 부족/비공개 모드 — 메모리 상태로만 동작 */
    }
  }, [state]);

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
