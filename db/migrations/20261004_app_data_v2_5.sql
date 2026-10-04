-- =====================================================================
-- 코웍-코인 v2.5 — 앱 데이터 연동 (프로젝트 · 배분 · 체크리스트 · 집행 · 팀 예산 · 알림)
--   실행 순서: schema.sql → supabase.sql → migrations(v2.2, v2.3) → 이 파일
--   · 읽기 = 팀별 RLS 정책 (로그인 + 초기 비밀번호 변경 완료 팀만, current_team_id())
--   · 쓰기 = SECURITY DEFINER 함수 (권한 검사 + 여러 행을 한 트랜잭션으로) — 팀 인원·업무비·알림 읽음·알림 설정·
--            팀 구분·알림 추가만 테이블 직접 쓰기 정책
--   · 앱 기능 컬럼: 프로젝트 메모 · 코웍 팀 사용 종료일 · 팀이 만든 경비 구분
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 앱 기능 컬럼
-- ---------------------------------------------------------------------
ALTER TABLE projects            ADD COLUMN IF NOT EXISTS memo text;
ALTER TABLE project_allocations ADD COLUMN IF NOT EXISTS use_end_date date;   -- 이 날까지 사용일자인 집행만 이 배분에서 차감 (없으면 프로젝트 종료일)

-- 경비 구분: team_id NULL = 모든 팀 공통 고정 구분, 값 = 그 팀이 직접 만든 구분 (그 팀 목록에만 보임)
--   이름 중복 금지(expense_categories_name_key)는 그대로 — 다른 팀이 먼저 만든 같은 이름은 그 구분을 같이 씀 (category_id_of)
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE CASCADE;
-- 앱 고정 구분 (예전 구분 식비·교통비 등은 이미 쓴 항목이 있어 남김)
INSERT INTO expense_categories (name, sort_order) VALUES
  ('회의비(원가)', 11), ('업무비(원가)', 12), ('일반교통비(원가)', 13), ('기타(원가)', 14)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. 정책용 함수 — 로그인한 팀의 프로젝트(주관 + 배분받은 참여)
--    SECURITY DEFINER: projects ↔ project_allocations 정책이 서로를 다시 검사하지 않게
-- ---------------------------------------------------------------------
CREATE FUNCTION my_project_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM projects WHERE owner_team_id = current_team_id()
  UNION
  SELECT project_id FROM project_allocations WHERE team_id = current_team_id()
$$;

CREATE FUNCTION owns_project(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_id AND owner_team_id = current_team_id())
$$;

-- 프로젝트 × 팀 사용액 (내 프로젝트만) — 참여 팀은 다른 팀 집행 행을 볼 수 없으므로 합계만 제공
CREATE FUNCTION project_usage() RETURNS TABLE (project_id bigint, team_id bigint, used bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.project_id, r.team_id, COALESCE(sum(i.amount), 0)::bigint
  FROM exec_records r JOIN exec_items i ON i.record_id = r.id
  WHERE r.budget_type = 'project' AND r.project_id IN (SELECT my_project_ids())
  GROUP BY r.project_id, r.team_id
$$;

-- ---------------------------------------------------------------------
-- 3. 읽기 정책
-- ---------------------------------------------------------------------
CREATE POLICY projects_select ON projects FOR SELECT TO authenticated
  USING (id IN (SELECT my_project_ids()));
CREATE POLICY project_allocations_select ON project_allocations FOR SELECT TO authenticated
  USING (project_id IN (SELECT my_project_ids()));
-- 주관 프로젝트는 전부, 배분받은 참여 프로젝트는 공개 항목만
CREATE POLICY checklist_items_select ON checklist_items FOR SELECT TO authenticated
  USING (owns_project(project_id) OR (visibility = 'public' AND project_id IN (SELECT my_project_ids())));
-- 우리 팀 집행 + 주관 프로젝트에 다른 팀이 집행한 건 (주관 팀의 프로젝트 월별 집행 보기)
CREATE POLICY exec_records_select ON exec_records FOR SELECT TO authenticated
  USING (team_id = (SELECT current_team_id()) OR (project_id IS NOT NULL AND owns_project(project_id)));
CREATE POLICY exec_items_select ON exec_items FOR SELECT TO authenticated
  USING (record_id IN (SELECT id FROM exec_records));
CREATE POLICY meeting_rates_select ON meeting_rates FOR SELECT TO authenticated
  USING ((SELECT current_team_id()) IS NOT NULL);
CREATE POLICY expense_categories_select ON expense_categories FOR SELECT TO authenticated
  USING ((SELECT current_team_id()) IS NOT NULL AND (team_id IS NULL OR team_id = (SELECT current_team_id())));
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING ((SELECT current_team_id()) IS NOT NULL AND (target_team_id IS NULL OR target_team_id = (SELECT current_team_id())));
CREATE POLICY legacy_yearly_totals_select ON legacy_yearly_totals FOR SELECT TO authenticated
  USING (team_id = (SELECT current_team_id()));

-- ---------------------------------------------------------------------
-- 4. 우리 팀 행 직접 쓰기 정책
-- ---------------------------------------------------------------------
CREATE POLICY team_headcounts_own ON team_headcounts FOR ALL TO authenticated
  USING (team_id = (SELECT current_team_id())) WITH CHECK (team_id = (SELECT current_team_id()));
CREATE POLICY work_budgets_own ON work_budgets FOR ALL TO authenticated
  USING (team_id = (SELECT current_team_id())) WITH CHECK (team_id = (SELECT current_team_id()));
CREATE POLICY notification_reads_own ON notification_reads FOR ALL TO authenticated
  USING (team_id = (SELECT current_team_id())) WITH CHECK (team_id = (SELECT current_team_id()));
CREATE POLICY notification_prefs_own ON notification_prefs FOR ALL TO authenticated
  USING (team_id = (SELECT current_team_id())) WITH CHECK (team_id = (SELECT current_team_id()));
-- 알림: 앱이 배분 변경·집행 등록·기한 임박 알림을 받는 팀 앞으로 남김 (읽기는 받는 팀만)
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_team_id()) IS NOT NULL);

