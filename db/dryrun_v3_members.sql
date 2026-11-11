-- v3.0 시험 실행 (되돌림) — SQL Editor 에서 전체 실행. 맨 끝 ROLLBACK 으로 DB 에는 아무것도 남지 않음
-- 결과: 마지막 SELECT 의 json 한 칸 — 각 항목 result 가 OK / 막힘: … 이면 정상, OK(문제) · ERR 이 있으면 알려 주세요
BEGIN;


CREATE TEMP TABLE _team_auth_users ON COMMIT DROP AS
SELECT auth_user_id FROM teams WHERE auth_user_id IS NOT NULL;

TRUNCATE notification_reads, notification_prefs, notifications,
         exec_items, exec_records, checklist_items, project_allocations, projects,
         work_budgets, team_headcounts, legacy_yearly_totals, slack_recipients
RESTART IDENTITY;

DELETE FROM expense_categories WHERE team_id IS NOT NULL;

SET CONSTRAINTS teams_keep_admin IMMEDIATE;
DELETE FROM teams;
ALTER TABLE teams ALTER COLUMN id RESTART WITH 1;

DELETE FROM auth.users WHERE id IN (SELECT auth_user_id FROM _team_auth_users);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams) THEN RAISE EXCEPTION '팀이 남아 있습니다'; END IF;
END $$;




DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams) THEN
    RAISE EXCEPTION '팀 데이터가 남아 있습니다 — 20261111_reset_for_members.sql 을 먼저 실행하세요';
  END IF;
END $$;

DROP POLICY IF EXISTS teams_select ON teams;
DROP TRIGGER IF EXISTS teams_keep_admin ON teams;
DROP FUNCTION IF EXISTS admin_update_team(bigint, varchar, boolean, boolean);
DROP FUNCTION IF EXISTS login_teams();
DROP FUNCTION IF EXISTS auth_team_id();
DROP FUNCTION IF EXISTS set_password_state(bigint, boolean);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_auth_user_fk;
ALTER TABLE teams
  DROP COLUMN auth_user_id,
  DROP COLUMN login_email,
  DROP COLUMN is_admin,
  DROP COLUMN must_change_password,
  DROP COLUMN password_changed_at,
  ADD COLUMN parent_id  bigint      REFERENCES teams(id) ON DELETE RESTRICT,
  ADD COLUMN unit_level varchar(4)  NOT NULL DEFAULT '파트' CHECK (unit_level IN ('본부', '부서', '파트'));
CREATE INDEX IF NOT EXISTS teams_parent_idx ON teams (parent_id);
COMMENT ON TABLE teams IS '조직 (본부 · 부서 · 파트) — 예산 · 집행 · 프로젝트의 단위. 로그인은 members';
COMMENT ON COLUMN teams.parent_id IS '상위 조직 (없으면 최상위)';
COMMENT ON COLUMN teams.unit_level IS '본부 · 부서 · 파트 — 상위 조직은 항상 더 높은 구분';

CREATE OR REPLACE FUNCTION team_level_rank(p_level varchar) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_level WHEN '본부' THEN 1 WHEN '부서' THEN 2 ELSE 3 END $$;

CREATE OR REPLACE FUNCTION check_team_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE parent_level varchar;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION '자기 자신을 상위 조직으로 지정할 수 없습니다'; END IF;
  SELECT unit_level INTO parent_level FROM teams WHERE id = NEW.parent_id;
  IF team_level_rank(parent_level) >= team_level_rank(NEW.unit_level) THEN
    RAISE EXCEPTION '상위 조직은 더 높은 구분이어야 합니다 (% 아래에 % 를 둘 수 없음)', parent_level, NEW.unit_level;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teams_check_parent ON teams;
CREATE TRIGGER teams_check_parent BEFORE INSERT OR UPDATE OF parent_id, unit_level ON teams
  FOR EACH ROW EXECUTE FUNCTION check_team_parent();
