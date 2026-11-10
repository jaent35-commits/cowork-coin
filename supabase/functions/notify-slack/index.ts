// 알림 → 슬랙 개인 DM (db/migrations/20261110_slack_dm.sql · deploy/SLACK.md)
//   ① Database Webhook (notifications INSERT) — 헤더 x-webhook-secret 로 확인 → 받는 팀의 등록된 사람에게 DM
//   ② 앱의 [테스트 DM 보내기] — 로그인한 팀 세션(JWT)으로 { action: 'test' } → 우리 팀 받는 사람에게 테스트 DM
//   대시보드 편집기에 그대로 붙여 넣을 수 있게 다른 파일을 가져오지 않음
//
//   환경변수 (Edge Function Secrets — 코드·저장소에 두지 않음)
//     SLACK_BOT_TOKEN       슬랙 봇 토큰 (xoxb-…, 권한: chat:write · im:write · users:read · users:read.email)
//     SLACK_WEBHOOK_SECRET  Database Webhook 헤더 x-webhook-secret 값 (임의의 긴 문자열)
//     APP_URL               메시지의 [앱에서 보기] 주소 (기본 https://cw-coin.duckdns.org)
//   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 넣어 줌
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SLACK_TOKEN = Deno.env.get('SLACK_BOT_TOKEN') ?? '';
const HOOK_SECRET = Deno.env.get('SLACK_WEBHOOK_SECRET') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://cw-coin.duckdns.org').replace(/\/+$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface Notif { id?: number; type: string; title: string; body: string; target_team_id: number | null }
interface Recipient { id: number; email: string; slack_user_id: string | null }

/** 종류별 on/off 열 — 없는 종류(예산 경고 · 공지 등)는 늘 보냄 */
const KIND_COL: Record<string, 'push_setting' | 'push_alloc' | 'push_deadline' | 'push_exec'> = {
  setting: 'push_setting', alloc: 'push_alloc', deadline: 'push_deadline', exec: 'push_exec',
};
const ICON: Record<string, string> = { alloc: '📁', deadline: '⏰', budget: '⚠️', setting: '🔐', project: '📌', admin: '🛡️', system: '📢', exec: '🧾' };

/** 길이가 달라도 시간 차이로 비밀값이 드러나지 않게 비교 */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && a.length > 0;
}

async function slack(method: string, params: Record<string, unknown>, get = false) {
  const url = `https://slack.com/api/${method}${get ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`;
  const res = await fetch(url, {
    method: get ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, ...(get ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
    body: get ? undefined : JSON.stringify(params),
  });
  return (await res.json()) as { ok: boolean; error?: string; user?: { id: string; deleted?: boolean }; channel?: { id: string } };
}

/** 이메일 → 슬랙 계정 (처음 한 번만 찾고 저장) */
async function slackUserOf(r: Recipient): Promise<string | null> {
  if (r.slack_user_id) return r.slack_user_id;
  const found = await slack('users.lookupByEmail', { email: r.email }, true);
  const id = found.ok && found.user && !found.user.deleted ? found.user.id : null;
  await db.from('slack_recipients').update({ slack_user_id: id, last_error: id ? null : '슬랙에서 이 이메일의 계정을 찾지 못했어요' }).eq('id', r.id);
  return id;
}

/** 한 사람에게 DM — 실패 이유는 받는 사람 행에 남김 (메시지 내용은 남기지 않음) */
async function dm(r: Recipient, n: Notif, teamName: string): Promise<boolean> {
  const user = await slackUserOf(r);
  if (!user) return false;
  const im = await slack('conversations.open', { users: user });
  const channel = im.ok ? im.channel?.id : undefined;
  const sent = channel
    ? await slack('chat.postMessage', {
      channel,
      text: `코웍-코인 · ${n.title}\n${n.body}`, // 알림 미리보기 · 블록을 못 그리는 곳
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${ICON[n.type] ?? '🔔'} ${n.title}*\n${n.body}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `${teamName} 알림 · 코웍-코인` }] },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '앱에서 보기' }, url: `${APP_URL}/#/notification` }] },
      ],
      unfurl_links: false,
    })
    : im;
  const error = sent.ok ? null : `슬랙 발송 실패 (${sent.error ?? 'unknown'})`.slice(0, 100);
  // 계정이 바뀌었을 수 있으면(비활성 · 없음) 다음에 이메일로 다시 찾게 비움
  const reset = !sent.ok && /user_not_found|user_disabled|cannot_dm|channel_not_found/.test(sent.error ?? '');
  await db.from('slack_recipients').update({ last_error: error, ...(reset ? { slack_user_id: null } : {}) }).eq('id', r.id);
  return sent.ok;
}

