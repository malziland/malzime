/* ── Sprachumschalter (DE/EN) ─────────────────────────────────────────────
 *
 * Baut den Umschalter und seine beiden Rückfragen ERST, wenn das Merkmal an
 * ist. Ist es aus, entsteht kein einziges Element — ein sichtbarer, toter
 * Schalter wäre schlimmer als gar keiner (Nutzer-Ansage 2026-08-13).
 *
 * Zum Erproben gibt es zwei Türen. Beide wirken nur im eigenen Tab und
 * überleben kein Neuladen — damit lässt sich die fertige Bedienung auf der
 * ECHTEN Seite durchspielen, ohne dass ein Workshop-Publikum etwas sieht.
 *
 * Ob er entsteht, entscheidet allein das Merkmals-Schloss `useSprachumschalter`
 * (Firestore, ohne Deploy umlegbar). Die frühere Erprobungs-Tür — Adress-
 * Anhängsel und Konsolen-Aufruf — ist mit v3.3.1 entfallen: Sie war für die
 * Zeit vor der Freischaltung gedacht, und ihre Spur im localStorage
 * widersprach der Datenschutzerklärung. Näheres weiter unten.
 *
 * Der Wechsel selbst ist bewusst einfach gehalten: Es gibt keinen Weg, einem
 * laufenden Auftrag nachträglich eine andere Sprache zu geben. Stattdessen
 * startet dieselbe Analyse noch einmal — das Bild liegt ohnehin noch im
 * Browser (state.lastFile). Der alte Auftrag läuft ins Leere und wird vom
 * Aufräumer eingesammelt wie jeder abgebrochene Auftrag. Das kostet eine
 * verworfene Analyse und spart dafür einen ganzen Endpunkt samt Ticket-
 * Prüfung, Transaktion und Missbrauchsdeckel.
 */

import { t, getLanguage, setLanguage } from "./i18n.js";
import { state } from "./state.js";
import { statusNeuSchreiben } from "./ui.js";

/* Die Texte sprechen von „der anderen Sprache", ohne sie zu benennen —
   solange es genau zwei gibt, ist das eindeutig. Käme eine dritte dazu,
   müssten die Locale-Texte einen Platzhalter bekommen. */
const SPRACHEN = ["de", "en"];
const SPEICHER_SCHLUESSEL = "malzime-sprache";
/* v3.3.1 — die Erprobungs-Tür ist ersatzlos entfernt, samt ihrer beiden
   localStorage-Schlüssel `malzime-tuer-sprachumschalter` und
   `malzime-umschalter-aktiv`.

   Sie stammte aus der Zeit vor der Freischaltung: Der fertige Umschalter
   sollte sich live vorführen lassen, ohne dass ein Workshop-Publikum ihn
   sieht. Seit v3.3.0 ist er freigeschaltet — die Tür führt an einem offenen
   Zimmer vorbei.

   Der eigentliche Grund für den Rückbau ist aber ein anderer: Der Schlüssel
   `malzime-umschalter-aktiv` wurde bei JEDEM Besucher gesetzt, während die
   Datenschutzerklärung zusagt, im Browser nichts Dauerhaftes abzulegen. Der
   Rechtstext ist die Vorgabe, nicht der Code. Nebenbei stand in docs/FLAGS.md
   ohnehin, die Tür „überlebt kein Neuladen" — der localStorage machte daraus
   geräteweit und dauerhaft. Auch diese Abweichung ist damit weg. */

/* Das Schliess-Kreuz ist ein Zeichen, kein Text: Es wird nie uebersetzt und
   Screenreadern gar nicht vorgelesen — deren Beschriftung kommt aus dem
   aria-label. Deshalb steckt es in einem aria-hidden-Element. */
const KREUZ_ZEICHEN = "\u00d7";

let eingehaengt = false;
let umschalter = null;
let modalFertig = null;
let modalLaeuft = null;
let ansage = null;
let neuAnalysieren = null;
let zuruecksetzen = null;

/* ── Lage bestimmen ─────────────────────────────────────────────────────── */

