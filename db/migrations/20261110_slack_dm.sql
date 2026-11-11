-- =====================================================================
-- 코웍-코인 v2.8 — 알림을 슬랙 개인 DM 으로도 보내기
--   실행 순서: 20261005b_notification_insert_rules.sql 다음
--              (Supabase SQL Editor 에서 전체를 한 번에 실행)
--
--   흐름: notifications 에 새 알림 저장 → Database Webhook → Edge Function notify-slack
--         → 받는 팀의 슬랙 DM 설정 · 종류별 on/off 확인 → 등록된 받는 사람에게 슬랙 DM
--   (설정 방법: deploy/SLACK.md)
--   ※ v3.0(20261111b_org_members.sql)에서 slack_recipients 를 없애고 사용자 회사 이메일로 DM — 이 표는 쓰지 않음
--
--   변경
--   1. notification_prefs.slack_enabled — 팀별 슬랙 DM on/off (기본 꺼짐)
--      종류별 on/off 는 기존 push_setting · push_alloc · push_deadline 을 함께 씀
--   2. slack_recipients — 팀별 알림 받을 사람 (회사 이메일 → 슬랙 계정은 서버가 찾아 저장)
--      읽기 · 추가 · 삭제는 그 팀만, 슬랙 계정 · 오류 기록은 Edge Function(service_role)만 씀
-- =====================================================================

BEGIN;

-- 1. 팀별 슬랙 DM on/off
ALTER TABLE notification_prefs ADD COLUMN IF NOT EXISTS slack_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN notification_prefs.slack_enabled IS '슬랙 개인 DM 으로도 알림 받기 (받는 사람: slack_recipients)';

-- 2. 알림 받을 사람
CREATE TABLE IF NOT EXISTS slack_recipients (
  id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id       bigint       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email         varchar(254) NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  slack_user_id varchar(32),                       -- 이메일로 찾은 슬랙 계정 (서버가 채움)
  last_error    varchar(100),                      -- 최근 발송 실패 이유 (예: 슬랙 계정 없음)
  created_at    timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE slack_recipients IS '팀별 슬랙 DM 알림 받을 사람 — 회사 이메일 기준';
CREATE UNIQUE INDEX IF NOT EXISTS slack_recipients_team_email_key ON slack_recipients (team_id, lower(email));

ALTER TABLE slack_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_recipients_select ON slack_recipients;
DROP POLICY IF EXISTS slack_recipients_insert ON slack_recipients;
DROP POLICY IF EXISTS slack_recipients_delete ON slack_recipients;
CREATE POLICY slack_recipients_select ON slack_recipients FOR SELECT TO authenticated
  USING (team_id = (SELECT current_team_id()));
-- 추가할 때는 이메일만 — 슬랙 계정 · 오류는 비워 둠 (서버만 채움)
CREATE POLICY slack_recipients_insert ON slack_recipients FOR INSERT TO authenticated
  WITH CHECK (team_id = (SELECT current_team_id()) AND slack_user_id IS NULL AND last_error IS NULL
              AND (SELECT count(*) FROM slack_recipients r WHERE r.team_id = (SELECT current_team_id())) < 20);
CREATE POLICY slack_recipients_delete ON slack_recipients FOR DELETE TO authenticated
  USING (team_id = (SELECT current_team_id()));
-- 수정 정책 없음 = 앱에서는 수정 불가 (이메일을 바꾸려면 지우고 다시 추가)
REVOKE UPDATE, TRUNCATE ON slack_recipients FROM anon, authenticated;
REVOKE ALL ON slack_recipients FROM anon;

COMMIT;

-- 확인 (선택)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'notification_prefs' AND column_name = 'slack_enabled';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'slack_recipients';
