import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { CUR_MONTH, CUR_YEAR, ym } from '@/lib/date';
import { fmt, pct } from '@/lib/format';
import { workBudgetOf, workUsedOf } from '@/lib/budget';
import { useViewYear } from '@/lib/viewYear';
import { onFocusRequest, takeFocus } from '@/lib/search';
import { Alert, AmountInput, Btn, Card, ConfirmLayer, ProgressBar, TableWrap, cx, progVariant } from '@/components/ui';

interface Pending { month: string; from: number; to: number }

/**
 * 팀 운영 › 팀 업무비 — 월별 예산 (이월 없음)
 * - 입력하지 않은 달은 이전 달 금액을 그대로 씀
 * - 수정: 행 선택 → 선택된 행의 예산을 한 번 더 누르면 바로 수정 (집행 현황과 같은 방식)
 * - 저장 전에 "이후 달 예산에도 반영할까요?" → 예: 이후 달도 / 아니오: 이 달만
 */
export default function WorkBudget({ onToast }: { onToast: (msg: string) => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [year] = useViewYear();
  const months = Array.from({ length: 12 }, (_, i) => ym(year, i));
  // 검색 이동: 그 달 행 선택·강조 (월 = 'YYYY-MM', 조회 연도는 이동 전에 맞춰 둠)
  const [flashM, setFlashM] = useState<number | null>(() => {
    const id = takeFocus('work', m => m.startsWith(`${year}-`));
    return id == null ? null : Number(id.slice(5, 7)) - 1;
  });
  const [selected, setSelected] = useState(() => flashM ?? (year === CUR_YEAR ? CUR_MONTH : 0));
  useEffect(() => onFocusRequest('work', m => {
    if (!m.startsWith(`${year}-`)) return false;
    const i = Number(m.slice(5, 7)) - 1;
    setSelected(i); setFlashM(i);
  }));
  useEffect(() => {
    if (flashM == null) return;
    document.querySelector(`[data-work-month="${flashM}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlashM(null), 1800);
    return () => window.clearTimeout(t);
  }, [flashM]);
  const [edit, setEdit] = useState<{ month: string; value: number } | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [pending, setPending] = useState<Pending | null>(null);

  const rows = months.map(m => {
    const budget = workBudgetOf(state, m).amount, used = workUsedOf(state, m);
    return { m, budget, used, remain: budget - used };
  });
  const total = rows.reduce((s, r) => ({ budget: s.budget + r.budget, used: s.used + r.used }), { budget: 0, used: 0 });
  const totalRate = pct(total.used, total.budget);
  const mLabel = (m: string) => `${Number(m.slice(5, 7))}월`;

  // 확인 팝업: Esc = 취소
  useEffect(() => {
    if (!pending) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setPending(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [pending]);

  // 처음 누르면 선택, 선택된 행의 예산을 한 번 더 누르면 수정
  const onRow = (i: number, budgetCell = false) => {
    if (edit?.month === months[i]) return;
    if (selected !== i) { setSelected(i); setEdit(null); return; }
    if (budgetCell) { setPending(null); setEdit({ month: months[i], value: rows[i].budget }); }
  };
  const commit = () => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    setEdit(null);
    const from = workBudgetOf(state, e.month).amount;
    if (e.value === from) return;
    setPending({ month: e.month, from, to: e.value });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editRef.current = null; setEdit(null); }
  };
  const apply = (scope: 'after' | 'only') => {
    if (!pending) return;
    dispatch({ type: 'SAVE_WORK_BUDGET', month: pending.month, amount: pending.to, scope });
    onToast(scope === 'after'
      ? `${mLabel(pending.month)}부터 이후 달까지 업무비 예산이 ${fmt(pending.to)}으로 변경되었습니다!`
      : `${mLabel(pending.month)} 업무비 예산만 ${fmt(pending.to)}으로 변경되었습니다!`);
    setPending(null);
  };

  return (
    <>
      {/* 예산 변경 확인 — 화면(뷰포트) 아래쪽에 뜨는 레이어 팝업 */}
      {pending && (
        <ConfirmLayer title={`${mLabel(pending.month)} 업무비 예산 변경`} confirmLabel="예 (이후 달도)"
          onConfirm={() => apply('after')} onCancel={() => setPending(null)}
          extra={<Btn variant="secondary" size="sm" onClick={() => apply('only')}>아니오 (이 달만)</Btn>}>
          {fmt(pending.from)} → <b>{fmt(pending.to)}</b>으로 변경합니다. 이후 달 예산에도 반영할까요?
        </ConfirmLayer>
      )}
      <p className="work-hint">목록에서 수정할 월을 선택하고, 예산 항목을 한 번 더 누르면 쉽고 빠른 예산 변경이 가능합니다.</p>

      <Card className="card--clip mb-20">
        <TableWrap>
          <table className="table q-table work-table">
            <thead>
              <tr>{['월', '예산', '집행액', '잔액', '집행률'].map(h => (
                <th key={h} className={cx(h === '집행액' && 'hide-mobile')}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = pct(r.used, r.budget);
                const isCur = year === CUR_YEAR && i === CUR_MONTH;
                const editing = edit?.month === r.m;
                return (
                  <tr key={r.m} data-work-month={i} className={cx('is-clickable', selected === i && 'is-selected', flashM === i && 'is-flash')}
                    onClick={() => onRow(i)} tabIndex={0} aria-selected={selected === i}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRow(i, selected === i); } }}>
                    <td className="t-center">
                      <div className="row t-strong t-nowrap">
                        {i + 1}월
                        {isCur && <span className="q-now">현재</span>}
                      </div>
                    </td>
                    <td className="t-right t-strong t-nowrap work-table__budget" onClick={e => { e.stopPropagation(); onRow(i, true); }}>
                      {editing
                        ? <AmountInput autoFocus value={edit.value} aria-label={`${i + 1}월 업무비 예산`}
                            onChange={v => setEdit(x => (x ? { ...x, value: v } : x))} onBlur={commit} onKeyDown={keys} />
                        : <span>{r.budget > 0 ? fmt(r.budget) : '—'}</span>}
                    </td>
                    <td className="t-right t-muted t-nowrap hide-mobile">{r.used > 0 ? fmt(r.used) : '—'}</td>
                    <td className={cx('t-right t-strong t-nowrap', r.remain >= 0 ? 'text-success' : 'text-danger')}>
                      {r.budget > 0 || r.used > 0 ? fmt(r.remain) : '—'}
                    </td>
                    <td className="q-rate q-rate--pct">
                      {r.budget > 0 ? (
                        <div className="row">
                          <div className="grow"><ProgressBar value={p} variant={progVariant(p)} height={6} /></div>
                          <span className="q-rate__pct">{Math.round(p)}%</span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="q-total">
                <td className="t-center">합계</td>
                <td className="t-right t-nowrap">{fmt(total.budget)}</td>
                <td className="t-right t-nowrap hide-mobile">{fmt(total.used)}</td>
                <td className={cx('t-right t-nowrap', total.budget - total.used < 0 && 'text-danger')}>{fmt(total.budget - total.used)}</td>
                <td className="q-rate"><span className="q-total__pct">{Math.round(totalRate)}%</span></td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>

      <Alert variant="info">
        <strong>팀 업무비 기준</strong>
        달마다 예산을 정하고(입력하지 않은 달은 이전 달 금액), 사용일자가 속한 달의 예산에서 차감됩니다. 남은 금액은 다음 달로 이월되지 않습니다.
        <span className="show-mobile-inline"> 월을 누른 뒤 예산을 한 번 더 누르면 바로 수정됩니다.</span>
      </Alert>
    </>
  );
}
