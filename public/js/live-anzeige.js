/* ── Live-Anzeige (v3.0 „Live-Erlebnis", Phase 2) ──────────────────────────
 *
 * Setzt die vom Inhaber abgenommene Dramaturgie des Prototyps
 * (compare-prototype-streaming.html, 2026-08-11) auf der echten Seite um:
 *
 *   1. Die bestehende Scan-Animation bleibt, bis das ERSTE Zeichen getippt
 *      wird — dann übernimmt die Live-Karte. Getippt wird ab dem ersten
 *      gelieferten Zeichen (v3.0.2: der frühere 200-Zeichen-Anlauf ist weg —
 *      er ließ die Karte je nach Timing mit leer blinkendem Cursor stehen).
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
 *      Cursor. Tempo-Prinzip (v3.0.2, ADAPTIV statt fester 70 Zeichen/s):
 *      Das Tempo richtet sich bei jedem Tick nach dem ungetippten Rest —
 *      das Tippen soll die Wartezeit der Analyse TRAGEN, nicht in ~7 s
 *      durchrauschen und dann 40+ s Leere hinterlassen (Befund des ersten
 *      Live-Tests). Meldet der Server „fertig", tippt schnellVorlauf() den
 *      Rest zügig aus, DANN erst startet die Enthüllung. Läuft der Puffer
 *      vorzeitig leer, verschwindet der Schweif und der Cursor blinkt.
 *   3. KEIN TOTES FENSTER (v3.0.1, FIX 2): Die Zusammenfassung ist nach
 *      ~15–25 s fertig getippt, die Analyse läuft serverseitig aber noch
 *      ~30–50 s weiter (Kategorien/Beast). Sobald der aktive Puffer fertig
 *      getippt ist UND die Lieferung dieses Modus abgeschlossen ist (eine
 *      Poll-Welle ohne neue Zeichen), rotieren in der Live-Status-Zeile
 *      ehrliche Warte-Zeilen (i18n-Liste `live.warten`, alle ~2,5 s); der
 *      Cursor blinkt weiter. Die Rotation endet bei done/Abbruch und sobald
 *      wieder getippt wird (neue Welle, Modus-Wechsel).
 *   4. Ist das Ergebnis fertig gerendert, fährt starteEnthuellung() die
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
/* ── Adaptives Tipp-Tempo (v3.0.2) ──
   Der Puffer soll über ungefähr diese Spanne abtropfen: Eine echte Analyse
   dauert 50–80 s, der Stream liefert den Text aber schon in den ersten
   ~20–30 s — ein festes Tempo tippte deshalb in ~7 s alles leer und ließ
   danach 40+ s nur die Status-Rotation übrig („die Box fertig, und dann
   passiert überhaupt nichts"). Bei jedem Tick wird deshalb neu gerechnet:
   Rest ÷ ZIEL_ABTROPF_SEKUNDEN — wenig Puffer tippt langsam und lesbar,
   viel Puffer schneller, und das Tippen streckt sich über einen Großteil
   der Analyse. */
const ZIEL_ABTROPF_SEKUNDEN = 30;
/* Untergrenze: Darunter wirkt das Tippen wie ein Hänger statt wie Schreiben —
   auch ein fast leerer Puffer muss sichtbar in Bewegung bleiben. */
const MIN_ZEICHEN_PRO_SEKUNDE = 6;
/* Obergrenze: Darüber ist der Text nicht mehr mitlesbar — schneller darf nur
   der Schnellvorlauf nach der Fertig-Meldung des Servers sein. */
const MAX_ZEICHEN_PRO_SEKUNDE = 90;
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
/* Takt der ehrlichen Warte-Zeilen nach dem fertig getippten Text (FIX 2). */
const ROTATION_TAKT_MS = 2500;

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

function statusSetzen(schluessel) {
  if (elements.liveStatusText) elements.liveStatusText.textContent = t(schluessel);
}

/* Wie statusSetzen, aber mit fertigem Text (die Warte-Rotation zieht ihre
   Zeilen aus einem i18n-ARRAY, nicht aus einem Einzel-Schlüssel). */
