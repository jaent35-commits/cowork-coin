-- =====================================================================
-- 코웍-코인 v3.3 — 영수증 인식(Google Cloud Vision) 월 한도
--   · 영수증 사진은 Edge Function ocr-receipt 가 Google Cloud Vision 으로 읽음 (API 키는 함수 비밀값에만)
--   · 한 달(한국 시간 1일 ~ 말일) 동안 서비스 전체에서 서버 인식을 쓸 수 있는 횟수 = 월 한도
--       - 관리자가 관리자 > 영수증 인식 에서 0 ~ 1,000 사이로 정함 (기본 1,000 — Vision 무료 사용량이 월 1,000건)
--       - 0 이면 서버 인식을 쓰지 않음 · 한도를 다 쓰면 그 달은 휴대폰 안 인식(지금 방식)으로 읽음
--   · 사용 기록에는 누가 · 언제만 남김 (사진 · 인식한 글자는 저장하지 않음)
--
--   실행: Supabase SQL Editor 에서 한 번 (여러 번 실행해도 결과 같음)
--         그다음 Edge Function 배포 · GOOGLE_VISION_API_KEY 비밀값 설정 · 앱 배포 (deploy/OCR.md)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 시스템 설정(app_settings, 키-값 · schema.sql 에 이미 있음) — 영수증 인식 월 한도 기본 1,000
-- ---------------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES ('ocr_monthly_limit', '1000') ON CONFLICT (key) DO NOTHING;

-- 월 한도 (값이 없거나 숫자가 아니면 0 = 서버 인식 안 씀)
CREATE OR REPLACE FUNCTION ocr_limit() RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN value ~ '^\d{1,4}$' THEN LEAST(value::integer, 1000) END
                   FROM app_settings WHERE key = 'ocr_monthly_limit'), 0)
$$;

-- ---------------------------------------------------------------------
-- 2. 서버 인식 사용 기록 (누가 · 언제)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocr_usage (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id  bigint      REFERENCES members(id) ON DELETE SET NULL,
  used_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_usage_used_at_idx ON ocr_usage (used_at);
ALTER TABLE ocr_usage ENABLE ROW LEVEL SECURITY;      -- 정책 없음 = 함수로만

-- 이번 달 시작 (한국 시간 1일 0시)
CREATE OR REPLACE FUNCTION ocr_month_start() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
$$;

-- ---------------------------------------------------------------------
-- 3. 화면용 — 이번 달 한도 · 사용 (로그인한 사용자 누구나)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ocr_quota() RETURNS TABLE (monthly_limit integer, used integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_member_id() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  RETURN QUERY
    SELECT ocr_limit(), (SELECT count(*)::integer FROM ocr_usage u WHERE u.used_at >= ocr_month_start());
END $$;

-- 관리자: 월 한도 바꾸기 (0 ~ 1,000)
CREATE OR REPLACE FUNCTION set_ocr_limit(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_team() THEN RAISE EXCEPTION '영수증 인식 한도는 관리자만 바꿀 수 있습니다'; END IF;
  IF p_limit IS NULL OR p_limit < 0 OR p_limit > 1000 THEN RAISE EXCEPTION '월 한도는 0 ~ 1,000건 사이로 입력하세요'; END IF;
  INSERT INTO app_settings (key, value) VALUES ('ocr_monthly_limit', p_limit::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN p_limit;
END $$;

-- 관리자: 이번 달 사용자별 사용 횟수 (많이 쓴 순)
CREATE OR REPLACE FUNCTION ocr_usage_by_member() RETURNS TABLE (member_id bigint, name varchar, used integer, last_used timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_team() THEN RAISE EXCEPTION '관리자만 볼 수 있습니다'; END IF;
  RETURN QUERY
    SELECT u.member_id, m.name, count(*)::integer, max(u.used_at)
    FROM ocr_usage u LEFT JOIN members m ON m.id = u.member_id
    WHERE u.used_at >= ocr_month_start()
    GROUP BY u.member_id, m.name
    ORDER BY count(*) DESC, max(u.used_at) DESC;
END $$;

-- ---------------------------------------------------------------------
-- 4. Edge Function(ocr-receipt) 전용 — 한 건 쓰기 · 되돌리기 (service_role 만 실행)
-- ---------------------------------------------------------------------
-- 한도 안이면 사용 기록을 남기고 그 id 를, 한도를 다 썼으면 NULL — 동시에 여러 명이 찍어도 한도를 넘지 않게 설정 줄을 잠금
CREATE OR REPLACE FUNCTION ocr_consume(p_member_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer;
  v_id    bigint;
BEGIN
  PERFORM 1 FROM app_settings WHERE key = 'ocr_monthly_limit' FOR UPDATE;
  v_limit := ocr_limit();
  IF v_limit <=(SELECT count(*) FROM ocr_usage WHERE used_at >= ocr_month_start()) THEN
    RETURN NULL;
  END IF;
  INSERT INTO ocr_usage (member_id) VALUES (p_member_id) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Vision 호출이 실패하면 방금 남긴 기록을 지움 (10분 안의 기록만)
CREATE OR REPLACE FUNCTION ocr_release(p_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM ocr_usage WHERE id = p_id AND used_at > now() - interval '10 minutes'
$$;

-- ---------------------------------------------------------------------
-- 5. 실행 권한 — 새 함수는 기본으로 닫혀 있음
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE ocr_usage FROM anon, authenticated;
REVOKE ALL ON FUNCTION ocr_limit(), ocr_month_start(), ocr_quota(), set_ocr_limit(integer), ocr_usage_by_member(),
  ocr_consume(bigint), ocr_release(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ocr_quota(), set_ocr_limit(integer), ocr_usage_by_member() TO authenticated;
GRANT EXECUTE ON FUNCTION ocr_consume(bigint), ocr_release(bigint) TO service_role;

COMMIT;

-- 확인 (선택)
-- SELECT * FROM app_settings WHERE key = 'ocr_monthly_limit';     -- 1000
-- SELECT count(*) FROM ocr_usage WHERE used_at >= ocr_month_start();
