/* ── Realitäts-Check (v3.1) ────────────────────────────────────────────────
 *
 * „Wie gut hat dich die KI wirklich getroffen?" — der Workshop-Move des
 * Inhabers (KI-Fehler ALS Lehrmoment) als Teil des Tools. Es gibt keinen
 * Ausgang, in dem das Tool „verliert": Treffer beweisen die Macht der
 * Algorithmen, Fehler ihre Gefahr. Abgenommener Prototyp:
 * compare-prototype-streaming.html (2026-08-11), Spezifikation in der
 * Projekt-Memory (realitaets-check-plan).
 *
 * Kernregeln:
 *   - Erscheint NUR bei echten Menschen-Profilen (nicht bei Tier-Profil,
 *     blocked oder leerem Profil). Position: nach der Manipulations-Box,
 *     VOR dem Datenwert (der ist statischer Lernstoff, keine KI-Leistung).
 *   - 6 Zeilen mit kurzem ZITAT der echten KI-Behauptung aus dem Profil des
 *     AKTIVEN Modus. Die Geschlecht-Zeile entfällt automatisch, wenn die KI
 *     sich nicht festgelegt hat — dann zählt der Score aus 5 Zeilen.
 *   - Drei Stufen (Getroffen 1 / Knapp 0,5 / Daneben 0); Geschlecht binär
 *     (Getroffen 1 / Daneben 0) — die KI antwortet dort praktisch binär.
 *   - Absenden erst nach Antwort in JEDER Zeile; danach sind die Antworten
 *     EINGEFROREN (Statistik-Schutz) und auch ein Moduswechsel ändert die
 *     Zitate nicht mehr. Ein neues Foto/Ergebnis setzt alles zurück.
 *   - Auswertung: EIN Wert 0–100 % als animierter Ring, Farbe interpoliert
 *     entlang der MARKENFARBEN Rust → Gold → Teal (keine fremden Töne).
 *   - Vergleich mit allen anderen NUR ab 100 anonymen Eingaben (sonst wäre
 *     die Statistik verzerrt und ein Einzelner könnte sie erraten).
 *   - Anonymer Zähler: beim Absenden gehen AUSSCHLIESSLICH die Kategorie-
 *     Stufen an /api/telemetry — keine traceId, keine jobId, nichts
 *     Verknüpfbares (Privacy-Zusage bleibt intakt).
 *
 * Barrierefreiheit: echte <button> mit aria-pressed; die Prozentzahl wird
 * EINMAL nach der Auswertung über #srAnnounce angesagt; bei reduzierter
 * Bewegung stehen Ring und Balken sofort auf dem Endwert.
 */

import { elements } from "./dom.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { getBiasMode } from "./ui.js";
import { popTon } from "./klang.js";
import { logRealitaetsCheck } from "./telemetry-logger.js";

/* Die sechs Fragen (User-geformt, 2026-08-11). Einkommen/Kaufkraft bewusst
   gestrichen — bei Jugendlichen kein Thema. `binaer` = nur zwei Antworten. */
const ZEILEN = [
  { key: "alter", labelKey: "rc.frage.alter", folgenKey: "rc.folgen.alter" },
  { key: "geschlecht", labelKey: "rc.frage.geschlecht", folgenKey: "rc.folgen.geschlecht", binaer: true },
  { key: "interessen", labelKey: "rc.frage.interessen", folgenKey: "rc.folgen.interessen" },
  { key: "charakter", labelKey: "rc.frage.charakter", folgenKey: "rc.folgen.charakter" },
  { key: "werbung", labelKey: "rc.frage.werbung", folgenKey: "rc.folgen.werbung" },
  { key: "manipulation", labelKey: "rc.frage.manipulation", folgenKey: "rc.folgen.manipulation" },
];

/* Zitate bleiben kurz — die Zeile soll erinnern, nicht wiederholen. */
const ZITAT_MAX_ZEICHEN = 70;

/* Marker, an denen die Geschlecht-Zeile entfällt: So formuliert die KI ihre
   Nicht-Festlegung in beiden Sprachen (Erkennungsmarker, keine UI-Texte). */
