import { createClient } from '@supabase/supabase-js';

/**
 * Supabase 연결 — VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY 가 있으면 팀 로그인·계정을 Supabase Auth 로 처리
 *   (값이 없으면 이 브라우저 저장본으로 로그인)
 *   anon(publishable) 키는 브라우저에 공개되는 키. service_role 키는 절대 넣지 않음 (Edge Function 에서만)
 * 이번 단계는 로그인·팀 계정만 서버 — 프로젝트·집행 데이터는 아직 브라우저 저장본 (db/ERD.md §2-1)
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cowork-coin-auth' } })
  : null;

/** 로그인·팀 계정을 Supabase 로 처리하는지 */
export const REMOTE_AUTH = !!supabase;
