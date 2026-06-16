from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-labels"
SIZE = (900, 1300)

WARNING_LINES = [
    "GOVERNMENT WARNING:",
    "(1) According to the Surgeon General, women should not",
    "drink alcoholic beverages during pregnancy because of",
    "the risk of birth defects. (2) Consumption of alcoholic",
    "beverages impairs your ability to drive a car or operate",
    "machinery, and may cause health problems.",
]


def font(size, bold=False, serif=False):
    candidates = []
    if serif:
        candidates.extend(
            [
                "C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf",
                "C:/Windows/Fonts/timesbd.ttf" if bold else "C:/Windows/Fonts/times.ttf",
            ]
        )
    candidates.extend(
        [
            "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/calibrib.ttf" if bold else "C:/Windows/Fonts/calibri.ttf",
        ]
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default(size=size)


def centered(draw, text, y, fill="#17202a", size=36, bold=False, serif=False):
    fnt = font(size, bold=bold, serif=serif)
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (SIZE[0] - (bbox[2] - bbox[0])) / 2
    draw.text((x, y), text, fill=fill, font=fnt)


def label(path, brand_top, abv, net_contents=True, warning_case="good"):
    image = Image.new("RGB", SIZE, "#f8f3e8")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 70, 830, 1230), radius=18, fill="#fffaf0", outline="#17202a", width=8)
    draw.rectangle((105, 105, 795, 1195), outline="#b26b00", width=4)

    centered(draw, brand_top, 185, size=62, bold=True, serif=True)
    centered(draw, "DISTILLERY", 250, size=46, bold=True, serif=True)
    draw.line((185, 315, 715, 315), fill="#17202a", width=3)
    centered(draw, "Kentucky Straight Bourbon Whiskey", 360, size=34)
    centered(draw, abv, 455, size=36, bold=True)
    if net_contents:
      centered(draw, "Net Contents 750 mL", 535, size=34)
    centered(draw, "Bottled by Old Tom Distillery", 630, size=27)
    centered(draw, "112 Barrel House Road, Frankfort, KY 40601", 670, size=27)

    draw.rectangle((135, 820, 765, 1070), fill="#ffffff", outline="#17202a", width=3)
    warning_font = font(27, bold=warning_case == "good")
    heading = "GOVERNMENT WARNING:" if warning_case == "good" else "Government Warning:"
    draw.text((160, 845), heading, fill="#17202a", font=warning_font)
    body_font = font(23)
    for index, line in enumerate(WARNING_LINES[1:]):
        draw.text((160, 900 + index * 34), line, fill="#17202a", font=body_font)

    image.save(OUT / path, "PNG", optimize=True)


label("pass-distilled-spirits.png", "OLD TOM", "45% Alc./Vol. (90 Proof)")
label("fail-warning-case.png", "OLD TOM", "45% Alc./Vol. (90 Proof)", warning_case="bad")
label("fail-abv-mismatch.png", "OLD TOM", "40% Alc./Vol. (80 Proof)")
label("fail-missing-net-contents.png", "OLD TOM", "45% Alc./Vol. (90 Proof)", net_contents=False)
label("fail-brand-mismatch.png", "OLD TIMBER", "45% Alc./Vol. (90 Proof)")
print("Generated PNG fixtures in test-labels/")
