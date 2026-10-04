#!/bin/bash
# Schritt 3: die fertigen Dateien schreiben.
#
#   karte-<ort>.webp     640x238,  Zoomstufe 15 — wie die Karte der Seite.
#                        Auf 256 Farben gebracht (die Kacheln selbst sind
#                        256-Farben-Bilder) und VERLUSTFREI gespeichert: jede
#                        Kante bleibt so scharf wie in der Kachel.
#   karte-<ort>-2x.webp  1280x476, Zoomstufe 16 — derselbe Ausschnitt mit
#                        doppelter Punktdichte fuer hochaufloesende Bildschirme.
#                        Qualitaet einstellbar (Q2X), siehe unten.
#
# In jede Datei kommt die Quellenangabe als Metadatum (XMP), damit sie auch
# dann dabei ist, wenn jemand das Bild einzeln speichert.
set -eu
Q2X="${Q2X:-75}"          # Qualitaet der 2x-Fassung; "ll" = verlustfrei aus 256 Farben
ZIEL="${ZIEL:-fertig}"
mkdir -p "$ZIEL" tmp

cat > tmp/quelle.xmp <<'XMP'
<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">(c) OpenStreetMap contributors. Map data available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright</rdf:li></rdf:Alt></dc:rights>
   <dc:source>https://www.openstreetmap.org/</dc:source>
   <xmpRights:WebStatement>https://www.openstreetmap.org/copyright</xmpRights:WebStatement>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
XMP

for ort in selfie cafe hiker; do
  # 1x: 256 Farben ohne Rasterung, dann verlustfrei
  magick "roh/$ort-z15.png" -strip -dither None -colors 256 "PNG8:tmp/$ort-1x.png"
  cwebp -quiet -lossless -z 9 -exact "tmp/$ort-1x.png" -o "tmp/$ort-1x.webp"
  webpmux -set xmp tmp/quelle.xmp "tmp/$ort-1x.webp" -o "$ZIEL/karte-$ort.webp" 2>/dev/null

  if [ "$Q2X" = "ll" ]; then
    magick "roh/$ort-z16.png" -strip -dither None -colors 256 "PNG8:tmp/$ort-2x.png"
    cwebp -quiet -lossless -z 9 -exact "tmp/$ort-2x.png" -o "tmp/$ort-2x.webp"
  else
    cwebp -quiet -q "$Q2X" -m 6 -sharp_yuv "roh/$ort-z16.png" -o "tmp/$ort-2x.webp"
  fi
  webpmux -set xmp tmp/quelle.xmp "tmp/$ort-2x.webp" -o "$ZIEL/karte-$ort-2x.webp" 2>/dev/null
done
for f in "$ZIEL"/karte-*.webp; do
  printf '%-28s %7s Bytes  %s\n' "$(basename "$f")" "$(stat -f%z "$f")" "$(magick identify -format '%wx%h' "$f")"
done
