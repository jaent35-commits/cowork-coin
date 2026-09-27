import { useEffect, useState } from 'react';
import type { ExecRecord, View } from '@/types';
import { useAppState } from '@/store/StoreContext';
import { currentQuarter } from '@/store/selectors';
import { YEARLY_HISTORY } from '@/data/seed';
import { CUR_MONTH, CUR_QUARTER, CUR_YEAR, TODAY, monthsUntil, quarterOf, ym } from '@/lib/date';
import { workBudgetOf, workUsedOf } from '@/lib/budget';
import { fmt, fmtMan, pct } from '@/lib/format';
import { Btn, Card, FilterChip, PageHead, ProgressBar, Segmented, Select, StepNav, Tabs, cx, progVariant } from '@/components/ui';
import { MTag } from '@/components/ui/MTag';
import { overlapsYear, useViewYear } from '@/lib/viewYear';
import { IconPlus } from '@/components/icons';
import YearPicker, { YearBar } from '@/components/layout/YearPicker';
import './Report.css';

const COIN_VIEW_KEY = 'cowork-coin-report-coin-view';
const REPORT_TABS = ['보유 코웍-코인', '운영일지', '차트'] as const;
type ReportTab = (typeof REPORT_TABS)[number];

type CalView = 'day' | 'month' | 'year';
type Period = 'month' | 'quarter' | 'year';
type Line = 'total' | 'team' | 'project';
/** 차트 '팀 운영' 선택 시 하위 목록 */
type TeamSub = 'all' | 'meeting' | 'work';
const TEAM_SUBS: { value: TeamSub; label: string }[] = [{ value: 'all', label: '팀 운영 전체' }, { value: 'meeting', label: '팀 회의비' }, { value: 'work', label: '팀 업무비' }];
/** 월별 집행(−) — 팀 운영 = 회의비 + 업무비 */
interface MonthRow { month: number; meeting: number; work: number; project: number }
/** 월별 예산 배분(+) — 회의비·업무비는 매월, 프로젝트는 착수월에 우리 팀 배분액 */
interface Plan { team: number; project: number }
interface Flow { plan: Plan; exec: Plan }
type CoinSort = 'deadline' | 'rate';
interface Pt { label: string; exec: number; remain: number; past: boolean }

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const ALL = 'all';

function LineChart({ pts, sel, onSelect }: { pts: Pt[]; sel: number; onSelect: (i: number) => void }) {
  const W = 300, H = 120, PAD = { top: 14, right: 8, bottom: 20, left: 8 };
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const step = pts.length > 1 ? plotW / (pts.length - 1) : plotW;
  const max = Math.max(...pts.map(p => Math.max(p.exec, p.remain)), 1);
  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const path = (list: [number, number][]) => list.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const execPath = path(pts.map((p, i) => [i, p.exec] as [number, number]).filter((_, i) => pts[i].past));
  const hasRemain = pts.some(p => p.remain > 0);
  const remainPath = path(pts.map((p, i) => [i, p.remain]));

  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="예산과 집행 비용 추이">
      {[0, 0.33, 0.66, 1].map(t => <line key={t} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + t * plotH} y2={PAD.top + t * plotH} className="line-chart__grid" />)}
      <line x1={x(sel)} x2={x(sel)} y1={PAD.top} y2={PAD.top + plotH} className="line-chart__cursor" />
      {hasRemain && <path d={remainPath} className="line-chart__remain" />}
      {execPath && <path d={execPath} className="line-chart__exec" />}
      {hasRemain && pts.map((p, i) => (
        <circle key={`r${i}`} cx={x(i)} cy={y(p.remain)} r={i === sel ? 4.5 : 2.5} className={cx('dot dot--remain', i === sel && 'is-sel')} onClick={() => onSelect(i)} />
      ))}
      {pts.map((p, i) => p.past && (
        <circle key={`e${i}`} cx={x(i)} cy={y(p.exec)} r={i === sel ? 4.5 : 2.5} className={cx('dot dot--exec', i === sel && 'is-sel')} onClick={() => onSelect(i)} />
      ))}
      {pts.map((p, i) => (
        <text key={i} x={x(i)} y={H - 3} textAnchor="middle" className={cx('line-chart__label', i === sel && 'is-sel')} onClick={() => onSelect(i)}>{p.label}</text>
      ))}
    </svg>
  );
}

