#!/usr/bin/env python3

from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
OUTPUT_DIR = ROOT / "output" / "pdf"
CAMPAIGN_ASSET_DIR = ROOT / "docs" / "assets" / "campaigns"
BACKGROUND_PATH = CAMPAIGN_ASSET_DIR / "plus30-food-background.jpg"
APP_ICON_PATH = WORKSPACE / "FreeFinderWien" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon.png"
APP_SCREEN_PATH = ROOT / "docs" / "assets" / "current-ios" / "deals-home.jpg"
FLYER_PNG_PATH = OUTPUT_DIR / "FreeFinder-PLUS30-Flyer-A5.png"
FLYER_PDF_PATH = OUTPUT_DIR / "FreeFinder-PLUS30-Flyer-A5.pdf"
PREVIEW_PATH = CAMPAIGN_ASSET_DIR / "plus30-preview.png"

PROMOTION_URL = (
    "https://freefinder.at/plus-gratis.html"
    "?promo=PLUS30WIEN"
    "&utm_source=flyer"
    "&utm_medium=qr"
    "&utm_campaign=plus30wien"
)

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_ROUNDED = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"

INK = (11, 20, 40)
MUTED = (78, 91, 116)
ORANGE = (255, 107, 53)
CORAL = (232, 84, 63)
GREEN = (53, 190, 113)
PAPER = (255, 253, 249)
WHITE = (255, 255, 255)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def fitted_image(path: Path, size: tuple[int, int], position=(0.5, 0.5)) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return ImageOps.fit(source, size, method=Image.Resampling.LANCZOS, centering=position)


def make_qr(size: int) -> Image.Image:
    code = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=16,
        border=4,
    )
    code.add_data(PROMOTION_URL)
    code.make(fit=True)
    image = code.make_image(fill_color=INK, back_color=WHITE).convert("RGB")
    return image.resize((size, size), Image.Resampling.NEAREST)


def draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int, used_font, fill, width: int) -> int:
    box = draw.textbbox((0, 0), text, font=used_font)
    text_width = box[2] - box[0]
    draw.text(((width - text_width) / 2, y), text, font=used_font, fill=fill)
    return box[3] - box[1]


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    max_width: int,
    used_font,
    fill,
    line_gap: int,
    anchor: str = "la",
) -> int:
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        width = draw.textbbox((0, 0), candidate, font=used_font)[2]
        if current and width > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)

    x, y = xy
    line_height = draw.textbbox((0, 0), "Ag", font=used_font)[3]
    for line in lines:
        draw.text((x, y), line, font=used_font, fill=fill, anchor=anchor)
        y += line_height + line_gap
    return y


def make_phone(screen_path: Path, width: int, height: int) -> Image.Image:
    phone = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    phone_draw = ImageDraw.Draw(phone)
    phone_draw.rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=56,
        fill=INK,
        outline=(255, 255, 255, 190),
        width=5,
    )
    inset = 18
    inner_size = (width - inset * 2, height - inset * 2)
    screen = fitted_image(screen_path, inner_size, position=(0.5, 0.05))
    phone.paste(screen, (inset, inset), rounded_mask(inner_size, 42))
    return phone


def build_flyer() -> Image.Image:
    width, height = 1748, 2480
    background = fitted_image(BACKGROUND_PATH, (width, height), position=(0.5, 0.48)).convert("RGBA")

    top_wash = Image.new("RGBA", (width, 1450), (255, 253, 249, 0))
    top_alpha = Image.new("L", top_wash.size)
    alpha_pixels = top_alpha.load()
    for y in range(top_wash.height):
        opacity = max(0, min(255, int(252 - y * 0.105)))
        for x in range(top_wash.width):
            alpha_pixels[x, y] = opacity
    top_wash.putalpha(top_alpha.filter(ImageFilter.GaussianBlur(16)))
    background.alpha_composite(top_wash, (0, 0))

    draw = ImageDraw.Draw(background)

    icon = Image.open(APP_ICON_PATH).convert("RGBA").resize((116, 116), Image.Resampling.LANCZOS)
    icon.putalpha(rounded_mask((116, 116), 28))
    background.alpha_composite(icon, (116, 92))
    draw.text((255, 113), "FreeFinder", font=font(FONT_ROUNDED, 62), fill=INK)

    pill_box = (1180, 108, 1624, 190)
    draw.rounded_rectangle(pill_box, radius=38, fill=(255, 255, 255, 230), outline=(255, 107, 53, 80), width=3)
    draw.text((1402, 149), "30 TAGE · 0 €", font=font(FONT_BOLD, 32), fill=CORAL, anchor="mm")

    draw_centered(draw, "1 MONAT GRATIS", 310, font(FONT_ROUNDED, 126), ORANGE, width)
    draw_centered(draw, "ESSEN & TRINKEN", 458, font(FONT_ROUNDED, 126), INK, width)
    draw_centered(draw, "DEALS ENTDECKEN", 608, font(FONT_ROUNDED, 104), INK, width)

    draw_wrapped(
        draw,
        "Mit FreeFinder PLUS findest du aktuelle Gratis-Angebote, Kaffee-Deals und Food-Highlights in Wien.",
        (874, 790),
        1390,
        font(FONT_BOLD, 46),
        MUTED,
        13,
        anchor="ma",
    )

    benefits = [
        ("✓", "30 Tage PLUS"),
        ("✓", "Keine Zahlungsmethode"),
        ("✓", "Endet automatisch"),
    ]
    x_positions = [328, 874, 1420]
    for x, (mark, label) in zip(x_positions, benefits):
        draw.ellipse((x - 205, 995, x - 137, 1063), fill=GREEN)
        draw.line((x - 189, 1030, x - 176, 1042), fill=WHITE, width=8)
        draw.line((x - 177, 1042, x - 153, 1016), fill=WHITE, width=8)
        draw.text((x - 112, 1029), label, font=font(FONT_BOLD, 34), fill=INK, anchor="lm")

    panel_box = (92, 1160, 1656, 2308)
    draw.rounded_rectangle(
        panel_box,
        radius=58,
        fill=(255, 255, 255, 242),
        outline=(11, 20, 40, 28),
        width=3,
    )

    phone = make_phone(APP_SCREEN_PATH, 516, 1000)
    phone_shadow = Image.new("RGBA", (620, 1090), (0, 0, 0, 0))
    ImageDraw.Draw(phone_shadow).rounded_rectangle(
        (52, 50, 568, 1050),
        radius=64,
        fill=(11, 20, 40, 72),
    )
    phone_shadow = phone_shadow.filter(ImageFilter.GaussianBlur(25))
    background.alpha_composite(phone_shadow, (116, 1198))
    background.alpha_composite(phone, (168, 1208))

    draw.text((1120, 1290), "QR SCANNEN", font=font(FONT_ROUNDED, 52), fill=INK, anchor="mm")
    draw.text((1120, 1357), "& PLUS GRATIS HOLEN", font=font(FONT_BOLD, 34), fill=CORAL, anchor="mm")

    qr = make_qr(540)
    background.alpha_composite(qr.convert("RGBA"), (850, 1435))

    draw.rounded_rectangle((894, 2012, 1346, 2082), radius=31, fill=(255, 235, 226))
    draw.text((1120, 2047), "CODE: PLUS30WIEN", font=font(FONT_BOLD, 28), fill=CORAL, anchor="mm")
    draw.text((1120, 2148), "freefinder.at", font=font(FONT_ROUNDED, 39), fill=INK, anchor="mm")
    draw.text((1120, 2202), "Für iPhone & Android", font=font(FONT_BOLD, 29), fill=MUTED, anchor="mm")

    fine_print = (
        "Einmalige Aktivierung pro Gerät. Der Gratis-Monat endet nach 30 Tagen automatisch "
        "und wird nicht kostenpflichtig verlängert. Aktion kann jederzeit beendet werden."
    )
    draw.rounded_rectangle((104, 2320, 1644, 2442), radius=42, fill=(255, 253, 249, 232))
    draw_wrapped(
        draw,
        fine_print,
        (874, 2352),
        1480,
        font(FONT_REGULAR, 24),
        (77, 82, 92),
        7,
        anchor="ma",
    )

    return background.convert("RGB")


