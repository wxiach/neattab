"""用 Pillow 画 NAV 图标：黑底、四条横线代表“索引”，首条为 Windows 蓝。

运行：python tools/make_icons.py
"""
import os
import sys

from PIL import Image, ImageDraw

BLACK = (10, 10, 10, 255)
WHITE = (242, 242, 242, 255)
BLUE = (0, 120, 212, 255)

# 在 128 网格上设计，再按比例缩放
GRID = 128
# (x, y, w, h, color)
BARS = [
    (30, 34, 68, 9, BLUE),
    (30, 51, 68, 9, WHITE),
    (30, 68, 50, 9, WHITE),
    (30, 85, 34, 9, WHITE),
]


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BLACK)
    d = ImageDraw.Draw(img)
    s = size / GRID

    radius = max(2, int(size * 0.22))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    img.putalpha(mask)

    # 大尺寸时线条更细一点，视觉更克制
    for x, y, w, h, color in BARS:
        d.rectangle((x * s, y * s, (x + w) * s - 1, (y + h) * s - 1), fill=color)
    return img


def main() -> None:
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out, f"{size}.png")
        render(size).save(path, "PNG", optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    sys.exit(main())
