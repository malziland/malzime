#!/usr/bin/env python3
"""pruefstand-github.py — die Testzahlen eines Commits aus den Protokollen
seiner Jobs bei GitHub lesen. Aufgerufen von `scripts/pruefstand.sh
--aus-github <commit>`; allein aufrufbar zum Nachsehen.

Warum (17.10.2026, Konzept „schnellere Auslieferung“, Schritt 3): Nach dem
Live-Gang fuhr die Auslieferkette `scripts/pruefstand.sh` auf dem Rechner —
die drei Testreihen zum dritten Mal auf demselben Stand, rund 7,5 Minuten
(gemessen bei 5.2.3). GitHub hat sie fuer genau den ausgelieferten Commit
schon gefahren. Gestempelt wird jetzt, was dort gelaufen ist, und der Stempel
nennt den Lauf als Herkunft.

FAIL-CLOSED: Fehlt ein Job, ist er nicht abgeschlossen oder nicht gruen,
gehoert er zu einem anderen Lauf oder Commit, fehlt ein Teil der verteilten
Browser-Tests, ist ein Protokoll nicht abrufbar oder steht die Zeile mit den
Zahlen nicht GENAU EINMAL darin, gibt es keine Zahlen. Nie eine geschaetzte,
nie eine halbe Summe.

Aufruf:  python3 scripts/pruefstand-github.py <commit, volle 40 Zeichen>
Rueckgabe: 0 = Zahlen gelesen (Ausgabe je Zeile NAME=WERT), 1 = ein Job ist
rot, 2 = nicht messbar (laeuft noch, fehlt, unlesbar). Bei 1 und 2 steht der
Grund auf der Fehlerausgabe, auf der Standardausgabe steht dann nichts.

Ausgabe bei 0: LAUF, BACKEND, BACKEND_GESAMT, FRONTEND, FRONTEND_SKIP, E2E,
E2E_SKIP, E2E_TEILE.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
REPO = "malziland/malzime"
BACKEND = "test-backend"
FRONTEND = "test-frontend"
SAMMLER = "test-e2e"
TEIL = re.compile(r"^test-e2e-teil \((\d+)\)$")
# Die Seiten der Schnittstelle: hoechstens 100 Laeufe je Seite. Mehr als zehn
# Seiten an einem Commit gab es nie; dann stimmt etwas nicht.
JE_SEITE = 100
HOECHSTENS_SEITEN = 10

ZEITSTEMPEL = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?")
FARBE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
LAUF_UND_JOB = re.compile(r"/actions/runs/(\d+)/job/(\d+)$")


class NichtMessbar(Exception):
    """Rueckgabewert 2: Es gibt (noch) keine belastbaren Zahlen."""


class Rot(Exception):
    """Rueckgabewert 1: ein Job, aus dem gestempelt wuerde, ist nicht gruen."""


def gh(pfad):
    r = subprocess.run(["gh", "api", pfad], capture_output=True, text=True)
    if r.returncode != 0:
        raise NichtMessbar(f"gh api {pfad} scheiterte (Rueckgabe {r.returncode}): {r.stderr.strip()[:200]}")
    return r.stdout


def alle_laeufe(sha):
    laeufe = []
    for seite in range(1, HOECHSTENS_SEITEN + 1):
        text = gh(f"repos/{REPO}/commits/{sha}/check-runs?per_page={JE_SEITE}&page={seite}")
        try:
            teil = json.loads(text)["check_runs"]
        except (ValueError, KeyError, TypeError) as e:
            raise NichtMessbar(f"Antwort der Schnittstelle (Seite {seite}) nicht lesbar: {e}")
        laeufe.extend(teil)
        if len(teil) < JE_SEITE:
            return laeufe
    raise NichtMessbar(f"mehr als {HOECHSTENS_SEITEN} Seiten Pruefergebnisse an einem Commit")


def juengster_je_name(laeufe):
    """Wie scripts/deploy.sh: je Name der zuletzt gestartete Lauf. Nur GitHub Actions."""
    je = {}
    for lauf in laeufe:
        if (lauf.get("app") or {}).get("slug") != "github-actions":
            continue
        name = lauf.get("name")
        if name not in je or (lauf.get("started_at") or "") > (je[name].get("started_at") or ""):
            je[name] = lauf
    return je


def teile_laut_pipeline(sha):
    """Die Teile der Browser-Tests, wie ci.yml AN DIESEM COMMIT sie festlegt."""
    r = subprocess.run(
        ["git", "show", f"{sha}:.github/workflows/ci.yml"], cwd=WURZEL, capture_output=True, text=True
    )
    if r.returncode != 0:
        raise NichtMessbar(f"ci.yml des Commits {sha[:7]} nicht lesbar (git show)")
    treffer = re.findall(r"(?m)^\s+teil:\s*\[([0-9,\s]+)\]\s*$", r.stdout)
    if len(treffer) != 1:
        raise NichtMessbar(f"die Teile der Browser-Tests stehen nicht genau einmal in ci.yml ({len(treffer)}-mal)")
    teile = [int(t) for t in treffer[0].replace(" ", "").split(",") if t]
    if not teile or teile != list(range(1, len(teile) + 1)):
        raise NichtMessbar(f"die Teile der Browser-Tests in ci.yml sind nicht 1..n: {teile}")
    return teile


def pruefe_lauf(name, lauf, sha):
    if lauf is None:
        raise NichtMessbar(f"{name}: kein Lauf fuer {sha[:7]}")
    if lauf.get("head_sha") != sha:
        raise NichtMessbar(f"{name}: der Lauf gehoert zu {str(lauf.get('head_sha'))[:7]}, nicht zu {sha[:7]}")
    if lauf.get("status") != "completed":
        raise NichtMessbar(f"{name}: laeuft noch ({lauf.get('status')})")
    if lauf.get("conclusion") != "success":
        raise Rot(f"{name}: {lauf.get('conclusion')}")
    m = LAUF_UND_JOB.search(lauf.get("details_url") or "")
    if not m or m.group(2) != str(lauf.get("id")):
        raise NichtMessbar(f"{name}: Lauf und Job nicht lesbar ({lauf.get('details_url')})")
    return m.group(1), m.group(2)


def protokoll(job):
    text = gh(f"repos/{REPO}/actions/jobs/{job}/logs")
    zeilen = [FARBE.sub("", ZEITSTEMPEL.sub("", z)) for z in text.splitlines()]
    if not zeilen:
        raise NichtMessbar(f"Protokoll des Jobs {job} ist leer")
    return zeilen


def genau_eine(zeilen, muster, was):
    treffer = [m for m in (muster.match(z) for z in zeilen) if m]
    if len(treffer) != 1:
        raise NichtMessbar(f"{was}: die Zeile mit den Zahlen steht {len(treffer)}-mal im Protokoll, erwartet genau einmal")
    return treffer[0]


def zahl(text, wort):
    m = re.search(rf"(\d+) {wort}\b", text)
    return int(m.group(1)) if m else 0


def zahlen_jest(zeilen):
    """Jest: `Tests:       1 skipped, 7065 passed, 7066 total`."""
    zeile = genau_eine(zeilen, re.compile(r"^Tests:\s+(.*\d+ total)\s*$"), BACKEND).group(1)
    if zahl(zeile, "failed"):
        raise Rot(f"{BACKEND}: {zeile}")
    bestanden, gesamt = zahl(zeile, "passed"), zahl(zeile, "total")
    if bestanden == 0 or bestanden + zahl(zeile, "skipped") + zahl(zeile, "todo") != gesamt:
        raise NichtMessbar(f"{BACKEND}: Zahlen passen nicht zusammen: {zeile}")
    return bestanden, gesamt


def zahlen_vitest(zeilen):
    """Vitest: `      Tests  1115 passed | 1 skipped (1116)`."""
    m = genau_eine(zeilen, re.compile(r"^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$"), FRONTEND)
    teile, gesamt = m.group(1), int(m.group(2))
    if zahl(teile, "failed"):
        raise Rot(f"{FRONTEND}: {teile}")
    bestanden, uebersprungen = zahl(teile, "passed"), zahl(teile, "skipped") + zahl(teile, "todo")
    if bestanden == 0 or bestanden + uebersprungen != gesamt:
        raise NichtMessbar(f"{FRONTEND}: Zahlen passen nicht zusammen: {m.group(0).strip()}")
    return bestanden, uebersprungen


def zahlen_playwright(zeilen, name):
    """Playwright: `  109 passed (3.7m)`, davor gegebenenfalls `  2 skipped`."""
    bestanden = int(genau_eine(zeilen, re.compile(r"^\s+(\d+) passed \([^)]*\)\s*$"), name).group(1))
    for wort in ("failed", "flaky", "interrupted", "did not run"):
        if any(re.match(rf"^\s+\d+ {wort}\s*$", z) for z in zeilen):
            raise Rot(f"{name}: Tests mit Ergebnis '{wort}'")
    uebersprungen = [int(m.group(1)) for m in (re.match(r"^\s+(\d+) skipped\s*$", z) for z in zeilen) if m]
    if len(uebersprungen) > 1:
        raise NichtMessbar(f"{name}: die Zeile 'skipped' steht {len(uebersprungen)}-mal im Protokoll")
    return bestanden, (uebersprungen[0] if uebersprungen else 0)


def lesen(sha):
    je = juengster_je_name(alle_laeufe(sha))
    teile = teile_laut_pipeline(sha)
    gefunden = sorted(int(TEIL.match(n).group(1)) for n in je if TEIL.match(n))
    if gefunden != teile:
        raise NichtMessbar(f"Teile der Browser-Tests am Commit {gefunden}, laut ci.yml {teile}")
    namen = [BACKEND, FRONTEND, SAMMLER] + [f"test-e2e-teil ({t})" for t in teile]
    jobs = {}
    laeufe = set()
    for name in namen:
        lauf_id, job = pruefe_lauf(name, je.get(name), sha)
        laeufe.add(lauf_id)
        jobs[name] = job
    if len(laeufe) != 1:
        raise NichtMessbar(f"die Jobs stammen aus mehreren Laeufen: {sorted(laeufe)}")
    backend, backend_gesamt = zahlen_jest(protokoll(jobs[BACKEND]))
    frontend, frontend_skip = zahlen_vitest(protokoll(jobs[FRONTEND]))
    e2e = e2e_skip = 0
    for t in teile:
        name = f"test-e2e-teil ({t})"
        b, s = zahlen_playwright(protokoll(jobs[name]), name)
        e2e, e2e_skip = e2e + b, e2e_skip + s
    return {
        "LAUF": laeufe.pop(),
        "BACKEND": backend,
        "BACKEND_GESAMT": backend_gesamt,
        "FRONTEND": frontend,
        "FRONTEND_SKIP": frontend_skip,
        "E2E": e2e,
        "E2E_SKIP": e2e_skip,
        "E2E_TEILE": len(teile),
    }


def main(argv):
    if len(argv) != 2 or not re.fullmatch(r"[0-9a-f]{40}", argv[1]):
        print("Aufruf: python3 scripts/pruefstand-github.py <commit, volle 40 Zeichen>", file=sys.stderr)
        return 2
    try:
        werte = lesen(argv[1])
    except Rot as e:
        print(f"ROT: {e}", file=sys.stderr)
        return 1
    except NichtMessbar as e:
        print(f"NICHT MESSBAR: {e}", file=sys.stderr)
        return 2
    for name, wert in werte.items():
        print(f"{name}={wert}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
