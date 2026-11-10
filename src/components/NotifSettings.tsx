import { useState } from 'react';
import type { PushKind } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { DEFAULT_PREFS } from '@/store/reducer';
import { pushPermission, requestPush, showPush } from '@/lib/push';
import { REMOTE_AUTH } from '@/lib/supabase';
import SlackSettings from './SlackSettings';
import { Alert, Btn, Switch, cx } from './ui';

export const PUSH_KIND_META: { kind: PushKind; icon: string; label: string; desc: string }[] = [
  { kind: 'setting', icon: '🔐', label: '설정 변경', desc: '비밀번호를 변경하거나 관리자가 초기화했을 때' },
  { kind: 'alloc', icon: '📁', label: '새 프로젝트 배분', desc: '우리 팀에 프로젝트 예산이 배분·변경되었을 때' },
  { kind: 'deadline', icon: '⏰', label: '기한 임박', desc: '다음 달 종료되는 프로젝트가 있을 때 (1개월 전, 잔여 금액 포함)' },
];

/** 알림 설정 — 기기 푸시 전체 on/off + 종류별 on/off (팀별 저장) */
export default function NotifSettings() {
  const { session, notifPrefs } = useAppState();
  const dispatch = useDispatch();
  const team = session?.team ?? '';
  const prefs = notifPrefs[team] ?? DEFAULT_PREFS;
  const [perm, setPerm] = useState(pushPermission);

  const togglePush = async (on: boolean) => {
    if (on) {
      const p = await requestPush();
      setPerm(p);
      if (p !== 'granted') return;
    }
    dispatch({ type: 'SET_PUSH', team, push: on });
  };
  const pushOn = prefs.push && perm === 'granted';
  // 종류별 on/off 는 푸시 · 슬랙 DM 공통 — 둘 중 하나라도 켜져 있으면 바꿀 수 있음
  const [slackOn, setSlackOn] = useState(false);
  const kindsOn = pushOn || slackOn;

  return (
    <div className="notif-set">
      <div className="notif-set__row notif-set__row--main">
        <div className="grow">
          <div className="notif-set__label">푸시 알림</div>
          <div className="notif-set__desc">알림이 생기면 휴대폰·PC 알림으로도 받아요</div>
        </div>
        <Switch checked={pushOn} onChange={v => { void togglePush(v); }} label="푸시 알림" text={pushOn ? 'ON' : 'OFF'} disabled={perm === 'unsupported'} />
      </div>

      {perm === 'unsupported' && <Alert variant="info">이 브라우저는 푸시 알림을 지원하지 않아요. 아이폰은 홈 화면에 앱을 설치한 뒤 사용할 수 있어요.</Alert>}
      {perm === 'denied' && <Alert variant="warn">브라우저에서 알림이 차단되어 있어요. 브라우저(또는 기기) 설정 → 사이트 알림에서 허용해 주세요.</Alert>}

      {pushOn && (
        <Btn variant="secondary" size="sm" onClick={() => { void showPush({ id: 'test', title: '테스트 알림', desc: '푸시 알림이 정상적으로 설정되었어요 🎉' }); }}>
          테스트 알림 보내기
        </Btn>
      )}

      {/* 슬랙 DM — Supabase 로그인일 때만 (브라우저 저장본 로그인은 서버가 없어 보낼 수 없음) */}
      {REMOTE_AUTH && <SlackSettings onEnabled={setSlackOn} />}

      <div className="notif-set__label notif-set__kinds-title">알림 종류 <span className="notif-set__desc">{REMOTE_AUTH ? '푸시 · 슬랙 DM 공통 · ' : ''}예산 경고는 늘 보냄</span></div>
      <ul className={cx('notif-set__kinds', !kindsOn && 'is-off')} aria-label="종류별 알림">
        {PUSH_KIND_META.map(m => (
          <li key={m.kind} className="notif-set__row">
            <span className="notif-set__icon" aria-hidden="true">{m.icon}</span>
            <div className="grow">
              <div className="notif-set__label">{m.label}</div>
              <div className="notif-set__desc">{m.desc}</div>
            </div>
            <Switch checked={prefs.kinds[m.kind]} disabled={!kindsOn} label={`${m.label} 알림`} text={prefs.kinds[m.kind] ? 'ON' : 'OFF'}
              onChange={on => dispatch({ type: 'SET_PUSH_KIND', team, kind: m.kind, on })} />
          </li>
        ))}
      </ul>
    </div>
  );
}
