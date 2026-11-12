// 코웍-코인 Edge Function 공통 — v3.0 조직 + 사용자(1인 1계정, 사번 로그인) · db/migrations/20261111b_org_members.sql
//   · 비밀번호 · 초기 비밀번호 · 토큰은 로그에 남기지 않음 (초기 비밀번호는 슬랙 DM 으로만, DM 실패 때만 응답으로 한 번)
//   · service_role 키 · 슬랙 봇 토큰은 Supabase 가 함수 환경변수로 넣어 줌 — 코드 · 저장소에 두지 않음
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MIN_PASSWORD_LENGTH = 8;
/** 로그인용 내부 이메일 도메인 — 앱 src/lib/authApi.ts LOGIN_EMAIL_DOMAIN 과 같아야 함 (메일을 보내지 않음) */
export const LOGIN_EMAIL_DOMAIN = 'members.cowork-coin.app';
/** 사번 → 로그인용 내부 이메일 (앱도 같은 규칙으로 만들어 로그인) */
export const loginEmailOf = (employeeNo: string) => `m-${employeeNo.toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

const SLACK_TOKEN = Deno.env.get('SLACK_BOT_TOKEN') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://cw-coin.duckdns.org').replace(/\/+$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 앱이 화면 문구를 고르는 오류 코드 */
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'already_setup' | 'duplicate' | 'weak_password'
  | 'same_password' | 'wrong_password' | 'not_found' | 'self_target' | 'last_admin' | 'server';

export class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string) { super(message); }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** 요청 처리 틀 — CORS · POST 만 · 오류를 { error, message } 로 */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'bad_request', message: 'POST 만 지원합니다' }, 405);
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      return await handler(req, body);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      // 원인만 기록 (요청 본문 · 비밀번호는 남기지 않음)
      console.error('unexpected', e instanceof Error ? e.message : String(e));
      return json({ error: 'server', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }, 500);
    }
  });
}

export const admin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** 현재 비밀번호 확인용 — 세션을 저장하지 않는 일반(anon) 클라이언트 */
export const anonClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export type MemberRow = {
  id: number; auth_user_id: string; login_email: string; employee_no: string; name: string; position: string | null;
  email: string | null; team_id: number; is_admin: boolean; is_active: boolean; must_change_password: boolean;
  slack_user_id: string | null;
};
export const MEMBER_COLS = 'id, auth_user_id, login_email, employee_no, name, position, email, team_id, is_admin, is_active, must_change_password, slack_user_id';

export type TeamRow = { id: number; name: string; unit_level: '회사' | '본부' | '부서' | '파트'; parent_id: number | null; is_active: boolean };
export const TEAM_COLS = 'id, name, unit_level, parent_id, is_active';

export const bearer = (req: Request) => (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');

/** 호출한 사용자 — 로그인 세션(JWT)의 Auth 사용자로 members 행을 찾음 (초기 비밀번호 상태도 포함) */
export async function caller(req: Request): Promise<MemberRow> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'unauthorized', '로그인이 필요합니다');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized', '로그인이 만료되었습니다. 다시 로그인하세요');
  const { data: m } = await admin.from('members').select(MEMBER_COLS).eq('auth_user_id', data.user.id).maybeSingle();
  if (!m) throw new HttpError(403, 'forbidden', '사용자 계정이 아닙니다');
  return m as MemberRow;
}

/** 관리 권한이 있는 호출자 — 관리자 또는 부서장 이상(소속이 본부 · 부서). 관리 범위 조직 id 도 함께 */
export async function managerCaller(req: Request): Promise<{ me: MemberRow; scope: Set<number> }> {
  const me = await caller(req);
  if (!me.is_active || me.must_change_password) throw new HttpError(403, 'forbidden', '사용할 수 없는 계정입니다');
  const { data, error } = await admin.rpc('manageable_team_ids_of', { p_member_id: me.id });
  if (error) throw new HttpError(500, 'server', '권한을 확인하지 못했습니다');
  const scope = new Set(((data ?? []) as unknown[]).map(v => Number(typeof v === 'object' && v ? Object.values(v)[0] : v)));
  if (!scope.size) throw new HttpError(403, 'forbidden', '사용자 관리는 관리자 또는 부서장 이상만 할 수 있습니다');
  return { me, scope };
}

export async function memberById(id: unknown): Promise<MemberRow> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'bad_request', '사용자를 지정하세요');
  const { data } = await admin.from('members').select(MEMBER_COLS).eq('id', n).maybeSingle();
  if (!data) throw new HttpError(404, 'not_found', '사용자를 찾을 수 없습니다');
  return data as MemberRow;
}

export async function teamById(id: unknown): Promise<TeamRow> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'bad_request', '소속 조직을 지정하세요');
  const { data } = await admin.from('teams').select(TEAM_COLS).eq('id', n).maybeSingle();
  if (!data) throw new HttpError(404, 'not_found', '조직을 찾을 수 없습니다');
  return data as TeamRow;
}

/* ── 입력 검사 ── */
export function employeeNo(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^[0-9A-Za-z]{3,20}$/.test(s)) throw new HttpError(400, 'bad_request', '사번은 영문 · 숫자 3~20자입니다');
  return s;
}
export function personName(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, 'bad_request', '성명을 입력하세요');
  if (s.length > 30) throw new HttpError(400, 'bad_request', '성명은 30자까지 입력할 수 있습니다');
  return s;
}
export const optionalText = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
export function companyEmail(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new HttpError(400, 'bad_request', `이메일 형식이 아닙니다: ${s}`);
  return s;
}
export function assertPassword(pw: unknown, current?: string): string {
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, 'weak_password', `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`);
  if (current != null && p === current) throw new HttpError(400, 'same_password', '지금 비밀번호와 다른 비밀번호를 입력하세요');
  return p;
}

// 초기 비밀번호 — 앱 src/lib/password.ts 와 같은 규칙 (8자, 글자+숫자, 0/O·1/l/I 제외)
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
export function makeTempPassword(): string {
  const all = LETTERS + DIGITS;
  const out = [LETTERS[rand(LETTERS.length)], DIGITS[rand(DIGITS.length)], ...Array.from({ length: 6 }, () => all[rand(all.length)])];
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** Auth 사용자 + members 행 만들기 — members 저장에 실패하면 Auth 사용자도 지움 */
export async function createMemberAccount(p: {
  employeeNo: string; name: string; position: string | null; email: string | null; teamId: number; isAdmin: boolean;
}, password: string): Promise<MemberRow> {
  const login = loginEmailOf(p.employeeNo);
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email: login, password, email_confirm: true, user_metadata: { kind: 'member' } });
  if (ue || !u.user) {
    if (/already/i.test(ue?.message ?? '')) throw new HttpError(409, 'duplicate', `이미 등록된 사번입니다: ${p.employeeNo}`);
    throw new HttpError(500, 'server', '계정을 만들지 못했습니다');
  }
  const { data: m, error: me } = await admin.from('members').insert({
    auth_user_id: u.user.id, login_email: login, employee_no: p.employeeNo, name: p.name, position: p.position,
    email: p.email, team_id: p.teamId, is_admin: p.isAdmin, must_change_password: true,
  }).select(MEMBER_COLS).single();
  if (me || !m) {
    await admin.auth.admin.deleteUser(u.user.id);
    if (me?.code === '23505') throw new HttpError(409, 'duplicate', `이미 등록된 사번입니다: ${p.employeeNo}`);
    throw new HttpError(500, 'server', '사용자를 저장하지 못했습니다');
  }
  return m as MemberRow;
}

/* ── 슬랙 DM (초기 비밀번호 안내 · 알림) ── */
async function slack(method: string, params: Record<string, string>, get = false) {
  const url = `https://slack.com/api/${method}${get ? `?${new URLSearchParams(params)}` : ''}`;
  const res = await fetch(url, {
    method: get ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, ...(get ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
    body: get ? undefined : JSON.stringify(params),
  });
  return (await res.json()) as { ok: boolean; error?: string; user?: { id: string; deleted?: boolean }; channel?: { id: string } };
}

