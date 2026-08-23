/* ── i18n Micro-Modul ── */

let strings = {};
let lang = "de";

/**
 * Initialisiert das i18n-System.
 * Lädt manifest.json, erkennt die Browser-Sprache, lädt die passende Locale-Datei.
 * Muss als erstes in app.js aufgerufen werden (await initI18n()).
 */
export async function initI18n() {
  try {
    const manifestRes = await fetch("/locales/manifest.json");
    const manifest = await manifestRes.json();

    const urlLang = new URLSearchParams(window.location.search).get("lang");
    /* v3.3: Eine im Tab getroffene Wahl überlebt das Neuladen — aber nicht den
       Tab. Genau wie beim Beast-Modus (js/modus-speicher.js): Im Workshop
       startet jedes weitergereichte Gerät wieder in der Gerätesprache. Eine
       ausdrückliche Angabe in der Adresse schlägt die gemerkte Wahl. */
    let gemerkt = null;
    try {
      gemerkt = sessionStorage.getItem("malzime-sprache");
    } catch (_err) {
      /* Privater Modus — dann gilt eben die Gerätesprache. */
    }
    const browserLang = (navigator.language || "de").split("-")[0].toLowerCase();
    const requested = urlLang || gemerkt || browserLang;
    lang = manifest.languages.includes(requested) ? requested : manifest.default;

    const stringsRes = await fetch(`/locales/${lang}.json`);
    strings = await stringsRes.json();
  } catch (_err) {
    /* Manifest oder Locale nicht ladbar — App läuft mit HTML-Fallback-Texten weiter */
    console.warn("[i18n] Failed to load locale, using HTML fallback");
    lang = "de";
    strings = {};
  }

  document.documentElement.lang = lang;
}

/**
 * Wechselt die Sprache zur Laufzeit: lädt die zweite Locale-Datei nach und
 * zeichnet alle beschrifteten Elemente neu.
 *
 * Beim Start lädt die Seite bewusst nur EINE Sprachdatei (~14 kB) — die zweite
 * holt erst dieser Aufruf, also nur, wenn wirklich jemand umschaltet. Schlägt
 * das Laden fehl, bleibt die bisherige Sprache unverändert stehen; ein halb
 * übersetzter Bildschirm wäre schlimmer als gar kein Wechsel.
 *
 * @param {string} neu Sprachcode aus dem Manifest ("de" | "en")
 * @returns {Promise<boolean>} true, wenn wirklich gewechselt wurde
 */
