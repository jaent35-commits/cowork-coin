-- =====================================================================
-- 코웍-코인 — 오픈 전 테스트 데이터 전부 삭제 (운영 Supabase)
--   seed.sql 로 넣은 데이터와 검증 중 앱에서 만든 팀·데이터를 모두 지우고 첫 실행 상태로 되돌림
--   · 지우는 것: 팀 · 팀 Auth 사용자(+ identities · 세션은 Auth 가 함께 지움) · 인원 · 업무비 · 프로젝트 · 배분
--                · 체크리스트 · 집행 · 알림 · 읽음 · 알림 설정 · 과거 연도 요약 — 번호(id)도 1부터 다시
--   · 남기는 것: 기준 정보 — 경비 분류(expense_categories) · 회의비 단가(meeting_rates) · 시스템 설정(app_settings)
--   · 끝나면 needs_setup() = true → 앱 첫 화면이 '관리자 팀 만들기'
--   · 되돌릴 수 없음. 오픈 직전에 한 번만 실행
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _team_auth_users ON COMMIT DROP AS
SELECT auth_user_id FROM teams WHERE auth_user_id IS NOT NULL;

-- teams 를 참조하는 테이블을 모두 나열 (CASCADE 를 쓰지 않아 빠진 테이블이 있으면 오류로 멈춤)
TRUNCATE notification_reads, notification_prefs, notifications,
         exec_items, exec_records, checklist_items, project_allocations, projects,
         work_budgets, team_headcounts, legacy_yearly_totals, teams
RESTART IDENTITY;

DELETE FROM auth.users WHERE id IN (SELECT auth_user_id FROM _team_auth_users);

DO $$
BEGIN
  IF NOT needs_setup() THEN RAISE EXCEPTION '팀이 남아 있습니다'; END IF;
END $$;

COMMIT;
