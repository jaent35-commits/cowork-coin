-- =====================================================================
-- 코웍-코인 v3.2 — 사용자별 메뉴 권한 · '설정 변경' 알림 항상 켬
--   · 업무비 권한 (members.work_enabled, 기존 칸) = 조회 + 편집 Y/N
--       - N 이면 업무비 예산 · 집행을 보지도 쓰지도 못함 (지금까지는 새로 쓰기만 막았음)
--   · 팀 회의비 편집 권한 (members.meeting_edit, 새 칸 · 기본 Y)
--       - N 이면 팀 회의비는 보기만 — 집행 등록 · 수정 · 삭제, 인원(예산) 설정 불가
--       - 인원 설정은 지금처럼 팀장(부서에 바로 속한 사람) · 관리자이면서 편집 권한이 Y 일 때
--       - 관리자 계정은 늘 편집 가능
--   · 두 권한 모두 관리자만 사용자 관리에서 바꿈
--   · 알림 종류 '설정 변경' (비밀번호 변경 · 초기화) 은 늘 켬 — 사용자가 끌 수 없음
--
--   실행: Supabase SQL Editor 에서 한 번 (20261115_meeting_dept_work_personal.sql 다음, 여러 번 실행해도 결과 같음)
--         실행 뒤 앱 배포(main 푸시) — 새 앱이 meeting_edit 칸을 읽으므로 SQL 을 먼저 실행해야 로그인이 됩니다
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 팀 회의비 편집 권한 (사용자별, 기본 Y)
-- ---------------------------------------------------------------------
ALTER TABLE members ADD COLUMN IF NOT EXISTS meeting_edit boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN members.meeting_edit IS '팀 회의비 편집 권한 — 끄면 보기만 (관리자가 사용자별로 켜고 끔, 관리자 계정은 늘 편집)';
COMMENT ON COLUMN members.work_enabled IS '업무비 권한 (조회 + 편집) — 끄면 업무비 예산 · 집행을 보지도 쓰지도 못함 (관리자가 사용자별로 켜고 끔)';

-- 로그인한 사용자가 팀 회의비를 고칠 수 있는지
CREATE OR REPLACE FUNCTION can_edit_meeting() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin_team() OR COALESCE((SELECT meeting_edit FROM members WHERE id = current_member_id()), false)
$$;

-- 회의비 인원을 바꿀 수 있는 사람 = 관리자 또는 (회의비 단위 조직에 바로 속한 팀장 + 편집 권한)
CREATE OR REPLACE FUNCTION is_meeting_leader() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_team_id() IS NOT NULL AND (is_admin_team() OR (current_team_id() = current_dept_id() AND can_edit_meeting()))
$$;

-- 이 집행을 고치거나 지울 수 있는지 — 회의비는 편집 권한이 있어야
CREATE OR REPLACE FUNCTION can_edit_exec(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE r.budget_type
      WHEN 'work'    THEN r.created_by_member_id = current_member_id() AND work_enabled()
      WHEN 'meeting' THEN r.team_id = current_dept_id() AND can_edit_meeting()
                          AND (r.created_by_member_id = current_member_id() OR is_meeting_leader())
      ELSE r.team_id = current_team_id()
    END
    FROM exec_records r WHERE r.id = p_id), false)
$$;

-- 집행 등록 — 회의비는 편집 권한, 업무비는 업무비 권한이 있어야
CREATE OR REPLACE FUNCTION exec_add(p jsonb) RETURNS SETOF bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  r jsonb;
  t budget_type;
  rid bigint;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(p) LOOP
    t := (r->>'type')::budget_type;
    IF t = 'work' AND NOT work_enabled() THEN RAISE EXCEPTION '업무비 권한이 없는 사용자입니다. 관리자에게 문의하세요'; END IF;
    IF t = 'meeting' AND NOT can_edit_meeting() THEN RAISE EXCEPTION '팀 회의비 편집 권한이 없는 사용자입니다. 관리자에게 문의하세요'; END IF;
    INSERT INTO exec_records (team_id, budget_type, project_id, use_date)
    VALUES (CASE WHEN t = 'meeting' THEN current_dept_id() ELSE me END, t, NULLIF(r->>'project_id', '')::bigint, (r->>'use_date')::date)
    RETURNING id INTO rid;
    INSERT INTO exec_items (record_id, line_no, name, amount)
    SELECT rid, x.ord, COALESCE(NULLIF(btrim(x.v->>'name'), ''), '기타 경비'), (x.v->>'amount')::bigint
    FROM jsonb_array_elements(r->'items') WITH ORDINALITY AS x(v, ord);
    RETURN NEXT rid;
  END LOOP;
END $$;

