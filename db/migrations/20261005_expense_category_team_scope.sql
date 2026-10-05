-- =====================================================================
-- 코웍-코인 v2.6 — 팀이 만든 경비 구분: 팀별 이름 · 체크리스트를 보는 팀에게도 구분 이름이 보이게
--   실행 순서: 20261004_app_data_v2_5.sql · 20261004b_app_data_v2_5_delete_functions.sql 다음
--              (Supabase SQL Editor 에서 전체를 한 번에 실행)
--
--   문제
--   · 팀 구분은 만든 팀만 읽을 수 있어(expense_categories_select), 주관 팀이 팀 구분을 붙인 공개 항목을
--     배분받은 코웍 팀이 보면 구분이 빈칸
--   · 구분 이름이 전체에서 하나뿐이라(expense_categories_name_key), 다른 팀이 먼저 만든 이름을 쓰면
--     그 팀 구분을 가리켜 — 우리 팀 화면에서도 빈칸이고 우리 팀 구분 목록에도 안 나옴
--
--   변경
--   1. 이름 중복 금지: 전체 → 공통 구분끼리 · 같은 팀 안에서만 (팀마다 같은 이름을 따로 가질 수 있음)
--   2. category_id_of: 공통 구분 → 우리 팀 구분 → 없으면 우리 팀 구분으로 새로 (다른 팀 구분은 쓰지 않음)
--   3. 읽기: 공통 · 우리 팀 구분 + 내가 볼 수 있는 체크리스트 항목이 쓰는 구분
--      (checklist_items 읽기 정책이 그대로 적용됨 — 비공개 항목의 구분은 주관 팀만)
-- =====================================================================

BEGIN;

-- 1. 이름 중복 금지 범위
ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_common_name_key ON expense_categories (name) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_team_name_key   ON expense_categories (team_id, name) WHERE team_id IS NOT NULL;

-- 2. 경비 구분 이름 → id (권한은 v2.5 그대로: 다른 함수 안에서만 씀, 직접 호출 불가)
CREATE OR REPLACE FUNCTION category_id_of(p_name text) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  n text := NULLIF(btrim(p_name), '');
  cid smallint;
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  IF char_length(n) > 20 THEN RAISE EXCEPTION '경비 구분 이름은 20자까지 입력할 수 있습니다'; END IF;
  SELECT id INTO cid FROM expense_categories
  WHERE name = n AND (team_id IS NULL OR team_id = me)
  ORDER BY (team_id IS NULL) DESC
  LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO expense_categories (name, sort_order, team_id) VALUES (n, 100, me)
    ON CONFLICT DO NOTHING
    RETURNING id INTO cid;
    -- 같은 순간 같은 팀이 같은 이름을 먼저 만든 경우
    IF cid IS NULL THEN
      SELECT id INTO cid FROM expense_categories WHERE name = n AND team_id = me;
    END IF;
  END IF;
  RETURN cid;
END $$;

-- 3. 읽기 정책
DROP POLICY IF EXISTS expense_categories_select ON expense_categories;
CREATE POLICY expense_categories_select ON expense_categories FOR SELECT TO authenticated
  USING ((SELECT current_team_id()) IS NOT NULL AND (
    team_id IS NULL
    OR team_id = (SELECT current_team_id())
    OR EXISTS (SELECT 1 FROM checklist_items c WHERE c.category_id = expense_categories.id)
  ));

COMMIT;

-- 확인 (선택): 아래 결과에 expense_categories_name_key 가 없고, 두 인덱스가 보이면 반영된 것
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expense_categories';