export async function setLanguage(neu) {
  if (!neu || neu === lang) return false;
  let geladen;
  try {
    const res = await fetch(`/locales/${neu}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geladen = await res.json();
  } catch (_err) {
    console.warn("[i18n] Sprachdatei nicht ladbar, bleibe bei", lang);
    return false;
  }
  strings = geladen;
  lang = neu;
  document.documentElement.lang = lang;
  applyTranslations();
  return true;
}

/**
 * Übersetzt einen Key.
 *
 * t("hero.badge")                    → "SYSTEM AKTIV"
 * t("footer.copy", { year: 2026 })   → "© 2026 malziME • powered by malziland"
 * t("scan.messages")                 → ["Gesicht erkannt…", ...]
 * t("nicht.vorhanden")               → "nicht.vorhanden" (Key als Fallback)
 */
export function t(key, params) {
  const value = strings[key];
  if (value === undefined) return key;
  if (Array.isArray(value)) return value;

  let result = value;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replaceAll(`{{${k}}}`, v);
    }
  }
  return result;
}

/** Gibt den aktuellen Sprachcode zurück ("de", "en", ...). */
export function getLanguage() {
  return lang;
}

/**
 * Befüllt alle HTML-Elemente die data-i18n-Attribute haben.
 *
 * data-i18n="hero.title"       → element.textContent = t("hero.title")
 * data-i18n-alt="preview.alt"  → element.alt = t("preview.alt")
 *
 * Nur wenn t() einen Wert liefert der nicht dem Key entspricht (= Key existiert in JSON).
 * Bei fehlenden Keys bleibt der HTML-Fallback-Text stehen.
 */
export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (text !== key) el.textContent = text;
  });

  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const key = el.getAttribute("data-i18n-alt");
    const text = t(key);
    if (text !== key) el.alt = text;
  });

  /* 2026-08-13: Sprachabhängige Bildquelle. Die KI-Kennzeichnung ist in die
     Pixel der Demo-Fotos gebrannt (Pflicht seit 08/2026 — ein CSS-Etikett
     verschwindet, sobald jemand das Bild speichert). Ein gebranntes Zeichen kann
     nicht mitübersetzen, deshalb gibt es zwei Dateisätze: „KI ERSTELLT" und
     „AI GENERATED". Der Cache-Buster steht im HTML und bleibt erhalten — nur
     der Dateiname wird getauscht. */
  document.querySelectorAll("[data-i18n-src]").forEach((el) => {
    const key = el.getAttribute("data-i18n-src");
    const pfad = t(key);
    if (pfad !== key) {
      const buster = (el.getAttribute("src") || "").split("?")[1];
      el.setAttribute("src", buster ? `${pfad}?${buster}` : pfad);
    }
  });

  /* A11Y-001 (Audit 2026-08-10): aria-label war nicht uebersetzbar. Der
     Hauptumschalter wurde englischsprachigen Screenreader-Nutzern als
     „Beast Mode aktivieren" vorgelesen, die Konfidenz-Punkte 13x als
     „Konfidenz". axe kann das nicht sehen — es prueft nur, DASS eine
     Beschriftung existiert, nicht in welcher Sprache. */
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const text = t(key);
    if (text !== key) el.setAttribute("aria-label", text);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const text = t(key);
    if (text !== key) el.title = text;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const text = t(key);
    if (text !== key) el.placeholder = text;
  });

  /* innerHTML for elements with embedded HTML (e.g. <strong> tags).
     Safe because strings come from our own locale files, not user input. */
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    const text = t(key);
    if (text !== key) el.innerHTML = text;
  });

  /* ZULETZT — die Reihenfolge ist wesentlich. Der Block darüber ersetzt ganze
     innerHTML-Bereiche, und in einem davon steckt ein Link (der Verweis auf die
     Datenschutzerklärung im Hochlade-Hinweis). Vor diesen beiden Zeilen
     gesetzt, wären Ziel und Sprache dort sofort wieder überschrieben.

     Erst das Ziel, dann das Anhängsel. Der Tausch erhält den Suchteil, beide
     Reihenfolgen kämen also auf dasselbe heraus; so gelesen entsteht die
     Adresse aber in derselben Folge, in der sie am Ende dasteht. */
  rechtsseitenAufSpracheStellen();
  spracheAnLinksHaengen();
}

/* ── Die vier Rechtsseiten und ihre englischen Zwillinge ──────────────────
 *
 * Seit 2026-08-18 gibt es jede Rechtsseite zweimal. Die Fußzeile übersetzte
 * bis dahin nur ihre BESCHRIFTUNG: Auf Englisch stand dort „Privacy Policy",
 * der Klick landete trotzdem auf der deutschen Seite. Eine übersetzte
 * Beschriftung mit unübersetztem Ziel ist schlimmer als eine unübersetzte —
 * sie verspricht etwas, das der Klick nicht hält.
 *
 * Diese Tabelle ist die EINZIGE Zuordnung im Frontend, und sie ist
 * ausdrücklich nach außen gegeben (`export`), damit die Wächter sie LESEN
 * statt sie abzuschreiben: i18n-guardian.test.js hält sie gegen die kanonische Paarliste
 * RECHTS_PAARE, gegen die Dateien unter public/en/ und gegen die Rewrites in
 * firebase.json. Eine stumme zweite Liste driftet, eine geprüfte nicht.
 *
 * Der Rückweg wird abgeleitet und nicht ein zweites Mal geschrieben — sonst
 * säße genau hier die nächste Drift.
 *
 * /stats fehlt bewusst: Die Zahlen-Seite ist DIESELBE Datei in beiden Sprachen
 * (`?lang=`). Sie hat kein Gegenstück und braucht keins.
 */
export const RECHTSSEITEN = Object.freeze({
  "/impressum": "/en/legal-notice",
  "/datenschutz": "/en/privacy",
  "/nutzungsbedingungen": "/en/terms",
  "/barrierefreiheit": "/en/accessibility",
  "/kurzvorstellung": "/en/introduction",
});

const ZURUECK_AUF_DEUTSCH = Object.freeze(Object.fromEntries(Object.entries(RECHTSSEITEN).map(([de, en]) => [en, de])));

/**
 * Stellt die Ziele der Rechts-Links auf die eingestellte Sprache um.
 *
 * Anders als beim Sprach-Anhängsel darunter zählt hier NICHT nur
 * `target="_blank"`: Die Zahlen-Seite verlinkt die Rechtsseiten im selben Tab.
 * Gesucht wird deshalb über jeden internen Link.
 *
 * Getauscht wird nur der Pfad. Ein vorhandener Suchteil bleibt stehen, damit
 * das Sprach-Anhängsel und alles andere in der Adresse den Tausch überlebt.
 *
 * Deutsch ist die Rückfallsprache: Ist etwas anderes als Englisch
 * eingestellt — heute unmöglich, morgen vielleicht nicht —, führen die Links
 * auf die deutschen Seiten. Das ist der einzige vollständige Satz; ein Verweis auf
 * eine Seite, die es nicht gibt, wäre die schlechtere Antwort.
 */
function rechtsseitenAufSpracheStellen() {
  const tabelle = lang === "en" ? RECHTSSEITEN : ZURUECK_AUF_DEUTSCH;
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const roh = a.getAttribute("href");
    if (!roh) return;
    try {
      const ziel = new URL(roh, window.location.origin);
      const neu = tabelle[ziel.pathname];
      if (!neu) return;
      ziel.pathname = neu;
      a.setAttribute("href", ziel.pathname + ziel.search + ziel.hash);
    } catch (_err) {
      /* Kaputte Adresse im HTML — dann bleibt der Link, wie er ist. */
    }
  });
}

/**
 * Hängt die aktuelle Sprache an alle internen Links, die einen NEUEN TAB
 * öffnen (v3.3.1).
 *
 * WARUM: Die Sprachwahl liegt im `sessionStorage` — bewusst pro Tab, damit ein
 * weitergereichtes Workshop-Gerät wieder in der Gerätesprache startet. Ein mit
 * `target="_blank"` geöffneter Tab bekommt aber einen LEEREN sessionStorage.
 * Wer also auf der englischen Startseite die Zahlen-Seite anklickte, landete
 * dort auf Deutsch — die Wahl blieb im alten Tab zurück.
 *
 * Betroffen sind genau die sechs Links der Startseite; die Unterseiten
 * verlinken untereinander im selben Tab und brauchen nichts. Gestempelt wird
 * trotzdem nach Merkmal statt nach Seite: Käme irgendwo ein siebenter Link mit
 * `target="_blank"` dazu, wäre er von selbst richtig.
 *
 * Immer BEIDE Sprachen stempeln, nie nur Englisch: Steht das Gerät auf
 * Englisch und jemand hat die Seite auf Deutsch gestellt, wäre ein fehlender
 * Wert genauso falsch herum.
 *
 * Kein Speicher, keine Schnittstelle — die Sprache reist sichtbar in der
 * Adresse mit. `searchParams.set` ist dabei idempotent: Mehrfaches Anwenden
 * hängt nichts an, es überschreibt.
 */
function spracheAnLinksHaengen() {
  document.querySelectorAll('a[target="_blank"][href^="/"]').forEach((a) => {
    const roh = a.getAttribute("href");
    if (!roh) return;
    try {
      const ziel = new URL(roh, window.location.origin);
      ziel.searchParams.set("lang", lang);
      a.setAttribute("href", ziel.pathname + ziel.search + ziel.hash);
    } catch (_err) {
      /* Kaputte Adresse im HTML — dann bleibt der Link, wie er ist. */
    }
  });
}