const GESCHLECHT_UNKLAR_MARKER = ["nicht eindeutig", "not clearly"];

/* Umfang des Ergebnis-Rings (r=52 → 2·π·52), exakt wie im Prototyp. */
const RING_UMFANG = 326.7;

/* Der Vergleichsbalken erscheint erst ab so vielen anonymen Eingaben. */
const VERGLEICH_MINDEST_EINGABEN = 100;

/* Aktueller Zustand des Checks — lebt bis zum nächsten Ergebnis/Reset. */
let antworten = {};
let gesperrt = false;
let aktiveZeilen = [];

/* Bewegungs-Vorgabe des Systems — bei jedem Zugriff frisch lesen. */
function reduziert() {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_e) {
    return false;
  }
}

/* ── Profil-Zugriff ──────────────────────────────────────────────────────── */

/* Dieselbe Profil-Wahl wie render.js: der aktive Modus, mit Rückfall. */
function profilFuerAktivenModus(data) {
  const profiles = (data && data.profiles) || {};
  return profiles[getBiasMode()] || profiles.normal || profiles.boost || {};
}

/* Nur echte Menschen-Profile bekommen den Check: kein Tier-Profil, kein
   blocked (profiles fehlt), kein leeres Profil (Kriterium wie render.js). */
function istMenschenErgebnis(data) {
  if (!data || !data.profiles) return false;
  if (data.meta && data.meta.mode === "animal") return false;
  const profil = profilFuerAktivenModus(data);
  return Boolean(
    (profil.profileText && profil.profileText.trim()) ||
    (profil.categories && Object.keys(profil.categories).length > 0)
  );
}

function kuerzen(text) {
  if (text.length <= ZITAT_MAX_ZEICHEN) return text;
  return text.slice(0, ZITAT_MAX_ZEICHEN - 1).trimEnd() + "…";
}

/* Das Zitat je Frage — direkt aus dem gerenderten Profil des aktiven Modus. */
function zitatFuer(key, profil) {
  const kategorien = profil.categories || {};
  switch (key) {
    case "alter":
    case "geschlecht":
      return (kategorien.alter_geschlecht && kategorien.alter_geschlecht.value) || "";
    case "interessen":
      return (kategorien.interessen && kategorien.interessen.value) || "";
    case "charakter":
      return (
        (kategorien.charakterzuege && kategorien.charakterzuege.value) ||
        (kategorien.persoenlichkeit && kategorien.persoenlichkeit.value) ||
        ""
      );
    case "werbung":
      return (profil.ad_targeting || []).slice(0, 3).join(", ");
    case "manipulation":
      return (profil.manipulation_triggers || [])[0] || "";
    default:
      return "";
  }
}

/* Hat die KI das Geschlecht offen gelassen, entfällt die Zeile komplett —
   eine „Getroffen/Daneben"-Frage ohne Behauptung ergäbe keinen Sinn. */
function geschlechtEntfaellt(profil) {
  const wert = zitatFuer("geschlecht", profil).toLowerCase();
  return GESCHLECHT_UNKLAR_MARKER.some((marker) => wert.includes(marker));
}

/* ── Farb-Interpolation entlang der Markenfarben ─────────────────────────── */

/* Rust (#9c4e36) → Gold (#bfb542) → Teal (#156480). Bewusst keine fremden
   Töne — exakt die Interpolation des abgenommenen Prototyps. */
function rcFarbe(score) {
  function misch(a, b, anteil) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * anteil),
      Math.round(a[1] + (b[1] - a[1]) * anteil),
      Math.round(a[2] + (b[2] - a[2]) * anteil),
    ];
  }
  const rust = [156, 78, 54];
  const gold = [191, 181, 66];
  const teal = [21, 100, 128];
  const rgb = score < 50 ? misch(rust, gold, score / 50) : misch(gold, teal, (score - 50) / 50);
  return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
}

/* ── Zeilen bauen ────────────────────────────────────────────────────────── */

/* Baut die Frage-Zeilen samt Zitaten und Antwort-Knöpfen. Alles über
   createElement/textContent — Profil-Werte kommen vom Modell und landen so
   garantiert als Text, nie als Markup (XSS-Schutz). `erhaltene` restauriert
   beim Moduswechsel die schon gegebenen Antworten. */
