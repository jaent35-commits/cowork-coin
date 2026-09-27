-- =====================================================================
-- 코웍-코인 : 프로젝트 예산 관리 시스템 — PostgreSQL 스키마
--   대상: PostgreSQL 14+
--   원칙: 저장은 '입력값'만, 사용액·잔액·예산 합계 같은 계산값은 뷰(v_*)로 조회
--   문서: db/ERD.md
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- 비밀번호 해시 crypt() / gen_salt()

-- ---------------------------------------------------------------------
-- 열거형
-- ---------------------------------------------------------------------
-- 예산 유형: meeting = 팀 회의비, work = 팀 업무비, project = 프로젝트 경비
CREATE TYPE budget_type AS ENUM ('meeting', 'work', 'project');

-- 알림 종류 (exec·setting·alloc·deadline 은 종류별 푸시 on/off 대상)
-- 체크리스트 공개 범위: public = 배분받은 코웍 팀 모두, private = 주관 팀만
CREATE TYPE checklist_visibility AS ENUM ('public', 'private');

CREATE TYPE notif_type AS ENUM ('exec', 'setting', 'alloc', 'deadline', 'budget', 'project', 'admin', 'system');

-- ---------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- =====================================================================
-- 1. 팀 · 시스템 설정
-- =====================================================================
CREATE TABLE teams (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          varchar(30)  NOT NULL UNIQUE,              -- 로그인·연동용 코드 (예: dev)
  name          varchar(50)  NOT NULL UNIQUE,              -- 팀 이름 (예: 개발팀)
  password_hash text         NOT NULL,                     -- crypt(비밀번호, gen_salt('bf'))
  is_active     boolean      NOT NULL DEFAULT true,        -- false = 휴면 (로그인 팀 선택에서 제외)
  is_admin      boolean      NOT NULL DEFAULT false,       -- 팀 로그인만으로 관리자 메뉴 접근
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER teams_touch BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 키-값 시스템 설정 (관리자 전용 계정 비밀번호 해시, 비밀번호 초기화 값 해시 등)
CREATE TABLE app_settings (
  key        varchar(50) PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- 2. 팀 운영 예산 (팀 회의비 · 팀 업무비)
-- =====================================================================
-- 팀 회의비 1인당 월 단가 — 적용 시작일부터 다음 변경 전까지 (전사 공통)
CREATE TABLE meeting_rates (
  effective_from date    PRIMARY KEY CHECK (effective_from = date_trunc('month', effective_from::timestamp)::date),
  rate           integer NOT NULL CHECK (rate > 0)
);

-- 팀별 월 인원 — 팀 회의비 예산 = Σ(월 인원 × 그 달 단가), 분기 단위로 사용
CREATE TABLE team_headcounts (
  team_id   bigint   NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month     date     NOT NULL CHECK (month = date_trunc('month', month::timestamp)::date),   -- 매월 1일
  headcount smallint NOT NULL CHECK (headcount >= 0),
  PRIMARY KEY (team_id, month)
);

-- 팀 업무비 월 예산 — 입력한 달부터 다음 입력 전까지 같은 금액 (이월 없음, 남으면 소멸)
CREATE TABLE work_budgets (
  team_id         bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  effective_month date   NOT NULL CHECK (effective_month = date_trunc('month', effective_month::timestamp)::date),
  amount          bigint NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (team_id, effective_month)
);

-- =====================================================================
-- 3. 프로젝트 운영
-- =====================================================================
CREATE TABLE projects (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             varchar(100) NOT NULL,                  -- 사업명
  client           varchar(100),                           -- 발주처
  start_date       date         NOT NULL,                  -- 착수일
  end_date         date         NOT NULL,                  -- 종료일
  total_amount     bigint       NOT NULL CHECK (total_amount >= 0),   -- 프로젝트 경비 총액
  alloc_pool       bigint       NOT NULL CHECK (alloc_pool >= 0),     -- 코웍 팀 배분 가능 금액
  owner_team_id    bigint       NOT NULL REFERENCES teams(id),        -- 주관(등록) 팀
  is_active        boolean      NOT NULL DEFAULT true,
  inactive_from    date,                                   -- '이 달부터 비활성' 월 (매월 1일)
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (alloc_pool <= total_amount),
  CHECK (inactive_from IS NULL OR inactive_from = date_trunc('month', inactive_from::timestamp)::date)
);
CREATE INDEX projects_owner_idx ON projects (owner_team_id);
CREATE INDEX projects_period_idx ON projects (start_date, end_date);
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 코웍-코인 팀 배분 — 프로젝트 배분 가능 금액을 팀별로 나눔 (배분받은 팀 = 참여 팀)
CREATE TABLE project_allocations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id    bigint NOT NULL REFERENCES teams(id),
  amount     bigint NOT NULL CHECK (amount >= 0),
  UNIQUE (project_id, team_id)
);
CREATE INDEX project_allocations_team_idx ON project_allocations (team_id);

-- 팀 배분 합계는 프로젝트 배분 가능 금액을 넘을 수 없음 (트랜잭션 끝에 검사 → 여러 행 수정 중 일시 초과 허용)
CREATE FUNCTION check_alloc_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pid bigint;
  pool bigint;
  alloc bigint;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN pid := NEW.id; ELSE pid := NEW.project_id; END IF;
  SELECT alloc_pool INTO pool FROM projects WHERE id = pid;
  SELECT COALESCE(sum(amount), 0) INTO alloc FROM project_allocations WHERE project_id = pid;
  IF pool IS NOT NULL AND alloc > pool THEN
    RAISE EXCEPTION '팀 배분 합계(%)가 배분 가능 금액(%)을 초과합니다 (project_id=%)', alloc, pool, pid;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER project_allocations_total
  AFTER INSERT OR UPDATE ON project_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_alloc_total();
CREATE CONSTRAINT TRIGGER projects_alloc_pool
  AFTER UPDATE OF alloc_pool ON projects
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_alloc_total();

-- 사용액(프로젝트 경비 집행 이력)이 있는 팀 배분은 삭제 불가
--   앱: 삭제 대신 '배분액을 사용액으로 맞추기(잔액 0원)' 선택지를 안내
CREATE FUNCTION check_alloc_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  used bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM exec_records r
             WHERE r.budget_type = 'project' AND r.project_id = OLD.project_id AND r.team_id = OLD.team_id) THEN
    SELECT COALESCE(sum(i.amount), 0) INTO used
    FROM exec_records r JOIN exec_items i ON i.record_id = r.id
    WHERE r.budget_type = 'project' AND r.project_id = OLD.project_id AND r.team_id = OLD.team_id;
    RAISE EXCEPTION '사용액(%)이 있는 팀 배분은 삭제할 수 없습니다. 배분액을 사용액으로 맞춰 잔액을 0원으로 만들어 주세요 (project_id=%, team_id=%)',
      used, OLD.project_id, OLD.team_id;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER project_allocations_no_delete_used
  BEFORE DELETE ON project_allocations FOR EACH ROW EXECUTE FUNCTION check_alloc_delete();

