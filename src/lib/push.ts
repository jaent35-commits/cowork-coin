import { useEffect, useRef } from 'react';
import type { NotifItem, PushKind } from '@/types';
import { DEFAULT_PREFS, type AppState } from '@/store/reducer';
import { myNotifications } from '@/store/selectors';

/**
 * 기기 푸시 알림 — 브라우저 Notification API + 서비스워커(showNotification) 사용.
 * 별도 푸시 서버 없이 앱에서 알림이 생길 때 기기 알림으로 띄운다.
 * (iOS 는 홈 화면에 설치한 앱에서만 지원)
 */
export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const pushPermission = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported');

export async function requestPush(): Promise<NotificationPermission | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export async function showPush(n: Pick<NotifItem, 'id' | 'title' | 'desc'>) {
  if (pushPermission() !== 'granted') return;
  const opts: NotificationOptions = { body: n.desc, icon: '/icons/icon-192.png', badge: '/icons/favicon-64.png', tag: n.id };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(`코웍-코인 · ${n.title}`, opts);
  } catch { /* 서비스워커 없음 → 아래 기본 방식 */ }
  try { new Notification(`코웍-코인 · ${n.title}`, opts); } catch { /* 모바일 크롬은 서비스워커 방식만 지원 */ }
}

const PUSH_KINDS: PushKind[] = ['exec', 'setting', 'alloc', 'deadline'];
const isPushKind = (t: string): t is PushKind => (PUSH_KINDS as string[]).includes(t);

/**
 * 로그인한 팀에게 새로 생긴 알림을 설정(전체 on/off · 종류별 on/off)에 따라 기기 푸시로 보낸다
 * - 로그인(팀이 정해진) 뒤에 생긴, 읽지 않은 알림만 — 로그인하며 서버에서 읽어 온 지난 알림이 한꺼번에 뜨지 않게
 *   (로그인 직후엔 화면을 비운 뒤 서버 알림을 읽어 오므로 '처음 본 알림 = 새 알림'으로 보면 지난 알림이 모두 뜸)
 * - 내 동작으로 생긴 알림은 화면에서 먼저 뜨고, 서버에 저장된 같은 알림(새 id)이 다시 읽혀도 한 번만
 */
export function usePushDelivery(state: AppState) {
  const team = state.session?.team;
  const since = useRef(0);
  const seen = useRef(new Set<string>());
  const mine = myNotifications(state);

  useEffect(() => { since.current = Date.now() - 5000; seen.current = new Set(); }, [team]);

  useEffect(() => {
    if (!team) return;
    const sameKey = (n: NotifItem) => `${n.title}|${n.desc}`;
    const fresh = mine.filter(n => !n.read && !!n.createdAt && Date.parse(n.createdAt) >= since.current
      && !seen.current.has(n.id) && !seen.current.has(sameKey(n)));
    fresh.forEach(n => { seen.current.add(n.id); seen.current.add(sameKey(n)); });
    const prefs = state.notifPrefs[team] ?? DEFAULT_PREFS;
    if (!prefs.push) return;
    fresh.filter(n => !isPushKind(n.type) || prefs.kinds[n.type]).forEach(n => { void showPush(n); });
  }, [team, mine, state.notifPrefs]);
}
