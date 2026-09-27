"""개발용: 합성 샘플의 줄 묶음 출력 — python tests/debug_rows.py restaurant"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
from paddleocr import PaddleOCR
from ocr.image_preprocess import prepare_variants
from ocr.result_normalizer import from_paddle_page, group_rows, skew
from tests.make_sample import OUT
name = sys.argv[1] if len(sys.argv) > 1 else "restaurant"
ocr = PaddleOCR(text_detection_model_name="PP-OCRv5_mobile_det", text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
                text_det_limit_type="max", text_det_limit_side_len=1600, enable_mkldnn=False)
toks = [t for p in ocr.predict(prepare_variants((OUT / f"{name}.jpg").read_bytes())["light"]) for t in from_paddle_page(p)]
print("skew(deg)", round(skew(toks) * 57.3, 2))
for r in group_rows(toks):
    print(f"{r.cy:7.0f} | " + " | ".join(f"{t.text}({t.confidence:.2f})" for t in r.tokens))