def build_preview() -> Image.Image:
    width, height = 1200, 630
    background = fitted_image(BACKGROUND_PATH, (width, height), position=(0.5, 0.28)).convert("RGBA")
    wash = Image.new("RGBA", (width, height), (255, 253, 249, 0))
    wash_draw = ImageDraw.Draw(wash)
    wash_draw.rectangle((0, 0, 760, height), fill=(255, 253, 249, 242))
    for offset, alpha in enumerate(range(225, 0, -15)):
        x = 760 + offset * 18
        wash_draw.rectangle((x, 0, x + 18, height), fill=(255, 253, 249, alpha))
    background.alpha_composite(wash)
    draw = ImageDraw.Draw(background)

    icon = Image.open(APP_ICON_PATH).convert("RGBA").resize((72, 72), Image.Resampling.LANCZOS)
    icon.putalpha(rounded_mask((72, 72), 18))
    background.alpha_composite(icon, (54, 44))
    draw.text((148, 61), "FreeFinder", font=font(FONT_ROUNDED, 40), fill=INK)

    draw.text((54, 178), "1 Monat PLUS", font=font(FONT_ROUNDED, 78), fill=INK)
    draw.text((54, 266), "gratis.", font=font(FONT_ROUNDED, 78), fill=ORANGE)
    draw_wrapped(
        draw,
        "Essen, Kaffee & Getränke-Deals in Wien entdecken.",
        (58, 380),
        620,
        font(FONT_BOLD, 34),
        MUTED,
        10,
    )
    draw.rounded_rectangle((54, 520, 592, 584), radius=31, fill=INK)
    draw.text((323, 552), "30 Tage · 0 € · ohne Zahlungsmethode", font=font(FONT_BOLD, 22), fill=WHITE, anchor="mm")

    phone = make_phone(APP_SCREEN_PATH, 270, 520)
    phone = phone.rotate(-6, resample=Image.Resampling.BICUBIC, expand=True)
    background.alpha_composite(phone, (810, 68))
    return background.convert("RGB")


def write_pdf(image_path: Path, pdf_path: Path) -> None:
    page_width, page_height = A5
    document = canvas.Canvas(str(pdf_path), pagesize=A5)
    document.drawImage(
        str(image_path),
        0,
        0,
        width=page_width,
        height=page_height,
        preserveAspectRatio=False,
        mask="auto",
    )
    document.showPage()
    document.save()


def main() -> int:
    for required_path in (BACKGROUND_PATH, APP_ICON_PATH, APP_SCREEN_PATH):
        if not required_path.exists():
            print(f"Missing required asset: {required_path}", file=sys.stderr)
            return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CAMPAIGN_ASSET_DIR.mkdir(parents=True, exist_ok=True)

    flyer = build_flyer()
    flyer.save(FLYER_PNG_PATH, format="PNG", dpi=(300, 300), optimize=True)
    write_pdf(FLYER_PNG_PATH, FLYER_PDF_PATH)

    preview = build_preview()
    preview.save(PREVIEW_PATH, format="PNG", optimize=True)

    print(FLYER_PNG_PATH)
    print(FLYER_PDF_PATH)
    print(PREVIEW_PATH)
    print(PROMOTION_URL)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
