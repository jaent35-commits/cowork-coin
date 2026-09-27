import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Team } from '@/types';
import { supabase } from './supabase';

/**
 * 팀 로그인·계정 API (Supabase) — db/supabase.sql 함수 + supabase/functions Edge Function
 * 비밀번호·임시 비밀번호는 저장하거나 기록하지 않음 (임시 비밀번호는 응답으로 받은 뒤 화면에 한 번만)
 */

/** Edge Function 오류 코드 (supabase/functions/_shared/mod.ts ErrorCode) + 로그인 실패 */
export type AuthErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'already_setup' | 'name_taken' | 'weak_password'
  | 'same_password' | 'wrong_password' | 'not_found' | 'self_target' | 'has_history' | 'last_admin'
  | 'invalid_login' | 'not_team' | 'network' | 'server';

export class AuthApiError extends Error {
  constructor(public code: AuthErrorCode, message: string) { super(message); }
}

type TeamRow = { id: number; name: string; is_active: boolean; is_admin: boolean; must_change_password: boolean };
export type LoginTeam = { name: string; login_email: string };

const client = () => {
  if (!supabase) throw new AuthApiError('server', 'Supabase 연결 설정이 없습니다');
  return supabase;
};
const fail = (message: string): never => { throw new AuthApiError('network', message); };

/** 서버 팀 행 → 앱 팀 (id 는 DB id 문자열, 비밀번호는 앱에 두지 않음) */
export const toTeam = (r: TeamRow): Team => ({
  id: String(r.id), name: r.name, password: '', active: r.is_active, isAdmin: r.is_admin, mustChangePassword: r.must_change_password,
});

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

// ── 로그인 전 ──
export async function needsSetup(): Promise<boolean> {
  const { data, error } = await client().rpc('needs_setup');
  if (error) fail('서버에 연결할 수 없습니다. 네트워크를 확인하세요');
  return !!data;
}
export async function loginTeams(): Promise<LoginTeam[]> {
  const { data, error } = await client().rpc('login_teams');
  if (error) fail('팀 목록을 불러오지 못했습니다. 네트워크를 확인하세요');
  return (data ?? []) as LoginTeam[];
}
export async function bootstrapAdmin(name: string, password: string) {
  return invoke<{ team: { id: number; name: string; login_email: string } }>('bootstrap-admin', { name, password });
}

// ── 로그인 · 세션 ──
export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 400 || error.code === 'invalid_credentials') throw new AuthApiError('invalid_login', '팀 또는 비밀번호가 일치하지 않습니다.');
    fail('서버에 연결할 수 없습니다. 네트워크를 확인하세요');
  }
}
export async function hasSession(): Promise<boolean> {
  return !!(await client().auth.getSession()).data.session;
}
export async function signOut(scope: 'local' | 'global' = 'local') {
  await client().auth.signOut({ scope }).catch(() => undefined);
}

/** 로그인한 팀 (상태 무관 — 자기 팀 행은 항상 보임) */
export async function myTeam(): Promise<Team | null> {
  const s = (await client().auth.getSession()).data.session;
  if (!s) return null;
  const { data, error } = await client().from('teams').select('id, name, is_active, is_admin, must_change_password')
    .eq('auth_user_id', s.user.id).maybeSingle();
  if (error) fail('팀 정보를 불러오지 못했습니다');
  return data ? toTeam(data as TeamRow) : null;
}
/** 전체 팀 (활성 + 비밀번호 변경 완료 팀만 다른 팀이 보임) */
export async function listTeams(): Promise<Team[]> {
  const { data, error } = await client().from('teams').select('id, name, is_active, is_admin, must_change_password').order('id');
  if (error) fail('팀 목록을 불러오지 못했습니다');
  return ((data ?? []) as TeamRow[]).map(toTeam);
}

// ── 비밀번호 ──
export const changePassword = (current: string, next: string) => invoke<{ ok: true }>('change-password', { current, next });

// ── 관리자 메뉴 ──
export const createTeam = (name: string) => invoke<{ team: { id: number; name: string }; tempPassword: string }>('admin-create-team', { name });
export const resetPassword = (teamId: string) => invoke<{ tempPassword: string }>('admin-reset-password', { teamId: Number(teamId) });
export const deleteTeam = (teamId: string) => invoke<{ ok: true }>('admin-delete-team', { teamId: Number(teamId) });
/** 이름 · 휴면 · 관리자 권한 (바꾸지 않을 값은 생략) */
export async function updateTeam(teamId: string, patch: { name?: string; active?: boolean; isAdmin?: boolean }) {
  const { error } = await client().rpc('admin_update_team', {
    p_team_id: Number(teamId), p_name: patch.name ?? null, p_is_active: patch.active ?? null, p_is_admin: patch.isAdmin ?? null,
  });
  if (error) {
    if (error.code === '23505') throw new AuthApiError('name_taken', '이미 등록된 팀명입니다');
    if (/관리자 팀/.test(error.message) && /최소|하나|있어야/.test(error.message)) throw new AuthApiError('last_admin', '활성 관리자 팀이 하나는 있어야 합니다');
    throw new AuthApiError('forbidden', error.message || '변경하지 못했습니다');
  }
}
