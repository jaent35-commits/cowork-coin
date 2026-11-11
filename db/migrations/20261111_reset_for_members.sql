-- =====================================================================
-- 코웍-코인 v3.0 준비 — 팀 계정 시절 테스트 데이터 모두 지우기 (되돌릴 수 없음)
--   실행 순서: 20261110_slack_dm.sql 다음, 20261111b_org_members.sql 바로 앞
--   (20261110b_slack_recipients_limit.sql 은 실행하지 않아도 됨 — v3.0 에서 받는 사람 표를 없앰)
--
--   지우는 것: 팀 · 팀 Auth 사용자 · 프로젝트 · 배분 · 체크리스트 · 집행 · 인원 · 업무비 · 알림 · 읽음 · 알림 설정
--             · 과거 연도 요약 · 팀이 만든 경비 구분 · 슬랙 받는 사람
--   남기는 것: 공통 경비 구분(회의비(원가) 등) · 회의비 단가 이력 · 시스템 설정
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _team_auth_users ON COMMIT DROP AS
SELECT auth_user_id FROM teams WHERE auth_user_id IS NOT NULL;

-- teams 를 가리키는 표부터 (CASCADE 를 쓰지 않아 빠진 표가 있으면 오류로 멈춤)
TRUNCATE notification_reads, notification_prefs, notifications,
         exec_items, exec_records, checklist_items, project_allocations, projects,
         work_budgets, team_headcounts, legacy_yearly_totals, slack_recipients
RESTART IDENTITY;

-- 공통 구분은 남기고 팀이 만든 구분만
DELETE FROM expense_categories WHERE team_id IS NOT NULL;

-- 마지막 관리자 팀 검사 트리거가 '모두 삭제' 를 막지 않음 (팀이 하나도 없으면 통과)
-- 이 트리거는 COMMIT 때 몰아서 검사(DEFERRED) — 그대로 두면 아래 ALTER TABLE teams 가
-- 'pending trigger events' 로 거부되므로 바로 검사하게 함
SET CONSTRAINTS teams_keep_admin IMMEDIATE;
DELETE FROM teams;
ALTER TABLE teams ALTER COLUMN id RESTART WITH 1;

DELETE FROM auth.users WHERE id IN (SELECT auth_user_id FROM _team_auth_users);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams) THEN RAISE EXCEPTION '팀이 남아 있습니다'; END IF;
END $$;

COMMIT;