-- 집행 수정 — 항목은 보낸 목록으로 교체
CREATE OR REPLACE FUNCTION exec_update(p_id bigint, r jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  t budget_type := (r->>'type')::budget_type;
BEGIN
  IF NOT can_edit_exec(p_id) THEN RAISE EXCEPTION '이 집행은 수정할 수 없습니다 (등록한 사람 · 팀장만)'; END IF;
  IF t = 'meeting' AND NOT can_edit_meeting() THEN RAISE EXCEPTION '팀 회의비 편집 권한이 없는 사용자입니다. 관리자에게 문의하세요'; END IF;
  IF t = 'work' THEN
    IF NOT work_enabled() THEN RAISE EXCEPTION '업무비 권한이 없는 사용자입니다. 관리자에게 문의하세요'; END IF;
    -- 업무비는 등록한 사람만 보므로 다른 사람이 등록한 집행을 업무비로 바꿀 수 없음
    IF (SELECT created_by_member_id FROM exec_records WHERE id = p_id) IS DISTINCT FROM current_member_id() THEN
      RAISE EXCEPTION '다른 사람이 등록한 집행은 업무비로 바꿀 수 없습니다';
    END IF;
  END IF;
  UPDATE exec_records SET
    budget_type = t,
    project_id  = NULLIF(r->>'project_id', '')::bigint,
    use_date    = (r->>'use_date')::date,
    team_id     = CASE WHEN t = 'meeting' THEN current_dept_id() ELSE me END
  WHERE id = p_id;
  DELETE FROM exec_items WHERE record_id = p_id;
  INSERT INTO exec_items (record_id, line_no, name, amount)
  SELECT p_id, x.ord, COALESCE(NULLIF(btrim(x.v->>'name'), ''), '기타 경비'), (x.v->>'amount')::bigint
  FROM jsonb_array_elements(r->'items') WITH ORDINALITY AS x(v, ord);
END $$;

-- ---------------------------------------------------------------------
-- 2. 업무비 권한 = 조회 + 편집 — 끄면 본인 업무비도 안 보임
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS work_budgets_select ON work_budgets;
CREATE POLICY work_budgets_select ON work_budgets FOR SELECT TO authenticated
  USING (member_id = (SELECT current_member_id()) AND (SELECT work_enabled()));
DROP POLICY IF EXISTS work_budgets_delete ON work_budgets;
CREATE POLICY work_budgets_delete ON work_budgets FOR DELETE TO authenticated
  USING (member_id = (SELECT current_member_id()) AND (SELECT work_enabled()));

DROP POLICY IF EXISTS exec_records_select ON exec_records;
CREATE POLICY exec_records_select ON exec_records FOR SELECT TO authenticated
  USING (CASE budget_type
    WHEN 'work'    THEN created_by_member_id = (SELECT current_member_id()) AND (SELECT work_enabled())
    WHEN 'meeting' THEN team_id = (SELECT current_dept_id())
    ELSE team_id = (SELECT current_team_id()) OR (project_id IS NOT NULL AND owns_project(project_id))
  END);

-- ---------------------------------------------------------------------
-- 3. 사용자 정보 수정 — 팀 회의비 편집 권한(관리자만) 추가
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION update_member(p_id bigint, p_name varchar DEFAULT NULL, p_position varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL, p_team_id bigint DEFAULT NULL, p_is_active boolean DEFAULT NULL, p_is_admin boolean DEFAULT NULL,
  p_work_enabled boolean DEFAULT NULL, p_meeting_edit boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target members%ROWTYPE;
BEGIN
  SELECT * INTO target FROM members WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '사용자를 찾을 수 없습니다'; END IF;
  IF NOT is_admin_team() THEN
    IF NOT can_manage_team(target.team_id) THEN RAISE EXCEPTION '내 조직 아래 사용자만 바꿀 수 있습니다'; END IF;
    IF p_team_id IS NOT NULL AND NOT can_manage_team(p_team_id) THEN RAISE EXCEPTION '내 조직 아래 조직으로만 옮길 수 있습니다'; END IF;
    IF p_is_admin IS NOT NULL OR target.is_admin THEN RAISE EXCEPTION '관리자 지정과 관리자 계정 수정은 관리자만 할 수 있습니다'; END IF;
    IF p_work_enabled IS NOT NULL OR p_meeting_edit IS NOT NULL THEN RAISE EXCEPTION '메뉴 권한은 관리자만 바꿀 수 있습니다'; END IF;
  END IF;
  IF p_id = current_member_id() AND (p_is_active IS FALSE OR p_is_admin IS FALSE) THEN
    RAISE EXCEPTION '내 계정의 상태 · 관리자 권한은 바꿀 수 없습니다';
  END IF;
  UPDATE members SET
    name      = COALESCE(NULLIF(btrim(p_name), ''), name),
    position  = CASE WHEN p_position IS NULL THEN position ELSE NULLIF(btrim(p_position), '') END,
    email     = CASE WHEN p_email IS NULL THEN email ELSE NULLIF(btrim(p_email), '') END,
    -- 이메일이 바뀌면 슬랙 계정을 다시 찾게
    slack_user_id = CASE WHEN p_email IS NOT NULL AND NULLIF(btrim(p_email), '') IS DISTINCT FROM email THEN NULL ELSE slack_user_id END,
    team_id   = COALESCE(p_team_id, team_id),
    is_active = COALESCE(p_is_active, is_active),
    is_admin  = COALESCE(p_is_admin, is_admin),
    work_enabled = COALESCE(p_work_enabled, work_enabled),
    meeting_edit = COALESCE(p_meeting_edit, meeting_edit)
  WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------
-- 4. 알림 '설정 변경' 은 늘 켬 (이전 앱이 꺼서 저장해도 켬으로)
-- ---------------------------------------------------------------------
UPDATE notification_prefs SET push_setting = true WHERE push_setting IS DISTINCT FROM true;
ALTER TABLE notification_prefs ALTER COLUMN push_setting SET DEFAULT true;
CREATE OR REPLACE FUNCTION notification_prefs_setting_on() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.push_setting := true;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_prefs_setting_on ON notification_prefs;
CREATE TRIGGER notification_prefs_setting_on BEFORE INSERT OR UPDATE ON notification_prefs
  FOR EACH ROW EXECUTE FUNCTION notification_prefs_setting_on();

-- ---------------------------------------------------------------------
-- 5. 실행 권한 — 새 함수는 기본으로 닫혀 있음
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION can_edit_meeting(), notification_prefs_setting_on(),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION can_edit_meeting(),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean, boolean, boolean)
  TO authenticated;

COMMIT;

-- 확인 (선택)
-- SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'members' AND column_name IN ('work_enabled', 'meeting_edit');
-- SELECT count(*) FILTER (WHERE NOT push_setting) AS setting_off FROM notification_prefs;   -- 0 이어야 함
