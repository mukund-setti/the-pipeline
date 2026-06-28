"""Generate public/og.png, a 1200x630 "Blueprint & Signal" (brutalist) card.

Uses the real brand fonts (converting @fontsource .woff to TTF) and the
rendered pipe logo (scripts/_shots/oglogo.png).
"""
import os
import tempfile
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FS = os.path.join(ROOT, "node_modules", "@fontsource")
TMP = tempfile.mkdtemp()

PAPER = (245, 243, 238)
INK = (17, 17, 17)
SIGNAL = (255, 42, 42)
MUTED = (102, 102, 102)

W, H = 1200, 630
PAD = 76


def font(pkg, fname, size):
    src = os.path.join(FS, pkg, "files", fname)
    out = os.path.join(TMP, fname.replace(".woff", ".ttf"))
    if not os.path.exists(out):
        f = TTFont(src)
        f.flavor = None
        f.save(out)
    return ImageFont.truetype(out, size)


BRI = lambda s: font("bricolage-grotesque", "bricolage-grotesque-latin-800-normal.woff", s)
INTER = lambda s: font("inter", "inter-latin-400-normal.woff", s)
MONO = lambda s: font("jetbrains-mono", "jetbrains-mono-latin-500-normal.woff", s)
MONO_B = lambda s: font("jetbrains-mono", "jetbrains-mono-latin-700-normal.woff", s)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img, "RGBA")

# Structural grid, 56px module.
for x in range(0, W, 56):
    d.line([(x, 0), (x, H)], fill=(17, 17, 17, 16), width=1)
for y in range(0, H, 56):
    d.line([(0, y), (W, y)], fill=(17, 17, 17, 16), width=1)

# Top bar (ink) + thin red signal line under it.
d.rectangle([0, 0, W, 8], fill=INK)
d.rectangle([0, 8, W, 10], fill=SIGNAL)

# Logo + wordmark
try:
    logo = Image.open(os.path.join(ROOT, "scripts", "_shots", "oglogo.png")).convert("RGBA")
    logo = logo.resize((74, 74), Image.LANCZOS)
    img.paste(logo, (PAD, 56), logo)
    d = ImageDraw.Draw(img, "RGBA")
except FileNotFoundError:
    d.rectangle([PAD, 56, PAD + 74, 130], fill=INK)
d.text((PAD + 90, 93), "The Pipeline", font=BRI(30), fill=INK, anchor="lm")

# Thesis
big = BRI(92)
ty = 196
d.text((PAD, ty), "The talent was", font=big, fill=INK)
y2 = ty + 106
x = PAD
for txt, col in [("never", SIGNAL), (" the problem.", INK)]:
    d.text((x, y2), txt, font=big, fill=col)
    x += d.textlength(txt, font=big)

# Subhead
sub = INTER(29)
sy = y2 + 150
d.text((PAD, sy), "A fellow-run community at UC Irvine handing gatekept access", font=sub, fill=MUTED)
d.text((PAD, sy + 41), "to the undergrads who have been locked out of it.", font=sub, fill=MUTED)


def dotted_row(draw, x, y, segments, gap=18):
    cur = x
    for i, (txt, fnt, col) in enumerate(segments):
        draw.text((cur, y), txt, font=fnt, fill=col, anchor="lm")
        cur += draw.textlength(txt, font=fnt)
        if i < len(segments) - 1:
            cur += gap
            draw.rectangle([cur, y - 2, cur + 4, y + 2], fill=INK)
            cur += 4 + gap


by = H - 54
fm = MONO(22)
dotted_row(
    d, PAD, by,
    [("UC IRVINE", fm, MUTED), ("UNDERGRAD FELLOWSHIP", fm, MUTED), ("EST. 2026", fm, MUTED)],
)

# Bottom-right CTA, red, with a drawn arrow.
fmj = MONO_B(22)
jt = "JOIN THE PIPELINE"
jw = d.textlength(jt, font=fmj)
arrow_w = 26
d.text((W - PAD - jw - arrow_w, by), jt, font=fmj, fill=SIGNAL, anchor="lm")
ax0 = W - PAD - arrow_w + 4
d.line([(ax0, by), (ax0 + 16, by)], fill=SIGNAL, width=3)
d.line([(ax0 + 10, by - 6), (ax0 + 16, by), (ax0 + 10, by + 6)], fill=SIGNAL, width=3, joint="curve")

img.save(os.path.join(ROOT, "public", "og.png"))
print("saved public/og.png", img.size)
