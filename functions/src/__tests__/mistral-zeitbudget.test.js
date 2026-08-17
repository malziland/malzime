/**
 * mistral-zeitbudget.test.js — Die erlaubte Ausgabelaenge muss in die erlaubte
 * Zeit passen.
 *
 * HINTERGRUND (BUG-2026-08-17-01): Zwei Konstanten standen jahrelang in
 * verschiedenen Dateien und sahen jede fuer sich plausibel aus — 8000 erlaubte
 * Ausgabe-Token in `mistral.js`, 90 s Zeitgrenze in `config.js`. Multipliziert
 * man sie mit dem gemessenen Schreibtempo, war die Kombination nie erfuellbar:
 * 8000 Token brauchen rund 170 s. Solange der Aufruf ohne Stream lief, fiel das
 * nicht auf, weil die Uhr schon nach den Antwortkopfzeilen abgeraeumt wurde.
 * Seit v3.0.0 laeuft der Aufruf gestreamt und die Uhr bleibt scharf — seitdem
 * starben 2 von 38 Laeufen an einer Grenze, die das Token-Budget ausdruecklich
 * erlaubt hatte.
 *
 * Zwei Audits sind daran vorbeigelaufen, weil niemand die beiden Zahlen
 * gegeneinander gerechnet hat. Genau das tut dieser Test — er ersetzt die
 * Bitte um Sorgfalt durch eine Rechnung, die rot wird.
 *
 * Reine Rechnung auf Konstanten — kein Netzwerk, keine Cloud.
 */

const {
  MISTRAL_SINGLE_LARGE_MAX_TOKENS,
  MISTRAL_SINGLE_LARGE_TIMEOUT_MS,
  MISTRAL_SLOWEST_TOKENS_PER_SECOND,
  MISTRAL_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
} = require("../config");

describe("Zeitbudget des Single-Large-Aufrufs", () => {
  test("die erlaubte Ausgabelaenge passt in die erlaubte Zeit", () => {
    const benoetigteSekunden = MISTRAL_SINGLE_LARGE_MAX_TOKENS / MISTRAL_SLOWEST_TOKENS_PER_SECOND;
    const erlaubteSekunden = MISTRAL_SINGLE_LARGE_TIMEOUT_MS / 1000;

    expect(benoetigteSekunden).toBeLessThanOrEqual(erlaubteSekunden);
  });

  test("es bleibt Reserve — die Grenze liegt nicht auf der Kante", () => {
    /* 15 % Reserve. Ohne diese Zeile waere ein Wertepaar zulaessig, das exakt
       aufgeht: Der langsamste je gemessene Lauf ist keine Untergrenze fuer
       alle kuenftigen Laeufe, sondern nur die langsamste Beobachtung. */
    const benoetigteMs = (MISTRAL_SINGLE_LARGE_MAX_TOKENS / MISTRAL_SLOWEST_TOKENS_PER_SECOND) * 1000;

    expect(MISTRAL_SINGLE_LARGE_TIMEOUT_MS).toBeGreaterThanOrEqual(benoetigteMs * 1.15);
  });

  test("der laengste real gemessene Lauf haette ueberlebt", () => {
    /* 4394 Ausgabe-Token in 83,7 s — der laengste erfolgreiche Lauf im
       Diagnose-Bucket (11.-16.08.2026). Er lag 6 s vor der alten Klippe.
       Diese Probe haelt den Realfall fest, nicht nur die Rechnung. */
    const REAL_LAENGSTER_LAUF_TOKEN = 4394;
    const brauchtMs = (REAL_LAENGSTER_LAUF_TOKEN / MISTRAL_SLOWEST_TOKENS_PER_SECOND) * 1000;

    expect(REAL_LAENGSTER_LAUF_TOKEN).toBeLessThanOrEqual(MISTRAL_SINGLE_LARGE_MAX_TOKENS);
    expect(brauchtMs).toBeLessThan(MISTRAL_SINGLE_LARGE_TIMEOUT_MS);
  });

  test("das eigene Budget ist groesser als die allgemeine Zeitgrenze", () => {
    /* Waere es kleiner oder gleich, waere die ganze Konstante wirkungslos —
       und der Fehler zurueck, ohne dass es jemand merkt. */
    expect(MISTRAL_SINGLE_LARGE_TIMEOUT_MS).toBeGreaterThan(MISTRAL_TIMEOUT_MS);
  });

  test("das Gesamtbudget des Requests deckt den laengsten Einzelaufruf noch ab", () => {
    /* Der Single-Large-Call ist nicht der einzige Aufruf im Durchgang (danach
       kommt beast-ads). Reisst sein Budget das Request-Budget, verschiebt sich
       der Fehler nur eine Ebene nach oben. */
    expect(MISTRAL_SINGLE_LARGE_TIMEOUT_MS).toBeLessThan(REQUEST_BUDGET_MS);
  });
});
