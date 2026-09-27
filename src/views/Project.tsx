import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CheckVisibility, AllocRow, Category, Project, ProjectDraft, View } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { CATEGORIES } from '@/data/seed';
import { CUR_YYYYMM } from '@/lib/date';
import { MTag } from '@/components/ui/MTag';
import { fmt, pct, uid } from '@/lib/format';
import { useToast } from '@/hooks/useToast';
import { onFocusRequest, takeFocus } from '@/lib/search';
import { isPublicCheck, ownerBudget } from '@/store/selectors';
import { overlapsYear, setViewYear, useViewYear } from '@/lib/viewYear';
import {
  Alert, AmountInput, Badge, Btn, Card, Checkbox, DateField, IconBtn, Divider, EmptyState, Input, PageHead, ProgressBar, SectionHead, Segmented, Select, TableWrap, Tabs, Toast, cx, progVariant,
} from '@/components/ui';
import { MonthField } from '@/components/ui/MonthField';
import { IconClose, IconEdit, IconPlus } from '@/components/icons';
import YearPicker, { YearBar } from '@/components/layout/YearPicker';
import Donut from '@/components/Donut';
import ProjectChecklist, { resetChecklistFilters } from './ProjectChecklist';
import CheckRows from '@/components/CheckRows';
import './Project.css';
import './Exec.css';

export const EMPTY_PROJECT: ProjectDraft = { name: '', client: '', startDate: '', endDate: '', totalAmount: 0, allocPool: 0, used: 0 };
/** 필수: 사업명 · 착수일 · 종료일 (기간이 없으면 연도별 목록에 나오지 않음) */
export const draftReady = (d: ProjectDraft) => !!(d.name.trim() && d.startDate && d.endDate);
const EMPTY_ITEM = { title: '', amount: 0, category: '' as Category | '', date: '', visibility: 'public' as CheckVisibility };
type ListFilter = 'all' | 'ongoing';
const LIST_FILTERS: { value: ListFilter; label: string }[] = [{ value: 'all', label: '전체' }, { value: 'ongoing', label: '진행중' }];

/** 프로젝트 운영 탭 — 메뉴로 들어오면 항상 첫 탭 (홈 '전체 보기' 만 체크리스트 탭으로 한 번 지정) */
const PROJECT_TABS = ['My 프로젝트', 'My 체크리스트'] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];
/** 다른 화면에서 특정 탭으로 진입 — 한 번만 적용. sessionStorage 로 전달해 모듈 재평가(HMR·새로고침)에도 유지 */
const PENDING_TAB_KEY = 'cowork-coin-project-tab';
const isProjectTab = (t: string) => (PROJECT_TABS as readonly string[]).includes(t);
export const openProjectTab = (t: ProjectTab) => { try { sessionStorage.setItem(PENDING_TAB_KEY, t); } catch { /* 저장 불가 시 첫 탭 */ } };
const readPendingTab = (): ProjectTab | null => {
  try {
    const t = sessionStorage.getItem(PENDING_TAB_KEY);
    return (PROJECT_TABS as readonly string[]).includes(t ?? '') ? (t as ProjectTab) : null;
  } catch { return null; }
};
const clearPendingTab = () => { try { sessionStorage.removeItem(PENDING_TAB_KEY); } catch { /* 무시 */ } };


