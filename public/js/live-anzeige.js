/* ── Live-Anzeige (v3.0 „Live-Erlebnis", Phase 2) ──────────────────────────
 *
 * Setzt die vom Inhaber abgenommene Dramaturgie des Prototyps
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
 *      Inhabers, 11.08. abends). Mit dem nächsten getippten Zeichen
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
import { state } from "./state.js";
import { t } from "./i18n.js";
import { startScanAnim, stopScanAnim } from "./ui.js";
import { tippTon, popTon } from "./klang.js";

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
   ausdrücklicher Ansage des Inhabers (Abend-Test 11.08.: 12 Z/s „wirkt
   immer noch total zäh") — der lange Zeit-Anlauf unten sammelt vorher genug
   Material, damit dieses Tempo durchgehalten werden kann. */
const MIN_ZEICHEN_PRO_SEKUNDE = 20;
/* Obergrenze: Darüber ist der Text nicht mehr mitlesbar — schneller darf nur
   der Schnellvorlauf nach der Fertig-Meldung des Servers sein. */
const MAX_ZEICHEN_PRO_SEKUNDE = 90;
/* Zeit-Anlauf vor dem ersten getippten Zeichen: Der Stream liefert anfangs
   nur wenige Zeichen pro Sekunde — sofort loszutippen hieße, minutenlang an
   der Untergrenze zu kriechen. Solange trägt die Scan-Animation die Zeit.
   25 s auf ausdrückliche Ansage des Inhabers (11.08. abends): „die Box ist
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
/* ── Tipp-Nachscrollen (v3.0.3) ──
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
    /* v3.0.3: letzte Sichtkanten-Prüfung des Tipp-Nachscrollens (Drossel). */
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
function imSichtfeld(el) {
  try {
    const rechteck = el.getBoundingClientRect();
    const fensterHoehe = window.innerHeight || document.documentElement.clientHeight || 0;
    const ueberlappung = Math.min(rechteck.bottom, fensterHoehe) - Math.max(rechteck.top, 0);
    return ueberlappung >= rechteck.height / 2;
  } catch (_e) {
    return true;
  }
}

/* Sanft in die Bildmitte holen. Der reduzierte Modus scrollt NIE automatisch;
   die Vorgabe wird frisch gelesen, damit ein Umstellen mitten im Lauf sofort
   greift. */
function sanftZentrieren(el) {
  if (reduziert()) return;
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/**
 * Holt das Scan-Auge nach der Foto-/Demo-Wahl ins Sichtfeld (api.js ruft das
 * beim Analyse-Beginn, direkt nach fuehrungStarten). Grund (User, 11.08.
 * abends): „Am Handy sieht man das Foto, aber nicht, dass etwas passiert."
 * NUR wenn das Auge nicht ohnehin mehrheitlich sichtbar ist — auf dem
 * Desktop, wo es längst im Bild steht, darf sich NICHTS bewegen.
 */
export function augeInsBild(versuch = 0) {
  if (!fuehrungAktiv()) return;
  const auge = elements.scanAnim;
  /* v3.0.5 (Handy-Befund 11.08., 18:15): Beim Analyse-Start ist das Auge oft
     noch gar nicht aufgebaut (ohne .active, Höhe 0) — und ein Null-Höhen-
     Element gilt der Sichtfeld-Regel als „sichtbar" (0 ≥ 0), der Scroll
     unterblieb kommentarlos. Deshalb: erst NACHFASSEN, bis das Auge wirklich
     steht (aktiv UND gemessene Höhe), dann genau einmal anfahren. Bricht der
     Nutzer die Führung ab, sterben auch die Nachfass-Versuche (fuehrungAktiv
     wird je Versuch frisch geprüft). */
  const steht = (() => {
    try {
      return !!auge && auge.classList.contains("active") && auge.getBoundingClientRect().height > 0;
    } catch (_e) {
      return false;
    }
  })();
  if (!steht) {
    if (versuch < 10) setTimeout(() => augeInsBild(versuch + 1), 200);
    return;
  }
  if (imSichtfeld(auge)) return;
  sanftZentrieren(auge);
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
    const fensterHoehe = window.innerHeight || document.documentElement.clientHeight || 0;
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
   frühere Status-Zeile IN der Karte war dem Inhaber ein Dorn im Auge
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
  /* v3.0.3: In dem Moment, in dem die Karte übernimmt, gehört ihr der Blick —
     aber nur, wenn sie nicht ohnehin mehrheitlich im Bild steht (auf dem
     Desktop bewegt sich nichts). */
  if (fuehrungAktiv() && !imSichtfeld(karte)) sanftZentrieren(karte);
}

/* Setzt die Karte vollständig zurück (unsichtbar, ohne Text). */
function karteEntfernen() {
  const karte = elements.liveKarte;
  if (karte) karte.classList.remove("active");
  if (elements.liveTextFest) elements.liveTextFest.textContent = "";
  if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
  if (elements.liveWarten) elements.liveWarten.textContent = "";
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
      /* v3.0.3: Die letzte Zeile bleibt im Bild — gedrosselt, nie bei jedem
         Zeichen (Details bei tippNachscrollen). */
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
  if (texte.standard.length > lauf.puffer.standard.text.length) {
    lauf.puffer.standard.text = texte.standard;
  }
  if (typeof texte.beast === "string" && texte.beast.length > lauf.puffer.beast.text.length) {
    lauf.puffer.beast.text = texte.beast;
  }

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
  if (fuehrung && fuehrung.aktiv) {
    /* Führung aktiv: JEDE gepoppte Box wird aktiv zentriert — ab dem ERSTEN
       Pop (v3.0.3). Erst NACH dem Aufdecken, eine verdeckte Box
       (display:none) hat keinen Ort, zu dem man scrollen könnte. */
    sanftZentrieren(el);
    popTon();
    return;
  }
  /* Der Nutzer hat übernommen: Der Pop klingt nur noch für Boxen, die
     wirklich (mehrheitlich) im Sichtfeld liegen — keine Geräusche aus dem
     Off, während er woanders liest. */
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
    if (!(await warte(700, mein))) return;
    boxZeigen(privacy);
    if (!(await warte(1100, mein))) return;
    boxZeigen(gps);
    gpsKarteNachmessen();
    if (!(await warte(1400, mein))) return;

    /* 2) Die Kategorien: Gruppenkopf gemächlich, seine Karten im Stakkato. */
    for (const kind of faktenKinder) {
      const istKopf = kind.classList.contains("cat-group-head");
      if (!(await warte(istKopf ? 650 : 280, mein))) return;
      boxZeigen(kind);
    }

    /* 3) Werbung + Manipulation — nur noch ganze, fertige Boxen. */
    if (!(await warte(600, mein))) return;
    boxZeigen(adsKarte);
    if (!(await warte(1200, mein))) return;
    boxZeigen(triggerKarte);
    if (!(await warte(1200, mein))) return;

    /* 3b) Realitäts-Check (v3.1): direkt nach der Manipulations-Box und VOR
       dem Datenwert — mit demselben Pop wie alle anderen Boxen. */
    if (rcKarte) {
      boxZeigen(rcKarte);
      if (!(await warte(1200, mein))) return;
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
export function abbrechen() {
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
