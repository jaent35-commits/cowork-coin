import { useEffect, useState } from 'react';
import { onFocusRequest, takeFocus } from '@/lib/search';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { fmt } from '@/lib/format';
import { Card, Segmented, Select } from '@/components/ui';
import { ownerBudget, visibleChecklist } from '@/store/selectors';
import CheckRows, { byCheckDate, checkDateOf } from '@/components/CheckRows';
import type { ChecklistItem } from '@/types';

type Status = 'all' | 'todo' | 'done';
/** 체크 상태 — 세그먼트 [전체 | 잔여 | 완료] (건수는 요약 줄에) */
const STATUS: { value: Status; label: string }[] = [{ value: 'all', label: '전체' }, { value: 'todo', label: '잔여' }, { value: 'done', label: '완료' }];
/** my = 우리 팀이 주관하는 프로젝트 (프로젝트 운영 > My 체크리스트), cowork = 배분받아 참여하는 프로젝트의 공개 항목 (코웍 체크리스트 메뉴) */
export type Scope = 'my' | 'cowork';
type Sort = 'asc' | 'desc';

// 상세를 열었다 돌아와도 조회 조건 유지 (화면별)
type Filters = { projectId: string; status: Status; sort: Sort };
const DEFAULT_FILTERS: Filters = { projectId: 'all', status: 'all', sort: 'asc' };
const last: Record<Scope, Filters> = { my: DEFAULT_FILTERS, cowork: DEFAULT_FILTERS };
/** 탭 전환(My 프로젝트 ↔ My 체크리스트) 중에는 필터 유지, 메뉴로 새로 들어오면 기본값 */
export const resetChecklistFilters = (scope: Scope) => { last[scope] = DEFAULT_FILTERS; };

/** 날짜 늦은 순 — 완료는 집행일, 미완료는 예정일 (날짜 없는 항목은 맨 뒤) */
const byCheckDateDesc = (a: ChecklistItem, b: ChecklistItem) => {
  const x = checkDateOf(a), y = checkDateOf(b);
  return !x ? (y ? 1 : 0) : !y ? -1 : y.localeCompare(x);
};

/**
 * 경비 집행 체크리스트 목록 — 활성(진행 중) 프로젝트
 * my: 주관 프로젝트 전체 항목 / cowork: 배분받은 참여 프로젝트의 공개 항목
 * 금액 기준은 항상 주관 팀의 My 경비 배분 금액 (참여 팀 배분 예산과 별개)
 * 조회: 프로젝트 · 체크 상태, 정렬: 집행 예정일
 */
