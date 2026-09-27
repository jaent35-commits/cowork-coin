// 코웍-코인 Edge Function 공통 — db/ERD.md §2-1
//   · 비밀번호·임시 비밀번호·토큰은 로그에 남기지 않음 (응답으로 한 번만 돌려줌)
//   · service_role 키는 Supabase 가 함수 환경변수로 넣어 줌 (SUPABASE_SERVICE_ROLE_KEY) — 코드·저장소에 두지 않음
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MIN_PASSWORD_LENGTH = 8;
/** 로그인용 내부 이메일 도메인 — 메일을 보내지 않으므로 받을 수 없는 주소여도 됨 (ERD §5-5) */
const LOGIN_EMAIL_DOMAIN = Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'teams.cowork-coin.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 앱이 화면 문구를 고르는 오류 코드 */
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'already_setup' | 'name_taken' | 'weak_password'
  | 'same_password' | 'wrong_password' | 'not_found' | 'self_target' | 'has_history' | 'last_admin' | 'server';

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
      // 원인만 기록 (요청 본문·비밀번호는 남기지 않음)
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

export type TeamRow = {
  id: number; auth_user_id: string; login_email: string; name: string;
  is_active: boolean; is_admin: boolean; must_change_password: boolean;
};
const TEAM_COLS = 'id, auth_user_id, login_email, name, is_active, is_admin, must_change_password';

export const bearer = (req: Request) => (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');

/** 호출한 팀 — 로그인 세션(JWT)의 Auth 사용자로 teams 행을 찾음 */
export async function caller(req: Request): Promise<TeamRow> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'unauthorized', '로그인이 필요합니다');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized', '로그인이 만료되었습니다. 다시 로그인하세요');
  const { data: team } = await admin.from('teams').select(TEAM_COLS).eq('auth_user_id', data.user.id).maybeSingle();
  if (!team) throw new HttpError(403, 'forbidden', '팀 계정이 아닙니다');
  return team as TeamRow;
}

/** 관리자 메뉴 호출 — 활성 · 비밀번호 변경 완료 · 관리자 팀만 (current_team_id() 와 같은 조건) */
export async function adminCaller(req: Request): Promise<TeamRow> {
  const t = await caller(req);
  if (!t.is_active || t.must_change_password || !t.is_admin) throw new HttpError(403, 'forbidden', '관리자 팀만 할 수 있습니다');
  return t;
}

export async function teamById(id: unknown): Promise<TeamRow> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'bad_request', '팀을 지정하세요');
  const { data } = await admin.from('teams').select(TEAM_COLS).eq('id', n).maybeSingle();
  if (!data) throw new HttpError(404, 'not_found', '팀을 찾을 수 없습니다');
  return data as TeamRow;
}

export function teamName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw new HttpError(400, 'bad_request', '팀명을 입력하세요');
  if (name.length > 50) throw new HttpError(400, 'bad_request', '팀명은 50자까지 입력할 수 있습니다');
  return name;
}

export async function assertNameFree(name: string) {
  const { data } = await admin.from('teams').select('id').eq('name', name).maybeSingle();
  if (data) throw new HttpError(409, 'name_taken', '이미 등록된 팀명입니다');
}

export function assertPassword(pw: unknown, current?: string): string {
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, 'weak_password', `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`);
  if (current != null && p === current) throw new HttpError(400, 'same_password', '지금 비밀번호와 다른 비밀번호를 입력하세요');
  return p;
}

/** 로그인용 내부 이메일 — 팀명과 무관한 임의 값 (팀명을 바꿔도 그대로) */
export const newLoginEmail = () => `team-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}@${LOGIN_EMAIL_DOMAIN}`;

// 임시 비밀번호 — 앱 src/lib/password.ts 와 같은 규칙 (8자, 글자+숫자, 0/O·1/l/I 제외)
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
export function makeTempPassword(): string {
  const all = LETTERS + DIGITS;
  const out = [LETTERS[rand(LETTERS.length)], DIGITS[rand(DIGITS.length)], ...Array.from({ length: 6 }, () => all[rand(all.length)])];
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** Auth 사용자 + teams 행 만들기 — teams 저장에 실패하면 Auth 사용자도 지움 */
export async function createTeamAccount(name: string, password: string, opts: { isAdmin: boolean; mustChange: boolean }): Promise<TeamRow> {
  const email = newLoginEmail();
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: 'team' } });
  if (ue || !u.user) throw new HttpError(500, 'server', '계정을 만들지 못했습니다');
  const { data: team, error: te } = await admin.from('teams').insert({
    auth_user_id: u.user.id, login_email: email, name, is_admin: opts.isAdmin,
    must_change_password: opts.mustChange, password_changed_at: opts.mustChange ? null : new Date().toISOString(),
  }).select(TEAM_COLS).single();
  if (te || !team) {
    await admin.auth.admin.deleteUser(u.user.id);
    if (te?.code === '23505') throw new HttpError(409, 'name_taken', '이미 등록된 팀명입니다');
    throw new HttpError(500, 'server', '팀을 저장하지 못했습니다');
  }
  return team as TeamRow;
}

/** 팀에게 설정 알림 (DB 알림함 — 앱 알림 연동 단계에서 사용) */
export async function notifySetting(teamId: number, title: string, body: string) {
  const { error } = await admin.from('notifications').insert({ type: 'setting', title, body, target_team_id: teamId });
  if (error) console.error('notify failed', error.code);
}
