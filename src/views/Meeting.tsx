import { useEffect, useState } from 'react';
import { onFocusRequest, takeFocus } from '@/lib/search';
import type { QuarterData, View } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { CUR_QUARTER, CUR_YEAR, parseYm, quarterOf } from '@/lib/date';
import { fmt, pct } from '@/lib/format';
import { useToast } from '@/hooks/useToast';
import { Alert, Btn, Card, PageHead, ProgressBar, SectionHead, TableWrap, Tabs, Toast, cx, progVariant } from '@/components/ui';
import { IconPlus } from '@/components/icons';
import Donut from '@/components/Donut';
import YearPicker, { YearBar } from '@/components/layout/YearPicker';
import { useViewYear } from '@/lib/viewYear';
import WorkBudget from './WorkBudget';
import './Meeting.css';

/** 선택 분기 직전의 마지막 입력 인원(전월) — 없으면 0 */
function prevMonthCount(quarters: QuarterData[], qi: number): { count: number; month: string } {
  for (let i = qi - 1; i >= 0; i--) {
    const hc = quarters[i].headcounts;
    for (let m = hc.length - 1; m >= 0; m--) if (hc[m] > 0) return { count: hc[m], month: quarters[i].months[m] };
  }
  return { count: 0, month: '' };
}
/** 저장된 적 없는(전부 0) 분기는 전월 인원 수를 3개월 모두의 기본값으로 */
function initialCounts(quarters: QuarterData[], qi: number): number[] {
  const hc = quarters[qi].headcounts;
  if (hc.some(h => h > 0)) return [...hc];
  const { count } = prevMonthCount(quarters, qi);
  return hc.map(() => count);
}

/** 팀 운영 = 팀 회의비 · 팀 업무비 (고정 2개) */
const TEAM_TABS = ['팀 회의비', '팀 업무비'] as const;
type TeamTab = (typeof TEAM_TABS)[number];
/** 메뉴로 들어오면 항상 첫 탭 — 다른 화면에서 특정 탭으로 보낼 때만 한 번 지정 (예: 홈 '업무비 관리 →') */
let pendingTab: TeamTab | null = null;
export const openTeamTab = (t: TeamTab) => { pendingTab = t; };

const isTeamTab = (t: string) => (TEAM_TABS as readonly string[]).includes(t);

