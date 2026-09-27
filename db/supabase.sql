-- =====================================================================
-- 코웍-코인 — Supabase 전용 설정 (팀 · 로그인)
--   실행 순서: db/schema.sql → 이 파일
--   문서: db/ERD.md §2-1
--
--   · 팀 1개 = Supabase Auth 사용자 1명 (내부 이메일 teams.login_email + 비밀번호)
--   · 비밀번호 저장·검사·세션(JWT)은 Supabase Auth 가 담당
--   · 계정 생성·삭제·비밀번호 초기화/변경은 Auth 관리자 API 가 필요해 Edge Function 에서만
--     (bootstrap-admin · admin-create-team · admin-reset-password · change-password · admin-delete-team)
--   · 모든 테이블 RLS 켬 — 이번 단계는 teams 정책만, 나머지 테이블은 정책 없음 = API 로 접근 불가
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Auth 사용자 연결
-- ---------------------------------------------------------------------
-- 팀 삭제는 Edge Function 이 teams 행 → auth 사용자 순서로 지움 (Auth 쪽만 먼저 지워지지 않도록 RESTRICT)
ALTER TABLE teams
  ADD CONSTRAINT teams_auth_user_fk FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 2. 로그인한 팀 확인 (RLS 에서 사용)
-- ---------------------------------------------------------------------
-- 로그인한 Auth 사용자의 팀 (상태와 무관 — 비밀번호 변경 화면에서 자기 팀 확인용)
CREATE FUNCTION auth_team_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM teams WHERE auth_user_id = auth.uid()
$$;

-- 앱 데이터를 쓸 수 있는 팀 = 활성 + 초기 비밀번호 변경 완료. 아니면 NULL → 모든 데이터 정책이 막힘
--   (앱 화면의 '초기 비밀번호 변경' 단계를 서버에서도 강제)
CREATE FUNCTION current_team_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM teams WHERE auth_user_id = auth.uid() AND is_active AND NOT must_change_password
$$;

CREATE FUNCTION is_admin_team() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM teams WHERE id = current_team_id()), false)
$$;

-- ---------------------------------------------------------------------
-- 3. 로그인 화면 (로그인 전 anon 호출)
-- ---------------------------------------------------------------------
-- 첫 실행 여부 — 팀이 하나도 없으면 '관리자 팀 만들기' 화면
CREATE FUNCTION needs_setup() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM teams)
$$;

