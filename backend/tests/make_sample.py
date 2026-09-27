"""테스트용 합성 영수증 이미지 생성 (실제 영수증 대신 — 개인정보 없음).

python tests/make_sample.py → tests/samples/*.jpg
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent / "samples"
FONT = "C:/Windows/Fonts/malgun.ttf"

RECEIPTS = {
    # 이름: (줄 목록, 정답 날짜, 정답 금액)
    "gs25": ([
        "GS25 역삼점", "사업자 123-45-67890  대표 홍길동", "TEL 02-555-1234", "",
        "판매일시 2026-09-24 12:31", "----------------------------------",
        "상품명            수량        금액", "삼각김밥           2         2,600", "아메리카노         1         1,800",
        "----------------------------------", "과세물품가액                  4,000", "부가세                          400",
        "합계                          4,400", "신용카드 승인금액             4,400", "승인번호 12345678",
    ], "2026-09-24", 4400),
    "restaurant": ([
        "[한우마을 강남점]", "상호: 한우마을 강남점", "주소 서울특별시 강남구 테헤란로 1", "",
        "거래일자: 2026.09.18 19:42:10", "",
        "한우모듬 2인      2    70,000", "공기밥            2     2,000", "음료수            1     3,000",
        "", "공급가액                 68,182", "부가세                    6,818", "할인                     -1,000",
        "받을금액                 74,000", "카드결제                 74,000",
    ], "2026-09-18", 74000),
}


def render(lines: list[str]) -> Image.Image:
    font = ImageFont.truetype(FONT, 30)
    w, lh = 720, 46
    img = Image.new("RGB", (w, 80 + lh * len(lines)), (250, 247, 238))  # 약간 누런 감열지
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((40, 40 + i * lh), line, font=font, fill=(40, 40, 40))
    # 휴대폰 촬영 느낌: 약간 흐림 + 회전 + 배경
    img = img.filter(ImageFilter.GaussianBlur(0.6)).rotate(2.5, expand=True, fillcolor=(120, 110, 100))
    return img


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, (lines, _, _) in RECEIPTS.items():
        render(lines).save(OUT / f"{name}.jpg", quality=88)
    print("saved", [p.name for p in OUT.glob("*.jpg")])