-- 경비 분류 (식비 · 교통비 · 자재비 · 숙박비 · 기타)
CREATE TABLE expense_categories (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(20) NOT NULL UNIQUE,
  sort_order smallint    NOT NULL DEFAULT 0
);

-- 경비 집행 체크리스트 — 주관 팀이 만들고 공개 범위를 정함
--   공개: 주관 팀 + 배분받은 코웍 팀이 보고 체크 / 비공개: 주관 팀만
--   생성 · 삭제 · 공개 범위 변경은 주관 팀만 (앱·API 에서 검사)
CREATE TABLE checklist_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id         bigint       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_team_id bigint       NOT NULL REFERENCES teams(id),          -- 작성 팀 (= 주관 팀)
  title              varchar(100) NOT NULL,
  amount             bigint       NOT NULL CHECK (amount >= 0),           -- 예정 금액
  category_id        smallint     REFERENCES expense_categories(id),
  due_date           date,                                                -- 예정일 (없으면 '예정일 없음')
  visibility         checklist_visibility NOT NULL DEFAULT 'public',
  is_checked         boolean      NOT NULL DEFAULT false,
  checked_at         timestamptz,
  checked_by_team_id bigint       REFERENCES teams(id),                   -- 체크한 팀 (주관 또는 참여 팀)
  created_at         timestamptz  NOT NULL DEFAULT now(),
  CHECK (is_checked OR (checked_at IS NULL AND checked_by_team_id IS NULL))
);
CREATE INDEX checklist_items_project_idx ON checklist_items (project_id, due_date);

