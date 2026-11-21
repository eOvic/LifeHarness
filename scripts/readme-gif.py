#!/usr/bin/env python3
"""docs/assets/tour.gif: a short tour for the README, made from the README screenshots in docs/assets
(invented demo data only: scripts/readme-shots.ts). Run it after those change:
    python3 scripts/readme-gif.py
Needs Pillow."""
import os

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(__file__), "..", "docs", "assets")
STEPS = [  # (screenshot, caption, seconds shown)
    ("interview.png", "1  Interview: one question at a time", 2.6),
    ("desktop-session.png", "2  Plan: a week built around your real life", 3.0),
    ("today.png", "3  Today: mark each block done, half or skipped", 2.6),
    ("desktop-week.png", "4  Week: everything in one calendar", 3.0),
]
W, H, BAR = 960, 600, 44  # frame, screenshot area, caption bar below it
BG, INK, ACCENT = (20, 20, 20), (231, 229, 225), (226, 178, 74)  # the Default theme
FADE = 6  # frames per crossfade


def font(size):
    for f in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def frame(name, caption):
    shot = Image.open(os.path.join(ASSETS, name)).convert("RGB")
    shot.thumbnail((W, H), Image.LANCZOS)
    out = Image.new("RGB", (W, H + BAR), BG)
    out.paste(shot, ((W - shot.width) // 2, (H - shot.height) // 2))
    d = ImageDraw.Draw(out)
    d.rectangle([0, H, W, H + BAR], fill=BG)
    d.rectangle([0, H, W, H + 2], fill=ACCENT)
    num, _, text = caption.partition("  ")
    f = font(19)
    d.text((24, H + 12), num, font=f, fill=ACCENT)
    d.text((52, H + 12), text, font=f, fill=INK)
    return out


stills = [(frame(n, c), s) for n, c, s in STEPS]
frames, durations = [], []
for i, (img, secs) in enumerate(stills):
    frames.append(img)
    durations.append(int(secs * 1000))
    nxt = stills[(i + 1) % len(stills)][0]
    for k in range(1, FADE):
        frames.append(Image.blend(img, nxt, k / FADE))
        durations.append(70)

# One shared palette for every frame: no colour flicker between screens.
palette = Image.new("RGB", (W, (H + BAR) * len(stills)))
for i, (img, _) in enumerate(stills):
    palette.paste(img, (0, i * (H + BAR)))
pal = palette.quantize(colors=255, method=Image.MEDIANCUT)
out = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
path = os.path.join(ASSETS, "tour.gif")
out[0].save(path, save_all=True, append_images=out[1:], duration=durations, loop=0, optimize=True)
print(f"{path}: {len(out)} frames, {os.path.getsize(path) // 1024} KB")