function zeilenBauen(profil, erhaltene) {
  const ziel = elements.rcZeilen;
  if (!ziel) return;
  ziel.innerHTML = "";
  antworten = {};
  aktiveZeilen = ZEILEN.filter((zeile) => !(zeile.key === "geschlecht" && geschlechtEntfaellt(profil)));

  for (const zeile of aktiveZeilen) {
    const zeilenEl = document.createElement("div");
    zeilenEl.className = "rc-zeile";

    const label = document.createElement("span");
    label.className = "rc-label";
    label.appendChild(document.createTextNode(t(zeile.labelKey)));
    const zitat = kuerzen(zitatFuer(zeile.key, profil));
    if (zitat) {
      const zitatEl = document.createElement("span");
      zitatEl.className = "rc-zitat";
      zitatEl.textContent = zitat;
      label.appendChild(zitatEl);
    }
    zeilenEl.appendChild(label);

    const seg = document.createElement("span");
    seg.className = "rc-seg";
    /* Binäre Merkmale haben kein „Knapp" — zwei Antworten, die MITTE bleibt
       leer (Daneben rückt in Spalte 3, das Raster bleibt bündig). */
    const optionen = zeile.binaer
      ? [
          { textKey: "rc.knopf.getroffen", wert: 1, klasse: "g1" },
          { textKey: "rc.knopf.danebenBinaer", wert: 0, klasse: "g3 spalte3" },
        ]
      : [
          { textKey: "rc.knopf.getroffen", wert: 1, klasse: "g1" },
          { textKey: "rc.knopf.knapp", wert: 0.5, klasse: "g2" },
          { textKey: "rc.knopf.daneben", wert: 0, klasse: "g3" },
        ];

    for (const option of optionen) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "rc-knopf " + option.klasse;
      knopf.setAttribute("tabindex", "0");
      knopf.setAttribute("aria-pressed", "false");
      knopf.textContent = t(option.textKey);
      knopf.addEventListener("click", () => {
        /* Nach dem Absenden ist alles eingefroren (Statistik-Schutz) —
           pointer-events deckt das per CSS ab, diese Wache auch Tastatur. */
        if (gesperrt) return;
        antworten[zeile.key] = option.wert;
        seg.querySelectorAll(".rc-knopf").forEach((anderer) => {
          anderer.classList.remove("gewaehlt");
          anderer.setAttribute("aria-pressed", "false");
        });
        knopf.classList.add("gewaehlt");
        knopf.setAttribute("aria-pressed", "true");
        popTon();
        absendenKnopfAktualisieren();
      });
      /* Beim Moduswechsel vor dem Absenden bleiben gegebene Antworten stehen. */
      if (erhaltene && erhaltene[zeile.key] === option.wert) {
        antworten[zeile.key] = option.wert;
        knopf.classList.add("gewaehlt");
        knopf.setAttribute("aria-pressed", "true");
      }
      seg.appendChild(knopf);
    }
    zeilenEl.appendChild(seg);
    ziel.appendChild(zeilenEl);
  }
  absendenKnopfAktualisieren();
}

/* Der Absenden-Knopf wird erst aktiv (und gold-pulsierend, CSS), wenn JEDE
   Zeile beantwortet ist. */
function absendenKnopfAktualisieren() {
  if (!elements.rcAbsenden) return;
  elements.rcAbsenden.disabled = Object.keys(antworten).length < aktiveZeilen.length;
}

/* ── Auswertung ──────────────────────────────────────────────────────────── */