-- 체크리스트 작성 팀 = 프로젝트 주관 팀, 체크한 팀 = 주관 팀 또는 (공개 항목일 때) 배분받은 팀
CREATE FUNCTION check_checklist_teams() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner bigint;
BEGIN
  SELECT owner_team_id INTO owner FROM projects WHERE id = NEW.project_id;
  IF NEW.created_by_team_id <> owner THEN
    RAISE EXCEPTION '체크리스트는 주관 팀만 만들 수 있습니다 (project_id=%)', NEW.project_id;
  END IF;
  IF NEW.checked_by_team_id IS NOT NULL AND NEW.checked_by_team_id <> owner AND NOT (
       NEW.visibility = 'public'
       AND EXISTS (SELECT 1 FROM project_allocations a WHERE a.project_id = NEW.project_id AND a.team_id = NEW.checked_by_team_id)) THEN
    RAISE EXCEPTION '이 항목을 체크할 수 없는 팀입니다 (team_id=%)', NEW.checked_by_team_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checklist_items_teams BEFORE INSERT OR UPDATE ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION check_checklist_teams();

-- =====================================================================
-- 4. 집행 (팀 회의비 · 팀 업무비 · 프로젝트 경비 공통)
-- =====================================================================
CREATE TABLE exec_records (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id       bigint      NOT NULL REFERENCES teams(id),     -- 집행한 팀
  budget_type   budget_type NOT NULL,
  project_id    bigint,                                        -- budget_type = 'project' 일 때만
  use_date      date        NOT NULL,                          -- 사용일자
  use_month     date        GENERATED ALWAYS AS (date_trunc('month', use_date::timestamp)::date) STORED,  -- 예산 집계 기준 월
  registered_at timestamptz NOT NULL DEFAULT now(),            -- 등록일시
  CHECK ((budget_type = 'project') = (project_id IS NOT NULL)),
  -- 프로젝트 경비는 배분받은 팀만 집행
  FOREIGN KEY (project_id, team_id) REFERENCES project_allocations (project_id, team_id)
);
CREATE INDEX exec_records_team_month_idx ON exec_records (team_id, budget_type, use_month);
CREATE INDEX exec_records_project_idx ON exec_records (project_id) WHERE project_id IS NOT NULL;

-- 집행 항목 (한 번의 집행 등록에 여러 항목)
CREATE TABLE exec_items (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id bigint       NOT NULL REFERENCES exec_records(id) ON DELETE CASCADE,
  line_no   smallint     NOT NULL CHECK (line_no > 0),       -- 항목 번호 (등록 순서)
  name      varchar(100) NOT NULL,
  amount    bigint       NOT NULL CHECK (amount > 0),
  UNIQUE (record_id, line_no)
);

-- =====================================================================
-- 5. 알림
-- =====================================================================
CREATE TABLE notifications (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type           notif_type   NOT NULL,
  title          varchar(100) NOT NULL,
  body           text         NOT NULL,
  target_team_id bigint       REFERENCES teams(id) ON DELETE CASCADE,   -- NULL = 모든 팀
  project_id     bigint       REFERENCES projects(id) ON DELETE SET NULL,
  dedupe_key     varchar(100) UNIQUE,                                   -- 중복 발송 방지 (예: deadline:12:2026-12)
  created_at     timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX notifications_target_idx ON notifications (target_team_id, created_at DESC);

-- 읽음 표시 — 전체 대상 알림도 팀마다 따로 읽음
CREATE TABLE notification_reads (
  notification_id bigint      NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  team_id         bigint      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, team_id)
);

