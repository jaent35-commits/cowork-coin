"""최종 결제금액 추출 — 표준 토큰(bbox·confidence) 기반 후보 점수.

점수 요소 (합계 1.0 으로 자름):
- keyword   : 합계·결제금액·승인금액 등 표기와 같은 줄(오른쪽) 또는 바로 아래 줄 — 표기 우선순위별 가중
- negative  : 부가세·공급가·할인·받은금액·거스름 줄 금액은 감점, 전화·사업자·승인번호 줄은 후보 제외
- vat       : 공급가액 + 부가세 = 금액, 또는 공급가액 × 1.1 ≈ 금액
- repeated  : 요약 줄에 2번 이상 등장 (합계·결제·카드 승인에 반복해서 찍힘)
- ocr       : 토큰 인식 신뢰도
- position  : 영수증 아래쪽 절반 · 오른쪽 정렬
- pattern   : 1,234 형식 · 10원 단위
표기 규칙은 프론트 Tesseract 파서(src/lib/receiptOcr.ts findTotal)와 같게 맞춘다.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from ocr.result_normalizer import Row, Token

# 표기 → 가중 (실제 결제할 금액 > 합계 > 승인 > 할인 전 구매액)
TOTAL_KEYS: list[tuple[str, float]] = [
    ("결제대상금액", 1.0), ("실결제금액", 1.0), ("결제할금액", 1.0), ("받을금액", 1.0), ("청구금액", 1.0),
    ("결제금액", 0.95), ("카드결제", 0.8), ("신용카드", 0.7), ("대상금액", 0.9), ("합계금액", 0.95), ("총합계", 0.95), ("금액합계", 0.9),
    ("합계", 0.9), ("영수금액", 0.85), ("총금액", 0.85), ("총액", 0.85), ("TOTAL", 0.85),
    ("승인금액", 0.85), ("판매금액", 0.7), ("총구매액", 0.6), ("구매금액", 0.6), ("일시불", 0.6), ("요금", 0.5),
]
NOT_TOTAL = re.compile(r"부가세|부가가치세|VAT|과세|면세|공급가|할인|포인트|거스름|잔돈|받은금액|적립", re.I)
NOT_AMOUNT_LINE = re.compile(r"km|거리|사업자|등록번호|대표|전화|TEL|T:|승인번호|카드번호|번호|POS|No\.?\s?\d", re.I)
SUPPLY = re.compile(r"과세물품|공급가")
VAT = re.compile(r"부가세|부가가치세|세액|VAT", re.I)

AMOUNT_RE = re.compile(r"(?<![\d,\-*/:])(?<!\d\.)(\d{1,3}(?:[,.]\s?\d{3})+|\d{3,7})(?![\d,.]?\d|[-/*]\d|\*)")


def norm(text: str) -> str:
    """오인식 잦은 글자 보정 후 비교용 (결세·결재 → 결제, 대정 → 대상, 급액 → 금액, 합게 → 합계)."""
    t = re.sub(r"\s+", "", text).upper()
    t = re.sub(r"[결펄필엘렐걸겔][세재께제]", "결제", t)
    t = re.sub(r"[대내때][정성상][금급]", "대상금", t)
    t = re.sub(r"급액|금색", "금액", t)
    t = re.sub(r"[분반빈]을금액", "받을금액", t)
    return re.sub(r"합[게개]", "합계", t)


def amounts_in(text: str) -> list[tuple[int, bool]]:
    """텍스트 안 금액 후보 → (값, 1,234 형식인지). 숫자 사이 0 을 ㅁ·O 로 읽은 경우 보정."""
    t = re.sub(r"(?<=\d)[ㅁOoD](?=[\d,.ㅁOo]*(?:원|\s|$))", "0", text)
    out = []
    for m in AMOUNT_RE.finditer(t):
        raw = m.group(1)
        v = int(re.sub(r"[,. ]", "", raw))
        if 100 <= v < 100_000_000:
            out.append((v, bool(re.search(r"\d[,.]\d{3}", raw))))
    return out


def key_weight(text: str) -> float:
    n = norm(text)
    return max((w for k, w in TOTAL_KEYS if k in n), default=0.0)


@dataclass
class AmountCandidate:
    value: int
    score: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class _Hit:
    value: int
    token: Token
    row_idx: int
    comma: bool


def amount_candidates(rows: list[Row], width: float, height: float) -> list[AmountCandidate]:
    hits: list[_Hit] = []
    for i, row in enumerate(rows):
        if NOT_AMOUNT_LINE.search(row.text):
            continue
        for tok in row.tokens:
            for v, comma in amounts_in(tok.text):
                hits.append(_Hit(v, tok, i, comma))
    if not hits:
        return []

    # 공급가액·부가세 (같은 줄 마지막 금액)
    def row_amount(pat: re.Pattern, not_pat: re.Pattern | None = None) -> int | None:
        for row in rows:
            if pat.search(norm(row.text)) and not (not_pat and not_pat.search(norm(row.text))):
                a = amounts_in(row.text)
                if a:
                    return a[-1][0]
        return None

    supply = row_amount(SUPPLY)
    vat = row_amount(VAT, re.compile(r"과세물품|공급가|면세"))
    # 공급가 표기가 '판매금액'·'물품가액' 등으로 다른 양식 → 부가세의 10배인 금액(부가세 줄 제외)을 공급가로 봄
    # 예: 판매금액 60,000 · 부가가치세 6,000 · 합계 66,000
    if supply is None and vat:
        tens = [h.value for h in hits if abs(h.value - vat * 10) <= 10 and not NOT_TOTAL.search(norm(rows[h.row_idx].text))]
        if tens:
            supply = tens[0]
    vat_sum = supply + vat if supply is not None and vat is not None and abs(supply / 10 - vat) <= 2 else None
    # 할인 줄 (공급가액 + 부가세 − 할인 = 결제금액)
    # '-1,000' 처럼 앞에 '-' 가 붙어 일반 금액 후보에서는 빠지므로 따로 읽음
    discount = None
    for row in rows:
        if "할인" in norm(row.text):
            m = re.search(r"-?\s?(\d{1,3}(?:,\d{3})+|\d{3,7})(?!\d)", row.text)
            if m:
                discount = int(m.group(1).replace(",", ""))
                break

    summary_counts = Counter(h.value for h in hits if not NOT_TOTAL.search(rows[h.row_idx].text))

    best: dict[int, AmountCandidate] = {}
    for h in hits:
        row = rows[h.row_idx]
        reasons: list[str] = []
        s = 0.0
        # keyword: 같은 줄에서 금액 왼쪽에 표기
        left_text = " ".join(t.text for t in row.tokens if t.cx < h.token.cx) or row.text
        kw = key_weight(left_text)
        if kw:
            s += 0.45 * kw; reasons.append("keyword-row")
        elif h.row_idx > 0:
            # 바로 위 줄 표기 + 금액이 오른쪽/같은 열 (표기 아래 금액이 찍히는 양식)
            above = rows[h.row_idx - 1]
            gap = row.cy - above.cy
            kw_up = key_weight(above.text)
            if kw_up and gap <= 2.2 * h.token.height and not NOT_TOTAL.search(above.text):
                s += 0.3 * kw_up; reasons.append("keyword-above")
        if NOT_TOTAL.search(row.text):
            s -= 0.35; reasons.append("vat/discount-row")
        if vat_sum is not None and abs(h.value - vat_sum) <= 1:
            s += 0.25; reasons.append("supply+vat")
        elif vat_sum is not None and discount and abs(h.value - (vat_sum - discount)) <= 1:
            s += 0.25; reasons.append("supply+vat-discount")
        elif supply is not None and abs(h.value - supply * 1.1) <= max(10, supply * 0.005):
            s += 0.15; reasons.append("supply*1.1")
        if summary_counts[h.value] >= 2:
            s += 0.12; reasons.append("repeated")
        s += 0.1 * h.token.confidence
        rel_y = h.token.cy / max(1.0, height)
        rel_x = h.token.cx / max(1.0, width)
        if rel_y >= 0.4:
            s += 0.05; reasons.append("lower-half")
        elif rel_y < 0.15:
            s -= 0.05
        if rel_x >= 0.55:
            s += 0.04; reasons.append("right")
        if h.comma:
            s += 0.04; reasons.append("comma")
        if h.value % 10 == 0:
            s += 0.03
        else:
            s -= 0.08; reasons.append("not-10won")
        s = round(min(1.0, max(0.0, s)), 4)
        if h.value not in best or s > best[h.value].score:
            best[h.value] = AmountCandidate(h.value, s, reasons)

    out = sorted(best.values(), key=lambda c: (c.score, c.value), reverse=True)
    return out
