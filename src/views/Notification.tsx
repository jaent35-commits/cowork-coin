import { useEffect, useState, type CSSProperties } from 'react';
import { onFocusRequest, takeFocus } from '@/lib/search';
import type { NotifType } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { myNotifications } from '@/store/selectors';
import NotifSettings from '@/components/NotifSettings';
import { Btn, Card, EmptyState, FilterChip, PageHead, cx } from '@/components/ui';
import './Pages.css';

const TYPE_META: Record<NotifType, { icon: string; bg: string }> = {
  exec: { icon: '🧾', bg: 'var(--primary-50)' },
  setting: { icon: '🔐', bg: 'var(--violet-50)' },
  alloc: { icon: '📁', bg: 'var(--sage-50)' },
  deadline: { icon: '⏰', bg: 'var(--coral-50)' },
  budget: { icon: '💸', bg: 'var(--primary-50)' },
  project: { icon: '📁', bg: 'var(--sage-50)' },
  admin: { icon: '🛡️', bg: 'var(--violet-50)' },
  system: { icon: '⚙️', bg: 'var(--line-soft)' },
};

export default function Notification() {
  const state = useAppState();
  const notifications = myNotifications(state);
  // 검색 '알림 설정' 으로 오면 설정 펼침
  const [showSettings, setShowSettings] = useState(() => takeFocus('tab', t => t === '알림 설정') != null);
  useEffect(() => onFocusRequest('tab', t => { if (t !== '알림 설정') return false; setShowSettings(true); }));
  const dispatch = useDispatch();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const unread = notifications.filter(n => !n.read).length;
  const shown = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;

  return (
    <div className="view-enter">
      <PageHead
        title={<span className="row">알림{unread > 0 && <span className="count-pill">{unread}</span>}</span>}
        actions={<>
          {unread > 0 && <Btn variant="secondary" size="sm" onClick={() => dispatch({ type: 'READ_ALL_NOTIF' })}>모두 읽음</Btn>}
          <Btn variant="secondary" size="sm" onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings}>⚙️ 알림 설정</Btn>
        </>}
      />

      {showSettings && (
        <Card pad className="mb-16">
          <h2 className="card-title">🔔 알림 설정</h2>
          <NotifSettings />
        </Card>
      )}

      <div className="chip-row mb-16">
        <FilterChip label="전체" active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label={`읽지 않음${unread ? ` (${unread})` : ''}`} active={filter === 'unread'} onClick={() => setFilter('unread')} />
      </div>

      <Card className="card--clip">
        {shown.length === 0 && <EmptyState icon="🎉" message="모두 읽었습니다!" sub="새 알림이 없어요" />}
        <ul>
          {shown.map(n => {
            const meta = TYPE_META[n.type];
            return (
              <li key={n.id}>
                <button type="button" className={cx('notif', !n.read && 'is-unread')} onClick={() => dispatch({ type: 'READ_NOTIF', id: n.id })}>
                  <span className="notif__icon" style={{ '--ico-bg': meta.bg } as CSSProperties} aria-hidden="true">{meta.icon}</span>
                  <span className="grow">
                    <span className="notif__top">
                      <span className="notif__title">{!n.read && <span className="sr-only">읽지 않음: </span>}{n.title}</span>
                      <span className="notif__time">{n.time}</span>
                    </span>
                    <span className="notif__desc">{n.desc}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
