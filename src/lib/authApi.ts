import { FunctionsHttpError } from '@supabase/supabase-js';
import type { MemberInfo, Team, UnitLevel } from '@/types';
import { supabase } from './supabase';

/**
 * 로그인 · 사용자 · 조직 API (Supabase) — v3.0 조직 + 사용자(1인 1계정, 사번 로그인)
 *   db/migrations/20261111b_org_members.sql + supabase/functions (import-members · create-member · …)
 * 비밀번호 · 초기 비밀번호는 저장하거나 기록하지 않음 (초기 비밀번호는 서버가 본인 슬랙 DM 으로 보냄)
 */

/** Edge Function 오류 코드 (supabase/functions/_shared/mod.ts ErrorCode) + 로그인 실패 */
export type AuthErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'already_setup' | 'duplicate' | 'weak_password'
  | 'same_password' | 'wrong_password' | 'not_found' | 'self_target' | 'last_admin'
  | 'invalid_login' | 'not_member' | 'network' | 'server';

export class AuthApiError extends Error {
  constructor(public code: AuthErrorCode, message: string) { super(message); }
}

/** 로그인용 내부 이메일 — supabase/functions/_shared/mod.ts loginEmailOf 와 같은 규칙 (화면에는 안 보임) */
const LOGIN_EMAIL_DOMAIN = 'members.cowork-coin.app';
export const loginEmailOf = (employeeNo: string) => `m-${employeeNo.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

const client = () => {
  if (!supabase) throw new AuthApiError('server', 'Supabase 연결 설정이 없습니다');
  return supabase;
};
const fail = (message: string): never => { throw new AuthApiError('network', message); };
/** DB 함수(RPC) 오류 → 화면 문구 (함수가 RAISE 한 한국어 문구를 그대로) */
const rpcFail = (error: { message?: string; code?: string }, fallback: string): never => {
  if (/관리자가 최소|관리자.*있어야/.test(error.message ?? '')) throw new AuthApiError('last_admin', '활성 관리자가 한 명은 있어야 합니다');
  throw new AuthApiError('forbidden', error.message || fallback);
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = await (error.context as Response).json().catch(() => null) as { error?: AuthErrorCode; message?: string } | null;
      throw new AuthApiError(j?.error ?? 'server', j?.message ?? '요청을 처리하지 못했습니다');
    }
    fail('서버에 연결할 수 없습니다. 네트워크를 확인하세요');
  }
  return data as T;
}

type TeamRow = { id: number; name: string; is_active: boolean; unit_level: UnitLevel; parent_id: number | null };
const TEAM_COLS = 'id, name, is_active, unit_level, parent_id';
/** 서버 조직 행 → 앱 팀 (id 는 DB id 문자열) */
export const toTeam = (r: TeamRow): Team => ({
  id: String(r.id), name: r.name, password: '', active: r.is_active, level: r.unit_level,
  parentId: r.parent_id == null ? undefined : String(r.parent_id),
});

type MemberRow = {
  id: number; employee_no: string; name: string; position: string | null; email: string | null; team_id: number;
  is_admin: boolean; is_active: boolean; must_change_password: boolean; slack_user_id?: string | null; slack_error?: string | null;
};
const MEMBER_COLS = 'id, employee_no, name, position, email, team_id, is_admin, is_active, must_change_password';
const toMemberInfo = (r: MemberRow): MemberInfo => ({
  id: String(r.id), employeeNo: r.employee_no, name: r.name, position: r.position, email: r.email, mustChangePassword: r.must_change_password,
});

// ── 로그인 전 ──
export async function needsSetup(): Promise<boolean> {
  const { data, error } = await client().rpc('needs_setup');
  if (error) fail('서버에 연결할 수 없습니다. 네트워크를 확인하세요');
  return !!data;
}

// ── 로그인 · 세션 ──
export async function signIn(employeeNo: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email: loginEmailOf(employeeNo), password });
  if (error) {
    if (error.status === 400 || error.code === 'invalid_credentials') throw new AuthApiError('invalid_login', '사번 또는 비밀번호가 일치하지 않습니다.');
    fail('서버에 연결할 수 없습니다. 네트워크를 확인하세요');
  }
}
export async function hasSession(): Promise<boolean> {
  return !!(await client().auth.getSession()).data.session;
}
export async function signOut(scope: 'local' | 'global' = 'local') {
  await client().auth.signOut({ scope }).catch(() => undefined);
}

/** 로그인한 사용자 · 소속 조직 · 권한 (초기 비밀번호 상태여도 내 정보 · 내 조직은 보임) */
export interface Me { member: MemberInfo; team: Team; active: boolean; isAdmin: boolean }
export async function myMember(): Promise<Me | null> {
  const s = (await client().auth.getSession()).data.session;
  if (!s) return null;
  const { data, error } = await client().from('members')
    .select(`${MEMBER_COLS}, team:teams!members_team_id_fkey(${TEAM_COLS})`).eq('auth_user_id', s.user.id).maybeSingle();
  if (error) fail('사용자 정보를 불러오지 못했습니다');
  if (!data) return null;
  const row = data as unknown as MemberRow & { team: TeamRow | null };
  if (!row.team) return null;
  return { member: toMemberInfo(row), team: toTeam(row.team), active: row.is_active && row.team.is_active, isAdmin: row.is_admin };
}

/** 전체 조직 (로그인 · 비밀번호 변경을 마친 사용자에게 보임) */
export async function listTeams(): Promise<Team[]> {
  const { data, error } = await client().from('teams').select(TEAM_COLS).order('id');
  if (error) fail('조직 목록을 불러오지 못했습니다');
  return ((data ?? []) as TeamRow[]).map(toTeam);
}

/** 내가 관리할 수 있는 조직 id — 관리자: 전체, 부서장 이상: 내 조직 아래, 그 외: 없음 */
export async function manageableTeamIds(): Promise<string[]> {
  const { data, error } = await client().rpc('manageable_team_ids');
  if (error) fail('관리 권한을 확인하지 못했습니다');
  return ((data ?? []) as unknown[]).map(v => String(typeof v === 'object' && v ? Object.values(v)[0] : v));
}

// ── 비밀번호 ──
export const changePassword = (current: string, next: string) => invoke<{ ok: true }>('change-password', { current, next });

// ── 사용자 관리 (관리자 · 부서장 이상) ──
export interface MemberAdminRow extends MemberInfo {
  teamId: string;
  isAdmin: boolean;
  active: boolean;
  /** 슬랙 DM — true 연결됨 · false 실패(이유는 slackError) · null 아직 보낸 적 없음 */
  slackLinked: boolean | null;
  slackError: string | null;
}
export async function listMembers(): Promise<MemberAdminRow[]> {
  const { data, error } = await client().from('members').select(`${MEMBER_COLS}, slack_user_id, slack_error`).order('team_id').order('id');
  if (error) fail('사용자 목록을 불러오지 못했습니다');
  return ((data ?? []) as MemberRow[]).map(r => ({
    ...toMemberInfo(r), teamId: String(r.team_id), isAdmin: r.is_admin, active: r.is_active,
    slackLinked: r.slack_user_id ? true : r.slack_error ? false : null, slackError: r.slack_error ?? null,
  }));
}

/** 엑셀 한 줄 — 소속 = 본부 · 부서 · 파트 중 가장 아래 칸 */
export interface ImportRow { employeeNo: string; name: string; position?: string; email?: string; hq: string; dept?: string; part?: string; isAdmin?: boolean }
export interface ImportResult { employeeNo: string; name: string; status: 'created' | 'exists' | 'error'; message?: string; dm?: boolean; tempPassword?: string }
/** 일괄 등록 — 사용자가 0명이면 로그인 없이(첫 설치), 아니면 관리자 · 부서장 이상 */
export const importMembers = (rows: ImportRow[]) => invoke<{ bootstrap: boolean; results: ImportResult[] }>('import-members', { rows });

export interface NewMember { employeeNo: string; name: string; position?: string; email?: string; teamId: string; isAdmin?: boolean }
/** 초기 비밀번호는 슬랙 DM 으로 — DM 을 못 보냈을 때만 tempPassword 가 옴 */
export const createMember = (m: NewMember) =>
  invoke<{ member: { id: number; employeeNo: string; name: string }; dm: boolean; tempPassword?: string }>('create-member', { ...m, teamId: Number(m.teamId) });
export const resetMemberPassword = (memberId: string) => invoke<{ dm: boolean; tempPassword?: string }>('reset-member-password', { memberId: Number(memberId) });
export const deleteMember = (memberId: string) => invoke<{ ok: true }>('delete-member', { memberId: Number(memberId) });

/** 성명 · 직위 · 이메일 · 소속 · 활성 · 관리자 (바꾸지 않을 값은 생략 · 빈 문자열은 지움) */
export async function updateMember(memberId: string, patch: { name?: string; position?: string; email?: string; teamId?: string; active?: boolean; isAdmin?: boolean }) {
  const { error } = await client().rpc('update_member', {
    p_id: Number(memberId), p_name: patch.name ?? null, p_position: patch.position ?? null, p_email: patch.email ?? null,
    p_team_id: patch.teamId ? Number(patch.teamId) : null, p_is_active: patch.active ?? null, p_is_admin: patch.isAdmin ?? null,
  });
  if (error) rpcFail(error, '사용자 정보를 바꾸지 못했습니다');
}

// ── 조직 관리 (관리자 · 부서장 이상은 내 조직 아래 파트만) ──
export async function saveTeam(t: { id?: string; name: string; level: UnitLevel; parentId?: string; active?: boolean }): Promise<string> {
  const { data, error } = await client().rpc('save_team', {
    p_id: t.id ? Number(t.id) : null, p_name: t.name, p_level: t.level, p_parent_id: t.parentId ? Number(t.parentId) : null, p_is_active: t.active ?? true,
  });
  if (error) rpcFail(error, '조직을 저장하지 못했습니다');
  return String(data);
}
export async function removeTeam(id: string) {
  const { error } = await client().rpc('delete_team', { p_id: Number(id) });
  if (error) rpcFail(error, '조직을 지우지 못했습니다');
}

// ── 슬랙 ──
/** 로그인한 본인에게 테스트 DM */
export const sendSlackTest = () => invoke<{ ok: boolean; message?: string }>('notify-slack', { action: 'test' });
