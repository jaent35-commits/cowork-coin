"""날짜 추출 — 표준 토큰 줄(Row) 기반 후보 + 점수.

표기 규칙은 프론트 Tesseract 파서(src/lib/receiptOcr.ts findDate)와 같게 맞춘다.
점수: 기본 0.45 + 날짜 표기 줄(일시·거래일 등) + 반복 등장 + OCR 신뢰도.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from ocr.result_normalizer import Row

DATE_KEY = re.compile(r"일시|일자|거래일|판매일|승인일|결제일|매출일|발행일|날짜|DATE", re.I)

# 2026-09-24 · 2026.09.24 · 2026/9/24 · 2026년 9월 24일 · 2026:09-19 (한글 한 글자 구분자 = 오인식 허용)
P_FULL = re.compile(r"(20\d{2})\s*(?:[.\-/:]|[가-힣])\s*(\d{1,2})\s*(?:[.\-/]|[가-힣])\s*(\d{1,2})(?!\d)")
# 날짜와 시각 사이 공백이 사라진 경우 (2026.09.1819:42 → 2026-09-18)
P_GLUED_TIME = re.compile(r"(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{2})(?=\d{1,2}:\d{2})")
# 승인일자 뒤 YYMMDD + 시각
P_APPROVAL = re.compile(r"(?:승인|거래|결제|매출)\s?일[자시][^\d]{0,4}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{0,7}(?!\d)")
# 구분자 없는 8자리 (바코드 아래 20260919/…)
P_COMPACT = re.compile(r"(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)")
# 26-09-24 · 26.09.24
P_SHORT = re.compile(r"(?<!\d)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?!\d)")
# 날짜 뒤 시각 (공백·괄호 사이 허용): 2026-07-28 20:10 · 26-08-15 16:39:15
TIME_AFTER = re.compile(r"\s*[(\[]?\s*\d{1,2}\s*[:;]\s*\d{2}")


@dataclass
class DateCandidate:
    value: str
    score: float
    count: int = 0
    reasons: list[str] = field(default_factory=list)


def _valid(y: int, m: int, d: int) -> bool:
    try:
        date(y, m, d)
        return 2000 <= y
    except ValueError:
        return False


def date_candidates(rows: list[Row], today: date | None = None) -> list[DateCandidate]:
    today = today or date.today()
    hits: dict[str, dict] = defaultdict(lambda: {"count": 0, "conf": 0.0, "key": False, "time": False})

    def add(y: int, m: int, d: int, row: Row, after: str = "") -> None:
        if y > today.year:  # 미래 연도 = 오인식(2026 → 2028) → 올해
            y = today.year
        if not _valid(y, m, d):
            return
        v = f"{y:04d}-{m:02d}-{d:02d}"
        h = hits[v]
        h["count"] += 1
        h["conf"] = max(h["conf"], row.confidence)
        h["key"] = h["key"] or bool(DATE_KEY.search(row.text))
        # 날짜 바로 뒤 시각(20:10) = 거래 일시로 찍힌 날짜 (유효기간·안내 문구 날짜와 구분)
        h["time"] = h["time"] or bool(TIME_AFTER.match(after))

    for row in rows:
        t = re.sub(r"\s+", " ", row.text)
        for m in P_FULL.finditer(t):
            add(int(m[1]), int(m[2]), int(m[3]), row, t[m.end():])
        for m in P_GLUED_TIME.finditer(t):
            add(int(m[1]), int(m[2]), int(m[3]), row, " 00:00")
        for m in P_APPROVAL.finditer(t):
            add(2000 + int(m[1]), int(m[2]), int(m[3]), row)
        for m in P_COMPACT.finditer(t):
            add(int(m[1]), int(m[2]), int(m[3]), row)
        for m in P_SHORT.finditer(t):
            add(2000 + int(m[1]), int(m[2]), int(m[3]), row, t[m.end():])

    out: list[DateCandidate] = []
    for v, h in hits.items():
        reasons = []
        s = 0.45
        if h["key"]:
            s += 0.2; reasons.append("keyword")
        if h["time"]:
            s += 0.1; reasons.append("with-time")
        if h["count"] >= 2:
            s += min(0.2, 0.1 * (h["count"] - 1)); reasons.append("repeated")
        s += 0.15 * h["conf"]
        if v > today.isoformat():
            s -= 0.2; reasons.append("future")
        out.append(DateCandidate(v, round(min(1.0, max(0.0, s)), 4), h["count"], reasons))
    # 점수 → 같으면 최근 날짜
    out.sort(key=lambda c: (c.score, c.value), reverse=True)
    return out
