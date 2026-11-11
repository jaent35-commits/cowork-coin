-- =====================================================================
-- 코웍-코인 v3.0 — 팀 계정(1팀 1계정) → 조직 + 사용자(1인 1계정)
--   실행 순서: 20261111_reset_for_members.sql 바로 다음 (팀이 하나도 없어야 함)
--              (Supabase SQL Editor 에서 전체를 한 번에 실행)
--
--   구조
--   · teams   = 조직 (본부 · 부서 · 파트) — 예산 · 집행 · 프로젝트 · 체크리스트는 지금처럼 조직 단위
--               + parent_id(상위 조직) · unit_level(본부/부서/파트), 로그인 칸은 members 로 이동
--   · members = 사용자 (사번 로그인 · 성명 · 직위 · 회사 이메일 · 소속 조직 · 관리자)
--   · current_team_id() = 로그인한 사용자의 소속 조직 → 기존 권한 정책 · 쓰기 함수는 그대로 동작
--   · visible_team_ids() = 우리 조직 + 하위 조직 (상위 조직장의 하위 조직 조회용 — 조회 화면은 다음 단계)
--   · 알림 읽음 · 알림 설정은 사람 단위로 (같은 조직이어도 사람마다 따로 읽고, 따로 켜고 끔)
--   · 집행 · 체크리스트에 등록한 사람 · 체크한 사람을 남김
--   · slack_recipients 없앰 — 슬랙 DM 은 각 사용자의 회사 이메일로 (다음 단계)
--
--   이 SQL 을 실행하면 지금 배포된 앱 · Edge Function 의 로그인은 동작하지 않음
--   → 다음 단계(사번 로그인 · 사용자 등록) 배포와 함께 쓰기
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams) THEN
    RAISE EXCEPTION '팀 데이터가 남아 있습니다 — 20261111_reset_for_members.sql 을 먼저 실행하세요';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. 조직: 로그인 칸 걷어내고 상위 조직 · 구분 추가
-- ---------------------------------------------------------------------
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

-- 상위 조직은 더 높은 구분이어야 함 (본부 > 부서 > 파트) → 순환도 생길 수 없음
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
-- 하위 조직이 있는 조직의 구분을 낮추면 하위 조직이 더 높아짐 → 막음
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

-- ---------------------------------------------------------------------
-- 2. 사용자
-- ---------------------------------------------------------------------
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

-- 활성 관리자는 늘 1명 이상
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

-- ---------------------------------------------------------------------
-- 3. 로그인한 사용자 · 조직
-- ---------------------------------------------------------------------
-- 로그인한 사용자 (활성 · 비밀번호 변경 완료 · 소속 조직 활성) — 아니면 NULL
CREATE OR REPLACE FUNCTION current_member_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM members m JOIN teams t ON t.id = m.team_id
  WHERE m.auth_user_id = auth.uid() AND m.is_active AND NOT m.must_change_password AND t.is_active
$$;

-- 기존 정책 · 함수가 쓰는 '현재 팀' = 로그인한 사용자의 소속 조직 (이름 · 반환 형태 그대로)
CREATE OR REPLACE FUNCTION current_team_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.team_id FROM members m JOIN teams t ON t.id = m.team_id
  WHERE m.auth_user_id = auth.uid() AND m.is_active AND NOT m.must_change_password AND t.is_active
$$;

-- 관리자 (이름은 그대로 — set_meeting_rate 등이 씀)
CREATE OR REPLACE FUNCTION is_admin_team() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM members WHERE id = current_member_id()), false)
$$;

-- 우리 조직 + 하위 조직 전부 (상위 조직장의 조회 범위)
CREATE OR REPLACE FUNCTION visible_team_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE v(id) AS (
    SELECT current_team_id() WHERE current_team_id() IS NOT NULL
    UNION
    SELECT t.id FROM teams t JOIN v ON t.parent_id = v.id
  )
  SELECT id FROM v
$$;

-- 첫 실행 (사용자가 아무도 없음)
CREATE OR REPLACE FUNCTION needs_setup() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM members)
$$;

