import { Children, isValidElement, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { IconChevron } from '../icons';
import { Popover } from './Popover';
import { cx } from '.';

interface Opt { value: string; label: ReactNode; disabled?: boolean; group?: string }

/** <option> 자식 요소를 읽어 목록으로 (Fragment·배열 포함, <optgroup label> 은 묶음 제목) */
function readOptions(children: ReactNode, group?: string): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, ch => {
    if (!isValidElement(ch)) return;
    const el = ch as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
    // value 가 없으면 네이티브처럼 글자를 값으로
    if (el.type === 'option') out.push({ value: String(el.props.value ?? (typeof el.props.children === 'string' ? el.props.children : '')), label: el.props.children, disabled: el.props.disabled, group });
    else if (el.type === 'optgroup') out.push(...readOptions(el.props.children, el.props.label));
    else if (el.props.children) out.push(...readOptions(el.props.children, group));
  });
  return out;
}

export interface SelectProps {
  value?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  className?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /** 트리거의 기본 화살표 숨김 (화면에 따로 아이콘이 있을 때) */
  hideChevron?: boolean;
  /** 크기: md(입력칸 40px, 기본) / sm(필터용 33px — 칩·작은 버튼과 같은 높이) */
  size?: 'sm' | 'md';
  /** 트리거 모양: 입력칸(기본) / 트리거 클래스를 직접 지정 */
  bare?: boolean;
  /** 표 안 바로 수정: 나타나자마자 목록 열기 */
  defaultOpen?: boolean;
  /** 목록이 닫힐 때 (선택·바깥 클릭·Esc·Tab) */
  onClose?: () => void;
  /** 목록 팝업 추가 클래스 */
  popClassName?: string;
}

/**
 * 네이티브 <select> 대신 디자인에 맞춘 드롭다운 목록.
 * 사용법은 <select> 와 같음 — <option> 자식, value, onChange(e.target.value)
 */
export function Select({ value, onChange, children, className, id, disabled, size = 'md', hideChevron, bare, defaultOpen, onClose, popClassName, ...rest }: SelectProps) {
  const opts = readOptions(children);
  const cur = String(value ?? '');
  const selected = opts.find(o => o.value === cur);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, opts.findIndex(o => o.value === cur)));
    setOpen(true);
  };
  const close = () => { setOpen(false); onClose?.(); };
  useEffect(() => { if (defaultOpen) { openList(); btn.current?.focus(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (o: Opt) => {
    if (o.disabled) return;
    close();
    btn.current?.focus();
    if (o.value !== cur) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>);
  };
  const move = (d: number) => {
    let i = active;
    for (let k = 0; k < opts.length; k++) {
      i = (i + d + opts.length) % opts.length;
      if (!opts[i].disabled) break;
    }
    setActive(i);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList(); else move(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      if (opts[active]) pick(opts[active]);
    } else if (e.key === 'Tab' && open) close();
  };

  return (
    <>
      <button ref={btn} type="button" id={id} disabled={disabled}
        className={cx(!bare && 'input select', !bare && size === 'sm' && 'select--sm', 'sbox__btn', open && 'is-open', !selected?.label && 'is-empty', className)}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={rest['aria-label']}
        onClick={() => (open ? close() : openList())} onKeyDown={onKey}>
        <span className="sbox__value">
          {selected?.group && <span className="sbox__group">{selected.group} ›</span>}
          {selected?.label ?? '선택'}
        </span>
        {!hideChevron && <IconChevron size={14} className="sbox__chev" aria-hidden="true" />}
      </button>
      <Popover anchor={btn} open={open} onClose={close} matchWidth minWidth={140} role="presentation" className={cx('sbox__pop', popClassName)}>
        <ul id={listId} role="listbox" aria-label={rest['aria-label']} className="sbox__list">
          {opts.map((o, i) => [
            o.group && o.group !== opts[i - 1]?.group && (
              <li key={`g:${o.group}`} role="presentation" className="sbox__grp">{o.group}</li>
            ),
            <li key={o.value} role="option" aria-selected={o.value === cur} aria-disabled={o.disabled || undefined}
              className={cx('sbox__opt', o.value === cur && 'is-selected', i === active && 'is-active', o.disabled && 'is-disabled')}
              onPointerEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span>{o.label}</span>
              {o.value === cur && <span className="sbox__check" aria-hidden="true">✓</span>}
            </li>,
          ])}
        </ul>
      </Popover>
    </>
  );
}
