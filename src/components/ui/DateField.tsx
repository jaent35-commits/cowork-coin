import { useEffect, useRef, useState } from 'react';
import { IconCalendar } from '../icons';
import { Popover } from './Popover';
import { StepNav } from './StepNav';
import { cx } from '.';
import { TODAY } from '@/lib/date';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => toKey(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());

/** YYYY-MM-DD 값을 고르는 버튼 + 팝업 달력 (네이티브 date 입력 대체) */
export function DateField({ value, onChange, id, placeholder = 'YYYY-MM-DD', defaultOpen, onClose, ...rest }: {
  value: string; onChange: (v: string) => void; id?: string; placeholder?: string; 'aria-label'?: string;
  /** 표 안 바로 수정: 나타나자마자 달력 열기 */
  defaultOpen?: boolean;
  /** 달력이 닫힐 때 (선택·바깥 클릭·Esc) */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const base = value ? new Date(`${value}T00:00:00`) : TODAY;
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const btn = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open) { const b = value ? new Date(`${value}T00:00:00`) : TODAY; setView({ y: b.getFullYear(), m: b.getMonth() }); }
    setOpen(v => !v);
  };
  const shift = (d: number) => setView(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const close = () => { setOpen(false); onClose?.(); };
  const pick = (k: string) => { onChange(k); close(); btn.current?.focus(); };
  useEffect(() => { if (defaultOpen) btn.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayKey();

  return (
    <div className="month-field">
      <button ref={btn} type="button" id={id} className={cx('month-field__btn', !value && 'is-empty', open && 'is-open')}
        onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label={rest['aria-label'] ? `${rest['aria-label']} 선택` : undefined}>
        <span>{value || placeholder}</span>
        <IconCalendar size={14} />
      </button>
      <Popover anchor={btn} open={open} onClose={close} className="date-picker" label="날짜 선택">
        <StepNav variant="bar" label="달" prevLabel="이전 달" nextLabel="다음 달" onPrev={() => shift(-1)} onNext={() => shift(1)}>
          {view.y}년 {view.m + 1}월
        </StepNav>
        <div className="date-picker__week" aria-hidden="true">
          {WEEK.map((w, i) => <span key={w} className={cx(i === 0 && 'is-sun', i === 6 && 'is-sat')}>{w}</span>)}
        </div>
        <div className="date-picker__grid" role="grid">
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />;
            const k = toKey(view.y, view.m, d);
            return (
              <button key={k} type="button" onClick={() => pick(k)} aria-label={`${view.m + 1}월 ${d}일`} aria-pressed={k === value}
                className={cx('date-picker__day', i % 7 === 0 && 'is-sun', i % 7 === 6 && 'is-sat', k === today && 'is-today', k === value && 'is-selected')}>
                {d}
              </button>
            );
          })}
        </div>
        <div className="date-picker__foot">
          <button type="button" onClick={() => pick(today)}>오늘</button>
          {value && <button type="button" onClick={() => pick('')}>지우기</button>}
        </div>
      </Popover>
    </div>
  );
}
