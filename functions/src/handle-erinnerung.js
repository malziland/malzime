"use strict";

/**
 * handle-erinnerung.js — woechentlicher Blick auf datierte Zusagen.
 *
 * Laeuft montags und schickt einen ntfy-Push, sobald die ZDR-Nachpruefung
 * innerhalb der naechsten Woche faellig wird (oder schon ueberfaellig ist).
 * Der Push nennt nicht nur DASS etwas ansteht, sondern auch WAS zu tun ist —
 * eine Erinnerung ohne Anleitung waere nur ein schlechtes Gewissen.
 * Seit 07.10.2026 erinnert derselbe Lauf an die halbjaehrliche Pruefung der
 * Barrierefreiheit — drei Wochen vorher, weil die Handpruefung einen Termin
 * braucht (DOC-2026-10-03-51; Begruendung in zusagen.js).
 *
 * Zwei Schichten, bewusst getrennt:
 *   - hier die freundliche Vorwarnung (eine Woche vorher, aufs Handy)
 *   - in der CI die harte Bremse (`__tests__/zusagen-frische.test.js`),
 *     falls die Vorwarnung untergeht (nur fuer die ZDR-Zusage)
 *
 * Das Pruefdatum wird aus der LIVE-Seite gelesen, nicht aus einer Kopie:
 * Erinnert wird an das, was die Oeffentlichkeit tatsaechlich liest.
 *
 * Fail-soft: Jeder Fehler (Seite nicht erreichbar, Datum unlesbar, ntfy weg)
 * wird nur als Warnung geloggt — eine Erinnerung darf nie den Betrieb stoeren
 * und nie den Fehleralarm ausloesen (kein severity ERROR).
 */

const { datenbank } = require("./db");
const { SITE_URL } = require("./domains");
const {
  leseZdrPruefdatum,
  leseBarrierefreiheitsPruefdatum,
  bewerteFrist,
  formatiereDatum,
  FRIST_TAGE,
  VORWARNUNG_TAGE,
  VORWARNUNG_HANDPRUEFUNG_TAGE,
} = require("./zusagen");

const MISTRAL_DATENSCHUTZ_URL = "https://admin.mistral.ai/plateforme/privacy";
/* OPS-2026-08-12-11: Ablageort des Lebenszeichens. Bewusst neben den uebrigen
   Betriebsdaten und nicht in `jobs` — dort greift seit ARCH-2026-08-12-27 eine
   automatische Loeschregel. */
const LEBENSZEICHEN_DOC = "config/erinnerung";
const ABRUF_TIMEOUT_MS = 8000;

/** Baut den Meldungstext — inklusive der drei Schritte in der richtigen Reihenfolge. */
function baueMeldung(stand) {
  const wann = stand.ueberfaellig
    ? `ÜBERFÄLLIG seit ${Math.abs(stand.tageBisFrist)} Tagen`
    : `fällig in ${stand.tageBisFrist} Tagen`;

  return {
    titel: stand.ueberfaellig ? "malziME: ZDR-Prüfung überfällig" : "malziME: ZDR-Prüfung steht an",
    text:
      `Die Datenschutzerklärung verspricht eine Nachprüfung spätestens halbjährlich — ${wann}.\n` +
      `Zuletzt geprüft: ${stand.datumText} (${stand.tageAlt} Tage her, Frist ${FRIST_TAGE}).\n\n` +
      `1. Im Mistral-Dashboard nachsehen: ist „Null-Datenspeicherung" noch aktiv?\n` +
      `2. Screenshot mit Datum in den Nachweisordner am Desktop legen.\n` +
      `3. Claude sagen: „ZDR geprüft, alles aktiv" — Datum auf der Seite und Deploy macht Claude.\n\n` +
      `Das Datum NIE ohne echte Prüfung ändern.`,
  };
}

/** Dasselbe fuer die halbjaehrliche Pruefung der Barrierefreiheit. */
function baueMeldungBarrierefreiheit(stand) {
  const wann = stand.ueberfaellig
    ? `ÜBERFÄLLIG seit ${Math.abs(stand.tageBisFrist)} Tagen`
    : `fällig in ${stand.tageBisFrist} Tagen`;

  return {
    titel: stand.ueberfaellig
      ? "malziME: Barrierefreiheits-Prüfung überfällig"
      : "malziME: Barrierefreiheits-Prüfung steht an",
    text:
      `Die Erklärung zur Barrierefreiheit verspricht die ganze Prüfung samt Handprüfung mindestens halbjährlich — ${wann}.\n` +
      `Zuletzt geprüft: ${stand.datumText} (${stand.tageAlt} Tage her, Frist ${FRIST_TAGE}).\n\n` +
      `1. Claude sagen: „Barrierefreiheit neu prüfen" — Messungen und Protokoll macht Claude.\n` +
      `2. Gemeinsam von Hand prüfen: Tastatur und Vorlese-Programm, am Rechner und am Handy.\n` +
      `3. Erst danach setzt Claude das Prüfdatum auf der Seite hoch und liefert aus.\n\n` +
      `Das Datum NIE ohne echte Prüfung ändern.`,
  };
}

