-- =====================================================================
-- 코웍-코인 — 테스트 데이터 (개발용)
--   실행 순서: db/schema.sql → db/supabase.sql → (마이그레이션 v2.1) → 이 파일
--   · 모든 행에 고정 id → 다시 실행하면 값만 갱신 (upsert). 파일에서 행을 지워도 DB 에서는 지워지지 않음
--   · 팀 Auth 사용자는 비밀번호 없이 만듦 → 로그인 불가. 비밀번호는 Edge Function(admin-reset-password) 단계에서 설정
--   · 팀이 생기므로 needs_setup() 은 false 가 됨 (bootstrap-admin 테스트는 빈 DB 에서)
--   · 기준 연도 2026 (오늘 2026-09-28)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 팀 (Auth 사용자 1:1)
--   1 개발팀   관리자 · 비밀번호 변경 완료
--   2 디자인팀 일반   · 비밀번호 변경 완료
--   3 기획팀   일반   · 초기 비밀번호 상태 (current_team_id() NULL 확인용)
--   4 영업팀   휴면
-- ---------------------------------------------------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, NULL, now(),
       '', '', '', '',
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
FROM (VALUES
  ('c0c0c0c0-0000-4000-8000-000000000001'::uuid, 'team-dev@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000002'::uuid, 'team-design@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000003'::uuid, 'team-plan@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000004'::uuid, 'team-sales@teams.cowork-coin.app')
) AS u(id, email)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now()
FROM auth.users u
WHERE u.id IN ('c0c0c0c0-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000002',
               'c0c0c0c0-0000-4000-8000-000000000003', 'c0c0c0c0-0000-4000-8000-000000000004')
ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data = EXCLUDED.identity_data, updated_at = now();

INSERT INTO teams (id, auth_user_id, login_email, name, is_active, is_admin, must_change_password, password_changed_at)
OVERRIDING SYSTEM VALUE VALUES
  (1, 'c0c0c0c0-0000-4000-8000-000000000001', 'team-dev@teams.cowork-coin.app',    '개발팀',   true,  true,  false, '2026-01-05 09:00+09'),
  (2, 'c0c0c0c0-0000-4000-8000-000000000002', 'team-design@teams.cowork-coin.app', '디자인팀', true,  false, false, '2026-01-06 10:30+09'),
  (3, 'c0c0c0c0-0000-4000-8000-000000000003', 'team-plan@teams.cowork-coin.app',   '기획팀',   true,  false, true,  NULL),
  (4, 'c0c0c0c0-0000-4000-8000-000000000004', 'team-sales@teams.cowork-coin.app',  '영업팀',   false, false, false, '2026-01-07 14:00+09')
ON CONFLICT (id) DO UPDATE SET
  auth_user_id = EXCLUDED.auth_user_id, login_email = EXCLUDED.login_email, name = EXCLUDED.name,
  is_active = EXCLUDED.is_active, is_admin = EXCLUDED.is_admin,
  must_change_password = EXCLUDED.must_change_password, password_changed_at = EXCLUDED.password_changed_at;

-- ---------------------------------------------------------------------
-- 2. 기준 정보 — 회의비 단가 · 경비 분류
-- ---------------------------------------------------------------------
INSERT INTO meeting_rates (effective_from, rate) VALUES
  ('2025-01-01', 30000),
  ('2026-07-01', 35000)   -- 3분기부터 인상
ON CONFLICT (effective_from) DO UPDATE SET rate = EXCLUDED.rate;

INSERT INTO expense_categories (id, name, sort_order) OVERRIDING SYSTEM VALUE VALUES
  (1, '식비', 1), (2, '교통비', 2), (3, '자재비', 3), (4, '숙박비', 4), (5, '기타', 5)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 3. 팀 운영 예산 — 월 인원 · 업무비
