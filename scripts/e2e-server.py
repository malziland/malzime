#!/usr/bin/env python3
"""Testserver fuer die Browser-Tests (playwright.config.js, webServer).

Liefert public/ aus — MIT den Kopfzeilen, die Firebase Hosting in der
Produktion fuer alle Seiten setzt (firebase.json, Eintrag "source": "**"),
allen voran der Sicherheitsrichtlinie (Content-Security-Policy).

WARUM (Befund G-19, 30.09.2026): Vorher lief der Testserver ohne jede
Kopfzeile. Eine Aenderung, die an der Richtlinie scheitert — etwa ein neuer
HEIC-Dekoder, der eval braucht, oder ein Inline-Stil —, waere in allen
Browser-Tests gruen gewesen und erst auf der echten Seite aufgefallen.
Die Kopfzeilen werden aus firebase.json GELESEN, nicht abgeschrieben: Eine
Kopie hier wuerde still auseinanderlaufen.

Mehrspurig und mit Warteschlange 128 wie zuvor (OPS-2026-08-21-04,
16.09.2026 — Begruendung in playwright.config.js).
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8081

try:
    with open(os.path.join(WURZEL, "firebase.json"), encoding="utf-8") as datei:
        EINTRAEGE = json.load(datei)["hosting"]["headers"]
except (OSError, KeyError, ValueError) as fehler:
    print(f"FEHLER: firebase.json nicht lesbar ({fehler}) — ohne Kopfzeilen kein Testserver.", file=sys.stderr)
    sys.exit(2)

KOPFZEILEN = next((e["headers"] for e in EINTRAEGE if e.get("source") == "**"), None)
if not KOPFZEILEN or not any(k["key"] == "Content-Security-Policy" for k in KOPFZEILEN):
    print("FEHLER: firebase.json hat fuer \"**\" keine Content-Security-Policy.", file=sys.stderr)
    sys.exit(2)


class MitKopfzeilen(SimpleHTTPRequestHandler):
    def end_headers(self):
        for eintrag in KOPFZEILEN:
            self.send_header(eintrag["key"], eintrag["value"])
        super().end_headers()


os.chdir(os.path.join(WURZEL, "public"))
ThreadingHTTPServer.request_queue_size = 128
ThreadingHTTPServer(("", PORT), MitKopfzeilen).serve_forever()