export default function Meeting({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { quarters, meetingRate, records } = useAppState();
  const dispatch = useDispatch();
  // 검색 이동: 분기 행 선택·강조
  const [flashQ, setFlashQ] = useState<number | null>(() => { const id = takeFocus('quarter'); return id == null ? null : Number(id); });
  const [selected, setSelected] = useState(flashQ ?? CUR_QUARTER);
  const [headcounts, setHeadcounts] = useState(() => initialCounts(quarters, flashQ ?? CUR_QUARTER));
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<TeamTab>(() => (takeFocus('tab', isTeamTab) as TeamTab | null) ?? (flashQ != null ? '팀 회의비' : null) ?? pendingTab ?? TEAM_TABS[0]);
  useEffect(() => { pendingTab = null; }, []);
  const [viewYear] = useViewYear();
  // 분기 예산·인원은 올해만 기록됨 → 다른 연도는 집행 이력에서 분기별 집행액만 계산해 보여줌
  const isCurYear = viewYear === CUR_YEAR;
  const shownQuarters: QuarterData[] = isCurYear ? quarters : quarters.map((qd, qi) => ({
    ...qd, headcounts: qd.headcounts.map(() => 0), budget: 0,
    used: records.filter(r => {
      if (r.type !== 'meeting') return false;
      const { year, month } = parseYm(r.month);
      return year === viewYear && quarterOf(month) === qi;
    }).reduce((t, r) => t + r.total, 0),
  }));

  const q = quarters[selected];
  const simBudget = headcounts.reduce((s, n) => s + n * meetingRate, 0);
  const dirty = headcounts.some((h, i) => h !== q.headcounts[i]);
  // 저장 전 분기에 전월 인원이 자동 입력된 상태
  const unsaved = q.headcounts.every(h => h === 0);
  const prev = prevMonthCount(quarters, selected);
  const autoFilled = unsaved && prev.count > 0;

  const select = (i: number) => {
    setSelected(i);
    setHeadcounts(initialCounts(quarters, i));
  };
  // 이미 열린 화면에서 검색 이동
  useEffect(() => onFocusRequest('tab', t => { if (!isTeamTab(t)) return false; setTab(t as TeamTab); }));
  useEffect(() => onFocusRequest('quarter', id => { setTab('팀 회의비'); select(Number(id)); setFlashQ(Number(id)); }));
  useEffect(() => {
    if (flashQ == null) return;
    document.querySelector(`[data-quarter="${flashQ}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashQ(null), 1800);
    return () => window.clearTimeout(t);
  }, [flashQ]);
  const setAt = (i: number, n: number) => setHeadcounts(prev => prev.map((h, j) => (j === i ? Math.max(0, Math.min(999, n)) : h)));
  const save = () => {
    dispatch({ type: 'SAVE_HEADCOUNTS', quarterIdx: selected, headcounts });
    showToast(`${q.label} 인원이 저장되었습니다!`);
  };

  return (
    <div className="view-enter">
      <Toast msg={toast} />
      <PageHead
        title="팀 운영" extra={<YearPicker />}
        actions={<Btn className="exec-cta" onClick={() => onNavigate('exec-new')}><IconPlus size={14} />집행 등록</Btn>}
      />

      <Tabs tabs={TEAM_TABS} active={tab} onSelect={setTab} />
      <YearBar />

      {tab === '팀 업무비' ? <WorkBudget key={viewYear} onToast={showToast} /> : (<>
      <Card className="card--clip mb-20">
        <TableWrap>
          <table className="table q-table">
            <thead>
              {/* 모바일(≤1024)에서는 기준 수량·집행액 열 숨김 */}
              <tr>{['분기', '기준 수량', '예산', '집행액', '잔액', '집행률'].map(h => (
                <th key={h} className={cx((h === '기준 수량' || h === '집행액') && 'hide-mobile')}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {shownQuarters.map((qd, i) => {
                const p = pct(qd.used, qd.budget);
                const entered = qd.headcounts.some(h => h > 0);
                return (
                  <tr key={qd.quarter} data-quarter={i} className={cx('is-clickable', selected === i && 'is-selected', flashQ === i && 'is-flash')}
                    onClick={() => select(i)} tabIndex={0} aria-selected={selected === i}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } }}>
                    <td className="t-center">
                      <div className="row t-strong t-nowrap">
                        {qd.label}
                        {isCurYear && i === CUR_QUARTER && <span className="q-now">현재</span>}
                      </div>
                    </td>
                    <td className="t-center t-muted t-nowrap hide-mobile">
                      {entered ? `${qd.headcounts.join(' / ')}명` : isCurYear ? <span className="q-missing">미입력</span> : '—'}
                    </td>
                    <td className="t-right t-strong t-nowrap">{qd.budget > 0 ? fmt(qd.budget) : '—'}</td>
                    <td className="t-right t-muted t-nowrap hide-mobile">{qd.used > 0 ? fmt(qd.used) : '—'}</td>
                    <td className={cx('t-right t-strong t-nowrap', qd.budget > 0 && (qd.budget - qd.used >= 0 ? 'text-success' : 'text-danger'))}>
                      {qd.budget > 0 ? fmt(qd.budget - qd.used) : '—'}
                    </td>
                    <td className="q-rate q-rate--donut">
                      {qd.budget > 0 ? (<>
                        <div className="row q-rate__bar">
                          <div className="grow"><ProgressBar value={p} variant={progVariant(p)} height={6} /></div>
                          <span className="q-rate__pct">{Math.round(p)}%</span>
                        </div>
                        <div className="q-rate__donut"><Donut used={qd.used} budget={qd.budget} /></div>
                      </>) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {(() => {
              const budget = shownQuarters.reduce((t, x) => t + x.budget, 0), used = shownQuarters.reduce((t, x) => t + x.used, 0);
              return (
                <tfoot>
                  <tr className="q-total">
                    <td className="t-center">합계</td>
                    <td className="t-center t-muted hide-mobile">—</td>
                    <td className="t-right t-nowrap">{budget > 0 ? fmt(budget) : '—'}</td>
                    <td className="t-right t-nowrap hide-mobile">{used > 0 ? fmt(used) : '—'}</td>
                    <td className={cx('t-right t-nowrap', budget > 0 && budget - used < 0 && 'text-danger')}>{budget > 0 ? fmt(budget - used) : '—'}</td>
                    <td className="q-rate"><span className="q-total__pct">{budget > 0 ? `${Math.round(pct(used, budget))}%` : '—'}</span></td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </TableWrap>
      </Card>

      {!isCurYear ? (
        <Alert variant="info">
          <strong>{viewYear}년 팀 회의비</strong>
          분기 인원·예산은 올해({CUR_YEAR}년)만 관리되어, {viewYear}년은 집행 이력의 분기별 집행액만 보여줍니다. 인원 입력은 올해에서 할 수 있습니다.
        </Alert>
      ) : (
      <div className="grid-2">
        <Card pad="lg">
          <SectionHead title={`${q.label}${selected === CUR_QUARTER ? ' (현재)' : ''} 팀 인원 정보`} />
          <div className="label mb-14 hc-label">
            <span>월별 팀 인원 수</span>
            {autoFilled && <span className="hc-auto">저장 전 · 전월({prev.month}) {prev.count}명 자동 입력</span>}
          </div>
          <div className="hc-list">
            {q.months.map((month, i) => (
              <div key={month} className="hc-row">
                <label className="hc-row__month" htmlFor={`hc-${i}`}>{month}</label>
                <div className="stepper">
                  <button type="button" onClick={() => setAt(i, headcounts[i] - 1)} aria-label={`${month} 인원 감소`}>−</button>
                  {/* 숫자만 입력 (모바일 숫자 키패드) — 숫자 외 문자는 제거 */}
                  <input id={`hc-${i}`} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={3}
                    value={String(headcounts[i])} onFocus={e => e.target.select()}
                    onChange={e => setAt(i, Number(e.target.value.replace(/\D/g, '')) || 0)} />
                  <button type="button" onClick={() => setAt(i, headcounts[i] + 1)} aria-label={`${month} 인원 증가`}>+</button>
                </div>
                <span className="hc-row__unit">명</span>
              </div>
            ))}
          </div>
          <Btn block onClick={save} disabled={!dirty}>{dirty ? '저장' : '저장됨'}</Btn>
        </Card>

        <Card pad="lg">
          <SectionHead title="예산 산정 시뮬레이터" />
          <div className="sim">
            <div className="sim__label">예상 예산</div>
            <div className="sim__value num">{fmt(simBudget)}</div>
            <div className="sim__sub">{q.label} 합계</div>
          </div>
          <div className="sim__formula">
            {headcounts.map((h, i) => `${q.months[i]} ${h}명`).join(' + ')}
            <br />× {meetingRate.toLocaleString('ko-KR')}원 = <strong>{fmt(simBudget)}</strong>
          </div>
          <Alert variant="info">
            <strong>예산 산정 기준</strong>
            월별 인원수 × <b>{meetingRate.toLocaleString('ko-KR')}원</b>을 분기 3개월치 합산합니다.
          </Alert>
        </Card>
      </div>
      )}
      </>)}
    </div>
  );
}
