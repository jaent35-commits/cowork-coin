"""POST /api/receipt/ocr — 영수증 이미지(multipart file) → 날짜·금액 JSON.

운영 환경에서는 원본 이미지·OCR 전체 텍스트를 저장하거나 로그에 남기지 않는다(처리 시간·성공 여부만).
개발 환경(APP_ENV=development)에서는 추출 필드·점수만 로그로 확인할 수 있다.

추론은 한 번에 하나씩 들어온 순서대로(ocr_queue). 기다리는 동안 연결이 끊겼거나(화면 이탈로 프론트가 요청 취소)
너무 오래 기다린 요청은 추론을 시작하지 않고 뺀다 — 결과를 쓰지 않을 요청 때문에 다음 사람이 기다리지 않게.
대기열이 가득 차면(OCR_QUEUE_MAX) 기다리게 하지 않고 곧바로 503. 이미 시작한 추론은 끝까지 실행한다(강제 중단하지 않음).
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from ocr.image_preprocess import prepare_variants
from ocr.ocr_queue import OcrQueue, Skipped
from ocr.paddle_ocr import PaddleEngine, get_engine
from ocr.result_normalizer import group_rows
from parsers.receipt_parser import ParsedReceipt, parse_receipt

router = APIRouter()
log = logging.getLogger("receipt_ocr")

MAX_BYTES = 15 * 1024 * 1024
IS_DEV = os.getenv("APP_ENV", "production") == "development"
# 원본에 가까운 이미지 + 가볍게 보정한 이미지를 모두 OCR 해서 더 나은 쪽 사용 (느려서 기본 꺼짐)
DUAL_PASS = os.getenv("OCR_DUAL_PASS", "0") == "1"
# 서버 도착 후 이 시간 안에 추론을 시작하지 못하면 추론하지 않음.
# 프론트(src/lib/receiptPipeline.ts)는 요청 후 30초에 포기 → 30초 − 긴 영수증 추론(약 7.5초) − 업로드·응답 여유(약 2.5초) = 20초
QUEUE_TIMEOUT_S = float(os.getenv("OCR_QUEUE_TIMEOUT", "20"))
# 추론 중인 1건 외에 기다릴 수 있는 요청 수 — 넘치면 곧바로 503 (프론트는 Tesseract 결과 사용)
# 기준(인식 oneDNN 적용 후, 12장 측정): 일반 영수증 추론 약 5초, 긴 영수증 약 7.5초
#   대기 k번째 시작 ≈ 진행 중 잔여(최대 7.5초) + (k−1)×5초 → k=3 이면 17.5초 < QUEUE_TIMEOUT 20초, k=4 는 22.5초로 어차피 시간 초과
#   → floor((20 − 7.5) / 5) + 1 = 3. 서버가 느리거나 빠르면(운영 사양) 이 식으로 다시 계산해 OCR_QUEUE_MAX 로 조정
QUEUE_MAX = int(os.getenv("OCR_QUEUE_MAX", "3"))
# 개발 전용 인식 실패 분석: 받은 사진 · 인식한 줄 · 결과를 이 폴더에 저장 (APP_ENV=development 일 때만, 운영에서는 무시)
DEBUG_DIR = Path(os.environ["OCR_DEBUG_DIR"]) if IS_DEV and os.getenv("OCR_DEBUG_DIR") else None

ocr_queue = OcrQueue(QUEUE_MAX)


def _better(a: ParsedReceipt, b: ParsedReceipt) -> ParsedReceipt:
    """유효 필드 수 → 필드 confidence 평균 → 토큰 평균 신뢰도 순으로 비교."""
    key = lambda p: (p.valid_fields, sum(p.confidence.values()), p.mean_confidence)  # noqa: E731
    return a if key(a) >= key(b) else b


def _ocr(engine: PaddleEngine, variants: dict, debug: dict | None = None) -> ParsedReceipt:
    best: ParsedReceipt | None = None
    for name, img in variants.items():
        tokens = engine.read(img)
        parsed = parse_receipt(tokens)
        best = parsed if best is None else _better(best, parsed)
        if IS_DEV:
            log.info("variant=%s date=%s amount=%s conf=%s", name, parsed.date, parsed.amount, parsed.confidence)
        if debug is not None:
            debug[name] = {
                "size": [int(img.shape[1]), int(img.shape[0])],
                "rows": [" | ".join(f"{t.text}({t.confidence:.2f})" for t in r.tokens) for r in group_rows(tokens)],
                "date": parsed.date, "amount": parsed.amount, "merchant": parsed.merchant, "candidates": parsed.candidates,
            }
    assert best is not None
    if best.date is None:
        _retry_date(engine, best, next(iter(variants.values())), debug)
    return best


def _retry_date(engine: PaddleEngine, best: ParsedReceipt, img, debug: dict | None) -> None:
    """날짜를 못 찾았을 때만 — 글자 영역을 위·아래로 나눠 다시 읽음.

    줄 간격이 좁은 감열지(배달 주문서 등)는 전체 사진에서 날짜 줄이 윗줄과 한 덩어리로 묶이거나 검출에서 빠짐.
    절반씩 잘라 읽으면 검출기가 글자를 약 2배 크게 보게 되어 날짜 줄이 따로 잡힘 (+2~4초, 날짜 실패 때만).
    """
    h = img.shape[0]
    for name, (a, b) in (("top", (0.0, 0.55)), ("bottom", (0.45, 1.0))):
        part = img[int(h * a):int(h * b)]
        tokens = engine.read(part)
        parsed = parse_receipt(tokens)
        if debug is not None:
            debug[f"retry-{name}"] = {"rows": [r.text for r in group_rows(tokens)], "date": parsed.date}
        if parsed.date:
            best.date = parsed.date
            best.confidence = {**best.confidence, "date": parsed.confidence["date"]}
            best.candidates = {**best.candidates, "date": parsed.candidates["date"]}
            return


def _save_debug(raw: bytes, content_type: str | None, debug: dict) -> None:
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)  # type: ignore[union-attr]
        stem = time.strftime("%Y%m%d-%H%M%S")
        ext = ".png" if content_type == "image/png" else ".jpg"
        (DEBUG_DIR / f"{stem}{ext}").write_bytes(raw)  # type: ignore[operator]
        (DEBUG_DIR / f"{stem}.json").write_text(json.dumps(debug, ensure_ascii=False, indent=1), encoding="utf-8")  # type: ignore[operator]
    except Exception:
        log.exception("debug save failed")


@router.post("/api/receipt/ocr")
async def receipt_ocr(request: Request, file: UploadFile = File(...)):
    started = time.perf_counter()
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="이미지 파일만 올릴 수 있어요")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="이미지가 너무 커요 (15MB 이하)")
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")

    raw = data if DEBUG_DIR else None
    try:
        variants = await run_in_threadpool(prepare_variants, data, DUAL_PASS)
    except Exception:  # 손상·미지원 이미지
        raise HTTPException(status_code=400, detail="이미지를 열 수 없어요")
    finally:
        del data  # 원본 바이트는 요청이 끝나면 버림 (저장하지 않음 — 개발 분석 폴더를 켠 경우만 예외)

    async def skip_reason() -> str | None:
        if await request.is_disconnected():
            return "disconnected"
        if time.perf_counter() - started > QUEUE_TIMEOUT_S:
            return "timeout"
        return None

    try:
        await ocr_queue.acquire(skip_reason)
    except Skipped as e:
        return _skipped(e.reason, started)
    try:
        # 추론 직전 한 번 더 — 차례를 받는 사이 끊겼거나 시간이 지났으면 시작하지 않음
        reason = await skip_reason()
        if reason:
            return _skipped(reason, started)
        waited = round((time.perf_counter() - started) * 1000)
        debug: dict | None = {} if raw else None
        best = await run_in_threadpool(_ocr, get_engine(), variants, debug)
    finally:
        ocr_queue.release()
    if raw and debug is not None:
        debug["result"] = {"date": best.date, "amount": best.amount, "merchant": best.merchant, "confidence": best.confidence}
        await run_in_threadpool(_save_debug, raw, file.content_type, debug)

    ms = round((time.perf_counter() - started) * 1000)
    log.info("receipt ocr done in %dms (wait=%dms, fields=%d, review=%s)", ms, waited, best.valid_fields, best.needs_review)
    return JSONResponse({
        "success": best.valid_fields > 0,
        "receipt": {"date": best.date, "amount": best.amount, "merchant": best.merchant},
        "confidence": best.confidence,
        "engine": "paddleocr",
        "needsReview": best.needs_review,
        # 프론트가 Tesseract 결과와 필드 단위로 비교할 때 쓰는 후보 점수 (텍스트 원문은 포함하지 않음)
        "candidates": best.candidates,
        "elapsedMs": ms,
    })


def _skipped(reason: str, started: float) -> Response:
    waited = round((time.perf_counter() - started) * 1000)
    log.info("receipt ocr skipped before inference (%s, waited %dms)", reason, waited)
    if reason == "disconnected":
        return Response(status_code=499)  # 클라이언트가 이미 떠남 — 받을 사람 없음
    # timeout(대기 초과) · full(대기열 가득) · shutdown(서버 종료 중) — 프론트는 실패 응답이면 기존처럼 Tesseract 결과만 사용
    detail = {"timeout": "OCR 대기 시간이 길어요", "full": "OCR 요청이 많아요", "shutdown": "OCR 서버를 다시 시작하는 중이에요"}[reason]
    return JSONResponse({"success": False, "reason": reason, "detail": detail}, status_code=503, headers={"Retry-After": "5"})