-- 팀 선택 목록 (활성 팀만) — 이름과 로그인용 내부 이메일만 공개, 그 외 정보는 안 보임
CREATE FUNCTION login_teams() RETURNS TABLE (name varchar, login_email varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name, login_email FROM teams WHERE is_active ORDER BY id
$$;

-- ---------------------------------------------------------------------
-- 4. 관리자 메뉴 — 팀 이름 · 휴면 · 관리자 권한 (Auth 와 무관한 값만, 나머지는 Edge Function)
-- ---------------------------------------------------------------------
-- 앱 규칙: 로그인한 팀 자신은 휴면·권한 변경 불가 / 활성 관리자 팀은 최소 1개 (teams_keep_admin 트리거)
CREATE FUNCTION admin_update_team(p_team_id bigint, p_name varchar DEFAULT NULL,
                                  p_is_active boolean DEFAULT NULL, p_is_admin boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_team() THEN RAISE EXCEPTION '관리자 팀만 변경할 수 있습니다'; END IF;
  IF p_team_id = current_team_id() AND (p_is_active IS NOT NULL OR p_is_admin IS NOT NULL) THEN
    RAISE EXCEPTION '로그인한 팀의 상태·권한은 변경할 수 없습니다';
  END IF;
  UPDATE teams SET
    name      = COALESCE(NULLIF(btrim(p_name), ''), name),
    is_active = COALESCE(p_is_active, is_active),
    is_admin  = COALESCE(p_is_admin, is_admin)
  WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION '팀을 찾을 수 없습니다 (id=%)', p_team_id; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Edge Function 전용 (service_role 만 실행)
-- ---------------------------------------------------------------------
-- 비밀번호 상태 기록 — change-password(팀 본인, p_initial=false) / admin-reset-password·admin-create-team(p_initial=true)
CREATE FUNCTION set_password_state(p_team_id bigint, p_initial boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE teams SET must_change_password = p_initial,
                   password_changed_at  = CASE WHEN p_initial THEN NULL ELSE now() END
  WHERE id = p_team_id
$$;

-- ---------------------------------------------------------------------
-- 6. RLS — 모든 테이블 켬 (정책이 없으면 anon·authenticated 모두 접근 불가)
-- ---------------------------------------------------------------------
ALTER TABLE teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_headcounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_budgets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_yearly_totals ENABLE ROW LEVEL SECURITY;

-- teams 조회: 자기 팀 행은 항상(비밀번호 변경 화면용), 다른 팀은 데이터를 쓸 수 있는 팀만(배분·집행 팀 이름 표시)
--   쓰기 정책 없음 → 변경은 admin_update_team() · Edge Function 으로만
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()) OR (SELECT current_team_id()) IS NOT NULL);  -- (SELECT …) = 행마다가 아니라 한 번만 계산

-- 뷰는 만든 사람 권한으로 실행되므로 RLS 를 따르도록 (Postgres 15+ / Supabase 기본)
ALTER VIEW v_exec_records          SET (security_invoker = true);
ALTER VIEW v_allocation_usage      SET (security_invoker = true);
ALTER VIEW v_project_summary       SET (security_invoker = true);
ALTER VIEW v_project_owner_budget  SET (security_invoker = true);
ALTER VIEW v_team_projects         SET (security_invoker = true);
ALTER VIEW v_team_meeting_quarters SET (security_invoker = true);
ALTER VIEW v_team_work_months      SET (security_invoker = true);
ALTER VIEW v_team_checklist        SET (security_invoker = true);
ALTER VIEW v_team_notifications    SET (security_invoker = true);

-- ---------------------------------------------------------------------
-- 7. 실행 권한 — 함수는 기본으로 모두(PUBLIC)에게 열려 있고, Supabase 는 public 의 새 함수에
--    anon · authenticated 권한을 '직접' 주므로(default privileges) 셋 다 닫은 뒤 필요한 역할만 허용
--    (PUBLIC 만 닫으면 set_password_state 를 아무나 호출해 강제 비밀번호 변경을 건너뛸 수 있음)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION auth_team_id(), current_team_id(), is_admin_team(), needs_setup(), login_teams(),
                       admin_update_team(bigint, varchar, boolean, boolean), set_password_state(bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION needs_setup(), login_teams()                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth_team_id(), current_team_id(), is_admin_team()     TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_team(bigint, varchar, boolean, boolean)   TO authenticated;
GRANT EXECUTE ON FUNCTION set_password_state(bigint, boolean)                    TO service_role;

-- schema.sql 함수도 같은 원칙 (v2.1, Supabase Advisors 반영)
--   트리거 함수: 실행 권한은 트리거를 만들 때만 검사 → 아무에게도 줄 필요 없음
--   meeting_rate_of · work_budget_of: 뷰에서 쓰므로 로그인한 팀만
REVOKE ALL ON FUNCTION touch_updated_at(), check_last_admin(), check_alloc_total(), check_alloc_delete(), check_checklist_teams(),
                       meeting_rate_of(date), work_budget_of(bigint, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION meeting_rate_of(date), work_budget_of(bigint, date) TO authenticated;

-- Supabase 기본 제공 이벤트 트리거 함수 — 있을 때만 (이벤트 트리거는 실행 권한 없이도 동작)
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 앞으로 이 역할이 만드는 함수는 자동으로 열리지 않게 → 새 함수는 필요한 역할에 직접 GRANT
--   스키마별 기본 권한은 '더하기'만 되므로 PUBLIC 은 전체(스키마 없음) 기본값에서 거둬야 함
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

COMMIT;
