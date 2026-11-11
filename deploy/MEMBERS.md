# v3.0 — 조직 + 사용자(사번 로그인) 전환 순서

팀 계정(1팀 1계정)을 **조직(본부 > 부서 > 파트) + 사용자(1인 1계정, 사번 로그인)** 로 바꿉니다.
DB 를 바꾸는 순간 지금 배포된 앱의 로그인이 멈추므로, 아래를 **한 번에 이어서** 진행합니다.

## 권한
| 사용자 | 조직 | 사용자 |
|---|---|---|
| 관리자 | 모든 조직 | 모든 사용자 · 관리자 지정 |
| 부서장 이상 (소속이 본부 · 부서) | 본부 · 부서는 고정, 내 조직 아래 **파트만** 추가 · 수정 · 삭제 | 내 조직 · 하위 조직 사용자 등록 · 초기화 · 수정 · 삭제 (관리자 계정 제외) |
| 파트 소속 | — | — |

데이터(예산 · 집행 · 프로젝트 · 체크리스트)는 조직 단위로 함께 쓰고, 상위 조직장은 하위 조직을 조회할 수 있습니다.

## 초기 비밀번호
- 계정을 만들거나 초기화하면 서버가 초기 비밀번호를 만들어 **본인 슬랙 DM** 으로 보냅니다 (앱 알림함 · 로그에는 남기지 않음)
  - 회원가입: “아이디는 사번(…)이고, 초기 비밀번호는 … 입니다”
  - 초기화: “비밀번호가 초기화되었습니다. 초기 비밀번호 : …”
- DM 을 못 보낸 사람(이메일 없음 · 슬랙 계정 못 찾음)만 등록 화면에 초기 비밀번호를 한 번 보여 줍니다
- 첫 로그인 때 새 비밀번호(8자 이상)로 바꿔야 시작할 수 있습니다

## 전환 순서
1. **슬랙 앱 · 비밀값** — [SLACK.md](SLACK.md) 1단계(앱 만들기)까지
2. **Supabase CLI 로그인** (처음 한 번 — 브라우저에서 승인)
   ```
   npx supabase login
   ```
3. **SQL Editor** 에서 순서대로 실행
   1. [`db/migrations/20261111_reset_for_members.sql`](../db/migrations/20261111_reset_for_members.sql) — 테스트 데이터 삭제 (**되돌릴 수 없음**)
   2. [`db/migrations/20261111b_org_members.sql`](../db/migrations/20261111b_org_members.sql) — 조직 + 사용자 구조
4. **Edge Function 배포 · 옛 함수 삭제** (프로젝트 폴더에서)
   ```
   npx supabase functions deploy --project-ref yqaioqxkqcwejwqqwatl
   npx supabase functions delete admin-create-team --project-ref yqaioqxkqcwejwqqwatl
   npx supabase functions delete admin-delete-team --project-ref yqaioqxkqcwejwqqwatl
   npx supabase functions delete admin-reset-password --project-ref yqaioqxkqcwejwqqwatl
   npx supabase functions delete bootstrap-admin --project-ref yqaioqxkqcwejwqqwatl
   ```
   (`notify-slack` 을 대시보드에서 먼저 만들었다면 같은 이름으로 덮어써짐)
5. **Edge Function Secrets** — `SLACK_BOT_TOKEN` · `SLACK_WEBHOOK_SECRET` · `APP_URL` ([SLACK.md](SLACK.md) 3단계)
6. **Database Webhook** — `notifications` INSERT → `notify-slack` ([SLACK.md](SLACK.md) 4단계)
7. **앱 배포** — main 에 푸시하면 GitHub Pages 자동 배포
8. **첫 사용자 등록** — 사이트 접속 → “처음 시작하기” 에서 사용자 엑셀 올리기 → 각자 슬랙 DM 으로 초기 비밀번호 수신
9. **운영 전** — 각자 실제 이메일로 바꾼 뒤 [`20261111c_members_email_unique.sql`](../db/migrations/20261111c_members_email_unique.sql) 실행 (이메일 중복 금지)

## 사용자 엑셀 형식 (첫 시트)
| 본부 | 부서 | 파트 | 사원번호 | 성명 | 직위 | 이메일 | 관리자 여부 |
|---|---|---|---|---|---|---|---|
| 디지털본부 | | | 1000001 | … | 본부장 | … | |
| 디지털본부 | 플랫폼부 | 개발파트 | 1000003 | … | 책임 | … | 관리자 |

- 소속 = 본부 · 부서 · 파트 중 **가장 아래 칸** (본부장은 본부만, 부서장은 본부 · 부서까지)
- 관리자 여부: `관리자` · `Y` 면 관리자. 처음 등록할 때는 관리자가 1명 이상 있어야 합니다
- 이메일은 슬랙 로그인 이메일과 같아야 DM 이 갑니다
- 비밀번호 열은 넣지 않습니다

## 첫 설치 주의
사용자가 0명일 때는 누구나 “처음 시작하기” 로 첫 사용자를 등록할 수 있습니다 (그 사람들이 관리자가 됨).
3단계 SQL 을 실행한 뒤 **8단계까지 곧바로** 진행하세요.