/** + 배분 / − 집행 두 줄 (없으면 —) */
function PlusMinus({ plus, minus }: { plus: number; minus: number }) {
  if (plus <= 0 && minus <= 0) return <b>—</b>;
  return (
    <>
      {plus > 0 && <b className="is-plus">+{fmt(plus)}</b>}
      {minus > 0 && <b className="is-minus">−{fmt(minus)}</b>}
    </>
  );
}

/** 운영일지 요약: [팀 운영 | 프로젝트 | 합계] × [+ 예산 배분 · − 집행] */
function Triple({ flow, big }: { flow: Flow; big?: boolean }) {
  const { plan, exec } = flow;
  return (
    <div className={cx('triple', big && 'triple--big')}>
      <div><span>팀 운영</span><PlusMinus plus={plan.team} minus={exec.team} /></div>
      <div><span>프로젝트</span><PlusMinus plus={plan.project} minus={exec.project} /></div>
      <div><span>합계</span><PlusMinus plus={plan.team + plan.project} minus={exec.team + exec.project} /></div>
    </div>
  );
}

/** 올해가 아닌 연도는 집행 기록에서 월별 합계를 계산 */
function monthlyOf(records: ExecRecord[], year: number, projectId?: string): MonthRow[] {
  const rows = Array.from({ length: 12 }, (_, month) => ({ month, meeting: 0, work: 0, project: 0 }));
  for (const r of records) {
    if (Number(r.month.slice(0, 4)) !== year || (projectId && r.projectId !== projectId)) continue;
    rows[Number(r.month.slice(5, 7)) - 1][r.type] += r.total;
  }
  return rows;
}

