#!/usr/bin/env python3
"""Generate optimized brand derivatives for the Kairo app (v4).

Reads the original assets in `brand/` and writes web-optimized PNG/JPEG
derivatives into `public/brand/` plus the 1024px Tauri icon source at
`scripts/app-icon-source.png`. Run again whenever the brand originals change;
never hand-edit the generated files.

Requires Pillow:  python scripts/process_brand.py
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
OUT = ROOT / "public" / "brand"
ICON_SOURCE = ROOT / "scripts" / "app-icon-source.png"

# (source file, [(output name, width)]) — icon tiles are emitted as rounded
# squares with transparent corners so they sit cleanly on any surface.
SQUARE_MARKS = [
    ("app-icon-dark-glow.png", [("mark-256.png", 256), ("mark-128.png", 128), ("mark-64.png", 64)]),
    ("app-icon-light.png", [("mark-light-256.png", 256), ("mark-light-128.png", 128), ("mark-light-64.png", 64)]),
]

LOCKUPS = [
    ("lockup-horizontal-light.png", [("lockup-horizontal-light-800.png", 800), ("lockup-horizontal-light-400.png", 400)]),
    ("lockup-horizontal-dark.png", [("lockup-horizontal-dark-800.png", 800), ("lockup-horizontal-dark-400.png", 400)]),
    ("lockup-vertical-light.png", [("lockup-vertical-light-800.png", 800)]),
    ("lockup-vertical-dark-night.png", [("lockup-vertical-dark-night-800.png", 800)]),
]

BANNERS = [
    ("banner-waves.png", [("banner-waves-1600.jpg", 1600), ("banner-waves-800.jpg", 800)]),
]


def resize_width(img: Image.Image, width: int) -> Image.Image:
    if img.width <= width:
        return img.copy()
    height = round(img.height * width / img.width)
    return img.resize((width, height), Image.LANCZOS)


def trim_background(img: Image.Image, threshold: int = 8) -> Image.Image:
    """Crop away the uniform background border around the tile artwork."""
    bg_color = img.getpixel((2, 2))
    bg = Image.new("RGBA", img.size, bg_color)
    diff = ImageChops.difference(img, bg).convert("L").point(lambda p: 255 if p > threshold else 0)
    bbox = diff.getbbox()
    return img.crop(bbox) if bbox else img


def rounded_tile(src_path: Path, size: int, radius_ratio: float = 0.225) -> Image.Image:
    img = trim_background(Image.open(src_path).convert("RGBA"))
    side = min(img.size)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(size * radius_ratio), fill=255
    )
    img.putalpha(mask)
    return img


def write_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  ({path.stat().st_size // 1024} KB)")


def write_jpeg(img: Image.Image, path: Path, quality: int = 85) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    print(f"  {path.relative_to(ROOT)}  ({path.stat().st_size // 1024} KB)")


def main() -> None:
    for name, targets in SQUARE_MARKS:
        for out_name, width in targets:
            write_png(rounded_tile(BRAND / name, width), OUT / out_name)

    for name, targets in LOCKUPS:
        src = Image.open(BRAND / name).convert("RGBA")
        for out_name, width in targets:
            write_png(resize_width(src, width), OUT / out_name)

    for name, targets in BANNERS:
        src = Image.open(BRAND / name).convert("RGBA")
        for out_name, width in targets:
            write_jpeg(resize_width(src, width), OUT / out_name)


    # Favicon: PNG for the modern path + a multi-size .ico for shortcuts.
    write_png(rounded_tile(BRAND / "app-icon-dark-glow.png", 64), OUT / "favicon.png")
    ico_path = OUT / "favicon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    rounded_tile(BRAND / "app-icon-dark-glow.png", 64).save(
        ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"  {ico_path.relative_to(ROOT)}  ({ico_path.stat().st_size // 1024} KB)")

    # Tauri icon source: the full-bleed square artwork at exactly 1024x1024
    # (rounded corners stay baked in; tauri icon requires >= 1024).
    source = Image.open(BRAND / "app-icon-dark-glow.png").convert("RGBA")
    source = source.resize((1024, 1024), Image.LANCZOS)
    ICON_SOURCE.parent.mkdir(parents=True, exist_ok=True)
    source.save(ICON_SOURCE, "PNG", optimize=True)
    print(f"  {ICON_SOURCE.relative_to(ROOT)}  ({ICON_SOURCE.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
