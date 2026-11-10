# 슬랙 개인 DM 알림 설정

앱 알림(새 프로젝트 배분 · 기한 임박 · 예산 경고 · 설정 변경)을 팀원 회사 슬랙 **개인 DM** 으로도 보냅니다. 앱을 닫아 두어도 받습니다.

```
앱에서 알림 생성 → notifications 표 저장
  → Database Webhook (INSERT) → Edge Function notify-slack
  → 받는 팀의 슬랙 DM 켜짐 · 종류별 on/off 확인 → 팀이 등록한 사람(회사 이메일)에게 DM
```

- 받는 사람은 팀이 앱 **알림 → 알림 설정 → 슬랙 DM 알림** 에서 회사 이메일로 등록합니다 (팀당 20명까지). 서버가 처음 보낼 때 이메일로 슬랙 계정을 찾아 저장합니다.
- 종류별 on/off 는 푸시와 같은 스위치를 씁니다. 예산 경고는 늘 보냅니다.
- 슬랙 봇 토큰은 Edge Function 비밀값으로만 둡니다 (앱 · 저장소에 넣지 않음).

## 1. 슬랙 앱 만들기 (슬랙 워크스페이스 관리자 승인 필요)
1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → 회사 워크스페이스 선택
2. [`slack-app-manifest.yml`](slack-app-manifest.yml) 내용을 붙여 넣기 → **Create**
3. **Install to Workspace** → (관리자 승인 요청이 가면 승인 후) 설치
4. **OAuth & Permissions** → **Bot User OAuth Token**(`xoxb-…`) 복사 — 다음 단계에서 비밀값으로 넣고, 다른 곳에 저장하지 않습니다

## 2. DB 변경 (Supabase SQL Editor)
[`db/migrations/20261110_slack_dm.sql`](../db/migrations/20261110_slack_dm.sql) 전체를 실행합니다.

## 3. Edge Function 배포
**Supabase 대시보드 → Edge Functions → Deploy a new function → Via Editor**
- 이름: `notify-slack`
- 코드: [`supabase/functions/notify-slack/index.ts`](../supabase/functions/notify-slack/index.ts) 내용을 그대로 붙여 넣기 (다른 파일을 가져오지 않음)
- 함수 설정에서 **Verify JWT 끄기** (웹훅 호출은 비밀 헤더로, 앱 호출은 함수 안에서 로그인 확인)

(CLI 를 쓰면: `supabase functions deploy notify-slack --no-verify-jwt`)

**Edge Functions → Secrets** 에 추가
| 이름 | 값 |
|---|---|
| `SLACK_BOT_TOKEN` | 1-4 에서 복사한 `xoxb-…` |
| `SLACK_WEBHOOK_SECRET` | 임의의 긴 문자열 (예: 비밀번호 생성기로 40자) — 4단계 헤더에도 같은 값 |
| `APP_URL` | `https://cw-coin.duckdns.org` |

## 4. Database Webhook
**Supabase 대시보드 → Database → Webhooks → Create a new hook**
- Table: `public.notifications` · Events: **Insert** 만
- Type: **Supabase Edge Functions** → `notify-slack` · Method `POST` · **Timeout 5000ms**
- HTTP Headers 에 `x-webhook-secret` = 3단계 `SLACK_WEBHOOK_SECRET` 과 같은 값

## 5. 확인
1. 앱 로그인 → **알림 → ⚙️ 알림 설정 → 슬랙 DM 알림** 켜기
2. 받는 사람에 본인 회사 이메일(슬랙 로그인 이메일) 추가 → **테스트 DM 보내기**
3. 슬랙 앱 **코웍-코인** 의 메시지 탭에 “슬랙 DM 연결 확인” DM 이 오면 완료 — 받는 사람 옆에 **연결됨** 표시
4. 실제 알림 확인: 다른 팀에 프로젝트 배분을 바꾸면 그 팀 받는 사람에게 “프로젝트 배분 변경” DM

| 화면 표시 | 뜻 / 할 일 |
|---|---|
| 발송 전 | 아직 보낸 적 없음 → 테스트 DM 보내기 |
| 연결됨 | 슬랙 계정을 찾아 DM 을 보냈음 |
| 슬랙에서 이 이메일의 계정을 찾지 못했어요 | 이메일 오타 또는 슬랙 프로필 이메일과 다름 → 빼고 다시 추가 |
| 슬랙 발송 실패 (…) | 괄호 안 슬랙 오류 — `not_authed`·`invalid_auth` 는 봇 토큰 확인, `missing_scope` 는 매니페스트 권한으로 다시 설치 |

## 알아 두기
- **기한 임박 알림**은 주관 팀이 앱에 로그인할 때 만들어집니다. 아무도 로그인하지 않으면 슬랙으로도 가지 않습니다 — 매일 정해진 시각에 서버가 만들게 하려면 예약 작업을 추가합니다 (다음 단계).
- 웹훅이 실패해도 알림은 앱 알림함에 그대로 남습니다. 발송 기록은 **Edge Functions → notify-slack → Logs** 에서 볼 수 있습니다 (메시지 내용 · 이메일은 남기지 않음).
