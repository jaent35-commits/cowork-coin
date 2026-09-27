"""OCR 엔진 원본 결과 → 내부 표준 토큰 포맷.

parser 는 이 모듈의 Token 만 사용하고, PaddleOCR 라이브러리의 반환 형식에는 의존하지 않는다.

표준 포맷 (to_dict):
    {"text": "합계", "confidence": 0.98,
     "bbox": {"x1": 100, "y1": 850, "x2": 210, "y2": 890},
     "centerX": 155, "centerY": 870}
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class Token:
    text: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float
    # 글줄 기울기(라디안, 다각형 윗변 기준) — 기울어진 사진에서 같은 줄 판단용
    angle: float = 0.0

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    @property
    def height(self) -> float:
        return max(1.0, self.y2 - self.y1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 4),
            "bbox": {"x1": round(self.x1), "y1": round(self.y1), "x2": round(self.x2), "y2": round(self.y2)},
            "centerX": round(self.cx),
            "centerY": round(self.cy),
        }


def _box_from_points(points: Sequence[Sequence[float]]) -> tuple[float, float, float, float]:
    """사각형 꼭짓점(기울어진 다각형 포함) → 축 정렬 bbox."""
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def from_paddle_page(page: Any) -> list[Token]:
    """PaddleOCR 3.x predict() 결과 한 페이지(OCRResult, dict 처럼 접근) → Token 목록.

    3.x 결과 키: rec_texts(list[str]) · rec_scores(list[float]) · rec_polys(list[4x2 배열]) · rec_boxes([N,4] x1,y1,x2,y2)
    """
    texts: Iterable[str] = page["rec_texts"]
    scores = list(page["rec_scores"])
    boxes = page.get("rec_boxes") if hasattr(page, "get") else None
    polys = page["rec_polys"]
    tokens: list[Token] = []
    for i, text in enumerate(texts):
        text = str(text).strip()
        if not text:
            continue
        poly = polys[i]
        if boxes is not None and len(boxes) > i:
            x1, y1, x2, y2 = (float(v) for v in boxes[i][:4])
        else:
            x1, y1, x2, y2 = _box_from_points(poly)
        (px1, py1), (px2, py2) = (float(poly[0][0]), float(poly[0][1])), (float(poly[1][0]), float(poly[1][1]))
        angle = math.atan2(py2 - py1, px2 - px1) if px2 - px1 > 1 else 0.0
        tokens.append(Token(text, float(scores[i]), x1, y1, x2, y2, angle))
    return tokens


@dataclass
class Row:
    """같은 줄(세로 중심이 가까운) 토큰 묶음 — 왼쪽부터 정렬."""
    tokens: list[Token]

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens)

    @property
    def cy(self) -> float:
        return sum(t.cy for t in self.tokens) / len(self.tokens)

    @property
    def confidence(self) -> float:
        return sum(t.confidence for t in self.tokens) / len(self.tokens)


def skew(tokens: Sequence[Token]) -> float:
    """사진 기울기 = 가로로 긴 글상자들의 기울기 중앙값 (±15° 밖은 무시)."""
    angles = sorted(t.angle for t in tokens if t.x2 - t.x1 > 2 * t.height and abs(t.angle) < 0.26)
    return angles[len(angles) // 2] if angles else 0.0


def _level(t: Token, a: float) -> float:
    """기울기를 되돌린 세로 위치 — 같은 글줄이면 비슷한 값."""
    return -math.sin(a) * t.cx + math.cos(a) * t.cy


def group_rows(tokens: Sequence[Token]) -> list[Row]:
    """기울기를 되돌린 세로 위치가 글자 높이의 절반 이내면 같은 줄로 묶음 (위 → 아래)."""
    if not tokens:
        return []
    heights = sorted(t.height * math.cos(t.angle) for t in tokens)
    tol = heights[len(heights) // 2] * 0.55
    a = skew(tokens)
    rows: list[Row] = []
    levels: list[float] = []
    for t in sorted(tokens, key=lambda t: _level(t, a)):
        lv = _level(t, a)
        if rows and abs(levels[-1] - lv) <= tol:
            rows[-1].tokens.append(t)
            n = len(rows[-1].tokens)
            levels[-1] += (lv - levels[-1]) / n
        else:
            rows.append(Row([t]))
            levels.append(lv)
    for r in rows:
        r.tokens.sort(key=lambda t: t.x1)
    return rows


def page_size(tokens: Sequence[Token]) -> tuple[float, float]:
    """토큰이 차지한 범위 (영수증 내 상대 위치 계산용)."""
    if not tokens:
        return 1.0, 1.0
    return max(t.x2 for t in tokens), max(t.y2 for t in tokens)