export default function ProjectChecklist({ scope }: { scope: Scope }) {
  const state = useAppState();
  const { projects } = state;
  const checklist = visibleChecklist(state);
  const dispatch = useDispatch();

  const active = projects.filter(p => p.active && (scope === 'my' ? p.isMine : p.joined));
  const activeIds = new Set(active.map(p => p.id));
  // 검색 이동: 체크리스트 항목(check) → 그 프로젝트로 조회 + 항목 강조 / 참여 프로젝트(joined) → 그 프로젝트로 조회
  const inScopeItem = (id: string) => { const c = checklist.find(x => x.id === id); return !!c && activeIds.has(c.projectId); };
  const [flashId, setFlashId] = useState<string | null>(() => takeFocus('check', inScopeItem));
  const [focusProject] = useState<string | null>(() => {
    const pid = flashId ? checklist.find(c => c.id === flashId)!.projectId
      : scope === 'cowork' ? takeFocus('joined', id => activeIds.has(id)) : null;
    if (pid) last[scope] = { ...last[scope], projectId: pid, status: 'all' };
    return pid;
  });
  const [projectIdSel, setProjectIdState] = useState(focusProject ?? last[scope].projectId);
  const [status, setStatusState] = useState<Status>(focusProject ? 'all' : last[scope].status);
  const [sort, setSortState] = useState<Sort>(last[scope].sort);
  const save = (patch: Partial<Filters>) => { last[scope] = { ...last[scope], ...patch }; };
  const setProjectId = (v: string) => { save({ projectId: v }); setProjectIdState(v); };
  const setStatus = (v: Status) => { save({ status: v }); setStatusState(v); };
  const setSort = (v: Sort) => { save({ sort: v }); setSortState(v); };
  // 이미 열린 화면에서 검색 이동
  useEffect(() => onFocusRequest('check', id => {
    if (!inScopeItem(id)) return false;
    setProjectId(checklist.find(c => c.id === id)!.projectId); setStatus('all'); setFlashId(id);
  }));
  useEffect(() => onFocusRequest('joined', id => {
    if (scope !== 'cowork' || !activeIds.has(id)) return false;
    setProjectId(id); setStatus('all');
  }));
  useEffect(() => {
    if (!flashId) return;
    document.querySelector(`[data-check="${flashId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashId(null), 1800);
    return () => window.clearTimeout(t);
  }, [flashId]);

  // 선택했던 프로젝트가 목록에 없으면(종료 등) 전체
  const projectId = projectIdSel === 'all' || activeIds.has(projectIdSel) ? projectIdSel : 'all';

  const inScope = checklist.filter(c => activeIds.has(c.projectId) && (projectId === 'all' || c.projectId === projectId));
  const count = { all: inScope.length, todo: inScope.filter(c => !c.checked).length, done: inScope.filter(c => c.checked).length };
  const shown = inScope.filter(c => (status === 'todo' ? !c.checked : status === 'done' ? c.checked : true))
    .sort(sort === 'asc' ? byCheckDate : byCheckDateDesc);
  const todoAmt = inScope.filter(c => !c.checked).reduce((s, c) => s + c.amount, 0);

  const statusOptions = STATUS.map(o => ({ ...o, label: `${o.label} ${count[o.value]}` }));

  // 기준 예산: 주관 팀의 My 경비 배분 금액
  const selected = active.find(p => p.id === projectId);
  const budgetNote = (() => {
    if (selected) {
      const b = ownerBudget(state, selected);
      return <>{scope === 'cowork' && <>주관 팀 <b>{b.team}</b>의 </>}My 경비 배분 금액 <b className="num">{fmt(b.amount)}</b> · 잔액 <b className="num">{fmt(b.remain)}</b>{scope === 'cowork' && <span className="proj-check__sep">우리 팀 배분 예산과 별개</span>}</>;
    }
    if (scope === 'my') {
      const t = active.reduce((s, p) => { const b = ownerBudget(state, p); return { amount: s.amount + b.amount, remain: s.remain + b.remain }; }, { amount: 0, remain: 0 });
      return active.length ? <>My 경비 배분 금액 합계 <b className="num">{fmt(t.amount)}</b> · 잔액 <b className="num">{fmt(t.remain)}</b></> : null;
    }
    return active.length ? <>금액은 각 프로젝트 <b>주관 팀의 My 경비 배분 금액</b> 기준이며, 우리 팀 배분 예산과 별개입니다.</> : null;
  })();

  return (
    <div className="proj-check">
      {/* 한 줄: [프로젝트 선택] [정렬] */}
      <div className="proj-check__filters">
        <Select className="proj-check__proj" value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="프로젝트 선택">
          <option value="all">전체 프로젝트</option>
          {active.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="proj-check__sort" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="정렬 (집행 예정일)">
          <option value="asc">예정일 빠른 순</option>
          <option value="desc">예정일 늦은 순</option>
        </Select>
      </div>
      <Card pad>
        {/* 상태 필터 = 건수 요약 [전체 3 | 잔여 1 | 완료 2] · 잔여 예정 금액 */}
        <div className="proj-check__head">
          <Segmented options={statusOptions} value={status} onChange={setStatus} label="체크 상태" />
          <p className="proj-check__todo">잔여 예정 <b className="num">{fmt(todoAmt)}</b></p>
        </div>
        {budgetNote && <p className="proj-check__budget">{budgetNote}</p>}
        <CheckRows selectable items={shown} projects={projects} flashId={flashId} onToggle={id => dispatch({ type: 'TOGGLE_CHECK', id })}
          onExec={(id, patch) => dispatch({ type: 'SET_CHECK_EXEC', id, patch })}
          empty={active.length === 0
            ? (scope === 'my'
              ? { icon: '📁', message: '진행 중인 주관 프로젝트가 없습니다' }
              : { icon: '🤝', message: '참여 중인 코웍 프로젝트가 없습니다', sub: '다른 팀 프로젝트에 배분받으면 공개 체크리스트가 여기에 보입니다' })
            : { icon: '📋', message: '조회된 체크리스트가 없습니다', sub: scope === 'my' ? '프로젝트 상세에서 체크리스트를 생성하세요' : '주관 팀이 공개한 항목이 아직 없습니다' }} />
      </Card>
    </div>
  );
}
