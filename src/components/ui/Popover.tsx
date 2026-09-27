import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '.';

/** 측정 전: 화면 밖 고정 위치에서 크기만 잰다 */
const HIDDEN: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * 트리거 요소 아래에 뜨는 팝업 (캘린더·셀렉트 목록 공용)
 * - body 로 portal → 카드의 overflow:hidden 에 잘리지 않음
 * - 아래 공간이 부족하면 위로 펼침, 스크롤·리사이즈 시 위치 갱신
 * - 바깥 클릭·Esc 로 닫힘
 */
export function Popover({ anchor, open, onClose, children, className, matchWidth, minWidth = 0, role = 'dialog', label, id }: {
  anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode;
  className?: string; matchWidth?: boolean; minWidth?: number; role?: string; label?: string; id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN);

  const place = () => {
    const a = anchor.current, p = ref.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 6, margin = 8;
    const width = Math.max(minWidth, matchWidth ? r.width : 0);
    const pw = Math.min(Math.max(p.offsetWidth, width), vw - margin * 2);
    const ph = p.offsetHeight;
    const below = vh - r.bottom - gap - margin;
    const up = below < ph && r.top - gap - margin > below;
    const left = Math.min(Math.max(margin, r.left), vw - pw - margin);
    setStyle({
      position: 'fixed', left, visibility: 'visible', minWidth: width || undefined, maxWidth: vw - margin * 2,
      top: up ? undefined : r.bottom + gap, bottom: up ? vh - r.top + gap : undefined,
      maxHeight: Math.max(160, (up ? r.top : vh - r.bottom) - gap - margin),
    });
  };

  useLayoutEffect(() => { if (open) place(); else setStyle(HIDDEN); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.current?.focus(); } };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return createPortal(
    <div ref={ref} id={id} className={cx('popover fade-in', className)} style={style} role={role} aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}
