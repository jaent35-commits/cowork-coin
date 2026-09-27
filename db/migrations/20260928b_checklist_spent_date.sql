-- =====================================================================
-- 코웍-코인 v2.3 — 체크리스트 집행일
--   20260928_checklist_spent_amount.sql (v2.2) 다음에 실행 (새로 만드는 DB 는 schema.sql 에 포함됨)
--   · 체크하면 예정일(due_date) 자리에 집행일을 보여 줌 — 기본은 체크한 날, 수정 가능
--   · 예정일은 그대로 두어 체크를 해제하면 다시 예정일로 돌아감
--   · 잠금(오클릭 방지)은 화면 기능이라 DB 에 저장하지 않음
-- =====================================================================

BEGIN;

ALTER TABLE checklist_items ADD COLUMN spent_date date;

-- 이미 체크된 항목: 체크한 날(한국 시간) → 없으면 예정일 → 없으면 오늘
UPDATE checklist_items
SET spent_date = COALESCE((checked_at AT TIME ZONE 'Asia/Seoul')::date, due_date, (now() AT TIME ZONE 'Asia/Seoul')::date)
WHERE is_checked AND spent_date IS NULL;

ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_spent_date_check CHECK ((spent_date IS NOT NULL) = is_checked);

COMMENT ON COLUMN checklist_items.spent_date IS '집행일 — 체크할 때 그날로 기본 입력 (수정 가능), 미체크면 NULL';

-- c.* 에 새 컬럼을 넣기 위해 다시 정의 (맨 뒤 추가라 OR REPLACE 가능)
CREATE OR REPLACE VIEW v_team_checklist WITH (security_invoker = true) AS
SELECT p.owner_team_id AS team_id, 'owner'::text AS role, c.*
FROM checklist_items c JOIN projects p ON p.id = c.project_id
UNION ALL
SELECT a.team_id, 'participant', c.*
FROM checklist_items c
JOIN projects p ON p.id = c.project_id
JOIN project_allocations a ON a.project_id = c.project_id AND a.team_id <> p.owner_team_id
WHERE c.visibility = 'public';

COMMIT;