-- ---------------------------------------------------------------------
INSERT INTO team_headcounts (team_id, month, headcount)
SELECT t.team_id, m::date, CASE WHEN t.team_id = 1 AND m >= '2026-07-01' THEN t.hc + 1 ELSE t.hc END
FROM (VALUES (1, 8), (2, 5), (3, 4)) AS t(team_id, hc)
CROSS JOIN generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month') AS m
UNION ALL
SELECT 4, m::date, 3 FROM generate_series('2026-01-01'::date, '2026-03-01'::date, interval '1 month') AS m   -- 영업팀: 휴면 전 1분기만
ON CONFLICT (team_id, month) DO UPDATE SET headcount = EXCLUDED.headcount;

INSERT INTO work_budgets (team_id, effective_month, amount) VALUES
  (1, '2026-01-01', 500000),
  (1, '2026-07-01', 600000),   -- 7월부터 증액
  (2, '2026-01-01', 300000),
  (3, '2026-01-01', 300000)
ON CONFLICT (team_id, effective_month) DO UPDATE SET amount = EXCLUDED.amount;

-- ---------------------------------------------------------------------
-- 4. 프로젝트 · 팀 배분
-- ---------------------------------------------------------------------
INSERT INTO projects (id, name, client, start_date, end_date, total_amount, alloc_pool, owner_team_id, is_active, inactive_from)
OVERRIDING SYSTEM VALUE VALUES
  (1, 'AI 학습 플랫폼 고도화', '교육청',  '2026-03-01', '2026-12-31', 50000000, 30000000, 1, true,  NULL),
  (2, '브랜드 리뉴얼',         '대교',    '2026-05-01', '2026-10-31', 20000000, 12000000, 2, true,  NULL),
  (3, '신규 서비스 기획',      NULL,      '2026-01-01', '2026-06-30',  8000000,  5000000, 3, false, '2026-07-01')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, client = EXCLUDED.client, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
  total_amount = EXCLUDED.total_amount, alloc_pool = EXCLUDED.alloc_pool, owner_team_id = EXCLUDED.owner_team_id,
  is_active = EXCLUDED.is_active, inactive_from = EXCLUDED.inactive_from;

-- 배분 합계 ≤ alloc_pool (1: 25M/30M · 2: 11M/12M · 3: 5M/5M)
INSERT INTO project_allocations (id, project_id, team_id, amount) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 1, 12000000),
  (2, 1, 2,  8000000),
  (3, 1, 3,  5000000),
  (4, 2, 2,  7000000),
  (5, 2, 1,  4000000),
  (6, 3, 3,  3000000),
  (7, 3, 1,  2000000)
ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, team_id = EXCLUDED.team_id, amount = EXCLUDED.amount;

-- ---------------------------------------------------------------------
-- 5. 체크리스트 (작성 팀 = 주관 팀, 체크한 팀 = 주관 또는 공개 항목의 배분 팀)
-- ---------------------------------------------------------------------
INSERT INTO checklist_items (id, project_id, created_by_team_id, title, amount, category_id, due_date, visibility,
                             is_checked, checked_at, checked_by_team_id, spent_amount, spent_date)
OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 1, '킥오프 워크숍 식비',   800000, 1, '2026-03-15', 'public',  true,  '2026-03-15 18:00+09', 2, 742000, '2026-03-15'),
  (2, 1, 1, '외부 전문가 자문',    2000000, 5, '2026-10-20', 'private', false, NULL, NULL, NULL, NULL),
  (3, 1, 1, '현장 방문 교통비',     450000, 2, '2026-10-05', 'public',  false, NULL, NULL, NULL, NULL),
  (4, 2, 2, '시안 출력 자재비',     600000, 3, '2026-09-30', 'public',  false, NULL, NULL, NULL, NULL),
  (5, 2, 2, '촬영 숙박비',          900000, 4, NULL,         'public',  false, NULL, NULL, NULL, NULL),
  (6, 3, 3, '사용자 인터뷰 사례비', 500000, 5, '2026-04-10', 'public',  true,  '2026-04-10 17:00+09', 3, 500000, '2026-04-10')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id, created_by_team_id = EXCLUDED.created_by_team_id, title = EXCLUDED.title,
  amount = EXCLUDED.amount, category_id = EXCLUDED.category_id, due_date = EXCLUDED.due_date,
  visibility = EXCLUDED.visibility, is_checked = EXCLUDED.is_checked, checked_at = EXCLUDED.checked_at,
  checked_by_team_id = EXCLUDED.checked_by_team_id, spent_amount = EXCLUDED.spent_amount, spent_date = EXCLUDED.spent_date;