/** 팀 한 곳에 보내기 — 슬랙 DM 꺼짐 · 이 종류 꺼짐이면 건너뜀 (force: 테스트 DM) */
async function sendToTeam(teamId: number, n: Notif, force = false) {
  const { data: team } = await db.from('teams').select('name, is_active').eq('id', teamId).maybeSingle();
  if (!team?.is_active) return { sent: 0, failed: 0, skipped: 'inactive' };
  if (!force) {
    const { data: pref } = await db.from('notification_prefs').select('*').eq('team_id', teamId).maybeSingle();
    if (!pref?.slack_enabled) return { sent: 0, failed: 0, skipped: 'off' };
    const col = KIND_COL[n.type];
    if (col && pref[col] === false) return { sent: 0, failed: 0, skipped: 'kind-off' };
  }
  const { data: people } = await db.from('slack_recipients').select('id, email, slack_user_id').eq('team_id', teamId).order('id');
  let sent = 0, failed = 0;
  for (const r of (people ?? []) as Recipient[]) (await dm(r, n, team.name)) ? sent++ : failed++;
  return { sent, failed };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'bad_request' }, 405);
  if (!SLACK_TOKEN) return json({ error: 'server', message: '슬랙 봇 토큰이 설정되지 않았습니다' }, 500);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ① Database Webhook — 새 알림
    if (req.headers.get('x-webhook-secret') != null) {
      if (!sameSecret(req.headers.get('x-webhook-secret') ?? '', HOOK_SECRET)) return json({ error: 'unauthorized' }, 401);
      const n = (body.record ?? null) as Notif | null;
      if (body.type !== 'INSERT' || body.table !== 'notifications' || !n) return json({ ok: true, ignored: true });
      // 받는 팀이 없으면(모든 팀 대상) 활성 팀 모두
      const ids = n.target_team_id != null
        ? [n.target_team_id]
        : ((await db.from('teams').select('id').eq('is_active', true)).data ?? []).map(t => t.id as number);
      const results = [];
      for (const id of ids) results.push(await sendToTeam(id, n));
      return json({ ok: true, teams: ids.length, sent: results.reduce((s, r) => s + r.sent, 0) });
    }

    // ② 앱 — 테스트 DM (로그인한 팀만)
    if (body.action === 'test') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = token ? await db.auth.getUser(token) : { data: { user: null } };
      if (!u.user) return json({ error: 'unauthorized', message: '로그인이 필요합니다' }, 401);
      const { data: team } = await db.from('teams').select('id, name, is_active, must_change_password').eq('auth_user_id', u.user.id).maybeSingle();
      if (!team || !team.is_active || team.must_change_password) return json({ error: 'forbidden', message: '사용할 수 없는 팀 계정입니다' }, 403);
      const r = await sendToTeam(team.id, { type: 'system', title: '슬랙 DM 연결 확인', body: `${team.name} 알림이 이 DM 으로 옵니다 🎉`, target_team_id: team.id }, true);
      return json({ ok: true, ...r });
    }
    return json({ error: 'bad_request' }, 400);
  } catch (e) {
    console.error('notify-slack', e instanceof Error ? e.message : String(e));
    return json({ error: 'server', message: '슬랙 발송 중 오류가 발생했습니다' }, 500);
  }
});
