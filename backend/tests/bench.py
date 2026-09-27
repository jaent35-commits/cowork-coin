"""검출 모델·해상도 설정별 속도·정확도 비교 (개발용): python tests/bench.py"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import os  # noqa: E402

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
from paddleocr import PaddleOCR  # noqa: E402

from ocr.image_preprocess import prepare_variants  # noqa: E402
from ocr.result_normalizer import from_paddle_page  # noqa: E402
from parsers.receipt_parser import parse_receipt  # noqa: E402
from tests.make_sample import OUT, RECEIPTS  # noqa: E402

CONFIGS = {
    "mobile_det+ori 1600": dict(text_detection_model_name="PP-OCRv5_mobile_det", use_textline_orientation=True, text_det_limit_side_len=1600),
    "mobile_det 1600": dict(text_detection_model_name="PP-OCRv5_mobile_det", use_textline_orientation=False, text_det_limit_side_len=1600),
    "mobile_det 1280": dict(text_detection_model_name="PP-OCRv5_mobile_det", use_textline_orientation=False, text_det_limit_side_len=1280),
}
for name, cfg in CONFIGS.items():
    ocr = PaddleOCR(text_recognition_model_name="korean_PP-OCRv5_mobile_rec", use_doc_orientation_classify=False,
                    use_doc_unwarping=False, text_det_limit_type="max", enable_mkldnn=False, **cfg)
    res = []
    for r, (_, d, a) in RECEIPTS.items():
        img = prepare_variants((OUT / f"{r}.jpg").read_bytes())["light"]
        s = time.perf_counter()
        toks = [t for p in ocr.predict(img) for t in from_paddle_page(p)]
        p = parse_receipt(toks)
        res.append(f"{r}:{time.perf_counter() - s:.1f}s {'OK' if (p.date, p.amount) == (d, a) else 'FAIL'} conf={p.confidence}")
    print(name, "|", " ; ".join(res), flush=True)
