"""표준 토큰 → 영수증 필드(date · amount · merchant) + 필드별 confidence + 후보 목록.

후보 목록(candidates)은 프론트가 Tesseract 결과와 필드 단위로 비교할 때
'Tesseract 가 고른 값이 PaddleOCR 기준으로 몇 점인지' 확인하는 데 쓴다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from ocr.result_normalizer import Row, Token, group_rows, page_size
from parsers.amount_parser import amount_candidates
from parsers.date_parser import date_candidates

REVIEW_BELOW = 0.6  # 이 confidence 미만이면 needsReview

STORE_KEYS = re.compile(r"(상호명|상호|가맹점명|가맹점|매장명|점포명|업체명)\s*[:：]?\s*")
NOT_STORE = re.compile(
    r"[영엄염]수\s?[증중]|감사|이용해|전표|고객용|카드|사업자|등록번호|대표|전화|TEL|주소|일시|번호|승인|결제|합계|금액|단가|수량|품명|POS|No\.|교환|환불|반품|상품",
    re.I,
)
TAIL = re.compile(r"\s*(?:T\s?[:.]|TEL|☎|전화|대표|사업자|\(?\d{2,4}[-)]\d{3,4}|\d{3}-\d{2}-\d{5}).*$", re.I)
CHAIN_BRANCH = re.compile(
    r"(이마트24|이마트|홈플러스|롯데마트|트레이더스|노브랜드|코스트코|하나로마트|GS25|CU|세븐일레븐|다이소|올리브영|스타벅스|투썸플레이스|이디야|파리바게뜨|뚜레쥬르)\s?([가-힣]{1,6}점)?"
)


def _clean_store(s: str) -> str:
    s = TAIL.sub("", s)
    s = re.sub(r"\(주\)|㈜|^\(?주\)?\s*(?=\S)", "", s)
    s = re.sub(r"[^\w\s&·\-]", "", s)
    return re.sub(r"\s{2,}", " ", s).strip()[:24]


def find_merchant(rows: list[Row]) -> str | None:
    """① '상호:' 표기 ② 윗부분 체인·지점명 ③ 윗부분 첫 한글 줄 (내부 추출 — 화면 반영 여부는 프론트가 결정)."""
    for r in rows:
        m = STORE_KEYS.search(r.text)
        if m:
            rest = _clean_store(r.text[m.end():])
            if re.search(r"[가-힣A-Za-z]{2,}", rest):
                return rest
    top = [_clean_store(r.text) for r in rows[:12]]
    for s in top:
        m = CHAIN_BRANCH.search(s)
        if m:
            return f"{m[1]} {m[2]}".strip() if m[2] else m[1]
    for s in top:
        if re.search(r"[가-힣]{3,}", s) and not NOT_STORE.search(s.replace(" ", "")) and not re.search(r"\d{3,}", s):
            return s
    return None


def _confidence(scores: list[float]) -> float:
    """1위 점수 × (2위와의 차이로 보정) — 후보가 비슷하면 낮아짐."""
    if not scores:
        return 0.0
    top = scores[0]
    margin = top - (scores[1] if len(scores) > 1 else 0.0)
    return round(min(0.99, top * (0.65 + 0.35 * min(1.0, margin / 0.25))), 4)


@dataclass
class ParsedReceipt:
    date: str | None
    amount: int | None
    merchant: str | None
    confidence: dict[str, float]
    candidates: dict[str, list[dict[str, Any]]]
    mean_confidence: float

    @property
    def needs_review(self) -> bool:
        return self.date is None or self.amount is None or min(self.confidence.values()) < REVIEW_BELOW

    @property
    def valid_fields(self) -> int:
        return (self.date is not None) + (self.amount is not None)


def parse_receipt(tokens: list[Token], today: date | None = None) -> ParsedReceipt:
    rows = group_rows(tokens)
    w, h = page_size(tokens)
    dates = date_candidates(rows, today)
    amounts = amount_candidates(rows, w, h)
    return ParsedReceipt(
        date=dates[0].value if dates else None,
        amount=amounts[0].value if amounts else None,
        merchant=find_merchant(rows),
        confidence={"date": _confidence([c.score for c in dates]), "amount": _confidence([c.score for c in amounts])},
        candidates={
            "date": [{"value": c.value, "score": c.score} for c in dates[:5]],
            "amount": [{"value": c.value, "score": c.score, "reasons": c.reasons} for c in amounts[:8]],
        },
        mean_confidence=round(sum(t.confidence for t in tokens) / len(tokens), 4) if tokens else 0.0,
    )
