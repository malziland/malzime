/* ── Live-Anzeige (v3.0 „Live-Erlebnis", Phase 2) ──────────────────────────
 *
 * Setzt die vom Inhaber abgenommene Dramaturgie des Prototyps
 * (compare-prototype-streaming.html, 2026-08-11) auf der echten Seite um:
 *
 *   1. Die bestehende Scan-Animation bleibt, bis das ERSTE Zeichen getippt
 *      wird — dann übernimmt die Live-Karte.
 *   2. GETIPPT (Matrix-Dekodierung: fester Text + Rausch-Schweif + Cursor)
 *      wird AUSSCHLIESSLICH der Zusammenfassungstext, gespeist aus den
 *      liveText-Wellen der 2-s-Polls (api.js → welle()). Puffer-Prinzip:
 *      ~200 Zeichen Anlauf sammeln, dann durchgehend ~70 Zeichen/s — der
 *      Liefer- und der Anzeige-Rhythmus sind entkoppelt. Läuft der Puffer
 *      leer, verschwindet der Schweif und der Cursor blinkt.
 *   3. Ist das Ergebnis fertig gerendert, fährt starteEnthuellung() die
 *      GESTAFFELTE ENTHÜLLUNG: alles fertige Boxen mit Pop — Foto-Daten →
 *      GPS-Karte → Kategorien (Gruppenkopf ~650 ms, Karten im ~280-ms-
 *      Stakkato) → Werbe-Box → Manipulations-Box → Datenwert-Box (nur der
 *      Euro-Betrag zählt hoch, die Balken fahren aus) → PDF-Knopf zuletzt.
 *
 * Barrierefreiheit (Lehren aus v2.11):
 *   - prefers-reduced-motion: kein Tippen, kein Rausch — jede Welle erscheint
 *     sofort vollständig; die Enthüllung läuft ohne jede Verzögerung.
 *   - Screenreader: EINE Ankündigung am Ende über #srAnnounce — nie pro
 *     Zeichen, nie pro Box. Der Rausch-Span trägt aria-hidden (index.html),
 *     der wachsende Text bewusst KEIN aria-live.
 *
 * Fehler/Abbruch mitten im Live-Text: abbrechen() entfernt die Karte samt
 * Text — nie halben Text stehen lassen.
 */

import { elements } from "./dom.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { stopScanAnim } from "./ui.js";
import { tippTon, popTon } from "./klang.js";

/* Zeichenvorrat des Rausch-Schweifs — exakt der des Prototyps. */
const RAUSCH_ZEICHEN = "01ｱｶｻﾀﾅﾊﾏﾔﾗ<>#/*+=~$%&";
/* Länge des Rausch-Schweifs hinter dem zuletzt getippten Zeichen. */
const SCHWEIF_LAENGE = 7;
/* Anlauf: erst tippen, wenn so viele Zeichen im Puffer liegen — sonst tippt
   die Anzeige die erste Welle leer und stottert dann im Liefertakt. */
const MIN_PUFFER = 200;
/* Anzeige-Tempo, vom Liefertempo entkoppelt. */
const ZEICHEN_PRO_SEKUNDE = 70;
/* Prüftakt, wenn der Puffer leer ist und nur der Cursor blinkt. */
const LEERLAUF_MS = 120;

/* Aktueller Tipp-Lauf. `stop` beendet die Schleife beim nächsten Tick. */
let lauf = null;
/* Laufende Enthüllung (eigener Lauf mit eigenem stop-Schalter). */
let enthuellung = null;
/* Ist in diesem Durchgang die Enthüllung (schon) gestartet? Späte Wellen
   danach werden ignoriert — der vollständige Text steht ab da im Ergebnis. */
let enthuellungGestartet = false;
/* Wurde in diesem Durchgang Live-Text angezeigt? Entscheidet in api.js,
   ob nach dem Rendern die gestaffelte Enthüllung fährt. */
let liveLief = false;

/* Bewegungs-Vorgabe des Systems — bewusst bei jedem Zugriff frisch lesen,
   damit ein Umstellen während der Analyse sofort greift. */
function reduziert() {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_e) {
    return false;
  }
}

function zufallsZeichen() {
  return RAUSCH_ZEICHEN[Math.floor(Math.random() * RAUSCH_ZEICHEN.length)];
}

/* Wartet ms und meldet, ob der Lauf danach noch gültig ist. */
function warte(ms, mein) {
  return new Promise((aufloesen) => {
    setTimeout(() => aufloesen(!mein.stop), ms);
  });
}

function statusSetzen(schluessel) {
  if (elements.liveStatusText) elements.liveStatusText.textContent = t(schluessel);
}