-- 팀별 알림 설정 — 기기 푸시 전체 on/off + 종류별 on/off
CREATE TABLE notification_prefs (
  team_id       bigint      PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  push_enabled  boolean     NOT NULL DEFAULT false,
  push_exec     boolean     NOT NULL DEFAULT true,   -- 집행 등록 완료
  push_setting  boolean     NOT NULL DEFAULT true,   -- 설정 변경
  push_alloc    boolean     NOT NULL DEFAULT true,   -- 새 프로젝트 배분
  push_deadline boolean     NOT NULL DEFAULT true,   -- 기한 임박
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notification_prefs_touch BEFORE UPDATE ON notification_prefs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- 6. 과거 연도 요약 (상세 집행 이력 없이 이관한 연도 — 리포트 연도별 비교용)
-- =====================================================================
CREATE TABLE legacy_yearly_totals (
  team_id      bigint   NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  year         smallint NOT NULL,
  meeting_used bigint   NOT NULL DEFAULT 0 CHECK (meeting_used >= 0),
  project_used bigint   NOT NULL DEFAULT 0 CHECK (project_used >= 0),
  PRIMARY KEY (team_id, year)
);

-- =====================================================================
-- 조회 함수 · 뷰 (계산값)
-- =====================================================================
-- 그 달에 적용되는 회의비 단가
CREATE FUNCTION meeting_rate_of(p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT rate FROM meeting_rates WHERE effective_from <= p_month ORDER BY effective_from DESC LIMIT 1
$$;

-- 그 달의 팀 업무비 예산 (입력한 달이 없으면 가장 가까운 이전 입력값, 없으면 0)
CREATE FUNCTION work_budget_of(p_team bigint, p_month date) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT amount FROM work_budgets
                   WHERE team_id = p_team AND effective_month <= p_month
                   ORDER BY effective_month DESC LIMIT 1), 0)
$$;

-- 집행 1건의 합계
CREATE VIEW v_exec_records AS
SELECT r.*, COALESCE(sum(i.amount), 0)::bigint AS total, count(i.id)::int AS item_count
FROM exec_records r LEFT JOIN exec_items i ON i.record_id = r.id
GROUP BY r.id;

-- 프로젝트 × 팀 배분 사용 현황 + 지분율(팀 배분액 ÷ 프로젝트 배분 총액, %)
CREATE VIEW v_allocation_usage AS
SELECT a.project_id, a.team_id, a.amount AS allocated,
       COALESCE(u.used, 0)::bigint AS used,
       (a.amount - COALESCE(u.used, 0))::bigint AS remain,
       round(a.amount * 100.0 / NULLIF(sum(a.amount) OVER (PARTITION BY a.project_id), 0), 1) AS share_pct
FROM project_allocations a
LEFT JOIN (SELECT project_id, team_id, sum(total) AS used FROM v_exec_records
           WHERE budget_type = 'project' GROUP BY project_id, team_id) u
  ON u.project_id = a.project_id AND u.team_id = a.team_id;

-- 프로젝트 전체 사용 현황 (목록의 전체 경비 · 잔액 · 집행률)
CREATE VIEW v_project_summary AS
SELECT p.id AS project_id, p.name, p.alloc_pool,
       COALESCE(sum(u.allocated), 0)::bigint AS allocated,
       COALESCE(sum(u.used), 0)::bigint AS used,
       (p.alloc_pool - COALESCE(sum(u.used), 0))::bigint AS remain,
       CASE WHEN p.alloc_pool > 0 THEN round(COALESCE(sum(u.used), 0) * 100.0 / p.alloc_pool, 1) END AS used_pct
FROM projects p LEFT JOIN v_allocation_usage u ON u.project_id = p.id
GROUP BY p.id;

-- 체크리스트 기준 예산 = 주관 팀의 My 경비 배분 금액 (참여 팀 배분 예산과 별개)
CREATE VIEW v_project_owner_budget AS
SELECT p.id AS project_id, p.owner_team_id,
       COALESCE(u.allocated, 0)::bigint AS allocated,
       COALESCE(u.used, 0)::bigint AS used,
       COALESCE(u.remain, 0)::bigint AS remain
FROM projects p
LEFT JOIN v_allocation_usage u ON u.project_id = p.id AND u.team_id = p.owner_team_id;

-- 팀의 My 프로젝트 (주관 또는 배분받은 프로젝트)
CREATE VIEW v_team_projects AS
SELECT p.owner_team_id AS team_id, p.id AS project_id, 'owner'::text AS role FROM projects p
UNION
SELECT a.team_id, a.project_id, 'participant' FROM project_allocations a
WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.project_id AND p.owner_team_id = a.team_id);

