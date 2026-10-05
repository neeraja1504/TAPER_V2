"""Serve TAPER locally and open it in the default browser.

Usage:  python run.py [--port 8000] [--no-browser]

Uses only the Python standard library. Serving over http://localhost (rather
than opening the file directly) gives the page a stable origin, so the study
log it keeps in browser storage survives restarts.
"""
import argparse
import functools
import http.server
import socket
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = "TAPER.html"


def free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 50)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit(f"No free port found near {preferred}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the TAPER reader locally.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    if not (ROOT / PAGE).exists():
        raise SystemExit(f"{PAGE} not found in {ROOT}")

    # Keep the port fixed when possible: browser storage is tied to it.
    port = free_port(args.port)
    if port != args.port:
        print(f"Port {args.port} is busy; using {port}. The study log from the other port won't show here.")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    url = f"http://localhost:{port}/{PAGE}"
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"TAPER is running at {url}\nPress Ctrl+C to stop.")
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
