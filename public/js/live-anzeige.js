/* ── Live-Anzeige (v3.0 „Live-Erlebnis", Phase 2) ──────────────────────────
 *
 * Setzt die abgenommene Dramaturgie des Prototyps
 * (compare-prototype-streaming.html, 2026-08-11) auf der echten Seite um:
 *
 *   1. Die bestehende Scan-Animation bleibt, bis das ERSTE Zeichen getippt
 *      wird — dann übernimmt die Live-Karte. Das Tippen beginnt erst nach
 *      einem ZEIT-Anlauf (TIPP_ANLAUF_MS): Sofort-Start bei dünnem Puffer
 *      kroch an der Untergrenze dahin — „wirkt sehr gequält" (Live-Test
 *      11.08.). Die Anlauf-Zeit trägt die Scan-Animation, nie ein leerer
 *      Cursor.
 *   2. GETIPPT (Matrix-Dekodierung: fester Text + Rausch-Schweif + Cursor)
 *      wird AUSSCHLIESSLICH der Zusammenfassungstext, gespeist aus den
 *      liveText-Wellen der 2-s-Polls (api.js → welle()). Seit Phase 3 führt
 *      das Modul ZWEI Puffer (seriös/Beast) mit je eigenem Tipp-Fortschritt;
 *      getippt wird immer der Puffer des GERADE GEWÄHLTEN Modus
 *      (#biasSwitch). Ein Schalter-Wechsel mitten im Tippen springt sofort
 *      auf den Stand des anderen Puffers und tippt dort weiter — kein
 *      Neustart von vorn. Ist der Beast-Puffer noch leer (das Modell
 *      schreibt Beast NACH dem Standard-Profil — Reihenfolge der Antwort,
 *      keine Schwäche), zeigt die Karte einen Warte-Status mit blinkendem
 *      Cursor. Tempo-Prinzip (v3.0.0, ADAPTIV statt fester 70 Zeichen/s):
 *      Das Tempo richtet sich bei jedem Tick nach dem ungetippten Rest —
 *      das Tippen soll die Wartezeit der Analyse TRAGEN, nicht in ~7 s
 *      durchrauschen und dann 40+ s Leere hinterlassen (Befund des ersten
 *      Live-Tests). Meldet der Server „fertig", tippt schnellVorlauf() den
 *      Rest zügig aus, DANN erst startet die Enthüllung. Läuft der Puffer
 *      vorzeitig leer, verschwindet der Schweif und der Cursor blinkt.
 *   3. KEIN TOTES FENSTER (v3.0.1 FIX 2, umgebaut in v3.0.2): Die
 *      Zusammenfassung ist oft fertig getippt, während die Analyse
 *      serverseitig noch ~30–50 s weiterläuft (Kategorien/Beast). Läuft der
 *      aktive Puffer leer (oder wartet Beast auf seine ersten Zeichen),
 *      erscheint wieder das VERTRAUTE AUGE der Scan-Phase oberhalb der Karte
 *      und trägt die ehrlichen Warte-Zeilen (i18n-Liste `live.warten`, alle
 *      ~2,5 s). Es gibt damit nur noch zwei Erscheinungen: „Auge arbeitet
 *      mit Wechseltext" und „KI tippt in der Rost-Box" — die frühere
 *      Status-Zeile IN der Karte ist ersatzlos weg (Screenshot-Befund des
 *      abgenommen 11.08. abends). Mit dem nächsten getippten Zeichen
 *      verschwindet das Auge; beim Enthüllungs-Beginn endgültig.
 *   4. Ist das Ergebnis fertig gerendert, fährt starteEnthuellung() die
 *      GESTAFFELTE ENTHÜLLUNG: alles fertige Boxen mit Pop — Foto-Daten →
 *      GPS-Karte → Kategorien (Gruppenkopf ~650 ms, Karten im ~280-ms-
 *      Stakkato) → Werbe-Box → Manipulations-Box → Datenwert-Box (nur der
 *      Euro-Betrag zählt hoch, die Balken fahren aus) → PDF-Knopf zuletzt.
 *      Dabei scrollt die Seite GEFÜHRT mit (v3.0.2): jede gepoppte Box wird
 *      aktiv zentriert — ab dem ERSTEN Pop (v3.0.3, User-Befund: die Führung
 *      schien sonst erst spät „loszufahren").
 *   5. BLICK-FÜHRUNG über den GESAMTEN Lauf (v3.0.3): „Der Blick ist immer
 *      dort, wo gerade etwas passiert." Nach der Foto-/Demo-Wahl wird das
 *      Scan-Auge sanft ins Sichtfeld geholt (am Handy zeigt der Bildschirm
 *      sonst nur das Foto, aber nicht, dass etwas passiert), beim ersten
 *      getippten Zeichen die Live-Karte — beides NUR, wenn das Element nicht
 *      ohnehin mehrheitlich sichtbar ist: Auf dem Desktop bewegt sich nichts.
 *      Während des Tippens hält ein gedrosseltes Nachscrollen die letzte
 *      Zeile im Bild (nur nach unten, nur wenn der Cursor unter die
 *      Sichtkante rutscht). Der Nutzer hat Vorrang: EIN Übernahme-Zustand
 *      pro Analyse-Lauf — der erste eigene Eingriff (Rad, Touch,
 *      Scroll-Taste) stoppt ALLE automatischen Scroll-Bewegungen sofort und
 *      dauerhaft für diesen Lauf, und der Pop-Ton klingt ab da nur noch für
 *      Boxen, die wirklich im Sichtfeld liegen (keine Geräusche aus dem Off).
 *
 * Barrierefreiheit (Lehren aus v2.11):
 *   - prefers-reduced-motion: kein Tippen, kein Rausch — jede Welle erscheint
 *     sofort vollständig; die Enthüllung läuft ohne jede Verzögerung. Und es
 *     wird NIEMALS automatisch gescrollt (auch nicht von der Blick-Führung).
 *   - Screenreader: EINE Ankündigung am Ende über #srAnnounce — nie pro
 *     Zeichen, nie pro Box. Der Rausch-Span trägt aria-hidden (index.html),
 *     der wachsende Text bewusst KEIN aria-live.
 *
 * Fehler/Abbruch mitten im Live-Text: abbrechen() entfernt die Karte samt
 * Text — nie halben Text stehen lassen.
 */

import { elements } from "./dom.js";
import {
  zeigeLiveKarten,
  liveKartenZuruecksetzen,
  liveKartenModusWechsel,
  zeigeVersteckteDatenUndKarte,
} from "./render.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { startScanAnim, stopScanAnim } from "./ui.js";
import { tippTon, popTon } from "./klang.js";
import { PROFIL_FERTIG } from "./beast-lockruf.js";

/* Zeichenvorrat des Rausch-Schweifs — exakt der des Prototyps. */
const RAUSCH_ZEICHEN = "01ｱｶｻﾀﾅﾊﾏﾔﾗ<>#/*+=~$%&";
/* Länge des Rausch-Schweifs hinter dem zuletzt getippten Zeichen. */
const SCHWEIF_LAENGE = 7;
/* ── Adaptives Tipp-Tempo (v3.0.0) ──
   Der Puffer soll über ungefähr diese Spanne abtropfen: Eine echte Analyse
   dauert 50–80 s, der Stream liefert den Text aber schon in den ersten
   ~20–30 s — ein festes Tempo tippte deshalb in ~7 s alles leer und ließ
   danach 40+ s nur die Status-Rotation übrig („die Box fertig, und dann
   passiert überhaupt nichts"). Bei jedem Tick wird deshalb neu gerechnet:
   Rest ÷ ZIEL_ABTROPF_SEKUNDEN — wenig Puffer tippt langsam und lesbar,
   viel Puffer schneller, und das Tippen streckt sich über einen Großteil
   der Analyse. */
const ZIEL_ABTROPF_SEKUNDEN = 10;
/* Untergrenze: Darunter wirkt das Tippen wie ein Hänger statt wie Schreiben —
   auch ein fast leerer Puffer muss sichtbar in Bewegung bleiben. 20 nach
   ausdrücklicher Ansage (Abend-Test 11.08.: 12 Z/s „wirkt
   immer noch total zäh") — der lange Zeit-Anlauf unten sammelt vorher genug
   Material, damit dieses Tempo durchgehalten werden kann. */
