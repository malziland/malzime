"use strict";

/**
 * handle-erinnerung.js — woechentlicher Blick auf datierte Zusagen.
 *
 * Laeuft montags und schickt einen ntfy-Push, sobald die ZDR-Nachpruefung
 * innerhalb der naechsten Woche faellig wird (oder schon ueberfaellig ist).
 * Der Push nennt nicht nur DASS etwas ansteht, sondern auch WAS zu tun ist —
 * eine Erinnerung ohne Anleitung waere nur ein schlechtes Gewissen.
 *
 * Zwei Schichten, bewusst getrennt:
 *   - hier die freundliche Vorwarnung (eine Woche vorher, aufs Handy)
 *   - in der CI die harte Bremse (`__tests__/zusagen-frische.test.js`),
 *     falls die Vorwarnung untergeht
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
const { leseZdrPruefdatum, bewerteFrist, formatiereDatum, FRIST_TAGE } = require("./zusagen");

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

/**
 * Prüft die Frist und schickt bei Bedarf den Push.
 * `abruf` und `jetzt` sind injizierbar, damit Tests ohne Netz und ohne
 * echte Uhr laufen.
 */
async function pruefeZusagen({ ntfyUrl, ntfyTopic, abruf = fetch, jetzt = Date.now() } = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ABRUF_TIMEOUT_MS);
    let html;
    try {
      const res = await abruf(`${SITE_URL}/datenschutz.html`, { signal: controller.signal });
      if (!res.ok) {
        console.log(JSON.stringify({ warning: "erinnerung-seite-nicht-lesbar", status: res.status }));
        return { gesendet: false, grund: "seite-nicht-lesbar" };
      }
      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }

    const datum = leseZdrPruefdatum(html);
    if (!datum) {
      /* Formulierung geaendert oder Datum entfernt — das ist ein echter
         Fund, aber kein Grund den Betrieb zu stoeren. Die CI-Bremse faellt
         darueber ohnehin um. */
      console.log(JSON.stringify({ warning: "erinnerung-pruefdatum-unlesbar" }));
      return { gesendet: false, grund: "pruefdatum-unlesbar" };
    }

    const stand = { ...bewerteFrist(datum, jetzt), datumText: formatiereDatum(datum) };
    if (!stand.faellig) {
      console.log(JSON.stringify({ info: "erinnerung-nichts-faellig", tageBisFrist: stand.tageBisFrist }));
      return { gesendet: false, grund: "nichts-faellig", tageBisFrist: stand.tageBisFrist };
    }

    if (!ntfyUrl || !ntfyTopic) {
      console.log(JSON.stringify({ warning: "erinnerung-ohne-ntfy-konfiguration" }));
      return { gesendet: false, grund: "keine-ntfy-konfiguration" };
    }

    const meldung = baueMeldung(stand);
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
          tags: ["calendar", "shield"],
          actions: [{ action: "view", label: "Mistral-Dashboard", url: MISTRAL_DATENSCHUTZ_URL }],
        }),
      });
      if (!res.ok) {
        console.log(JSON.stringify({ warning: "erinnerung-ntfy-fehlgeschlagen", status: res.status }));
        return { gesendet: false, grund: "ntfy-fehlgeschlagen" };
      }
    } finally {
      clearTimeout(pushTimeout);
    }

    console.log(
      JSON.stringify({
        info: "erinnerung-gesendet",
        tageBisFrist: stand.tageBisFrist,
        ueberfaellig: stand.ueberfaellig,
      })
    );
    return { gesendet: true, tageBisFrist: stand.tageBisFrist, ueberfaellig: stand.ueberfaellig };
  } catch (err) {
    console.log(JSON.stringify({ warning: "erinnerung-fehler", error: err.message }));
    return { gesendet: false, grund: "fehler" };
  } finally {
    /* AUDIT-BEFUND OPS-2026-08-12-11: Diese Funktion schweigt in JEDEM Fehlerfall
       — bewusst, damit sie nicht den Fehleralarm ausloest (RUNBOOK). Die Folge
       war aber, dass eine tote und eine gesunde Erinnerung 180 Tage lang
       ununterscheidbar sind: Bis zum ersten faelligen Push ist Schweigen das
       korrekte Verhalten. Deshalb hinterlaesst jeder Lauf ein Lebenszeichen.
       Wer darauf schaut, ist der Reaper (handle-reap.js) — er laeuft jede Minute
       und steht in der Alarmrichtlinie. Ein ausbleibendes Lebenszeichen wird so
       laut, ohne dass die Erinnerung selbst laut werden muss. */
    await schreibeLebenszeichen();
  }
}

/* Lebenszeichen: ein einziges Feld, kein Personenbezug, keine Nutzdaten. */
async function schreibeLebenszeichen() {
  try {
    await datenbank().doc(LEBENSZEICHEN_DOC).set({ letzterLauf: Date.now() }, { merge: true });
  } catch (err) {
    /* Schlaegt selbst das fehl, ist der Lauf ohnehin gestoert — und der Reaper
       meldet das ausbleibende Lebenszeichen wenig spaeter. */
    console.log(JSON.stringify({ warning: "erinnerung-lebenszeichen-fehlgeschlagen", error: err.message }));
  }
}

module.exports = { pruefeZusagen, baueMeldung, schreibeLebenszeichen, LEBENSZEICHEN_DOC };