/* Die datierten Zusagen, an die erinnert wird — jede mit der Seite, die ihr
   Datum oeffentlich nennt. Die Reihenfolge ist die der Abarbeitung. */
const ZUSAGEN = [
  {
    kennung: "zdr",
    pfad: "/datenschutz.html",
    lese: leseZdrPruefdatum,
    vorwarnungTage: VORWARNUNG_TAGE,
    meldung: baueMeldung,
    tags: ["calendar", "shield"],
    knopf: { label: "Mistral-Dashboard", url: MISTRAL_DATENSCHUTZ_URL },
  },
  {
    kennung: "barrierefreiheit",
    pfad: "/barrierefreiheit.html",
    lese: leseBarrierefreiheitsPruefdatum,
    vorwarnungTage: VORWARNUNG_HANDPRUEFUNG_TAGE,
    meldung: baueMeldungBarrierefreiheit,
    tags: ["calendar", "wheelchair"],
    knopf: { label: "Erklärung ansehen", url: `${SITE_URL}/barrierefreiheit` },
  },
];

/**
 * Prüft EINE Zusage: Seite lesen, Frist bewerten, bei Bedarf den Push schicken.
 * Wirft nie. `bewertet` sagt, ob die Frist WIRKLICH gelesen und bewertet wurde
 * — davon haengt das Lebenszeichen ab, nicht davon, ob ein Push hinausging.
 */
async function pruefeEine(zusage, { ntfyUrl, ntfyTopic, abruf, jetzt }) {
  let bewertet = false;
  const ende = (ergebnis) => ({ ergebnis, bewertet });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ABRUF_TIMEOUT_MS);
    let html;
    try {
      const res = await abruf(`${SITE_URL}${zusage.pfad}`, { signal: controller.signal });
      if (!res.ok) {
        console.log(
          JSON.stringify({ warning: "erinnerung-seite-nicht-lesbar", zusage: zusage.kennung, status: res.status })
        );
        return ende({ gesendet: false, grund: "seite-nicht-lesbar" });
      }
      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }

    const datum = zusage.lese(html);
    if (!datum) {
      /* Formulierung geaendert oder Datum entfernt — das ist ein echter
         Fund, aber kein Grund den Betrieb zu stoeren. Fuer die ZDR-Zusage
         faellt die CI-Bremse darueber ohnehin um; fuer beide meldet der
         Waechter das ausbleibende `letzterErfolg`. */
      console.log(JSON.stringify({ warning: "erinnerung-pruefdatum-unlesbar", zusage: zusage.kennung }));
      return ende({ gesendet: false, grund: "pruefdatum-unlesbar" });
    }

    const stand = { ...bewerteFrist(datum, jetzt, zusage.vorwarnungTage), datumText: formatiereDatum(datum) };
    /* Ab hier ist die Frist gelesen und bewertet — die Kernaufgabe ist erfüllt,
       auch wenn nichts fällig ist oder der Push später scheitert. */
    bewertet = true;
    if (!stand.faellig) {
      console.log(
        JSON.stringify({ info: "erinnerung-nichts-faellig", zusage: zusage.kennung, tageBisFrist: stand.tageBisFrist })
      );
      return ende({ gesendet: false, grund: "nichts-faellig", tageBisFrist: stand.tageBisFrist });
    }

    if (!ntfyUrl || !ntfyTopic) {
      console.log(JSON.stringify({ warning: "erinnerung-ohne-ntfy-konfiguration", zusage: zusage.kennung }));
      return ende({ gesendet: false, grund: "keine-ntfy-konfiguration" });
    }

    const meldung = zusage.meldung(stand);
    const pushController = new AbortController();
    const pushTimeout = setTimeout(() => pushController.abort(), 5000);
    try {
      const res = await abruf(ntfyUrl, {
        signal: pushController.signal,
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          topic: ntfyTopic,
          title: meldung.titel,
          message: meldung.text,
          priority: stand.ueberfaellig ? 5 : 4,
          tags: zusage.tags,
          actions: [{ action: "view", label: zusage.knopf.label, url: zusage.knopf.url }],
        }),
      });
      if (!res.ok) {
        console.log(
          JSON.stringify({ warning: "erinnerung-ntfy-fehlgeschlagen", zusage: zusage.kennung, status: res.status })
        );
        return ende({ gesendet: false, grund: "ntfy-fehlgeschlagen" });
      }
    } finally {
      clearTimeout(pushTimeout);
    }

    console.log(
      JSON.stringify({
        info: "erinnerung-gesendet",
        zusage: zusage.kennung,
        tageBisFrist: stand.tageBisFrist,
        ueberfaellig: stand.ueberfaellig,
      })
    );
    return ende({ gesendet: true, tageBisFrist: stand.tageBisFrist, ueberfaellig: stand.ueberfaellig });
  } catch (err) {
    console.log(JSON.stringify({ warning: "erinnerung-fehler", zusage: zusage.kennung, error: err.message }));
    return ende({ gesendet: false, grund: "fehler" });
  }
}

