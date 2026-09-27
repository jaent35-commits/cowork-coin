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