const MIN_ZEICHEN_PRO_SEKUNDE = 20;
/* Obergrenze: Darüber ist der Text nicht mehr mitlesbar — schneller darf nur
   der Schnellvorlauf nach der Fertig-Meldung des Servers sein. */
const MAX_ZEICHEN_PRO_SEKUNDE = 90;
/* Zeit-Anlauf vor dem ersten getippten Zeichen: Der Stream liefert anfangs
   nur wenige Zeichen pro Sekunde — sofort loszutippen hieße, minutenlang an
   der Untergrenze zu kriechen. Solange trägt die Scan-Animation die Zeit.
   25 s auf ausdrückliche Ansage (11.08. abends): „die Box ist
   oft fertig und dann passiert eine Weile nichts" — also später starten,
   damit Tippen und Analyse gemeinsamer enden. Meldet der Server vorher
   „fertig", greift sofort der Schnellvorlauf. (let wegen
   _setzeTippAnlaufMsFuerTest.) */
let TIPP_ANLAUF_MS = 25000;
/* Schnellvorlauf, sobald der Server „fertig" meldet: Der Rest-Puffer wird
   zügig, aber noch als Tippen erkennbar ausgetippt — erst danach beginnt die
   Enthüllung. So endet der Lauf ohne harten Textsprung. */
const SCHNELLVORLAUF_ZEICHEN_PRO_SEKUNDE = 150;
/* Not-Deckel für den Schnellvorlauf: Er darf das fertige Ergebnis niemals
   dauerhaft blockieren, falls die Tipp-Schleife aus irgendeinem Grund nicht
   mehr vorankommt. */
const SCHNELLVORLAUF_DECKEL_MS = 15000;
/* Prüftakt, wenn der Puffer leer ist und nur der Cursor blinkt. */
const LEERLAUF_MS = 120;
/* Takt der ehrlichen Warte-Zeilen im Warte-Auge (v3.0.2: oberhalb der
   Karte, nicht mehr in einer Status-Zeile). */
const ROTATION_TAKT_MS = 2500;

/* ── Tipp-Nachscrollen ──
   Auf kleinen Bildschirmen wächst der getippte Text unten aus dem Sichtfeld
   („in die Nichtsichtbarkeit gerutscht", User-Befund 11.08. abends). Die
   Drossel prüft NICHT bei jedem Zeichen — bei ~90 Z/s wären das ~90 Messungen
   und angestoßene Smooth-Scrolls pro Sekunde, ein ruckelndes Dauerzerren. */
const NACHSCROLL_TAKT_MS = 300;
/* Sichtkanten-Puffer: erst wenn der Cursor DARUNTER rutscht, wird gescrollt —
   und genau bis zurück auf diese Kante, nie weiter (nur nach unten). */
const NACHSCROLL_PUFFER_PX = 48;

/* Aktueller Tipp-Lauf. `stop` beendet die Schleife beim nächsten Tick.
   `aktiv` benennt den Puffer des gerade gewählten Modus ("standard"/"beast");
   jeder Puffer trägt seinen eigenen Text-Stand (`text`) und
   Tipp-Fortschritt (`fest`). */
let lauf = null;
/* Laufende Enthüllung (eigener Lauf mit eigenem stop-Schalter). */
let enthuellung = null;
/* Ist in diesem Durchgang die Enthüllung (schon) gestartet? Späte Wellen
   danach werden ignoriert — der vollständige Text steht ab da im Ergebnis. */
let enthuellungGestartet = false;
/* Wurde in diesem Durchgang Live-Text angezeigt? Entscheidet in api.js,
   ob nach dem Rendern die gestaffelte Enthüllung fährt. */
let liveLief = false;
/* v3.3.1: Haelt der Lauf gerade wegen eines Verbindungsabbruchs an? Karte und
   Text bleiben dabei stehen — siehe pausieren(). Getrennt von `lauf.stop`,
   weil `stop` auch das endgueltige Ende bedeutet und beides sonst nicht
   unterscheidbar waere. */
let pausiert = false;

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

/* Der Puffer-Name des gerade gewählten Modus — dieselbe Quelle wie überall
   sonst: der Beast-Schalter (#biasSwitch). */
function aktiverModus() {
  return elements.biasSwitch && elements.biasSwitch.checked ? "beast" : "standard";
}

function neuerLauf() {
  /* Ein neuer Lauf beginnt ohne Vorgeschichte — hier gehört das Zurücksetzen
     hin, nicht in karteEntfernen(): Das läuft auch mitten in der Enthüllung,
     die den Stand dann noch braucht. */
  fruehGezeigt = { daten: false, fakten: false };
  return {
    stop: false,
    tippt: false,
    aktiv: aktiverModus(),
    /* v3.0.2: Zustand des Warte-Auges oberhalb der Karte — null (aus),
       "beastWartet" (fester Text) oder "warten" (Rotation). rotationRunde
       entwertet eine alte Rotations-Schleife, wenn eine neue startet. */
    spinnerZustand: null,
    rotationRunde: 0,
    /* v3.0.0: Der Server hat „fertig" gemeldet — der Rest wird im
       Schnellvorlauf ausgetippt (schnellVorlauf() setzt das). */
    schnellvorlauf: false,
    /* Vor diesem Zeitpunkt tippt die Schleife nicht (Zeit-Anlauf). */
    tippStartAb: 0,
    /* Letzte Sichtkanten-Prüfung des Tipp-Nachscrollens (Drossel). */
    nachscrollZuletzt: 0,
    puffer: {
      standard: { text: "", fest: 0 },
      beast: { text: "", fest: 0 },
    },
  };
}

/* ── Blick-Führung über den gesamten Lauf (v3.0.3) ───────────────────────
   „Der Blick ist immer dort, wo gerade etwas passiert" — Auge nach der
   Foto-Wahl, Karte beim Tipp-Start, letzte Zeile beim Tippen, jede Box der
   Enthüllung. Der NUTZER HAT VORRANG: Es gibt genau EINEN Übernahme-Zustand
   pro Analyse-Lauf; der erste eigene Eingriff (Rad, Touch, Scroll-Taste)
   stoppt ALLE automatischen Scroll-Bewegungen sofort und dauerhaft für
   diesen Lauf — nichts ist unangenehmer als eine Seite, die gegen die
   eigene Scroll-Richtung zieht. Bis v3.0.2 wachte die Übernahme nur über
   die Enthüllung — seit dem Auge- und Tipp-Scrollen muss sie ab dem
   Analyse-Beginn gelten. */

/* Tasten, mit denen Menschen scrollen — nur diese gelten als Übernahme
   (eine Tab-Taste z. B. ist Navigation, kein Scrollen). " " ist die
   Space-Taste, "Spacebar" ihr Name in älteren Browsern. */
const UEBERNAHME_TASTEN = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  " ",
  "Spacebar",
  "Home",
  "End",
]);

/* Der EINE Übernahme-Zustand des laufenden Analyse-Durchgangs — null heißt:
   keine Führung unterwegs (und damit auch kein automatisches Scrollen). */
let fuehrung = null;

/* KA-05 (Kurzaudit 2026-08-12): Laufende Nummer der Führung. Die
   Auge-Nachwache ist eine setTimeout-Kette — endet ein Lauf und beginnt
   binnen eines Takts (400 ms) der nächste, sähe der alte Tick wieder eine
   aktive Führung und liefe als ZWEITE Kette neben der neuen weiter (im
   Extremfall zwei Scrolls auf dasselbe Ziel). Jede Kette merkt sich deshalb
   die Nummer ihres Laufs und stirbt beim ersten Tick mit fremder Nummer. */
let fuehrungsLauf = 0;

function fuehrungListenerEntfernen(mein) {
  if (!mein.listener) return;
  window.removeEventListener("wheel", mein.listener);
  window.removeEventListener("touchmove", mein.listener);
  window.removeEventListener("keydown", mein.listener);
  mein.listener = null;
}

