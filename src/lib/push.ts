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

/** 로그인한 팀에게 새로 생긴 알림을 설정(전체 on/off · 종류별 on/off)에 따라 기기 푸시로 보낸다 */
export function usePushDelivery(state: AppState) {
  const team = state.session?.team;
  const seen = useRef<Set<string> | null>(null);
  const mine = myNotifications(state);

  // 팀이 바뀌면(로그인) 기존 알림은 보낸 것으로 간주
  useEffect(() => { seen.current = null; }, [team]);

  useEffect(() => {
    if (!team) return;
    if (!seen.current) { seen.current = new Set(mine.map(n => n.id)); return; }
    const fresh = mine.filter(n => !seen.current!.has(n.id));
    fresh.forEach(n => seen.current!.add(n.id));
    const prefs = state.notifPrefs[team] ?? DEFAULT_PREFS;
    if (!prefs.push) return;
    fresh.filter(n => !isPushKind(n.type) || prefs.kinds[n.type]).forEach(n => { void showPush(n); });
  }, [team, mine, state.notifPrefs]);
}