/**
 * "leer" | "laeuft" | "fertig" | "ohnebild"
 *
 * `ohnebild` ist der Fall nach einem Neuladen: Die Seite holt das Ergebnis
 * zurück (js/api.js, resumeQueueJob), die Bilddatei aber überlebt kein
 * Neuladen — ein File-Objekt lässt sich nicht speichern. Eine neue Analyse ist
 * dann unmöglich, und eine Rückfrage, die sie verspricht, wäre eine Lüge: Der
 * Wechsel liefe ins Leere und niemand wüsste warum.
 */
function lage() {
  const laeuftEtwas = state.isAnalyzing || state.uploadLaeuft;
  if (!laeuftEtwas && !state.lastData) return "leer";
  if (!state.lastFile) return "ohnebild";
  return laeuftEtwas ? "laeuft" : "fertig";
}

/* Wohin der Umschalter gehört, je nach Seitenaufbau:

   - Startseite: in die Kopfzeile mit dem SYSTEM-AKTIV-Abzeichen (`.hero`).
   - Unterseiten: auf dieselbe Zeile wie die Rubrik oben („malziME · Statistik",
     „malziME · Rechtliches"). Dafür kommen Rubrik und Umschalter in eine
     gemeinsame Zeile — vorher stand er darüber, was nach einem losen Element
     aussah statt nach einer Kopfzeile (Nutzer-Ansage 2026-08-13).
   - Sonst: an den Anfang des Inhalts. */
function umschalterEinsetzen(el) {
  /* Die WORTMARKE zuerst — sie ist die oberste Zeile jeder Seite.
     Bis 2026-08-19 haengte sich der Umschalter an die Rubrik. Seit die
     Wortmarke darueber steht, sass er dadurch eine Zeile tiefer als auf der
     Startseite, wo er auf Logo-Hoehe liegt. Der Nutzer hat das gefunden:
     "Auf der Startseite hast du den Sprachumschalter auf Hoehe des Logos, auf
     den Unterseiten allerdings nicht."

     Steckt die Wortmarke bereits in einer Kopfzeile (die statischen
     Rechtsseiten bringen sie fertig mit), wird nur noch der Umschalter
     hineingehaengt — sonst entstuende eine zweite Zeile um die erste herum. */
  const marke = document.querySelector(".wortmarke");
  if (marke && marke.parentNode) {
    const vorhanden = marke.closest(".seiten-kopfzeile");
    if (vorhanden) {
      vorhanden.append(el);
      return true;
    }
    const zeile = document.createElement("div");
    zeile.className = "seiten-kopfzeile";
    marke.parentNode.insertBefore(zeile, marke);
    zeile.append(marke, el);
    return true;
  }

  /* Ohne Wortmarke: die Rubrik, wie bisher. */
  const rubrik = document.querySelector(".page-eyebrow");
  if (rubrik && rubrik.parentNode) {
    const zeile = document.createElement("div");
    zeile.className = "seiten-kopfzeile";
    rubrik.parentNode.insertBefore(zeile, rubrik);
    zeile.append(rubrik, el);
    return true;
  }
  const hero = document.querySelector(".hero");
  if (hero) {
    hero.insertBefore(el, hero.firstChild);
    return true;
  }
  const main = document.getElementById("main");
  if (!main) return false;
  main.insertBefore(el, main.firstChild);
  return true;
}

/* ── Bausteine ──────────────────────────────────────────────────────────── */

function knopf(code) {
  const b = document.createElement("button");
  b.type = "button";
  /* SAFARI-REGEL (BUG-2026-08-17-08): Safari tabbt ohne „Vollzugriff Tastatur"
     NICHT zu Buttons — jedes Bedienelement braucht ein ausdrueckliches
     tabindex="0". Fuer die statische index.html erzwingt das ein Unit-Test seit
     Langem; die HIER im JavaScript erzeugten Knoepfe hat er nie gesehen. Folge:
     Der Sprachumschalter war auf Safari mit der Tastatur nicht erreichbar —
     WCAG 2.1.1, Stufe A. Gefunden von einem Nutzer auf der Live-Seite, nicht
     von einem Test. */
  b.setAttribute("tabindex", "0");
  b.className = "sprach-knopf";
  b.dataset.lang = code;
  b.textContent = code.toUpperCase();
  /* lang am Knopf selbst: Ohne das liest ein deutscher Screenreader das
     englische Wort deutsch vor. axe kann das nicht sehen (A11Y-001). */
  b.lang = code;
  return b;
}