/**
 * Startet die Blick-Führung des Analyse-Laufs (api.js ruft das beim
 * Analyse-Beginn). Existiert für diesen Lauf schon ein Übernahme-Zustand,
 * bleibt er unangetastet — insbesondere eine bereits erfolgte Übernahme:
 * Der Nutzer soll die Führung EINMAL stoppen müssen, nicht in jeder Phase
 * aufs Neue. Die Wache liest nur mit (passive) — sie darf das echte
 * Scrollen niemals ausbremsen.
 */
export function fuehrungStarten() {
  if (fuehrung) return;
  fuehrungsLauf += 1; /* KA-05: neuer Lauf — alte Nachwache-Ketten verfallen */
  const mein = { aktiv: true, listener: null };
  const uebernahme = (ereignis) => {
    if (ereignis.type === "keydown" && !UEBERNAHME_TASTEN.has(ereignis.key)) return;
    mein.aktiv = false;
    /* Die Wache hat ihren Dienst getan — sofort abbauen, nicht erst am
       Ende des Laufs. Der Zustand selbst bleibt bis zum Lauf-Ende stehen
       (die Ton-Sichtfeld-Regel der Enthüllung braucht ihn). */
    fuehrungListenerEntfernen(mein);
  };
  mein.listener = uebernahme;
  window.addEventListener("wheel", uebernahme, { passive: true });
  /* v3.0.5: touchMOVE statt touchstart — am Handy ist bloßes Antippen (Beast-
     Schalter, irgendeine Stelle) unvermeidlich und darf die Führung nicht
     beenden; erst eine echte Wisch-Bewegung ist „ich übernehme". */
  window.addEventListener("touchmove", uebernahme, { passive: true });
  window.addEventListener("keydown", uebernahme);
  fuehrung = mein;
}

/* Einmal je Lauf beim ersten getippten Zeichen: Eine in der Wartephase
   abgegebene Fuehrung wird zurueckgeholt (Details bei karteZeigen). Ein
   zweites Mal passiert das nicht — `tippPhase` merkt sich das. */
function fuehrungZumTippenNeuScharf() {
  if (!fuehrung || fuehrung.tippPhase) return;
  fuehrung.tippPhase = true;
  if (fuehrung.aktiv) return; /* nie abgegeben — nichts zu tun */
  fuehrungBeenden();
  fuehrungStarten();
  if (fuehrung) fuehrung.tippPhase = true;
}

/* Lauf-Ende (Enthüllungs-Abschluss, Fehler, Abbruch): Wache und Zustand
   restlos weg — der nächste Durchgang beginnt mit frischer Führung. */
function fuehrungBeenden() {
  if (!fuehrung) return;
  fuehrungListenerEntfernen(fuehrung);
  fuehrung = null;
}

/* Darf gerade automatisch gescrollt werden? (Die reduzierte Bewegung prüft
   jede Scroll-Stelle zusätzlich selbst — frisch gelesen über reduziert().) */
function fuehrungAktiv() {
  return !!(fuehrung && fuehrung.aktiv);
}

/* „Mehrheitlich im Sichtfeld": mehr als die halbe Box-Höhe liegt im Fenster.
   Degenerierte Messwerte (Höhe 0) gelten als sichtbar — im Zweifel lieber
   ein Ton zu viel als eine stumm gewordene Enthüllung. */
/**
 * Die WIRKLICH sichtbare Hoehe des Fensters.
 *
 * ANLASS (User-Befund am iPhone, 30.08.2026, mit Foto belegt): Das Scan-Auge
 * stand angeschnitten hinter der Safari-Adressleiste und wurde nicht
 * hochgeholt — am Desktop funktionierte dasselbe einwandfrei.
 *
 * Grund: `window.innerHeight` zaehlt auf iOS die eingeblendete Adress- und
 * Werkzeugleiste MIT. Fuer die Rechnung lag das Auge damit im Bild, fuer das
 * Auge des Nutzers lag es dahinter. Der Unterschied betraegt auf einem iPhone
 * leicht 100 Bildpunkte — genug, um ein Element vollstaendig zu verdecken.
 *
 * `visualViewport.height` meldet die Flaeche, die tatsaechlich zu sehen ist,
 * und aendert sich mit, wenn die Leisten ein- oder ausfahren. Wo es das nicht
 * gibt (aeltere Browser), bleibt es beim bisherigen Wert — dort war die
 * Rechnung ohnehin richtig.
 */
function sichtbareHoehe() {
  try {
    const vv = window.visualViewport;
    if (vv && typeof vv.height === "number" && vv.height > 0) return vv.height;
  } catch (_e) {
    /* Kein visualViewport — der Rueckfall unten gilt. */
  }
  return window.innerHeight || document.documentElement.clientHeight || 0;
}

function imSichtfeld(el) {
  try {
    const rechteck = el.getBoundingClientRect();
    const fensterHoehe = sichtbareHoehe();
    const ueberlappung = Math.min(rechteck.bottom, fensterHoehe) - Math.max(rechteck.top, 0);
    return ueberlappung >= rechteck.height / 2;
  } catch (_e) {
    return true;
  }
}

/* Sanft in die Bildmitte holen. Der reduzierte Modus scrollt NIE automatisch;
   die Vorgabe wird frisch gelesen, damit ein Umstellen mitten im Lauf sofort
   greift. Nur noch fuer das Scan-Auge VOR dem Tippen. */
function sanftZentrieren(el) {
  if (reduziert()) return;
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* Abstand der Blockoberkante zur Sichtkante, damit nichts angeschnitten wirkt. */
const LESBAR_RAND_PX = 24;

/**
 * Holt den Profiltext-Block so ins Bild, dass moeglichst viel davon lesbar
 * ist: Oberkante knapp unter die Sichtkante, der Text waechst dann nach unten
 * ins Fenster hinein.
 *
 * WARUM ABSOLUT UND UNBEDINGT (User, 29.08.2026): Vorher wurde nur gescrollt,
 * wenn der Block NICHT mehrheitlich im Bild stand — dadurch verhielt sich die
 * Seite auf dem Desktop anders als am Handy und im Beast-Modus anders als in
 * der serioesen Analyse. Jetzt wird immer dieselbe Zielposition angefahren.
 * Steht der Block schon dort, bewegt sich nichts: gleiche Regel, kein Ruckeln.
 */
function blockLesbarMachen(el) {
  if (reduziert() || !el) return;
  try {
    const rechteck = el.getBoundingClientRect();
    const obenJetzt = window.scrollY || window.pageYOffset || 0;
    const ziel = Math.max(0, obenJetzt + rechteck.top - LESBAR_RAND_PX);
    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: ziel, behavior: "smooth" });
    }
  } catch (_e) {
    /* Eine misslungene Messung darf den Lauf nie stoeren. */
  }
}

/* Liegt das Element mit seiner GANZEN Hoehe im Fenster? Strenger als
   imSichtfeld(), das die halbe Hoehe genuegen laesst. Ein kleiner Rand bleibt
   zugestanden, damit ein einzelnes Pixel keine Dauerkorrektur ausloest. */
const VOLL_SICHTBAR_TOLERANZ_PX = 8;
function vollSichtbar(el) {
  try {
    const r = el.getBoundingClientRect();
    const h = sichtbareHoehe();
    return r.top >= -VOLL_SICHTBAR_TOLERANZ_PX && r.bottom <= h + VOLL_SICHTBAR_TOLERANZ_PX;
  } catch (_e) {
    return true; /* Im Zweifel nicht scrollen. */
  }
}

/* Takt und Dauer der Auge-Nachwache: ~44 s decken jede Scan-Phase ab. */
const AUGE_WACHE_TAKT_MS = 400;
const AUGE_WACHE_VERSUCHE_MAX = 110;

