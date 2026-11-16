# 영수증 인식 — Google Cloud Vision 연동

영수증 사진은 **Supabase Edge Function `ocr-receipt`** 가 Google Cloud Vision 으로 읽습니다 (별도 서버 없음).
API 키는 함수 비밀값에만 두고, 앱 · 저장소에는 넣지 않습니다.

```
앱(집행 등록 · 영수증 찍기) → ocr-receipt (로그인 확인 · 월 한도 확인) → Google Cloud Vision → 글자 → 앱이 날짜 · 상호명 · 합계 추출
```

- **월 한도**: 한 달(한국 시간 1일 ~ 말일) 동안 서비스 전체에서 서버로 읽을 수 있는 횟수
  - 관리자가 **관리자 > 영수증 인식** 에서 0 ~ 1,000건으로 정합니다 (기본 1,000)
  - Vision 무료 사용량이 월 1,000건이라 1,000건까지만 정할 수 있습니다
  - 0 이면 서버 인식을 쓰지 않습니다
- **한도를 다 쓰면** 그 달 남은 기간은 휴대폰 안 인식(지금 방식 · Tesseract)으로 읽습니다
- Vision 호출이 실패하면 그 건은 한도에서 빠지지 않습니다
- 사용 기록에는 **누가 · 언제** 만 남깁니다. 사진과 인식한 글자는 저장하지 않습니다

## 처음 설정 (한 번)

### 1. Google Cloud — Vision API 키 만들기
1. [Google Cloud 콘솔](https://console.cloud.google.com/) 에서 프로젝트를 만들거나 고릅니다
2. **결제(Billing) 계정 연결** — 무료 사용량 안에서도 Vision API 는 결제 계정이 있어야 켜집니다
3. **API 및 서비스 → 라이브러리 → Cloud Vision API → 사용**
   - 한국어 화면에서는 **“클라우드 비전 API”**(Cloud Vision API)를 고릅니다. 상세 화면의 서비스 이름이 `vision.googleapis.com` 인지 확인
   - 검색에 함께 나오는 **“비전 AI API”(Vertex AI Vision, `visionai.googleapis.com`) · “클라우드 문서 AI API”(Document AI) 는 다른 서비스**라 켜지 않습니다
4. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**
5. 만든 키의 **키 제한사항 → API 제한사항 → 키 제한 → Cloud Vision API 만** 선택하고 저장
   - 애플리케이션 제한사항(HTTP 리퍼러)은 두지 않습니다 — 브라우저가 아니라 Supabase 서버가 부릅니다
6. (권장) **결제 → 예산 및 알림** 에서 작은 금액 예산 알림을 걸어 둡니다

### 2. Supabase SQL Editor
[`db/migrations/20261117_receipt_ocr_quota.sql`](../db/migrations/20261117_receipt_ocr_quota.sql) 실행 — 월 한도(기본 1,000) · 사용 기록 표 · 함수

### 3. 함수 비밀값 · 배포 (프로젝트 폴더에서)
API 키는 채팅 · 문서 · 저장소에 붙여 넣지 말고, 대시보드 **Edge Functions → Secrets** 에서 `GOOGLE_VISION_API_KEY` 로 넣거나 터미널에서 직접 입력합니다.
```
npx supabase secrets set GOOGLE_VISION_API_KEY=발급받은키 --project-ref yqaioqxkqcwejwqqwatl
npx supabase functions deploy ocr-receipt --project-ref yqaioqxkqcwejwqqwatl
```
(PowerShell 에서 `npx` 가 막히면 `npx.cmd` 로 실행)

### 4. 앱 배포 (main 푸시)

순서가 바뀌어도 앱은 멈추지 않습니다 — 함수나 키가 아직 없으면 지금처럼 휴대폰에서 읽습니다.
관리자 > 영수증 인식 화면은 2단계 SQL 을 실행해야 열립니다.

## 확인
- 관리자 > 영수증 인식: 이번 달 사용량 `0 / 1,000건`
- 모바일 집행 등록 → 영수증 찍기: 안내 문구가 “서버에서 읽는 중” 으로 나오고, 날짜 · 금액이 채워지면 사용량이 1 늘어남
- 사용량이 늘지 않고 “휴대폰에서 읽는 중” 으로 넘어가면: Edge Functions → `ocr-receipt` → Logs 에서 `vision error` 상태 코드 확인
  (`PERMISSION_DENIED` = API 사용 안 함 · 키 제한 확인, `RESOURCE_EXHAUSTED` = Google 쪽 한도)
