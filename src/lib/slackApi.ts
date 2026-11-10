import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * 슬랙 개인 DM 알림 설정 (db/migrations/20261110_slack_dm.sql · supabase/functions/notify-slack)
 * - 팀별 on/off: notification_prefs.slack_enabled
 * - 받는 사람: slack_recipients (회사 이메일 — 슬랙 계정은 서버가 처음 발송할 때 찾아 저장)
 */
export interface SlackRecipient {
  id: number;
  email: string;
  /** 슬랙 계정을 찾았는지 (null = 아직 보낸 적 없음) */
  linked: boolean | null;
  error: string | null;
}
export interface SlackSettings { enabled: boolean; recipients: SlackRecipient[] }

export const MAX_SLACK_RECIPIENTS = 20;
export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

const db = () => {
  if (!supabase) throw new Error('Supabase 연결 설정이 없습니다');
  return supabase;
};

export async function loadSlack(): Promise<SlackSettings> {
  const [pref, people] = await Promise.all([
    db().from('notification_prefs').select('slack_enabled').maybeSingle(),
    db().from('slack_recipients').select('id, email, slack_user_id, last_error').order('id'),
  ]);
  if (pref.error || people.error) throw new Error('슬랙 알림 설정을 불러오지 못했습니다');
  return {
    enabled: !!pref.data?.slack_enabled,
    recipients: (people.data ?? []).map(r => ({
      id: r.id as number, email: r.email as string,
      linked: r.slack_user_id ? true : r.last_error ? false : null, error: (r.last_error as string | null) ?? null,
    })),
  };
}

/** 슬랙 DM on/off — 알림 설정 행이 없으면 만듦 (푸시 설정 열은 기본값 그대로) */
export async function setSlackEnabled(teamId: number, on: boolean) {
  const { error } = await db().from('notification_prefs').upsert({ team_id: teamId, slack_enabled: on }, { onConflict: 'team_id' });
  if (error) throw new Error('슬랙 알림 설정을 저장하지 못했습니다');
}

export async function addSlackRecipient(teamId: number, email: string) {
  const { error } = await db().from('slack_recipients').insert({ team_id: teamId, email: email.trim() });
  if (error) throw new Error(error.code === '23505' ? '이미 등록된 이메일입니다' : '받는 사람을 추가하지 못했습니다');
}

export async function removeSlackRecipient(id: number) {
  const { error } = await db().from('slack_recipients').delete().eq('id', id);
  if (error) throw new Error('받는 사람을 지우지 못했습니다');
}

/** 우리 팀 받는 사람에게 테스트 DM — 보낸 · 실패한 사람 수 */
export async function sendSlackTest(): Promise<{ sent: number; failed: number }> {
  const { data, error } = await db().functions.invoke('notify-slack', { body: { action: 'test' } });
  if (error) {
    const j = error instanceof FunctionsHttpError ? await (error.context as Response).json().catch(() => null) as { message?: string } | null : null;
    throw new Error(j?.message ?? '테스트 DM 을 보내지 못했습니다');
  }
  return data as { sent: number; failed: number };
}