/**
 * 사용자 한 명에게 DM — 회사 이메일로 슬랙 계정을 찾아(처음 한 번 저장) 보냄
 * 실패 이유는 members.slack_error 에 남김 (메시지 내용은 남기지 않음). 보냈으면 true
 */
export async function dmMember(m: Pick<MemberRow, 'id' | 'email' | 'slack_user_id'>, text: string, title?: string): Promise<boolean> {
  if (!SLACK_TOKEN) {
    await admin.from('members').update({ slack_error: '서버에 슬랙 봇 토큰(SLACK_BOT_TOKEN)이 설정되지 않았습니다' }).eq('id', m.id);
    return false;
  }
  if (!m.email) { await admin.from('members').update({ slack_error: '회사 이메일이 없습니다' }).eq('id', m.id); return false; }
  let user = m.slack_user_id;
  if (!user) {
    const found = await slack('users.lookupByEmail', { email: m.email }, true);
    user = found.ok && found.user && !found.user.deleted ? found.user.id : null;
    if (!user) { await admin.from('members').update({ slack_user_id: null, slack_error: '슬랙에서 이 이메일의 계정을 찾지 못했습니다' }).eq('id', m.id); return false; }
  }
  const im = await slack('conversations.open', { users: user });
  const channel = im.ok ? im.channel?.id : undefined;
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: title ? `*${title}*\n${text}` : text } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '코웍-코인 열기' }, url: APP_URL }] },
  ];
  const sent = channel
    ? await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text: title ? `${title}\n${text}` : text, blocks, unfurl_links: false }),
    }).then(r => r.json() as Promise<{ ok: boolean; error?: string }>)
    : im;
  const reset = !sent.ok && /user_not_found|user_disabled|cannot_dm|channel_not_found/.test(sent.error ?? '');
  await admin.from('members').update({
    slack_user_id: reset ? null : user,
    slack_error: sent.ok ? null : `슬랙 발송 실패 (${sent.error ?? 'unknown'})`.slice(0, 100),
  }).eq('id', m.id);
  return sent.ok;
}

/** 가입 · 초기화 안내 DM — 보냈으면 true (실패하면 화면에 초기 비밀번호를 한 번 보여 줌) */
export const dmWelcome = (m: MemberRow, temp: string) =>
  dmMember(m, `아이디는 사번(${m.employee_no})이고, 초기 비밀번호는 \`${temp}\` 입니다.\n첫 로그인 후 새 비밀번호로 바꿔 주세요.`, '코웍-코인 회원가입이 완료되었습니다');
export const dmReset = (m: MemberRow, temp: string) =>
  dmMember(m, `비밀번호가 초기화되었습니다. 초기 비밀번호 : \`${temp}\`\n로그인 후 새 비밀번호로 바꿔 주세요.`, '코웍-코인 비밀번호 초기화');
// 비밀번호 관련 안내는 본인 DM 으로만 — 조직 알림함(notifications)은 조직 전원이 보므로 쓰지 않음
