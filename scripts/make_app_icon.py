"""Generates the Kairo app icon source (1024x1024): midnight background,
blue->violet gradient tile, white monogram K. Output feeds `tauri icon`."""

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024

MIDNIGHT_TOP = (11, 16, 32)      # #0B1020
MIDNIGHT_BOTTOM = (18, 27, 58)   # subtle depth at the bottom
BLUE = (37, 99, 235)             # #2563EB
VIOLET = (139, 92, 246)          # #8B5CF6


def lerp(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def main() -> None:
    img = Image.new("RGB", (SIZE, SIZE))

    d = ImageDraw.Draw(img)
    for y in range(SIZE):
        d.line([(0, y), (SIZE, y)], fill=lerp(MIDNIGHT_TOP, MIDNIGHT_BOTTOM, y / SIZE))

    # Gradient tile, centered.
    tile = Image.new("RGBA", (640, 640))
    td = ImageDraw.Draw(tile)
    for y in range(640):
        td.line([(0, y), (640, y)], fill=lerp(BLUE, VIOLET, y / 640) + (255,))
    mask = Image.new("L", (640, 640), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 639, 639], radius=150, fill=255)
    img.paste(tile, (192, 192), mask)

    # Monogram K.
    font = None
    for path in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\seguisb.ttf",
    ):
        try:
            font = ImageFont.truetype(path, 430)
            break
        except OSError:
            continue
    if font is not None:
        d.text((512, 512), "K", font=font, fill="white", anchor="mm")
    else:  # Geometric fallback so the icon never depends on system fonts.
        white = (255, 255, 255)
        d.rectangle([400, 330, 490, 694], fill=white)
        d.polygon([(520, 330), (620, 330), (500, 512), (400, 512)], fill=white)
        d.polygon([(400, 512), (500, 512), (620, 694), (520, 694)], fill=white)

    img.save("scripts/app-icon.png")
    print("wrote scripts/app-icon.png")


if __name__ == "__main__":
    main()
