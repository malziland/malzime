#!/usr/bin/env bash
# libheif-bauen.sh — baut den HEIC-Dekoder (libheif + libde265) als WebAssembly
# aus den Original-Quellen der Hersteller.
#
# WARUM SELBST BAUEN (30.09.2026, Befund OSS-2026-09-30-01): Bis dahin kam der
# Dekoder als fertiges Paket eines Dritten (npm libheif-js 1.23.2). Darin steckten
# libheif 1.23.2 und libde265 1.0.15, fuer die es veroeffentlichte
# Sicherheitsmeldungen der Hersteller gibt (welche und wie viele, zeigt
# scripts/pruefe-fremd-meldungen.mjs; die Zahl aendert sich mit jeder Meldung).
# Die reparierten Fassungen gab es beim Hersteller, im fertigen Paket nicht: Das
# Bauskript von libheif stellt libde265 1.0.15 ein, und der Zulieferer hat diese
# Einstellung nie geaendert. Mit dem eigenen Bau bestimmen wir beide Versionen
# selbst.
#
# WAS HIER GEBAUT WIRD — und was nicht:
#   · libheif (LGPL-3.0) und libde265 (LGPL-3.0), sonst nichts. Das Hersteller-
#     skript kann weitere Codecs einbinden (AOM, OpenJPEG, WebCodecs); die bleiben
#     aus, wie beim bisherigen Paket. Die Lizenzlage aendert sich damit nicht.
#   · Gebaut wird mit dem UNVERAENDERTEN Skript des Herstellers
#     (build-emscripten.sh aus dem libheif-Quellpaket) und derselben
#     Emscripten-Version, mit der der Hersteller selbst testet (3.1.61).
#   · Eine Abweichung ist noetig und steht hier offen: Das Herstellerskript baut
#     libde265 mit autotools. libde265 hat autotools ab 1.1 abgeschafft und baut
#     nur noch mit cmake. Deshalb bauen wir libde265 vorab mit cmake und legen
#     das Ergebnis dort ab, wo das Herstellerskript es erwartet. Dann ueberspringt
#     es seinen eigenen libde265-Schritt (dort: "if [ ! -s ...libde265.a ]").
#     Dass wirklich die neue libde265 im Ergebnis steckt, prueft dieses Skript am
#     Ende selbst.
#
# Aufruf:
#   scripts/libheif-bauen.sh <zielordner>                 neuer Bau
#   scripts/libheif-bauen.sh <zielordner> --kontrollbau   baut die BISHERIGE
#       Fassung (libheif 1.23.2 + libde265 1.0.15) auf dem Weg des bisherigen
#       Zulieferers und vergleicht das Ergebnis mit der bisher ausgelieferten
#       Datei. Stimmt es Byte fuer Byte, ist belegt: Dieser Bauweg liefert dasselbe
#       wie das fertige Paket — der neue Bau unterscheidet sich nur durch die
#       reparierten Quellen.
#
# Laeuft auf Linux (GitHub-Workflow .github/workflows/libheif-bau.yml). Braucht
# curl, git, python3, cmake, make; fuer --kontrollbau zusaetzlich autoconf,
# automake und libtool.
#
# Rueckgabewerte: 0 gebaut und geprueft, 1 Bau oder Pruefung gescheitert,
# 2 Aufruf falsch.

set -euo pipefail

# ── Festgenagelte Quellen ────────────────────────────────────────────────────
# Jede Quelle mit Pruefsumme. Die Werte fuer libheif und libde265 1.1.3 stimmen
# mit den Pruefsummen ueberein, die GitHub auf den Release-Seiten der Hersteller
# anzeigt (abgeglichen am 30.09.2026). libde265 1.0.15 nennt dort keine; sie wird
# nur fuer den Kontrollbau gebraucht.
EMSDK_VERSION="3.1.61"
EMSDK_COMMIT="ca7b40ae222a2d8763b6ac845388744b0e57cfb7" # Tag 3.1.61 im emsdk-Repository

NEU_LIBHEIF_VERSION="1.23.5"
NEU_LIBHEIF_SHA256="fd9036064c4432f0550d15072ddf34956a248279ee9aeaff0fba3fa0f77d8f1a"
NEU_LIBDE265_VERSION="1.1.3"
NEU_LIBDE265_SHA256="554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905"

