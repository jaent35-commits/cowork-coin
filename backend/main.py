"""코웍-코인 영수증 OCR 백엔드 (FastAPI + PaddleOCR).

운영 실행 (backend 폴더에서, README "운영 실행" 참고):
    uvicorn main:app \\
      --host 0.0.0.0 \\
      --port 8000 \\
      --workers 1 \\
      --timeout-graceful-shutdown 30
    - OCR queue 와 PaddleOCR engine 은 단일 프로세스 실행을 전제로 설계됨 → --workers 1 명시
    - 운영에서 --reload 사용 금지
    - WEB_CONCURRENCY 설정 금지 (설정돼 있으면 --workers 없이도 여러 프로세스가 생성될 수 있음)
환경 변수:
    APP_ENV=development   개발 로그(추출 필드·점수) — 운영은 production(기본)
    OCR_DUAL_PASS=1       원본·보정 이미지 두 번 OCR 후 더 나은 쪽 사용
    OCR_CORS_ORIGINS      쉼표로 구분한 허용 출처 (프론트를 다른 도메인에서 부를 때)
    PADDLE_REC_ONEDNN     인식 모델만 oneDNN (기본 true, false 면 기존 방식) — ocr/paddle_ocr.py
    OCR_QUEUE_MAX         추론 중 1건 외 대기 가능 수 (기본 3, 넘치면 503) — api/receipt_ocr.py
    OCR_QUEUE_TIMEOUT     도착 후 이 초 안에 추론을 시작 못 하면 추론 안 함 (기본 20, 프론트 제한 30초 기준)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.receipt_ocr import ocr_queue, router as receipt_router
from ocr.paddle_ocr import get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _close_queue_on_signal() -> None:
    """종료 신호를 받는 즉시 대기열을 닫는다 (대기 요청은 추론 없이 503).
    uvicorn 은 진행 중인 요청이 모두 끝난 뒤에야 lifespan 종료를 부르므로, 그대로 두면 종료 중에도 대기 요청의 추론이 새로 시작된다.
    uvicorn 이 설치한 신호 처리기 앞에 끼워 넣고 원래 처리기(uvicorn 의 정상 종료)는 그대로 호출한다."""
    import asyncio
    import signal

    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        prev = signal.getsignal(sig)
        if not callable(prev):
            continue

        def handler(signum, frame, prev=prev):
            loop.call_soon_threadsafe(ocr_queue.close)
            prev(signum, frame)
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):  # 메인 스레드가 아닌 실행 환경 → lifespan 종료 시 정리만
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    # OCR 모델은 서버 시작 시 한 번만 로드 → 이후 요청은 같은 인스턴스 재사용
    get_engine()
    _close_queue_on_signal()
    yield
    # 종료: 새 요청·대기 요청은 추론 없이 503 → 진행 중인 추론이 끝나길 기다림 → 엔진 정리
    ocr_queue.close()
    await ocr_queue.wait_idle()
    get_engine().close()
    logging.getLogger("receipt_ocr").info("ocr engine closed")


app = FastAPI(title="cowork-coin receipt OCR", lifespan=lifespan)

origins = [o.strip() for o in os.getenv("OCR_CORS_ORIGINS", "").split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST"], allow_headers=["*"])

app.include_router(receipt_router)


@app.get("/api/health")
def health():
    return {"ok": True, "engine": get_engine().info(), "queue": {"waiting": ocr_queue.waiting, "running": ocr_queue.running}}