function baueUmschalter() {
  const huelle = document.createElement("div");
  huelle.className = "sprachwahl";

  const pille = document.createElement("div");
  pille.className = "sprach-pille";
  pille.setAttribute("role", "group");

  const schieber = document.createElement("span");
  schieber.className = "sprach-schieber";
  schieber.setAttribute("aria-hidden", "true");
  pille.appendChild(schieber);

  SPRACHEN.forEach((code) => {
    const b = knopf(code);
    b.addEventListener("click", () => geklickt(code, b));
    pille.appendChild(b);
  });

  huelle.appendChild(pille);
  return huelle;
}

function modalBauen(art) {
  const grund = document.createElement("div");
  grund.className = "sw-grund";
  grund.dataset.modal = art;
  grund.hidden = true;

  const kasten = document.createElement("div");
  /* Die Art steht als Klasse dran, damit sich die beiden Rückfragen auf einen
     Blick unterscheiden: Die eine löscht etwas (rostrot, Warnzeichen), die
     andere kostet nur Wartezeit (ruhig). Vorher sahen sie gleich aus — der
     Nutzer hat sie deshalb gar nicht erst gelesen. */
  kasten.className = `sw-modal sw-modal--${art}`;
  kasten.setAttribute("role", "dialog");
  kasten.setAttribute("aria-modal", "true");
  kasten.id = `sw-modal-${art}`;

  const schliessen = document.createElement("button");
  schliessen.type = "button";
  schliessen.setAttribute("tabindex", "0");
  schliessen.className = "sw-schliessen";
  schliessen.dataset.swAbbrechen = "";
  const kreuz = document.createElement("span");
  kreuz.setAttribute("aria-hidden", "true");
  kreuz.textContent = KREUZ_ZEICHEN;
  schliessen.appendChild(kreuz);

  const titel = document.createElement("h2");
  titel.id = `sw-titel-${art}`;
  titel.dataset.swKey = `sprache.${art}.titel`;
  kasten.setAttribute("aria-labelledby", titel.id);

  const text = document.createElement("p");
  /* Der Folgesatz hebt die Folge hervor (<strong>), deshalb der HTML-Weg. */
  text.dataset.swKeyHtml = `sprache.${art}.text`;

  kasten.append(schliessen, titel, text);

  const knoepfe = document.createElement("div");
  knoepfe.className = "sw-knoepfe";

  const bleiben = document.createElement("button");
  bleiben.type = "button";
  bleiben.setAttribute("tabindex", "0");
  bleiben.className = "sw-knopf sw-knopf--bleiben";
  bleiben.dataset.swAbbrechen = "";
  bleiben.dataset.swKey = `sprache.${art}.bleiben`;

  const wechseln = document.createElement("button");
  wechseln.type = "button";
  wechseln.setAttribute("tabindex", "0");
  wechseln.className = "sw-knopf sw-knopf--wechseln";
  wechseln.dataset.swLos = "";
  wechseln.dataset.swKey = `sprache.${art}.wechseln`;

  knoepfe.append(bleiben, wechseln);
  kasten.appendChild(knoepfe);
  grund.appendChild(kasten);

  grund.addEventListener("click", (e) => {
    if (e.target === grund) modalSchliessen();
  });
  schliessen.addEventListener("click", modalSchliessen);
  bleiben.addEventListener("click", modalSchliessen);
  wechseln.addEventListener("click", bestaetigt);

  return grund;
}

/* ── Beschriftungen ─────────────────────────────────────────────────────── */

