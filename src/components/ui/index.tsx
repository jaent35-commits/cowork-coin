import { useEffect, useState, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { IconBack, IconBan, IconCheckCircle, IconEye, IconEyeOff, IconInfo, IconWarn } from '../icons';
import { createPortal } from 'react-dom';
import { fmtAmt, hangulWon, parseAmt } from '@/lib/format';
import type { ToastState } from '@/hooks/useToast';
import './ui.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ── Card ── */
export function Card({ children, className, hover, pad, onClick, style }: {
  children: ReactNode; className?: string; hover?: boolean; pad?: boolean | 'lg';
  onClick?: () => void; style?: CSSProperties;
}) {
  return (
    <div
      className={cx('card', hover && 'card--hover', pad === true && 'card--pad', pad === 'lg' && 'card--pad-lg', onClick && 'is-clickable', className)}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  );
}

/* ── Badge (태그·알약 공통) ──
 * variant: 색 / outline: 테두리형(참여) / dark: 진한 회색(비공개) / tint: color 로 준 색을 연하게 (분류 태그)
 * size: sm(목록 줄 안) · md(기본) · lg(표 안 상태 전환 버튼)
 * onClick 을 주면 버튼으로 (pressed: 켜짐 상태) */
export type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray' | 'outline' | 'dark' | 'tint';
export function Badge({ variant, size = 'md', color, children, className, title, onClick, pressed, disabled }: {
  variant: BadgeVariant; size?: 'sm' | 'md' | 'lg'; color?: string; children: ReactNode; className?: string; title?: string;
  onClick?: () => void; pressed?: boolean; disabled?: boolean;
}) {
  const cls = cx('badge', `badge--${variant}`, size !== 'md' && `badge--${size}`, onClick && 'badge--btn', className);
  const style = color ? ({ '--c': color } as CSSProperties) : undefined;
  if (onClick) {
    return <button type="button" className={cls} style={style} title={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
  }
  return <span className={cls} style={style} title={title}>{children}</span>;
}

/* ── ProgressBar ── */
export type ProgVariant = 'blue' | 'green' | 'amber' | 'red';
export function progVariant(p: number): 'green' | 'amber' | 'red' {
  if (p >= 75) return 'green';
  if (p >= 45) return 'amber';
  return 'red';
}
export function ProgressBar({ value, variant = 'blue', height = 7, label }: {
  value: number; variant?: ProgVariant; height?: number; label?: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="progress" style={{ '--h': `${height}px` } as CSSProperties}
      role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`progress__bar progress__bar--${variant}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ── Button ── */
/** link: 글자형(더보기·바로가기) — 여백 없이 글자만, inverse: 진한 바 위의 흰 버튼 */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'inverse';
export function Btn({ variant = 'primary', size = 'md', block, className, type = 'button', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; block?: boolean }) {
  return (
    <button type={type} className={cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', block && 'btn--block', className)} {...rest} />
  );
}

export function IconBtn({ className, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { badge?: boolean }) {
  return (
    <button type="button" className={cx('icon-btn', className)} {...rest}>
      {rest.children}
      {badge && <span className="icon-btn__dot" aria-hidden="true" />}
    </button>
  );
}

/* ── Checkbox / Switch ── */
/** tone: success = 완료 체크(체크리스트), primary = 선택 체크(표 행 선택·옵션) */
export function Checkbox({ tone = 'primary', className, ...rest }: Omit<ComponentProps<'input'>, 'type'> & { tone?: 'primary' | 'success' }) {
  return <input type="checkbox" className={cx('checkbox', `checkbox--${tone}`, className)} {...rest} />;
}

/** 켜기/끄기 토글 — text: 오른쪽 상태 글자 (예: ON/OFF, 관리자/일반) */
export function Switch({ checked, onChange, label, text, disabled, title }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; text?: ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <label className={cx('switch', disabled && 'is-locked')} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      {text != null && <span className="switch__text">{text}</span>}
    </label>
  );
}

/* ── FilterChip ── */
export function FilterChip({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button type="button" className={cx('chip', active && 'is-active')} aria-pressed={active} onClick={onClick}>
      {label}
      {count != null && <span className="chip__count">({count})</span>}
    </button>
  );
}

/* ── SegmentedControl ── */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" className={cx('segmented__btn', value === o.value && 'is-active')}
          aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Form ── */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

/** onClear 를 주면 입력란 오른쪽에 ✕(지우기) 버튼 — 글자가 있을 때만 보임 */
export function Input({ className, onClear, ...rest }: InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }) {
  if (!onClear) return <input className={cx('input', className)} {...rest} />;
  const filled = String(rest.value ?? '').length > 0;
  return (
    <span className={cx('input-clear', className)}>
      <input className={cx('input', filled && 'has-clear')} {...rest} />
      {filled && (
        <button type="button" className="input-clear__btn" aria-label="입력 내용 지우기"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { onClear(); (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus(); }}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      )}
    </span>
  );
}

/** 드롭다운 — 네이티브 목록 팝업 대신 디자인에 맞춘 목록 (사용법은 <select> 와 동일) */
export { Select } from './SelectBox';
export { DateField } from './DateField';
export { Popover } from './Popover';
export { StepNav, YearGrid, MonthGrid } from './StepNav';

/** 천 단위 콤마 금액 입력 + '원' 접미사 (hangul: 입력칸 아래에 "1억2천5백만원" 읽기 표시) */
export function AmountInput({ value, onChange, className, hangul, ...rest }:
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void; hangul?: boolean }) {
  const field = (
    <div className={cx('amount-input', !hangul && className)}>
      <input className="input" inputMode="numeric" placeholder="0" value={fmtAmt(value)}
        onChange={e => onChange(parseAmt(e.target.value))} {...rest} />
      <span className="amount-input__suffix" aria-hidden="true">원</span>
    </div>
  );
  if (!hangul) return field;
  return (
    <div className={cx('amount-field', className)}>
      {field}
      <small className="amount-field__hangul" aria-live="polite">{hangulWon(value)}</small>
    </div>
  );
}

export function PasswordInput({ value, onChange, id, placeholder, onEnter, autoComplete }: {
  value: string; onChange: (v: string) => void; id?: string; placeholder?: string; onEnter?: () => void; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }} />
      <button type="button" className="pw-input__toggle" onClick={() => setShow(v => !v)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}

/* ── Feedback ── */
const ALERT_ICON = { info: IconInfo, warn: IconWarn, danger: IconBan, success: IconCheckCircle } as const;
export function Alert({ variant, children, className }: { variant: keyof typeof ALERT_ICON; children: ReactNode; className?: string }) {
  const Icon = ALERT_ICON[variant];
  return (
    <div className={cx('alert', `alert--${variant}`, className)} role={variant === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon" aria-hidden="true"><Icon size={17} /></span>
      <div className="alert__body">{children}</div>
    </div>
  );
}

export function Toast({ msg: toast }: { msg: ToastState }) {
  /* 사라지는 동안에도 마지막 문구·색을 유지 (내려가며 흐려짐)
     화면 등장 애니메이션의 transform 이 fixed 를 가두므로 body 로 portal */
  const [last, setLast] = useState(toast);
  if (toast.msg && (toast.msg !== last.msg || toast.tone !== last.tone)) setLast(toast);
  const warn = last.tone === 'warn';
  return createPortal(
    <div className={cx('toast', warn && 'toast--warn', toast.msg && 'is-show')} role={warn ? 'alert' : 'status'} aria-live={warn ? 'assertive' : 'polite'}>
      {last.msg && <>
        <span className="toast__icon" aria-hidden="true">
          {warn
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"><path d="M12 5.5v8" /><path d="M12 18.5h.01" /></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
        </span>
        <span className="toast__msg">{last.msg}</span>
      </>}
    </div>, document.body,
  );
}

/**
 * 확인 레이어 — 화면(뷰포트) 아래쪽 가운데에 뜨는 확인창 (삭제·초기화·변경 확인 공통)
 * 버튼 순서: [취소] [실행] (오른쪽 끝이 실행), Esc = 취소
 */
export function ConfirmLayer({ title, children, tone = 'default', confirmLabel, onConfirm, onCancel, cancelLabel = '취소', extra }: {
  title: ReactNode; children?: ReactNode; tone?: 'default' | 'danger';
  confirmLabel: ReactNode; onConfirm: () => void; onCancel: () => void; cancelLabel?: string;
  /** 취소와 실행 사이에 넣을 버튼 (예: '아니오 (이 달만)') */
  extra?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className={cx('confirm-layer', tone === 'danger' && 'confirm-layer--danger')} role="alertdialog" aria-modal="false" aria-labelledby="confirm-layer-title">
      <div className="confirm-layer__msg">
        <strong id="confirm-layer-title" className="confirm-layer__title">{title}</strong>
        {children}
      </div>
      <div className="confirm-layer__btns">
        <Btn variant="secondary" size="sm" onClick={onCancel}>{cancelLabel}</Btn>
        {extra}
        <Btn variant={tone === 'danger' ? 'danger' : 'primary'} size="sm" autoFocus onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </div>, document.body,
  );
}

export function EmptyState({ icon, message, sub }: { icon?: string; message: string; sub?: string }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon" aria-hidden="true">{icon}</div>}
      <div className="empty__msg">{message}</div>
      {sub && <div className="empty__sub">{sub}</div>}
    </div>
  );
}

/* ── Layout helpers ── */
export function KV({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className={cx('kv__value', accent && 'is-accent')}>{value}</span>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx('divider', className)} />;
}

export function PageHead({ title, extra, actions, back, eyebrow, className }: {
  /** extra: 제목 오른쪽에 붙는 요소 (예: 조회 연도) */
  title: ReactNode; extra?: ReactNode; actions?: ReactNode; eyebrow?: string; className?: string;
  back?: { label?: string; onClick: () => void };
}) {
  return (
    <div className={cx('page-head', className)}>
      <div className="page-head__main">
        {back && (
          <button type="button" className="page-head__back" onClick={back.onClick} aria-label={back.label ?? '뒤로'} title={back.label ?? '뒤로'}>
            <IconBack />
          </button>
        )}
        <div>
          {eyebrow && <div className="page-head__eyebrow">{eyebrow}</div>}
          <div className="page-head__title-row">
            <h1 className="page-head__title">{title}</h1>
            {extra}
          </div>
        </div>
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className={cx('section-head', !!sub && 'has-sub')}>
      <div className="grow">
        <h2 className="section-head__title">{title}</h2>
        {sub && <p className="section-head__sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onSelect }: { tabs: readonly T[]; active: T; onSelect: (t: T) => void }) {
  return (
    <div className="tabs no-scrollbar" role="tablist">
      {tabs.map(t => (
        <button key={t} type="button" role="tab" aria-selected={active === t}
          className={cx('tabs__tab', active === t && 'is-active')} onClick={() => onSelect(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** 표 가로 스크롤 래퍼 */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Avatar({ name, size = 'md', muted }: { name: string; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  return <span className={cx('avatar', `avatar--${size}`, muted && 'is-muted')} aria-hidden="true">{name.charAt(0)}</span>;
}
