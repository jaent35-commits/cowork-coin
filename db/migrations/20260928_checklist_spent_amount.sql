-- =====================================================================
-- 코웍-코인 v2.2 — 체크리스트 집행 금액
--   이미 schema.sql · supabase.sql 이 적용된 DB 에 실행 (새로 만드는 DB 는 schema.sql 에 포함됨)
--   · 체크할 때 집행 금액 입력 — 기본값은 예정 금액(amount), 체크 해제하면 NULL
--   · 화면: 집행 금액을 크게, 예정 금액은 '예산'으로 작게
-- =====================================================================

BEGIN;

ALTER TABLE checklist_items
  ADD COLUMN spent_amount bigint CHECK (spent_amount >= 0);

-- 이미 체크된 항목은 예정 금액을 집행 금액으로
UPDATE checklist_items SET spent_amount = amount WHERE is_checked AND spent_amount IS NULL;

ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_spent_check CHECK ((spent_amount IS NOT NULL) = is_checked);

COMMENT ON COLUMN checklist_items.amount       IS '예정 금액 (예산)';
COMMENT ON COLUMN checklist_items.spent_amount IS '집행 금액 — 체크할 때 입력 (기본 = 예정 금액), 미체크면 NULL';

-- c.* 는 뷰를 만들 때 펼쳐지므로 새 컬럼을 넣으려면 다시 정의 (새 컬럼은 맨 뒤라 OR REPLACE 가능)
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
