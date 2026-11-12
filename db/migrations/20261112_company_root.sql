-- =====================================================================
-- 조직 최상위 '회사'(대교CNS) — 회사 › 본부 › 부서 › 파트
--   · 구분에 '회사' 추가 (순위 0 — 본부보다 위, 회사는 하나만)
--   · 대교CNS 회사 조직을 만들고, 상위가 없는 본부를 모두 그 아래로 옮김
--   · 회사에도 사용자가 바로 소속될 수 있음 (예: 대표이사) → 관리 범위는 전체
--   · 회사 조직은 관리자만 바꿈 (save_team 의 '파트만' 규칙 그대로)
-- 실행: Supabase SQL Editor 에서 한 번 (여러 번 실행해도 결과 같음)
-- =====================================================================
BEGIN;

-- 1. 구분에 '회사' 추가
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_unit_level_check;
ALTER TABLE teams ADD CONSTRAINT teams_unit_level_check CHECK (unit_level IN ('회사', '본부', '부서', '파트'));
COMMENT ON TABLE teams IS '조직 (회사 · 본부 · 부서 · 파트) — 예산 · 집행 · 프로젝트의 단위. 로그인은 members';
COMMENT ON COLUMN teams.unit_level IS '회사 · 본부 · 부서 · 파트 — 상위 조직은 항상 더 높은 구분';

-- 2. 순위: 회사 0 > 본부 1 > 부서 2 > 파트 3 (상위 조직 검사 트리거가 그대로 씀 → 회사는 상위 조직을 가질 수 없음)
CREATE OR REPLACE FUNCTION team_level_rank(p_level varchar) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_level WHEN '회사' THEN 0 WHEN '본부' THEN 1 WHEN '부서' THEN 2 ELSE 3 END $$;

-- 3. 회사는 하나만
CREATE UNIQUE INDEX IF NOT EXISTS teams_one_company ON teams ((true)) WHERE unit_level = '회사';

-- 4. 대교CNS 만들기 + 최상위 본부를 그 아래로
INSERT INTO teams (name, unit_level, parent_id)
SELECT '대교CNS', '회사', NULL
WHERE NOT EXISTS (SELECT 1 FROM teams WHERE unit_level = '회사');

UPDATE teams SET parent_id = (SELECT id FROM teams WHERE unit_level = '회사')
WHERE parent_id IS NULL AND unit_level = '본부';

COMMIT;

-- 확인 (구분별 개수 · 최상위 여부)
-- SELECT unit_level, parent_id IS NULL AS is_root, count(*) FROM teams GROUP BY 1, 2 ORDER BY 1, 2;
