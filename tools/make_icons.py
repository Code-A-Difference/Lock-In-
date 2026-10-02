"""Draw LOCK IN!'s app icons from the favicon's design (public/favicon.svg).

    python tools/make_icons.py

Writes:
  public/icons/*.png         the web app's install icons (any + maskable) and
                             the iPhone home-screen icon
  assets/*.png               1024px sources that `npx capacitor-assets
                             generate` turns into every Android/iOS size

Drawn with Pillow at 4x and scaled down, so edges stay smooth. The icons are
full-bleed squares: phones apply their own rounded mask.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
A, B = (79, 70, 229), (192, 38, 211)          # indigo-600 -> fuchsia-600
DARK = (15, 23, 42)                            # slate-900


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))
    return img


def lock(img, scale, cx=None, cy=None):
    """The padlock from favicon.svg (a 64-unit grid), `scale` px per unit, in
    white, with the keyhole cut through to the background. Drawn as a mask so
    the shackle joins the body cleanly."""
    size = img.size[0]
    u = scale
    cx = size / 2 if cx is None else cx
    cy = size / 2 if cy is None else cy
    ox, oy = cx - 32 * u, cy - 37 * u          # the glyph's visual centre sits at (32, 37)
    P = lambda x, y: (ox + x * u, oy + y * u)
    m = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([P(20.5, 11.5), P(43.5, 33)], radius=11.5 * u, fill=255)   # shackle, outer
    d.rounded_rectangle([P(25.5, 16.5), P(38.5, 33)], radius=6.5 * u, fill=0)      # shackle, inner
    d.rounded_rectangle([P(17, 29), P(47, 51)], radius=5 * u, fill=255)            # body
    d.ellipse([P(28.8, 35.8), P(35.2, 42.2)], fill=0)                              # keyhole
    d.rounded_rectangle([P(30.6, 40), P(33.4, 46)], radius=1.4 * u, fill=0)
    img.paste((255, 255, 255, 255) if img.mode == "RGBA" else (255, 255, 255), (0, 0), m)


def icon(size, glyph=0.62, background=True):
    big = size * 4
    img = gradient(big) if background else Image.new("RGBA", (big, big), (0, 0, 0, 0))
    lock(img, big * glyph / 64)
    return img.resize((size, size), Image.LANCZOS)


def splash(size, dark=False):
    big = size * 2
    img = Image.new("RGB", (big, big), DARK if dark else (255, 255, 255))
    d = ImageDraw.Draw(img)
    tile = big * 0.18
    t = gradient(round(tile * 4)).resize((round(tile), round(tile)), Image.LANCZOS)
    mask = Image.new("L", t.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, t.size[0] - 1, t.size[1] - 1], radius=tile * 0.23, fill=255)
    img.paste(t, (round(big / 2 - tile / 2), round(big / 2 - tile / 2)), mask)
    lock(img, tile * 0.62 / 64)
    return img.resize((size, size), Image.LANCZOS)


def main():
    web = ROOT / "public" / "icons"
    web.mkdir(parents=True, exist_ok=True)
    for s in (192, 512):
        icon(s).save(web / f"icon-{s}.png")
        icon(s, glyph=0.48).save(web / f"maskable-{s}.png")     # inside the 80% safe zone
    icon(180).save(web / "apple-touch-icon.png")

    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)
    icon(1024).save(assets / "icon-only.png")
    icon(1024, glyph=0.42, background=False).save(assets / "icon-foreground.png")
    gradient(1024).save(assets / "icon-background.png")
    splash(2732).save(assets / "splash.png")
    splash(2732, dark=True).save(assets / "splash-dark.png")
    print("icons written")


if __name__ == "__main__":
    main()