function beschriften() {
  if (!eingehaengt) return;
  const wurzel = document.body;

  wurzel.querySelectorAll("[data-sw-key]").forEach((el) => {
    const wert = t(el.dataset.swKey);
    if (wert !== el.dataset.swKey) el.textContent = wert;
  });
  wurzel.querySelectorAll("[data-sw-key-html]").forEach((el) => {
    const wert = t(el.dataset.swKeyHtml);
    if (wert !== el.dataset.swKeyHtml) el.innerHTML = wert;
  });

  const pille = umschalter.querySelector(".sprach-pille");
  pille.setAttribute("aria-label", t("sprache.gruppe"));

  umschalter.querySelectorAll(".sprach-knopf").forEach((b) => {
    const an = b.dataset.lang === getLanguage();
    b.classList.toggle("aktiv", an);
    b.setAttribute("aria-pressed", String(an));
    /* Der Name wird IMMER in der jeweiligen Sprache angesagt („Deutsch",
       „English") — nicht in der gerade eingestellten. Sonst hört jemand
       „Englisch" und findet auf einer englischen Seite kein „English". */
    b.setAttribute("aria-label", t(`sprache.name.${b.dataset.lang}`));
  });

  pille.classList.toggle("rechts", getLanguage() === SPRACHEN[1]);

  document.querySelectorAll(".sw-schliessen").forEach((b) => {
    b.setAttribute("aria-label", t("sprache.schliessen"));
  });
}

/* ── Rückfrage ──────────────────────────────────────────────────────────── */

let offen = null;
let zielSprache = null;
/* BUG-2026-08-20-19: Haelt den Ausblend-Zeitgeber fest, damit ein Wiederoeffnen
   ihn abraeumen kann. Ohne das versteckte der alte Zeitgeber den frisch
   geoeffneten Dialog — sichtbar weg, in Wahrheit offen, Seite blockiert. */
let versteckZeitgeber = null;
let fokusVorher = null;

/* Alles ausser dem Dialog stillegen. `inert` nimmt Maus, Tastatur UND
   Screenreader — damit ist der Fokus-Kaefig kein Nachbau mit Tab-Zaehlerei,
   sondern die Zusicherung des Browsers. */
function umgebungStillegen(an) {
  Array.prototype.forEach.call(document.body.children, (kind) => {
    if (kind === offen) return;
    if (an) kind.setAttribute("inert", "");
    else kind.removeAttribute("inert");
  });
}

function modalOeffnen(art, ziel, ohneBild, ausloeser) {
  /* BUG-2026-08-20-19: Einen noch laufenden Ausblend-Zeitgeber des vorigen
     Schliessens abraeumen — sonst versteckt er gleich den Dialog, den wir
     gerade oeffnen, und laesst die Seite stillgelegt zurueck. */
  if (versteckZeitgeber) {
    clearTimeout(versteckZeitgeber);
    versteckZeitgeber = null;
  }
  zielSprache = ziel;
  /* Ein Satz, zwei Fälle: Mit Bild folgt eine neue Analyse, ohne Bild eine
     leere Startseite. Überschrift und Knöpfe bleiben gleich — der Nutzer
     wollte die Sprache wechseln, nicht über eine Löschung verhandeln. */
  const text = art === "fertig" ? modalFertig.querySelector("[data-sw-key-html]") : null;
  if (text) {
    text.dataset.swKeyHtml = ohneBild ? "sprache.fertig.textOhneBild" : "sprache.fertig.text";
    text.innerHTML = t(text.dataset.swKeyHtml);
  }
  /* Den ausloesenden Knopf merken, NICHT document.activeElement: In WebKit
     (Safari) bekommt ein Knopf beim Klicken keinen Fokus — der Rücksprung
     landete dort im Leeren statt auf dem Umschalter. Am 2026-08-13 im
     WebKit-Lauf gemessen. */
  fokusVorher = ausloeser || document.activeElement;
  offen = art === "fertig" ? modalFertig : modalLaeuft;
  offen.hidden = false;
  umgebungStillegen(true);
  /* Element festhalten UND vor dem Setzen prüfen, ob es noch das offene ist.
     BUG-2026-08-19-02: Bis hierher wurde nur festgehalten. Das war schlimmer
     als `offen` zu lesen — wird die Rückfrage vor dem nächsten Bildschirmrahmen
     geschlossen, gab der Rahmen die Klasse `sichtbar` an einen BEREITS
     GESCHLOSSENEN Dialog zurück. Danach war `sichtbar` gesetzt, `offen` aber
     null, und weil `aufTaste()` mit `if (!offen) return;` beginnt, tat Escape
     nichts mehr: Der Dialog blieb dauerhaft offen.

     Aufgefallen in der Pipeline (WebKit unter Last), dreimal, zuletzt auch
     dann noch, als die Zusicherung bereits wartend las — sie konnte also nicht
     zu früh gemessen haben. Genau diese Signatur: `.sw-grund.sichtbar` bleibt
     stehen und lässt sich nicht mehr schliessen. */
  const dieser = offen;
  requestAnimationFrame(() => {
    if (offen === dieser) dieser.classList.add("sichtbar");
  });
  const ruhig = offen.querySelector(".sw-knopf--bleiben");
  if (ruhig) ruhig.focus();
  offen.addEventListener("focusout", fokusZurueckholen);
}

