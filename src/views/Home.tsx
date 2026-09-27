import { useState, type CSSProperties } from 'react';
import type { View } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { budgetOverview, currentQuarter, expiring, myActiveProjects, visibleChecklist } from '@/store/selectors';
import { CUR_MONTH, CUR_QUARTER, CUR_YEAR, CUR_YYYYMM, todayLabel } from '@/lib/date';
import { workBudgetOf, workUsedOf } from '@/lib/budget';
import { fmt, fmtMan, pct } from '@/lib/format';
import { Alert, Badge, Btn, Card, FilterChip, ProgressBar, MonthGrid, SectionHead, StepNav, progVariant } from '@/components/ui';
import { IconPlus } from '@/components/icons';
import InstallCard from '@/components/InstallCard';
import IntroPopup from '@/components/IntroPopup';
import CheckRows, { byCheckDate, checkDateOf } from '@/components/CheckRows';
import { openTeamTab } from './Meeting';
import './Home.css';

/** 체크 상태 필터 — 프로젝트 운영 > 체크리스트와 같은 [전체 | 잔여 | 완료] */
type Status = 'all' | 'todo' | 'done';
const STATUS: { value: Status; label: string }[] = [{ value: 'all', label: '전체' }, { value: 'todo', label: '잔여' }, { value: 'done', label: '완료' }];
const Q_START = CUR_QUARTER * 3;
/** 월 인덱스(0~11) → 'YYYY-MM' (올해) */
const ymOf = (i: number) => `${CUR_YEAR}-${String(i + 1).padStart(2, '0')}`;
/** 체크리스트 구분 태그 — My = 우리 팀 주관 프로젝트, 코웍 = 배분받아 참여하는 프로젝트의 공개 항목 */
type Scope = 'my' | 'cowork';
const SCOPES: { value: Scope; label: string }[] = [{ value: 'my', label: 'My' }, { value: 'cowork', label: '코웍' }];