CREATE OR REPLACE FUNCTION check_team_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams c WHERE c.parent_id = NEW.id AND team_level_rank(c.unit_level) <= team_level_rank(NEW.unit_level)) THEN
    RAISE EXCEPTION '하위 조직보다 낮은 구분으로 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teams_check_children ON teams;
CREATE TRIGGER teams_check_children BEFORE UPDATE OF unit_level ON teams
  FOR EACH ROW EXECUTE FUNCTION check_team_children();

CREATE TABLE members (
  id                   bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id         uuid         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  login_email          varchar(100) NOT NULL UNIQUE,           -- Auth 로그인용 내부 이메일 (사번으로 만듦 — 화면에는 안 보임)
  employee_no          varchar(20)  NOT NULL UNIQUE CHECK (employee_no ~ '^[0-9A-Za-z]{3,20}$'),  -- 사번 = 로그인 아이디
  name                 varchar(30)  NOT NULL CHECK (btrim(name) <> ''),
  position             varchar(30),                            -- 직위
  email                varchar(254) CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),  -- 회사 이메일 (슬랙 DM)
  team_id              bigint       NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  is_admin             boolean      NOT NULL DEFAULT false,
  is_active            boolean      NOT NULL DEFAULT true,
  must_change_password boolean      NOT NULL DEFAULT true,     -- 초기 비밀번호 상태 — 첫 로그인 때 변경 필수
  password_changed_at  timestamptz,
  slack_user_id        varchar(32),                            -- 회사 이메일로 찾은 슬랙 계정 (서버가 채움)
  slack_error          varchar(100),                           -- 최근 슬랙 발송 실패 이유
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE members IS '사용자 — 1인 1계정 (Supabase Auth 사용자와 1:1), 사번으로 로그인';
CREATE INDEX members_team_idx ON members (team_id);
CREATE TRIGGER members_touch BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION check_last_admin() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM members) AND NOT EXISTS (SELECT 1 FROM members WHERE is_admin AND is_active) THEN
    RAISE EXCEPTION '활성 관리자가 최소 1명 있어야 합니다';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER members_keep_admin AFTER UPDATE OF is_admin, is_active OR DELETE ON members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_last_admin();

CREATE OR REPLACE FUNCTION current_member_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM members m JOIN teams t ON t.id = m.team_id
  WHERE m.auth_user_id = auth.uid() AND m.is_active AND NOT m.must_change_password AND t.is_active
$$;

CREATE OR REPLACE FUNCTION current_team_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.team_id FROM members m JOIN teams t ON t.id = m.team_id
  WHERE m.auth_user_id = auth.uid() AND m.is_active AND NOT m.must_change_password AND t.is_active
$$;

CREATE OR REPLACE FUNCTION is_admin_team() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM members WHERE id = current_member_id()), false)
$$;

CREATE OR REPLACE FUNCTION visible_team_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE v(id) AS (
    SELECT current_team_id() WHERE current_team_id() IS NOT NULL
    UNION
    SELECT t.id FROM teams t JOIN v ON t.parent_id = v.id
  )
  SELECT id FROM v
$$;

CREATE OR REPLACE FUNCTION needs_setup() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM members)
$$;

