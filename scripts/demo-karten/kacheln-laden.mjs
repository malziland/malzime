// Herstellung der festen Kartenausschnitte fuer die drei erfundenen Orte der
// malziME-Demo-Fotos (public/img/demo/karte-*.webp). Die Ergebnis-Seite zeigt
// sie statt einer beweglichen Karte, damit der Browser bei einem Demo-Foto
// nichts bei OpenStreetMap anfragt.
//
// Drei Schritte, aufgerufen aus einem LEEREN Arbeitsordner AUSSERHALB des
// Repositorys — dort entstehen kacheln/, roh/, tmp/ und fertig/:
//   node <repo>/scripts/demo-karten/kacheln-laden.mjs     Kacheln laden
//   node <repo>/scripts/demo-karten/karten-bauen.mjs      aneinanderlegen, zuschneiden
//   bash <repo>/scripts/demo-karten/karten-ausgeben.sh    als WebP mit Quellenangabe
// Danach fertig/karte-*.webp nach public/img/demo/ legen und das Abrufdatum in
// public/img/demo/LICENSE.md nachziehen. Braucht node, ImageMagick (magick),
// cwebp und webpmux.
//
// Die Bilder im Repository stammen aus genau diesen Schritten, mit den Kacheln
// vom 03.10.2026. OpenStreetMap zeichnet seine Kacheln laufend neu; ein
// spaeterer Lauf ergibt deshalb andere Bytes.
//
// Schritt 1 (diese Datei): die noetigen Kacheln EINMAL von OpenStreetMap laden
// und im Arbeitsordner ablegen. Vorhandene Kacheln werden nicht erneut geladen.
//   - sprechender User-Agent mit Verweis auf das Projekt
//   - eine Verbindung, Pause zwischen den Anfragen
//   - zusammen deutlich unter 250 Kacheln (Kachel-Nutzungsregeln von OSM)
import { mkdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { setTimeout as warte } from "node:timers/promises";

export const ORTE = {
  selfie: { lat: 48.208200000000005, lng: 16.3738 },
  cafe: { lat: 47.8005, lng: 13.044 },
  hiker: { lat: 47.5622, lng: 13.6493 },
};

/* Ausschnitt in Bildpunkten je Zoomstufe: Stufe 15 ist die Stufe der Karte auf
   der Seite (render.js: setView(..., 15)); Stufe 16 liefert denselben
   Ausschnitt mit doppelter Punktdichte fuer hochaufloesende Bildschirme.
   238 hoch, weil die Kartenflaeche der Seite 240 Bildpunkte MIT einem Rand von
   je 1 Bildpunkt misst (styles.css) — so wird das Bild ohne Umrechnen gezeigt.
   640 breit: Die Kartenflaeche ist hoechstens 604 Bildpunkte breit. */
export const STUFEN = {
  15: { breite: 640, hoehe: 238 },
  16: { breite: 1280, hoehe: 476 },
};

export function mittelpunktInPixeln(lat, lng, z) {
  const n = 256 * 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const breiteRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(breiteRad) + 1 / Math.cos(breiteRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function ausschnitt(lat, lng, z) {
  const { breite, hoehe } = STUFEN[z];
  const m = mittelpunktInPixeln(lat, lng, z);
  /* Auf ganze Bildpunkte runden, damit beim Zusammensetzen nichts
     neu abgetastet wird. */
  const links = Math.round(m.x - breite / 2);
  const oben = Math.round(m.y - hoehe / 2);
  const kx0 = Math.floor(links / 256);
  const ky0 = Math.floor(oben / 256);
  const kx1 = Math.floor((links + breite - 1) / 256);
  const ky1 = Math.floor((oben + hoehe - 1) / 256);
  return { links, oben, breite, hoehe, kx0, ky0, kx1, ky1, mitte: m };
}

const UA = "malzime-demo-karten/1.0 (einmalige Erzeugung fester Kartenausschnitte; +https://github.com/malziland/malzime)";

async function main() {
  let geladen = 0, vorhanden = 0, gesamt = 0;
  for (const [name, ort] of Object.entries(ORTE)) {
    for (const z of Object.keys(STUFEN).map(Number)) {
      const a = ausschnitt(ort.lat, ort.lng, z);
      console.log(`${name} z${z}: Mitte ${a.mitte.x.toFixed(2)}/${a.mitte.y.toFixed(2)} -> Ausschnitt ab ${a.links}/${a.oben}, Kacheln x ${a.kx0}-${a.kx1}, y ${a.ky0}-${a.ky1}`);
      for (let x = a.kx0; x <= a.kx1; x++) {
        for (let y = a.ky0; y <= a.ky1; y++) {
          gesamt++;
          const ordner = `kacheln/${z}/${x}`;
          const datei = `${ordner}/${y}.png`;
          if (existsSync(datei) && statSync(datei).size > 100) { vorhanden++; continue; }
          mkdirSync(ordner, { recursive: true });
          const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
          const antwort = await fetch(url, { headers: { "User-Agent": UA } });
          if (!antwort.ok) throw new Error(`${url} -> HTTP ${antwort.status}`);
          const typ = antwort.headers.get("content-type") || "";
          if (!typ.startsWith("image/png")) throw new Error(`${url} -> unerwarteter Typ ${typ}`);
          writeFileSync(datei, Buffer.from(await antwort.arrayBuffer()));
          geladen++;
          await warte(300);
        }
      }
    }
  }
  console.log(`Kacheln gesamt ${gesamt}: neu geladen ${geladen}, schon vorhanden ${vorhanden}`);
}

if (process.argv[1] && process.argv[1].endsWith("kacheln-laden.mjs")) await main();