export default function Report({ onNavigate }: { onNavigate: (v: View) => void }) {
  const state = useAppState();
  const { records, quarters, projects, projectMonthly } = state;
  const [year] = useViewYear();
  const isCurYear = year === CUR_YEAR;
  // 올해: 저장된 월별 회의비·프로젝트 집행 + 업무비는 집행 기록에서
  const monthly: MonthRow[] = isCurYear
    ? state.monthly.map(m => ({ ...m, work: workUsedOf(state, ym(year, m.month)) }))
    : monthlyOf(records, year);
  /** 집행이 확정된 마지막 달 (미래 연도 = -1) */
  const lastMonth = isCurYear ? CUR_MONTH : year < CUR_YEAR ? 11 : -1;
  const team = state.session?.team ?? '';
  /** 월 예산 배분(+): 회의비 = 월 인원 × 1인 단가(올해만), 업무비 = 월 예산, 프로젝트 = 착수월에 우리 팀 배분액 */
  const planOf = (mi: number): Plan & { meeting: number; work: number } => {
    if (mi > lastMonth) return { team: 0, project: 0, meeting: 0, work: 0 };
    const key = ym(year, mi);
    const meeting = isCurYear ? (quarters[quarterOf(mi)]?.headcounts[mi % 3] ?? 0) * state.meetingRate : 0;
    const work = workBudgetOf(state, key).amount;
    const project = projects.filter(p => p.startDate.startsWith(key))
      .reduce((s, p) => s + (state.allocs[p.id]?.find(a => a.teamName === team)?.amount ?? 0), 0);
    return { meeting, work, team: meeting + work, project };
  };
  const flowOf = (mi: number): Flow => {
    const m = monthly[mi];
    return { plan: planOf(mi), exec: { team: m.meeting + m.work, project: m.project } };
  };
  const navLast = isCurYear ? CUR_MONTH : 11;
  const [selMonth, setSelMonth] = useState(isCurYear ? CUR_MONTH : 0);
  const [selDay, setSelDay] = useState<number | null>(null);
  const [selQuarter, setSelQuarter] = useState(CUR_QUARTER);
  const [selYear, setSelYear] = useState(YEARLY_HISTORY.length);
  const [line, setLine] = useState<Line>('total');
  const [teamSub, setTeamSub] = useState<TeamSub>('all');
  const [projectId, setProjectId] = useState(ALL);
  const [calView, setCalView] = useState<CalView>('month');
  const [period, setPeriod] = useState<Period>('month');
  const [coinSort, setCoinSort] = useState<CoinSort>('deadline');
  // 정렬 방향 — 같은 버튼을 다시 누르면 뒤집힘 (기한: 임박순↔여유순, 집행률: 낮은순↔높은순)
  const [coinAsc, setCoinAsc] = useState(true);
  // 보기 형식: 카드(기본) / 리스트
  // 보기 형식은 마지막 선택을 기억 (기기별)
  const [coinView, setCoinViewState] = useState<'card' | 'list'>(() => { try { return localStorage.getItem(COIN_VIEW_KEY) === 'list' ? 'list' : 'card'; } catch { return 'card'; } });
  const setCoinView = (v: 'card' | 'list') => { setCoinViewState(v); try { localStorage.setItem(COIN_VIEW_KEY, v); } catch { /* 저장 불가 — 이번 방문만 */ } };
  const changeSort = (v: CoinSort) => { if (v === coinSort) setCoinAsc(a => !a); else { setCoinSort(v); setCoinAsc(true); } };
  const [tab, setTab] = useState<ReportTab>('보유 코웍-코인');

  // 조회 연도가 바뀌면 월 선택·프로젝트 선택 초기화
  useEffect(() => { setSelMonth(isCurYear ? CUR_MONTH : 0); setSelDay(null); setProjectId(ALL); }, [year, isCurYear]);

  /* ── 보유 코웍-코인 ── */
  const q = currentQuarter(state);
  const coins = [
    // 회의비는 분기 말에 소멸하므로 분기 마지막 달을 기한으로 본다
    { key: 'meeting', label: `팀 회의비 (${q.label})`, endDate: ym(CUR_YEAR, CUR_QUARTER * 3 + 2), active: true, budget: q.budget, used: q.used },
    ...projects.map(p => ({ key: p.id, label: p.name, endDate: p.endDate, active: p.active, budget: p.allocPool, used: p.used })),
  ];
  const sortedCoins = [...coins].sort((a, b) => {
    // 종료(비활성) 건은 정렬 기준과 관계없이 맨 뒤
    if (a.active !== b.active) return a.active ? -1 : 1;
    const d = coinSort === 'rate'
      ? pct(a.used, a.budget) - pct(b.used, b.budget)
      : monthsUntil(a.endDate) - monthsUntil(b.endDate);
    return (coinAsc ? d : -d) || a.label.localeCompare(b.label);
  });

  /* ── 차트 ── */
  // 올해 사업기간이 걸친 프로젝트
  const yearProjects = projects.filter(p => overlapsYear(p.startDate, p.endDate, year));
  const oneProject = line === 'project' && projectId !== ALL ? projects.find(p => p.id === projectId) : undefined;
  const oneRow = !oneProject ? null
    : isCurYear ? projectMonthly[oneProject.id] ?? Array(12).fill(0)
    : monthlyOf(records, year, oneProject.id).map(m => m.project);

  /** 팀 운영 집행 — 하위 목록(전체 · 회의비 · 업무비)에 따라 */
  const teamOf = (y: { meeting: number; work?: number }) => (teamSub === 'meeting' ? y.meeting : teamSub === 'work' ? y.work ?? 0 : y.meeting + (y.work ?? 0));
  const pickMonth = (mi: number) => {
    if (oneRow) return oneRow[mi] ?? 0;
    const m = monthly[mi];
    return line === 'team' ? teamOf(m) : line === 'project' ? m.project : m.meeting + m.work + m.project;
  };
  const pickYear = (y: { meeting: number; work?: number; project: number }) =>
    (line === 'team' ? teamOf(y) : line === 'project' ? y.project : y.meeting + (y.work ?? 0) + y.project);
  const meetingBudget = quarters.reduce((s, x) => s + x.budget, 0);
  const workBudget = Array.from({ length: 12 }, (_, i) => workBudgetOf(state, ym(CUR_YEAR, i)).amount).reduce((s, v) => s + v, 0);
  const teamBudget = teamSub === 'meeting' ? meetingBudget : teamSub === 'work' ? workBudget : meetingBudget + workBudget;
  const projectBudget = projects.filter(p => p.isMine).reduce((s, p) => s + p.allocPool, 0);
  // 연도별 예산은 올해만 보관 — 다른 연도는 잔액선 0
  const budget = !isCurYear && !oneProject ? 0 : oneProject ? oneProject.allocPool
    : line === 'team' ? teamBudget : line === 'project' ? projectBudget : meetingBudget + workBudget + projectBudget;
  const cumulative = Array.from({ length: lastMonth + 1 }, (_, i) => pickMonth(i)).reduce((s, v) => s + v, 0);

  const monthPts = (): Pt[] => {
    let run = 0;
    return monthly.map(m => {
      const past = m.month <= lastMonth;
      const exec = past ? pickMonth(m.month) : 0;
      run += exec;
      return { label: String(m.month + 1), exec, remain: Math.max(0, budget - run), past };
    });
  };
  const quarterPts = (): Pt[] => {
    let run = 0;
    return [0, 1, 2, 3].map(qi => {
      const ms = monthly.filter(m => Math.floor(m.month / 3) === qi && m.month <= lastMonth);
      const exec = ms.reduce((s, m) => s + pickMonth(m.month), 0);
      run += exec;
      return { label: `Q${qi + 1}`, exec, remain: Math.max(0, budget - run), past: ms.length > 0 };
    });
  };
  const yearRows = [
    ...YEARLY_HISTORY,
    {
      year: CUR_YEAR, meeting: state.monthly.reduce((s, m) => s + m.meeting, 0),
      work: state.monthly.reduce((s, m) => s + workUsedOf(state, ym(CUR_YEAR, m.month)), 0),
      project: state.monthly.reduce((s, m) => s + m.project, 0),
    },
  ] as { year: number; meeting: number; work?: number; project: number }[];
  // 과거 연도 예산은 보관하지 않으므로 올해만 잔액 표시. 단일 프로젝트는 올해 데이터만 있음
  const yearPts = (): Pt[] => oneRow
    ? [{ label: String(year), exec: cumulative, remain: Math.max(0, budget - cumulative), past: true }]
    : yearRows.map(y => ({
      label: String(y.year), exec: pickYear(y), past: true,
      remain: y.year === CUR_YEAR ? Math.max(0, budget - cumulative) : 0,
    }));

  const pts = period === 'month' ? monthPts() : period === 'quarter' ? quarterPts() : yearPts();
  const rawSel = period === 'month' ? selMonth : period === 'quarter' ? selQuarter : selYear;
  const sel = Math.min(rawSel, pts.length - 1);
  const onSelect = period === 'month' ? setSelMonth : period === 'quarter' ? setSelQuarter : setSelYear;
  const selPt = pts[sel];
  const selLabel = `${selPt?.label ?? ''}${period === 'month' ? '월' : period === 'year' ? '년' : ''}`;

  /* ── 운영일지: 일 ── */
  const renderDay = () => {
    const first = new Date(year, selMonth, 1).getDay();
    const days = new Date(year, selMonth + 1, 0).getDate();
    const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    while (cells.length % 7) cells.push(null);
    const key = ym(year, selMonth);
    const monthRecords = records.filter(r => r.date.startsWith(key));
    const txDays = new Set(monthRecords.map(r => Number(r.date.slice(8, 10))));
    const today = isCurYear && selMonth === CUR_MONTH ? TODAY.getDate() : -1;
    const dayRecords = selDay ? monthRecords.filter(r => Number(r.date.slice(8, 10)) === selDay) : [];
    return (
      <div>
        <StepNav variant="bar" label="달력 월" className="cal-nav" prevLabel="이전 달" nextLabel="다음 달"
          onPrev={() => { setSelMonth(p => Math.max(0, p - 1)); setSelDay(null); }} onNext={() => { setSelMonth(p => Math.min(navLast, p + 1)); setSelDay(null); }}
          prevDisabled={selMonth === 0} nextDisabled={selMonth >= navLast}>
          {year}년 {selMonth + 1}월
        </StepNav>
        <div className="cal-week">{WEEK.map(d => <div key={d}>{d}</div>)}</div>
        <div className="cal-days">
          {cells.map((d, i) => d === null ? <div key={i} /> : (
            <button key={i} type="button" onClick={() => setSelDay(selDay === d ? null : d)}
              className={cx('cal-day', d === today && 'is-today', selDay === d && 'is-sel', (i % 7 === 0) && 'is-sun')}
              aria-pressed={selDay === d} aria-label={`${selMonth + 1}월 ${d}일${txDays.has(d) ? ', 집행 있음' : ''}`}>
              {d}
              {txDays.has(d) && <i aria-hidden="true" />}
            </button>
          ))}
        </div>
        {selDay ? (
          <div className="day-list">
            <div className="day-list__title">{selMonth + 1}월 {selDay}일 집행 {dayRecords.length}건</div>
            {dayRecords.length === 0 && <div className="day-list__empty">이 날 등록된 집행이 없습니다</div>}
            {dayRecords.map(r => (
              <div key={r.id} className="day-list__row">
                <span>{r.type === 'meeting' ? '👥 팀 회의비' : r.type === 'work' ? '💼 팀 업무비' : `📁 ${projects.find(p => p.id === r.projectId)?.name ?? '프로젝트'}`}</span>
                <b>{fmt(r.total)}</b>
              </div>
            ))}
          </div>
        ) : <Triple flow={flowOf(selMonth)} />}
      </div>
    );
  };

  /* ── 운영일지: 월 ── */
  const renderMonth = () => (
    <div>
      <div className="cal-months">
        {monthly.map(m => {
          const isCur = isCurYear && m.month === CUR_MONTH;
          const f = flowOf(m.month);
          const plus = f.plan.team + f.plan.project, minus = f.exec.team + f.exec.project;
          return (
            <button key={m.month} type="button" onClick={() => setSelMonth(m.month)} aria-pressed={selMonth === m.month}
              className={cx('cal-month', isCur && 'is-cur', selMonth === m.month && 'is-sel', m.month > lastMonth && 'is-future')}>
              <span className="cal-month__name">{m.month + 1}월</span>
              {/* + 예산 배분 · − 집행 */}
              {(plus > 0 || minus > 0) && (
                <span className="cal-month__vals">
                  {plus > 0 && <span className="is-plus">+{fmtMan(plus)}</span>}
                  {minus > 0 && <span className="is-minus">−{fmtMan(minus)}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Triple big flow={flowOf(selMonth)} />
    </div>
  );

  /* ── 운영일지: 년 ── */
  const renderYear = () => (
    <div className="stack">
      {yearRows.slice(-2).map(y => {
        const idx = yearRows.indexOf(y);
        const isCur = y.year === CUR_YEAR;
        const teamExec = y.meeting + (y.work ?? 0);
        // 예산 배분(+)은 조회 중인 연도만 (월별 배분 합)
        const plus = y.year === year ? Array.from({ length: lastMonth + 1 }, (_, i) => { const p = planOf(i); return p.team + p.project; }).reduce((s, v) => s + v, 0) : 0;
        return (
          <button key={y.year} type="button" onClick={() => setSelYear(idx)} aria-pressed={selYear === idx}
            className={cx('cal-year', isCur && 'is-cur', selYear === idx && 'is-sel')}>
            <div className="row row--between">
              <span className="cal-year__name">{y.year}년 {isCur && <em>현재</em>}</span>
              <span className="cal-year__vals num">
                {plus > 0 && <span className="is-plus">+{fmt(plus)}</span>}
                <span className="is-minus">−{fmt(teamExec + y.project)}</span>
              </span>
            </div>
            <div className="cal-year__sub"><span>팀 운영 −{fmt(teamExec)}</span><span>프로젝트 −{fmt(y.project)}</span></div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="view-enter">
      <PageHead
        title="리포트" extra={<YearPicker />}
        actions={<Btn className="exec-cta" onClick={() => onNavigate('exec-new')}><IconPlus size={14} />집행 등록</Btn>}
      />

      {/* 모바일에서만 탭 — PC 는 한 페이지에서 모두 표시 */}
      <div className="report-tabs"><Tabs tabs={REPORT_TABS} active={tab} onSelect={setTab} /></div>
      <YearBar />

      <Card pad="lg" className={cx('report-sec report-sec--coins mb-20', tab === '보유 코웍-코인' && 'is-active')}>
        <div className="report-bar">
          <div>
            <h2 className="report-bar__title">보유 코웍-코인</h2>
          </div>
          <div className="report-bar__ctrls">
            <Segmented label="보유 코웍-코인 보기 형식" value={coinView} onChange={setCoinView}
              options={[{ value: 'card', label: '▦ 카드' }, { value: 'list', label: '☰ 리스트' }]} />
            <Segmented label="보유 코웍-코인 정렬" value={coinSort} onChange={changeSort}
              options={[
                { value: 'deadline', label: `기한 ${coinSort === 'deadline' ? (coinAsc ? '↑' : '↓') : ''}`.trim() },
                { value: 'rate', label: `집행률 ${coinSort === 'rate' ? (coinAsc ? '↑' : '↓') : ''}`.trim() },
              ]} />
          </div>
        </div>
        <div className={cx('coins', coinView === 'list' && 'is-list')}>
          {sortedCoins.map(c => {
            const p = pct(c.used, c.budget);
            return (
              <div key={c.key} className={cx('coin', !c.active && 'is-ended')}>
                <div className="coin__head">
                  <MTag endDate={c.endDate} active={c.active} size="lg" />
                  <div className="grow">
                    <div className="coin__label">{c.label}</div>
                    <div className="coin__rate">집행률 <b className={`is-${progVariant(p)}`}>{Math.round(p)}%</b></div>
                  </div>
                  <div className="coin__remain" title="잔액">{fmt(c.budget - c.used)}</div>
                </div>
                <ProgressBar value={p} variant={progVariant(p)} height={6} label={`${c.label} 집행률`} />
                <div className="coin__foot"><span>집행 {fmt(c.used)}</span><span>예산 {fmt(c.budget)}</span></div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid-2 report-grid">
        <Card pad="lg" className={cx('report-sec', tab === '운영일지' && 'is-active')}>
          <div className="report-bar">
            <div>
              <h2 className="report-bar__title">운영일지</h2>
              <span className="report-bar__mdesc">{year}년 + 예산 배분 · − 집행</span>
            </div>
            <Segmented label="운영일지 단위" value={calView} onChange={v => { setCalView(v); setSelDay(null); }}
              options={[{ value: 'day', label: '일' }, { value: 'month', label: '월' }, { value: 'year', label: '년' }]} />
          </div>
          {calView === 'day' && renderDay()}
          {calView === 'month' && renderMonth()}
          {calView === 'year' && renderYear()}
        </Card>

        <Card pad="lg" className={cx('report-sec', tab === '차트' && 'is-active')}>
          <div className="report-bar">
            <div>
              <h2 className="report-bar__title">차트</h2>
              <span className="report-bar__mdesc">예산 · 집행 추이</span>
            </div>
            <Segmented label="차트 기간" value={period} onChange={setPeriod}
              options={[{ value: 'month', label: '월' }, { value: 'quarter', label: '분기' }, { value: 'year', label: '년' }]} />
          </div>
          <div className="chart-filter">
            <div className="chip-row">
              {([['total', '전체'], ['team', '팀 운영'], ['project', '프로젝트']] as const).map(([v, label]) => (
                <FilterChip key={v} label={label} active={line === v} onClick={() => { setLine(v); setProjectId(ALL); setTeamSub('all'); }} />
              ))}
            </div>
            {/* 팀 운영: 회의비 · 업무비 목록 */}
            {line === 'team' && (
              <Select size="sm" className="chart-filter__select" value={teamSub} onChange={e => setTeamSub(e.target.value as TeamSub)} aria-label="팀 운영 항목 선택">
                {TEAM_SUBS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            )}
            {line === 'project' && (
              <Select size="sm" className="chart-filter__select" value={projectId} onChange={e => setProjectId(e.target.value)}
                aria-label={`${year}년 프로젝트 선택`}>
                <option value={ALL}>{year}년 전체 프로젝트</option>
                {yearProjects.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (종료)'}</option>)}
              </Select>
            )}
          </div>
          <div className="chart-total">
            {oneProject ? oneProject.name : `${year}년${line === 'team' ? ' ' + TEAM_SUBS.find(o => o.value === teamSub)!.label : ''}`} 누적 <b className="num">{fmt(cumulative)}</b>
            {oneProject && <span className="chart-total__sub"> / 예산 {fmt(oneProject.allocPool)}</span>}
          </div>
          <LineChart pts={pts} sel={sel} onSelect={onSelect} />
          <div className="chart-legend">
            <span><i className="is-remain" />예산</span>
            <span><i className="is-exec" />집행 비용</span>
          </div>
          <div className="chart-cards">
            <div className="chart-card chart-card--remain">
              <span>{selLabel} 예산</span>
              <b className="num">{selPt && selPt.remain > 0 ? fmt(selPt.remain) : '—'}</b>
              <small>누적 집행 후 잔액</small>
            </div>
            <div className="chart-card chart-card--exec">
              <span>{selLabel} 집행 금액</span>
              <b className="num">{selPt && selPt.exec > 0 ? fmt(selPt.exec) : '—'}</b>
              <small>{period === 'month' ? '해당 월 사용액' : period === 'quarter' ? '해당 분기 사용액' : '해당 연도 사용액'}</small>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
