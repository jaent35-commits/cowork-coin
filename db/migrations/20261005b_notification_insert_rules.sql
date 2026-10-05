-- =====================================================================
-- 코웍-코인 v2.7 — 알림 남기기 규칙: 앱이 실제로 보내는 알림만, 받을 수 있는 팀 앞으로만
--   실행 순서: 20261005_expense_category_team_scope.sql 다음
--              (Supabase SQL Editor 에서 전체를 한 번에 실행)
--
--   문제
--   · notifications_insert 정책이 '로그인한 팀이면 아무 알림이나' 허용 — 앱을 거치지 않고 API 로 직접
--     다른 팀 앞 알림, 모든 팀 대상(target_team_id NULL) 알림, 아무 종류(admin·system 등)나 남길 수 있음
--   · notify_add 도 종류·받는 팀을 검사하지 않음
--   · dedupe_key 가 전체에서 하나뿐이라, 다른 팀이 같은 키를 먼저 남기면 그 팀의 기한 임박·예산 경고가 막힘
--
--   변경
--   1. 알림 표에 직접 쓰기 금지 — 앱은 notify_add 로만, 비밀번호 알림은 Edge Function(service_role)이 남김
--   2. notify_add 규칙 (앱이 보내는 알림 3종과 같음 — src/store/reducer.ts)
--      · alloc(배분 변경) : 우리 팀이 주관하는 프로젝트에 배분이 있는 팀 앞으로만
--      · budget(예산 경고) · deadline(기한 임박) : 우리 팀 앞으로만
--      · 그 밖의 종류 · 받는 팀 없음(모든 팀) → 거절 / 제목 100자 · 내용 500자 · 한 번에 50건까지
--   3. 중복 방지 키는 받는 팀마다 따로 (같은 키라도 팀이 다르면 각각 1회)
--
--   그대로인 것: 읽기(받는 팀 · 모든 팀 대상만) · 읽음 표시(우리 팀 것만) · 이미 저장된 알림
-- =====================================================================

BEGIN;

-- 1. 직접 쓰기 금지 (읽기 정책 notifications_select 는 그대로)
DROP POLICY IF EXISTS notifications_insert ON notifications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON notifications FROM anon, authenticated;

-- 3. 중복 방지 키: 전체 1개 → 받는 팀마다 1개
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_dedupe_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_target_dedupe_key ON notifications (target_team_id, dedupe_key);

-- 2. 알림 남기기
CREATE OR REPLACE FUNCTION notify_add(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me bigint := require_team();
  x jsonb;
  t notif_type;
  target bigint;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '알림 형식이 올바르지 않습니다'; END IF;
  IF jsonb_array_length(p) > 50 THEN RAISE EXCEPTION '알림은 한 번에 50건까지 남길 수 있습니다'; END IF;

  FOR x IN SELECT value FROM jsonb_array_elements(p) LOOP
    t := (x->>'type')::notif_type;
    target := NULLIF(x->>'target_team_id', '')::bigint;
    IF target IS NULL THEN RAISE EXCEPTION '받는 팀이 없는 알림은 남길 수 없습니다'; END IF;

    IF t = 'alloc' THEN
      -- 우리 팀이 주관하는 프로젝트에 그 팀 배분(0원 포함)이 있어야 함 — 프로젝트 저장 뒤에 보내므로 배분은 이미 반영됨
      IF NOT EXISTS (
        SELECT 1 FROM project_allocations a JOIN projects pr ON pr.id = a.project_id
        WHERE a.team_id = target AND pr.owner_team_id = me
      ) THEN
        RAISE EXCEPTION '우리 팀이 주관하는 프로젝트에 배분된 팀에게만 배분 알림을 보낼 수 있습니다';
      END IF;
    ELSIF t IN ('budget', 'deadline') THEN
      IF target <> me THEN RAISE EXCEPTION '예산 경고 · 기한 임박 알림은 우리 팀 앞으로만 남길 수 있습니다'; END IF;
    ELSE
      RAISE EXCEPTION '앱에서 남길 수 없는 알림 종류입니다: %', t;
    END IF;

    INSERT INTO notifications (type, title, body, target_team_id, dedupe_key)
    VALUES (t, left(btrim(COALESCE(x->>'title', '')), 100), left(COALESCE(x->>'body', ''), 500), target,
            NULLIF(left(x->>'dedupe_key', 100), ''))
    ON CONFLICT (target_team_id, dedupe_key) DO NOTHING;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION notify_add(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_add(jsonb) TO authenticated;

COMMIT;

-- 확인 (선택)
-- ① notifications 정책에 notifications_select 만 남아 있으면 반영된 것
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications';
-- ② notifications_dedupe_key_key 가 없고 notifications_target_dedupe_key 가 보이면 반영된 것
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications';
