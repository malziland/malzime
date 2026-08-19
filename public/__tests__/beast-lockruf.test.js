import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initBeastLockruf, _zuruecksetzen, PROFIL_FERTIG } from "../js/beast-lockruf.js";

/* Der Beast-Lockruf — zeigt einmal auf den Umschalter, wenn das Profil steht.
 *
 * ANLASS 2026-08-19, Wunsch des Nutzers: "Die Seite wird weiterverlinkt,
 * weitergegeben, auf den sozialen Medien hochgeladen, und es gibt genug, die
 * sich das ohne Begleitung später auch ansehen." Im Workshop sagt der Trainer
 * "schaltet jetzt um" — ohne Begleitung sagt es niemand.
 *
 * Der Kern dieser Datei ist die Frage, WANN der Lockruf NICHT kommt. Er zeigt
 * auf ein Ergebnis; kommt er, wo keines ist, ist er schlimmer als gar nichts.
 * Deshalb haengt er am Ereignis aus abschlussAnzeigen() und nicht am Ende der
 * Blick-Fuehrung: Letzteres feuert auch bei Fehler und Abbruch.
 */

const WARTE_MS = 3000;
const DAUER_MS = 4600;

function seiteBauen({ beastAn = false, ergebnis = true } = {}) {
  /* `data-has-result` setzt render.js, wenn das Profil vollstaendig steht —
     und nimmt es bei Fehler und Abbruch wieder weg. Der Lockruf prueft es. */
  if (ergebnis) document.documentElement.setAttribute("data-has-result", "1");
  else document.documentElement.removeAttribute("data-has-result");
  document.body.innerHTML = `
    <div class="bias-toggle-wrap">
      <div class="bias-toggle">
        <label class="toggle-switch">
          <input type="checkbox" id="biasSwitch" ${beastAn ? "checked" : ""} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>`;
}

const pille = () => document.querySelector(".bias-toggle");
const laeuft = () => pille().classList.contains("bias-lockruf");
const fuellung = () => document.querySelector(".bias-lockruf-fuellung");
const fertigMelden = () => document.dispatchEvent(new CustomEvent(PROFIL_FERTIG));

describe("Beast-Lockruf", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seiteBauen();
    _zuruecksetzen();
  });

  afterEach(() => {
    _zuruecksetzen();
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-has-result");
  });

  it("kommt drei Sekunden nach dem fertigen Profil", () => {
    initBeastLockruf();
    fertigMelden();
    expect(laeuft()).toBe(false);

    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(true);
    expect(fuellung()).not.toBeNull();
  });

  it("die Fuellung sitzt IN der Rille und VOR dem Schieber", () => {
    /* Sonst laeuft sie ueber den Schieber und verdeckt ihn — die Rille soll
       volllaufen, der Schieber soll sichtbar bleiben. */
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);

    const spur = document.querySelector(".toggle-track");
    expect(fuellung().parentElement).toBe(spur);
    expect(spur.firstElementChild).toBe(fuellung());
  });

  it("kommt keine Sekunde frueher", () => {
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS - 1);
    expect(laeuft()).toBe(false);
  });

  it("raeumt sich nach dem Lauf restlos ab", () => {
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS + DAUER_MS);
    expect(laeuft()).toBe(false);
    expect(fuellung()).toBeNull();
  });

  it("kommt nie ein zweites Mal", () => {
    /* Ein zweiter Analyse-Durchgang meldet erneut "fertig". Wer den Hinweis
       einmal gesehen hat, braucht ihn nicht wieder. */
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS + DAUER_MS);

    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(false);
  });

  it("bleibt aus, wenn gar kein Ergebnis dasteht", () => {
    /* Der Riegel gegen den schlimmsten Fall: Ein Hinweis, der auf ein Profil
       zeigt, das nach einem Fehler nie erschienen ist. Beide Sender rufen zwar
       nur im Erfolgsfall — aber ein Hinweis auf nichts ist so peinlich, dass
       es dafuer zwei Schlösser gibt. */
    seiteBauen({ ergebnis: false });
    _zuruecksetzen();
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(false);
  });

  it("bleibt aus, wenn der Schalter schon bedient wurde", () => {
    initBeastLockruf();
    document.getElementById("biasSwitch").dispatchEvent(new Event("change"));
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(false);
  });

  it("bleibt aus, wenn die Seite schon im Beast-Modus startet", () => {
    /* Gemerkte Wahl aus der Sitzung: Diese Person kennt den Schalter. */
    seiteBauen({ beastAn: true });
    _zuruecksetzen();
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(false);
  });

  it("bricht ab, wenn waehrend der Wartezeit umgeschaltet wird", () => {
    /* Der haeufigste Fall in der Praxis: Jemand findet den Schalter von
       selbst, waehrend die drei Sekunden noch laufen. Dann darf der Hinweis
       nicht nachtraeglich losgehen. */
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS - 500);
    document.getElementById("biasSwitch").dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(WARTE_MS);
    expect(laeuft()).toBe(false);
    expect(fuellung()).toBeNull();
  });

  it("mehrfaches Anmelden bleibt folgenlos", () => {
    initBeastLockruf();
    initBeastLockruf();
    initBeastLockruf();
    fertigMelden();
    vi.advanceTimersByTime(WARTE_MS);
    expect(document.querySelectorAll(".bias-lockruf-fuellung")).toHaveLength(1);
  });

  it("ohne Umschalter im Dokument passiert nichts", () => {
    /* Die Rechts- und Zahlen-Seiten laden dasselbe Buendel nicht, aber ein
       Teilausbau darf nie mit einem Fehler enden. */
    document.body.innerHTML = "";
    _zuruecksetzen();
    expect(() => {
      initBeastLockruf();
      fertigMelden();
      vi.advanceTimersByTime(WARTE_MS);
    }).not.toThrow();
  });
});
