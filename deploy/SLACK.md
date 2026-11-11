# 슬랙 개인 DM

코웍-코인은 슬랙 봇으로 사용자 각자에게 DM 을 보냅니다. 받는 사람은 **사용자 계정의 회사 이메일**(슬랙 로그인 이메일)로 찾습니다.

| DM | 언제 | 누구에게 |
|---|---|---|
| 회원가입 안내 (아이디 = 사번, 초기 비밀번호) | 사용자 등록 | 등록된 본인 |
| 비밀번호 초기화 안내 (초기 비밀번호) | 관리자 · 부서장 이상이 초기화 | 본인 |
| 비밀번호 변경 확인 | 본인이 변경 | 본인 |
| 앱 알림 (새 배분 · 기한 임박 · 예산 경고 등) | 알림이 생길 때 | 받는 조직의 활성 사용자 중 슬랙 DM · 그 종류가 켜진 사람 |

- 사람마다 앱 **알림 → 알림 설정** 에서 슬랙 DM · 종류별 알림을 켜고 끕니다 (기본: 슬랙 켜짐, 종류 모두 켜짐)
- 초기 비밀번호 DM 은 앱 알림함 · 로그를 거치지 않고 계정을 만든 서버 기능이 바로 보냅니다
- 슬랙 봇 토큰은 Edge Function 비밀값으로만 둡니다 (앱 · 저장소에 넣지 않음)

## 1. 슬랙 앱 만들기 (슬랙 워크스페이스 관리자 승인 필요)
1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → 회사 워크스페이스
2. [`slack-app-manifest.yml`](slack-app-manifest.yml) 붙여 넣기 → **Create**
3. **Install App** → 설치 (관리자 승인 요청이 가면 승인 후 설치)
4. **OAuth & Permissions** → **Bot User OAuth Token**(`xoxb-…`) — 3단계 비밀값으로만 넣음
5. **Basic Information** → **Display Information** → App icon 에 [`slack-app-icon.png`](slack-app-icon.png) (512×512) 올리기

## 2. DB · 함수 배포
[MEMBERS.md](MEMBERS.md) 전환 순서의 SQL · `npx supabase functions deploy` 로 함께 배포됩니다.

## 3. Edge Function Secrets
**Supabase 대시보드 → Edge Functions → Secrets**
| 이름 | 값 |
|---|---|
| `SLACK_BOT_TOKEN` | 1-4 의 `xoxb-…` |
| `SLACK_WEBHOOK_SECRET` | 임의의 긴 문자열 — 4단계 헤더에도 같은 값 |
| `APP_URL` | `https://cw-coin.duckdns.org` |

## 4. Database Webhook (앱 알림 → DM)
**Supabase 대시보드 → Database → Webhooks** (처음이면 **Enable webhooks**) → **Create a new hook**
- Table `public.notifications` · Events **Insert** 만
- Type **Supabase Edge Functions** → `notify-slack` · `POST` · Timeout **5000ms**
- HTTP Headers: `x-webhook-secret` = 3단계 `SLACK_WEBHOOK_SECRET`

## 5. 확인
- 앱 **알림 → 알림 설정 → 테스트 DM 보내기** → 슬랙 **코웍-코인** 앱 메시지 탭에 “슬랙 DM 연결 확인”
- 실패하면 사용자 관리 화면에 이유가 보입니다

| 이유 | 할 일 |
|---|---|
| 회사 이메일이 없습니다 | 사용자 정보에 이메일 입력 |
| 슬랙에서 이 이메일의 계정을 찾지 못했어요 | 슬랙 프로필 이메일과 같은지 확인 |
| 슬랙 발송 실패 (not_authed · invalid_auth) | 봇 토큰 비밀값 확인 |
| 슬랙 발송 실패 (missing_scope) | 매니페스트 권한으로 앱 다시 설치 |

## 알아 두기
- 기한 임박 알림은 지금은 주관 조직 사용자가 앱에 로그인할 때 만들어집니다 (매일 정해진 시각에 서버가 만드는 예약 작업은 다음 단계)
- 발송 기록: **Edge Functions → notify-slack → Logs** (메시지 내용 · 이메일 · 비밀번호는 남기지 않음)