function modalSchliessen() {
  if (!offen) return;
  const el = offen;
  umgebungStillegen(false);
  offen.removeEventListener("focusout", fokusZurueckholen);
  offen = null;
  zielSprache = null;
  el.classList.remove("sichtbar");
  /* Erst nach dem Ausblenden verbergen, sonst springt es weg statt zu gehen.
     BUG-2026-08-20-19: Der Zeitgeber wurde bisher nicht festgehalten. Wer den
     Dialog schloss und binnen 200 ms denselben Sprachknopf erneut drueckte, sah
     ihn kurz aufgehen — und dann setzte der ALTE Zeitgeber `hidden = true`. Der
     Dialog war danach unsichtbar, aber offen: Die Seite blieb stillgelegt und
     reagierte auf keine Taste mehr. Der v3.9.1-Fix deckte nur das gleichzeitige
     Oeffnen und Schliessen ab, nicht das Wiederoeffnen.
     Jetzt wird ein laufender Zeitgeber beim naechsten Oeffnen abgeraeumt. */
  if (versteckZeitgeber) clearTimeout(versteckZeitgeber);
  versteckZeitgeber = setTimeout(() => {
    versteckZeitgeber = null;
    el.hidden = true;
  }, 200);
  /* Fokus erst im NÄCHSTEN Bildschirmrahmen zurückgeben, nicht sofort.
     Grund: Der Auslöser liegt ausserhalb des Dialogs und war deshalb bis eine
     Zeile vorher `inert` — der Browser hat ihn also gerade eben erst wieder
     fokussierbar gemacht. Setzt man den Fokus im selben Durchlauf, hat die
     Fokus-Verwaltung mancher Engine den Zustandswechsel noch nicht verarbeitet
     und verwirft den Aufruf stillschweigend. Beobachtet auf WebKit/Linux in der
     Pipeline (der Knopf blieb unfokussiert, kein Fehler), auf macOS nie.
     Ein direkter `focus()` ist hier also keine Zusicherung, sondern ein
     Wunsch — und ein Fokus, der ins Leere fällt, trifft genau die Menschen,
     die auf die Tastatur angewiesen sind.

     Der Wächter davor: Wurde inzwischen ein neuer Dialog geöffnet, gehört ihm
     der Fokus, nicht dem alten Auslöser. */
  const ziel = fokusVorher;
  if (ziel && typeof ziel.focus === "function") {
    const zurueckgeben = () => {
      /* Ist inzwischen ein neuer Dialog offen, gehört ihm der Fokus. Und ein
         Element, das nicht mehr im Dokument hängt, kann keinen annehmen. */
      if (offen || !ziel.isConnected) return;
      if (document.activeElement === ziel) return;
      ziel.focus();
    };
    /* ZWEIMAL, und das ist Absicht — der zweite Versuch ist der Riegel, nicht
       der erste. Sofort deckt den Normalfall; der Rahmen danach fängt die
       Engines, die den `inert`-Wechsel eine Zeile vorher noch nicht verarbeitet
       haben und den Aufruf stillschweigend verwerfen. Der Wächter oben macht
       den zweiten Versuch folgenlos, wenn der erste gegriffen hat. */
    zurueckgeben();
    requestAnimationFrame(zurueckgeben);
  }
  fokusVorher = null;
}

async function bestaetigt() {
  const ziel = zielSprache;
  modalSchliessen();
  if (!ziel) return;
  await wechseln(ziel, true);
}

/* ── Der Wechsel ────────────────────────────────────────────────────────── */