/**
 * Hält das Scan-Auge nach der Foto-/Demo-Wahl im Sichtfeld (api.js ruft das
 * beim Analyse-Beginn, direkt nach fuehrungStarten). Grund (User, 11.08.
 * abends): „Am Handy sieht man das Foto, aber nicht, dass etwas passiert."
 *
 * WICHTIG — eine Einmal-Prüfung genügt NICHT (Innenleben-Protokoll 11.08.
 * spätabends): Beim Aufruf steht das Auge oft noch im Bild (top≈518), dann
 * lädt die Foto-Vorschau asynchron fertig, das Layout wächst und schiebt das
 * Auge unter die Sichtkante (top≈783+) — und niemand schaute mehr hin. Genau
 * so blieb der Handy-Scroll dreimal aus. Deshalb WACHT diese Funktion bis
 * zum Tipp-Start: alle AUGE_WACHE_TAKT_MS prüfen, und je „aus dem Bild
 * gerutscht"-Episode genau EIN sanfter Scroll (kein Dauer-Ziehen — erst wenn
 * das Auge zwischendurch wieder sichtbar war, darf erneut gescrollt werden).
 * Nutzer-Übernahme (Wischen/Rad/Tasten) beendet die Wache sofort; übernimmt
 * die Live-Karte (Tippen), ist die Wache fertig. Desktop, Auge dauerhaft im
 * Bild: es bewegt sich weiterhin NICHTS.
 */
export function augeInsBild(versuch = 0, zustand = { gescrollt: false }, kennung = fuehrungsLauf) {
  /* KA-05: Tick einer Kette aus einem FRÜHEREN Lauf — sofort sterben, sonst
     wachen nach einem schnellen Neustart zwei Ketten nebeneinander. */
  if (kennung !== fuehrungsLauf) return;
  if (!fuehrungAktiv()) return;
  /* Tipp-Phase erreicht: Ab hier führen Karte und Tipp-Nachscrollen. */
  if (elements.liveKarte && elements.liveKarte.classList.contains("active")) return;
  const auge = elements.scanAnim;
  const steht = (() => {
    try {
      return !!auge && auge.classList.contains("active") && auge.getBoundingClientRect().height > 0;
    } catch (_e) {
      return false;
    }
  })();
  if (steht) {
    /* GANZ sichtbar, nicht nur mehrheitlich (User, 29.08.2026: „Das Auge wird
       nicht im Bild gehalten, das ist abgeschnitten."). Die halbe-Hoehe-Regel
       von imSichtfeld() genuegt hier nicht: Ein zur Haelfte angeschnittenes
       Auge gilt danach als sichtbar und wurde nie nachgezogen — sichtbar war
       dann ein halber Kreis am Bildrand. */
    if (vollSichtbar(auge)) {
      zustand.gescrollt = false;
    } else if (!zustand.gescrollt) {
      sanftZentrieren(auge);
      zustand.gescrollt = true;
    }
  }
  if (versuch < AUGE_WACHE_VERSUCHE_MAX) {
    setTimeout(() => augeInsBild(versuch + 1, zustand, kennung), AUGE_WACHE_TAKT_MS);
  }
}

/* Tipp-Nachscrollen (v3.0.3): hält die letzte getippte Zeile im Bild. Nur
   nach unten, nur wenn der Cursor unter die Sichtkante (mit Puffer) gerutscht
   ist, und gedrosselt — nicht bei jedem Zeichen (NACHSCROLL_TAKT_MS). */
function tippNachscrollen(mein) {
  if (!fuehrungAktiv() || reduziert()) return;
  const jetzt = Date.now();
  if (jetzt - mein.nachscrollZuletzt < NACHSCROLL_TAKT_MS) return;
  mein.nachscrollZuletzt = jetzt;
  const cursor = elements.liveCursor;
  if (!cursor) return;
  try {
    const rechteck = cursor.getBoundingClientRect();
    const fensterHoehe = sichtbareHoehe();
    /* Wie weit steht der Cursor unter der Sichtkante? Negativ/null = noch im
       Bild → nichts tun. Es wird NIE nach oben gescrollt — wer hochgeblättert
       hat, hat übernommen und die Führung ist ohnehin beendet. */
    const ueberhang = rechteck.bottom - (fensterHoehe - NACHSCROLL_PUFFER_PX);
    if (ueberhang <= 0) return;
    if (typeof window.scrollBy === "function") {
      window.scrollBy({ top: ueberhang, behavior: "smooth" });
    }
  } catch (_e) {
    /* Eine misslungene Messung darf das Tippen nie stören. */
  }
}

/* ── Warte-Auge oberhalb der Karte (v3.0.2, ersetzt die Status-Zeile) ─────
   Nach dem fertig getippten Text wirkte die Karte eingefroren, und die
   frühere Status-Zeile IN der Karte war ein Dorn im Auge
   („gefällt mir gar nicht"). Stattdessen kehrt das vertraute Auge der
   Scan-Phase zurück und trägt die ehrlichen Warte-Zeilen (`live.warten`).
   Textwechsel ist keine Bewegung — die Rotation läuft deshalb bewusst auch
   bei prefers-reduced-motion. Beides über die BESTEHENDEN Bausteine aus
   ui.js (startScanAnim/stopScanAnim), leise: Das Wieder-Erscheinen des
   Auges ist weder ein Analyse-Start noch ein Abschluss — hier darf keine
   Screenreader-Ansage fallen. */

function rotationStarten(mein) {
  if (mein.spinnerZustand === "warten") return;
  mein.spinnerZustand = "warten";
  startScanAnim(false, true);
  const liste = t("live.warten");
  const texte = Array.isArray(liste) ? liste : [];
  /* i18n-Fallback: Ohne Liste arbeitet das Auge mit dem stehenden Text. */
  if (texte.length === 0) return;
  const meineRunde = ++mein.rotationRunde;
  (async () => {
    let i = 0;
    while (!mein.stop && mein.spinnerZustand === "warten" && mein.rotationRunde === meineRunde) {
      if (elements.scanText) elements.scanText.textContent = texte[i % texte.length];
      i += 1;
      if (!(await warte(ROTATION_TAKT_MS, mein))) return;
    }
  })();
}

/* Beast gewählt, aber noch kein Beast-Zeichen da (das Modell schreibt Beast
   NACH dem Standard-Profil): das Auge mit festem Warte-Text statt Rotation. */
function beastWarteZeigen(mein) {
  if (mein.spinnerZustand === "beastWartet") return;
  mein.spinnerZustand = "beastWartet";
  /* Eine eventuell laufende Rotations-Schleife entwerten. */
  mein.rotationRunde += 1;
  startScanAnim(false, true);
  if (elements.scanText) elements.scanText.textContent = t("live.beastWartet");
}

function spinnerVerstecken(mein) {
  if (!mein.spinnerZustand) return;
  mein.spinnerZustand = null;
  mein.rotationRunde += 1;
  stopScanAnim(true);
}

/* Stellt das Warte-Auge je nach Lage des AKTIVEN Puffers: Beast-Warten hat
   Vorrang, danach gilt schlicht „Puffer leer → Auge an, es tippt → Auge
   aus". Vor dem ersten getippten Zeichen (Karte noch zu) bleibt das Auge
   der Anfangsphase samt seinen Scan-Texten unangetastet. Die Tipp-Schleife
   ruft spinnerVerstecken je Zeichen — ein billiger No-Op, solange das Auge
   ohnehin aus ist. */
function spinnerAktualisieren(mein) {
  if (!elements.liveKarte || !elements.liveKarte.classList.contains("active")) return;
  /* Nach der Fertig-Meldung des Servers (Schnellvorlauf) wäre jede
     Warte-Zeile gelogen — gleich beginnt die Enthüllung. Das Auge bleibt
     (oder geht) aus, statt für Millisekunden aufzublitzen. */
  if (mein.schnellvorlauf) {
    spinnerVerstecken(mein);
    return;
  }
  const p = mein.puffer[mein.aktiv];
  /* „Beast wartet" nur, solange das Modell noch GAR NICHTS geliefert hat —
     liegt schon Text bereit, tippt der nächste Tick sofort los, und ein
     kurz aufblitzendes Auge wäre nur Unruhe. */
  if (mein.aktiv === "beast" && p.text.length === 0) beastWarteZeigen(mein);
  else if (p.fest > 0 && p.fest >= p.text.length) rotationStarten(mein);
  else spinnerVerstecken(mein);
}

