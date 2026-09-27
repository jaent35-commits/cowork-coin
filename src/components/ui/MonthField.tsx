import { useRef, useState } from 'react';
import { IconCalendar } from '../icons';
import { cx } from '.';
import { Popover } from './Popover';
import { MonthGrid } from './StepNav';

/** YYYY-MM 값을 고르는 버튼 + 팝업 월 선택기 (월 달력은 조회 기간 선택과 같은 MonthGrid) */
export function MonthField({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  return (
    <div className="month-field">
      {label && <span className="label">{label}</span>}
      <button ref={btn} type="button" className={cx('month-field__btn', !value && 'is-empty', open && 'is-open')}
        onClick={() => setOpen(v => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label={label ? `${label} 선택` : '월 선택'}>
        <span>{value || 'YYYY-MM'}</span>
        <IconCalendar size={14} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} className="month-picker" label="월 선택">
        <MonthGrid value={value} onPick={v => { onChange(v); setOpen(false); btn.current?.focus(); }} />
      </Popover>
    </div>
  );
}