async function wechseln(ziel, neuStarten) {
  const gelang = await setLanguage(ziel);
  if (!gelang) return;

  try {
    sessionStorage.setItem(SPEICHER_SCHLUESSEL, ziel);
  } catch (_err) {
    /* Privater Modus oder voller Speicher — die Wahl gilt dann nur bis zum
       Neuladen. Kein Grund, den Wechsel abzubrechen. */
  }

  beschriften();
  /* Eine stehende Fehlermeldung gehört mitgewechselt — sonst steht sie auf
     Deutsch unter einer englischen Seite. */
  statusNeuSchreiben();
  sageAn(t("sprache.gewechselt"));

  if (!neuStarten) return;

  if (state.lastFile && typeof neuAnalysieren === "function") {
    neuAnalysieren(state.lastFile);
    return;
  }

  /* Kein Bild mehr da (nach einem Neuladen). Das vorliegende Profil in der
     alten Sprache stehen zu lassen und mit einer Zeile zu entschuldigen wäre
     der schlechtere Weg — es gehört weg, und man landet auf einer sauberen
     Startseite. Genau das hat der Nutzer verlangt. */
  if (typeof zuruecksetzen === "function") zuruecksetzen();
}

function geklickt(ziel, knopfEl) {
  if (ziel === getLanguage()) return;

  /* Steht nichts auf dem Spiel, sofort umschalten. Das ist genau der leere
     Zustand: Solange nichts hochgeladen ist, geht durch den Wechsel nichts
     verloren.

     Der Prototyp hatte hier eine zweite Bedingung („Zielsprache ist die des
     vorliegenden Auftrags"). Sie kann in der echten Umsetzung nie zutreffen,
     weil Oberflächen- und Auftragssprache bei jedem Wechsel gemeinsam
     nachgezogen werden — ein Test hat das nachgewiesen. Toter Code, der
     Sicherheit vortäuscht, ist schlimmer als keiner. */
  const jetzt = lage();

  /* Nur auf der leeren Seite steht nichts auf dem Spiel. */
  if (jetzt === "leer") {
    wechseln(ziel, false);
    return;
  }

  /* Sonst erst fragen. Die Oberfläche bleibt bis zur Entscheidung unverändert,
     damit „Abbrechen" wirklich nichts hinterlässt — auch die Rückfrage selbst
     erscheint deshalb in der AKTUELLEN Sprache. */
  /* "ohnebild" nutzt dieselbe Rückfrage wie "fertig" — die Überschrift „Dein
     Profil wird gelöscht." stimmt in beiden Fällen. Nur der eine Satz darunter
     unterscheidet sich: einmal folgt eine neue Analyse, einmal eine leere
     Startseite. */
  modalOeffnen(jetzt === "laeuft" ? "laeuft" : "fertig", ziel, jetzt === "ohnebild", knopfEl);
}

/* ── Ansage für Screenreader ────────────────────────────────────────────── */

function sageAn(text) {
  if (!ansage) return;
  /* Leeren und im nächsten Rahmen füllen — gleicher Text zweimal hintereinander
     wird sonst nicht erneut vorgelesen. */
  const bereich = ansage;
  bereich.textContent = "";
  requestAnimationFrame(() => {
    bereich.textContent = text;
  });
}

/* ── Ein- und Aushängen ─────────────────────────────────────────────────── */

function einhaengen() {
  if (eingehaengt) return;

  umschalter = baueUmschalter();
  if (!umschalterEinsetzen(umschalter)) {
    umschalter = null;
    return;
  }

  modalFertig = modalBauen("fertig");
  modalLaeuft = modalBauen("laeuft");
  document.body.append(modalFertig, modalLaeuft);

  ansage = document.createElement("div");
  ansage.className = "sr-only";
  ansage.setAttribute("aria-live", "polite");
  document.body.appendChild(ansage);

  document.addEventListener("keydown", aufTaste);

  eingehaengt = true;
  beschriften();
}

function aushaengen() {
  if (!eingehaengt) return;
  modalSchliessen();
  document.removeEventListener("keydown", aufTaste);
  [umschalter, modalFertig, modalLaeuft, ansage].forEach((el) => el && el.remove());
  umschalter = modalFertig = modalLaeuft = ansage = null;
  eingehaengt = false;
}

