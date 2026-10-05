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
/** (연도, 월 인덱스 0~11) → 'YYYY-MM' */
const ymOf = (y: number, i: number) => `${y}-${String(i + 1).padStart(2, '0')}`;
/** 체크리스트 구분 태그 — My = 우리 팀 주관 프로젝트, 코웍 = 배분받아 참여하는 프로젝트의 공개 항목 */
type Scope = 'my' | 'cowork';
const SCOPES: { value: Scope; label: string }[] = [{ value: 'my', label: 'My' }, { value: 'cowork', label: '코웍' }];

export default function Home({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  // 잔여 금액 카드 기준 월 (YYYY-MM)
  const [month, setMonth] = useState(CUR_YYYYMM);
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
  const projects = myActiveProjects(state);
  // 알림 카드: 이번 분기 팀 인원(회의비 산정 기준)이 비어 있을 때만
  const curQMissing = q.headcounts.some(h => h === 0);

  /**
   * 잔여 금액 카드 — 고른 달 말 기준 (지난달·다음 달·다른 해 어디로든 이동)
   * · 팀 회의비: 그 달이 속한 분기 예산 − 그 분기에서 그 달까지 집행 (올해·미리 입력한 다음 해만 예산 있음)
   * · 팀 업무비: 그 달 예산 − 그 달 집행
   * · 프로젝트: 그 달에 진행 중인 내 프로젝트 배분 경비 − 그 달까지 집행
   */
  const heroOf = (m: string) => {
    const y = Number(m.slice(0, 4)), mi = Number(m.slice(5, 7)) - 1, qi = Math.floor(mi / 3);
    const qStart = ymOf(y, qi * 3);
    const qd = y === CUR_YEAR ? state.quarters[qi] : state.plannedQuarters[String(y)]?.[qi];
    const sumRec = (pred: (r: (typeof state.records)[number]) => boolean) => state.records.filter(pred).reduce((s, r) => s + r.total, 0);
    const meeting = {
      budget: qd?.budget ?? 0, used: sumRec(r => r.type === 'meeting' && r.month >= qStart && r.month <= m),
      label: qd?.label ?? `${qi + 1}분기`, headcount: qd?.headcounts[mi % 3] ?? 0,
    };
    const work = { budget: workBudgetOf(state, m).amount, used: workUsedOf(state, m) };
    const live = state.projects.filter(p => p.isMine && p.startDate.slice(0, 7) <= m && (p.endDate || p.startDate).slice(0, 7) >= m);
    const project = {
      budget: live.reduce((s, p) => s + p.allocPool, 0),
      used: sumRec(r => r.type === 'project' && r.month <= m && live.some(p => p.id === r.projectId)), count: live.length,
    };
    return { meeting, work, project, total: meeting.budget + work.budget + project.budget, used: meeting.used + work.used + project.used };
  };
  const isCurMonth = month === CUR_YYYYMM;
  /**
   * 예산 현황 카드와 아래 3개 카드는 같은 달 기준 — 이번 달은 지금까지 쓰던 계산, 다른 달은 그 달 기준으로 다시 계산
   * (소멸 예정·사용 가능 안내는 이번 달에만)
   */
  const cards = isCurMonth
    ? {
      meeting: { budget: q.budget, used: q.used, label: q.label, headcount: q.headcounts[Math.min(2, CUR_MONTH - Q_START)] ?? 0 },
      work: { budget: workBudget, used: workUsed },
      project: { budget: ov.projBudget, used: ov.projUsed, count: projects.length },
      total, used,
    }
    : heroOf(month);
  const hero = cards;
  const monthLabel = `${isCurMonth || month.startsWith(`${CUR_YEAR}-`) ? '' : `${month.slice(0, 4)}년 `}${Number(month.slice(5, 7))}월`;
  const heroUsed = hero.used;
  const heroPct = pct(heroUsed, hero.total);
  /** 이동 범위 — 집행·프로젝트가 있는 가장 이른 달 ~ 다음 해 12월 */
  const firstMonth = [CUR_YYYYMM, ...state.records.map(r => r.month), ...state.projects.map(p => p.startDate.slice(0, 7))].filter(Boolean).sort()[0];
  const lastMonth = `${CUR_YEAR + 1}-12`;
  const shiftMonth = (d: number) => setMonth(m => {
    const t = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + d, 1);
    const v = ymOf(t.getFullYear(), t.getMonth());
    return v < firstMonth || v > lastMonth ? m : v;
  });

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
  const toggle = (id: string, exec?: { spent?: number; spentDate?: string }) => dispatch({ type: 'TOGGLE_CHECK', id, exec });
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
          <div className="hero__amount num">{fmt(hero.total - heroUsed)}</div>
          <StepNav label="기준 월" className="hero__month" prevLabel="이전 달" nextLabel="다음 달"
            onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)}
            prevDisabled={month <= firstMonth} nextDisabled={month >= lastMonth}
            picker={close => <MonthGrid value={month} min={firstMonth} max={lastMonth} onPick={v => { setMonth(v); close(); }} />}>
            {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월{isCurMonth && <Badge variant="amber" size="sm">이번 달</Badge>}
          </StepNav>
        </div>
        <div className="hero__sub">전체 {fmt(hero.total)} 중 {fmt(heroUsed)} 집행</div>
        <div className="hero__bar"><div style={{ width: `${Math.min(100, heroPct)}%` }} /></div>
        <div className="hero__legend">
          <span>집행률 {Math.round(heroPct)}%</span>
          <Badge variant="green">잔여 {Math.max(0, Math.round(100 - heroPct))}%</Badge>
        </div>
        {isCurMonth && exp.total > 0 && (
          <div className="hero__expire">
            <span aria-hidden="true">🔔</span>
            <div>다음 달에 <b className="num">{fmt(exp.total)}</b>의 예산이 사라질 것 같아요!</div>
          </div>
        )}
      </section>

      {/* Stat cards */}
      <div className="grid-3 mb-20">
        <StatCard
          accent="var(--coral)" label="팀 회의비" value={fmt(cards.meeting.budget - cards.meeting.used)}
          sub={`${isCurMonth ? '' : `${monthLabel} · `}${cards.meeting.label} 잔액 · ${cards.meeting.headcount}명 × ${fmtMan(state.meetingRate)}원`}
          budget={cards.meeting.budget} used={cards.meeting.used} expiring={isCurMonth ? exp.meeting : 0}
          action={{ label: '회의비 관리 →', onClick: () => { openTeamTab('팀 회의비'); onNavigate('meeting'); } }}
        />
        <StatCard
          accent="var(--sage)" label="프로젝트 경비" value={fmt(cards.project.budget - cards.project.used)}
          sub={`${isCurMonth ? '' : `${monthLabel} 말 `}잔액 · ${cards.project.count}건 진행 중`}
          budget={cards.project.budget} used={cards.project.used} expiring={isCurMonth ? exp.project : 0}
          action={{ label: '목록 보기 →', onClick: () => onNavigate('project') }}
        />
        <StatCard
          accent="var(--violet)" label="팀 업무비" value={fmt(cards.work.budget - cards.work.used)}
          sub={`${monthLabel} 잔액 · 월 예산 ${fmtMan(cards.work.budget)}원`}
          budget={cards.work.budget} used={cards.work.used} expiring={0} available={isCurMonth ? exp.work : undefined}
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