function statusSetzenText(text) {
  if (elements.liveStatusText) elements.liveStatusText.textContent = text;
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
    statusZustand: null,
    /* v3.0.2: Der Server hat „fertig" gemeldet — der Rest wird im
       Schnellvorlauf ausgetippt (schnellVorlauf() setzt das). */
    schnellvorlauf: false,
    /* FIX 2: Läuft gerade die Warte-Rotation? (rotationRunde entwertet eine
       alte Rotations-Schleife, wenn eine neue startet.) */
    rotationLaeuft: false,
    rotationRunde: 0,
    puffer: {
      /* `lieferungFertig`: eine Poll-Welle brachte für diesen Puffer keine
         neuen Zeichen mehr — das Modell schreibt an diesem Feld nicht mehr. */
      standard: { text: "", fest: 0, lieferungFertig: false },
      beast: { text: "", fest: 0, lieferungFertig: false },
    },
  };
}

/* Hält die Status-Zeile aktuell: normalerweise „die KI schreibt gerade …",
   beim Warten auf die ersten Beast-Zeichen der eigene Warte-Text (Beast
   entsteht im Modell erst NACH dem Standard-Profil). Ins DOM geschrieben
   wird nur bei einem Zustandswechsel — die Tipp-Schleife ruft das je
   Zeichen. */
function statusAktualisieren(mein) {
  /* Während der Warte-Rotation (FIX 2) gehört die Status-Zeile der Rotation —
     rotationStoppen() setzt den Zustand zurück, dann schreibt der nächste
     Aufruf hier wieder den normalen Status. */
  if (mein.rotationLaeuft) return;
  const wartetAufBeast = mein.aktiv === "beast" && mein.puffer.beast.fest === 0;
  const zustand = wartetAufBeast ? "beastWartet" : "schreibt";
  if (zustand === mein.statusZustand) return;
  mein.statusZustand = zustand;
  statusSetzen(wartetAufBeast ? "live.beastWartet" : "live.statusSchreibt");
}

/* ── Warte-Rotation (FIX 2, v3.0.1) ──────────────────────────────────────
   Nach dem fertig getippten Text wirkte die Karte eingefroren: nur blinkender
   Cursor und der statische Dauerstatus, während der Server noch ~30–50 s an
   Kategorien und Beast-Profil rechnet. Stattdessen rotieren jetzt ehrliche
   Status-Zeilen (`live.warten`). Textwechsel ist keine Bewegung — die Rotation
   läuft deshalb bewusst auch bei prefers-reduced-motion. */

function rotationStarten(mein) {
  if (mein.rotationLaeuft) return;
  const liste = t("live.warten");
  const texte = Array.isArray(liste) ? liste : [];
  /* i18n-Fallback: Ohne Liste bleibt der bisherige Status einfach stehen. */
  if (texte.length === 0) return;
  mein.rotationLaeuft = true;
  mein.statusZustand = "warten";
  const meineRunde = ++mein.rotationRunde;
  (async () => {
    let i = 0;
    while (!mein.stop && mein.rotationLaeuft && mein.rotationRunde === meineRunde) {
      statusSetzenText(texte[i % texte.length]);
      i += 1;
      if (!(await warte(ROTATION_TAKT_MS, mein))) return;
    }
  })();
}

function rotationStoppen(mein) {
  if (!mein.rotationLaeuft) return;
  mein.rotationLaeuft = false;
  /* Zustand zurücksetzen, damit statusAktualisieren den normalen Status
     sofort wieder hinschreibt. */
  mein.statusZustand = null;
}

/* Startet oder stoppt die Warte-Rotation je nach Lage des AKTIVEN Puffers:
   Sie läuft genau dann, wenn er fertig getippt ist UND seine Lieferung
   abgeschlossen ist. */
function warteRotationAktualisieren(mein) {
  const p = mein.puffer[mein.aktiv];
  const fertigGetippt = p.fest > 0 && p.fest >= p.text.length;
  if (fertigGetippt && p.lieferungFertig) rotationStarten(mein);
  else rotationStoppen(mein);
}

/* Blendet die Live-Karte ein und versteckt die Scan-Animation — genau beim
   ersten sichtbaren Zeichen, nicht früher. Leise (ohne Screenreader-
   „abgeschlossen"-Ansage): das erste getippte Zeichen ist kein Abschluss.
   Die Status-Zeile setzt statusAktualisieren (je nach Puffer-Lage). */
