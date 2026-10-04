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
    r"[영엄염]수\s?[증중]|감사|이용해|전표|고객용|카드|사업자|등록번호|대표|전화|TEL|주소|일시|번호|승인|결제|합계|금액|단가|수량|품명|POS|No\.|교환|환불|반품|상품"
    # 카드 전표 머리글 — 오인식 형태 포함 (신용승인 → 신용승민 · 고객/가맹점용 → 고액/가점용)
    r"|신용|체크|승[인민님]|[고교][객액갱]|가[맹뱅]?[점섬]용|[객맹]용",
    re.I,
)
# 사업자등록번호 (오인식 허용: 첫 자리 영문 G·O 등) — 상호는 보통 이 번호와 같은 줄 왼쪽 또는 바로 윗줄
BIZ_NO = re.compile(r"[\dA-Z]{3}\s?-\s?\d{2}\s?-\s?\d{4,5}")
# 자주 틀리는 체인 이름 보정 (롯데 → 못데·옷네·롯네 · 마트 → 바트 · 쇼핑 → 쇼핀)
CHAIN_FIX = [
    (re.compile(r"[롯못옷론][데네][\s]?[마바]트"), "롯데마트"),
    (re.compile(r"[롯못옷론][데네][\s]?쇼[핑핀]"), "롯데쇼핑"),
    (re.compile(r"[롯못옷론][데네][\s]?[슈수]퍼"), "롯데슈퍼"),
    (re.compile(r"[이아][마바]트"), "이마트"),
    (re.compile(r"홈[플풀][러라]스"), "홈플러스"),
]
TAIL = re.compile(r"\s*(?:T\s?[:.]|TEL|☎|전화|대표|사업자|\(?\d{2,4}[-)]\d{3,4}|\d{3}-\d{2}-\d{5}).*$", re.I)
CHAINS = "이마트24|이마트|홈플러스|롯데마트|롯데슈퍼|트레이더스|노브랜드|코스트코|하나로마트|GS25|CU|세븐일레븐|다이소|올리브영|스타벅스|투썸플레이스|이디야|파리바게뜨|뚜레쥬르"
CHAIN_BRANCH = re.compile(rf"({CHAINS})\s?([가-힣]{{1,6}}점)?")
# 체인 이름 바로 뒤 지점명 끝 '섬' = '점' 오인식 (부평섬 → 부평점)
CHAIN_SEOM = re.compile(rf"({CHAINS})\s?([가-힣]{{1,5}})섬")


def _clean_store(s: str) -> str:
    s = TAIL.sub("", s)
    s = re.sub(r"\(주\)|㈜|^\(?주\)?\s*(?=\S)", "", s)
    s = re.sub(r"[^\w\s&·\-]", "", s)
    return re.sub(r"\s{2,}", " ", s).strip()[:24]


def _fix_chain(s: str) -> str:
    """법인명((주) 앞)은 버리고 매장명만 · 체인 이름 오인식 보정 · 체인 뒤 지점명 끝 '섬' → '점'."""
    parts = re.split(r"\(주\)|㈜|\(유\)", s)
    if len(parts) > 1 and re.search(r"[가-힣]{2,}", parts[-1]):
        s = parts[-1]
    for pat, rep in CHAIN_FIX:
        s = pat.sub(rep, s)
    # 체인 이름 바로 뒤 지점명만 (부평섬 → 부평점) — 원래 '섬'으로 끝나는 가게 이름은 건드리지 않음
    return CHAIN_SEOM.sub(r"\1 \2점", s)


def _store_like(s: str) -> bool:
    return bool(re.search(r"[가-힣]{2,}|[A-Za-z]{3,}", s)) and not NOT_STORE.search(s.replace(" ", "")) and not re.search(r"\d{3,}", s)


def _chain(s: str) -> str | None:
    m = CHAIN_BRANCH.search(s)
    return (f"{m[1]} {m[2]}".strip() if m[2] else m[1]) if m else None


def find_merchant(rows: list[Row]) -> str | None:
    """
    ① '상호:' 표기 ② 사업자등록번호 줄의 왼쪽(없으면 바로 윗줄) ③ 윗부분 체인·지점명 ④ 윗부분 첫 한글 줄
    (내부 추출 — 화면 반영 여부는 프론트가 결정). 카드 전표 머리글(신용승인·고객/가맹점용)은 건너뜀.
    """
    for r in rows:
        m = STORE_KEYS.search(r.text)
        if m:
            rest = _clean_store(_fix_chain(r.text[m.end():]))
            if re.search(r"[가-힣A-Za-z]{2,}", rest):
                return rest
    top = rows[:12]
    for i, r in enumerate(top):
        biz = next((t for t in r.tokens if BIZ_NO.search(t.text)), None)
        if not biz:
            continue
        left = " ".join(t.text for t in r.tokens if t.cx < biz.cx) or BIZ_NO.split(r.text)[0]
        for s in [_clean_store(_fix_chain(left))] + ([_clean_store(_fix_chain(top[i - 1].text))] if i > 0 else []):
            if _store_like(s):
                return _chain(s) or s
    fixed = [_clean_store(_fix_chain(r.text)) for r in top]
    for s in fixed:
        c = _chain(s)
        if c:
            return c
    for s in fixed:
        if re.search(r"[가-힣]{3,}", s) and _store_like(s):
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
