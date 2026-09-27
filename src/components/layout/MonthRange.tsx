import { CUR_YYYYMM } from '@/lib/date';
import { MonthGrid, StepNav, cx } from '../ui';

/** 'YYYY-MM' 에서 d 개월 이동 */
export function shiftYm(v: string, d: number): string {
  const [y, m] = v.split('-').map(Number);
  const t = new Date(y, m - 1 + d, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

const label = (v: string) => `${v.slice(0, 4)}.${v.slice(5, 7)}`;

/** ‹ 2026.09 › — 연도 선택(YearPicker)과 같은 모양으로 한 달씩 이동 */
function MonthStep({ value, onChange, min, max, name }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; name: string;
}) {
  return (
    <StepNav label={name} className="month-step" prevLabel={`${name} 이전 달`} nextLabel={`${name} 다음 달`}
      onPrev={() => onChange(shiftYm(value, -1))} onNext={() => onChange(shiftYm(value, 1))}
      prevDisabled={!!min && value <= min} nextDisabled={!!max && value >= max}
      picker={close => <MonthGrid value={value} min={min} max={max} onPick={v => { onChange(v); close(); }} />}>
      {label(value)}
    </StepNav>
  );
}

/**
 * 조회 기간 ‹ 시작월 › ~ ‹ 종료월 ›
 * - 시작월을 종료월 뒤로 넘기면 종료월도 같이, 종료월을 시작월 앞으로 넘기면 시작월도 같이 이동
 * - 이번 달이 아니면 [이번 달] 로 되돌리기
 */
export default function MonthRange({ start, end, onChange, min, max, className }: {
  start: string; end: string; onChange: (start: string, end: string) => void; min?: string; max?: string; className?: string;
}) {
  const isCur = start === CUR_YYYYMM && end === CUR_YYYYMM;
  return (
    <div className={cx('month-range', className)} role="group" aria-label="조회 기간">
      <MonthStep name="시작월" value={start} min={min} max={max} onChange={s => onChange(s, s > end ? s : end)} />
      <span className="month-range__sep" aria-hidden="true">~</span>
      <MonthStep name="종료월" value={end} min={min} max={max} onChange={e => onChange(e < start ? e : start, e)} />
      {!isCur && (
        <button type="button" className="month-range__reset" onClick={() => onChange(CUR_YYYYMM, CUR_YYYYMM)}>이번 달</button>
      )}
    </div>
  );
}