/* Blendet die Live-Karte ein und versteckt die Scan-Animation — genau beim
   ersten sichtbaren Zeichen, nicht früher. Leise (ohne Screenreader-
   „abgeschlossen"-Ansage): das erste getippte Zeichen ist kein Abschluss. */
function karteZeigen() {
  liveLief = true;
  const karte = elements.liveKarte;
  if (!karte || karte.classList.contains("active")) return;
  karte.classList.remove("live-karte--erzaehler");
  karte.classList.add("active");
  statusSetzen("live.statusSchreibt");
  /* „Noch nicht fertig"-Dauerstatus, solange getippt wird. */
  if (elements.liveWarten) elements.liveWarten.textContent = t("live.nochNichtFertig");
  stopScanAnim(true);
}

/* Setzt die Karte vollständig zurück (unsichtbar, ohne Text). */
function karteEntfernen() {
  const karte = elements.liveKarte;
  if (karte) karte.classList.remove("active", "live-karte--erzaehler");
  if (elements.liveTextFest) elements.liveTextFest.textContent = "";
  if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
  if (elements.liveStatusText) elements.liveStatusText.textContent = "";
  if (elements.liveWarten) elements.liveWarten.textContent = "";
}

/* Nimmt alle Verdeckungen einer (abgebrochenen) Enthüllung zurück. Muss vor
   allem die DAUERHAFTEN Container (#privacy, #gpsMap) erwischen — deren
   Klassen überleben ein Neu-Rendern, anders als die Karten darin. */
function allesAufdecken() {
  document.querySelectorAll(".lv-verdeckt").forEach((el) => el.classList.remove("lv-verdeckt"));
}

/* ── Tipp-Schleife (Matrix-Dekodierung) ──────────────────────────────────
   Unregelmäßiger Klang-Rhythmus wie im Film: Zufallsabstand 3–15 Zeichen,
   15 % Chance auf eine verlängerte Atempause, Anschlagstärke 0,5–1,05 —
   ein fester Takt wirkt maschinell und stressig. */
async function tippSchleife(mein) {
  let naechsterTon = 3;
  while (!mein.stop) {
    if (mein.fest < mein.puffer.length) {
      if (mein.fest === 0) karteZeigen();
      mein.fest += 1;
      if (elements.liveTextFest) elements.liveTextFest.textContent = mein.puffer.slice(0, mein.fest);
      /* Rausch-Schweif NUR bei Bewegung — und nie länger als der Rest. */
      const rest = Math.min(SCHWEIF_LAENGE, mein.puffer.length - mein.fest);
      let rausch = "";
      for (let i = 0; i < rest; i++) rausch += zufallsZeichen();
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = rausch;
      naechsterTon -= 1;
      if (naechsterTon <= 0) {
        naechsterTon = 3 + Math.floor(Math.random() * 12);
        if (Math.random() < 0.15) naechsterTon += 12; /* kurze Atempause */
        tippTon(0.5 + Math.random() * 0.55);
      }
      if (!(await warte(1000 / ZEICHEN_PRO_SEKUNDE, mein))) return;
    } else {
      /* Puffer leer: Schweif weg, der Cursor blinkt (CSS), wir warten auf
         die nächste Welle. */
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
      if (!(await warte(LEERLAUF_MS, mein))) return;
    }
  }
}

/**
 * Nimmt den Live-Text-Stand einer processing-Antwort entgegen (api.js ruft
 * das bei jeder 2-s-Poll-Antwort auf). Der Server liefert den GESAMTEN bisher
 * angekommenen Text — kein Delta; kürzere oder gleiche Stände sind alte
 * Antworten und werden ignoriert.
 */
export function welle(text) {
  if (typeof text !== "string" || text.length === 0) return;
  /* Späte Wellen nach Beginn der Enthüllung ändern nichts mehr. */
  if (enthuellungGestartet) return;
  if (!lauf) lauf = { stop: false, puffer: "", fest: 0, tippt: false };
  if (text.length <= lauf.puffer.length) return;
  lauf.puffer = text;

  if (reduziert()) {
    /* Barrierefreiheit: kein Tippen, kein Rausch — die Welle erscheint
       sofort vollständig. */
    karteZeigen();
    lauf.fest = lauf.puffer.length;
    if (elements.liveTextFest) elements.liveTextFest.textContent = lauf.puffer;
    if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
    return;
  }

  if (!lauf.tippt && lauf.puffer.length >= MIN_PUFFER) {
    lauf.tippt = true;
    tippSchleife(lauf);
  }
}

/** Lief in diesem Durchgang Live-Text? (Grundlage der Enthüllungs-Entscheidung) */
export function hatLiveGelaufen() {
  return liveLief;
}

/* ── Gestaffelte Enthüllung ──────────────────────────────────────────────── */

