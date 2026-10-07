/* ── Netz- und Warte-Hilfen des Analyse-Ablaufs ─────────────────────────
   Bis 07.10.2026 Teil von js/api.js; das Verhalten ist unverändert. Hier
   steht, was mit dem Ablauf selbst nichts zu tun hat: ein Aufruf mit
   Zeitgrenze, das Warten auf den nächsten Takt und eine schlichte Pause. */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* BUG-003 (offen seit dem KURZAUDIT 07/2026, geschlossen 08/2026): Der Timer
   lief frueher im `.finally()` der fetch-Promise aus — also sobald die
   Kopfzeilen da waren. Bricht die Verbindung danach mitten im Antwort-Rumpf ab,
   ohne sich zu schliessen (typisch beim Zellenwechsel im Schulgebaeude), settelt
   `resp.json()` nie und die Warteschleife friert lautlos ein.
   Jetzt laeuft der Timer weiter, bis der Rumpf gelesen ist: `fetchWithTimeout`
   liefert die Antwort samt einer `jsonMitTimeout()`-Methode, die den Abbruch
   mit abdeckt.
   `abbruch` (wahlfrei): ein Abbruch-Schalter des Aufrufers. Loest er aus,
   endet auch dieser Aufruf — getrennt vom Zeitlimit, damit der Aufrufer
   beides auseinanderhalten kann. */
export function fetchWithTimeout(url, options, timeoutMs, abbruch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (abbruch) {
    if (abbruch.signal.aborted) controller.abort();
    else abbruch.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(url, { ...options, signal: controller.signal }).then(
    (resp) => {
      const roh = typeof resp.json === "function" ? resp.json.bind(resp) : null;
      /* Bei Fehlerantworten ist der Rumpf klein und wird ueber clone() gelesen —
         da braucht es keinen laufenden Timer mehr. Nur im Erfolgsfall bleibt er
         scharf, bis der Rumpf tatsaechlich gelesen ist. */
      if (!resp.ok || !roh) clearTimeout(timer);
      resp.jsonMitTimeout = roh
        ? () => roh().finally(() => clearTimeout(timer))
        : () => Promise.reject(new Error("Antwort ohne JSON-Rumpf"));
      return resp;
    },
    (err) => {
      clearTimeout(timer);
      throw err;
    }
  );
}

/**
 * Wartet bis zum nächsten Poll — weckt aber sofort auf, sobald der Tab wieder
 * sichtbar wird. Hintergrund: Browser drosseln Timer in versteckten Tabs
 * massiv (am Handy frieren sie ganz ein). Ohne dieses Aufwecken holt ein
 * zurückkehrender Nutzer sein längst fertiges Ergebnis erst nach der
 * gedrosselten Verzögerung ab — das fühlt sich wie Minuten totes Warten an.
 * Mit dem visibilitychange-Wecker erscheint das Ergebnis ~1 s nach Rückkehr.
 * Der Listener wird pro Wartezyklus sauber wieder abgemeldet.
 */
export function waitForNextPoll(ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const onVisible = () => {
      if (document.visibilityState === "visible") finish();
    };
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    }
    timer = setTimeout(finish, ms);
    document.addEventListener("visibilitychange", onVisible);
  });
}
