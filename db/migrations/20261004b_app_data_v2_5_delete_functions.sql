-- =====================================================================
-- 코웍-코인 v2.5 (2/2) — 삭제가 들어간 쓰기 함수
--   20261004_app_data_v2_5.sql 다음에 Supabase SQL Editor 에서 실행
--   (MCP 도구는 DELETE 가 들어간 SQL 을 확인 창 없이 실행하지 않아 이 부분만 따로 둠)
--   · 이 함수들이 없어도 조회·체크·집행 등록은 동작 — 프로젝트 저장(배분 포함)·체크리스트 삭제·집행 수정·삭제만 이 파일이 필요
--   · 함수 정의만 만들고 데이터는 지우지 않음
-- =====================================================================

BEGIN;

-- 프로젝트 등록·수정 + 팀 배분(주면 목록 전체로 교체) — 주관 팀만
--   배분 합계 ≤ 배분 가능 금액, 사용액 있는 배분 삭제 금지는 schema.sql 트리거·외래키가 검사
--   p: name · client · start_date · end_date · total_amount · alloc_pool · memo · is_active · inactive_from
--   p_allocs: [{ team: 팀명, amount, use_end_date }]
CREATE OR REPLACE FUNCTION save_project(p_id bigint, p jsonb, p_allocs jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  pid bigint := p_id;
  a jsonb;
  tid bigint;
  keep bigint[] := '{}';
BEGIN
  IF pid IS NULL THEN
    INSERT INTO projects (name, client, start_date, end_date, total_amount, alloc_pool, owner_team_id, is_active, inactive_from, memo)
    VALUES (btrim(p->>'name'), NULLIF(btrim(p->>'client'), ''), (p->>'start_date')::date, (p->>'end_date')::date,
            COALESCE((p->>'total_amount')::bigint, 0), COALESCE((p->>'alloc_pool')::bigint, 0), me,
            COALESCE((p->>'is_active')::boolean, true), NULLIF(p->>'inactive_from', '')::date, NULLIF(btrim(p->>'memo'), ''))
    RETURNING id INTO pid;
  ELSE
    IF NOT owns_project(pid) THEN RAISE EXCEPTION '주관 팀만 프로젝트를 수정할 수 있습니다'; END IF;
    UPDATE projects SET
      name = btrim(p->>'name'), client = NULLIF(btrim(p->>'client'), ''),
      start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      total_amount = COALESCE((p->>'total_amount')::bigint, 0), alloc_pool = COALESCE((p->>'alloc_pool')::bigint, 0),
      memo = NULLIF(btrim(p->>'memo'), ''),
      is_active = COALESCE((p->>'is_active')::boolean, is_active),
      inactive_from = CASE WHEN COALESCE((p->>'is_active')::boolean, is_active) THEN NULL ELSE NULLIF(p->>'inactive_from', '')::date END
    WHERE id = pid;
  END IF;
  IF p_allocs IS NOT NULL THEN
    FOR a IN SELECT value FROM jsonb_array_elements(p_allocs) LOOP
      SELECT id INTO tid FROM teams WHERE name = btrim(a->>'team');
      IF tid IS NULL THEN RAISE EXCEPTION '팀을 찾을 수 없습니다: %', a->>'team'; END IF;
      INSERT INTO project_allocations (project_id, team_id, amount, use_end_date)
      VALUES (pid, tid, COALESCE((a->>'amount')::bigint, 0), NULLIF(a->>'use_end_date', '')::date)
      ON CONFLICT (project_id, team_id) DO UPDATE SET amount = EXCLUDED.amount, use_end_date = EXCLUDED.use_end_date;
      keep := keep || tid;
    END LOOP;
    DELETE FROM project_allocations WHERE project_id = pid AND NOT (team_id = ANY (keep));
  END IF;
  RETURN pid;
END $$;

-- 체크리스트 삭제 — 주관 팀만
CREATE OR REPLACE FUNCTION checklist_delete(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE proj bigint;
BEGIN
  PERFORM require_team();
  SELECT project_id INTO proj FROM checklist_items WHERE id = p_id;
  IF proj IS NULL THEN RETURN; END IF;
  IF NOT owns_project(proj) THEN RAISE EXCEPTION '체크리스트는 주관 팀만 삭제할 수 있습니다'; END IF;
  DELETE FROM checklist_items WHERE id = p_id;
END $$;

-- 집행 수정 (우리 팀 건만) — 항목은 보낸 목록으로 교체
CREATE OR REPLACE FUNCTION exec_update(p_id bigint, r jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me bigint := require_team();
BEGIN
  UPDATE exec_records SET budget_type = (r->>'type')::budget_type, project_id = NULLIF(r->>'project_id', '')::bigint,
                          use_date = (r->>'use_date')::date
  WHERE id = p_id AND team_id = me;
  IF NOT FOUND THEN RAISE EXCEPTION '우리 팀 집행만 수정할 수 있습니다'; END IF;
  DELETE FROM exec_items WHERE record_id = p_id;
  INSERT INTO exec_items (record_id, line_no, name, amount)
  SELECT p_id, t.ord, COALESCE(NULLIF(btrim(t.x->>'name'), ''), '기타 경비'), (t.x->>'amount')::bigint
  FROM jsonb_array_elements(r->'items') WITH ORDINALITY AS t(x, ord);
END $$;

-- 집행 삭제 (우리 팀 건만, 항목은 외래키 CASCADE)
CREATE OR REPLACE FUNCTION exec_delete(p_ids bigint[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me bigint := require_team();
BEGIN
  DELETE FROM exec_records WHERE id = ANY (p_ids) AND team_id = me;
END $$;

REVOKE ALL ON FUNCTION save_project(bigint, jsonb, jsonb), checklist_delete(bigint), exec_update(bigint, jsonb), exec_delete(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_project(bigint, jsonb, jsonb), checklist_delete(bigint), exec_update(bigint, jsonb), exec_delete(bigint[])
  TO authenticated;

COMMIT;