-- 초기 비밀번호 상태 (Edge Function 만 — service_role)
CREATE OR REPLACE FUNCTION set_password_state(p_member_id bigint, p_initial boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE members SET must_change_password = p_initial,
                     password_changed_at  = CASE WHEN p_initial THEN NULL ELSE now() END
  WHERE id = p_member_id
$$;

-- ---------------------------------------------------------------------
-- 4. 관리 권한: 관리자 = 전체 · 부서장 이상(소속이 본부 · 부서 = 2뎁스까지) = 내 조직 아래
--    · 본부 · 부서 조직은 고정 (관리자만 바꿈) — 부서장 이상은 내 조직 아래 3뎁스(파트)만 만들고 고치고 지움
--    · 사용자 등록 · 비밀번호 초기화 · 정보 수정: 관리 범위 조직의 사용자만 (계정 만들기 · 초기화는 Edge Function)
--    · 관리자 지정 · 해제와 관리자 계정 수정은 관리자만
-- ---------------------------------------------------------------------
-- 사용자 한 명의 관리 범위 조직 (Edge Function 이 호출한 사람 기준으로 씀 — service_role)
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

-- 로그인한 사용자의 관리 범위 (앱: 사용자 · 조직 관리 메뉴 표시와 선택지)
CREATE OR REPLACE FUNCTION manageable_team_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT manageable_team_ids_of(current_member_id())
$$;

CREATE OR REPLACE FUNCTION can_manage_team(p_team_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_team_id IS NOT NULL AND p_team_id IN (SELECT manageable_team_ids_of(current_member_id()))
$$;

-- 조직 추가(p_id NULL) · 수정 — 이름 · 구분 · 상위 조직 · 활성
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

-- 조직 삭제 — 소속 사용자 · 하위 조직 · 이력이 없을 때만 (있으면 비활성으로)
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

-- 사용자 정보 수정 — 성명 · 직위 · 이메일 · 소속 · 활성 · 관리자 (사번은 로그인 계정과 함께 바꿔야 해 Edge Function)
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
    -- 이메일이 바뀌면 슬랙 계정을 다시 찾게
    slack_user_id = CASE WHEN p_email IS NOT NULL AND NULLIF(btrim(p_email), '') IS DISTINCT FROM email THEN NULL ELSE slack_user_id END,
    team_id   = COALESCE(p_team_id, team_id),
    is_active = COALESCE(p_is_active, is_active),
    is_admin  = COALESCE(p_is_admin, is_admin)
  WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------
-- 5. 등록한 사람 · 체크한 사람 기록
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 6. 알림 읽음 · 알림 설정 → 사람 단위
-- ---------------------------------------------------------------------
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

-- 팀이 받는 사람을 따로 등록하던 표 → 사용자 회사 이메일로 대체
DROP TABLE IF EXISTS slack_recipients;
DROP FUNCTION IF EXISTS slack_recipients_limit();

-- ---------------------------------------------------------------------
-- 7. 권한 (RLS)
-- ---------------------------------------------------------------------
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

-- 조직 목록: 로그인한 사용자 모두 (배분 대상 · 조직 선택) · 초기 비밀번호 상태에서도 내 조직은 보임
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING ((SELECT current_member_id()) IS NOT NULL
         OR id IN (SELECT team_id FROM members WHERE auth_user_id = (SELECT auth.uid())));

-- 사용자 목록: 로그인한 사용자 모두 (등록자 이름 표시) · 초기 비밀번호 상태에서는 나만
CREATE POLICY members_select ON members FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()) OR (SELECT current_member_id()) IS NOT NULL);
-- 쓰기 정책 없음: 계정은 Edge Function, 수정은 update_member

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
-- team_level_rank 는 계산만 하는 함수라 그대로 둠 (트리거 안에서 호출한 사용자 권한으로 실행)
GRANT EXECUTE ON FUNCTION current_member_id(), visible_team_ids(), manageable_team_ids(), can_manage_team(bigint),
  save_team(bigint, varchar, varchar, bigint, boolean), delete_team(bigint),
  update_member(bigint, varchar, varchar, varchar, bigint, boolean, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION set_password_state(bigint, boolean), manageable_team_ids_of(bigint) TO service_role;

COMMIT;

-- 확인 (선택)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'teams' ORDER BY ordinal_position;
-- SELECT needs_setup();   -- true (사용자 없음)
