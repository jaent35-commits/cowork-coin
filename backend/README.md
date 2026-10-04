# 코웍-코인 영수증 OCR 백엔드

Primary OCR = PaddleOCR (이 서버) · Secondary 검증 = Tesseract.js v7 한국어 (브라우저, `src/lib/receiptOcr.ts`)
두 결과의 비교·최종 결정은 프론트 `src/lib/receiptPipeline.ts` 가 날짜·금액 필드 단위로 한다.

## 버전 (2026-09-26 설치 기준)
- Python 3.12.10 · paddlepaddle 3.3.1 (CPU) · paddleocr 3.7.0 (paddlex 3.7.2) · fastapi 0.141.1
- 모델: 검출 `PP-OCRv5_mobile_det` + 인식 `korean_PP-OCRv5_mobile_rec` (첫 실행 때 `~/.paddlex/official_models` 로 자동 다운로드)

## 설치 · 실행
```
cd backend
py -3.12 -m venv .venv          # 또는 설치한 python.exe 경로
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 30
```

### 운영 실행
```
uvicorn main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --timeout-graceful-shutdown 30
```
- **`--workers 1` 을 명시**한다. 이 서버는 단일 프로세스 실행을 기준으로 queue(`ocr/ocr_queue.py`)와 OCR engine(`ocr/paddle_ocr.py`)이 설계되어 있다.
  프로세스가 여러 개면 대기열 상한·대기 시간이 프로세스마다 따로 적용되고, 프로세스마다 모델을 따로 올려 메모리가 약 1GB 씩 늘며, 측정상 개별 요청도 느려진다
- **`--reload` 사용 금지** (개발용 파일 감시 · 재시작)
- **`WEB_CONCURRENCY` 환경변수 설정 금지**: 이 값이 설정되어 있으면 uvicorn 실행 명령에 `--workers` 를 명시하지 않아도 여러 프로세스가 생성될 수 있다. 일부 호스팅 환경은 자동으로 설정하므로 운영 환경에서 비어 있는지 확인한다
- **`--timeout-graceful-shutdown 30` 적용**. 프로세스 관리자(컨테이너·systemd 등)의 종료 대기 시간은 이보다 길게 둔다
- 종료(Ctrl+C·SIGTERM): 새 요청 차단 → 대기 중 요청은 추론 없이 503 → 진행 중 추론 완료 → 엔진 정리. `--timeout-graceful-shutdown` 은 그 상한

개발 중에는 Vite 가 `/api` 를 `http://127.0.0.1:8000` 으로 넘긴다(vite.config.ts). 운영은 같은 도메인 `/api` reverse proxy 를 쓰거나, 프론트 빌드 시 `VITE_OCR_API_URL` 에 OCR 서버 주소를 지정 (`.env.example` 참고).

## API
응답 코드: 200 결과 · 400/413/415 잘못된 파일 · 503 대기 초과(`timeout`)·대기열 가득(`full`)·종료 중(`shutdown`) · 499 대기 중 클라이언트가 끊음(받을 사람 없음)

`POST /api/receipt/ocr` (multipart/form-data, `file`) →
```json
{ "success": true, "receipt": { "date": "2026-09-24", "amount": 38500, "merchant": "…" },
  "confidence": { "date": 0.96, "amount": 0.98 }, "engine": "paddleocr", "needsReview": false,
  "candidates": { "date": [{ "value": "…", "score": 0.8 }], "amount": [{ "value": 38500, "score": 1.0, "reasons": ["keyword-row", "supply+vat"] }] } }
```
`candidates` 는 Tesseract 값과 다를 때 점수 비교용 (OCR 원문 텍스트는 응답·로그에 넣지 않음).

## 구조
| 파일 | 역할 |
|---|---|
| `ocr/paddle_ocr.py` | PaddleOCR singleton (서버 시작 시 1회 로드·예열, 스레드 잠금). 인식 모델만 oneDNN, 오류 시 기존 방식으로 1회 재생성 |
| `ocr/ocr_queue.py` | 추론 대기열 — 한 번에 하나씩 순서대로, 대기 중 연결 끊김·시간 초과 요청은 추론 전에 제거, 상한 초과 시 즉시 거절 |
| `ocr/image_preprocess.py` | EXIF 회전 → 긴 변 1600~2200 → 흑백 + 약한 CLAHE (강한 이진화 안 함), deskew 훅 |
| `ocr/result_normalizer.py` | PaddleOCR 결과 → 표준 토큰 `{text, confidence, bbox, centerX, centerY}`, 기울기 보정 줄 묶기 |
| `parsers/date_parser.py` · `amount_parser.py` · `receipt_parser.py` | 표준 토큰만 사용하는 날짜·금액·상호 후보 점수 |
| `api/receipt_ocr.py` · `main.py` | FastAPI 라우터 · 앱 |
| `tests/` | 합성 영수증 생성(`make_sample.py`), 엔진 확인(`smoke.py`), 설정별 속도(`bench.py`) |

## 환경 변수
| 이름 | 기본 | 설명 |
|---|---|---|
| `APP_ENV` | production | `development` 면 추출 필드·점수 로그 (원문·이미지는 어느 환경에서도 저장·로그 안 함) |
| `PADDLE_PDX_CACHE_HOME` | `~/.paddlex` | 모델 저장 위치. **Windows 사용자 폴더 이름에 한글이 있으면 반드시 영문 경로로 지정** (예: `C:\Users\Public\paddlex`) — Paddle 추론 엔진이 한글 경로의 모델 파일을 읽지 못해 서버 시작 시 `json.exception.parse_error.101 … empty input` 으로 실패함 |
| `OCR_DET_MODEL` | PP-OCRv5_mobile_det | `PP-OCRv5_server_det` 는 더 정확할 수 있으나 CPU 에서 수십 배 느림 |
| `OCR_DET_SIDE` | 1600 | 검출 입력 긴 변 상한 |
| `OCR_TEXTLINE_ORI` | 0 | 1 = 뒤집힌 글줄 방향 보정 (약 20% 느림) |
| `OCR_DUAL_PASS` | 0 | 1 = 원본·보정 이미지 모두 OCR 후 더 나은 쪽 |
| `PADDLE_REC_ONEDNN` | true | 인식 모델만 oneDNN (검출은 제외). 12장 × 3회 결과·원문 동일, 전체 약 −48%. `false` 면 기존 방식 |
| `OCR_ENABLE_MKLDNN` | 0 | 1 = 검출까지 전체 oneDNN (paddlepaddle 3.3.1 에서 검출 모델 추론 오류 → 끔) |
| `OCR_QUEUE_MAX` | 3 | 추론 중 1건 외 대기 가능 수. 넘치면 즉시 503 (프론트는 Tesseract 결과 사용). 기준 식은 `api/receipt_ocr.py` |
| `OCR_QUEUE_TIMEOUT` | 20 | 도착 후 이 초 안에 추론을 시작 못 하면 추론하지 않고 503 (프론트 제한 30초 − 긴 영수증 추론 − 여유) |
| `OCR_CORS_ORIGINS` | (없음) | 프론트를 다른 도메인에서 부를 때 허용 출처 |

## 개발 통계
브라우저 개발자 도구 콘솔에서 `receiptOcrStats()` — PaddleOCR·Tesseract 단독 성공률, 두 엔진 일치율·불일치율, needsReview 비율.
`receiptOcrStats.reset()` 으로 초기화. 개발 빌드에서만 동작하며 이미지·텍스트·금액 값은 저장하지 않음.
