-- =====================================================================
-- 코웍-코인 v3.1 — 회의비는 부서가 함께 · 업무비는 사람별
--   · 팀 회의비 = 부서 단위 (파트 소속은 위 부서의 회의비를 함께 봄 · 본부 · 회사 직속은 그 조직 단위)
--       - 월 인원(= 회의비 예산) 설정: 부서에 바로 속한 사람(팀장) · 관리자
--       - 집행 등록: 부서 사람 누구나 / 수정 · 삭제: 등록한 사람 · 팀장 · 관리자
--   · 업무비 = 사람별 월 예산 · 집행 — 본인만 보고 씀 (팀장 · 관리자도 다른 사람 것은 안 보임)
--   · 업무비 사용 여부 = 사용자별 (관리자만 켜고 끔, 기본 켬) — 끄면 업무비 예산 · 집행을 새로 쓸 수 없음
--
--   실행: Supabase SQL Editor 에서 한 번 (20261112_company_root.sql 다음)
--         실행 직후 앱을 배포(main 푸시)하세요 — 업무비 예산 저장 방식이 바뀌어 이전 앱에서는 업무비 저장이 실패합니다
--   주의: 기존 팀 단위 업무비 예산은 사람에게 나눌 수 없어 지웁니다 (집행 기록은 등록한 사람 것으로 남음)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 회의비 단위 조직 · 팀장
-- ---------------------------------------------------------------------
-- 조직 → 회의비 단위 (파트면 상위 부서, 그 외는 자기 자신)
CREATE OR REPLACE FUNCTION dept_of(p_team_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN t.unit_level = '파트' AND t.parent_id IS NOT NULL THEN t.parent_id ELSE t.id END
  FROM teams t WHERE t.id = p_team_id
$$;

-- 로그인한 사용자의 회의비 단위 조직
CREATE OR REPLACE FUNCTION current_dept_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dept_of(current_team_id())
$$;

-- 회의비 인원을 바꿀 수 있는 사람 = 회의비 단위 조직에 바로 속한 사람(팀장) 또는 관리자
CREATE OR REPLACE FUNCTION is_meeting_leader() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_team_id() IS NOT NULL AND (is_admin_team() OR current_team_id() = current_dept_id())
$$;

-- ---------------------------------------------------------------------
-- 2. 업무비 사용 여부 (사용자별)
-- ---------------------------------------------------------------------
ALTER TABLE members ADD COLUMN IF NOT EXISTS work_enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN members.work_enabled IS '업무비 사용 여부 — 관리자가 사용자별로 켜고 끔 (끄면 업무비 예산 · 집행을 새로 쓸 수 없음)';

CREATE OR REPLACE FUNCTION work_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT work_enabled FROM members WHERE id = current_member_id()), false)
$$;

-- 사용자 정보 수정 — 업무비 사용 여부(관리자만) 추가
DROP FUNCTION IF EXISTS update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean);
CREATE OR REPLACE FUNCTION update_member(p_id bigint, p_name varchar DEFAULT NULL, p_position varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL, p_team_id bigint DEFAULT NULL, p_is_active boolean DEFAULT NULL, p_is_admin boolean DEFAULT NULL,
  p_work_enabled boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target members%ROWTYPE;
BEGIN
  SELECT * INTO target FROM members WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '사용자를 찾을 수 없습니다'; END IF;
  IF NOT is_admin_team() THEN
    IF NOT can_manage_team(target.team_id) THEN RAISE EXCEPTION '내 조직 아래 사용자만 바꿀 수 있습니다'; END IF;
    IF p_team_id IS NOT NULL AND NOT can_manage_team(p_team_id) THEN RAISE EXCEPTION '내 조직 아래 조직으로만 옮길 수 있습니다'; END IF;
    IF p_is_admin IS NOT NULL OR target.is_admin THEN RAISE EXCEPTION '관리자 지정과 관리자 계정 수정은 관리자만 할 수 있습니다'; END IF;
    IF p_work_enabled IS NOT NULL THEN RAISE EXCEPTION '업무비 사용 여부는 관리자만 바꿀 수 있습니다'; END IF;
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
    work_enabled = COALESCE(p_work_enabled, work_enabled)
  WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------
-- 3. 회의비 인원: 부서가 함께 보고, 팀장 · 관리자만 씀
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS team_headcounts_own ON team_headcounts;
CREATE POLICY team_headcounts_select ON team_headcounts FOR SELECT TO authenticated
  USING (team_id = (SELECT current_dept_id()));
CREATE POLICY team_headcounts_insert ON team_headcounts FOR INSERT TO authenticated
  WITH CHECK (team_id = (SELECT current_dept_id()) AND (SELECT is_meeting_leader()));
CREATE POLICY team_headcounts_update ON team_headcounts FOR UPDATE TO authenticated
  USING (team_id = (SELECT current_dept_id()) AND (SELECT is_meeting_leader()))
  WITH CHECK (team_id = (SELECT current_dept_id()) AND (SELECT is_meeting_leader()));
CREATE POLICY team_headcounts_delete ON team_headcounts FOR DELETE TO authenticated
  USING (team_id = (SELECT current_dept_id()) AND (SELECT is_meeting_leader()));

-- 파트 이름으로 등록돼 있던 회의비 집행 → 부서로 (부서 사람이 함께 봄)
UPDATE exec_records SET team_id = dept_of(team_id)
WHERE budget_type = 'meeting' AND team_id IS DISTINCT FROM dept_of(team_id);

-- ---------------------------------------------------------------------
-- 4. 업무비 예산: 사람별
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS work_budgets_own ON work_budgets;
DELETE FROM work_budgets;  -- 팀 단위 예산은 사람에게 나눌 수 없음
ALTER TABLE work_budgets DROP CONSTRAINT IF EXISTS work_budgets_pkey;
ALTER TABLE work_budgets
  ADD COLUMN member_id bigint NOT NULL DEFAULT current_member_id() REFERENCES members(id) ON DELETE CASCADE,
  ALTER COLUMN team_id SET DEFAULT current_team_id(),
  ADD PRIMARY KEY (member_id, effective_month);
COMMENT ON TABLE work_budgets IS '업무비 월 예산 (사람별) — 입력한 달부터 다음 입력 전까지 같은 금액 (이월 없음, 남으면 소멸)';
COMMENT ON COLUMN work_budgets.team_id IS '입력할 때의 소속 조직 (참고용)';

CREATE POLICY work_budgets_select ON work_budgets FOR SELECT TO authenticated
  USING (member_id = (SELECT current_member_id()));
CREATE POLICY work_budgets_insert ON work_budgets FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT current_member_id()) AND (SELECT work_enabled()));
CREATE POLICY work_budgets_update ON work_budgets FOR UPDATE TO authenticated
  USING (member_id = (SELECT current_member_id()))
  WITH CHECK (member_id = (SELECT current_member_id()) AND (SELECT work_enabled()));