export default function Home({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [monthIdx, setMonthIdx] = useState(CUR_MONTH);
  const [status, setStatus] = useState<Status>('all');
  const [scopes, setScopes] = useState<Set<Scope>>(() => new Set(['my', 'cowork']));
  // 태그는 각각 켜고 끄되, 마지막 하나는 끌 수 없음 (목록이 비지 않도록)
  const toggleScope = (v: Scope) => setScopes(s => {
    if (s.has(v) && s.size === 1) return s;
    const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n;
  });

  const team = state.session?.team ?? '';
  const ov = budgetOverview(state);
  // 팀 업무비: 이번 달 월 예산 (이월 없음 → 남은 금액은 다음 달 소멸)
  const workBudget = workBudgetOf(state, CUR_YYYYMM).amount;
  const workUsed = workUsedOf(state, CUR_YYYYMM);
  const workRemain = workBudget - workUsed;
  const exp0 = expiring(state);
  const exp = { ...exp0, work: Math.max(0, workRemain), total: exp0.total + Math.max(0, workRemain) };
  const total = ov.total + workBudget;
  const used = ov.used + workUsed;
  const q = currentQuarter(state);
  // 알림 카드: 이번 분기 팀 인원(회의비 산정 기준)이 비어 있을 때만
  const curQMissing = q.headcounts.some(h => h === 0);

  // 선택 월 말 기준 집행액 = 현재 집행액 − 선택 월 이후(이번 분기 내) 월별 집행액
  const laterExec = state.monthly
    .filter(m => m.month > monthIdx && m.month <= CUR_MONTH)
    .reduce((s, m) => s + m.meeting + m.project, 0);
  // 이번 달 업무비는 이번 달에만 쓰이므로 지난 달 기준으로 보면 이번 달 업무비 집행도 뺌
  const heroUsed = Math.max(0, used - laterExec - (monthIdx < CUR_MONTH ? workUsed : 0));
  const heroPct = pct(heroUsed, total);

  const projects = myActiveProjects(state);
  // 홈: 이번 달 예정 · 미체크 · 예정일 없는 항목만 (전체 목록은 프로젝트 운영 > 체크리스트)
  // 주관 프로젝트는 전부, 배분받은 참여 프로젝트는 공개 항목만
  const projById = new Map(state.projects.map(p => [p.id, p]));
  const scopeOf = (projectId: string): Scope => (projById.get(projectId)?.isMine ? 'my' : 'cowork');
  const homeChecklist = visibleChecklist(state)
    .filter(c => !c.checked || !checkDateOf(c) || checkDateOf(c)!.startsWith(CUR_YYYYMM))
    .sort(byCheckDate);
  const myChecklist = homeChecklist.filter(c => scopes.has(scopeOf(c.projectId)));
  // 상태 필터 = 요약 숫자 (My 체크리스트와 같은 '전체 n' 형식)
  const statusCount = { all: myChecklist.length, todo: myChecklist.filter(c => !c.checked).length, done: myChecklist.filter(c => c.checked).length };
  const statusOptions = STATUS.map(o => ({ ...o, label: `${o.label} ${statusCount[o.value]}` }));
  const shown = myChecklist.filter(c => (status === 'todo' ? !c.checked : status === 'done' ? c.checked : true));
  const toggle = (id: string) => dispatch({ type: 'TOGGLE_CHECK', id });
  const setExec = (id: string, patch: { spent?: number; spentDate?: string }) => dispatch({ type: 'SET_CHECK_EXEC', id, patch });

  return (
    <div className="view-enter">
      <div className="home-head">
        <div>
          <div className="page-head__eyebrow">{todayLabel()}</div>
          <h1 className="page-head__title home-head__title">안녕하세요, {team}님 👋</h1>
        </div>
        <Btn className="exec-cta" onClick={() => onNavigate('exec-new')}><IconPlus size={14} />집행 등록</Btn>
      </div>

      <InstallCard />
      <IntroPopup />
      {curQMissing && (
        <Alert variant="warn" className="home-notice">
          <strong>이번 분기({q.label}) 팀 인원이 입력되지 않았습니다</strong>
          팀 회의비 예산은 분기별 인원수를 기준으로 산정됩니다.{' '}
          <Btn variant="link" size="sm" onClick={() => onNavigate('meeting')}>인원 입력하기 →</Btn>
        </Alert>
      )}

      {/* Hero */}
      <section className="hero" aria-label="예산 현황">
        <div className="hero__label">예산 현황 · 잔여 금액</div>
        <div className="hero__row">
          <div className="hero__amount num">{fmt(total - heroUsed)}</div>
          <StepNav label="기준 월" className="hero__month" prevLabel="이전 달" nextLabel="다음 달"
            onPrev={() => setMonthIdx(i => Math.max(Q_START, i - 1))} onNext={() => setMonthIdx(i => Math.min(CUR_MONTH, i + 1))}
            prevDisabled={monthIdx === Q_START} nextDisabled={monthIdx === CUR_MONTH}
            picker={close => <MonthGrid value={ymOf(monthIdx)} min={ymOf(Q_START)} max={ymOf(CUR_MONTH)} onPick={v => { setMonthIdx(Number(v.slice(5, 7)) - 1); close(); }} />}>
            {CUR_YEAR}년 {monthIdx + 1}월
          </StepNav>
        </div>
        <div className="hero__sub">전체 {fmt(total)} 중 {fmt(heroUsed)} 집행</div>
        <div className="hero__bar"><div style={{ width: `${Math.min(100, heroPct)}%` }} /></div>
        <div className="hero__legend">
          <span>집행률 {Math.round(heroPct)}%</span>
          <Badge variant="green">잔여 {Math.max(0, Math.round(100 - heroPct))}%</Badge>
        </div>
        {exp.total > 0 && (
          <div className="hero__expire">
            <span aria-hidden="true">🔔</span>
            <div>다음 달에 <b className="num">{fmt(exp.total)}</b>의 예산이 사라질 것 같아요!</div>
          </div>
        )}
      </section>

      {/* Stat cards */}
      <div className="grid-3 mb-20">
        <StatCard
          accent="var(--coral)" label="팀 회의비" value={fmt(q.budget - q.used)}
          sub={`${q.label} 잔액 · ${q.headcounts[Math.min(2, CUR_MONTH - Q_START)] ?? 0}명 × ${fmtMan(state.meetingRate)}원`}
          budget={q.budget} used={q.used} expiring={exp.meeting}
          action={{ label: '회의비 관리 →', onClick: () => { openTeamTab('팀 회의비'); onNavigate('meeting'); } }}
        />
        <StatCard
          accent="var(--sage)" label="프로젝트 경비" value={fmt(ov.projBudget - ov.projUsed)}
          sub={`잔액 · ${projects.length}건 진행 중`}
          budget={ov.projBudget} used={ov.projUsed} expiring={exp.project}
          action={{ label: '목록 보기 →', onClick: () => onNavigate('project') }}
        />
        <StatCard
          accent="var(--violet)" label="팀 업무비" value={fmt(workRemain)}
          sub={`${CUR_MONTH + 1}월 잔액 · 월 예산 ${fmtMan(workBudget)}원`}
          budget={workBudget} used={workUsed} expiring={0} available={exp.work}
          action={{ label: '업무비 관리 →', onClick: () => { openTeamTab('팀 업무비'); onNavigate('meeting'); } }}
        />
      </div>

      {/* Full checklist */}
      <Card pad>
        {/* 위계: 구분(My·코웍, 제목 옆) → 상태(전체·잔여·완료 글자 탭 — 선택한 구분 안에서의 건수) */}
        <SectionHead title="내 체크리스트" right={
          <div className="chip-row home-check__scope" role="group" aria-label="체크리스트 구분">
            {SCOPES.map(o => (
              <FilterChip key={o.value} label={o.label} active={scopes.has(o.value)} onClick={() => toggleScope(o.value)} />
            ))}
          </div>
        } />
        <div className="home-check__filter" role="group" aria-label="체크 상태">
          {statusOptions.map(o => (
            <button key={o.value} type="button" className={`home-check__tab${status === o.value ? ' is-active' : ''}`}
              aria-pressed={status === o.value} onClick={() => setStatus(o.value)}>{o.label}</button>
          ))}
        </div>
        <CheckRows items={shown} projects={state.projects} onToggle={toggle} onExec={setExec} empty={{ icon: '🎉', message: '모두 처리되었습니다!' }} />
      </Card>
    </div>
  );
}

function StatCard({ accent, label, value, sub, budget, used, expiring, available, action }: {
  accent: string; label: string; value: string; sub: string; budget: number; used: number; expiring: number;
  /** 팀 업무비: 이번 달 쓸 수 있는 금액 — 경고 대신 녹색 안내 */
  available?: number;
  action?: { label: string; onClick: () => void };
}) {
  const p = pct(used, budget);
  return (
    <Card hover pad className="stat" style={{ '--accent': accent } as CSSProperties}>
      <div className="stat__label">{label}</div>
      <div className="stat__value num">{value}</div>
      <div className="stat__sub">{sub}</div>
      <ProgressBar value={p} variant={progVariant(p)} height={6} label={`${label} 집행률`} />
      <div className="stat__foot">
        <span>예산 <b>{fmt(budget)}</b></span>
        <span>집행 <b>{fmt(used)}</b></span>
      </div>
      {expiring > 0 && (
        <div className="stat__expire"><span aria-hidden="true">🔔</span>다음 달 <b>{fmt(expiring)}</b> 소멸 예정</div>
      )}
      {available != null && available > 0 && (
        <div className="stat__avail"><span aria-hidden="true">✅</span>이번 달 <b>{fmt(available)}</b> 사용 가능</div>
      )}
      {action && <Btn variant="secondary" size="sm" block className="stat__action" onClick={action.onClick}>{action.label}</Btn>}
    </Card>
  );
}
