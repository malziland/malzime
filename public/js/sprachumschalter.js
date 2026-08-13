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
 * 1. In der Adresse:  ?sprachumschalter=1
 *
 *    Der wichtigere Weg. Auf iPhone und iPad gibt es keine Konsole, und genau
 *    dort muss der Umschalter erprobt werden: Daumen-Größe und Rückfrage auf
 *    kleinem Schirm sind die kritischen Punkte. Chrome sperrt am Rechner
 *    obendrein das Einfügen in die Konsole.
 *
 * 2. In der Konsole:  malziME.sprachumschalter()   /   (false) zum Entfernen
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
/* Spur der Erprobungs-Tür. Sie liegt im localStorage, NICHT im
   sessionStorage: Die Rechtsseiten öffnen mit target="_blank" rel="noopener"
   (index.html:348), und ein so geöffneter Tab bekommt einen leeren
   sessionStorage. Die Spur wäre dort nie angekommen — genau daran ist die
   erste Fassung gescheitert.

   Bewusst geräteweit und dauerhaft: Es ist eine Tür zum Erproben, keine
   Nutzer-Einstellung. Zu bekommen nur über ?sprachumschalter=1, wieder los
   über ?sprachumschalter=0 oder malziME.sprachumschalter(false). Der
   Normalbetrieb hängt weiterhin allein am Merkmals-Schloss. */
const TUER_SCHLUESSEL = "malzime-tuer-sprachumschalter";

/* Zweite Spur, die den Stand des Merkmals spiegelt. Die Rechtsseiten rufen
   bewusst kein /api/stats auf (eine Rechtsseite soll keinen Netzweg aufmachen)
   und erfahren nur so, dass der Umschalter im Betrieb an ist. Wird bei JEDEM
   Aufruf der Startseite neu geschrieben oder geloescht, damit ein Abschalten
   des Merkmals ankommt.

   Getrennt von der Tuer, weil sonst das ausgeschaltete Merkmal beim naechsten
   Seitenaufruf die Erprobung wieder zusperren wuerde. */
const MERKMAL_SCHLUESSEL = "malzime-umschalter-aktiv";

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

/* ── Bausteine ──────────────────────────────────────────────────────────── */

function knopf(code) {
  const b = document.createElement("button");
  b.type = "button";
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
    b.addEventListener("click", () => geklickt(code));
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
  text.dataset.swKey = `sprache.${art}.text`;

  kasten.append(schliessen, titel, text);

  const knoepfe = document.createElement("div");
  knoepfe.className = "sw-knoepfe";

  const bleiben = document.createElement("button");
  bleiben.type = "button";
  bleiben.className = "sw-knopf sw-knopf--bleiben";
  bleiben.dataset.swAbbrechen = "";
  bleiben.dataset.swKey = `sprache.${art}.bleiben`;

  const wechseln = document.createElement("button");
  wechseln.type = "button";
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

function modalOeffnen(art, ziel, ohneBild) {
  zielSprache = ziel;
  const text = art === "fertig" ? modalFertig.querySelector("[data-sw-key]:not(h2)") : null;
  if (text) {
    text.dataset.swKey = ohneBild ? "sprache.fertig.textOhneBild" : "sprache.fertig.text";
    text.textContent = t(text.dataset.swKey);
  }
  fokusVorher = document.activeElement;
  offen = art === "fertig" ? modalFertig : modalLaeuft;
  offen.hidden = false;
  umgebungStillegen(true);
  /* Element festhalten, nicht `offen` lesen: Wird die Rückfrage vor dem
     nächsten Bildschirmrahmen geschlossen, ist `offen` dann null. */
  const dieser = offen;
  requestAnimationFrame(() => dieser.classList.add("sichtbar"));
  const ruhig = offen.querySelector(".sw-knopf--bleiben");
  if (ruhig) ruhig.focus();
}

function modalSchliessen() {
  if (!offen) return;
  const el = offen;
  umgebungStillegen(false);
  offen = null;
  zielSprache = null;
  el.classList.remove("sichtbar");
  /* Erst nach dem Ausblenden verbergen, sonst springt es weg statt zu gehen. */
  setTimeout(() => {
    el.hidden = true;
  }, 200);
  if (fokusVorher && typeof fokusVorher.focus === "function") fokusVorher.focus();
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

function geklickt(ziel) {
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
  modalOeffnen(jetzt === "laeuft" ? "laeuft" : "fertig", ziel, jetzt === "ohnebild");
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

  const main = document.getElementById("main");
  if (!main) return;

  umschalter = baueUmschalter();
  main.insertBefore(umschalter, main.firstChild);

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
  tuer(false);
  [umschalter, modalFertig, modalLaeuft, ansage].forEach((el) => el && el.remove());
  umschalter = modalFertig = modalLaeuft = ansage = null;
  eingehaengt = false;
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

  window.malziME = window.malziME || {};
  window.malziME.sprachumschalter = (an = true) => {
    tuer(an);
    zeigeSprachumschalter(an);
    return an ? "Sprachumschalter eingeblendet — gilt jetzt auch auf den Unterseiten." : "Sprachumschalter entfernt.";
  };

  /* Tür über die Adresse. Bewusst streng: nur genau "1" öffnet, nur genau "0"
     schliesst. Alles andere lässt den Zustand, wie er ist. */
  const wunsch = adressWunsch();
  if (wunsch === true) tuer(true);
  if (wunsch === false) tuer(false);
  if (tuerOffen()) einhaengen();
}

/** "1" → true, "0" → false, sonst null (keine Angabe). */
function adressWunsch() {
  try {
    const wert = new URLSearchParams(window.location.search).get("sprachumschalter");
    if (wert === "1") return true;
    if (wert === "0") return false;
  } catch (_err) {
    /* Kaputte Adresse — dann eben keine Angabe. */
  }
  return null;
}

function tuerOffen() {
  try {
    return localStorage.getItem(TUER_SCHLUESSEL) === "1";
  } catch (_err) {
    return false;
  }
}

function tuer(auf) {
  try {
    if (auf) localStorage.setItem(TUER_SCHLUESSEL, "1");
    else localStorage.removeItem(TUER_SCHLUESSEL);
  } catch (_err) {
    /* Privater Modus — dann gilt die Tür nur für diesen Seitenaufruf. */
  }
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
  try {
    if (an) localStorage.setItem(MERKMAL_SCHLUESSEL, "1");
    else localStorage.removeItem(MERKMAL_SCHLUESSEL);
  } catch (_err) {
    /* Privater Modus — dann sehen die Unterseiten den Schalter nicht. */
  }
  if (an) einhaengen();
}

/** Nur für Tests: aktueller Einbauzustand. */
export function istEingehaengt() {
  return eingehaengt;
}