CREATE POLICY work_budgets_delete ON work_budgets FOR DELETE TO authenticated
  USING (member_id = (SELECT current_member_id()));

-- ---------------------------------------------------------------------
-- 5. 집행 보기: 업무비는 등록한 사람만 · 회의비는 부서 · 프로젝트는 지금처럼
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS exec_records_select ON exec_records;
CREATE POLICY exec_records_select ON exec_records FOR SELECT TO authenticated
  USING (CASE budget_type
    WHEN 'work'    THEN created_by_member_id = (SELECT current_member_id())
    WHEN 'meeting' THEN team_id = (SELECT current_dept_id())
    ELSE team_id = (SELECT current_team_id()) OR (project_id IS NOT NULL AND owns_project(project_id))
  END);

-- 이 집행을 고치거나 지울 수 있는지
CREATE OR REPLACE FUNCTION can_edit_exec(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE r.budget_type
      WHEN 'work'    THEN r.created_by_member_id = current_member_id()
      WHEN 'meeting' THEN r.team_id = current_dept_id() AND (r.created_by_member_id = current_member_id() OR is_meeting_leader())
      ELSE r.team_id = current_team_id()
    END
    FROM exec_records r WHERE r.id = p_id), false)
$$;

-- ---------------------------------------------------------------------
-- 6. 집행 쓰기 함수
-- ---------------------------------------------------------------------
-- 집행 등록 — 회의비는 부서 앞으로, 업무비는 사용 중인 사람만
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
    IF t = 'work' AND NOT work_enabled() THEN RAISE EXCEPTION '업무비를 쓰지 않도록 설정된 사용자입니다. 관리자에게 문의하세요'; END IF;
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
  IF t = 'work' THEN
    IF NOT work_enabled() THEN RAISE EXCEPTION '업무비를 쓰지 않도록 설정된 사용자입니다. 관리자에게 문의하세요'; END IF;
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

-- 집행 삭제 (항목은 외래키 CASCADE) — 고칠 수 있는 집행만
CREATE OR REPLACE FUNCTION exec_delete(p_ids bigint[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_team();
  DELETE FROM exec_records WHERE id = ANY (p_ids) AND can_edit_exec(id);
END $$;

-- ---------------------------------------------------------------------
-- 7. 실행 권한 — 새 함수는 기본으로 닫혀 있음 (권한 정책이 부르는 함수만 엶)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION dept_of(bigint), current_dept_id(), is_meeting_leader(), work_enabled(), can_edit_exec(bigint),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION current_dept_id(), is_meeting_leader(), work_enabled(),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean, boolean)
  TO authenticated;

COMMIT;

-- 확인 (선택)
-- SELECT current_dept_id(), is_meeting_leader(), work_enabled();   -- 앱에서 로그인한 사용자 기준 (SQL Editor 에서는 NULL)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'work_budgets' ORDER BY ordinal_position;
