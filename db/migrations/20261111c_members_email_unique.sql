-- =====================================================================
-- 코웍-코인 v3.0 — 운영 전에 실행: 사용자 회사 이메일 중복 금지
--   테스트 동안은 여러 사용자가 같은 이메일(테스트 담당자)을 써서 DM 을 한곳에서 받음
--   → 실제 사용자 이메일로 바꾼 뒤 이 파일을 실행 (중복이 남아 있으면 어떤 이메일인지 알려 주고 멈춤)
--   실행 순서: 20261111b_org_members.sql 이후 아무 때나
-- =====================================================================

BEGIN;

DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(e || ' (' || n || '명)', ', ') INTO dup
  FROM (SELECT lower(email) AS e, count(*) AS n FROM members WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '같은 이메일을 쓰는 사용자가 있습니다: % — 각자 이메일로 바꾼 뒤 다시 실행하세요', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS members_email_key ON members (lower(email)) WHERE email IS NOT NULL;

COMMIT;
