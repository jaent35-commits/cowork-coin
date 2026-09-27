"""PaddleOCR 엔진 (서버 프로세스당 1개 — singleton).

설치 버전 paddleocr 3.7.0 (paddlex 3.7.2, paddlepaddle 3.3.1 CPU) 공식 API 기준:
- 한국어 모델: 검출 PP-OCRv5_mobile_det(OCR_DET_MODEL 로 변경) + 인식 korean_PP-OCRv5_mobile_rec
  (한국어 사전에 영문·숫자·기호 포함 → GS25 · CU · VAT · TOTAL · 카드사 영문명도 인식)
- ocr.predict(ndarray BGR) → list[OCRResult]; 결과 키 rec_texts · rec_scores · rec_polys · rec_boxes
모델 로딩은 수 초가 걸리므로 요청마다 만들지 않고 서버 시작 시 한 번 만든 뒤 재사용한다.

인식(Recognition) 모델만 oneDNN (PADDLE_REC_ONEDNN, 기본 true):
- 한 요청 시간의 약 72% 가 인식 추론 → oneDNN 으로 인식만 가속 (12장 × 3회 A/B: 결과·원문 토큰 동일, 전체 −48~61%)
- 검출 모델은 paddlepaddle 3.3.1 oneDNN 실행기에서 NotImplementedError(ConvertPirAttribute2RuntimeAttribute)
  → PaddleX 의 oneDNN 제외 목록(MKLDNN_BLOCKLIST)에 검출 모델을 넣어 기존 방식으로 실행
  (PaddleX 내부 목록에 의존 → requirements.txt 에 paddlepaddle·paddleocr·paddlex 버전 고정)
- 시작 시 예열 추론으로 확인하고, 초기화·추론 중 오류가 나면 oneDNN 엔진을 버리고 기존 방식으로 다시 만든 뒤
  그 요청을 한 번만 다시 처리 (이후 프로세스가 끝날 때까지 기존 방식 — 무한 재시도 없음)
- PADDLE_REC_ONEDNN=false 로 즉시 기존 방식(oneDNN 없음)
"""
from __future__ import annotations

import logging
import os
import threading
from importlib.metadata import version

import numpy as np

from ocr.result_normalizer import Token, from_paddle_page

# 모델 저장소 연결 확인 생략 (이미 받은 모델이면 바로 로드)
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

log = logging.getLogger("paddle_ocr")
REC_MODEL = "korean_PP-OCRv5_mobile_rec"


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, "true" if default else "false").strip().lower() in ("1", "true", "yes", "on")


