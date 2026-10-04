import { useEffect, useRef, useState } from 'react';
import { IconCalendar } from '../icons';
import { Popover } from './Popover';
import { StepNav } from './StepNav';
import { cx } from '.';
import { TODAY } from '@/lib/date';
import { useDigitCaret } from './useDigitCaret';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => toKey(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());

/** 입력한 숫자 → 'YYYY', 'YYYY-MM', 'YYYY-MM-DD' (최대 8자리) */
const typed = (s: string) => {
  const d = s.replace(/\D/g, '').slice(0, 8);
  return d.length <= 4 ? d : d.length <= 6 ? `${d.slice(0, 4)}-${d.slice(4)}` : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
};
/** 'YYYY-MM-DD' 가 실제 있는 날짜인지 */
const isValidDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return y >= 1900 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};

/**
 * YYYY-MM-DD 날짜 입력 — 숫자로 바로 입력(20260930 → 2026-09-30) + 달력 버튼
 * 8자리가 맞는 날짜가 되면 바로 반영, 잘못된 값은 칸을 벗어날 때 원래 값으로 되돌림
 */
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
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const box = useRef<HTMLDivElement>(null);
  const caret = useDigitCaret();

  const toggle = () => {
    if (!open) { const b = isValidDate(text) ? new Date(`${text}T00:00:00`) : value ? new Date(`${value}T00:00:00`) : TODAY; setView({ y: b.getFullYear(), m: b.getMonth() }); }
    setOpen(v => !v);
  };
  const shift = (d: number) => setView(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const close = () => { setOpen(false); onClose?.(); };
  const pick = (k: string) => { setText(k); onChange(k); close(); caret.ref.current?.focus(); };
  const type = (raw: string) => {
    const v = typed(raw);
    setText(v);
    if (isValidDate(v) && v !== value) onChange(v);
  };
  // 칸을 벗어날 때: 비우면 지우기, 덜 입력했거나 없는 날짜면 원래 값으로
  const settle = () => {
    if (!text) { if (value) onChange(''); return; }
    if (!isValidDate(text)) setText(value);
  };
  useEffect(() => { if (defaultOpen) caret.ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayKey();

  return (
    <div className="month-field">
      <div ref={box} className={cx('month-field__btn month-field__box', !text && 'is-empty', open && 'is-open', text && !isValidDate(text) && 'is-partial')}>
        <input ref={caret.ref} id={id} className="month-field__input" inputMode="numeric" autoComplete="off" maxLength={10}
          placeholder={placeholder} value={text} aria-label={rest['aria-label']}
          onChange={e => { caret.mark(e.target); type(e.target.value); }}
          onBlur={settle}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); settle(); if (open) close(); }
            else if (e.key === 'Escape' && !open) setText(value);
          }} />
        <button type="button" className="month-field__cal" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
          aria-label={rest['aria-label'] ? `${rest['aria-label']} 달력` : '달력 열기'}>
          <IconCalendar size={14} />
        </button>
      </div>
      <Popover anchor={box} open={open} onClose={close} className="date-picker" label="날짜 선택">
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
