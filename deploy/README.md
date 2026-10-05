# Windows 배포 준비

`Caddyfile.example`은 `cw-coin.duckdns.org`에서 정적 웹사이트를 HTTPS로 제공하고 `/api/*` 요청을 로컬 OCR 서버(`127.0.0.1:8000`)로 보냅니다. Caddy의 자동 HTTPS를 사용합니다.

배포 PC에서 확인할 항목:

1. DuckDNS의 A 레코드가 그 PC의 공인 IP를 가리키는지 확인합니다.
2. 공유기에서 TCP 80·443을 배포 PC로 포워딩하고 Windows 방화벽에서 허용합니다.
3. Supabase 인증·공유 데이터 연결을 완료한 소스로 `VITE_SITE_URL=https://cw-coin.duckdns.org`를 지정해 빌드합니다.
4. OCR 서버는 `backend`에서 단일 worker로 실행하고 `127.0.0.1:8000`에만 바인딩합니다.
5. `COWORK_SITE_ROOT`를 빌드 결과 `dist`의 절대 경로로 설정한 뒤 Caddy 설정을 검증하고 서비스로 실행합니다.
6. 외부 네트워크에서 HTTPS 페이지와 `/api/health`를 확인합니다.

현재 공개 전 조건은 Supabase 연결과 배포 PC 접근입니다. 이 파일만으로 배포를 시작하지 마세요.

# GitHub Pages 배포 (앱 화면만)

`.github/workflows/deploy-pages.yml` — `main` 에 푸시하면 앱 화면(`dist`)을 빌드해 GitHub Pages 에 올립니다. 로그인·데이터는 Supabase 를 그대로 씁니다.

- **OCR 서버는 Pages 에 올릴 수 없습니다.** `VITE_OCR_API_URL` 이 비어 있으면 영수증은 브라우저 OCR(Tesseract)만으로 읽습니다. PaddleOCR 을 함께 쓰려면 OCR 서버를 다른 주소(예: `https://cw-coin-ocr.duckdns.org`)에 띄우고, 저장소 변수 `VITE_OCR_API_URL` 과 OCR 서버의 `OCR_CORS_ORIGINS=https://cw-coin.duckdns.org` 를 지정합니다.
- 화면 이동은 `#/home` 같은 해시 주소라 Pages 에서 새로고침해도 404 가 나지 않습니다.

## 한 번만 하는 설정
1. 저장소 **Settings → Secrets and variables → Actions → Variables** 에 추가
   - `VITE_SITE_URL` = `https://cw-coin.duckdns.org`
   - `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` = `.env.local` 과 같은 값 (publishable 키 — service_role 키는 넣지 않음)
   - 셋 중 하나라도 없으면 배포가 멈춥니다 (Supabase 값 없이 빌드되면 팀 데이터가 공유되지 않는 '브라우저 저장본 로그인' 앱이 됨)
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. DNS — 도메인이 GitHub Pages 를 가리키게
   - DuckDNS(`cw-coin.duckdns.org`): A 레코드만 지원 → duckdns.org 에서 `current ip` 를 `185.199.108.153` 으로 바꾸고 **update ip**. 배포 PC 의 DuckDNS 자동 갱신(공인 IP 로 되돌림)이 켜져 있으면 끕니다
   - 직접 산 도메인의 하위 도메인: CNAME `jaent35-commits.github.io`
4. **Settings → Pages → Custom domain** 에 `cw-coin.duckdns.org` 입력 → **Save** → DNS 확인이 끝나면 **Enforce HTTPS** 체크 (인증서 발급까지 수 분~최대 24시간)
5. **Actions** 탭에서 `Deploy to GitHub Pages` 실행 결과 확인 → `https://cw-coin.duckdns.org` 접속 → 모바일 크롬에서 앱 설치 확인

# GitHub Pages + OCR 서버

앱 화면(Pages)과 OCR 서버를 다른 주소로 둡니다. Pages 가 HTTPS 라서 OCR 서버도 반드시 HTTPS 여야 합니다 (http 주소는 브라우저가 막음).

1. DuckDNS 에 하위 도메인을 하나 더 만들고(예: `cw-coin-ocr`) OCR 서버를 돌릴 PC 의 공인 IP 를 넣습니다. 공유기 TCP 80·443 → 그 PC 포워딩, 방화벽 허용 (8000 은 열지 않음)
2. OCR 서버 실행 (backend/README.md "운영 실행") — 다른 주소의 앱이 부를 수 있게 허용 출처를 지정
   ```powershell
   $env:PADDLE_PDX_CACHE_HOME = "C:\Users\Public\paddlex"; $env:OCR_CORS_ORIGINS = "https://cw-coin.duckdns.org"; .venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --timeout-graceful-shutdown 30
   ```
3. `Caddyfile.ocr.example` → `Caddyfile` 로 복사 후 `caddy run --config Caddyfile` (HTTPS 인증서 자동 발급)
4. `https://cw-coin-ocr.duckdns.org/api/health` 가 열리는지 확인
5. 저장소 변수 `VITE_OCR_API_URL` = `https://cw-coin-ocr.duckdns.org` 추가 → Actions 에서 배포 다시 실행
6. 앱에서 영수증 사진 인식 — OCR 서버가 꺼져 있거나 응답이 늦으면 앱은 자동으로 브라우저 OCR 만 사용