function boxZeigen(el) {
  if (!el) return;
  el.classList.remove("lv-verdeckt");
  el.classList.add("pop-rein");
  popTon();
}

/* Balken des Datenwert-Diagramms auf 0 stellen (Enthüllung fährt sie aus). */
function balkenVorbereiten(dvKarte) {
  dvKarte.classList.add("lv-balken");
  dvKarte.querySelectorAll(".dv-bar-fill").forEach((f) => {
    f.style.width = "0";
  });
}

function balkenAusfahren(dvKarte, sofort) {
  dvKarte.querySelectorAll(".dv-bar-fill").forEach((f) => {
    const breite = (f.dataset.barWidth || "0") + "%";
    if (sofort) f.style.width = breite;
    else
      setTimeout(() => {
        f.style.width = breite;
      }, 150);
  });
}

/* Zählt den Euro-Betrag der Datenwert-Box von 0 auf den gerenderten Endwert
   hoch — sprachneutral: die Zahl wird aus dem fertigen Text gelesen und im
   selben Format (Dezimalzeichen, Nachkommastellen) wieder eingesetzt. */
async function betragHochzaehlen(el, dauerMs, mein) {
  const endText = el.textContent;
  const treffer = endText.match(/\d+(?:[.,]\d+)?/);
  if (!treffer) return true;
  const roh = treffer[0];
  const komma = roh.includes(",");
  const dezimalstellen = komma || roh.includes(".") ? roh.length - Math.max(roh.indexOf(","), roh.indexOf(".")) - 1 : 0;
  const endwert = parseFloat(roh.replace(",", "."));
  if (!isFinite(endwert)) return true;
  const schritte = 24;
  for (let s = 1; s < schritte; s++) {
    if (mein.stop) return false;
    let wert = ((endwert * s) / schritte).toFixed(dezimalstellen);
    if (komma) wert = wert.replace(".", ",");
    el.textContent = endText.replace(roh, wert);
    if (!(await warte(dauerMs / schritte, mein))) return false;
  }
  el.textContent = endText;
  return true;
}

/* Leaflet berechnet Größe/Kacheln beim Anlegen — in einem verdeckten
   Container kommt dabei 0×0 heraus. Nach dem Aufdecken einmal nachmessen. */
function gpsKarteNachmessen() {
  try {
    if (state.gpsMapInstance && typeof state.gpsMapInstance.invalidateSize === "function") {
      state.gpsMapInstance.invalidateSize();
    }
  } catch (_e) {
    /* Karten-Eigenheiten dürfen die Enthüllung nicht stoppen */
  }
}

/* Schlussbild der Enthüllung: Status-Zeile, PDF-Knopf, EINE Ankündigung. */
function abschlussAnzeigen() {
  statusSetzen("live.statusFertig");
  if (elements.exportPdf) elements.exportPdf.classList.remove("export-btn--hidden");
  /* A11y: die EINE Ankündigung am Ende — nie pro Zeichen, nie pro Box. */
  if (elements.srAnnounce) elements.srAnnounce.textContent = t("live.statusFertig");
}

function abschluss(mein) {
  if (mein.stop) return;
  enthuellung = null;
  abschlussAnzeigen();
}

/**
 * Fährt die gestaffelte Enthüllung über das bereits fertig gerenderte
 * Ergebnis. MUSS synchron unmittelbar nach renderCurrentMode laufen: Das
 * Verdecken passiert im selben Frame wie das Rendern, nichts blitzt auf.
 * Die Zusammenfassung steht ab jetzt in ihrer normalen Box (#simulation);
 * die Live-Karte wird zur Erzähler-Zeile der Enthüllung.
 */