export function ProjectForm({ draft, onChange, poolLabel = '코웍 팀 배분 가능 금액' }: {
  draft: ProjectDraft; onChange: (d: ProjectDraft) => void; poolLabel?: string;
}) {
  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="grid-2 proj-form">
      <div>
        <label className="label" htmlFor="pf-name">사업명 *</label>
        <Input id="pf-name" placeholder="프로젝트 이름" value={draft.name} onChange={e => set('name', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="pf-client">발주처</label>
        <Input id="pf-client" placeholder="발주처명" value={draft.client} onChange={e => set('client', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="pf-start">착수일 *</label>
        <DateField id="pf-start" aria-label="착수일" value={draft.startDate}
          onChange={v => onChange({ ...draft, startDate: v, endDate: draft.endDate && draft.endDate < v ? v : draft.endDate })} />
      </div>
      <div>
        <label className="label" htmlFor="pf-end">종료일 *</label>
        <DateField id="pf-end" aria-label="종료일" value={draft.endDate}
          onChange={v => onChange({ ...draft, endDate: v, startDate: draft.startDate && draft.startDate > v ? v : draft.startDate })} />
      </div>
      <div>
        <label className="label" htmlFor="pf-total">프로젝트 경비 총액</label>
        <AmountInput id="pf-total" hangul value={draft.totalAmount} onChange={v => set('totalAmount', v)} />
      </div>
      <div>
        <label className="label" htmlFor="pf-pool">{poolLabel}</label>
        <AmountInput id="pf-pool" hangul value={draft.allocPool} onChange={v => set('allocPool', v)} />
      </div>
    </div>
  );
}


/* ── 모바일 프로젝트 상세(풀스크린) — 열 프로젝트 id (새로고침에도 유지) ── */
const DETAIL_KEY = 'cowork-coin-project-detail';
export function readDetailId(): string | null {
  try { return sessionStorage.getItem(DETAIL_KEY); } catch { return null; }
}
function openDetail(id: string) {
  try { sessionStorage.setItem(DETAIL_KEY, id); } catch { /* 무시 */ }
}
const isMobileNow = () => window.matchMedia('(max-width: 1024px)').matches;

/**
 * 프로젝트 운영. sheet = 모바일 상세 풀스크린 (목록·헤더 없이 선택 프로젝트만, 헤더 제목 = 프로젝트명)
 * - 조회 모드: 하단 [목록으로] [편집하기] / 편집 모드: 하단 [취소] [저장]
 */
export default function ProjectView({ onNavigate, sheet = false }: { onNavigate: (v: View) => void; sheet?: boolean }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const { projects, checklist, allocs } = state;
  const [toast, showToast] = useToast();

  const [flashId, setFlashId] = useState<string | null>(() => takeFocus('project'));
  // 검색 이동(메뉴·체크리스트 항목)으로 열 탭이 있으면 그 탭
  const [tab, setTab] = useState<ProjectTab>(() => {
    if (!sheet) resetChecklistFilters('my');
    const focusTab = sheet ? null : takeFocus('tab', isProjectTab) as ProjectTab | null;
    return flashId ? PROJECT_TABS[0] : focusTab ?? readPendingTab() ?? PROJECT_TABS[0];
  });
  useEffect(clearPendingTab, []);
  const checkTab = !sheet && tab === 'My 체크리스트';
  const [selectedId, setSelectedId] = useState<string | null>(() => (sheet ? readDetailId()
    : (flashId && projects.find(p => p.id === flashId && p.isMine)?.id) ?? projects.find(p => p.isMine)?.id ?? null));
  const [addingNew, setAddingNew] = useState(false);
  const [newProj, setNewProj] = useState<ProjectDraft>(EMPTY_PROJECT);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<ProjectDraft>(EMPTY_PROJECT);
  const [editAllocs, setEditAllocs] = useState<AllocRow[]>([]);
  /** 사용액이 있어 삭제할 수 없는 배분 행 — 안내 + '배분액을 사용액으로 맞추기' 선택지 표시 */
  const [lockedAllocId, setLockedAllocId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateMonth, setDeactivateMonth] = useState(CUR_YYYYMM);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState(EMPTY_ITEM);

  const [year] = useViewYear();
  // My(주관·참여) 프로젝트만 조회 — 타 팀 프로젝트는 목록에 노출하지 않음
  const yearProjects = projects.filter(p => p.isMine && overlapsYear(p.startDate, p.endDate, year));
  // 상세 화면은 연도와 관계없이 연 프로젝트
  const selected = sheet ? projects.find(p => p.id === selectedId && p.isMine) : yearProjects.find(p => p.id === selectedId);
  // 목록 보기: 전체 / 진행중(종료 처리되지 않은 프로젝트)
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const listProjects = listFilter === 'ongoing' ? yearProjects.filter(p => p.active) : yearProjects;
  // 조회 연도가 바뀌어 선택 프로젝트가 목록에 없으면 그 연도의 첫 주관 프로젝트 선택
  useEffect(() => {
    if (sheet || addingNew || yearProjects.some(p => p.id === selectedId)) return;
    setSelectedId(yearProjects.find(p => p.isMine)?.id ?? null);
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = selected ? checklist.filter(c => c.projectId === selected.id) : [];
  const viewAllocs = selected ? allocs[selected.id] ?? [] : [];
  const rows = editMode ? editAllocs : viewAllocs;
  const pool = editMode ? editData.allocPool : selected?.allocPool ?? 0;
  const totalAlloc = rows.reduce((s, a) => s + a.amount, 0);
  const overAlloc = totalAlloc > pool;
  /** 지분율 = 팀 배분액 ÷ 배분 총액 (정수가 아니면 소수 첫째 자리) */
  const shareOf = (amount: number) => { const v = totalAlloc > 0 ? (amount / totalAlloc) * 100 : 0; return `${Number.isInteger(v) ? v : +v.toFixed(1)}%`; };
  // 팀 배분: 같은 팀은 한 번만 — 앞 줄에서 이미 쓴 팀명이면 중복
  const dupAllocIds = new Set(editAllocs.filter((a, i) => a.teamName.trim() && editAllocs.slice(0, i).some(b => b.teamName.trim() === a.teamName.trim())).map(a => a.id));
  const canSaveEdit = draftReady(editData) && dupAllocIds.size === 0;

  const select = (p: Project) => {
    if (!p.isMine) return;
    // 모바일: 목록에서 고르면 상세 풀스크린으로
    if (!sheet && isMobileNow()) { openDetail(p.id); onNavigate('project-detail'); return; }
    setSelectedId(p.id);
    setAddingNew(false);
    setEditMode(false);
    setDeactivating(false);
    setShowAddItem(false);
  };

  // 헤더 검색에서 이동: 주관 프로젝트는 상세 열기, 목록 행은 잠시 강조
  useEffect(() => onFocusRequest('project', id => {
    const p = projects.find(x => x.id === id);
    if (p && !overlapsYear(p.startDate, p.endDate, year)) setViewYear(Number(p.startDate.slice(0, 4)));
    if (p) { setTab(PROJECT_TABS[0]); select(p); }
    setFlashId(id);
  }));
  // 이미 열린 화면에서 검색 이동으로 탭 전환 (My 체크리스트 항목 → 탭 전환 뒤 체크리스트가 항목 강조)
  useEffect(() => onFocusRequest('tab', t => {
    if (sheet || !isProjectTab(t)) return false;
    setTab(t as ProjectTab);
  }));
  useEffect(() => {
    if (!flashId) return;
    document.querySelector(`[data-proj="${flashId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashId(null), 1800);
    return () => window.clearTimeout(t);
  }, [flashId]);


  const listToggle = <Segmented options={LIST_FILTERS} value={listFilter} onChange={setListFilter} label="프로젝트 보기" />;

  const startAdd = () => { setTab('My 프로젝트'); setAddingNew(true); setEditMode(false); setNewProj(EMPTY_PROJECT); };
  const saveNew = () => {
    if (!draftReady(newProj)) return;
    const id = uid('p');
    dispatch({ type: 'ADD_PROJECT', id, draft: { ...newProj, name: newProj.name.trim() }, team: state.session?.team ?? '' });
    setAddingNew(false);
    setSelectedId(id);
    showToast('프로젝트가 등록되었습니다!');
  };

  const startEdit = () => {
    if (!selected) return;
    const { name, client, startDate, endDate, totalAmount, allocPool, used } = selected;
    setEditData({ name, client, startDate, endDate, totalAmount, allocPool, used });
    setEditAllocs(viewAllocs.map(a => ({ ...a })));
    setLockedAllocId(null);
    setEditMode(true);
    setDeactivating(false);
  };
  const saveEdit = () => {
    if (!selected || !canSaveEdit) return;
    dispatch({ type: 'UPDATE_PROJECT', id: selected.id, draft: editData, allocs: editAllocs });
    setEditMode(false);
    showToast('변경 사항이 저장되었습니다!');
  };

  const deactivate = () => {
    if (!selected) return;
    dispatch({ type: 'DEACTIVATE_PROJECT', id: selected.id, month: deactivateMonth });
    setDeactivating(false);
    showToast(`${deactivateMonth}부터 비활성 처리되었습니다.`);
  };

  const addItem = () => {
    if (!selected || !newItem.title.trim() || !newItem.amount) return;
    dispatch({ type: 'ADD_CHECK', item: { ...newItem, title: newItem.title.trim(), projectId: selected.id } });
    setNewItem(EMPTY_ITEM);
    setShowAddItem(false);
  };

  return (
    <div className={cx('view-enter', sheet && 'proj-sheet')}>
      <Toast msg={toast} />
      {!sheet && (<>
      <PageHead
        title="프로젝트 운영" extra={checkTab ? undefined : <YearPicker />}
        actions={<>
          {!checkTab && <Btn variant="secondary" className="hide-mobile" onClick={startAdd}><IconPlus size={14} />프로젝트 등록</Btn>}
          <Btn className="exec-cta" onClick={() => onNavigate('exec-new')}><IconPlus size={14} />집행 등록</Btn>
        </>}
      />
      <Tabs tabs={PROJECT_TABS} active={tab} onSelect={setTab} />
      {/* 모바일: 탭 아래 연도 바 + 프로젝트 등록(풀스크린 등록 화면) — 체크리스트 탭은 예정일 기준 기간 태그라 연도 바 없음 */}
      {!checkTab && <YearBar actions={<Btn variant="secondary" size="sm" onClick={() => onNavigate('project-new')}><IconPlus size={14} />프로젝트 등록</Btn>} />}
      {checkTab && <ProjectChecklist scope="my" />}

      {!checkTab && (<>
      {/* 표 제목·보기 전환은 표 카드 밖 (PC·모바일 공통) */}
      <div className="proj-list__head proj-list__head--out">
        <div className="proj-list__bar">
          <p className="proj-list__count">총 <b>{listProjects.length}건</b></p>
          {listToggle}
        </div>
      </div>
      <Card className="card--clip mb-20 proj-list-card">
        <TableWrap>
          <table className="table proj-table">
            <thead>
              <tr>
                <th>사업명</th><th>발주처</th><th>사업기간</th>
                <th className="t-right">전체 경비</th><th className="t-right">잔액</th><th className="t-center">집행률</th><th />
              </tr>
            </thead>
            <tbody>
              {listProjects.length === 0 && !addingNew && (
                <tr><td colSpan={7}><EmptyState icon="📁" message={`${year}년 ${listFilter === 'ongoing' ? '진행중인' : '수행'} 프로젝트가 없습니다`} /></td></tr>
              )}
              {listProjects.map(p => (
                <tr key={p.id} data-proj={p.id}
                  className={cx(p.isMine && 'is-clickable', !p.isMine && 'is-readonly', !p.active && 'is-ended', selectedId === p.id && !addingNew && 'is-selected', flashId === p.id && 'is-flash')}
                  onClick={() => select(p)}
                  tabIndex={p.isMine ? 0 : undefined}
                  onKeyDown={e => { if (e.key === 'Enter') select(p); }}>
                  <td>
                    <div className="row">
                      <MTag endDate={p.endDate} active={p.active} />
                      <span className="t-strong proj-table__name">{p.name}</span>
                    </div>
                  </td>
                  <td className="t-muted">{p.client}</td>
                  <td className="t-muted t-nowrap proj-table__period"><span>{p.startDate} – </span><span>{p.endDate}</span></td>
                  {/* 프로젝트 전체 경비(모든 팀 배분 풀) 기준 — 내 팀 배분액 아님 */}
                  <td className="t-right t-nowrap t-strong proj-table__budget">{fmt(p.allocPool)}</td>
                  <td className="t-right t-nowrap proj-table__remain">{fmt(p.allocPool - p.used)}</td>
                  <td className="proj-table__rate"><Donut used={p.used} budget={p.allocPool} /></td>
                  <td className="t-right t-nowrap">
                    {p.isMine ? <span className="proj-table__more">상세 ›</span> : <span className="proj-table__locked">조회 불가</span>}
                  </td>
                </tr>
              ))}
              {addingNew && (
                <tr className="proj-table__new">
                  <td colSpan={7}>
                    <div className="row">
                      <span className="new-tag">신규 등록 중</span>
                      <span className="text-faint">{newProj.name || '사업명을 아래에서 입력하세요'}</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      </>)}
      </>)}

      {!checkTab && !sheet && addingNew && (
        <Card pad="lg" className="proj-new">
          <SectionHead title="신규 프로젝트 등록" right={
            <div className="row">
              <Btn variant="secondary" size="sm" onClick={() => setAddingNew(false)}>취소</Btn>
              <Btn size="sm" onClick={saveNew} disabled={!draftReady(newProj)}>저장</Btn>
            </div>
          } />
          <ProjectForm draft={newProj} onChange={setNewProj} />
        </Card>
      )}

      {!checkTab && !addingNew && !selected && (
        <Card className={cx(!sheet && 'hide-mobile')}>
          <EmptyState icon="📁" message={sheet ? '프로젝트를 찾을 수 없습니다' : '선택된 프로젝트가 없습니다'}
            sub={sheet ? '목록으로 돌아가 다시 선택해 주세요' : '목록에서 내 프로젝트를 선택하거나 새로 등록하세요'} />
        </Card>
      )}

      {!checkTab && selected && !addingNew && (
        <Card pad="lg" key={selected.id} className={cx(!selected.active && 'is-ended', !sheet && 'hide-mobile')}>
          <div className="proj-detail__head">
            <div className="grow">
              <div className="row row--wrap mb-14">
                <Badge variant={selected.active ? 'green' : 'red'}>● {selected.active ? '활성' : '비활성'}</Badge>
                {selected.isMine && <Badge variant="blue">주관 팀</Badge>}
                {editMode && <Badge variant="amber"><IconEdit size={12} />편집 중</Badge>}
              </div>
              {editMode ? (
                <ProjectForm draft={editData} onChange={setEditData} poolLabel="코웍 팀 배분 가능 금액" />
              ) : (
                <>
                  {/* 상세 화면은 헤더에 프로젝트명이 있으므로 생략 */}
                  {!sheet && <h2 className="proj-detail__title">{selected.name}</h2>}
                  <div className="proj-detail__meta">{selected.client} · {selected.startDate} – {selected.endDate}</div>
                  <div className="proj-detail__meta2">프로젝트 경비 총액 {fmt(selected.totalAmount)} · 코웍 팀 배분 가능 {fmt(selected.allocPool)}</div>
                </>
              )}
            </div>
            {selected.isMine && (
              <div className="row row--wrap proj-detail__actions">
                {editMode ? (!sheet && (
                  <>
                    <Btn variant="secondary" size="sm" onClick={() => setEditMode(false)}>취소</Btn>
                    <Btn size="sm" onClick={saveEdit} disabled={!canSaveEdit}>저장</Btn>
                  </>
                )) : (
                  <>
                    {!sheet && <Btn variant="secondary" size="sm" onClick={startEdit}>편집</Btn>}
                    {selected.active && (
                      <Btn variant="danger" size="sm" onClick={() => { setDeactivating(true); setDeactivateMonth(selected.endDate?.slice(0, 7) || CUR_YYYYMM); }}>
                        비활성 처리
                      </Btn>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {deactivating && (
            <div className="deactivate">
              <div className="deactivate__msg">🔕 비활성화 적용 시작 월을 선택하세요</div>
              <div className="row row--wrap">
                <MonthField value={deactivateMonth} onChange={setDeactivateMonth} />
                <Btn variant="danger" size="sm" onClick={deactivate}>이 달부터 비활성</Btn>
                <Btn variant="secondary" size="sm" onClick={() => setDeactivating(false)}>취소</Btn>
              </div>
            </div>
          )}

          {(() => {
            const p = pct(selected.used, selected.allocPool);
            return (
              <div className="budget-box">
                <div className="row row--between budget-box__head">
                  <span>예산 집행 현황</span>
                  <b>{Math.round(p)}%</b>
                </div>
                <ProgressBar value={p} variant={progVariant(p)} height={10} label="예산 집행률" />
                <div className="row row--between budget-box__foot">
                  <span>집행 {fmt(selected.used)}</span>
                  <span>잔액 {fmt(selected.allocPool - selected.used)}</span>
                </div>
              </div>
            );
          })()}

          <Divider />

          <div className="grid-2 proj-detail__cols">
            <section className="proj-detail__alloc">
              <SectionHead title="코웍-코인 팀 배분" />
              <p className="alloc-sum">
                배분 총액 <b>{fmt(totalAlloc)}</b> · {overAlloc
                  ? <b className="text-danger">초과 {fmt(totalAlloc - pool)}</b>
                  : <>미배분 <b className="text-faint">{fmt(pool - totalAlloc)}</b></>}
              </p>

              {editMode ? (
                <div className="stack">
                  {editAllocs.map(a => {
                    // 추천 목록: 다른 줄에서 이미 고른 팀은 숨김
                    const taken = new Set(editAllocs.filter(b => b.id !== a.id).map(b => b.teamName.trim()));
                    const dup = dupAllocIds.has(a.id);
                    // 잔액 = 수정 중인 배분액 − 이미 사용한 금액
                    const used = a.used ?? 0, left = a.amount - used;
                    return (
                    <div key={a.id} className="alloc-edit-wrap">
                    <div className="alloc-edit">
                      <datalist id={`team-names-${a.id}`}>{state.teams.filter(t => !taken.has(t.name)).map(t => <option key={t.id} value={t.name} />)}</datalist>
                      <div className="alloc-edit__team">
                        <Input className={cx(dup && 'is-error')} value={a.teamName} placeholder="팀명" aria-label="팀명" list={`team-names-${a.id}`} aria-invalid={dup}
                          onChange={e => setEditAllocs(rs => rs.map(r => (r.id === a.id ? { ...r, teamName: e.target.value } : r)))} />
                        <small className="alloc-edit__bal"><span className="alloc-edit__used">사용 {fmt(used)} · </span>잔액 <b className={cx(left < 0 && 'is-over')}>{fmt(left)}</b> <span className="alloc-edit__sharewrap">· 지분 <b className="alloc-edit__share">{shareOf(a.amount)}</b></span></small>
                      </div>
                      <AmountInput className="alloc-edit__amt" value={a.amount} aria-label="배분액"
                        onChange={v => setEditAllocs(rs => rs.map(r => (r.id === a.id ? { ...r, amount: v } : r)))} />
                      {/* 사용액이 있는 팀은 삭제 대신 안내 (집행 이력이 배분에 연결되어 있음) */}
                      <IconBtn className="icon-btn--remove" aria-label="배분 삭제" title="배분 삭제"
                        onClick={() => (used > 0 ? setLockedAllocId(id => (id === a.id ? null : a.id)) : setEditAllocs(rs => rs.filter(r => r.id !== a.id)))}><IconClose size={13} /></IconBtn>
                    </div>
                    {dup && <p className="alloc-edit__err" role="alert">이미 배분한 팀입니다. 다른 팀을 선택해 주세요.</p>}
                    {lockedAllocId === a.id && (
                      <div className="alloc-lock" role="alert">
                        <p>사용액 <b>{fmt(used)}</b>이 있어 삭제할 수 없습니다.{left > 0 && ' 남은 예산을 없애려면 배분액을 사용액으로 맞춰 주세요.'}</p>
                        <div className="alloc-lock__btns">
                          {left !== 0 && (
                            <Btn size="sm" onClick={() => { setEditAllocs(rs => rs.map(r => (r.id === a.id ? { ...r, amount: used } : r))); setLockedAllocId(null); }}>
                              배분액을 사용액으로 맞추기 (잔액 0원)
                            </Btn>
                          )}
                          <Btn size="sm" variant="secondary" onClick={() => setLockedAllocId(null)}>닫기</Btn>
                        </div>
                      </div>
                    )}
                    </div>
                    );
                  })}
                  <button type="button" className="btn-dashed"
                    onClick={() => setEditAllocs(rs => [...rs, { id: uid('a'), teamName: '', amount: 0 }])}>+ 팀 배분 추가</button>
                </div>
              ) : rows.length === 0 ? (
                <div className="soft-empty">배분 내역이 없습니다</div>
              ) : (
                <table className={cx('alloc-table', selected.isMine && 'alloc-table--usage')}>
                  <thead>
                    <tr><th>팀</th><th>배분액</th>{selected.isMine && <><th>사용액</th><th>잔액</th></>}</tr>
                  </thead>
                  <tbody>
                    {rows.map(a => {
                      const used = a.used ?? 0;
                      const left = a.amount - used;
                      return (
                        <tr key={a.id}>
                          <td className="alloc-table__team">
                            <span className={cx('alloc-team', a.teamName === state.session?.team && 'is-mine')}>
                              <span className="alloc-team__dot" aria-hidden="true" />{a.teamName}
                              {a.teamName === state.session?.team && <span className="alloc-team__mine">우리 팀</span>}
                            </span>
                          </td>
                          <td data-label="배분액">{fmt(a.amount)}{selected.isMine && <span className="alloc-share">{shareOf(a.amount)}</span>}</td>
                          {selected.isMine && (
                            <>
                              <td className="alloc-table__used" data-label="사용액">{fmt(used)}</td>
                              <td className={cx('alloc-table__left', left < 0 && 'is-over')} data-label="잔액">{fmt(left)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  {selected.isMine && (() => {
                    const sumUsed = rows.reduce((s, a) => s + (a.used ?? 0), 0);
                    return (
                      <tfoot>
                        <tr>
                          <td>합계</td>
                          <td data-label="배분액">{fmt(totalAlloc)}<span className="alloc-share">{totalAlloc > 0 ? '100%' : '0%'}</span></td>
                          <td className="alloc-table__used" data-label="사용액">{fmt(sumUsed)}</td>
                          <td className={cx('alloc-table__left', totalAlloc - sumUsed < 0 && 'is-over')} data-label="잔액">{fmt(totalAlloc - sumUsed)}</td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              )}
            </section>

            <section>
              {/* 체크리스트 기준 = 주관 팀의 My 경비 배분 금액 (참여 팀 배분 예산과 별개) */}
              {(() => { const b = ownerBudget(state, selected); return <SectionHead title="My 경비 집행 체크리스트" sub={`My 경비 총액 ${fmt(b.amount)} · 잔액 ${fmt(b.remain)}`} />; })()}
              <div className="mb-14">
                <CheckRows items={items} projects={[selected]} hideProject
                  onToggle={id => dispatch({ type: 'TOGGLE_CHECK', id })}
                  onExec={(id, patch) => dispatch({ type: 'SET_CHECK_EXEC', id, patch })}
                  empty={<div className="soft-empty">등록된 항목이 없습니다</div>}
                  actions={editMode ? item => (<>
                    <Badge variant={isPublicCheck(item) ? 'outline' : 'dark'} size="lg" pressed={!isPublicCheck(item)}
                      title="공개: 배분받은 코웍 팀 모두 · 비공개: 주관 팀만"
                      onClick={() => dispatch({ type: 'SET_CHECK_VISIBILITY', id: item.id, visibility: isPublicCheck(item) ? 'private' : 'public' })}>
                      {isPublicCheck(item) ? '공개' : '비공개'}
                    </Badge>
                    <IconBtn className="icon-btn--remove" aria-label={`${item.title} 삭제`} title="항목 삭제"
                      onClick={() => dispatch({ type: 'DELETE_CHECK', id: item.id })}><IconClose size={13} /></IconBtn>
                  </>) : undefined} />
              </div>

              {selected.isMine && showAddItem && (
                <div className="add-item">
                  <Input placeholder="항목명 (예: 자재 구매비)" aria-label="항목명" value={newItem.title}
                    onChange={e => setNewItem(p => ({ ...p, title: e.target.value }))} />
                  {/* 공개 체크(기본 켜짐) = 배분받은 코웍 팀 모두, 끄면 비공개 = 주관 팀만 */}
                  <div className="add-item__amt">
                    <label className="add-item__public" title="공개: 배분받은 코웍 팀 모두 볼 수 있음 · 해제하면 주관 팀만">
                      <Checkbox checked={newItem.visibility === 'public'}
                        onChange={e => setNewItem(p => ({ ...p, visibility: e.target.checked ? 'public' : 'private' }))} />
                      공개
                    </label>
                    <AmountInput placeholder="금액" aria-label="금액" hangul value={newItem.amount} onChange={v => setNewItem(p => ({ ...p, amount: v }))} />
                  </div>
                  <div className="add-item__row">
                    <Select value={newItem.category} aria-label="구분" onChange={e => setNewItem(p => ({ ...p, category: e.target.value as Category | '' }))}>
                      <option value="">구분 선택</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </Select>
                    <DateField aria-label="날짜" placeholder="날짜 선택" value={newItem.date} onChange={v => setNewItem(p => ({ ...p, date: v }))} />
                  </div>
                  <div className="add-item__btns">
                    <Btn variant="secondary" onClick={() => { setShowAddItem(false); setNewItem(EMPTY_ITEM); }}>취소</Btn>
                    <Btn onClick={addItem} disabled={!newItem.title.trim() || !newItem.amount}>추가</Btn>
                  </div>
                </div>
              )}
              {selected.isMine && !showAddItem && (
                <Btn variant="secondary" block size="sm" onClick={() => setShowAddItem(true)}>+ 체크리스트 생성</Btn>
              )}
              {!selected.isMine && (
                <Alert variant="info"><strong>이 프로젝트는 조회만 가능합니다</strong>배분·체크리스트 관리는 주관 팀만 수행할 수 있습니다.</Alert>
              )}
            </section>
          </div>
        </Card>
      )}
      {/* 상세 화면 하단 고정 버튼 (화면 등장 애니메이션의 transform 이 fixed 를 가두므로 body 로 portal) */}
      {sheet && createPortal(
        <div className="exec-bar" role="region" aria-label="프로젝트 상세">
          <div className="exec-bar__btns">
            {editMode ? (
              <>
                <Btn variant="secondary" onClick={() => setEditMode(false)}>취소</Btn>
                <Btn onClick={saveEdit} disabled={!canSaveEdit}>저장</Btn>
              </>
            ) : (
              <>
                <Btn variant="secondary" onClick={() => onNavigate('project')}>목록으로</Btn>
                <Btn onClick={startEdit} disabled={!selected}>편집하기</Btn>
              </>
            )}
          </div>
        </div>, document.body)}
    </div>
  );
}