ALT_LIBHEIF_VERSION="1.23.2"
ALT_LIBHEIF_SHA256="8bd5d41d19dc84536d118b04774709f244df6104ef66d623dad5fa4650143405"
ALT_LIBDE265_VERSION="1.0.15"
ALT_LIBDE265_SHA256="00251986c29d34d3af7117ed05874950c875dd9292d016be29d3b3762666511d"
# Pruefsumme der bis 30.09.2026 ausgelieferten libheif.wasm (npm libheif-js 1.23.2).
ALT_WASM_SHA256="e4aa8333fbe55ec7c6c776f735236f40bed9103188498f8131d4e52b73cdfee8"
# libheif.js des Kontrollbaus. Das Fertigpaket hatte seine JS-Datei nachtraeglich
# mit esbuild umgeschrieben; eine Vergleichsdatei von dort gibt es also nicht.
# Diese Summe ist deshalb kein Gleichheitsbeweis, sondern ein Driftmelder: In
# drei Laeufen am 30.09.2026 (36720408925, 36723113379, 36723169462) war sie
# gleich. Aendert sie sich, hat sich die Bauumgebung (Emscripten-Download,
# Runner-Abbild) veraendert.
ALT_KONTROLL_JS_SHA256="fb707a7e820e5668eed8426e06b837782729f955900293f7cbca300c27220ed6"

# ── Aufruf ───────────────────────────────────────────────────────────────────
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "Aufruf: $0 <zielordner> [--kontrollbau]" >&2
  exit 2
