// 알림 → 슬랙 개인 DM (v3.0: 조직 알림을 그 조직 사용자 각자에게 · deploy/SLACK.md)
//   ① Database Webhook (notifications INSERT) — 헤더 x-webhook-secret 로 확인
//      → 받는 조직(없으면 모든 활성 조직)의 활성 사용자 중 슬랙 DM 켜짐 · 이 종류 켜짐인 사람에게 회사 이메일로 DM
//   ② 앱 [테스트 DM 보내기] — 로그인한 사용자 본인에게 { action: 'test' }
//   환경변수: SLACK_BOT_TOKEN · SLACK_WEBHOOK_SECRET · APP_URL (Edge Function Secrets — 코드 · 저장소에 두지 않음)
import { HttpError, admin, caller, dmMember, json, serve, type MemberRow } from '../_shared/mod.ts';

const HOOK_SECRET = Deno.env.get('SLACK_WEBHOOK_SECRET') ?? '';

interface Notif { type: string; title: string; body: string; target_team_id: number | null }
type Prefs = { member_id: number; slack_enabled: boolean; push_setting: boolean; push_alloc: boolean; push_deadline: boolean; push_exec: boolean };

/** 종류별 on/off 열 (푸시 · 슬랙 공통) — 없는 종류(예산 경고 · 공지 등)는 늘 보냄 */
const KIND_COL: Record<string, keyof Prefs> = { setting: 'push_setting', alloc: 'push_alloc', deadline: 'push_deadline', exec: 'push_exec' };
const ICON: Record<string, string> = { alloc: '📁', deadline: '⏰', budget: '⚠️', setting: '🔐', project: '📌', admin: '🛡️', system: '📢', exec: '🧾' };

/** 길이가 달라도 시간 차이로 비밀값이 드러나지 않게 비교 */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && a.length > 0;
}

async function deliver(n: Notif) {
  let q = admin.from('members').select('id, email, slack_user_id, team_id').eq('is_active', true);
  if (n.target_team_id != null) q = q.eq('team_id', n.target_team_id);
  const { data: people } = await q;
  const list = (people ?? []) as Pick<MemberRow, 'id' | 'email' | 'slack_user_id' | 'team_id'>[];
  if (!list.length) return { sent: 0, skipped: 0 };
  // 받는 조직이 비활성이면 보내지 않음
  const { data: teams } = await admin.from('teams').select('id, name, is_active').in('id', [...new Set(list.map(p => p.team_id))]);
  const teamOf = new Map((teams ?? []).map(t => [t.id as number, t as { name: string; is_active: boolean }]));
  const { data: prefRows } = await admin.from('notification_prefs').select('*').in('member_id', list.map(p => p.id));
  const prefOf = new Map(((prefRows ?? []) as Prefs[]).map(p => [p.member_id, p]));

  let sent = 0, skipped = 0;
  for (const p of list) {
    const pref = prefOf.get(p.id); // 설정 행이 없으면 기본값: 슬랙 켜짐 · 종류 모두 켜짐
    const col = KIND_COL[n.type];
    if (!teamOf.get(p.team_id)?.is_active || pref?.slack_enabled === false || (col && pref?.[col] === false)) { skipped++; continue; }
    const ok = await dmMember(p, `${n.body}\n_${teamOf.get(p.team_id)?.name ?? ''} 알림_`, `${ICON[n.type] ?? '🔔'} ${n.title}`);
    if (ok) sent++;
  }
  return { sent, skipped };
}

serve(async (req, body) => {
  // ① Database Webhook — 새 알림
  if (req.headers.get('x-webhook-secret') != null) {
    if (!sameSecret(req.headers.get('x-webhook-secret') ?? '', HOOK_SECRET)) throw new HttpError(401, 'unauthorized', '웹훅 비밀값이 다릅니다');
    const n = (body.record ?? null) as Notif | null;
    if (body.type !== 'INSERT' || body.table !== 'notifications' || !n) return json({ ok: true, ignored: true });
    return json({ ok: true, ...(await deliver(n)) });
  }

  // ② 앱 — 테스트 DM (로그인한 본인에게)
  if (body.action === 'test') {
    const me = await caller(req);
    if (!me.is_active || me.must_change_password) throw new HttpError(403, 'forbidden', '사용할 수 없는 계정입니다');
    const ok = await dmMember(me, `${me.name}님 알림이 이 DM 으로 옵니다 🎉`, '슬랙 DM 연결 확인');
    if (!ok) {
      const { data } = await admin.from('members').select('slack_error').eq('id', me.id).single();
      return json({ ok: false, message: data?.slack_error ?? '보내지 못했습니다' });
    }
    return json({ ok: true });
  }
  throw new HttpError(400, 'bad_request', '알 수 없는 요청입니다');
});