export function starteEnthuellung() {
  if (lauf) {
    lauf.stop = true;
    lauf = null;
  }
  if (enthuellung) enthuellung.stop = true;
  const mein = { stop: false };
  enthuellung = mein;
  enthuellungGestartet = true;

  const karte = elements.liveKarte;
  if (karte) {
    karte.classList.add("active", "live-karte--erzaehler");
  }

  /* Alles verdecken — synchron, bevor der Browser zeichnet. */
  const privacy = elements.privacy;
  const gps = elements.gpsMap;
  const faktenKinder = elements.facts ? Array.from(elements.facts.children) : [];
  const adsKarte = elements.targeting ? elements.targeting.querySelector(".target-card:not(.warn)") : null;
  const triggerKarte = elements.targeting ? elements.targeting.querySelector(".target-card.warn") : null;
  const dvKarte = elements.dataValue ? elements.dataValue.querySelector(".dv-card") : null;
  const boxen = [privacy, gps, adsKarte, triggerKarte, dvKarte];
  boxen.forEach((el) => el && el.classList.add("lv-verdeckt"));
  faktenKinder.forEach((el) => el.classList.add("lv-verdeckt"));
  /* Der PDF-Knopf kommt erst NACH der Enthüllung wieder. */
  if (elements.exportPdf) elements.exportPdf.classList.add("export-btn--hidden");
  const dvZahl = dvKarte ? dvKarte.querySelector(".dv-hero-value") : null;
  if (dvKarte) balkenVorbereiten(dvKarte);
  /* Alles Eingesammelte am Lauf festhalten — enthuellungAbkuerzen() muss beim
     Beast-Umschalter GENAU diese Elemente sofort sichtbar machen können. */
  mein.einheiten = { boxen, faktenKinder, dvKarte, dvZahl, dvEndText: dvZahl ? dvZahl.textContent : null };

  if (reduziert()) {
    /* Barrierefreiheit: die Enthüllung ohne jede Verzögerung — alles sofort,
       Betrag und Balken auf Endstand. Ein einzelner Pop statt zwanzig auf
       einmal (Klang bleibt, nur der Stapel entfällt). */
    boxen.forEach((el) => el && el.classList.remove("lv-verdeckt"));
    faktenKinder.forEach((el) => el.classList.remove("lv-verdeckt"));
    if (dvKarte) balkenAusfahren(dvKarte, true);
    gpsKarteNachmessen();
    popTon();
    abschluss(mein);
    return;
  }

  (async () => {
    /* 1) Foto-Daten + Standort. */
    statusSetzen("live.statusFotoDaten");
    if (!(await warte(700, mein))) return;
    boxZeigen(privacy);
    if (!(await warte(1100, mein))) return;
    boxZeigen(gps);
    gpsKarteNachmessen();
    if (!(await warte(1400, mein))) return;

    /* 2) Die Kategorien: Gruppenkopf gemächlich, seine Karten im Stakkato. */
    statusSetzen("live.statusKategorien");
    for (const kind of faktenKinder) {
      const istKopf = kind.classList.contains("cat-group-head");
      if (!(await warte(istKopf ? 650 : 280, mein))) return;
      boxZeigen(kind);
    }

    /* 3) Werbung + Manipulation — nur noch ganze, fertige Boxen. */
    statusSetzen("live.statusWerbung");
    if (!(await warte(600, mein))) return;
    boxZeigen(adsKarte);
    if (!(await warte(1200, mein))) return;
    boxZeigen(triggerKarte);
    if (!(await warte(1200, mein))) return;

    /* 4) Datenwert: Box komplett, nur der Betrag zählt hoch, Balken fahren aus. */
    statusSetzen("live.statusDatenwert");
    boxZeigen(dvKarte);
    if (dvKarte) {
      balkenAusfahren(dvKarte, false);
      if (dvZahl && !(await betragHochzaehlen(dvZahl, 1200, mein))) return;
    }

    /* 5) Zum Schluss: PDF-Knopf + die eine Screenreader-Ankündigung. */
    abschluss(mein);
  })();
}

/**
 * Kürzt eine laufende Enthüllung sofort ab (alles sichtbar, PDF-Knopf da).
 * Wird beim Beast-Umschalter gebraucht: der Wechsel rendert sofort neu wie
 * heute — eine halb gelaufene Enthüllung darf dabei nichts verdeckt lassen.
 * Ohne laufende Enthüllung ein No-Op.
 */
export function enthuellungAbkuerzen() {
  if (!enthuellung) return;
  const mein = enthuellung;
  mein.stop = true;
  enthuellung = null;
  const e = mein.einheiten || {};
  (e.boxen || []).forEach((el) => el && el.classList.remove("lv-verdeckt"));
  (e.faktenKinder || []).forEach((el) => el.classList.remove("lv-verdeckt"));
  if (e.dvKarte) balkenAusfahren(e.dvKarte, true);
  if (e.dvZahl && typeof e.dvEndText === "string") e.dvZahl.textContent = e.dvEndText;
  gpsKarteNachmessen();
  /* Netz für alles Übrige, das noch verdeckt im Dokument hängt. */
  allesAufdecken();
  abschlussAnzeigen();
}

/**
 * Bricht das Live-Erlebnis ab und räumt restlos auf: Karte samt Text weg,
 * Schleifen gestoppt, Verdecktes wieder sichtbar. Für Fehler/Abbruch mitten
 * im Live-Text und als No-Op-Aufräumer, wenn nie Live-Text lief.
 */
export function abbrechen() {
  if (lauf) {
    lauf.stop = true;
    lauf = null;
  }
  if (enthuellung) {
    enthuellung.stop = true;
    enthuellung = null;
  }
  enthuellungGestartet = false;
  karteEntfernen();
  allesAufdecken();
}

/** Setzt alles für einen neuen Analyse-Durchgang zurück. */
export function zuruecksetzen() {
  abbrechen();
  liveLief = false;
}
