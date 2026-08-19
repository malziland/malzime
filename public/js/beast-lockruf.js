/**
 * Der Beast-Lockruf — einmal auf den Umschalter zeigen, wenn das Profil steht.
 *
 * WOZU. Im Workshop sagt der Trainer „schaltet jetzt mal um". Ohne Begleitung
 * sagt es niemand: Die Seite wird weiterverlinkt, geteilt und spaeter allein
 * angesehen, und wer den Schalter uebersieht, sieht nur die haelfte des
 * Erlebnisses. Der Lockruf ist fuer diese Menschen.
 *
 * WANN. Erst wenn das Profil vollstaendig dasteht UND die gestaffelte
 * Enthuellung durch ist, danach drei Sekunden Ruhe. Frueher waere es falsch:
 * Der Kontrast zwischen der sachlichen und der schonungslosen Fassung ist der
 * didaktische Kern — wer waehrend des Aufbaus umschaltet, zerstoert ihn.
 *
 * WORAN ES HAENGT. Am Ereignis PROFIL_FERTIG. Das senden ZWEI Stellen, weil
 * es zwei Wege zu einem fertigen Profil gibt:
 *
 *   js/live-anzeige.js  am Ende der gestaffelten Enthuellung
 *   js/api.js           wenn gar keine Enthuellung laeuft
 *
 * Der zweite Weg ist der leicht zu uebersehende, und er ist kein Randfall:
 * Ohne Live-Text gibt es keine Enthuellung — bei Tier-Profilen, bei
 * abgeschaltetem Merkmal und vor allem bei der WIEDERAUFNAHME nach einem
 * Neuladen. Haengt der Lockruf nur an der Enthuellung, bleibt er dort stumm,
 * obwohl ein fertiges Profil dasteht. (Beim Bauen genau so passiert, gefunden
 * von der E2E-Pruefung am echten Ablauf, 2026-08-19.)
 *
 * Zusaetzlich wird `data-has-result` geprueft. Dieses Merkmal setzt render.js
 * erst, wenn das Profil vollstaendig steht, und nimmt es bei Fehler und
 * Abbruch ausdruecklich wieder weg. Damit kann der Lockruf niemals auf ein
 * Ergebnis zeigen, das es nicht gibt.
 *
 * WANN NICHT. Wenn der Schalter in dieser Sitzung schon bedient wurde oder
 * beim Laden bereits auf Beast stand (gemerkte Wahl): Dann kennt die Person
 * ihn und braucht keinen Hinweis. Und nie zweimal.
 *
 * DATENSCHUTZ. Kein Speicher, kein Zaehler, keine Kennung — der Zustand lebt
 * ausschliesslich in dieser Seite und ist mit dem Tab weg.
 */

/** „Ein fertiges Profil steht da." Gesendet von js/live-anzeige.js (nach der
    Enthuellung) und js/api.js (wenn keine laeuft). */
export const PROFIL_FERTIG = "malzime:profil-fertig";

/* Ruhe nach dem Aufbau, bevor der Lockruf kommt. */
const VERZOEGERUNG_MS = 3000;

/* 0,4 s Vorlauf + zwei Durchlaeufe a 2 s + Puffer. Muss zu den Werten in
   styles.css passen (Abschnitt „Beast-Lockruf") — dort steht die Quelle. */
const DAUER_MS = 4600;

let zustand = null;

function abraeumen() {
  if (!zustand) return;
  clearTimeout(zustand.startUhr);
  clearTimeout(zustand.endUhr);
  zustand.startUhr = null;
  zustand.endUhr = null;
  zustand.pille?.classList.remove("bias-lockruf");
  zustand.fuellung?.remove();
  zustand.fuellung = null;
}

function zeigen() {
  if (!zustand || zustand.gelaufen || zustand.benutzt) return;
  const { pille, spur } = zustand;
  if (!pille || !spur) return;
  zustand.gelaufen = true;

  const fuellung = document.createElement("span");
  fuellung.className = "bias-lockruf-fuellung";
  fuellung.setAttribute("aria-hidden", "true");
  spur.prepend(fuellung);
  zustand.fuellung = fuellung;
  pille.classList.add("bias-lockruf");

  /* Netz statt `animationend`: Laeuft die Animation gar nicht (reduzierte
     Bewegung, Anzeige im Hintergrund), kaeme das Ereignis nie. */
  zustand.endUhr = setTimeout(() => {
    pille.classList.remove("bias-lockruf");
    fuellung.remove();
    if (zustand) zustand.fuellung = null;
  }, DAUER_MS);
}

/**
 * Meldet den Lockruf an. Mehrfachaufruf ist ein No-Op.
 * Muss NACH dem Wiederherstellen der gemerkten Wahl laufen — sonst liest er
 * einen Schalterzustand, den die Seite gleich noch aendert.
 */
export function initBeastLockruf() {
  if (zustand) return;
  const schalter = document.getElementById("biasSwitch");
  const pille = document.querySelector(".bias-toggle");
  const spur = document.querySelector(".toggle-track");
  if (!schalter || !pille || !spur) return;

  zustand = {
    schalter,
    pille,
    spur,
    gelaufen: false,
    /* Steht der Schalter beim Laden schon auf Beast, kennt die Person ihn. */
    benutzt: schalter.checked === true,
    startUhr: null,
    endUhr: null,
    fuellung: null,
  };

  schalter.addEventListener("change", () => {
    zustand.benutzt = true;
    abraeumen();
  });

  document.addEventListener(PROFIL_FERTIG, () => {
    if (!zustand || zustand.gelaufen || zustand.benutzt || zustand.startUhr) return;
    /* Wache: ohne fertiges Ergebnis kein Lockruf. Beide Sender rufen nur im
       Erfolgsfall — diese Zeile ist der Guertel zum Hosentraeger. */
    if (!document.documentElement.hasAttribute("data-has-result")) return;
    zustand.startUhr = setTimeout(() => {
      if (zustand) zustand.startUhr = null;
      zeigen();
    }, VERZOEGERUNG_MS);
  });
}

/** Nur fuer Tests: setzt das Modul in den Ausgangszustand zurueck. */
export function _zuruecksetzen() {
  abraeumen();
  zustand = null;
}