fi
ZIEL="$1"
KONTROLLE=0
if [ $# -eq 2 ]; then
  if [ "$2" != "--kontrollbau" ]; then
    echo "Unbekannte Option: $2" >&2
    exit 2
  fi
  KONTROLLE=1
fi

if [ "$KONTROLLE" = "1" ]; then
  LIBHEIF_VERSION="$ALT_LIBHEIF_VERSION"; LIBHEIF_SHA256="$ALT_LIBHEIF_SHA256"
  LIBDE265_VERSION="$ALT_LIBDE265_VERSION"; LIBDE265_SHA256="$ALT_LIBDE265_SHA256"
else
  LIBHEIF_VERSION="$NEU_LIBHEIF_VERSION"; LIBHEIF_SHA256="$NEU_LIBHEIF_SHA256"
  LIBDE265_VERSION="$NEU_LIBDE265_VERSION"; LIBDE265_SHA256="$NEU_LIBDE265_SHA256"
fi

ARBEIT="$(mktemp -d)"
mkdir -p "$ZIEL"
ZIEL="$(cd "$ZIEL" && pwd)"
KERNE="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Laedt eine Datei und bricht ab, wenn die Pruefsumme nicht stimmt. Eine
# unpruefbare Quelle wird nie gebaut.
lade() {
  local url="$1" datei="$2" soll="$3"
  curl -fsSL --retry 3 -o "$datei" "$url"
  local ist
  ist="$(sha256 "$datei")"
  if [ "$ist" != "$soll" ]; then
    echo "FEHLER: Pruefsumme von $(basename "$datei") stimmt nicht." >&2
    echo "  erwartet: $soll" >&2
    echo "  erhalten: $ist" >&2
    exit 1
  fi
  echo "Quelle geprueft: $(basename "$datei") sha256:$ist"
}

# ── 1. Emscripten (festgenagelte Version) ────────────────────────────────────
echo "== Emscripten $EMSDK_VERSION =="
git clone --quiet https://github.com/emscripten-core/emsdk.git "$ARBEIT/emsdk"
git -C "$ARBEIT/emsdk" checkout --quiet "$EMSDK_COMMIT"
"$ARBEIT/emsdk/emsdk" install "$EMSDK_VERSION" >/dev/null
"$ARBEIT/emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
# Nur die Hinweiszeilen von emsdk_env.sh werden verworfen, Fehler bleiben
# sichtbar; set -e bricht bei einem Fehlschlag ab. Dass die Umgebung wirklich
# steht, belegt erst emcc --version danach.
# shellcheck disable=SC1091
source "$ARBEIT/emsdk/emsdk_env.sh" >/dev/null
emcc --version | head -1

# ── 2. Quellen laden und pruefen ─────────────────────────────────────────────
echo "== Quellen: libheif $LIBHEIF_VERSION, libde265 $LIBDE265_VERSION =="
lade "https://github.com/strukturag/libheif/releases/download/v${LIBHEIF_VERSION}/libheif-${LIBHEIF_VERSION}.tar.gz" \
  "$ARBEIT/libheif-${LIBHEIF_VERSION}.tar.gz" "$LIBHEIF_SHA256"
tar xzf "$ARBEIT/libheif-${LIBHEIF_VERSION}.tar.gz" -C "$ARBEIT"
QUELLE="$ARBEIT/libheif-${LIBHEIF_VERSION}"

# Das Herstellerskript laedt libde265 selbst herunter — aber nur, wenn die Datei
# fehlt. Wir legen die GEPRUEFTE Datei vorher hin; damit baut es nie aus einer
# ungeprueften Quelle.
lade "https://github.com/strukturag/libde265/releases/download/v${LIBDE265_VERSION}/libde265-${LIBDE265_VERSION}.tar.gz" \
  "$QUELLE/libde265-${LIBDE265_VERSION}.tar.gz" "$LIBDE265_SHA256"

# ── 3. libde265 ab 1.1 vorab mit cmake bauen (siehe Kopf) ────────────────────
if [ "$KONTROLLE" = "0" ]; then
  echo "== libde265 $LIBDE265_VERSION (cmake) =="
  tar xzf "$QUELLE/libde265-${LIBDE265_VERSION}.tar.gz" -C "$ARBEIT"
  DE265_QUELLE="$ARBEIT/libde265-${LIBDE265_VERSION}"
  DE265_BAU="$ARBEIT/libde265-bau"
  # Wie der bisherige autotools-Bau des Herstellerskripts: statisch, ohne SIMD
  # (dort --disable-sse; WebAssembly hat kein SSE), ohne Beispielprogramme, -O3.
  # CMAKE_*_FLAGS_RELEASE=-O3 statt des cmake-Standards "-O3 -DNDEBUG": Der
  # autotools-Bau setzte kein NDEBUG, die internen Pruefungen (assert) von
  # libde265 blieben aktiv. Das behalten wir bei.
  # -ffile-prefix-map: Jede aktive Pruefung traegt ihren Quelldateinamen im
  # Ergebnis. cmake reicht absolute Pfade an den Compiler weiter, der Bauordner
  # hat einen zufaelligen Namen (mktemp) — ohne Umschreibung stuende er 22-mal in
  # libheif.wasm, und jeder Bau ergaebe eine andere Datei (Befund G-01 der
  # Pruefschleife vom 30.09.2026). Mit der Umschreibung steht dort
  # "libde265-1.1.3/libde265/sps.cc", wie beim autotools-Weg nur relative Namen.
  emcmake cmake -S "$DE265_QUELLE" -B "$DE265_BAU" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS_RELEASE="-O3 -ffile-prefix-map=$ARBEIT/=" \
    -DCMAKE_CXX_FLAGS_RELEASE="-O3 -ffile-prefix-map=$ARBEIT/=" \
    -DBUILD_SHARED_LIBS=OFF \
    -DENABLE_SDL=OFF \
    -DENABLE_SIMD=OFF \
    -DENABLE_DECODER=OFF \
    -DENABLE_ENCODER=OFF \
    -DENABLE_SHERLOCK265=OFF >/dev/null
  emmake cmake --build "$DE265_BAU" -j"$KERNE" >/dev/null

  # Ablage genau dort, wo build-emscripten.sh die autotools-Ausgabe erwartet:
  # Kopfdateien unter libde265-<v>/libde265/, Bibliothek unter .../.libs/.
  ABLAGE="$QUELLE/libde265-${LIBDE265_VERSION}/libde265"
  mkdir -p "$ABLAGE/.libs"
  cp "$DE265_QUELLE"/libde265/*.h "$ABLAGE/"
  cp "$DE265_BAU/libde265/de265-version.h" "$ABLAGE/"
  cp "$DE265_BAU/libde265/libde265.a" "$ABLAGE/.libs/libde265.a"
fi

# ── 4. libheif mit dem Herstellerskript bauen ────────────────────────────────
# Einstellungen wie beim bisherigen Zulieferer: WebAssembly, kein eval
# (unsere Sicherheitsrichtlinie erlaubt es nicht), nur libde265 als Codec.
echo "== libheif $LIBHEIF_VERSION (build-emscripten.sh des Herstellers) =="
(
  cd "$QUELLE"
  USE_WASM=1 USE_UNSAFE_EVAL=0 USE_TYPESCRIPT=0 \
  ENABLE_LIBDE265=1 LIBDE265_VERSION="$LIBDE265_VERSION" \
  ENABLE_AOM=0 ENABLE_OPENJPEG=0 ENABLE_WEBCODECS=0 ENABLE_UNCOMPRESSED=0 \
  STANDALONE=0 CORES="$KERNE" \
    ./build-emscripten.sh . >"$ARBEIT/bau.log" 2>&1
) || { echo "FEHLER: Bau gescheitert, letzte Zeilen:" >&2; tail -40 "$ARBEIT/bau.log" >&2; exit 1; }

# ── 5. Ergebnis pruefen ──────────────────────────────────────────────────────
for f in libheif.js libheif.wasm; do
  if [ ! -s "$QUELLE/$f" ]; then
    echo "FEHLER: $f wurde nicht erzeugt." >&2
    exit 1
  fi
done

# Stecken wirklich die gewuenschten Versionen drin? Beide Versionsnummern liegen
# als Text in der WebAssembly-Datei (heif_get_version, de265_get_version). Fehlt
# eine, hat das Herstellerskript doch seinen eigenen Weg genommen — dann ist der
# Bau wertlos. Verglichen wird exakt, nicht als Teiltext: Ein Suchmuster wie
# "1.1.3" traefe in einer Binaerdatei sonst auch fremde Bytefolgen.
versionen_im_wasm() {
  grep -aoE '[0-9]+\.[0-9]+\.[0-9]+' "$1" | sort -u
}
for v in "$LIBDE265_VERSION" "$LIBHEIF_VERSION"; do
  if ! versionen_im_wasm "$QUELLE/libheif.wasm" | grep -qxF "$v"; then
    echo "FEHLER: Version $v ist im Ergebnis nicht nachweisbar." >&2
    echo "  gefunden: $(versionen_im_wasm "$QUELLE/libheif.wasm" | tr '\n' ' ')" >&2
    exit 1
  fi
done
# Kein Bauordner im Ergebnis: Stuende der (zufaellige) Pfad darin, liesse sich
# der Bau nicht Byte fuer Byte wiederholen, und der Vergleich im Workflow
# koennte nie gruen werden. Geprueft wird der Pfad in beiden Schreibweisen
# (unter macOS zeigt /var auf /private/var).
ARBEIT_ECHT="$(cd "$ARBEIT" && pwd -P)"
for f in libheif.js libheif.wasm; do
  if grep -aqF "$ARBEIT" "$QUELLE/$f" || grep -aqF "$ARBEIT_ECHT" "$QUELLE/$f"; then
    echo "FEHLER: $f enthaelt den Bauordner ($ARBEIT) — der Bau waere nicht nachbaubar." >&2
    exit 1
  fi
done

# Kein eval im erzeugten Code: Die Sicherheitsrichtlinie der Seite verbietet es,
# der Dekoder wuerde sonst im Browser still scheitern.
if grep -qE '(^|[^A-Za-z_.])eval\(|new Function\(' "$QUELLE/libheif.js"; then
  echo "FEHLER: libheif.js enthaelt eval oder new Function." >&2
  exit 1
fi

cp "$QUELLE/libheif.js" "$QUELLE/libheif.wasm" "$ZIEL/"
echo "== Ergebnis in $ZIEL =="
echo "libheif.js   sha256:$(sha256 "$ZIEL/libheif.js")"
echo "libheif.wasm sha256:$(sha256 "$ZIEL/libheif.wasm")"
echo "libheif $LIBHEIF_VERSION, libde265 $LIBDE265_VERSION, Emscripten $EMSDK_VERSION"

if [ "$KONTROLLE" = "1" ]; then
  IST="$(sha256 "$ZIEL/libheif.wasm")"
  IST_JS="$(sha256 "$ZIEL/libheif.js")"
  if [ "$IST" = "$ALT_WASM_SHA256" ]; then
    echo "KONTROLLBAU: libheif.wasm ist Byte fuer Byte gleich der bisher ausgelieferten Datei."
  else
    echo "KONTROLLBAU: libheif.wasm WEICHT von der bisher ausgelieferten Datei ab." >&2
    echo "  bisher:   $ALT_WASM_SHA256" >&2
    echo "  Kontroll: $IST" >&2
    exit 1
  fi
  if [ "$IST_JS" = "$ALT_KONTROLL_JS_SHA256" ]; then
    echo "KONTROLLBAU: libheif.js unveraendert gegenueber den Kontrollbauten vom 30.09.2026."
  else
    echo "KONTROLLBAU: libheif.js hat sich gegenueber den Kontrollbauten vom 30.09.2026 veraendert —" >&2
    echo "  die Bauumgebung ist nicht mehr dieselbe. Erst klaeren, dann neu ausliefern." >&2
    echo "  bisher:   $ALT_KONTROLL_JS_SHA256" >&2
    echo "  Kontroll: $IST_JS" >&2
    exit 1
  fi
fi
