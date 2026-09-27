import { useRef, useState, type ReactNode } from 'react';
import { IconBack, IconForward } from '../icons';
import { Popover } from './Popover';
import { CUR_YEAR } from '@/lib/date';
import { cx } from '.';

/**
 * ‹ 값 › 이동 버튼 (연도·월·달력 머리 공통)
 * - pill: 테두리 있는 알약형 (조회 연도·기간)
 * - bar: 폭 전체, 양 끝에 화살표 (달력·월 선택 팝업 머리)
 * - picker: 값을 누르면 뜨는 선택 팝업 (연도 목록·월 달력) — close 를 불러 닫음
 */
export function StepNav({ label, children, onPrev, onNext, prevDisabled, nextDisabled, prevLabel = '이전', nextLabel = '다음', variant = 'pill', className, picker }: {
  label: string; children: ReactNode; onPrev: () => void; onNext: () => void;
  prevDisabled?: boolean; nextDisabled?: boolean; prevLabel?: string; nextLabel?: string;
  variant?: 'pill' | 'bar'; className?: string; picker?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <div ref={box} className={cx('step-nav', `step-nav--${variant}`, open && 'is-open', className)} role="group" aria-label={label}>
      <button type="button" className="step-nav__btn" onClick={onPrev} disabled={prevDisabled} aria-label={prevLabel}><IconBack size={15} /></button>
      {picker ? (
        <button ref={btn} type="button" className="step-nav__value is-pick" aria-live="polite"
          aria-haspopup="dialog" aria-expanded={open} aria-label={`${label} 선택`} onClick={() => setOpen(v => !v)}>
          {children}
        </button>
      ) : <span className="step-nav__value" aria-live="polite">{children}</span>}
      <button type="button" className="step-nav__btn" onClick={onNext} disabled={nextDisabled} aria-label={nextLabel}><IconForward size={15} /></button>
      {picker && (
        <Popover anchor={box} open={open} onClose={() => setOpen(false)} className="month-picker" label={`${label} 선택`}>
          {picker(close)}
        </Popover>
      )}
    </div>
  );
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

/** 연도 목록 팝업 내용 (3열) — min~max 범위만 */
export function YearGrid({ value, min, max, onPick }: { value: number; min: number; max: number; onPick: (y: number) => void }) {
  const years = Array.from({ length: Math.max(1, max - min + 1) }, (_, i) => min + i);
  return (
    <div className="month-picker__grid month-picker__grid--year">
      {years.map(y => (
        <button key={y} type="button" className={cx('month-picker__cell', y === value && 'is-selected')}
          aria-pressed={y === value} onClick={() => onPick(y)}>
          {y}년
        </button>
      ))}
    </div>
  );
}

/** 월 달력 팝업 내용 [‹ 연도 ›] + 12개월 — value/min/max 는 'YYYY-MM', 범위 밖 달은 비활성 */
export function MonthGrid({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (v: string) => void }) {
  const [year, setYear] = useState(() => value ? Number(value.slice(0, 4)) : CUR_YEAR);
  const minY = min ? Number(min.slice(0, 4)) : -Infinity;
  const maxY = max ? Number(max.slice(0, 4)) : Infinity;
  return (
    <>
      <StepNav variant="bar" label="연도" prevLabel="이전 연도" nextLabel="다음 연도"
        onPrev={() => setYear(y => y - 1)} onNext={() => setYear(y => y + 1)} prevDisabled={year <= minY} nextDisabled={year >= maxY}>
        {year}년
      </StepNav>
      <div className="month-picker__grid">
        {Array.from({ length: 12 }, (_, i) => {
          const v = ym(year, i + 1);
          const off = (!!min && v < min) || (!!max && v > max);
          return (
            <button key={v} type="button" disabled={off} aria-pressed={v === value}
              className={cx('month-picker__cell', v === value && 'is-selected')} onClick={() => onPick(v)}>
              {i + 1}월
            </button>
          );
        })}
      </div>
    </>
  );
}
