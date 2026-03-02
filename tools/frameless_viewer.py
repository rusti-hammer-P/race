#!/usr/bin/env python3
"""
Frameless HTML viewer for borderless 1920x1080 playback.

Features:
- Borderless (frameless) window at exact WxH
- Loads a local file or URL in a Qt WebEngine view
- Optional always-on-top and screen position
- ESC to quit, F to toggle full-screen, Q to quit

Usage examples:
  python tools/frameless_viewer.py --file site/index.html --width 1920  --height 1080 --x 100 --y 100
  python tools/frameless_viewer.py --url http://localhost:8080 --width 1920 --height 1080 --x 0 --y 0 --always-on-top

Notes:
- Requires PyQt5 and PyQtWebEngine.
- On Wayland, set QT_QPA_PLATFORM=wayland for native behavior (optional).
"""

import argparse
import os
import sys
import socket
import threading
from contextlib import closing
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from PyQt5 import QtCore, QtWidgets
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QKeySequence, QCursor
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineSettings, QWebEnginePage


class LoggingPage(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        try:
            level_map = {
                QWebEnginePage.InfoMessageLevel: "INFO",
                QWebEnginePage.WarningMessageLevel: "WARN",
                QWebEnginePage.ErrorMessageLevel: "ERROR",
            }
            lvl = level_map.get(level, str(int(level)))
            src = source_id or "<unknown>"
            print(f"[JS:{lvl}] {src}:{line_number}: {message}")
        except Exception:
            # Never crash the viewer due to logging
            pass


class FramelessWindow(QtWidgets.QMainWindow):
    def __init__(self, url: str, width: int, height: int, x: int | None, y: int | None, always_on_top: bool):
        super().__init__()
        # Remove window frame and set fixed size
        flags = Qt.FramelessWindowHint | Qt.Window
        if always_on_top:
            flags |= Qt.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        self.setFixedSize(width, height)
        if x is not None and y is not None:
            self.move(x, y)

        # Web view
        self.view = QWebEngineView(self)
        self.view.setPage(LoggingPage(self.view))
        self.view.setContextMenuPolicy(QtCore.Qt.NoContextMenu)
        self.setCentralWidget(self.view)
        self.view.load(QtCore.QUrl(url))

        # Keyboard shortcuts
        QtWidgets.QShortcut(QKeySequence("Esc"), self, self.close)
        QtWidgets.QShortcut(QKeySequence("Q"), self, self.close)
        QtWidgets.QShortcut(QKeySequence("F"), self, self.toggle_fullscreen)

    def toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()


def build_url(args: argparse.Namespace) -> str:
    if args.url:
        return args.url
    if args.file:
        # Resolve to file URL
        path = os.path.abspath(args.file)
        return QtCore.QUrl.fromLocalFile(path).toString()
    raise SystemExit("Please provide --file or --url")


def main() -> int:
    parser = argparse.ArgumentParser(description="Frameless HTML viewer")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", help="Path to local HTML file")
    src.add_argument("--url", help="URL to open")
    parser.add_argument("--serve-root", help="Serve files from this directory over http://127.0.0.1 to avoid CORS (use with --file)")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--x", type=int, default=0)
    parser.add_argument("--y", type=int, default=0)
    parser.add_argument("--no-position", action="store_true", help="Don't force window position")
    parser.add_argument("--always-on-top", action="store_true")
    parser.add_argument("--hide-cursor", action="store_true")

    args = parser.parse_args()
    # Optional (now default) lightweight HTTP server to avoid file:// origin CORS
    server_thread = None
    if args.file:
        root = os.path.abspath(args.serve_root or os.getcwd())
        if not os.path.isdir(root):
            raise SystemExit(f"Serve root is not a directory: {root}")

        def _find_free_port() -> int:
            with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
                s.bind(("127.0.0.1", 0))
                return s.getsockname()[1]

        port = _find_free_port()
        handler = partial(SimpleHTTPRequestHandler, directory=root)
        httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
        httpd.daemon_threads = True
        server_thread = threading.Thread(target=httpd.serve_forever, name="LocalHTTP", daemon=True)
        server_thread.start()

        rel = os.path.relpath(os.path.abspath(args.file), root).replace(os.sep, "/")
        url = f"http://127.0.0.1:{port}/{rel}"
    else:
        url = build_url(args)

    # Optional Wayland hint: prefer Wayland if available
    if os.environ.get("XDG_SESSION_TYPE") == "wayland" and not os.environ.get("QT_QPA_PLATFORM"):
        os.environ["QT_QPA_PLATFORM"] = "wayland"

    # Force 1:1 pixel mapping (avoid HiDPI auto scaling)
    os.environ.setdefault("QT_AUTO_SCREEN_SCALE_FACTOR", "0")
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "0")
    os.environ.setdefault("QT_SCALE_FACTOR", "1")

    app = QtWidgets.QApplication(sys.argv)

    # Relax local content access (helps when using file:// with remote CSS/JS)
    QWebEngineSettings.globalSettings().setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
    QWebEngineSettings.globalSettings().setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)

    x = None if args.no_position else args.x
    y = None if args.no_position else args.y

    win = FramelessWindow(url=url, width=args.width, height=args.height, x=x, y=y, always_on_top=args.always_on_top)
    if args.hide_cursor:
        win.setCursor(QCursor(QtCore.Qt.BlankCursor))
    win.show()

    return app.exec_()


if __name__ == "__main__":
    raise SystemExit(main())