/* Blendet die Live-Karte ein und versteckt die Scan-Animation — genau beim
   ersten sichtbaren Zeichen, nicht früher. Leise (ohne Screenreader-
   „abgeschlossen"-Ansage): das erste getippte Zeichen ist kein Abschluss. */
function karteZeigen() {
  liveLief = true;
  const karte = elements.liveKarte;
  if (!karte || karte.classList.contains("active")) return;
  karte.classList.add("active");
  /* „Noch nicht fertig"-Dauerstatus, solange getippt wird. */
  if (elements.liveWarten) elements.liveWarten.textContent = t("live.nochNichtFertig");
  stopScanAnim(true);
  /* Der Tippbeginn stellt die Fuehrung genau einmal neu scharf.

     GRUND (User, 29.08.2026, wortwoertlich): „Ich lade das Bild hoch, scrolle
     etwas nach oben, waehrend noch das Auge angezeigt wird. Dann faengt die KI
     an zu tippen, aber es wird nicht nachgescrollt."

     Die Uebernahme-Wache beendete die Fuehrung beim ersten Rad-Ereignis —
     auch wenn es lange vor dem Tippen kam, aus blosser Neugier waehrend der
     Wartezeit. Danach war alles tot: die Ausrichtung des Blocks UND das
     Nachruecken der Zeile. Wer waehrend des Wartens scrollt, sagt aber nur
     „ich schaue mich um", nicht „ich uebernehme fuer den Rest des Laufs".

     Ab hier gilt der Vorrang neu und dann bis zum Ende: Wer WAEHREND des
     Tippens scrollt, uebernimmt endgueltig. */
  fuehrungZumTippenNeuScharf();
  if (fuehrungAktiv()) blockLesbarMachen(karte);
}

/* FEATURE-2026-08-29-01: Kategorie-Karten, die das Modell bereits geschrieben
   hat. Sie erscheinen NICHT hier im Live-Bereich, sondern in ihrem normalen
   Layout weiter unten — und erst, wenn der Profiltext fertig getippt ist. */
let liveKarten = { standard: [], beast: [] };

/**
 * Zeigt die angekommenen Karten, sobald der Profiltext ausgetippt ist.
 *
 * DIE REIHENFOLGE IST DIE ANFORDERUNG: erst der Text „So denkt die KI über
 * dich", dann die Karten. Am 29.08. im Emulator gesehen, was sonst passiert:
 * Karten standen da, während der Text noch tippte — als wären sie Teil
 * desselben Absatzes. Der Tippeffekt hat bewusst 25 s Anlauf, die Karten
 * überholten ihn dadurch um genau diese Zeitspanne.
 *
 * `fest >= text.length` heißt: Der Tippeffekt hat den gelieferten Text
 * eingeholt. Im Betrieb ist der Profiltext lange vor den Karten fertig — das
 * Modell schreibt ihn zuerst —, die Bedingung greift also rechtzeitig.
 */
let zuletztGezeigt = { standard: 0, beast: 0 };
/* Schritt 2 der Reihenfolge passiert genau einmal je Lauf; der Wert ist der
   Zeitpunkt, damit das Kartengerüst danach mit Abstand folgt. */
let datenUndKarteGezeigt = 0;
/* Was während des Laufs bereits sichtbar war, darf die Enthüllung am Ende
   NICHT noch einmal verstecken. Genau das erzeugte das Aufblitzen: Alles war
   schon da, verschwand kurz und wurde im alten Takt neu aufgedeckt. */
let fruehGezeigt = { daten: false, fakten: false };
/* Abstand wie zwischen zwei Boxen der Enthüllung. */
const DATEN_VOR_KARTEN_MS = 1200;

function kartenPruefen() {
  if (!lauf) return;
  const modus = lauf.aktiv;
  const p = lauf.puffer[modus];
  if (!p || p.text.length === 0 || p.fest < p.text.length) return;
  /* REIHENFOLGE (Anforderung des Nutzers, 29.08.):
       1. Profiltext „So denkt die KI über dich"
       2. Die versteckten Daten im Foto und die Landkarte
       3. Die Kategorie-Boxen, nach und nach
     Schritt 2 einmal je Lauf, bevor die erste Karte erscheint. Beide brauchen
     den Server nicht — der Browser hat EXIF und GPS längst. */
  if (!datenUndKarteGezeigt) {
    if (zeigeVersteckteDatenUndKarte()) fruehGezeigt.daten = true;
    datenUndKarteGezeigt = Date.now();
    return; /* Das Kartengerüst kommt erst danach, nicht im selben Moment. */
  }
  /* Dieselbe Pause wie in der Enthüllung zwischen zwei Boxen — die versteckten
     Daten und die Karte sollen erst ankommen, bevor das Kartengerüst erscheint.
     Ohne diesen Abstand erschien beides gleichzeitig und die Reihenfolge war
     nicht mehr zu erkennen. */
  if (Date.now() - datenUndKarteGezeigt < DATEN_VOR_KARTEN_MS) return;

  const liste = liveKarten[modus] || [];
  /* NUR rendern, wenn wirklich eine Karte dazugekommen ist.
     Diese Prüfung wird aus der Tipp-Schleife aufgerufen, also bei jedem
     Buchstaben. Ohne die Sperre baute sich das Kartenfeld vielmals pro Sekunde
     neu auf, die Einblendung begann jedes Mal von vorn — sichtbar blieben nur
     die Gruppen-Überschriften über leerem Raum (am 29.08. so beobachtet). */
  if (liste.length === 0 || liste.length === zuletztGezeigt[modus]) return;
  zuletztGezeigt[modus] = liste.length;
  zeigeLiveKarten(liste);
  fruehGezeigt.fakten = true;
}

/* Setzt die Karte vollständig zurück (unsichtbar, ohne Text). */
function karteEntfernen() {
  const karte = elements.liveKarte;
  if (karte) karte.classList.remove("active");
  if (elements.liveTextFest) elements.liveTextFest.textContent = "";
  if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
  if (elements.liveWarten) elements.liveWarten.textContent = "";
  /* FEATURE-2026-08-29-01: Karten gehören zum Lauf, nicht zur Seite.

     `fruehGezeigt` wird hier BEWUSST NICHT zurückgesetzt: `karteEntfernen()`
     läuft auch zu Beginn der Enthüllung, und die muss noch wissen, was während
     des Laufs bereits sichtbar war. Sonst versteckt sie alles erneut und deckt
     es im alten Takt wieder auf — das Aufblitzen. Zurückgesetzt wird beim
     Start des nächsten Laufs (neuerLauf). */
  liveKarten = { standard: [], beast: [] };
  zuletztGezeigt = { standard: 0, beast: 0 };
  datenUndKarteGezeigt = 0;
  liveKartenZuruecksetzen();
}

/* Nimmt alle Verdeckungen einer (abgebrochenen) Enthüllung zurück. Muss vor
   allem die DAUERHAFTEN Container (#privacy, #gpsMap) erwischen — deren
   Klassen überleben ein Neu-Rendern, anders als die Karten darin. */
function allesAufdecken() {
  document.querySelectorAll(".lv-verdeckt").forEach((el) => el.classList.remove("lv-verdeckt"));
}

/* Das aktuelle Tipp-Tempo in Zeichen pro Sekunde — bei JEDEM Tick neu, denn
   der Rest wächst mit jeder Welle und schrumpft mit jedem Zeichen. Nach der
   Fertig-Meldung des Servers gilt stattdessen das Schnellvorlauf-Tempo. */
function aktuellesTempo(mein, rest) {
  if (mein.schnellvorlauf) return SCHNELLVORLAUF_ZEICHEN_PRO_SEKUNDE;
  return Math.min(Math.max(rest / ZIEL_ABTROPF_SEKUNDEN, MIN_ZEICHEN_PRO_SEKUNDE), MAX_ZEICHEN_PRO_SEKUNDE);
}