-- ---------------------------------------------------------------------
-- 6. 집행 (헤더 · 항목)
-- ---------------------------------------------------------------------
INSERT INTO exec_records (id, team_id, budget_type, project_id, use_date, registered_at) OVERRIDING SYSTEM VALUE VALUES
  ( 1, 1, 'meeting', NULL, '2026-02-12', '2026-02-12 19:10+09'),
  ( 2, 1, 'meeting', NULL, '2026-08-21', '2026-08-22 09:05+09'),
  ( 3, 2, 'meeting', NULL, '2026-05-08', '2026-05-08 20:00+09'),
  ( 4, 3, 'meeting', NULL, '2026-09-10', '2026-09-11 10:00+09'),
  ( 5, 4, 'meeting', NULL, '2026-01-20', '2026-01-20 19:30+09'),   -- 휴면 전 영업팀 이력
  ( 6, 1, 'work',    NULL, '2026-07-14', '2026-07-14 15:20+09'),
  ( 7, 2, 'work',    NULL, '2026-09-03', '2026-09-03 11:40+09'),
  ( 8, 1, 'project', 1,    '2026-03-15', '2026-03-16 09:00+09'),
  ( 9, 2, 'project', 1,    '2026-06-20', '2026-06-20 16:00+09'),
  (10, 3, 'project', 1,    '2026-08-11', '2026-08-12 08:50+09'),
  (11, 2, 'project', 2,    '2026-07-02', '2026-07-02 17:30+09'),
  (12, 1, 'project', 3,    '2026-03-30', '2026-03-30 13:00+09'),
  (13, 3, 'project', 3,    '2026-04-10', '2026-04-10 18:10+09')
ON CONFLICT (id) DO UPDATE SET
  team_id = EXCLUDED.team_id, budget_type = EXCLUDED.budget_type, project_id = EXCLUDED.project_id,
  use_date = EXCLUDED.use_date, registered_at = EXCLUDED.registered_at;

INSERT INTO exec_items (id, record_id, line_no, name, amount) OVERRIDING SYSTEM VALUE VALUES
  ( 1,  1, 1, '회의 식대',          180000),
  ( 2,  2, 1, '회의 식대',          210000),
  ( 3,  2, 2, '다과',                45000),
  ( 4,  3, 1, '회의 식대',          120000),
  ( 5,  4, 1, '회의 식대',          180000),
  ( 6,  5, 1, '회의 식대',           90000),
  ( 7,  6, 1, '사무용품',            85000),
  ( 8,  6, 2, '도서 구입',           42000),
  ( 9,  7, 1, '소프트웨어 구독',     99000),
  (10,  8, 1, '워크숍 식비',        760000),
  (11,  9, 1, 'UI 리서치 도구',    1200000),
  (12, 10, 1, '현장 교통비',        230000),
  (13, 11, 1, '시안 출력',          350000),
  (14, 11, 2, '폼보드',              80000),
  (15, 12, 1, '프로토타입 호스팅',  150000),
  (16, 13, 1, '인터뷰 사례비',      500000)
ON CONFLICT (id) DO UPDATE SET
  record_id = EXCLUDED.record_id, line_no = EXCLUDED.line_no, name = EXCLUDED.name, amount = EXCLUDED.amount;

