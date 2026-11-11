import { useState } from 'react';
import type { PushKind } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { DEFAULT_PREFS } from '@/store/reducer';
import { pushPermission, requestPush, showPush } from '@/lib/push';
import { REMOTE_AUTH } from '@/lib/supabase';
import { AuthApiError, sendSlackTest } from '@/lib/authApi';
import { Alert, Btn, Switch, cx } from './ui';

export const PUSH_KIND_META: { kind: PushKind; icon: string; label: string; desc: string }[] = [
  { kind: 'setting', icon: '🔐', label: '설정 변경', desc: '비밀번호를 변경하거나 관리자가 초기화했을 때' },
  { kind: 'alloc', icon: '📁', label: '새 프로젝트 배분', desc: '우리 조직에 프로젝트 예산이 배분·변경되었을 때' },
  { kind: 'deadline', icon: '⏰', label: '기한 임박', desc: '다음 달 종료되는 프로젝트가 있을 때 (1개월 전, 잔여 금액 포함)' },
];

/**
 * 알림 설정 — 기기 푸시 on/off · 슬랙 개인 DM on/off(Supabase 로그인) · 종류별 on/off
 * Supabase 로그인은 사람별 저장 (같은 조직이어도 각자), 브라우저 저장본 로그인은 팀별
 */
export default function NotifSettings() {
  const { session, notifPrefs } = useAppState();
  const dispatch = useDispatch();
  const team = session?.team ?? '';
  const prefs = notifPrefs[team] ?? DEFAULT_PREFS;
  const [perm, setPerm] = useState(pushPermission);
  const [slackMsg, setSlackMsg] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const togglePush = async (on: boolean) => {
    if (on) {
      const p = await requestPush();
      setPerm(p);
      if (p !== 'granted') return;
    }
    dispatch({ type: 'SET_PUSH', team, push: on });
  };
  const pushOn = prefs.push && perm === 'granted';
  const slackOn = REMOTE_AUTH && !!session?.member && prefs.slack !== false;
  // 종류별 on/off 는 푸시 · 슬랙 DM 공통 — 둘 중 하나라도 켜져 있으면 바꿀 수 있음
  const kindsOn = pushOn || slackOn;

  const testSlack = async () => {
    setTesting(true); setSlackMsg(null);
    try {
      const r = await sendSlackTest();
      setSlackMsg(r.ok
        ? { tone: 'success', text: '슬랙 코웍-코인 앱 메시지 탭으로 테스트 DM 을 보냈어요' }
        : { tone: 'warn', text: `보내지 못했어요 — ${r.message ?? '회사 이메일이 슬랙 로그인 이메일과 같은지 확인하세요'}` });
    } catch (e) {
      setSlackMsg({ tone: 'warn', text: e instanceof AuthApiError ? e.message : '보내지 못했어요. 잠시 후 다시 시도하세요' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="notif-set">
      <div className="notif-set__row notif-set__row--main">
        <div className="grow">
          <div className="notif-set__label">푸시 알림</div>
          <div className="notif-set__desc">알림이 생기면 이 기기 알림으로도 받아요</div>
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

      {/* 슬랙 DM — Supabase 로그인한 사용자만 (회사 이메일로 슬랙 계정을 찾아 보냄) */}
      {REMOTE_AUTH && session?.member && (
        <>
          <div className="notif-set__row notif-set__row--main">
            <div className="grow">
              <div className="notif-set__label">슬랙 DM 알림</div>
              <div className="notif-set__desc">앱을 닫아 두어도 회사 슬랙 DM 으로 받아요{session.member.email ? ` · ${session.member.email}` : ' · 회사 이메일이 등록되지 않았어요'}</div>
            </div>
            <Switch checked={slackOn} onChange={on => dispatch({ type: 'SET_SLACK', team, on })} label="슬랙 DM 알림" text={slackOn ? 'ON' : 'OFF'} />
          </div>
          {slackMsg && <Alert variant={slackMsg.tone}>{slackMsg.text}</Alert>}
          {slackOn && (
            <Btn variant="secondary" size="sm" disabled={testing} onClick={() => { void testSlack(); }}>{testing ? '보내는 중...' : '테스트 DM 보내기'}</Btn>
          )}
        </>
      )}

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
