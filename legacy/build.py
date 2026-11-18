"""Build the claude.ai Artifact version of TAPER.

Usage:  python build.py

TAPER.html is the source of truth and is a complete HTML document so it runs
locally. claude.ai Artifacts wrap the page in their own <html>/<head>/<body>
skeleton, so this script strips that wrapper and writes dist/TAPER.artifact.html,
which is the file to publish.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "TAPER.html"
OUT = ROOT / "dist" / "TAPER.artifact.html"


def strip_wrapper(html: str) -> str:
    patterns = [
        r"<!doctype html>\s*",
        r"<html[^>]*>\s*",
        r"<head>\s*",
        r'<meta charset="utf-8">\s*',
        r'<meta name="viewport"[^>]*>\s*',
        r"</head>\s*",
        r"<body>\s*",
        r"</body>\s*",
        r"</html>\s*",
    ]
    for p in patterns:
        html = re.sub(p, "", html, count=1, flags=re.IGNORECASE)
    return html.strip() + "\n"


def main() -> None:
    html = SRC.read_text(encoding="utf-8")
    out = strip_wrapper(html)
    if not out.startswith("<title>"):
        raise SystemExit("Expected the page to start with <title> after stripping; check TAPER.html's head.")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(out.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
