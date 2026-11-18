"""Builds sample/sample-paper.zip from sample/sample-paper/ (and draws its figure).

Usage:  python tools/make_sample.py

Standard library only. The figure is a simple three-box pipeline diagram drawn pixel by pixel.
"""
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sample" / "sample-paper"
OUT = ROOT / "sample" / "sample-paper.zip"


def png(width, height, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def draw_figure():
    w, h = 720, 200
    px = [[255] * (w * 3) for _ in range(h)]

    def rect(x0, y0, x1, y1, color, fill=False):
        for y in range(y0, y1):
            for x in range(x0, x1):
                if fill or y in (y0, y0 + 1, y1 - 2, y1 - 1) or x in (x0, x0 + 1, x1 - 2, x1 - 1):
                    px[y][x * 3:x * 3 + 3] = color

    boxes = [(30, (21, 79, 156)), (275, (154, 83, 0)), (520, (29, 122, 75))]
    for x, color in boxes:
        rect(x, 60, x + 170, 140, color)
        rect(x + 20, 85, x + 150, 115, tuple(min(255, c + 150) for c in color), fill=True)
    for x in (200, 445):
        rect(x + 5, 98, x + 70, 102, (90, 90, 90), fill=True)
        for d in range(10):
            rect(x + 60 + d, 90 + d, x + 61 + d, 110 - d, (90, 90, 90), fill=True)
    return png(w, h, px)


def main():
    (SRC / "figures").mkdir(parents=True, exist_ok=True)
    (SRC / "figures" / "overview.png").write_bytes(draw_figure())
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(SRC.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(SRC).as_posix())
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