/* Letztes Netz: Verliert der Fokus die Rückfrage trotzdem (in Safari tabbt man
   ohne „Vollzugriff Tastatur" gar nicht auf Knöpfe — der Fokus landet dann im
   Nichts und kommt nicht zurück), wird er zurückgeholt. In WebKit 26.5
   gemessen; Chromium zeigte das Verhalten nicht. */
function fokusZurueckholen() {
  /* Erst im naechsten Durchlauf pruefen: Beim Verlassen steht der neue
     Fokus noch nicht fest. */
  setTimeout(() => {
    if (!offen || offen.contains(document.activeElement)) return;
    const erster = offen.querySelector("button");
    if (erster) erster.focus();
  }, 0);
}

/* Fokus-Fänger. `inert` allein genügt nicht: Es verhindert, dass der Fokus in
   die Umgebung springt — aber hinter dem letzten Knopf verlässt er das
   Dokument in die Browserleiste, und der Weg zurück führt durch fremde
   Bedienelemente. Deshalb wird am Rand der Liste umgebrochen. */
function aufTaste(e) {
  if (!offen) return;
  if (e.key === "Escape") {
    modalSchliessen();
    return;
  }
  if (e.key !== "Tab") return;

  const ziele = Array.from(
    offen.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.disabled);
  if (!ziele.length) return;

  const erster = ziele[0];
  const letzter = ziele[ziele.length - 1];
  if (e.shiftKey && document.activeElement === erster) {
    e.preventDefault();
    letzter.focus();
  } else if (!e.shiftKey && document.activeElement === letzter) {
    e.preventDefault();
    erster.focus();
  }
}

/* ── Einstieg ───────────────────────────────────────────────────────────── */

/**
 * Meldet den Umschalter an, baut ihn aber noch nicht. Wird beim Seitenstart
 * aufgerufen — bedingungslos, damit die Konsolen-Tür auch dann offensteht,
 * wenn die Merkmals-Abfrage scheitert.
 *
 * @param {object} opts
 * @param {Function} opts.analysiere  Callback, der eine Datei neu analysiert.
 */
export function initSprachumschalter({ analysiere, zuruecksetze } = {}) {
  neuAnalysieren = analysiere || null;
  zuruecksetzen = zuruecksetze || null;

  /* Ab hier entscheidet allein das Merkmals-Schloss, ob der Umschalter
     entsteht — app.js ruft merkmalUebernehmen(), sobald /api/stats geantwortet
     hat. Die frühere Erprobungs-Tür (Adress-Anhängsel und Konsolen-Aufruf) ist
     mit v3.3.1 entfallen; siehe die Begründung am Kopf der Datei. */
}

/**
 * Baut den Umschalter ein oder wieder aus. Ruft das Merkmals-Schloss auf,
 * sobald die Antwort von /api/stats da ist — und die Konsolen-Tür.
 *
 * @param {boolean} an
 */
export function zeigeSprachumschalter(an) {
  if (an) einhaengen();
  else aushaengen();
}

/**
 * Übernimmt den Stand des Merkmals-Schlosses: baut den Umschalter und
 * hinterlässt die Spur für die Unterseiten. Ruft app.js auf, sobald die
 * Antwort von /api/stats da ist — mit `false` genauso wie mit `true`, damit
 * ein Abschalten ankommt.
 */
export function merkmalUebernehmen(an) {
  /* v3.3.1: KEIN localStorage mehr. Der Stand wurde hier hinterlegt, damit die
     Unterseiten ihn sehen (sie öffnen mit target="_blank" und bekommen einen
     leeren sessionStorage). Das legte bei JEDEM Besucher einen dauerhaften
     Eintrag an und widersprach der Datenschutzerklärung.

     Die Unterseiten holen den Stand jetzt selbst bei /api/stats — dieselbe
     Quelle, aus der auch dieser Aufruf gespeist wird (app.js). Das ist nicht
     nur datenschutzkonform, sondern auch richtiger: Der hinterlegte Wert
     veraltete: Wurde das Merkmal abgeschaltet, trug ein Gerät den alten Stand
     so lange weiter, bis jemand die Startseite erneut aufrief. */
  if (an) einhaengen();
}

/** Nur für Tests: aktueller Einbauzustand. */
export function istEingehaengt() {
  return eingehaengt;
}
