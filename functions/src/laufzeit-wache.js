/**
 * laufzeit-wache.js — Merkt, wenn die Analyse schleichend langsamer wird.
 *
 * WARUM ES DIESE WACHE GIBT (FEATURE-2026-08-29-03):
 *
 * Am 28.08.2026 brachen rund die Haelfte aller Analysen ab. Der Einbruch hatte
 * am 26.08. begonnen — bemerkt wurde er zwei Tage spaeter durch Beschwerden,
 * mitten in einer laufenden Presse-Aussendung. Niemand im System hat es
 * gesehen, obwohl alle Zahlen dafuer vorlagen.
 *
 * `mistral-zeitbudget.test.js` sollte genau das absichern, kann es aber per
 * Konstruktion nicht: Er rechnet zwei Konstanten gegeneinander. Wird der
 * Anbieter langsamer, bleibt er gruen. Eine Pruefung, die rechnerisch nie rot
 * werden kann, ist selbst der Befund (KERN 4).
 *
 * ZWEI ENTSCHEIDUNGEN, die aus dem Vorfall stammen:
 *
 * 1. RELATIVE SCHWELLEN, NIE ABSOLUTE. Der alte Fehler war die Zahl 39,4
 *    Token/s: einmal gemessen, fest verdrahtet, ab dem ersten Tag im Veralten.
 *    Diese Wache vergleicht das System mit sich selbst — die letzten drei Tage
 *    gegen die vierzehn davor. Das stimmt in einem Jahr noch, egal wie schnell
 *    Mistral dann ist.
 *
 * 2. KEIN ALARM AUF EINEN AUSSCHLAG. Am 28.08. lagen zwischen 19 und 66 Token
 *    pro Sekunde ganze drei Stunden. Eine Wache, die auf einzelne Ausschlaege
 *    anspringt, meldet staendig und wird nach zwei Wochen ignoriert. Deshalb:
 *    mindestens zehn Analysen im Zeitraum, und die Abweichung muss zwei Tage
 *    anhalten.
 *
 * Der zweite, wichtigere Indikator ist gar nicht das Tempo, sondern die NAEHE
 * ZUR GRENZE: Wie viele Laeufe brauchen mehr als 80 % der erlaubten Zeit?
 * Normal sind das null. Am 28.08. waere es die Haelfte gewesen. Das misst
 * direkt, was den Nutzern weh tut.
 */

const { datenbank } = require("./db");
const { MISTRAL_SINGLE_LARGE_TIMEOUT_MS } = require("./config");
const { tagesHistorie } = require("./durchsatz");

const ZUSTAND_DOKUMENT = "stats/laufzeit-wache";
const JUENGSTE_TAGE = 3;
const VERGLEICH_TAGE = 14;
/* Darunter ist jede Aussage Zufall — malziME hat Tage mit zwei Analysen. */
const MIN_ANALYSEN = 10;
/* Ab dieser Verlangsamung gegenueber dem eigenen Verlauf wird gemeldet. */
const FAKTOR_SCHWELLE = 1.5;
/* Anteil der Laeufe nahe an der Zeitgrenze, ab dem gemeldet wird. */
const NAH_AN_GRENZE_ANTEIL = 0.2;
const NAH_AN_GRENZE_MS = MISTRAL_SINGLE_LARGE_TIMEOUT_MS * 0.8;
/* Erst wenn es so viele Tage in Folge auffaellig ist, geht eine Meldung raus. */
const ANHALTEND_TAGE = 2;

