"""모바일 영수증 사진 전처리.

순서: EXIF 회전 보정 → 종횡비 유지 리사이즈(긴 변 1600~2200px) → 흑백 → 가벼운 대비 보정(CLAHE)
- 강한 이진화(threshold)는 하지 않는다: 감열지의 얇은 글자가 사라진다.
- deskew / perspective 보정은 PaddleOCR 문서 보정 옵션(use_doc_unwarping)이나 이 모듈의 훅으로 추후 추가.
- 원본에 가까운 버전(`original`)과 가볍게 보정한 버전(`light`)을 둘 다 만들 수 있게 분리 — 기본은 light 한 가지만 OCR.
"""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageOps

LONG_MIN = 1600
LONG_MAX = 2200


def load_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # 1. 휴대폰 촬영 방향(EXIF orientation) 보정
    return img.convert("RGB")


def resize_long_side(img: Image.Image) -> Image.Image:
    """2. 긴 변이 1600 보다 작으면 키우고, 2200 보다 크면 줄임 (종횡비 유지)."""
    w, h = img.size
    long = max(w, h)
    target = LONG_MIN if long < LONG_MIN else LONG_MAX if long > LONG_MAX else long
    if target == long:
        return img
    k = target / long
    return img.resize((round(w * k), round(h * k)), Image.LANCZOS)


def to_bgr(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


def light_enhance(bgr: np.ndarray) -> np.ndarray:
    """3~4. 흑백 + 약한 CLAHE(국소 대비) — 그림자·누런 감열지에서 글자 대비만 살짝 올림. 3채널로 되돌려 OCR 입력."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(clahe.apply(gray), cv2.COLOR_GRAY2BGR)


def deskew(bgr: np.ndarray) -> np.ndarray:
    """5. 기울기·원근 보정 훅 — 최초 구현은 그대로 반환 (PaddleOCR textline 방향 분류로 기울어진 줄은 처리)."""
    return bgr


def prepare_variants(data: bytes, dual: bool = False) -> dict[str, np.ndarray]:
    """OCR 입력 이미지들. dual=False 면 light 한 가지만 (성능 우선)."""
    base = resize_long_side(load_image(data))
    bgr = to_bgr(base)
    variants = {"light": deskew(light_enhance(bgr))}
    if dual:
        variants["original"] = bgr
    return variants
