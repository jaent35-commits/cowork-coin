import type { View } from '@/types';
import { cx } from '../ui';
import { BOTTOM_NAV, isActive } from './nav';

/** 1024px 이하에서만 보이는 하단 탭바 — 관리자 메뉴는 헤더의 팀 이름에서 진입 */
export default function BottomNav({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  const items = BOTTOM_NAV;
  return (
    <nav className="bottom-nav" aria-label="하단 메뉴">
      {items.map(item => {
        const active = isActive(item, view);
        const Icon = item.icon;
        return (
          <button key={item.view} type="button" className={cx('bottom-nav__tab', active && 'is-active')}
            onClick={() => onNavigate(item.view)} aria-current={active ? 'page' : undefined}>
            <Icon size={22} />
            <span>{item.short}</span>
          </button>
        );
      })}
    </nav>
  );
}
