-- =====================================================================
-- 코웍-코인 — 오픈 전 검증용 테스트 데이터 (운영 Supabase 에 넣고 검증 후 cleanup_test_data.sql 로 삭제)
--   실행 순서: db/schema.sql → db/supabase.sql → (마이그레이션 v2.1) → 이 파일
--   · 모든 행에 고정 id → 다시 실행하면 값만 갱신 (upsert). 파일에서 행을 지워도 DB 에서는 지워지지 않음
--   · 팀 Auth 사용자는 비밀번호 없이 만듦 → 이 파일만으로는 로그인 불가
--     비밀번호는 저장소에 두지 않고 적용할 때 따로 설정 (auth.users.encrypted_password = crypt(…)) — 값은 git 제외 파일에 보관
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
  ('2026-07-01', 30000)   -- 이력 행 (단가 기준 30,000원 유지)
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

-- =====================================================================
-- 9. 추가 검증 케이스 (경계값 · 예외 상황)
--   팀 (id 5 는 운영 DB 첫 실행 때 만든 관리자 팀이 쓰고 있어 비워 둠)
--     9 마케팅팀          두 번째 관리자 (관리자 여러 팀)
--     6 운영지원팀         방금 만든 팀 — 임시 비밀번호 · 데이터 없음 (빈 화면)
--     7 R&D·데이터분석센터 특수문자 팀명 · 6월 인원 0명
--     8 인사팀             휴면 · 이력 없음 → 삭제 가능 (영업팀은 이력 있어 삭제 불가)
--   예산
--     마케팅팀 3분기 회의비 초과 (630,000 예산 / 720,000 사용)
--     개발팀 9월 업무비 딱 맞게 사용 (600,000 / 600,000) · 10월 예산 변경 예정 (700,000)
--     디자인팀 9월 업무비 초과 (300,000 / 466,500) · 한 건에 5개 항목
--     R&D 6/30 · 7/1 회의비 (분기 경계) · 디자인팀 늦게 등록한 6월 회의비 (7/3 등록)
--   프로젝트
--     4 배분 100% · 배분 팀 잔액 0 / 배분 초과 사용 · 체크리스트 여러 상태
--     5 등록만 하고 배분 없음        6 오늘 종료
--     7 착수 전 (11월 시작)           8 긴 이름 · 억 단위 금액
--     9 연도에 걸친 프로젝트 (2025년 집행 포함)   10 중간에 비활성 (사용 이력 있음)
--   체크리스트: 기한 지남 · 오늘 마감 · 예산보다 더/덜 집행 · 0원 · 분류·예정일 없음 · 참여 팀이 체크 · 긴 제목
-- =====================================================================
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, NULL, now(),
       '', '', '', '',
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
FROM (VALUES
  ('c0c0c0c0-0000-4000-8000-000000000005'::uuid, 'team-marketing@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000006'::uuid, 'team-ops@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000007'::uuid, 'team-rnd@teams.cowork-coin.app'),
  ('c0c0c0c0-0000-4000-8000-000000000008'::uuid, 'team-hr@teams.cowork-coin.app')
) AS u(id, email)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now()
FROM auth.users u
WHERE u.id IN ('c0c0c0c0-0000-4000-8000-000000000005', 'c0c0c0c0-0000-4000-8000-000000000006',
               'c0c0c0c0-0000-4000-8000-000000000007', 'c0c0c0c0-0000-4000-8000-000000000008')
ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data = EXCLUDED.identity_data, updated_at = now();

INSERT INTO teams (id, auth_user_id, login_email, name, is_active, is_admin, must_change_password, password_changed_at)
OVERRIDING SYSTEM VALUE VALUES
  (9, 'c0c0c0c0-0000-4000-8000-000000000005', 'team-marketing@teams.cowork-coin.app', '마케팅팀',           true,  true,  false, '2026-01-08 09:00+09'),
  (6, 'c0c0c0c0-0000-4000-8000-000000000006', 'team-ops@teams.cowork-coin.app',       '운영지원팀',         true,  false, true,  NULL),
  (7, 'c0c0c0c0-0000-4000-8000-000000000007', 'team-rnd@teams.cowork-coin.app',       'R&D·데이터분석센터', true,  false, false, '2026-04-01 09:00+09'),
  (8, 'c0c0c0c0-0000-4000-8000-000000000008', 'team-hr@teams.cowork-coin.app',        '인사팀',             false, false, false, '2026-02-02 09:00+09')