/* ── Tipp-Schleife (Matrix-Dekodierung) ──────────────────────────────────
   Unregelmäßiger Klang-Rhythmus wie im Film: Zufallsabstand 3–15 Zeichen,
   15 % Chance auf eine verlängerte Atempause, Anschlagstärke 0,5–1,05 —
   ein fester Takt wirkt maschinell und stressig. */
async function tippSchleife(mein) {
  let naechsterTon = 3;
  while (!mein.stop) {
    /* Zeit-Anlauf: Noch nicht tippen — draußen trägt die Scan-Animation die
       Wartezeit. Der Schnellvorlauf (Server fertig) bricht den Anlauf ab. */
    if (!mein.schnellvorlauf && Date.now() < mein.tippStartAb) {
      if (!(await warte(LEERLAUF_MS, mein))) return;
      continue;
    }
    /* Immer der Puffer des AKTUELL gewählten Modus — modusWechsel() stellt
       `aktiv` um, der nächste Tick tippt nahtlos am anderen Stand weiter. */
    const p = mein.puffer[mein.aktiv];
    /* Sobald der Text eingeholt ist, dürfen die Karten erscheinen. Ohne diesen
       Aufruf warteten sie auf die nächste Welle (bis zu 2 s). */
    kartenPruefen();
    if (p.fest < p.text.length) {
      /* Die Scan-Animation weicht der Karte GENAU in dem Moment, in dem das
         erste Zeichen sichtbar wird — nie früher: Eine Karte, in der nur der
         Cursor blinkt, wirkt wie ein Hänger (Befund des ersten Live-Tests). */
      karteZeigen();
      p.fest += 1;
      /* Es wird wieder getippt → das Warte-Auge verschwindet (v3.0.2):
         das Tippen selbst IST die sichtbare Bewegung. */
      spinnerVerstecken(mein);
      if (elements.liveTextFest) elements.liveTextFest.textContent = p.text.slice(0, p.fest);
      /* Rausch-Schweif NUR bei Bewegung — und nie länger als der Rest. */
      const rest = Math.min(SCHWEIF_LAENGE, p.text.length - p.fest);
      let rausch = "";
      for (let i = 0; i < rest; i++) rausch += zufallsZeichen();
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = rausch;
      /* Die zuletzt getippte Zeile bleibt im Bild (User, 29.08.2026:
         „gescrollt wird, während man immer die unterste Linie auch sieht") —
         gedrosselt, nie bei jedem Zeichen (Details bei tippNachscrollen). */
      tippNachscrollen(mein);
      naechsterTon -= 1;
      if (naechsterTon <= 0) {
        naechsterTon = 3 + Math.floor(Math.random() * 12);
        if (Math.random() < 0.15) naechsterTon += 12; /* kurze Atempause */
        tippTon(0.5 + Math.random() * 0.55);
      }
      if (!(await warte(1000 / aktuellesTempo(mein, p.text.length - p.fest), mein))) return;
    } else {
      /* Puffer leer: Schweif weg, der Cursor blinkt (CSS), wir warten auf
         die nächste Welle — und oberhalb der Karte übernimmt das Warte-Auge
         mit den ehrlichen Warte-Zeilen (v3.0.2). */
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
      spinnerAktualisieren(mein);
      if (!(await warte(LEERLAUF_MS, mein))) return;
    }
  }
}

/**
 * Nimmt den Live-Text-Stand einer processing-Antwort entgegen (api.js ruft
 * das bei jeder 2-s-Poll-Antwort auf): `{ standard, beast }` — der Server
 * liefert je Feld den GESAMTEN bisher angekommenen Text, kein Delta;
 * kürzere oder gleiche Stände sind alte Antworten und werden je Puffer
 * ignoriert. `beast` ist null, solange das Modell das Beast-Profil noch
 * nicht begonnen hat (es schreibt sequenziell: Standard zuerst).
 */
/**
 * Uebernimmt einen neuen Stand in einen Puffer — oder eben nicht.
 *
 * ZWEI BEDINGUNGEN, und die zweite ist eine Zusicherung an den Nutzer
 * (v3.3.1): Der Text, den er BEREITS GELESEN hat, wird nie wieder angetastet.
 *
 *   1. Nur laengere Staende zaehlen. Kuerzere oder gleiche sind alte
 *      Antworten, die verspaetet eintrudeln.
 *   2. Der neue Stand muss mit dem bereits GETIPPTEN Teil beginnen. Taete er
 *      das nicht, wuerde sich Sichtbares vor den Augen des Nutzers aendern —
 *      genau das, was beim Verbindungsabbruch niemand erleben soll.
 *
 * Geprueft wird gegen `fest` (das Getippte), nicht gegen den ganzen Puffer:
 * Der noch ungetippte Rest ist unsichtbar und darf sich korrigieren, etwa
 * wenn der Server-Extraktor eine halb angekommene Escape-Sequenz spaeter
 * sauber aufloest. Gegen den ganzen Puffer geprueft koennte genau so ein
 * Zwischenstand die Anzeige dauerhaft einfrieren.
 */
function uebernehmen(puffer, neu) {
  if (typeof neu !== "string") return;
  if (neu.length <= puffer.text.length) return;
  if (!neu.startsWith(puffer.text.slice(0, puffer.fest))) return;
  puffer.text = neu;
}

export function welle(texte) {
  if (!texte || typeof texte.standard !== "string" || texte.standard.length === 0) return;
  /* Späte Wellen nach Beginn der Enthüllung ändern nichts mehr. */
  if (enthuellungGestartet) return;
  if (!lauf) lauf = neuerLauf();
  /* Sicherheitsnetz: Normalerweise startet api.js die Blick-Führung beim
     Analyse-Beginn — kam der Aufruf nicht (direkter Modul-Gebrauch, Tests),
     beginnt sie spätestens mit der ersten Welle. Ein bestehender
     Übernahme-Zustand bleibt dabei unangetastet. */
  fuehrungStarten();
  /* Je Puffer monoton wachsend übernehmen — kürzere oder gleiche Stände sind
     alte Antworten. Ob eine Lieferung „fertig" ist, spielt seit v3.0.2 keine
     Rolle mehr: Das Warte-Auge richtet sich allein danach, ob gerade getippt
     wird oder der Puffer leerläuft. */
  uebernehmen(lauf.puffer.standard, texte.standard);
  uebernehmen(lauf.puffer.beast, texte.beast);
  /* FEATURE-2026-08-29-01: Karten derselben Welle mitnehmen. Nur wachsende
     Listen übernehmen — eine kürzere Lieferung ist eine überholte Antwort,
     genau wie beim Text. Gezeigt werden sie erst, wenn der Text steht. */
  for (const [modus, neue] of [
    ["standard", texte.kartenStandard],
    ["beast", texte.kartenBeast],
  ]) {
    if (Array.isArray(neue) && neue.length > liveKarten[modus].length) liveKarten[modus] = neue;
  }
  kartenPruefen();

  if (reduziert()) {
    /* Barrierefreiheit: kein Tippen, kein Rausch — jede Welle erscheint
       sofort vollständig, angezeigt wird der Puffer des gewählten Modus. */
    lauf.puffer.standard.fest = lauf.puffer.standard.text.length;
    lauf.puffer.beast.fest = lauf.puffer.beast.text.length;
    const p = lauf.puffer[lauf.aktiv];
    const karteAktiv = elements.liveKarte && elements.liveKarte.classList.contains("active");
    /* Solange der gewählte Modus nichts Sichtbares hat (Beast gewählt, aber
       noch leer) und die Karte nie erschien, bleibt die Scan-Animation. */
    if (p.fest === 0 && !karteAktiv) return;
    karteZeigen();
    if (elements.liveTextFest) elements.liveTextFest.textContent = p.text;
    if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
    /* Das Warte-Auge läuft AUCH bei reduzierter Bewegung — ein Textwechsel
       alle 2,5 s ist keine Bewegung, und ohne Tipp-Schleife gibt es hier
       sonst niemanden, der es stellt. Ohne Tippen ist der Puffer nach jeder
       Welle sofort „leer" — das Auge trägt hier also die gesamte Wartezeit. */
    spinnerAktualisieren(lauf);
    return;
  }

  /* Die Tipp-Schleife startet mit der ersten Lieferung, tippt aber erst nach
     dem Zeit-Anlauf los — bis dahin sammelt der Puffer Material und die
     Scan-Animation trägt die Wartezeit (Nachschliff nach dem Live-Test
     11.08.: Sofort-Start bedeutete minutenlanges Kriech-Tempo). */
  if (!lauf.tippt && (lauf.puffer.standard.text.length > 0 || lauf.puffer.beast.text.length > 0)) {
    lauf.tippt = true;
    lauf.tippStartAb = Date.now() + TIPP_ANLAUF_MS;
    tippSchleife(lauf);
  }
}