function median(zahlen) {
  if (zahlen.length === 0) return null;
  const s = zahlen.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Wertet die Tageshistorie aus.
 *
 * Rueckgabe: { auffaellig, grund, zahlen } — `auffaellig` false heisst
 * ausdruecklich "geprueft und in Ordnung", nicht "nicht geprueft". Fehlt die
 * Datengrundlage, steht das als Grund drin.
 */
function bewerte(tage) {
  const sortiert = tage.slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  const juengste = sortiert.slice(-JUENGSTE_TAGE);
  const davor = sortiert.slice(-(JUENGSTE_TAGE + VERGLEICH_TAGE), -JUENGSTE_TAGE);

  const werteJuengst = juengste.flatMap((t) => t.w);
  const werteDavor = davor.flatMap((t) => t.w);

  if (werteJuengst.length < MIN_ANALYSEN) {
    return { auffaellig: false, grund: "zu-wenige-analysen", zahlen: { juengst: werteJuengst.length } };
  }

  /* Indikator 1: Naehe zur Zeitgrenze. Braucht keinen Vergleichszeitraum und
     ist deshalb auch dann aussagekraeftig, wenn das Werkzeug lange ruhte. */
  const nahDran = werteJuengst.filter((s) => s * 1000 >= NAH_AN_GRENZE_MS).length;
  const anteilNah = nahDran / werteJuengst.length;
  if (anteilNah >= NAH_AN_GRENZE_ANTEIL) {
    return {
      auffaellig: true,
      grund: "nah-an-der-zeitgrenze",
      zahlen: {
        anteilProzent: Math.round(anteilNah * 100),
        grenzeSekunden: Math.round(NAH_AN_GRENZE_MS / 1000),
        analysen: werteJuengst.length,
      },
    };
  }

  /* Indikator 2: Verlangsamung gegenueber dem eigenen Verlauf. */
  if (werteDavor.length < MIN_ANALYSEN) {
    return { auffaellig: false, grund: "kein-vergleichszeitraum", zahlen: { davor: werteDavor.length } };
  }
  const jetzt = median(werteJuengst);
  const frueher = median(werteDavor);
  if (frueher > 0 && jetzt / frueher >= FAKTOR_SCHWELLE) {
    return {
      auffaellig: true,
      grund: "verlangsamung",
      zahlen: { jetztSekunden: jetzt, frueherSekunden: frueher, faktor: Math.round((jetzt / frueher) * 10) / 10 },
    };
  }

  return { auffaellig: false, grund: "im-rahmen", zahlen: { jetztSekunden: jetzt, frueherSekunden: frueher } };
}

/** Formuliert die Meldung in klarer Sprache, nicht in Maschinenbegriffen. */
function baueMeldung(befund) {
  const z = befund.zahlen;
  if (befund.grund === "nah-an-der-zeitgrenze") {
    return (
      `malziME: ${z.anteilProzent} % der Analysen brauchen mehr als ${z.grenzeSekunden} s ` +
      `(von ${z.analysen} Laeufen). Normal sind 0 %. Die Zeitgrenze wird bald gerissen.`
    );
  }
  return (
    `malziME: Analysen dauern derzeit ${z.jetztSekunden} s statt ${z.frueherSekunden} s ` +
    `im Schnitt der Vorwochen (Faktor ${z.faktor}).`
  );
}

/**
 * Prueft die Laufzeit und meldet, wenn die Auffaelligkeit anhaelt.
 *
 * `melder` bekommt den fertigen Text — dieselbe Trennung wie in
 * `handle-erinnerung.js`: Die Wache entscheidet WAS gemeldet wird, nicht WIE.
 */
async function pruefeLaufzeit({ melder, jetzt = Date.now() } = {}) {
  const tage = await tagesHistorie();
  const befund = bewerte(tage);
  const heute = new Date(jetzt).toISOString().slice(0, 10);

  let zustand = {};
  try {
    const snap = await datenbank().doc(ZUSTAND_DOKUMENT).get();
    if (snap.exists) zustand = snap.data() || {};
  } catch (_) {
    /* Ohne Zustand wird nur einmalig nicht gemeldet — kein Grund abzubrechen. */
  }

  if (!befund.auffaellig) {
    /* Erholung: Zaehler zuruecksetzen, damit ein spaeterer Einbruch wieder
       von vorne zaehlt. Ein Zaehler, der sich nie erholt, erzeugt Dauerrot
       (KERN 4). */
    if (zustand.auffaelligSeit) {
      try {
        await datenbank().doc(ZUSTAND_DOKUMENT).set({ auffaelligSeit: null, gemeldetAm: null }, { merge: true });
      } catch (_) {
        /* still */
      }
    }
    return { gemeldet: false, grund: befund.grund, zahlen: befund.zahlen };
  }

  const seit = zustand.auffaelligSeit || heute;
  const tageAuffaellig = Math.round((Date.parse(heute) - Date.parse(seit)) / 86400000) + 1;

  try {
    await datenbank().doc(ZUSTAND_DOKUMENT).set({ auffaelligSeit: seit }, { merge: true });
  } catch (_) {
    /* still */
  }

  if (tageAuffaellig < ANHALTEND_TAGE) {
    return { gemeldet: false, grund: "noch-nicht-anhaltend", tageAuffaellig, zahlen: befund.zahlen };
  }
  /* Nicht zweimal am selben Tag melden. */
  if (zustand.gemeldetAm === heute) {
    return { gemeldet: false, grund: "heute-schon-gemeldet", zahlen: befund.zahlen };
  }

  const text = baueMeldung(befund);
  if (typeof melder === "function") await melder(text);
  try {
    await datenbank().doc(ZUSTAND_DOKUMENT).set({ auffaelligSeit: seit, gemeldetAm: heute }, { merge: true });
  } catch (_) {
    /* still */
  }
  return { gemeldet: true, grund: befund.grund, text, zahlen: befund.zahlen };
}

module.exports = {
  pruefeLaufzeit,
  /* Fuer Tests */
  _bewerte: bewerte,
  _baueMeldung: baueMeldung,
  _MIN_ANALYSEN: MIN_ANALYSEN,
  _FAKTOR_SCHWELLE: FAKTOR_SCHWELLE,
};