ON CONFLICT (id) DO UPDATE SET
  auth_user_id = EXCLUDED.auth_user_id, login_email = EXCLUDED.login_email, name = EXCLUDED.name,
  is_active = EXCLUDED.is_active, is_admin = EXCLUDED.is_admin,
  must_change_password = EXCLUDED.must_change_password, password_changed_at = EXCLUDED.password_changed_at;

INSERT INTO team_headcounts (team_id, month, headcount)
SELECT 9, m::date, 6 FROM generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month') AS m
UNION ALL
SELECT 7, m::date, CASE WHEN m = '2026-06-01' THEN 0 ELSE 3 END   -- 6월 전원 파견 → 0명
FROM generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') AS m
ON CONFLICT (team_id, month) DO UPDATE SET headcount = EXCLUDED.headcount;

INSERT INTO work_budgets (team_id, effective_month, amount) VALUES
  (1, '2026-10-01', 700000),   -- 다음 달부터 변경 예정
  (9, '2026-01-01', 400000),
  (7, '2026-04-01', 200000)
ON CONFLICT (team_id, effective_month) DO UPDATE SET amount = EXCLUDED.amount;

INSERT INTO projects (id, name, client, start_date, end_date, total_amount, alloc_pool, owner_team_id, is_active, inactive_from)
OVERRIDING SYSTEM VALUE VALUES
  ( 4, '가을 신제품 런칭 캠페인', '대교 마케팅본부', '2026-08-01', '2026-11-30',   15000000,   10000000, 9, true,  NULL),
  ( 5, '사내 교육 프로그램',      NULL,              '2026-09-21', '2027-03-31',   10000000,    6000000, 1, true,  NULL),
  ( 6, '고객 만족도 조사',        '한국리서치',      '2026-04-01', '2026-09-28',    3000000,    3000000, 3, true,  NULL),
  ( 7, '차세대 학습앱 PoC',       '교육청',          '2026-11-01', '2027-02-28',   12000000,    8000000, 7, true,  NULL),
  ( 8, '2026년 전국 초중고 AI 디지털교과서 연계 학습데이터 분석 및 맞춤형 학습경로 추천 시스템 구축 사업',
        '한국교육학술정보원(KERIS) 디지털교육본부 에듀테크진흥부', '2026-02-01', '2027-01-31', 2500000000, 1800000000, 1, true, NULL),
  ( 9, '연간 유지보수 (2025~2027)', '대교',          '2025-07-01', '2027-06-30',   36000000,   24000000, 7, true,  NULL),
  (10, '팝업스토어 기획(보류)',   '대교 마케팅본부', '2026-06-01', '2026-12-31',    5000000,    3000000, 9, false, '2026-09-01')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, client = EXCLUDED.client, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
  total_amount = EXCLUDED.total_amount, alloc_pool = EXCLUDED.alloc_pool, owner_team_id = EXCLUDED.owner_team_id,
  is_active = EXCLUDED.is_active, inactive_from = EXCLUDED.inactive_from;

-- 4: 10M/10M(100%) · 5: 배분 없음 · 6: 3M/3M · 7: 8M/8M · 8: 1.75B/1.8B · 9: 24M/24M · 10: 2M/3M
INSERT INTO project_allocations (id, project_id, team_id, amount) OVERRIDING SYSTEM VALUE VALUES
  ( 8,  4, 9,   6000000),
  ( 9,  4, 2,   3000000),   -- 3,250,000 사용 → 배분 초과
  (10,  4, 1,   1000000),   -- 1,000,000 사용 → 잔액 0
  (11,  6, 3,   2000000),
  (12,  6, 7,   1000000),
  (13,  7, 7,   5000000),
  (14,  7, 1,   3000000),
  (15,  8, 1, 900000000),
  (16,  8, 7, 600000000),
  (17,  8, 2, 250000000),
  (18,  9, 7,  14000000),
  (19,  9, 1,  10000000),
  (20, 10, 9,   2000000)
ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, team_id = EXCLUDED.team_id, amount = EXCLUDED.amount;

INSERT INTO checklist_items (id, project_id, created_by_team_id, title, amount, category_id, due_date, visibility,
                             is_checked, checked_at, checked_by_team_id, spent_amount, spent_date)
