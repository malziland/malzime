import { escapeHtml } from "./dom.js";
import { state } from "./state.js";
import { getLanguage, t } from "./i18n.js";

/* ── Beispielbilder: Ort ohne Abfrage (PRIV-2026-10-03-38) ──
   Die Beispielbilder tragen absichtlich erfundene Ortsdaten, damit die
   Ergebnis-Seite zeigen kann, was ein Foto verrät (img/demo/LICENSE.md). Für
   sie fragt der Browser nichts nach außen: Adresse und Kartenausschnitt der
   drei Orte liefert die Seite selbst mit — die Adresse in den Sprachdateien
   (`demo.place.*`), den Ausschnitt als Bilddatei (img/demo/karte-*.webp).

   WORAN EIN BEISPIELBILD ERKANNT WIRD: an der Datei, die beim Klick auf ein
   Beispielbild entsteht (demo.js) — nicht an den Koordinaten. Ein eigenes Foto
   mit zufällig denselben Koordinaten ist eine andere Datei und geht den
   normalen Weg. Die Merkliste hängt an der Datei selbst (WeakMap): Sie braucht
   kein Zurücksetzen und kann deshalb nicht am nächsten Foto kleben; und sie
   bleibt, wenn dieselbe Datei nach einem Sprachwechsel noch einmal analysiert
   wird. */

/* Die Beispielbilder der Seite — die EINE Liste. js/demo.js lädt nur, was hier
   steht; damit ist jedes Beispielbild von selbst eines, für das nichts nach
   außen gefragt wird. Kommt ein Bild dazu, braucht es Kartenausschnitt und
   Adresse (public/__tests__/beispielbild-karten.test.js verlangt beides). */
export const BEISPIEL_SCHLUESSEL = Object.freeze(["selfie", "cafe", "hiker"]);
const beispielbilder = new WeakMap();

/** Merkt eine Datei als Beispielbild. Unbekannte Schlüssel werden nicht gemerkt. */
export function merkeBeispielbild(datei, schluessel) {
  if (!datei || typeof datei !== "object") return;
  if (!BEISPIEL_SCHLUESSEL.includes(schluessel)) return;
  beispielbilder.set(datei, schluessel);
}

/** Der Schlüssel des Beispielbilds — oder null, wenn die Datei keines ist. */
function beispielSchluessel(datei) {
  return (datei && typeof datei === "object" && beispielbilder.get(datei)) || null;
}

/* Fehlt ein Text in der Sprachdatei, gibt t() den Schlüssel zurück — dann
   lieber nichts als einen Schlüsselnamen auf dem Bildschirm. */
function textOderLeer(schluessel) {
  const text = t(schluessel);
  return text === schluessel ? "" : text;
}

/**
 * Adresse und fester Kartenausschnitt zu einem Beispielbild.
 *
 * @param {File|null} datei Die Aufnahme, um die es geht (state.lastFile).
 * @returns {{schluessel: string, adresse: string, alt: string, bild: string, bild2x: string}|null}
 *   null, wenn die Datei kein Beispielbild ist — dann gilt der normale Weg.
 */
export function beispielOrt(datei) {
  const schluessel = beispielSchluessel(datei);
  if (!schluessel) return null;
  return {
    schluessel,
    /* Je Sprache der Wortlaut, den die Ortsauflösung für diese Koordinaten
       geliefert hat (einmal abgefragt, siehe img/demo/LICENSE.md). */
    adresse: textOderLeer(`demo.place.${schluessel}`),
    alt: textOderLeer(`demo.mapAlt.${schluessel}`),
    /* Zwei Fassungen desselben Ausschnitts: einfache und doppelte Punktdichte. */
    bild: `./img/demo/karte-${schluessel}.webp`,
    bild2x: `./img/demo/karte-${schluessel}-2x.webp`,
  };
}

