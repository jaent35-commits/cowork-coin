import { useEffect, useRef, useState } from 'react';
import type { View } from '@/types';
import { IconBack, IconBell, IconChevron, IconLogout, IconShield, IconUser } from '../icons';
import { IconBtn, cx } from '../ui';
import { useFontMode } from '@/lib/fontScale';
import kowokIcon from '@/assets/kowok-icon.png';
import { mobileTitle } from './nav';
import HeaderSearch from './HeaderSearch';
import { usePullEgg } from './usePullEgg';

/** 글씨 크기 전환 (작은 글씨 ↔ 큰 글씨 1.4배) */
function FontToggle() {
  const [font, setFont] = useFontMode();
  const big = font === 'lg';
  const label = big ? '작은 글씨로 보기' : '큰 글씨로 보기';
  return (
    <IconBtn className={cx('font-toggle', big && 'is-on')} onClick={() => setFont(big ? 'sm' : 'lg')}
      aria-pressed={big} aria-label={`큰 글씨 ${big ? '켜짐' : '꺼짐'} — ${label}`} title={label}>
      <span className="font-toggle__glyph" aria-hidden="true">가<small>{big ? '−' : '+'}</small></span>
    </IconBtn>
  );
}

/** 로그인한 팀 이름 → 계정 메뉴 (마이페이지 · 관리자 메뉴 · 로그아웃) */
function TeamButton({ teamName, isAdmin, onNavigate, onLogout }: {
  teamName: string; isAdmin: boolean; onNavigate: (v: View) => void; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const go = (v: View) => { setOpen(false); onNavigate(v); };

  return (
    <div ref={ref} className="team-menu">
      <button type="button" className={cx('app-header__team', open && 'is-open')} onClick={() => setOpen(v => !v)}
        aria-haspopup="menu" aria-expanded={open} title="계정 메뉴">
        <span>{teamName}</span>
        <IconChevron size={12} />
      </button>
      {open && (
        <div className="team-menu__pop" role="menu">
          <button type="button" role="menuitem" onClick={() => go('mypage')}><IconUser size={15} />마이페이지</button>
          {isAdmin && <button type="button" role="menuitem" onClick={() => go('admin')}><IconShield size={15} />관리자 메뉴</button>}
          <button type="button" role="menuitem" className="team-menu__logout" onClick={() => { setOpen(false); onLogout(); }}>
            <IconLogout size={15} />로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header({ view, teamName, isAdmin, unread, onNavigate, onLogout, onBack, title }: {
  view: View; teamName: string; isAdmin: boolean; unread: number; onNavigate: (v: View) => void; onLogout: () => void;
  /** 모바일 하위 화면(집행 등록): 로고 자리에 ‹ 뒤로 버튼 */
  onBack?: () => void;
  /** 모바일 헤더 제목을 직접 지정 (예: 프로젝트 상세 = 프로젝트명) */
  title?: string;
}) {
  const egg = usePullEgg();
  return (
    <>
    {/* 이스터에그: 모바일에서 헤더를 아래로 끌어내리면 랜덤 문구 */}
    <div className={cx('pull-egg', egg.dragging && 'is-dragging', egg.height > 0 && 'is-open')} style={{ height: egg.height }}
      onClick={egg.close} aria-hidden={egg.height === 0}>
      <div className="pull-egg__inner">
        <img src={kowokIcon} alt="" width={44} height={44} className={cx('pull-egg__icon', egg.popped && 'is-pop')}
          style={{ opacity: egg.reveal, transform: egg.popped ? undefined : `scale(${0.4 + egg.reveal * 0.5}) rotate(${(1 - egg.reveal) * -25}deg)` }} />
        <p className={cx('pull-egg__msg', egg.popped && 'is-pop')} role="status" aria-hidden={!egg.popped}>{egg.height > 0 ? egg.msg : ''}</p>
      </div>
    </div>
    <header className={cx('app-header', onBack && 'has-back', egg.height > 0 && 'is-pulled', egg.boing && 'is-boing')} {...egg.handlers}>
      {onBack && (
        <button type="button" className="app-header__back" onClick={onBack} aria-label="뒤로" title="뒤로">
          <IconBack size={22} />
        </button>
      )}
      <button type="button" className="app-header__brand" onClick={() => onNavigate('home')} aria-label="홈으로">
        {/* 모바일: 앱 아이콘 + 현재 화면 제목 */}
        <span className="app-header__logo">
          <img src={kowokIcon} alt="" width={32} height={32} />
        </span>
        <h1 className="app-header__page" title={title}>{title ?? mobileTitle(view)}</h1>
        <span className="app-header__title">
          <strong>코웍-코인 : ㅋㅇ! 프로젝트 경비 관리 시스템</strong>
          <small>프로젝트는 함께할 때 더 맛있으니까!</small>
        </span>
      </button>

      <div className="app-header__actions">
        <HeaderSearch onNavigate={onNavigate} />
        <span className="app-header__divider" aria-hidden="true" />
        <FontToggle />
        <TeamButton teamName={teamName} isAdmin={isAdmin} onNavigate={onNavigate} onLogout={onLogout} />
        <IconBtn onClick={() => onNavigate('notification')} badge={unread > 0} title="알림"
          aria-label={unread > 0 ? `알림 ${unread}건 읽지 않음` : '알림'}>
          <IconBell size={18} />
        </IconBtn>
      </div>
    </header>
    </>
  );
}
