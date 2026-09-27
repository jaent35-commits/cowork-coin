import type { View } from '@/types';
import { cx } from '../ui';
import { IconPanelToggle } from '../icons';
import { useTheme } from '@/lib/theme';
import { ADMIN_NAV, GNB, GNB_GROUPS, isActive, type NavItem } from './nav';
import kowokLogo from '@/assets/kowok-logo.webp';
import kowokLogoDark from '@/assets/kowok-logo-dark.webp'; // 다크 모드: 글자만 밝게
import kowokIcon from '@/assets/kowok-icon.png';
import kowokKya from '@/assets/kowok-kya.webp';

function Item({ item, active, collapsed, onClick }: { item: NavItem; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" className={cx('sidebar__item', active && 'is-active')} onClick={onClick}
      aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}>
      <Icon size={17} />
      <span className="sidebar__text">{item.label}</span>
      {active && <span className="sidebar__dot" aria-hidden="true" />}
    </button>
  );
}

export default function Sidebar({ view, isAdmin, collapsed, onToggle, onNavigate }: {
  view: View; isAdmin: boolean; collapsed: boolean; onToggle: () => void; onNavigate: (v: View) => void;
}) {
  const label = collapsed ? '메뉴 펼치기' : '메뉴 접기';
  const { theme } = useTheme();
  return (
    <aside id="gnb" className={cx('sidebar', collapsed && 'is-collapsed')} aria-label="주 메뉴">
      <button type="button" className="sidebar__brand" onClick={() => onNavigate('home')} aria-label="코웍-코인 홈으로">
        {collapsed
          ? <img src={kowokIcon} alt="" className="sidebar__brand-icon" width={36} height={36} />
          : <img src={theme === 'dark' ? kowokLogoDark : kowokLogo} alt="" className="sidebar__brand-logo" width={120} height={44} />}
      </button>
      <div className="sidebar__top">
        <button type="button" className="sidebar__toggle" onClick={onToggle}
          aria-expanded={!collapsed} aria-controls="gnb" aria-label={label} title={label}>
          <IconPanelToggle size={18} />
        </button>
      </div>
      <nav className="sidebar__nav">
        {GNB_GROUPS.map(g => (
          <div key={g.title ?? 'top'} className="sidebar__group" role="group" aria-label={g.title}>
            {g.title && <div className="sidebar__group-title" aria-hidden="true">{g.title}</div>}
            {g.views.map(v => GNB.find(i => i.view === v)!).map(item => (
              <Item key={item.view} item={item} collapsed={collapsed} active={isActive(item, view)} onClick={() => onNavigate(item.view)} />
            ))}
          </div>
        ))}
      </nav>
      {isAdmin && (
        <>
          <div className="sidebar__sep" role="separator" />
          <nav className="sidebar__nav" aria-label="관리 메뉴">
            <Item item={ADMIN_NAV} collapsed={collapsed} active={view === 'admin'} onClick={() => onNavigate('admin')} />
          </nav>
        </>
      )}
      {/* 하단 장식 — 펼친 상태에서만 */}
      <div className="sidebar__deco" aria-hidden="true">
        <img src={kowokKya} alt="" width={84} height={76} />
        <p className="sidebar__slogan">프로젝트는 함께할 때<br />더 맛있으니까!</p>
      </div>
    </aside>
  );
}
