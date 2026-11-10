import { useEffect, useState, type FormEvent } from 'react';
import { useAppState } from '@/store/StoreContext';
import { MAX_SLACK_RECIPIENTS, addSlackRecipient, isEmail, loadSlack, removeSlackRecipient, sendSlackTest, setSlackEnabled, type SlackSettings as Settings } from '@/lib/slackApi';
import { IconClose } from './icons';
import { Alert, Btn, IconBtn, Input, Switch, cx } from './ui';

/**
 * 슬랙 개인 DM 알림 — 팀별 on/off + 받는 사람(회사 이메일) 목록 + 테스트 DM
 * 알림 종류별 on/off 는 위 푸시 설정과 함께 씀 (NotifSettings)
 * onEnabled: 켜짐 상태를 부모에 알림 (종류별 스위치를 푸시 또는 슬랙이 켜져 있으면 쓸 수 있게)
 */
export default function SlackSettings({ onEnabled }: { onEnabled: (on: boolean) => void }) {
  const { session, teams } = useAppState();
  const teamId = Number(teams.find(t => t.name === session?.team)?.id);
  const [s, setS] = useState<Settings | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'success'; text: string } | null>(null);

  const reload = async () => {
    try {
      const next = await loadSlack();
      setS(next);
      onEnabled(next.enabled);
    } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const toggle = (on: boolean) => run(async () => { await setSlackEnabled(teamId, on); await reload(); });
  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!isEmail(v)) { setMsg({ tone: 'warn', text: '회사 이메일 주소를 입력하세요' }); return; }
    void run(async () => { await addSlackRecipient(teamId, v); setEmail(''); await reload(); });
  };
  const remove = (id: number) => run(async () => { await removeSlackRecipient(id); await reload(); });
  const test = () => run(async () => {
    const r = await sendSlackTest();
    await reload();
    setMsg(r.sent > 0
      ? { tone: r.failed ? 'warn' : 'success', text: `${r.sent}명에게 테스트 DM 을 보냈어요${r.failed ? ` · ${r.failed}명 실패 (아래 표시 확인)` : ''}` }
      : { tone: 'warn', text: '보내지 못했어요. 이메일이 회사 슬랙 계정 이메일과 같은지 확인하세요' });
  });

  if (!s) return msg ? <Alert variant="warn">{msg.text}</Alert> : null;
  const full = s.recipients.length >= MAX_SLACK_RECIPIENTS;

  return (
    <div className="slack-set">
      <div className="notif-set__row notif-set__row--main">
        <div className="grow">
          <div className="notif-set__label">슬랙 DM 알림</div>
          <div className="notif-set__desc">앱을 닫아 두어도 아래 사람들에게 회사 슬랙 DM 으로 알려 줘요</div>
        </div>
        <Switch checked={s.enabled} onChange={on => { void toggle(on); }} label="슬랙 DM 알림" text={s.enabled ? 'ON' : 'OFF'} disabled={busy} />
      </div>

      <div className={cx('slack-set__people', !s.enabled && 'is-off')}>
        <div className="notif-set__label">받는 사람 <span className="slack-set__count">{s.recipients.length}/{MAX_SLACK_RECIPIENTS}</span></div>
        {s.recipients.length === 0 && <div className="notif-set__desc">아직 없어요. 팀원 회사 이메일(슬랙 로그인 이메일)을 추가하세요.</div>}
        <ul className="slack-set__list">
          {s.recipients.map(r => (
            <li key={r.id} className="slack-set__item">
              <span className="slack-set__email">{r.email}</span>
              <span className={cx('slack-set__state', r.linked === true && 'is-ok', r.linked === false && 'is-err')} title={r.error ?? undefined}>
                {r.linked === true ? '연결됨' : r.linked === false ? (r.error ?? '확인 필요') : '발송 전'}
              </span>
              <IconBtn aria-label={`${r.email} 받는 사람에서 빼기`} title="빼기" disabled={busy} onClick={() => { void remove(r.id); }}><IconClose size={13} /></IconBtn>
            </li>
          ))}
        </ul>
        <form className="slack-set__add" onSubmit={add}>
          <Input type="email" inputMode="email" autoComplete="off" placeholder="name@company.com" aria-label="받는 사람 회사 이메일"
            value={email} onChange={e => setEmail(e.target.value)} onClear={() => setEmail('')} disabled={busy || full} />
          <Btn type="submit" size="sm" variant="secondary" disabled={busy || full || !email.trim()}>추가</Btn>
        </form>
      </div>

      {msg && <Alert variant={msg.tone}>{msg.text}</Alert>}
      {s.recipients.length > 0 && (
        <Btn variant="secondary" size="sm" disabled={busy} onClick={() => { void test(); }}>테스트 DM 보내기</Btn>
      )}
    </div>
  );
}
