"""엔진·파서 동작 확인 (서버 없이): python tests/smoke.py

- 싱글턴 재사용 확인 (두 번째 get_engine 은 즉시)
- 표준 토큰 포맷 출력 (개발 확인용 — 합성 이미지라 개인정보 없음)
- 날짜·금액 정답 비교
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ocr.image_preprocess import prepare_variants  # noqa: E402
from ocr.paddle_ocr import get_engine  # noqa: E402
from parsers.receipt_parser import parse_receipt  # noqa: E402
from tests.make_sample import OUT, RECEIPTS  # noqa: E402

t0 = time.perf_counter()
engine = get_engine()
t1 = time.perf_counter()
assert get_engine() is engine
print(f"engine load {t1 - t0:.1f}s, reuse {time.perf_counter() - t1:.4f}s", engine.info())

ok = 0
for name, (_, want_date, want_amount) in RECEIPTS.items():
    data = (OUT / f"{name}.jpg").read_bytes()
    img = prepare_variants(data)["light"]
    s = time.perf_counter()
    tokens = engine.read(img)
    p = parse_receipt(tokens)
    good = p.date == want_date and p.amount == want_amount
    ok += good
    print(f"\n[{name}] {time.perf_counter() - s:.1f}s tokens={len(tokens)} ->", "OK" if good else "FAIL")
    print(" sample token:", json.dumps(tokens[0].to_dict(), ensure_ascii=False) if tokens else None)
    print(" date", p.date, "(want", want_date, ") amount", p.amount, "(want", want_amount, ")")
    print(" confidence", p.confidence, "merchant", p.merchant, "review", p.needs_review)
    print(" amount candidates", p.candidates["amount"][:4])
print(f"\n{ok}/{len(RECEIPTS)} correct")