def _warmup_image() -> np.ndarray:
    """예열용 합성 이미지 — 글자 줄이 있어야 검출 뒤 인식 모델까지 실행된다 (영수증과 무관한 숫자·영문)."""
    import cv2

    img = np.full((160, 640, 3), 255, np.uint8)
    cv2.putText(img, "2026-01-01 12,345", (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (30, 30, 30), 3)
    cv2.putText(img, "TOTAL 4,400", (20, 135), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (30, 30, 30), 3)
    return img


class PaddleEngine:
    def __init__(self) -> None:
        self._det = os.getenv("OCR_DET_MODEL", "PP-OCRv5_mobile_det")
        # 전체 oneDNN(OCR_ENABLE_MKLDNN=1)은 Windows·paddlepaddle 3.3.1 에서 검출 모델 오류 → 기본 끔 (기존 스위치 유지)
        self._full_mkldnn = os.getenv("OCR_ENABLE_MKLDNN", "0") == "1"
        self._rec_onednn = not self._full_mkldnn and _flag("PADDLE_REC_ONEDNN", True)
        # 예측기(predictor)는 스레드 안전하지 않음 → 요청 동시 처리 시 순서대로
        self._lock = threading.Lock()
        self._ocr = self._create()
        # 시작 시 예열 — 첫 요청 지연을 없애고 oneDNN 인식이 실제로 동작하는지 미리 확인
        try:
            self._ocr.predict(_warmup_image())
        except Exception:
            if not self._rec_onednn:
                raise
            self._fallback("warmup")
            self._ocr.predict(_warmup_image())
        log.info("paddle engine ready (rec_onednn=%s)", self._rec_onednn)

    def _create(self):
        from paddleocr import PaddleOCR  # 무거운 import 는 엔진 생성 시에만

        if self._rec_onednn:
            try:
                from paddlex.inference.models.runners.paddle_static.config import blocklists
            except ImportError:  # PaddleX 내부 구조가 바뀐 버전 → 기존 방식
                log.error("rec oneDNN unavailable: paddlex blocklists not found — using non-oneDNN engine")
                self._rec_onednn = False
            else:
                if self._det not in blocklists.MKLDNN_BLOCKLIST:
                    blocklists.MKLDNN_BLOCKLIST.append(self._det)  # 검출은 oneDNN 제외, 인식만 oneDNN
        return PaddleOCR(
            # lang="korean" 기본 조합(PP-OCRv5_server_det + korean_PP-OCRv5_mobile_rec) 중 검출만 mobile 로:
            # CPU(oneDNN 끔)에서 server 검출은 영수증 한 장 200초 이상, mobile 은 약 8초 (합성 샘플 정확도 동일)
            text_detection_model_name=self._det,
            text_recognition_model_name=REC_MODEL,
            # 문서 방향 분류·펴기(unwarping)는 느리고 영수증 사진엔 효과가 작아 끔 — 필요하면 켜서 비교
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            # 줄 단위 방향(뒤집힌 글줄) 보정 — 약 20% 느려져 기본 끔 (사진 방향은 EXIF 로 보정)
            use_textline_orientation=os.getenv("OCR_TEXTLINE_ORI", "0") == "1",
            # 검출 입력 긴 변 상한 (전처리 이미지는 1600~2200) — 1600 이면 속도·정확도 균형
            text_det_limit_type="max",
            text_det_limit_side_len=int(os.getenv("OCR_DET_SIDE", "1600")),
            # True 여도 검출 모델은 위 제외 목록 때문에 oneDNN 없이 실행 (인식만 oneDNN)
            enable_mkldnn=self._full_mkldnn or self._rec_onednn,
        )

    def _fallback(self, where: str) -> None:
        """oneDNN 인식 엔진을 버리고 기존 방식(oneDNN 없음)으로 다시 만든다 — 프로세스당 한 번만."""
        log.exception("rec oneDNN failed during %s — rebuilding engine without oneDNN", where)
        self._rec_onednn = False
        old, self._ocr = self._ocr, None
        try:
            old.close()
        except Exception:  # noqa: BLE001 — 정리 실패는 무시 (새 엔진으로 계속)
            pass
        self._ocr = self._create()

    def read(self, bgr: np.ndarray) -> list[Token]:
        with self._lock:
            try:
                pages = self._ocr.predict(bgr)
            except Exception:
                if not self._rec_onednn:
                    raise
                self._fallback("predict")
                pages = self._ocr.predict(bgr)  # 이 요청만 한 번 더 (기존 방식)
        tokens: list[Token] = []
        for page in pages:
            tokens.extend(from_paddle_page(page))
        return tokens

    def close(self) -> None:
        """서버 종료 시 정리 (진행 중인 추론이 끝난 뒤 호출)."""
        with self._lock:
            if self._ocr is not None:
                try:
                    self._ocr.close()
                finally:
                    self._ocr = None

    def info(self) -> dict[str, str]:
        return {"paddleocr": version("paddleocr"), "paddlepaddle": version("paddlepaddle"), "paddlex": version("paddlex"),
                "det": self._det, "rec": REC_MODEL, "rec_onednn": str(self._rec_onednn).lower()}


_engine: PaddleEngine | None = None
_engine_lock = threading.Lock()


def get_engine() -> PaddleEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = PaddleEngine()
    return _engine
