"""Serve TAPER locally, and compile LaTeX for it.

Usage:
    python run.py                    serve the app at http://localhost:8000 and open the browser
    python run.py --cors             also let the GitHub Pages site use this computer's LaTeX
    python run.py --port 8001 --no-browser
    python run.py --tex-path ~/bin   extra folder to look for latexmk / xelatex / tectonic

Standard library only. Endpoints (localhost only):
    GET  /api/health    {"taper": 2, "engines": [...]}
    POST /api/compile   {"main": "main.tex", "engine": "xelatex"|"pdflatex", "files": {path: base64}}
                        -> {"ok": true, "pdf": base64, "log": "...", "engine": "..."}

Compilers, in order of preference: latexmk (with xelatex / pdflatex from MacTeX or TeX Live),
then Tectonic, then plain xelatex / pdflatex. Shell escape is never enabled.
"""
import argparse
import base64
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
PAGE = "index.html"
MAX_BODY = 300 * 1024 * 1024
TIMEOUT = 420
EXTRA_DIRS = ["/Library/TeX/texbin", "/usr/local/texlive/2026/bin/universal-darwin", "/usr/local/texlive/2025/bin/universal-darwin",
              "/usr/local/texlive/2026/bin/x86_64-linux", "/usr/local/texlive/2025/bin/x86_64-linux",
              "/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".cargo" / "bin"), str(Path.home() / "bin")]


def find_tools(extra=None):
    path = os.pathsep.join([*(extra or []), os.environ.get("PATH", ""), *EXTRA_DIRS])
    return {name: shutil.which(name, path=path) for name in ("latexmk", "xelatex", "pdflatex", "bibtex", "biber", "tectonic")}


def engines(tools):
    out = []
    if tools["latexmk"] and tools["xelatex"]:
        out.append("latexmk")
    if tools["tectonic"]:
        out.append("tectonic")
    if tools["xelatex"] and "latexmk" not in out:
        out.append("xelatex")
    return out


def safe_path(base: Path, rel: str) -> Path:
    p = PurePosixPath(rel.replace("\\", "/"))
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"Unsafe path in project: {rel}")
    return base.joinpath(*p.parts)


def compile_project(payload, tools):
    main = payload.get("main") or "main.tex"
    engine = payload.get("engine") if payload.get("engine") in ("xelatex", "pdflatex") else "xelatex"
    files = payload.get("files") or {}
    avail = engines(tools)
    if not avail:
        return {"ok": False, "error": "No LaTeX found on this computer. Install MacTeX / TeX Live, or Tectonic (brew install tectonic).", "log": ""}
    with tempfile.TemporaryDirectory(prefix="taper-") as tmp:
        base = Path(tmp)
        for rel, b64 in files.items():
            dest = safe_path(base, rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(base64.b64decode(b64))
        main_path = safe_path(base, main)
        if not main_path.exists():
            return {"ok": False, "error": f"Main file {main} is missing.", "log": ""}
        cwd, name = main_path.parent, main_path.name
        stem = main_path.stem
        env = dict(os.environ, PATH=os.pathsep.join([str(Path(t).parent) for t in tools.values() if t] + [os.environ.get("PATH", "")]))
        attempts = []
        if "latexmk" in avail and (engine == "xelatex" or tools["pdflatex"]):
            attempts.append(("latexmk " + engine, [tools["latexmk"], "-xelatex" if engine == "xelatex" else "-pdf", "-interaction=nonstopmode",
                                                    "-file-line-error", "-f", name]))
        if "tectonic" in avail:
            attempts.append(("tectonic", [tools["tectonic"], "--keep-logs", "--keep-intermediates", name]))
        if not attempts and tools["xelatex"]:
            attempts.append(("xelatex", None))
        log = ""
        for label, cmd in attempts:
            try:
                if cmd is None:
                    log = run_plain(tools, engine, name, stem, cwd, env)
                else:
                    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, timeout=TIMEOUT)
                    log = (r.stdout + r.stderr).decode("utf-8", "replace")
            except subprocess.TimeoutExpired:
                log += f"\n[{label}] timed out after {TIMEOUT} s"
                continue
            tex_log = cwd / f"{stem}.log"
            if tex_log.exists():
                log = tex_log.read_text("utf-8", "replace") + "\n" + log[-4000:]
            pdf = cwd / f"{stem}.pdf"
            if pdf.exists() and pdf.stat().st_size > 0:
                return {"ok": True, "pdf": base64.b64encode(pdf.read_bytes()).decode(), "log": log[-200000:], "engine": label}
        return {"ok": False, "error": "LaTeX compilation failed. See the log.", "log": log[-200000:]}


def run_plain(tools, engine, name, stem, cwd, env):
    exe = tools["xelatex"] if engine == "xelatex" else (tools["pdflatex"] or tools["xelatex"])
    out = b""
    run = lambda cmd: subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, timeout=TIMEOUT).stdout
    out += run([exe, "-interaction=nonstopmode", name])
    if tools["bibtex"] and (cwd / f"{stem}.aux").exists() and b"\\bibdata" in (cwd / f"{stem}.aux").read_bytes() and not (cwd / f"{stem}.bbl").exists():
        out += run([tools["bibtex"], stem])
    out += run([exe, "-interaction=nonstopmode", name])
    out += run([exe, "-interaction=nonstopmode", name])
    return out.decode("utf-8", "replace")


class Handler(http.server.SimpleHTTPRequestHandler):
    cors = False
    tools = {}

    def end_headers(self):
        if self.cors and self.path.startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        if self.path.endswith((".js", ".mjs")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        if str(path).endswith((".js", ".mjs")):
            return "text/javascript"
        if str(path).endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)

    def json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(405)

    def do_GET(self):
        if self.path == "/api/health":
            return self.json(200, {"taper": 2, "engines": engines(self.tools)})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/compile":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self.json(413, {"ok": False, "error": "The project is too large (limit 300 MB)."})
        try:
            payload = json.loads(self.rfile.read(n))
            result = compile_project(payload, self.tools)
        except ValueError as e:
            result = {"ok": False, "error": str(e), "log": ""}
        except Exception as e:  # report, don't crash the server
            result = {"ok": False, "error": f"Helper error: {e}", "log": ""}
        print(f"  compile {payload.get('main', '?') if isinstance(payload, dict) else '?'}: {'ok via ' + result.get('engine', '') if result.get('ok') else 'failed'}")
        self.json(200, result)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)


def free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 50)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit(f"No free port found near {preferred}.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve TAPER locally and compile LaTeX for it.")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--cors", action="store_true", help="allow the GitHub Pages site to call this helper")
    ap.add_argument("--tex-path", action="append", default=[], help="extra folder containing latexmk/xelatex/tectonic")
    args = ap.parse_args()

    Handler.cors = args.cors
    Handler.tools = find_tools([os.path.expanduser(p) for p in args.tex_path])
    port = free_port(args.port)
    if port != args.port:
        print(f"Port {args.port} is busy; using {port}. Your library is stored per address, so keep using one port.")
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://localhost:{port}/{PAGE}"
    found = engines(Handler.tools)
    print(f"TAPER is running at {url}")
    print(f"LaTeX: {', '.join(found) if found else 'none found (PDFs will be compiled in the browser instead)'}")
    if args.cors:
        print(f"Helper open to other sites: in the GitHub Pages version, set Settings > Local helper address to http://localhost:{port}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