/**
 * Meldet, dass der Server fertig ist (api.js ruft das bei `done`, BEVOR das
 * Ergebnis gerendert wird): Der noch ungetippte Rest des aktiven Puffers
 * wird im Schnellvorlauf ausgetippt; das zurückgegebene Versprechen löst
 * auf, sobald er durch ist — erst dann darf die Enthüllung starten, sonst
 * endet das Tippen mitten im Wort mit einem harten Sprung ins Ergebnis.
 * Ohne gelaufenen Live-Text (oder bei reduzierter Bewegung, wo der Text
 * längst vollständig steht) löst es sofort auf.
 */
export function schnellVorlauf() {
  return new Promise((aufloesen) => {
    const mein = lauf;
    /* Zuständig, sobald ein Lauf mit geliefertem Text existiert — AUCH wenn
       noch kein Zeichen getippt wurde (Fertig-Meldung mitten im Zeit-Anlauf):
       Der Schnellvorlauf bricht den Anlauf ab und tippt sichtbar aus, statt
       die Live-Dramaturgie komplett zu überspringen. Ohne gelieferten Text
       (z. B. Wiederaufnahme nach Neuladen — die tippt bewusst nie) sofort
       auflösen. */
    const geliefert = mein && mein.puffer[mein.aktiv].text.length > 0;
    if (!mein || !geliefert || enthuellungGestartet) {
      aufloesen();
      return;
    }
    mein.schnellvorlauf = true;
    /* Not-Deckel: Das fertige Ergebnis darf hier nie hängen bleiben. */
    const frist = Date.now() + SCHNELLVORLAUF_DECKEL_MS;
    (function pruefe() {
      const p = mein.puffer[mein.aktiv];
      if (mein.stop || p.fest >= p.text.length || Date.now() > frist) {
        aufloesen();
        return;
      }
      setTimeout(pruefe, 50);
    })();
  });
}

/**
 * Meldet einen Wechsel des Beast-Schalters (app.js ruft das im
 * change-Listener). Mitten im Tippen springt die Anzeige SOFORT auf den
 * Puffer des neuen Modus: dessen bereits getippter Stand erscheint, dort
 * wird weitergetippt — kein Neustart von vorn. Ist der Beast-Puffer noch
 * leer, zeigt die Karte den Warte-Status mit blinkendem Cursor. Ohne
 * laufenden Live-Text oder nach Beginn der Enthüllung ein No-Op — die
 * bestehende „keine erneute Enthüllung"-Logik bleibt unberührt.
 */