-- 팀 회의비 분기 예산 · 사용액
CREATE VIEW v_team_meeting_quarters AS
WITH b AS (
  SELECT h.team_id, extract(year FROM h.month)::int AS year, extract(quarter FROM h.month)::int AS quarter,
         sum(h.headcount)::int AS headcount_sum,
         sum(h.headcount * COALESCE(meeting_rate_of(h.month), 0))::bigint AS budget
  FROM team_headcounts h GROUP BY 1, 2, 3
), u AS (
  SELECT team_id, extract(year FROM use_month)::int AS year, extract(quarter FROM use_month)::int AS quarter,
         sum(total)::bigint AS used
  FROM v_exec_records WHERE budget_type = 'meeting' GROUP BY 1, 2, 3
)
SELECT COALESCE(b.team_id, u.team_id) AS team_id, COALESCE(b.year, u.year) AS year, COALESCE(b.quarter, u.quarter) AS quarter,
       COALESCE(b.headcount_sum, 0) AS headcount_sum, COALESCE(b.budget, 0) AS budget, COALESCE(u.used, 0) AS used,
       (COALESCE(b.budget, 0) - COALESCE(u.used, 0))::bigint AS remain
FROM b FULL JOIN u USING (team_id, year, quarter);

-- 팀 업무비 월 예산 · 사용액 (예산을 입력했거나 집행이 있는 달)
CREATE VIEW v_team_work_months AS
WITH m AS (
  SELECT team_id, effective_month AS month FROM work_budgets
  UNION
  SELECT team_id, use_month FROM exec_records WHERE budget_type = 'work'
)
SELECT m.team_id, m.month, work_budget_of(m.team_id, m.month) AS budget,
       COALESCE((SELECT sum(total) FROM v_exec_records r
                 WHERE r.team_id = m.team_id AND r.budget_type = 'work' AND r.use_month = m.month), 0)::bigint AS used
FROM m;

-- 팀별로 보이는 체크리스트 (주관 프로젝트는 전부, 배분받은 참여 프로젝트는 공개 항목만)
CREATE VIEW v_team_checklist AS
SELECT p.owner_team_id AS team_id, 'owner'::text AS role, c.*
FROM checklist_items c JOIN projects p ON p.id = c.project_id
UNION ALL
SELECT a.team_id, 'participant', c.*
FROM checklist_items c
JOIN projects p ON p.id = c.project_id
JOIN project_allocations a ON a.project_id = c.project_id AND a.team_id <> p.owner_team_id
WHERE c.visibility = 'public';

-- 팀별 알림함 (전체 대상 + 우리 팀 대상, 읽음 여부)
CREATE VIEW v_team_notifications AS
SELECT t.id AS team_id, n.*, (r.read_at IS NOT NULL) AS is_read
FROM teams t
JOIN notifications n ON n.target_team_id IS NULL OR n.target_team_id = t.id
LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.team_id = t.id;

-- ---------------------------------------------------------------------
-- 설명 (DB 도구에서 보이도록)
-- ---------------------------------------------------------------------
COMMENT ON TABLE teams                IS '팀 계정 — 로그인 단위';
COMMENT ON TABLE app_settings         IS '시스템 설정 (키-값)';
COMMENT ON TABLE meeting_rates        IS '팀 회의비 1인당 월 단가 이력';
COMMENT ON TABLE team_headcounts      IS '팀 월별 인원 (회의비 예산 산정)';
COMMENT ON TABLE work_budgets         IS '팀 업무비 월 예산 (입력 월부터 적용)';
COMMENT ON TABLE projects             IS '프로젝트';
COMMENT ON TABLE project_allocations  IS '프로젝트 팀 배분 (참여 팀)';
COMMENT ON TABLE expense_categories   IS '경비 분류';
COMMENT ON TABLE checklist_items      IS '경비 집행 체크리스트 (공개/비공개)';
COMMENT ON TABLE exec_records         IS '집행 등록 (헤더)';
COMMENT ON TABLE exec_items           IS '집행 항목 (상세)';
COMMENT ON TABLE notifications        IS '알림';
COMMENT ON TABLE notification_reads   IS '알림 읽음 (팀별)';
COMMENT ON TABLE notification_prefs   IS '팀별 알림 설정';
COMMENT ON TABLE legacy_yearly_totals IS '과거 연도 집행 요약 (이관분)';

COMMIT;