OVERRIDING SYSTEM VALUE VALUES
  ( 7,  4, 9, '행사장 대관료',        3000000, 5,    '2026-10-15', 'public',  false, NULL, NULL, NULL, NULL),
  ( 8,  4, 9, '홍보물 인쇄',           800000, 3,    '2026-09-20', 'public',  false, NULL, NULL, NULL, NULL),   -- 기한 지남
  ( 9,  4, 9, '기자 간담회 식비',     1200000, 1,    '2026-09-28', 'public',  false, NULL, NULL, NULL, NULL),   -- 오늘 마감
  (10,  4, 9, '모델 섭외비',          2500000, 5,    '2026-09-10', 'private', true,  '2026-09-11 14:00+09', 9, 2800000, '2026-09-11'),   -- 예산보다 더 집행
  (11,  4, 9, '현수막 제작',          1000000, 3,    '2026-09-15', 'public',  true,  '2026-09-15 16:30+09', 2, 1250000, '2026-09-15'),   -- 참여 팀이 체크
  (12,  4, 9, '온라인 광고',          2500000, 5,    '2026-09-01', 'public',  true,  '2026-09-01 11:00+09', 9, 2400000, '2026-09-01'),   -- 예산보다 덜 집행
  (13,  4, 9, '예비비',                     0, NULL, NULL,         'private', false, NULL, NULL, NULL, NULL),   -- 0원 · 분류·예정일 없음
  (14,  4, 9, '출장 숙박비',           450000, 4,    '2026-11-20', 'public',  false, NULL, NULL, NULL, NULL),
  (15,  6, 3, '설문 인센티브',         800000, 5,    '2026-09-25', 'public',  true,  '2026-09-24 18:00+09', 7, 800000, '2026-09-24'),    -- 예정일보다 먼저 집행
  (16,  7, 7, 'PoC 서버 구축',        2000000, 5,    '2026-11-15', 'public',  false, NULL, NULL, NULL, NULL),
  (17,  7, 7, '사용자 테스트 사례비',  600000, 5,    '2027-01-20', 'private', false, NULL, NULL, NULL, NULL),   -- 다음 해 예정
  (18, 10, 9, '팝업 부스 제작',       1500000, 3,    '2026-10-01', 'public',  false, NULL, NULL, NULL, NULL),   -- 비활성 프로젝트
  (19,  8, 1, 'GPU 사용료 1분기 선결제', 150000000, 5, '2026-04-30', 'public', true, '2026-04-30 17:00+09', 1, 123456789, '2026-04-30'),
  (20,  8, 1, '학습데이터 분석 결과 보고서 인쇄 및 제본 (컬러 200부, 양면, 무선 제본, 표지 코팅 포함)', 1980000, 3, '2026-12-15', 'public', false, NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id, created_by_team_id = EXCLUDED.created_by_team_id, title = EXCLUDED.title,
  amount = EXCLUDED.amount, category_id = EXCLUDED.category_id, due_date = EXCLUDED.due_date,
  visibility = EXCLUDED.visibility, is_checked = EXCLUDED.is_checked, checked_at = EXCLUDED.checked_at,
  checked_by_team_id = EXCLUDED.checked_by_team_id, spent_amount = EXCLUDED.spent_amount, spent_date = EXCLUDED.spent_date;

INSERT INTO exec_records (id, team_id, budget_type, project_id, use_date, registered_at) OVERRIDING SYSTEM VALUE VALUES
  (14, 9, 'meeting', NULL, '2026-07-10', '2026-07-10 19:00+09'),
  (15, 9, 'meeting', NULL, '2026-08-28', '2026-08-28 21:10+09'),
  (16, 9, 'meeting', NULL, '2026-09-25', '2026-09-25 19:40+09'),   -- 3분기 예산 초과
  (17, 1, 'work',    NULL, '2026-09-05', '2026-09-05 14:00+09'),   -- 9월 업무비 딱 맞게
  (18, 2, 'work',    NULL, '2026-09-18', '2026-09-18 17:20+09'),   -- 항목 5개 · 9월 업무비 초과
  (19, 7, 'meeting', NULL, '2026-06-30', '2026-06-30 20:00+09'),   -- 2분기 마지막 날 (6월 인원 0명)
  (20, 7, 'meeting', NULL, '2026-07-01', '2026-07-01 19:30+09'),   -- 3분기 첫날
  (21, 2, 'meeting', NULL, '2026-06-28', '2026-07-03 10:00+09'),   -- 늦게 등록 (사용 월 기준 2분기)
  (22, 1, 'project', 4,    '2026-09-12', '2026-09-12 18:00+09'),
  (23, 2, 'project', 4,    '2026-08-20', '2026-08-20 15:00+09'),
  (24, 2, 'project', 4,    '2026-09-15', '2026-09-15 16:40+09'),
  (25, 9, 'project', 4,    '2026-09-01', '2026-09-01 11:10+09'),
  (26, 7, 'project', 6,    '2026-09-24', '2026-09-24 18:10+09'),
  (27, 3, 'project', 6,    '2026-05-20', '2026-05-20 10:30+09'),
  (28, 1, 'project', 8,    '2026-04-30', '2026-04-30 17:10+09'),
  (29, 7, 'project', 8,    '2026-09-26', '2026-09-26 11:00+09'),
  (30, 7, 'project', 9,    '2025-11-14', '2025-11-14 15:00+09'),   -- 지난해 집행
  (31, 1, 'project', 9,    '2025-12-22', '2025-12-23 09:00+09'),
  (32, 7, 'project', 9,    '2026-02-10', '2026-02-10 13:30+09'),
  (33, 9, 'project', 10,   '2026-07-15', '2026-07-15 17:00+09'),   -- 비활성 전 사용
  (34, 7, 'work',    NULL, '2026-06-12', '2026-06-12 10:00+09'),
  (35, 9, 'work',    NULL, '2026-09-08', '2026-09-08 16:00+09')
ON CONFLICT (id) DO UPDATE SET
  team_id = EXCLUDED.team_id, budget_type = EXCLUDED.budget_type, project_id = EXCLUDED.project_id,
  use_date = EXCLUDED.use_date, registered_at = EXCLUDED.registered_at;

INSERT INTO exec_items (id, record_id, line_no, name, amount) OVERRIDING SYSTEM VALUE VALUES
  (17, 14, 1, '회의 식대',              320000),
  (18, 15, 1, '회의 식대',              180000),
  (19, 15, 2, '다과',                    45000),
  (20, 15, 3, '음료',                    25000),
  (21, 16, 1, '회의 식대',              150000),
  (22, 17, 1, '모니터 암',              350000),
  (23, 17, 2, '기계식 키보드',          250000),
  (24, 18, 1, '디자인 폰트 라이선스',   132000),
  (25, 18, 2, '태블릿 펜심',             18000),
  (26, 18, 3, '스케치북',                12500),
  (27, 18, 4, '컬러칩 샘플',             46000),
  (28, 18, 5, '외장 SSD',               159000),
  (29, 19, 1, '회의 식대',               60000),
  (30, 20, 1, '회의 식대',               45000),
  (31, 21, 1, '회의 식대',               95000),
  (32, 22, 1, '행사 장비 렌탈',        1000000),
  (33, 23, 1, '포스터 디자인 외주',    2000000),
  (34, 24, 1, '현수막 제작',           1250000),
  (35, 25, 1, '온라인 광고',           2400000),
  (36, 25, 2, '인플루언서 협찬',       1100000),
  (37, 26, 1, '설문 인센티브',          800000),
  (38, 27, 1, '조사 설계 자문',        1500000),
  (39, 28, 1, '클라우드 GPU 사용료', 123456789),
  (40, 29, 1, '데이터 라벨링 외주',   87650000),
  (41, 29, 2, '검수 인력',            12340000),
  (42, 30, 1, '서버 유지보수',         1800000),
  (43, 31, 1, '장애 대응 야간 식비',     96000),
  (44, 32, 1, '라이선스 갱신',         3300000),
  (45, 33, 1, '장소 답사 교통비',        64000),
  (46, 34, 1, '데이터 저장소 구독',      55000),
  (47, 35, 1, '광고 소재 이미지 구매',   88000)
ON CONFLICT (id) DO UPDATE SET
  record_id = EXCLUDED.record_id, line_no = EXCLUDED.line_no, name = EXCLUDED.name, amount = EXCLUDED.amount;

INSERT INTO notifications (id, type, title, body, target_team_id, project_id, dedupe_key, created_at) OVERRIDING SYSTEM VALUE VALUES
  ( 7, 'budget',   '회의비 예산 초과',      '3분기 팀 회의비 사용액이 예산보다 90,000원 많습니다.',                        9,    NULL, NULL,                  '2026-09-25 20:00+09'),
  ( 8, 'project',  '새 프로젝트 등록',      '사내 교육 프로그램 프로젝트가 등록되었습니다.',                               NULL, 5,    NULL,                  '2026-09-21 09:00+09'),
  ( 9, 'alloc',    '새 프로젝트 배분',      '2026년 전국 초중고 AI 디지털교과서 연계 학습데이터 분석 및 맞춤형 학습경로 추천 시스템 구축 사업에서 600,000,000원을 배분받았습니다.', 7, 8, NULL, '2026-02-03 10:00+09'),
  (10, 'deadline', '체크리스트 기한 지남',  '가을 신제품 런칭 캠페인 — 홍보물 인쇄 예정일(9/20)이 지났습니다.',           9,    4,    'deadline:8:2026-09',  '2026-09-21 09:00+09'),
  (11, 'deadline', '체크리스트 오늘 마감',  '가을 신제품 런칭 캠페인 — 기자 간담회 식비 예정일이 오늘입니다.',            9,    4,    'deadline:9:2026-09',  '2026-09-28 08:00+09'),
  (12, 'admin',    '팀 계정 생성',          '관리자가 운영지원팀 계정을 만들었습니다. 관리자에게 받은 임시 비밀번호로 로그인하면 새 비밀번호로 변경한 뒤 시작합니다.', 6, NULL, NULL, '2026-09-26 15:00+09'),
  (13, 'setting',  '업무비 예산 변경 예정', '10월부터 팀 업무비 월 예산이 700,000원으로 바뀝니다.',                        1,    NULL, NULL,                  '2026-09-27 11:00+09'),
  (14, 'project',  '프로젝트 비활성',       '팝업스토어 기획(보류) 프로젝트가 9월부터 비활성으로 바뀌었습니다.',            9,    10,   NULL,                  '2026-09-01 09:00+09'),
  (15, 'exec',     '집행 등록 완료',        '팀 업무비 디자인 폰트 라이선스 외 4건, 합계 367,500원이 정상 등록되었습니다. 이번 달 팀 업무비 사용액이 466,500원으로 월 예산 300,000원을 넘었습니다.', 2, NULL, NULL, '2026-09-18 17:20+09'),
  (16, 'system',   '정기 점검 안내',        '10월 3일(토) 02:00~04:00 서비스 점검으로 접속이 잠시 제한됩니다.',             NULL, NULL, NULL,                  '2026-09-28 10:00+09')
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type, title = EXCLUDED.title, body = EXCLUDED.body, target_team_id = EXCLUDED.target_team_id,
  project_id = EXCLUDED.project_id, dedupe_key = EXCLUDED.dedupe_key, created_at = EXCLUDED.created_at;

INSERT INTO notification_reads (notification_id, team_id, read_at) VALUES
  (1, 9, '2026-01-08 09:30+09'),
  (8, 1, '2026-09-21 09:20+09'),
  (8, 2, '2026-09-22 10:00+09'),
  (9, 7, '2026-02-03 11:00+09'),
  (14, 9, '2026-09-01 09:30+09')
ON CONFLICT (notification_id, team_id) DO UPDATE SET read_at = EXCLUDED.read_at;

INSERT INTO notification_prefs (team_id, push_enabled, push_exec, push_setting, push_alloc, push_deadline) VALUES
  (9, true, true,  true,  true,  true),
  (7, true, false, false, false, false)   -- 푸시는 켰지만 종류별로 모두 끔 (운영지원팀은 설정 없음 → 기본값)
ON CONFLICT (team_id) DO UPDATE SET
  push_enabled = EXCLUDED.push_enabled, push_exec = EXCLUDED.push_exec, push_setting = EXCLUDED.push_setting,
  push_alloc = EXCLUDED.push_alloc, push_deadline = EXCLUDED.push_deadline;

INSERT INTO legacy_yearly_totals (team_id, year, meeting_used, project_used) VALUES
  (9, 2025, 980000, 4200000)
ON CONFLICT (team_id, year) DO UPDATE SET meeting_used = EXCLUDED.meeting_used, project_used = EXCLUDED.project_used;

-- ---------------------------------------------------------------------
-- 10. 자동 번호를 고정 id 뒤로 (앱·Edge Function 이 새로 만드는 행과 겹치지 않게)
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
