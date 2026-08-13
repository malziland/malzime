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
}
