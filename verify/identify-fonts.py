#!/usr/bin/env python3
"""Identify which font a font-family stack actually resolved to.

Takes the screenshot of references.html, slices its nine 64px bands, and reports
which single-family reference each stack matches. Comparison is tolerant to a few
pixels of shift, because the bands do not share a baseline.

    msedge --headless=new --force-device-scale-factor=3 \
        --screenshot=ref.png --window-size=820,580 references.html
    python identify-fonts.py ref.png

Needs Pillow. Writes <ref>.sheet.png next to the input.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

# Must match references.html: band order, 64 CSS px per band, 3x device scale.
SCALE = 3
BAND = 64 * SCALE
NAMES = ["ref-yahei", "ref-yugoth", "ref-meiryo", "ref-msgothic", "ref-bizud",
         "before-text", "after-text", "before-code", "after-code"]
REFS = NAMES[:5]
PRETTY = {
    "ref-yahei": "Microsoft YaHei", "ref-yugoth": "Yu Gothic UI", "ref-meiryo": "Meiryo",
    "ref-msgothic": "MS Gothic", "ref-bizud": "BIZ UDGothic",
}
INK = 200      # grey level below which a pixel counts as ink
SHIFT = 6      # search radius for alignment, in screenshot pixels


def ink_mask(image):
    return image.convert("L").point(lambda v: 255 if v < INK else 0)


def ink_box(image):
    return ink_mask(image).getbbox()


def crop_run(image, box):
    pad = SHIFT + 2
    return image.crop((box[0] - pad, max(0, box[1] - pad), box[2] + pad, min(image.height, box[3] + pad)))


def diff(a, b):
    """Fraction of union-ink pixels that differ, minimised over integer shifts of b."""
    mask = ink_mask(a)
    best = 1.0
    for dy in range(-SHIFT, SHIFT + 1):
        for dx in range(-SHIFT, SHIFT + 1):
            shifted = Image.new("L", a.size, 0)
            shifted.paste(ink_mask(b), (dx, dy))
            delta = ImageChops.difference(mask, shifted)
            union = ImageChops.lighter(mask, shifted)
            differing = sum(delta.histogram()[128:])
            total = sum(union.histogram()[128:])
            if total:
                best = min(best, differing / total)
    return best


def label_font(size):
    for path in ("C:/Windows/Fonts/consola.ttf", "/System/Library/Fonts/Menlo.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main(argv):
    if len(argv) != 2:
        sys.exit(f"usage: {Path(argv[0]).name} <screenshot.png>")
    source = Path(argv[1])
    sheet_path = source.with_suffix(".sheet.png")

    shot = Image.open(source).convert("RGB")
    if shot.height < BAND * len(NAMES):
        sys.exit(f"{source.name}: expected at least {BAND * len(NAMES)}px tall at {SCALE}x, got {shot.height}px")

    runs = {}
    for index, name in enumerate(NAMES):
        band = shot.crop((0, index * BAND, shot.width, (index + 1) * BAND))
        box = ink_box(band)
        if box is None:
            sys.exit(f"{source.name}: band {index} ({name}) is blank — is the page rendered?")
        runs[name] = crop_run(band, box)

    print(f"{source.name}: {shot.width}x{shot.height}, {len(NAMES)} bands\n")
    verdict = {}
    for target in NAMES[5:]:
        scores = sorted((diff(runs[target], runs[ref]), ref) for ref in REFS)
        verdict[target] = scores[0][1]
        runner_up = scores[1]
        print(f"{target:12s} -> {PRETTY[scores[0][1]]:16s} {scores[0][0]:5.1%}"
              f"   (next: {PRETTY[runner_up[1]]} {runner_up[0]:.1%})")

    row_h, label_w = 104, 340
    width = max(r.width for r in runs.values())
    sheet = Image.new("RGB", (label_w + width + 32, row_h * (len(REFS) + len(NAMES[5:])) + 16), "white")
    draw = ImageDraw.Draw(sheet)
    heading, sub = label_font(22), label_font(17)

    rows = [(ref, PRETTY[ref], "#0f1115", "reference") for ref in REFS]
    rows += [(key, key.replace("-", " "), "#b4232a" if key.startswith("before") else "#17683a",
              f"-> {PRETTY[verdict[key]]}") for key in NAMES[5:]]

    for index, (key, title, color, note) in enumerate(rows):
        y = 8 + index * row_h
        if index:
            draw.line([(0, y), (sheet.width, y)], fill="#e8eaed")
        run = runs[key]
        sheet.paste(run, (label_w, y + (row_h - run.height) // 2 + 8))
        draw.text((16, y + 24), title, font=heading, fill=color)
        draw.text((16, y + 54), note, font=sub, fill="#61666b")
        draw.line([(label_w - 16, y + 8), (label_w - 16, y + row_h - 8)], fill="#e8eaed")

    sheet.save(sheet_path)
    print(f"\nwrote {sheet_path}")


if __name__ == "__main__":
    main(sys.argv)