/**
 * Prüft alle Zusagen nacheinander und hinterlaesst EIN Lebenszeichen.
 * Gibt je Zusage das Ergebnis zurueck (`{ zdr, barrierefreiheit }`).
 * `abruf` und `jetzt` sind injizierbar, damit Tests ohne Netz und ohne
 * echte Uhr laufen.
 */
async function pruefeAlleZusagen({ ntfyUrl, ntfyTopic, abruf = fetch, jetzt = Date.now() } = {}) {
  /* OPS-2026-08-13-44: Der Reaper-Wächter darf nicht schon dann grün bleiben,
     wenn diese Funktion bloß GELAUFEN ist — sonst hält eine Erinnerung, die
     jeden Montag scheitert (Seite nicht lesbar, Datum unlesbar, Absturz), den
     Wächter über ihr `letzterLauf`-Feld ewig ruhig. Dieses Flag wird erst true,
     wenn JEDE Frist WIRKLICH gelesen und bewertet wurde — scheitert nur eine
     der Zusagen, bleibt `letzterErfolg` stehen und der Wächter meldet es. Das
     Lebenszeichen führt `letzterErfolg` getrennt von `letzterLauf`, und der
     Wächter schaut auf `letzterErfolg`. */
  let checkGelang = false;
  try {
    const ergebnisse = {};
    let alleBewertet = true;
    for (const zusage of ZUSAGEN) {
      const lauf = await pruefeEine(zusage, { ntfyUrl, ntfyTopic, abruf, jetzt });
      ergebnisse[zusage.kennung] = lauf.ergebnis;
      if (!lauf.bewertet) alleBewertet = false;
    }
    checkGelang = alleBewertet;
    return ergebnisse;
  } finally {
    /* AUDIT-BEFUND OPS-2026-08-12-11: Diese Funktion schweigt in JEDEM Fehlerfall
       — bewusst, damit sie nicht den Fehleralarm ausloest (RUNBOOK). Die Folge
       war aber, dass eine tote und eine gesunde Erinnerung 180 Tage lang
       ununterscheidbar sind: Bis zum ersten faelligen Push ist Schweigen das
       korrekte Verhalten. Deshalb hinterlaesst jeder Lauf ein Lebenszeichen.
       Wer darauf schaut, ist der Reaper (handle-reap.js) — er laeuft jede Minute
       und steht in der Alarmrichtlinie. Ein ausbleibendes Lebenszeichen wird so
       laut, ohne dass die Erinnerung selbst laut werden muss. */
    await schreibeLebenszeichen(checkGelang);
  }
}

/** Wie bisher: laeuft alle Zusagen und gibt das Ergebnis der ZDR-Zusage zurueck. */
async function pruefeZusagen(optionen) {
  return (await pruefeAlleZusagen(optionen)).zdr;
}

/* Lebenszeichen: kein Personenbezug, keine Nutzdaten. `letzterLauf` sagt „die
   Funktion lief", `letzterErfolg` sagt „die Frist wurde wirklich bewertet". Der
   Reaper-Wächter schaut auf letzteres (OPS-2026-08-13-44). */
async function schreibeLebenszeichen(erfolg = false) {
  try {
    const daten = { letzterLauf: Date.now() };
    if (erfolg) daten.letzterErfolg = Date.now();
    await datenbank().doc(LEBENSZEICHEN_DOC).set(daten, { merge: true });
  } catch (err) {
    /* Schlaegt selbst das fehl, ist der Lauf ohnehin gestoert — und der Reaper
       meldet das ausbleibende Lebenszeichen wenig spaeter. */
    console.log(JSON.stringify({ warning: "erinnerung-lebenszeichen-fehlgeschlagen", error: err.message }));
  }
}

module.exports = { pruefeZusagen, pruefeAlleZusagen, baueMeldung, baueMeldungBarrierefreiheit, LEBENSZEICHEN_DOC };