function ringAnzeigen(score) {
  const ring = elements.rcRingWert;
  const prozent = elements.rcProzent;

  function stand(wert) {
    if (prozent) prozent.textContent = String(wert);
    const farbe = rcFarbe(wert);
    if (ring) {
      ring.style.stroke = farbe;
      ring.style.color = farbe;
      ring.style.strokeDashoffset = String(RING_UMFANG - (RING_UMFANG * wert) / 100);
    }
  }

  if (reduziert()) {
    /* Barrierefreiheit: kein Hochzählen — Ring und Zahl sofort auf Endstand. */
    stand(score);
    return;
  }

  /* Ring + Zahl animiert hochfahren, die Farbe wandert mit (Prototyp). */
  const dauer = 1300;
  let start = null;
  function schritt(zeit) {
    if (start === null) start = zeit;
    const anteil = Math.min(1, (zeit - start) / dauer);
    const eased = 1 - Math.pow(1 - anteil, 3);
    stand(Math.round(score * eased));
    if (anteil < 1) requestAnimationFrame(schritt);
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(schritt);
  else stand(score);
}

/* Vergleich mit allen anderen — NUR ab der Mindestzahl anonymer Eingaben;
   darunter steht der Hinweis-Satz. Quelle ist die /api/stats-Antwort vom
   Seitenstart (state.statsDaten.realitaetsCheck). */
function vergleichAnzeigen(score) {
  const daten = (state.statsDaten && state.statsDaten.realitaetsCheck) || null;
  const genug = daten && daten.eingaben >= VERGLEICH_MINDEST_EINGABEN && typeof daten.mittelProzent === "number";
  const farbe = rcFarbe(score);

  if (!genug) {
    if (elements.rcVergleich) elements.rcVergleich.hidden = true;
    if (elements.rcWenige) elements.rcWenige.hidden = false;
    return;
  }

  if (elements.rcWenige) elements.rcWenige.hidden = true;
  if (elements.rcVergleich) elements.rcVergleich.hidden = false;
  if (elements.rcBalkenAndere) elements.rcBalkenAndere.style.width = daten.mittelProzent + "%";
  if (elements.rcMarkeDu) {
    elements.rcMarkeDu.style.left = "calc(" + score + "% - 2px)";
    elements.rcMarkeDu.style.color = farbe;
  }
  if (elements.rcAndereWert) elements.rcAndereWert.textContent = t("rc.andereWert", { prozent: daten.mittelProzent });
  if (elements.rcDuWert) {
    elements.rcDuWert.textContent = t("rc.duWert", { prozent: score });
    elements.rcDuWert.style.color = farbe;
  }
}

/* Antwort-Text nach Score-Band (100 / ≥70 / darunter), eigene Beast-
   Varianten; Echte-Welt-Folgen NUR für „Voll daneben"-Kategorien. Die Texte
   kommen aus den eigenen Locale-Dateien (dürfen <strong> enthalten) — die
   Folgen-Liste entsteht über textContent. */
function antwortAnzeigen(score, vollDaneben) {
  const ziel = elements.rcAntwort;
  if (!ziel) return;
  const beast = getBiasMode() === "boost";
  let schluessel;
  if (score === 100) schluessel = beast ? "rc.antwort.perfektBeast" : "rc.antwort.perfekt";
  else if (score >= 70) schluessel = beast ? "rc.antwort.gutBeast" : "rc.antwort.gut";
  else schluessel = beast ? "rc.antwort.danebenBeast" : "rc.antwort.daneben";

  ziel.innerHTML = t(schluessel);

  if (score < 70 && vollDaneben.length > 0) {
    const liste = document.createElement("ul");
    for (const key of vollDaneben) {
      const zeile = ZEILEN.find((z) => z.key === key);
      if (!zeile) continue;
      const punkt = document.createElement("li");
      punkt.textContent = t(zeile.folgenKey);
      liste.appendChild(punkt);
    }
    ziel.appendChild(liste);
  }
}

function absenden() {
  /* Absenden nur einmal und nur vollständig beantwortet. */
  if (gesperrt || aktiveZeilen.length === 0 || Object.keys(antworten).length < aktiveZeilen.length) return;

  /* Einfrieren: Nachträgliches Herumspielen würde die anonyme Statistik
     verfälschen. `rc-abgesendet` schaltet zugleich den Druck frei (CSS). */
  gesperrt = true;
  const karte = elements.realCheck;
  if (karte) {
    karte.classList.add("rc-gesperrt", "rc-abgesendet");
    karte.classList.add("rc-auswerten-blitz");
    setTimeout(() => karte.classList.remove("rc-auswerten-blitz"), 850);
  }
  if (elements.rcAbsenden) elements.rcAbsenden.hidden = true;

  let summe = 0;
  const vollDaneben = [];
  for (const zeile of aktiveZeilen) {
    summe += antworten[zeile.key];
    if (antworten[zeile.key] === 0) vollDaneben.push(zeile.key);
  }
  const score = Math.round((summe / aktiveZeilen.length) * 100);

  /* Der anonyme Zähler bekommt AUSSCHLIESSLICH die Stufen — den Score
     rechnet der Server selbst (dem Client wird nicht vertraut). */
  logRealitaetsCheck({ ...antworten });

  if (elements.rcErgebnis) elements.rcErgebnis.hidden = false;
  popTon();
  ringAnzeigen(score);
  vergleichAnzeigen(score);
  antwortAnzeigen(score, vollDaneben);

  /* A11y: die EINE Ansage der Prozentzahl — nie pro Animations-Schritt. */
  if (elements.srAnnounce) elements.srAnnounce.textContent = t("rc.srErgebnis", { prozent: score });
}

/* ── Öffentliche Schnittstelle ───────────────────────────────────────────── */

/** Verdrahtet den Absenden-Knopf (einmal beim Seitenstart, app.js). */
export function initRealitaetsCheck() {
  if (elements.rcAbsenden) elements.rcAbsenden.addEventListener("click", absenden);
}

/**
 * Setzt den Check vollständig zurück und versteckt die Karte — für den
 * Start eines neuen Analyse-Durchgangs (api.js) und als Grundlage jedes
 * neuen Ergebnisses.
 */
export function zuruecksetzen() {
  antworten = {};
  gesperrt = false;
  aktiveZeilen = [];
  const karte = elements.realCheck;
  if (karte) {
    karte.hidden = true;
    karte.classList.remove("rc-gesperrt", "rc-abgesendet", "rc-auswerten-blitz", "pop-rein", "lv-verdeckt");
  }
  if (elements.rcZeilen) elements.rcZeilen.innerHTML = "";
  if (elements.rcAbsenden) {
    elements.rcAbsenden.disabled = true;
    elements.rcAbsenden.hidden = false;
  }
  if (elements.rcErgebnis) elements.rcErgebnis.hidden = true;
  if (elements.rcAntwort) elements.rcAntwort.innerHTML = "";
  if (elements.rcProzent) elements.rcProzent.textContent = String(0);
  if (elements.rcRingWert) {
    elements.rcRingWert.style.stroke = "";
    elements.rcRingWert.style.color = "";
    elements.rcRingWert.style.strokeDashoffset = "";
  }
  if (elements.rcBalkenAndere) elements.rcBalkenAndere.style.width = "";
  if (elements.rcVergleich) elements.rcVergleich.hidden = true;
  if (elements.rcWenige) elements.rcWenige.hidden = true;
}

/**
 * Nimmt ein frisch gerendertes Analyse-Ergebnis entgegen (api.js, nach
 * renderCurrentMode): setzt alles zurück und zeigt die Karte NUR bei einem
 * echten Menschen-Profil — mit Zitaten aus dem Profil des aktiven Modus.
 */
export function neuesErgebnis(data) {
  zuruecksetzen();
  if (!istMenschenErgebnis(data)) return;
  zeilenBauen(profilFuerAktivenModus(data), null);
  if (elements.realCheck) elements.realCheck.hidden = false;
}

/**
 * Meldet einen Moduswechsel (app.js, Beast-Schalter). VOR dem Absenden
 * folgen die Zitate dem neuen aktiven Modus (gegebene Antworten bleiben
 * stehen); NACH dem Absenden ist alles eingefroren — die Zitate ändern
 * sich nicht mehr.
 */
export function modusGewechselt(data) {
  if (gesperrt) return;
  if (!elements.realCheck || elements.realCheck.hidden) return;
  if (!istMenschenErgebnis(data)) {
    zuruecksetzen();
    return;
  }
  const bisherige = { ...antworten };
  zeilenBauen(profilFuerAktivenModus(data), bisherige);
}