function karteZeigen() {
  liveLief = true;
  const karte = elements.liveKarte;
  if (!karte || karte.classList.contains("active")) return;
  karte.classList.remove("live-karte--erzaehler");
  karte.classList.add("active");
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
    /* Immer der Puffer des AKTUELL gewählten Modus — modusWechsel() stellt
       `aktiv` um, der nächste Tick tippt nahtlos am anderen Stand weiter. */
    const p = mein.puffer[mein.aktiv];
    if (p.fest < p.text.length) {
      /* Die Scan-Animation weicht der Karte GENAU in dem Moment, in dem das
         erste Zeichen sichtbar wird — nie früher: Eine Karte, in der nur der
         Cursor blinkt, wirkt wie ein Hänger (Befund des ersten Live-Tests). */
      karteZeigen();
      p.fest += 1;
      /* Es wird wieder getippt → eine laufende Warte-Rotation endet (FIX 2). */
      rotationStoppen(mein);
      statusAktualisieren(mein);
      if (elements.liveTextFest) elements.liveTextFest.textContent = p.text.slice(0, p.fest);
      /* Rausch-Schweif NUR bei Bewegung — und nie länger als der Rest. */
      const rest = Math.min(SCHWEIF_LAENGE, p.text.length - p.fest);
      let rausch = "";
      for (let i = 0; i < rest; i++) rausch += zufallsZeichen();
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = rausch;
      naechsterTon -= 1;
      if (naechsterTon <= 0) {
        naechsterTon = 3 + Math.floor(Math.random() * 12);
        if (Math.random() < 0.15) naechsterTon += 12; /* kurze Atempause */
        tippTon(0.5 + Math.random() * 0.55);
      }
      if (!(await warte(1000 / aktuellesTempo(mein, p.text.length - p.fest), mein))) return;
    } else {
      /* Puffer leer: Schweif weg, der Cursor blinkt (CSS), wir warten auf
         die nächste Welle. Ist der Puffer fertig getippt UND fertig
         geliefert, rotieren die Warte-Zeilen als Fallback (FIX 2). */
      if (elements.liveTextRausch) elements.liveTextRausch.textContent = "";
      warteRotationAktualisieren(mein);
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
  /* Je Puffer monoton wachsend übernehmen. Bringt eine Welle für einen Puffer
     KEINE neuen Zeichen mehr, ist dessen Lieferung abgeschlossen (das Modell
     schreibt weiter — nur eben nicht mehr an diesem Feld); wächst er später
     doch wieder, hebt das die Markierung von selbst auf (FIX 2). */
  if (texte.standard.length > lauf.puffer.standard.text.length) {
    lauf.puffer.standard.text = texte.standard;
    lauf.puffer.standard.lieferungFertig = false;
  } else if (lauf.puffer.standard.text.length > 0) {
    lauf.puffer.standard.lieferungFertig = true;
  }
  if (typeof texte.beast === "string") {
    if (texte.beast.length > lauf.puffer.beast.text.length) {
      lauf.puffer.beast.text = texte.beast;
      lauf.puffer.beast.lieferungFertig = false;
    } else if (lauf.puffer.beast.text.length > 0) {
      lauf.puffer.beast.lieferungFertig = true;
    }
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
    /* FIX 2: Die Warte-Rotation läuft AUCH bei reduzierter Bewegung — ein
       Textwechsel alle 2,5 s ist keine Bewegung, und ohne Tipp-Schleife gibt
       es hier sonst niemanden, der sie startet oder stoppt. */
    warteRotationAktualisieren(lauf);
    statusAktualisieren(lauf);
    return;
  }

  /* v3.0.2: Getippt wird ab dem ERSTEN gelieferten Zeichen — kein Anlauf-
     Puffer mehr. Das adaptive Tempo übernimmt dessen Aufgabe: Bei wenig
     Material tippt es langsam genug, dass der Nachschub der 2-s-Wellen
     locker reicht, statt eine leere Karte blinken zu lassen. */
  if (!lauf.tippt && (lauf.puffer.standard.text.length > 0 || lauf.puffer.beast.text.length > 0)) {
    lauf.tippt = true;
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
    if (!mein || !liveLief || enthuellungGestartet) {
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
  /* FIX 2: Die Warte-Rotation folgt dem neuen Puffer — tippt er noch (oder
     liefert er noch), endet sie und der normale Status kehrt zurück. */
  warteRotationAktualisieren(lauf);
  statusAktualisieren(lauf);
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

    /* 3b) Realitäts-Check (v3.1): direkt nach der Manipulations-Box und VOR
       dem Datenwert — mit demselben Pop wie alle anderen Boxen. */
    if (rcKarte) {
      boxZeigen(rcKarte);
      if (!(await warte(1200, mein))) return;
    }

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