-- ---------------------------------------------------------------------
-- 7. 알림 · 읽음 · 알림 설정
-- ---------------------------------------------------------------------
INSERT INTO notifications (id, type, title, body, target_team_id, project_id, dedupe_key, created_at) OVERRIDING SYSTEM VALUE VALUES
  (1, 'system',   '코웍-코인 오픈',        '코웍-코인 예산 관리 서비스를 시작합니다.',                          NULL, NULL, NULL,                 '2026-01-05 09:00+09'),
  (2, 'setting',  '회의비 단가 변경',      '7월부터 팀 회의비 1인당 월 단가가 35,000원으로 바뀝니다.',          NULL, NULL, NULL,                 '2026-06-25 10:00+09'),
  (3, 'alloc',    '새 프로젝트 배분',      'AI 학습 플랫폼 고도화에서 8,000,000원을 배분받았습니다.',          2,    1,    NULL,                 '2026-03-02 09:30+09'),
  (4, 'exec',     '집행 등록 완료',        '팀 업무비 127,000원 집행이 등록되었습니다.',                        1,    NULL, NULL,                 '2026-07-14 15:20+09'),
  (5, 'deadline', '체크리스트 기한 임박',  'AI 학습 플랫폼 고도화 — 현장 방문 교통비 예정일이 다가옵니다.',     1,    1,    'deadline:3:2026-10', '2026-09-28 09:00+09'),
  (6, 'admin',    '비밀번호 초기화',       '관리자가 비밀번호를 초기화했습니다. 로그인 후 새 비밀번호로 바꿔 주세요.', 3, NULL, NULL,          '2026-09-27 16:00+09')
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type, title = EXCLUDED.title, body = EXCLUDED.body, target_team_id = EXCLUDED.target_team_id,
  project_id = EXCLUDED.project_id, dedupe_key = EXCLUDED.dedupe_key, created_at = EXCLUDED.created_at;

INSERT INTO notification_reads (notification_id, team_id, read_at) VALUES
  (1, 1, '2026-01-05 09:10+09'),
  (1, 2, '2026-01-05 11:00+09'),
  (2, 1, '2026-06-25 10:30+09'),
  (3, 2, '2026-03-02 10:00+09')
ON CONFLICT (notification_id, team_id) DO UPDATE SET read_at = EXCLUDED.read_at;

INSERT INTO notification_prefs (team_id, push_enabled, push_exec, push_setting, push_alloc, push_deadline) VALUES
  (1, true,  true, true, true, true),
  (2, false, true, true, true, true),
  (3, true,  true, true, true, false)
ON CONFLICT (team_id) DO UPDATE SET
  push_enabled = EXCLUDED.push_enabled, push_exec = EXCLUDED.push_exec, push_setting = EXCLUDED.push_setting,
  push_alloc = EXCLUDED.push_alloc, push_deadline = EXCLUDED.push_deadline;

-- ---------------------------------------------------------------------
-- 8. 과거 연도 요약 (리포트 연도별 비교)
-- ---------------------------------------------------------------------
INSERT INTO legacy_yearly_totals (team_id, year, meeting_used, project_used) VALUES
  (1, 2024, 1850000,  9400000),
  (1, 2025, 2100000, 12300000),
  (2, 2025, 1200000,  6500000)
ON CONFLICT (team_id, year) DO UPDATE SET meeting_used = EXCLUDED.meeting_used, project_used = EXCLUDED.project_used;

-- ---------------------------------------------------------------------
-- 9. 자동 번호를 고정 id 뒤로 (앱·Edge Function 이 새로 만드는 행과 겹치지 않게)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  m bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams', 'expense_categories', 'projects', 'project_allocations', 'checklist_items',
                           'exec_records', 'exec_items', 'notifications'] LOOP
    EXECUTE format('SELECT COALESCE(max(id), 0) FROM public.%I', t) INTO m;
    PERFORM setval(pg_get_serial_sequence('public.' || t, 'id'), m + 1, false);
  END LOOP;
END $$;

COMMIT;
