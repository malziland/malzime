const { createAdminToken } = require("./auth");
const { geltendeWerte } = require("./betriebsprofil");
const { SITE_URL } = require("./domains");

/**
 * Sendet eine Push-Benachrichtigung über ntfy wenn das Stundenlimit erreicht wird.
 * Nur 1× pro Limit-Fenster (bei justReached), nicht bei jeder blockierten Anfrage.
 */

/* ══════════════════════════════════════════════════════════════════════
   KEIN VERSAND AUS DEM TESTBETRIEB (30.08.2026)
   ══════════════════════════════════════════════════════════════════════
   VORFALL: Ein Simulator-Lauf reihte 200 Analysen ein, riss damit das
   Stundenlimit — und schickte eine echte Push-Nachricht auf das Handy des
   Betreibers. Der Emulator holt sich bei angemeldetem Konto die ECHTEN
   Zugangsdaten aus dem Secret Manager; lokale Testwerte gibt es nicht.

   Ein Testlauf darf nicht nach aussen wirken. Zwei Erkennungswege, damit es
   nicht an einer vergessenen Variablen haengt:
     · FIRESTORE_EMULATOR_HOST ist gesetzt  -> Emulator, immer
     · NTFY_STUMM=1                          -> ausdruecklich abgeschaltet
   ══════════════════════════════════════════════════════════════════════ */
function versandUnterdrueckt() {
  if (process.env.NTFY_STUMM === "1") return "NTFY_STUMM=1";
  if (process.env.FIRESTORE_EMULATOR_HOST) return "Emulator-Betrieb";
  return null;
}

async function notifyLimitReached({ ntfyUrl, ntfyTopic, adminSecret, count, limit }) {
  if (!ntfyUrl || !ntfyTopic) return;
  const stumm = versandUnterdrueckt();
  if (stumm) {
    console.log(JSON.stringify({ step: "notify", status: "unterdrueckt", grund: stumm, count, limit }));
    return;
  }

  const baseUrl = SITE_URL;

  /* BUG-003: Timeout verhindert dass ein haengender ntfy-Server die Cloud Function blockiert */
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 5000);
  try {
    /* Wie lange die Knoepfe in dieser Mitteilung gueltig sind — aus dem
       Einstellungssatz, damit die Dauer nur an einer Stelle steht. */
    const { werte } = await geltendeWerte();
    if (!werte) {
      console.error(JSON.stringify({ step: "notify", grund: "kein Einstellungssatz — keine Aktions-Knoepfe" }));
      return;
    }
    const boostToken = createAdminToken("boost", adminSecret, werte.ticketGueltigkeitMs);
    const resetToken = createAdminToken("reset", adminSecret, werte.ticketGueltigkeitMs);

    const res = await fetch(ntfyUrl, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        topic: ntfyTopic,
        title: "malziME: Stundenlimit erreicht",
        message: `${count}/${limit} Analysen in dieser Stunde. Analyse deaktiviert.`,
        priority: 4,
        tags: ["warning"],
        actions: [
          {
            action: "view",
            label: "+100 Analysen",
            url: `${baseUrl}/api/admin/boost?hmac=${encodeURIComponent(boostToken)}`,
          },
          {
            action: "view",
            label: "Reset",
            url: `${baseUrl}/api/admin/reset?hmac=${encodeURIComponent(resetToken)}`,
          },
          {
            action: "view",
            label: "Stats",
            url: `${baseUrl}/stats`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(JSON.stringify({ warning: "ntfy-failed", status: res.status, body }));
    }
  } catch (err) {
    console.log(JSON.stringify({ warning: "ntfy-error", error: err.message }));
  } finally {
    clearTimeout(fetchTimeout);
  }
}

/**
 * Sendet eine schlichte Meldung über ntfy — ohne Schaltflächen, ohne Token.
 *
 * FEATURE-2026-08-29-03: Gebraucht von der Laufzeit-Wache. Bewusst getrennt von
 * `notifyLimitReached`: Die trägt Admin-Aktionen und damit signierte Token im
 * Text; für eine reine Beobachtung wäre das unnötige Angriffsfläche.
 *
 * Wie oben mit Zeitgrenze — ein hängender ntfy-Server darf keine Function
 * blockieren — und still bei Fehlern: Eine Meldung, die nicht ankommt, ist
 * ärgerlich, aber kein Grund, den geplanten Lauf scheitern zu lassen.
 */
async function sendeNtfy({ ntfyUrl, ntfyTopic, text, titel = "malziME", prioritaet = 4 }) {
  if (!ntfyUrl || !ntfyTopic || !text) return false;
  const stumm = versandUnterdrueckt();
  if (stumm) {
    console.log(JSON.stringify({ step: "ntfy", status: "unterdrueckt", grund: stumm, titel }));
    return false;
  }
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(ntfyUrl, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        topic: ntfyTopic,
        title: titel,
        message: text,
        priority: prioritaet,
        tags: ["hourglass"],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(JSON.stringify({ warning: "ntfy-failed", status: res.status, body }));
      return false;
    }
    return true;
  } catch (err) {
    console.log(JSON.stringify({ warning: "ntfy-error", error: err.message }));
    return false;
  } finally {
    clearTimeout(fetchTimeout);
  }
}

module.exports = { notifyLimitReached, sendeNtfy };