-- ---------------------------------------------------------------------
-- 5. 쓰기 함수
-- ---------------------------------------------------------------------
CREATE FUNCTION require_team() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me bigint := current_team_id();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다 (활성 팀 · 비밀번호 변경 완료)'; END IF;
  RETURN me;
END $$;

-- 경비 구분 이름 → id: 공통 구분 → 우리 팀 구분 → (이름 중복 금지라) 다른 팀이 먼저 만든 같은 이름 → 없으면 우리 팀 구분으로 새로
CREATE FUNCTION category_id_of(p_name text) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  n text := NULLIF(btrim(p_name), '');
  cid smallint;
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO cid FROM expense_categories WHERE name = n
  ORDER BY (team_id IS NULL) DESC, (team_id = me) DESC NULLS LAST LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO expense_categories (name, sort_order, team_id) VALUES (n, 100, me) RETURNING id INTO cid;
  END IF;
  RETURN cid;
END $$;

-- 체크리스트 추가·수정 (주관 팀만) — 수정은 보낸 항목만 바꿈
--   p: project_id(추가 때) · title · amount · category · due_date · visibility
CREATE FUNCTION checklist_save(p_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  cid bigint := p_id;
  proj bigint;
BEGIN
  IF cid IS NULL THEN
    proj := (p->>'project_id')::bigint;
    IF NOT owns_project(proj) THEN RAISE EXCEPTION '체크리스트는 주관 팀만 만들 수 있습니다'; END IF;
    INSERT INTO checklist_items (project_id, created_by_team_id, title, amount, category_id, due_date, visibility)
    VALUES (proj, me, btrim(p->>'title'), COALESCE((p->>'amount')::bigint, 0), category_id_of(p->>'category'),
            NULLIF(p->>'due_date', '')::date, COALESCE(NULLIF(p->>'visibility', ''), 'public')::checklist_visibility)
    RETURNING id INTO cid;
  ELSE
    SELECT project_id INTO proj FROM checklist_items WHERE id = cid;
    IF proj IS NULL OR NOT owns_project(proj) THEN RAISE EXCEPTION '체크리스트는 주관 팀만 수정할 수 있습니다'; END IF;
    UPDATE checklist_items SET
      title       = CASE WHEN p ? 'title' THEN btrim(p->>'title') ELSE title END,
      amount      = CASE WHEN p ? 'amount' THEN (p->>'amount')::bigint ELSE amount END,
      category_id = CASE WHEN p ? 'category' THEN category_id_of(p->>'category') ELSE category_id END,
      due_date    = CASE WHEN p ? 'due_date' THEN NULLIF(p->>'due_date', '')::date ELSE due_date END,
      visibility  = CASE WHEN p ? 'visibility' THEN (p->>'visibility')::checklist_visibility ELSE visibility END
    WHERE id = cid;
  END IF;
  RETURN cid;
END $$;

-- 체크(집행 완료) · 집행 금액 · 집행일 — 주관 팀 또는 공개 항목의 배분 팀
CREATE FUNCTION checklist_set_exec(p_id bigint, p_checked boolean, p_spent bigint DEFAULT NULL, p_date date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  c checklist_items%ROWTYPE;
BEGIN
  SELECT * INTO c FROM checklist_items WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '체크리스트 항목을 찾을 수 없습니다'; END IF;
  IF NOT (owns_project(c.project_id) OR (c.visibility = 'public' AND c.project_id IN (SELECT my_project_ids()))) THEN
    RAISE EXCEPTION '이 항목을 체크할 수 없는 팀입니다';
  END IF;
  UPDATE checklist_items SET
    is_checked         = p_checked,
    checked_at         = CASE WHEN p_checked THEN COALESCE(c.checked_at, now()) END,
    checked_by_team_id = CASE WHEN p_checked THEN COALESCE(c.checked_by_team_id, me) END,
    spent_amount       = CASE WHEN p_checked THEN COALESCE(p_spent, c.spent_amount, c.amount) END,
    spent_date         = CASE WHEN p_checked THEN COALESCE(p_date, c.spent_date, (now() AT TIME ZONE 'Asia/Seoul')::date) END
  WHERE id = p_id;
END $$;

-- 집행 등록 (여러 건) — 우리 팀 집행. 프로젝트 경비는 배분받은 팀만(외래키)
--   p: [{ type: meeting|work|project, project_id, use_date, items: [{ name, amount }] }]
CREATE FUNCTION exec_add(p jsonb) RETURNS SETOF bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  r jsonb;
  rid bigint;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(p) LOOP
    INSERT INTO exec_records (team_id, budget_type, project_id, use_date)
    VALUES (me, (r->>'type')::budget_type, NULLIF(r->>'project_id', '')::bigint, (r->>'use_date')::date)
    RETURNING id INTO rid;
    INSERT INTO exec_items (record_id, line_no, name, amount)
    SELECT rid, t.ord, COALESCE(NULLIF(btrim(t.x->>'name'), ''), '기타 경비'), (t.x->>'amount')::bigint
    FROM jsonb_array_elements(r->'items') WITH ORDINALITY AS t(x, ord);
    RETURN NEXT rid;
  END LOOP;
END $$;

-- 팀 회의비 1인당 월 단가 (관리자 팀만) — p_from 달부터 적용
CREATE FUNCTION set_meeting_rate(p_from date, p_rate integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_team() THEN RAISE EXCEPTION '관리자 팀만 단가를 바꿀 수 있습니다'; END IF;
  INSERT INTO meeting_rates (effective_from, rate) VALUES (date_trunc('month', p_from)::date, p_rate)
  ON CONFLICT (effective_from) DO UPDATE SET rate = EXCLUDED.rate;
END $$;

-- ---------------------------------------------------------------------
-- 6. 실행 권한 — 새 함수는 기본으로 닫혀 있음(supabase.sql §7) → 로그인한 팀에게만
--    category_id_of · require_team 은 다른 함수 안에서만 씀 (직접 호출 불가)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION my_project_ids(), owns_project(bigint), project_usage(), require_team(), category_id_of(text),
                       checklist_save(bigint, jsonb), checklist_set_exec(bigint, boolean, bigint, date), exec_add(jsonb),
                       set_meeting_rate(date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION my_project_ids(), owns_project(bigint), project_usage(),
                          checklist_save(bigint, jsonb), checklist_set_exec(bigint, boolean, bigint, date), exec_add(jsonb),
                          set_meeting_rate(date, integer)
  TO authenticated;

-- 삭제가 들어간 쓰기 함수(save_project · checklist_delete · exec_update · exec_delete)는
-- 20261004b_app_data_v2_5_delete_functions.sql (Supabase SQL Editor 에서 실행)

-- ---------------------------------------------------------------------
-- 7. 알림 남기기 (받는 팀 앞으로) — dedupe_key 가 같은 알림은 한 번만
--    ON CONFLICT 는 RLS 조회 정책까지 검사해 다른 팀 앞 알림을 막으므로 함수 안에서 처리
-- ---------------------------------------------------------------------
CREATE FUNCTION notify_add(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_team();
  INSERT INTO notifications (type, title, body, target_team_id, dedupe_key)
  SELECT (x->>'type')::notif_type, left(x->>'title', 100), x->>'body', NULLIF(x->>'target_team_id', '')::bigint, NULLIF(x->>'dedupe_key', '')
  FROM jsonb_array_elements(p) AS x
  ON CONFLICT (dedupe_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION notify_add(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_add(jsonb) TO authenticated;

COMMIT;