/* Der Ortszeiger in Rost statt Leaflets Standard-Blau — das Blau gehört zu
   keiner Farbe dieser Seite. Derselbe Zeiger steht auf der beweglichen Karte
   (js/render.js) und auf dem festen Kartenausschnitt der Beispielbilder. */
export const ORTSZEIGER_SVG =
  '<svg viewBox="0 0 24 32" width="28" height="37" aria-hidden="true">' +
  '<path fill="#9c4e36" stroke="#fff" stroke-width="1.6" ' +
  'd="M12 1.4c-4.9 0-8.9 3.9-8.9 8.7 0 6.3 7.9 20 8.3 20.6a.7.7 0 0 0 1.2 0c.4-.6 8.3-14.3 8.3-20.6 0-4.8-4-8.7-8.9-8.7Z"/>' +
  '<circle cx="12" cy="10.1" r="3.3" fill="#fff"/></svg>';

/**
 * Der Ortsbereich eines Beispielbilds als HTML: Überschrift, Adresszeile,
 * fester Kartenausschnitt mit Zeiger und Quellenangabe, Hinweis darunter.
 * Aufbau und Aussehen folgen der beweglichen Karte (js/render.js); der Ort
 * liegt in der Bildmitte, dort sitzt der Zeiger (styles.css, `.gps-festkarte`).
 * Der Verweis in der Quellenangabe wird erst mit einem Klick zur Anfrage.
 *
 * @param {File|null} datei Die Aufnahme, um die es geht (state.lastFile).
 * @param {string} koordinaten Steht in der Adresszeile, falls der Adresstext fehlt.
 * @returns {string|null} null, wenn die Datei kein Beispielbild ist.
 */
export function festerOrtsbereichHtml(datei, koordinaten) {
  const ort = beispielOrt(datei);
  if (!ort) return null;
  return `
    <div class="map-wrapper">
      <h3>${t("gps.sectionTitle")}</h3>
      <p class="gps-address">${ort.adresse ? escapeHtml(ort.adresse) : escapeHtml(koordinaten)}</p>
      <div class="gps-festkarte">
        <img src="${ort.bild}" srcset="${ort.bild} 1x, ${ort.bild2x} 2x" width="640" height="238" alt="${escapeHtml(ort.alt)}" decoding="async" />
        <span class="gps-zeiger" aria-hidden="true" title="${escapeHtml(t("gps.popup"))}">${ORTSZEIGER_SVG}</span>
        <p class="gps-festkarte-quelle">${t("gps.osmCredit")}</p>
      </div>
      <p class="gps-hinweis">${t("gps.fixedHint")}</p>
    </div>
  `;
}

/* Geocoding vorausladen — wird gestartet sobald GPS gefunden wird,
   läuft parallel zur Analyse. Retry bei TLS 425 "Too Early". */
export function startGeocoding(lat, lng) {
  /* Laufendes Geocoding abbrechen (BUG-005) */
  if (state.geocodeAbortController) state.geocodeAbortController.abort();

  /* Beispielbild: keine Abfrage. Der Riegel sitzt hier und nicht beim
     Aufrufer, damit er für jeden gilt, der die Ortsauflösung anstößt. */
  if (beispielSchluessel(state.lastFile)) {
    state.geocodeAbortController = null;
    state.pendingGeocode = null;
    return;
  }

  state.geocodeAbortController = new AbortController();
  const signal = state.geocodeAbortController.signal;
  const timeoutId = setTimeout(() => {
    if (!signal.aborted) state.geocodeAbortController.abort();
  }, 15000);

  const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${getLanguage()}`;
  const doFetch = () =>
    fetch(geoUrl, {
      headers: { "User-Agent": "malzime-workshop-demo/1.0" },
      signal,
    });
  state.pendingGeocode = (async () => {
    try {
      let res;
      try {
        res = await doFetch();
      } catch (_e) {
        if (signal.aborted) return null;
        await new Promise((r) => setTimeout(r, 600));
        res = await doFetch();
      }
      const data = await res.json();
      return data.display_name || null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();
}