export function modusWechsel() {
  if (!lauf || enthuellungGestartet) return;
  const neu = aktiverModus();
  if (neu === lauf.aktiv) return;
  lauf.aktiv = neu;
  /* Der andere Modus hat eigene Karten: Inhalte neu setzen, Gerüst behalten. */
  zuletztGezeigt[neu] = 0;
  liveKartenModusWechsel();
  /* Nur eine bereits sichtbare Karte sofort neu zeichnen — vor dem ersten
     getippten Zeichen gibt es nichts umzuschalten (die Tipp-Schleife nimmt
     den neuen Puffer von selbst beim nächsten Tick). */
  if (!elements.liveKarte || !elements.liveKarte.classList.contains("active")) return;
  const p = lauf.puffer[neu];
  if (elements.liveTextFest) elements.liveTextFest.textContent = p.text.slice(0, p.fest);
  if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
  /* Das Warte-Auge folgt dem neuen Puffer: Beast noch leer → fester
     Warte-Text; fertig getippt → Rotation; es tippt → Auge aus. */
  spinnerAktualisieren(lauf);
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
  /* Nach dem Profiltext wird nicht mehr automatisch gescrollt (User,
     29.08.2026) — auch nicht fuer die aufpoppenden Boxen. Der Ton klingt
     deshalb nur noch fuer Boxen, die wirklich (mehrheitlich) im Sichtfeld
     liegen: keine Geraeusche aus dem Off, waehrend woanders gelesen wird.
     Das gilt jetzt unabhaengig davon, ob der Nutzer schon uebernommen hat —
     dieselbe Regel in jedem Szenario. */
  if (imSichtfeld(el)) popTon();
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

/* Schlussbild der Enthüllung: PDF-Knopf + EINE Screenreader-Ankündigung.
   Eine sichtbare Abschluss-Box gibt es seit v3.0.2 nicht mehr („gefällt mir
   gar nicht, gänzlich weglassen") — der Merksatz steht ohnehin in der
   Ergebnis-Zusammenfassung (.verdict). Angesagt wird der bestehende
   Abschluss-Text der Scan-Phase. */
function abschlussAnzeigen() {
  if (elements.exportPdf) elements.exportPdf.classList.remove("export-btn--hidden");
  /* A11y: die EINE Ankündigung am Ende — nie pro Zeichen, nie pro Box. */
  if (elements.srAnnounce) elements.srAnnounce.textContent = t("scan.srEnd");
  /* „Es steht ein fertiges Profil da." Diese Funktion laeuft an genau zwei
     Stellen — normales Enthuellungs-Ende und Abkuerzen —, im Fehler- und
     Abbruchpfad NIE. Genau deshalb haengt der Beast-Lockruf hier und nicht an
     fuehrungBeenden(), das auch bei Fehlern feuert. Den Fall OHNE Enthuellung
     meldet js/api.js (js/beast-lockruf.js). */
  document.dispatchEvent(new CustomEvent(PROFIL_FERTIG));
}

function abschluss(mein) {
  /* Enthüllungs-Abschluss = Lauf-Ende: die Blick-Führung samt Wache in jedem
     Fall sauber abbauen (v3.0.3: der Zustand gilt für den ganzen Lauf). */
  fuehrungBeenden();
  if (mein.stop) return;
  enthuellung = null;
  abschlussAnzeigen();
}

/**
 * Fährt die gestaffelte Enthüllung über das bereits fertig gerenderte
 * Ergebnis. MUSS synchron unmittelbar nach renderCurrentMode laufen: Das
 * Verdecken passiert im selben Frame wie das Rendern, nichts blitzt auf.
 * Die Zusammenfassung steht ab jetzt in ihrer normalen Box (#simulation);
 * Live-Karte und Warte-Auge verschwinden hier endgültig (v3.0.2) — die
 * Enthüllung erzählt sich über die aufpoppenden Boxen selbst.
 */
export function starteEnthuellung() {
  if (lauf) {
    lauf.stop = true;
    /* Das Warte-Auge endgültig aus — bevor der Lauf entsorgt wird. */
    spinnerVerstecken(lauf);
    lauf = null;
  }
  if (enthuellung) enthuellung.stop = true;
  const mein = { stop: false };
  enthuellung = mein;
  enthuellungGestartet = true;
  /* v3.0.3: Die Blick-Führung des Laufs läuft hier einfach WEITER — hat der
     Nutzer schon während des Tippens übernommen, scrollt auch die Enthüllung
     nicht mehr. Ohne laufende Führung (direkter Aufruf, Tests) startet sie
     jetzt. */
  fuehrungStarten();

  karteEntfernen();
  /* Die Ankündigung von eben leeren: Nur so ist der Abschluss-Text am Ende
     eine NEUE Mutation, die Screenreader zuverlässig wieder ansagen. */
  if (elements.srAnnounce) elements.srAnnounce.textContent = "";

  /* Alles verdecken — synchron, bevor der Browser zeichnet. */
  const privacy = elements.privacy;
  const gps = elements.gpsMap;
  const faktenKinder = elements.facts ? Array.from(elements.facts.children) : [];
  const adsKarte = elements.targeting ? elements.targeting.querySelector(".target-card:not(.warn)") : null;
  const triggerKarte = elements.targeting ? elements.targeting.querySelector(".target-card.warn") : null;
  /* v3.1: Der Realitäts-Check reiht sich zwischen Manipulations- und
     Datenwert-Box ein — aber nur, wenn er für dieses Ergebnis überhaupt
     erscheint (realitaets-check.js hat ihn dann bereits sichtbar gemacht). */
  const rcKarte = elements.realCheck && !elements.realCheck.hidden ? elements.realCheck : null;
  const dvKarte = elements.dataValue ? elements.dataValue.querySelector(".dv-card") : null;
  const boxen = [privacy, gps, adsKarte, triggerKarte, rcKarte, dvKarte];
  /* Was während des Laufs schon sichtbar war, bleibt sichtbar. Sonst
     verschwindet es kurz und wird im alten Takt neu aufgedeckt — das Aufblitzen,
     das der Nutzer am 29.08. beschrieben hat. Die Enthüllung deckt dann nur
     noch auf, was wirklich neu ist. */
  /* Hat der Lauf schon Boxen gezeigt, ist die gestaffelte Enthuellung vorbei
     — sie wuerde Fertiges verstecken und im alten Takt neu aufdecken. Genau
     das sah aus wie ein Neuladen der Seite, und Quiz und Werbewert warteten
     dabei auf Pausen fuer Boxen, die laengst standen. Dann wird nur noch
     gezeigt, was wirklich neu ist: Werbung, Manipulation, Quiz, Werbewert. */
  const nurNeueBoxen = fruehGezeigt.fakten || fruehGezeigt.daten;
  if (nurNeueBoxen) {
    [adsKarte, triggerKarte, rcKarte, dvKarte].forEach((el) => el && el.classList.add("lv-verdeckt"));
  } else {
    boxen.forEach((el) => el && el.classList.add("lv-verdeckt"));
    faktenKinder.forEach((el) => el.classList.add("lv-verdeckt"));
  }
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
    /* 1) Foto-Daten + Standort — nur, wenn sie nicht längst stehen. Für bereits
       Sichtbares entfällt auch die Pause: Sonst wartet der Bildschirm auf ein
       Erscheinen, das gar nicht mehr kommt. */
    if (!nurNeueBoxen) {
      if (!(await warte(700, mein))) return;
      boxZeigen(privacy);
      if (!(await warte(1100, mein))) return;
      boxZeigen(gps);
      gpsKarteNachmessen();
      if (!(await warte(1400, mein))) return;
    } else {
      gpsKarteNachmessen();
    }

    /* 2) Die Kategorien: Gruppenkopf gemächlich, seine Karten im Stakkato.
       Standen sie schon während der Analyse da, gibt es hier nichts mehr
       aufzudecken. */
    if (!nurNeueBoxen) {
      for (const kind of faktenKinder) {
        const istKopf = kind.classList.contains("cat-group-head");
        if (!(await warte(istKopf ? 650 : 280, mein))) return;
        boxZeigen(kind);
      }
    }

    /* 3) Werbung + Manipulation — nur noch ganze, fertige Boxen.

       Standen die Kategorien schon waehrend der Analyse da, wird der Takt
       gestrafft: Der Blick hat den Bildschirm dann laengst erfasst, und die
       vollen Pausen wirken wie Warten ohne Grund. */
    const takt = (voll) => (nurNeueBoxen ? Math.round(voll * 0.45) : voll);
    if (!(await warte(takt(600), mein))) return;
    boxZeigen(adsKarte);
    if (!(await warte(takt(1200), mein))) return;
    boxZeigen(triggerKarte);
    if (!(await warte(takt(1200), mein))) return;

    /* 3b) Realitäts-Check (v3.1): direkt nach der Manipulations-Box und VOR
       dem Datenwert — mit demselben Pop wie alle anderen Boxen. */
    if (rcKarte) {
      boxZeigen(rcKarte);
      if (!(await warte(takt(1200), mein))) return;
    }

    /* 4) Datenwert: Box komplett, nur der Betrag zählt hoch, Balken fahren aus. */
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
  /* Abgekürzt heißt beendet: die Blick-Führung des Laufs endet hier mit. */
  fuehrungBeenden();
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
/**
 * Haelt das Live-Erlebnis an, OHNE etwas wegzuraeumen (v3.3.1).
 *
 * Fuer den Verbindungsabbruch mitten im Schreiben. Bis v3.3.0 rief api.js
 * hier `abbrechen()` — Karte und Text verschwanden, uebrig blieb eine
 * Fehlermeldung. Aus Nutzersicht sah das aus, als haette die Seite alles
 * verloren, obwohl serverseitig nichts verloren war.
 *
 * Jetzt bleibt stehen, was schon dasteht: Die Tipp-Schleife haelt an, der
 * Rausch-Schweif verschwindet (er waere Bewegung ohne Fortschritt), die Karte
 * wird ueber eine CSS-Klasse gedaempft. Die Begruendung traegt die
 * Statuszeile, die api.js ohnehin setzt.
 *
 * @returns {boolean} true, wenn tatsaechlich ein Lauf angehalten wurde.
 */
export function pausieren() {
  if (!lauf || pausiert) return false;
  pausiert = true;
  /* stop beendet die laufende Tipp-Schleife; `lauf` selbst bleibt samt
     Puffern und `fest`-Staenden erhalten — daran knuepft fortsetzen() an. */
  lauf.stop = true;
  lauf.tippt = false;
  spinnerVerstecken(lauf);
  if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
  if (elements.liveKarte) elements.liveKarte.classList.add("live-karte--pausiert");
  return true;
}

/**
 * Nimmt ein pausiertes Live-Erlebnis wieder auf (v3.3.1).
 *
 * Der Puffer und der Stand des bereits Getippten (`fest`) sind unberuehrt
 * geblieben — die Schleife tippt also exakt dort weiter, wo sie angehalten
 * hat. Ohne Zeit-Anlauf: Der Nutzer hat gerade eine Pause erlebt, eine zweite
 * waere Hohn.
 *
 * @returns {boolean} true, wenn tatsaechlich fortgesetzt wurde.
 */
export function fortsetzen() {
  if (!lauf || !pausiert) return false;
  pausiert = false;
  if (elements.liveKarte) elements.liveKarte.classList.remove("live-karte--pausiert");
  lauf.stop = false;
  if (!lauf.tippt) {
    lauf.tippt = true;
    lauf.tippStartAb = 0;
    tippSchleife(lauf);
  }
  return true;
}

/** Laeuft gerade ein pausierter Live-Text? Fuer api.js und die Tests. */
export function istPausiert() {
  return pausiert;
}

export function abbrechen() {
  pausiert = false;
  if (elements.liveKarte) elements.liveKarte.classList.remove("live-karte--pausiert");
  if (lauf) {
    lauf.stop = true;
    /* Ein noch aktives Warte-Auge gehört mit aufgeräumt — sonst bliebe die
       Scan-Animation neben der Fehlermeldung stehen. */
    spinnerVerstecken(lauf);
    lauf = null;
  }
  if (enthuellung) {
    enthuellung.stop = true;
    enthuellung = null;
  }
  /* Fehler/Abbruch = Lauf-Ende: Blick-Führung samt Übernahme-Wache immer mit
     abbauen — auch wenn weder getippt noch enthüllt wurde (v3.0.3: die
     Führung startet schon beim Analyse-Beginn). */
  fuehrungBeenden();
  enthuellungGestartet = false;
  karteEntfernen();
  allesAufdecken();
}

/** Setzt alles für einen neuen Analyse-Durchgang zurück. */
export function zuruecksetzen() {
  abbrechen();
  liveLief = false;
}

/* Nur für Tests: verkürzt oder verlängert den Zeit-Anlauf gezielt —
   echte 10 s wären mit Fake-Timern umständlich und ohne sie unbezahlbar. */
export function _setzeTippAnlaufMsFuerTest(ms) {
  TIPP_ANLAUF_MS = ms;
}