CREATE OR REPLACE FUNCTION set_password_state(p_member_id bigint, p_initial boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE members SET must_change_password = p_initial,
                     password_changed_at  = CASE WHEN p_initial THEN NULL ELSE now() END
  WHERE id = p_member_id
$$;

CREATE OR REPLACE FUNCTION manageable_team_ids_of(p_member_id bigint) RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m record;
BEGIN
  SELECT mm.is_admin, mm.team_id, t.unit_level INTO m
  FROM members mm JOIN teams t ON t.id = mm.team_id
  WHERE mm.id = p_member_id AND mm.is_active AND NOT mm.must_change_password AND t.is_active;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.is_admin THEN RETURN QUERY SELECT id FROM teams; RETURN; END IF;
  IF team_level_rank(m.unit_level) > 2 THEN RETURN; END IF;   -- 파트 소속은 관리 권한 없음
  RETURN QUERY
    WITH RECURSIVE sub(id) AS (
      SELECT m.team_id::bigint
      UNION
      SELECT t.id FROM teams t JOIN sub ON t.parent_id = sub.id
    )
    SELECT sub.id FROM sub;
END $$;

CREATE OR REPLACE FUNCTION manageable_team_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT manageable_team_ids_of(current_member_id())
$$;

CREATE OR REPLACE FUNCTION can_manage_team(p_team_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_team_id IS NOT NULL AND p_team_id IN (SELECT manageable_team_ids_of(current_member_id()))
$$;

CREATE OR REPLACE FUNCTION save_team(p_id bigint, p_name varchar, p_level varchar, p_parent_id bigint, p_is_active boolean DEFAULT true)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid bigint := p_id;
BEGIN
  IF current_member_id() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION '조직명을 입력하세요'; END IF;
  IF NOT is_admin_team() THEN
    IF p_level IS DISTINCT FROM '파트' THEN RAISE EXCEPTION '본부 · 부서 조직은 관리자만 바꿀 수 있습니다'; END IF;
    IF NOT can_manage_team(p_parent_id) OR (SELECT unit_level FROM teams WHERE id = p_parent_id) IS DISTINCT FROM '부서' THEN
      RAISE EXCEPTION '내 조직 아래 부서에만 파트를 둘 수 있습니다';
    END IF;
    IF tid IS NOT NULL AND (NOT can_manage_team(tid) OR (SELECT unit_level FROM teams WHERE id = tid) IS DISTINCT FROM '파트') THEN
      RAISE EXCEPTION '내 조직 아래 파트만 바꿀 수 있습니다';
    END IF;
  END IF;
  IF tid IS NULL THEN
    INSERT INTO teams (name, unit_level, parent_id, is_active) VALUES (btrim(p_name), p_level, p_parent_id, COALESCE(p_is_active, true))
    RETURNING id INTO tid;
  ELSE
    IF tid = current_team_id() AND p_is_active IS FALSE THEN RAISE EXCEPTION '내가 속한 조직은 비활성으로 바꿀 수 없습니다'; END IF;
    UPDATE teams SET name = btrim(p_name), unit_level = p_level, parent_id = p_parent_id, is_active = COALESCE(p_is_active, is_active)
    WHERE id = tid;
    IF NOT FOUND THEN RAISE EXCEPTION '조직을 찾을 수 없습니다'; END IF;
  END IF;
  RETURN tid;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '이미 있는 조직명입니다';
END $$;

CREATE OR REPLACE FUNCTION delete_team(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_team() AND (NOT can_manage_team(p_id) OR (SELECT unit_level FROM teams WHERE id = p_id) IS DISTINCT FROM '파트') THEN
    RAISE EXCEPTION '내 조직 아래 파트만 지울 수 있습니다';
  END IF;
  IF EXISTS (SELECT 1 FROM members WHERE team_id = p_id) THEN RAISE EXCEPTION '소속 사용자가 있어 지울 수 없습니다'; END IF;
  IF EXISTS (SELECT 1 FROM teams WHERE parent_id = p_id) THEN RAISE EXCEPTION '하위 조직이 있어 지울 수 없습니다'; END IF;
  DELETE FROM teams WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '조직을 찾을 수 없습니다'; END IF;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION '이력이 있는 조직은 지울 수 없습니다. 비활성으로 바꾸세요';
END $$;

CREATE OR REPLACE FUNCTION update_member(p_id bigint, p_name varchar DEFAULT NULL, p_position varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL, p_team_id bigint DEFAULT NULL, p_is_active boolean DEFAULT NULL, p_is_admin boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target members%ROWTYPE;
BEGIN
  SELECT * INTO target FROM members WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '사용자를 찾을 수 없습니다'; END IF;
  IF NOT is_admin_team() THEN
    IF NOT can_manage_team(target.team_id) THEN RAISE EXCEPTION '내 조직 아래 사용자만 바꿀 수 있습니다'; END IF;
    IF p_team_id IS NOT NULL AND NOT can_manage_team(p_team_id) THEN RAISE EXCEPTION '내 조직 아래 조직으로만 옮길 수 있습니다'; END IF;
    IF p_is_admin IS NOT NULL OR target.is_admin THEN RAISE EXCEPTION '관리자 지정과 관리자 계정 수정은 관리자만 할 수 있습니다'; END IF;
  END IF;
  IF p_id = current_member_id() AND (p_is_active IS FALSE OR p_is_admin IS FALSE) THEN
    RAISE EXCEPTION '내 계정의 상태 · 관리자 권한은 바꿀 수 없습니다';
  END IF;
  UPDATE members SET
    name      = COALESCE(NULLIF(btrim(p_name), ''), name),
    position  = CASE WHEN p_position IS NULL THEN position ELSE NULLIF(btrim(p_position), '') END,
    email     = CASE WHEN p_email IS NULL THEN email ELSE NULLIF(btrim(p_email), '') END,
    slack_user_id = CASE WHEN p_email IS NOT NULL AND NULLIF(btrim(p_email), '') IS DISTINCT FROM email THEN NULL ELSE slack_user_id END,
    team_id   = COALESCE(p_team_id, team_id),
    is_active = COALESCE(p_is_active, is_active),
    is_admin  = COALESCE(p_is_admin, is_admin)
  WHERE id = p_id;
END $$;

ALTER TABLE exec_records    ADD COLUMN created_by_member_id bigint REFERENCES members(id) ON DELETE SET NULL DEFAULT current_member_id();
ALTER TABLE checklist_items ADD COLUMN created_by_member_id bigint REFERENCES members(id) ON DELETE SET NULL DEFAULT current_member_id();
ALTER TABLE checklist_items ADD COLUMN checked_by_member_id bigint REFERENCES members(id) ON DELETE SET NULL;
COMMENT ON COLUMN exec_records.created_by_member_id IS '등록한 사람';
COMMENT ON COLUMN checklist_items.created_by_member_id IS '만든 사람';
COMMENT ON COLUMN checklist_items.checked_by_member_id IS '완료 체크한 사람';

CREATE OR REPLACE FUNCTION stamp_checked_by() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_checked AND NOT OLD.is_checked THEN NEW.checked_by_member_id := current_member_id();
  ELSIF NOT NEW.is_checked THEN NEW.checked_by_member_id := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checklist_stamp_checked_by BEFORE UPDATE OF is_checked ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION stamp_checked_by();

DROP VIEW IF EXISTS v_team_notifications;
DROP TABLE notification_reads;
CREATE TABLE notification_reads (
  notification_id bigint      NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  member_id       bigint      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, member_id)
);
CREATE INDEX notification_reads_member_idx ON notification_reads (member_id);
COMMENT ON TABLE notification_reads IS '알림 읽음 (사람별)';

DROP TABLE notification_prefs;
CREATE TABLE notification_prefs (
  member_id     bigint      PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  push_enabled  boolean     NOT NULL DEFAULT false,  -- 기기 푸시
  slack_enabled boolean     NOT NULL DEFAULT true,   -- 슬랙 DM (회사 이메일)
  push_exec     boolean     NOT NULL DEFAULT true,
  push_setting  boolean     NOT NULL DEFAULT true,   -- 아래 종류별 on/off 는 푸시 · 슬랙 공통
  push_alloc    boolean     NOT NULL DEFAULT true,
  push_deadline boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notification_prefs_touch BEFORE UPDATE ON notification_prefs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
COMMENT ON TABLE notification_prefs IS '사람별 알림 설정 — 설정 행이 없으면 기본값(푸시 꺼짐 · 슬랙 켜짐 · 종류 모두 켜짐)';

DROP TABLE IF EXISTS slack_recipients;
DROP FUNCTION IF EXISTS slack_recipients_limit();

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING ((SELECT current_member_id()) IS NOT NULL
         OR id IN (SELECT team_id FROM members WHERE auth_user_id = (SELECT auth.uid())));

CREATE POLICY members_select ON members FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()) OR (SELECT current_member_id()) IS NOT NULL);

CREATE POLICY notification_reads_own ON notification_reads FOR ALL TO authenticated
  USING (member_id = (SELECT current_member_id())) WITH CHECK (member_id = (SELECT current_member_id()));
CREATE POLICY notification_prefs_own ON notification_prefs FOR ALL TO authenticated
  USING (member_id = (SELECT current_member_id())) WITH CHECK (member_id = (SELECT current_member_id()));

REVOKE ALL ON members FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON members FROM authenticated;
REVOKE ALL ON notification_reads, notification_prefs FROM anon;
REVOKE TRUNCATE ON notification_reads, notification_prefs FROM authenticated;

REVOKE ALL ON FUNCTION current_member_id(), visible_team_ids(), set_password_state(bigint, boolean),
  manageable_team_ids_of(bigint), manageable_team_ids(), can_manage_team(bigint),
  save_team(bigint, varchar, varchar, bigint, boolean), delete_team(bigint),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean),
  check_team_parent(), check_team_children(), stamp_checked_by()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION current_member_id(), visible_team_ids(), manageable_team_ids(), can_manage_team(bigint),
  save_team(bigint, varchar, varchar, bigint, boolean), delete_team(bigint),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION set_password_state(bigint, boolean), manageable_team_ids_of(bigint) TO service_role;



CREATE TEMP TABLE _r (n serial, step text, result text);
CREATE TEMP TABLE _u (nm text, uid uuid, mid bigint);
CREATE TEMP TABLE _t (nm text, tid bigint);
GRANT ALL ON _r, _u, _t TO authenticated;
GRANT USAGE ON SEQUENCE _r_n_seq TO authenticated;

DO $$
DECLARE hq bigint; dept bigint; part bigint; r record;
BEGIN
  INSERT INTO teams (name, unit_level) VALUES ('디지털본부', '본부') RETURNING id INTO hq;
  INSERT INTO teams (name, unit_level, parent_id) VALUES ('플랫폼부', '부서', hq) RETURNING id INTO dept;
  INSERT INTO teams (name, unit_level, parent_id) VALUES ('개발파트', '파트', dept) RETURNING id INTO part;
  INSERT INTO _t VALUES ('본부', hq), ('부서', dept), ('파트', part);
  FOR r IN SELECT * FROM (VALUES ('김본부', '1000001', '본부장', hq, false), ('이부서', '1000002', '부서장', dept, false),
                                 ('박관리', '1000003', '책임', part, true), ('최파트', '1000004', '유닛리더', part, false)) v(nm, no, pos, tid, adm) LOOP
    INSERT INTO _u VALUES (r.nm, gen_random_uuid(), NULL);
    INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    SELECT '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'm-' || r.no || '@members.cowork-coin.test', now(), now() FROM _u WHERE nm = r.nm;
    INSERT INTO members (auth_user_id, login_email, employee_no, name, position, email, team_id, is_admin, must_change_password)
    SELECT uid, 'm-' || r.no || '@members.cowork-coin.test', r.no, r.nm, r.pos, 'tester@example.com', r.tid, r.adm, false FROM _u WHERE nm = r.nm;
    UPDATE _u SET mid = (SELECT id FROM members WHERE employee_no = r.no) WHERE nm = r.nm;
  END LOOP;
  INSERT INTO _r (step, result) VALUES ('준비', '조직 3 · 사용자 ' || (SELECT count(*) FROM members));
END $$;

SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT uid FROM _u WHERE nm = '최파트'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c int;
BEGIN
  INSERT INTO _r (step, result) VALUES ('[파트원] 내 조직', (SELECT name FROM teams WHERE id = current_team_id()));
  INSERT INTO _r (step, result) VALUES ('[파트원] 조회 범위 조직 수', (SELECT count(*)::text FROM visible_team_ids()));
  INSERT INTO _r (step, result) VALUES ('[파트원] 관리 범위 조직 수', (SELECT count(*)::text FROM manageable_team_ids()));
  BEGIN PERFORM save_team(NULL, '새파트', '파트', (SELECT tid FROM _t WHERE nm = '부서')); INSERT INTO _r (step, result) VALUES ('[파트원] 파트 만들기', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[파트원] 파트 만들기', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM exec_add('[{"type":"meeting","use_date":"2026-11-10","items":[{"name":"시험","amount":10000}]}]');
    SELECT count(*) INTO c FROM exec_records WHERE created_by_member_id = current_member_id();
    INSERT INTO _r (step, result) VALUES ('[파트원] 집행 등록 → 등록자 기록', CASE WHEN c = 1 THEN 'OK' ELSE '기록 안 됨' END);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[파트원] 집행 등록', 'ERR ' || SQLERRM); END;
  BEGIN INSERT INTO notification_prefs (member_id, push_enabled) VALUES (current_member_id(), true); INSERT INTO _r (step, result) VALUES ('[파트원] 내 알림 설정 저장', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[파트원] 내 알림 설정 저장', 'ERR ' || SQLERRM); END;
  BEGIN INSERT INTO notification_prefs (member_id) VALUES ((SELECT mid FROM _u WHERE nm = '박관리')); INSERT INTO _r (step, result) VALUES ('[파트원] 남의 알림 설정', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[파트원] 남의 알림 설정', '막힘'); END;
  BEGIN INSERT INTO members (auth_user_id, login_email, employee_no, name, team_id) VALUES (gen_random_uuid(), 'x@x.test', '9999999', '가짜', current_team_id()); INSERT INTO _r (step, result) VALUES ('[파트원] 사용자 표 직접 쓰기', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[파트원] 사용자 표 직접 쓰기', '막힘'); END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT uid FROM _u WHERE nm = '이부서'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE newp bigint;
BEGIN
  INSERT INTO _r (step, result) VALUES ('[부서장] 관리 범위 조직', (SELECT string_agg(t.name, ', ' ORDER BY t.id) FROM teams t WHERE t.id IN (SELECT manageable_team_ids())));
  BEGIN newp := save_team(NULL, '신규파트', '파트', (SELECT tid FROM _t WHERE nm = '부서')); INSERT INTO _r (step, result) VALUES ('[부서장] 내 부서 아래 파트 만들기', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 내 부서 아래 파트 만들기', 'ERR ' || SQLERRM); END;
  BEGIN PERFORM save_team(NULL, '새부서', '부서', (SELECT tid FROM _t WHERE nm = '본부')); INSERT INTO _r (step, result) VALUES ('[부서장] 부서 만들기', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 부서 만들기', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM save_team((SELECT tid FROM _t WHERE nm = '부서'), '플랫폼부2', '부서', (SELECT tid FROM _t WHERE nm = '본부')); INSERT INTO _r (step, result) VALUES ('[부서장] 내 부서 이름 바꾸기', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 내 부서 이름 바꾸기', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM update_member((SELECT mid FROM _u WHERE nm = '최파트'), p_position => '파트장'); INSERT INTO _r (step, result) VALUES ('[부서장] 파트원 직위 수정', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 파트원 직위 수정', 'ERR ' || SQLERRM); END;
  BEGIN PERFORM update_member((SELECT mid FROM _u WHERE nm = '최파트'), p_is_admin => true); INSERT INTO _r (step, result) VALUES ('[부서장] 관리자 지정', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 관리자 지정', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM update_member((SELECT mid FROM _u WHERE nm = '박관리'), p_position => '변경'); INSERT INTO _r (step, result) VALUES ('[부서장] 관리자 계정 수정', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 관리자 계정 수정', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM update_member((SELECT mid FROM _u WHERE nm = '김본부'), p_position => '변경'); INSERT INTO _r (step, result) VALUES ('[부서장] 상위(본부장) 수정', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 상위(본부장) 수정', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM delete_team(newp); INSERT INTO _r (step, result) VALUES ('[부서장] 만든 파트 지우기', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[부서장] 만든 파트 지우기', 'ERR ' || SQLERRM); END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT uid FROM _u WHERE nm = '김본부'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO _r (step, result) VALUES ('[본부장] 조회 범위 조직 수', (SELECT count(*)::text FROM visible_team_ids()));
  BEGIN PERFORM save_team(NULL, '본부파트', '파트', (SELECT tid FROM _t WHERE nm = '부서')); INSERT INTO _r (step, result) VALUES ('[본부장] 하위 부서 아래 파트 만들기', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[본부장] 하위 부서 아래 파트 만들기', 'ERR ' || SQLERRM); END;
  BEGIN PERFORM save_team(NULL, '본부직속파트', '파트', (SELECT tid FROM _t WHERE nm = '본부')); INSERT INTO _r (step, result) VALUES ('[본부장] 본부 바로 아래 파트', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[본부장] 본부 바로 아래 파트', '막힘: ' || SQLERRM); END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT uid FROM _u WHERE nm = '박관리'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO _r (step, result) VALUES ('[관리자] 관리 범위 조직 수', (SELECT count(*)::text FROM manageable_team_ids()));
  BEGIN PERFORM save_team(NULL, '새부서', '부서', (SELECT tid FROM _t WHERE nm = '본부')); INSERT INTO _r (step, result) VALUES ('[관리자] 부서 만들기', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 부서 만들기', 'ERR ' || SQLERRM); END;
  BEGIN PERFORM save_team(NULL, '거꾸로', '본부', (SELECT tid FROM _t WHERE nm = '파트')); INSERT INTO _r (step, result) VALUES ('[관리자] 파트 아래 본부', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 파트 아래 본부', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM save_team((SELECT tid FROM _t WHERE nm = '부서'), '플랫폼부', '파트', (SELECT tid FROM _t WHERE nm = '본부')); INSERT INTO _r (step, result) VALUES ('[관리자] 하위 있는 부서를 파트로', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 하위 있는 부서를 파트로', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM update_member((SELECT mid FROM _u WHERE nm = '최파트'), p_is_admin => true); INSERT INTO _r (step, result) VALUES ('[관리자] 관리자 지정', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 관리자 지정', 'ERR ' || SQLERRM); END;
  BEGIN PERFORM update_member(current_member_id(), p_is_admin => false); INSERT INTO _r (step, result) VALUES ('[관리자] 내 관리자 해제', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 내 관리자 해제', '막힘: ' || SQLERRM); END;
  BEGIN PERFORM set_meeting_rate('2026-12-01', 30000); INSERT INTO _r (step, result) VALUES ('[관리자] 회의비 단가 (관리자 함수)', 'OK');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[관리자] 회의비 단가 (관리자 함수)', 'ERR ' || SQLERRM); END;
END $$;
RESET ROLE;

UPDATE members SET must_change_password = true WHERE employee_no = '1000004';
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT uid FROM _u WHERE nm = '최파트'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO _r (step, result) VALUES ('[초기 비밀번호] 현재 조직', COALESCE(current_team_id()::text, 'NULL(정상)'));
  INSERT INTO _r (step, result) VALUES ('[초기 비밀번호] 보이는 사용자 수', (SELECT count(*)::text FROM members));
  INSERT INTO _r (step, result) VALUES ('[초기 비밀번호] 보이는 조직', (SELECT string_agg(name, ', ') FROM teams));
END $$;
RESET ROLE;

DO $$
BEGIN
  SET CONSTRAINTS members_keep_admin IMMEDIATE;
  BEGIN UPDATE members SET is_admin = false; INSERT INTO _r (step, result) VALUES ('[DB] 관리자 0명 만들기', 'OK(문제)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r (step, result) VALUES ('[DB] 관리자 0명 만들기', '막힘: ' || SQLERRM); END;
END $$;

SELECT json_agg(json_build_object('step', step, 'result', result) ORDER BY n) FROM _r;

ROLLBACK;
