"use strict";

/**
 * betriebsprofil.js — Betriebswerte aus Firestore, als benannte Saetze.
 *
 * WARUM PROFILE UND NICHT EINZELNE SCHALTER:
 *
 * Die Betriebswerte haengen zusammen. Steigt malziME von Mistral-Tarif T1 auf
 * T2, gehoeren Parallelitaet, Stundenlimit und Zeitgrenzen GEMEINSAM angefasst
 * — wer einen vergisst, bekommt eine Anlage, die sich selbst widerspricht.
 * Genau daran ist der Vorschlag "einzelne Werte aus Firestore" am 18.08.2026
 * gescheitert und wurde zu Recht gestrichen: Er haette die Kopplung zwischen
 * Zeitgrenze und Token-Menge aufgehoben, die einen Ausfall am 17.08. verhindert
 * hat.
 *
 * Ein Profil ist ein VOLLSTAENDIGER Satz. Umgestellt wird ein Feld — der Name
 * des aktiven Profils. Alles andere zieht mit.
 *
 * DIE SICHERUNG BLEIBT, SIE WANDERT NUR MIT. Die Rechnung aus config.js
 * (erlaubte Ausgabelaenge muss in die erlaubte Zeit passen) laeuft hier beim
 * LADEN. Ein Profil, das sie nicht besteht, wird abgelehnt — es gelten die
 * Code-Werte weiter. Damit ist die Externalisierung strenger als der heutige
 * Zustand, nicht laxer: Heute crasht ein falscher Wert beim Start, hier wird
 * er verworfen und der Betrieb laeuft mit den bewaehrten Zahlen weiter.
 *
 * KEINE RUECKFALLWERTE IM CODE (Entscheidung des Nutzers, 30.08.2026):
 * „Natuerlich gehoeren die Werte raus aus dem Code. Das war von Anfang an der
 * Auftrag. Dass wir hier wirklich nur mehr ueber den Firestore unsere
 * Konfiguration machen."
 *
 * Ein zunaechst eingebauter Notanker im Code wurde wieder entfernt. Das
 * Argument dafuer — er rette den Betrieb bei einem Firestore-Ausfall — hielt
 * der Pruefung nicht stand: Jeder Analyse-Auftrag liegt selbst in Firestore
 * (Einreihen, Status, Ergebnis). Faellt die Datenbank aus, laeuft ohnehin
 * keine Analyse. Der Notanker haette nur die Doppelstruktur gebracht, die man
 * in Jahren nicht mehr zuordnen kann.
 *
 * FOLGE, die man kennen muss: OHNE gueltiges Profil laeuft KEINE Analyse. Das
 * Profil muss in der Datenbank liegen, BEVOR diese Fassung ausgeliefert wird.
 * Fehlt es, meldet das System das laut, statt still mit alten Zahlen
 * weiterzulaufen — ein Konfigurationsfehler soll auffallen, nicht monatelang
 * unbemerkt bleiben.
 *
 * WAS KEINE EINSTELLUNG IST und deshalb im Code bleibt: das Zeitlimit, das
 * Google der Function gibt (540 s), und die langsamste je gemessene
 * Mistral-Geschwindigkeit. Beides sind Tatsachen, gegen die geprueft wird,
 * keine Werte, die jemand einstellen wuerde.
 *
 * WAS AUCH IM CODE BLEIBT:
 *
 * `HOURLY_LIMIT` — das Stundenlimit ist bereits zur Laufzeit steuerbar. Der
 * Boost-Mechanismus in counter.js hebt es ueber `stats/current.limit`, mit
 * Ablauffrist und der bewussten Eigenschaft, niemanden mitten in einer
 * laufenden Klasse auszusperren. Es hier nochmals anzubinden hiesse, denselben
 * Wert an zwei Stellen steuerbar zu machen — genau die Vervielfachung, gegen
 * die dieser Entwurf antritt. `wirksamesLimit()` ist ausserdem synchron und
 * sitzt in der Einlasskontrolle; ein async-Umbau dort waere ein Eingriff in
 * den Pfad, ueber den jede Analyse hereinkommt, ohne neuen Nutzen.
 *
 * `QUEUE_DISPATCH_CONCURRENCY` — steht im Profil und wird gelesen, aber die
 * Warteschlange bei Google zieht NICHT automatisch mit (fremdes System, siehe
 * kapazitaets-wache.js). Der Profilwert dient der Wartezeit-Rechnung; die
 * Wache meldet, wenn beide Seiten auseinanderlaufen.
 *
 * ── VIER OBERGRENZEN SIND ZUSAGEN, KEINE PLAUSIBILITAETSGRENZEN ───────────
 *
 * Bei vier Feldern ist die Obergrenze in FELDER nicht willkuerlich weit
 * gewaehlt, sondern exakt das, was die Datenschutzerklaerung oeffentlich
 * verspricht:
 *
 *   jobAufbewahrungMs   max 2 h    "nie abgeholte spaetestens nach rund
 *                                   2 Stunden"
 *   zustellfensterMs    max 15 min "wenige Minuten nach der Abholung
 *                                   automatisch geloescht"
 *   adressfensterMs     max 10 min "merkt sich deine IP fuer maximal
 *                                   10 Minuten"
 *   stundenfensterMin.  max 60     "die Zeitpunkte der Analysen der letzten
 *                                   60 Minuten"
 *
 * Der Einstellungssatz kann diese Fristen nur VERKUERZEN. Waeren sie weiter
 * einstellbar, liesse sich eine oeffentliche Datenschutzzusage mit einem
 * Datenbankeintrag brechen — ohne Commit, ohne Review, ohne Spur im
 * Quelltext, waehrend die Erklaerung auf der Website weiter dasselbe sagt.
 *
 * WER EINE DIESER GRENZEN ANHEBEN WILL, AENDERT ZUERST DIE
 * DATENSCHUTZERKLAERUNG — nicht diese Datei. (Befund aus dem eigenen Review
 * am 30.08.2026: drei der vier Fristen waren zunaechst weit darueber hinaus
 * einstellbar.)
 *
 * WAS BEWUSST NICHT HIER STEHT: Upload-Grenze (Sicherheitsgrenze),
 * Feldlaengen der Fehlererfassung (Datenschutzzusage in Zahlenform),
 * Modellname und EU-Endpunkt (Zusage an die Nutzer). Zur Laufzeit umschaltbar
 * waeren das Wege, eine Zusage unbemerkt zu brechen. Sie bleiben im Code, wo
 * sie eine Pruefkette durchlaufen.
 */

const { datenbank } = require("./db");
const {
  MISTRAL_TIMEOUT_MS,
  MISTRAL_SINGLE_LARGE_TIMEOUT_MS,
  MISTRAL_SINGLE_LARGE_MAX_TOKENS,
  MISTRAL_SLOWEST_TOKENS_PER_SECOND,
  REQUEST_BUDGET_MS,
  QUEUE_DISPATCH_CONCURRENCY,
  HOURLY_LIMIT,
  RATE_LIMIT,
} = require("./config");

const DOKUMENT = "config/betriebsprofil";
/* Zeitlimit fuer das Lesen. OHNE DAS waere die Rueckfallebene wertlos: Diese
   Funktion sitzt im Analyse-Pfad, und ein haengender Firestore-Aufruf haette
   den Start JEDER Analyse blockiert — statt still auf die Code-Werte
   zurueckzufallen, waere die Anwendung stehengeblieben. Zwei Sekunden sind
   grosszuegig fuer das Lesen EINES kleinen Dokuments und kurz genug, dass
   niemand es merkt. */
const LESE_ZEITLIMIT_MS = 2000;
/* Wie die Feature-Flags: kurz genug, dass eine Umstellung in Sekunden wirkt,
   lang genug, dass nicht jeder Aufruf Firestore liest. */
const CACHE_MS = 30 * 1000;
/* Obergrenze, die Google der Function gibt. Kein Profil darf darueber. */
const FUNCTION_LIMIT_MS = 540 * 1000;

/* WELCHE WERTE EIN EINSTELLUNGSSATZ TRAEGT.
   Alle sind PFLICHT. Es gibt keine Kann-Felder und keine Rueckfallwerte mehr:
   Ein halber Satz ist ein kaputter Satz, und ein Wert, der an zwei Orten
   steht, laeuft frueher oder spaeter auseinander.

   Vorgabe des Nutzers (30.08.2026): "Jeder Wert darf nur einmal vorkommen,
   und dieser muss aus dem Store geliefert werden. Weitere Konstanten oder
   Uebergabewerte darf es so nicht geben."

   Was hier NICHT steht, ist bewusst keine Einstellung — siehe Kopf der Datei. */
const FELDER = {
  /* --- 1. Die KI-Aufrufe: wie lange, wie viel Text --- */
  mistralTimeoutMs: { min: 5000, max: 540000 },
  singleLargeTimeoutMs: { min: 5000, max: 540000 },
  singleLargeMaxTokens: { min: 100, max: 100000 },
  describeMaxTokens: { min: 100, max: 100000 },
  profileMaxTokens: { min: 100, max: 100000 },
  requestBudgetMs: { min: 5000, max: 540000 },

  /* --- 2. Andrang: wie viele wir gleichzeitig und pro Stunde einlassen --- */
  parallelitaet: { min: 1, max: 100 },
  warteschlangeTiefe: { min: 1, max: 10000 },
  durchschnittsdauerSekunden: { min: 1, max: 3600 },
  stundenlimit: { min: 1, max: 100000 },
  /* OBERGRENZE = ZUSAGE: "die Zeitpunkte der Analysen der letzten 60 Minuten"
     steht so in der Datenschutzerklaerung. Ein groesseres Fenster hiesse:
     laenger aufbewahrte Zeitstempel, als zugesagt. */
  stundenfensterMinuten: { min: 1, max: 60 },
  adressLimit: { min: 1, max: 100000 },
  /* OBERGRENZE = ZUSAGE: Die Datenschutzerklaerung sagt "merkt sich deine IP
     fuer maximal 10 Minuten im Arbeitsspeicher, dann ist sie weg". Ein
     laengeres Fenster waere eine laengere Speicherung — der Satz kann das
     Fenster nur verkuerzen. */
  adressfensterMs: { min: 1000, max: 10 * 60 * 1000 },

  /* --- 3. Der Notaufschlag fuer einen ueberfuellten Workshop --- */
  boostFaktor: { min: 1, max: 20 },
  boostFristMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000 },

  /* --- 4. Ruecksicht auf Mistral: nicht mehr schicken, als die dort erlauben --- */
  drosselMaxParallel: { min: 1, max: 100 },
  drosselWartelimitMs: { min: 1000, max: 30 * 60 * 1000 },
  tokenAbstandGrossMs: { min: 0, max: 60 * 1000 },
  tokenAbstandKleinMs: { min: 0, max: 60 * 1000 },

  /* --- 5. Fristen: wie lange etwas liegen bleibt, bis aufgeraeumt wird ---

     ACHTUNG, HIER IST DIE OBERGRENZE SELBST EINE ZUSAGE:
     Die Datenschutzerklaerung verspricht an vier Stellen, dass Job-Daten
     "spaetestens nach rund 2 Stunden" geloescht werden. Waere hier eine
     hoehere Grenze erlaubt, liesse sich diese Zusage mit einem einzigen
     Datenbankeintrag brechen — ohne Commit, ohne Spur im Quelltext.

     Die Grenze ist deshalb die Zusage: Der Einstellungssatz kann die Frist
     nur VERKUERZEN, nie verlaengern. (Befund aus dem eigenen Review,
     30.08.2026 — die Frist war zuvor bis 7 Tage einstellbar.) */
  jobAufbewahrungMs: { min: 60 * 1000, max: 2 * 60 * 60 * 1000 },
  /* OBERGRENZE = ZUSAGE: "wird wenige Minuten nach der Abholung automatisch
     geloescht". Fuenfzehn Minuten sind der heutige Wert und die aeusserste
     Lesart von "wenige Minuten". Wer mehr braucht, aendert ZUERST die
     Datenschutzerklaerung — nicht diesen Wert. */
  zustellfensterMs: { min: 60 * 1000, max: 15 * 60 * 1000 },
  livenessGnadenfristMs: { min: 30 * 1000, max: 60 * 60 * 1000 },
  verarbeitungsZeitlimitMs: { min: 60 * 1000, max: 60 * 60 * 1000 },
  wartendesHoechstalterMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000 },
  aufraeumStapel: { min: 1, max: 5000 },
  ticketGueltigkeitMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000 },
};

const PFLICHTFELDER = Object.keys(FELDER);

let cache = { zeit: 0, werte: null, quelle: "code" };
/* Laeuft gerade ein Lesevorgang? Dann warten alle weiteren darauf, statt
   selbst zu lesen.

   BEFUND aus dem Lasttest (30.08.2026): Ohne das erzeugten 50 gleichzeitige
   Analysen 50 Datenbankzugriffe statt einem. Der Zwischenspeicher greift erst,
   wenn der erste Lesevorgang FERTIG ist — bei einer Klasse, die zeitgleich
   hochlaedt, ist er das noch nicht. Sichtbar nur unter Last. */
let laufenderLesevorgang = null;
/* Zuletzt protokollierter Zustand — verhindert tausende gleiche Eintraege. */
let letzterZustand = null;

/**
 * Prueft einen Satz Werte auf Widerspruchsfreiheit.
 * Reine Rechnung, ohne Firestore — damit ohne Netzwerk pruefbar.
 *
 * Gibt `null` zurueck, wenn alles stimmt, sonst den Grund im Klartext.
 */
function pruefe(werte) {
  /* Vollstaendigkeit zuerst: Ohne diese Werte kann keine Analyse laufen. */
  for (const name of PFLICHTFELDER) {
    if (werte[name] === undefined) return `${name} fehlt — ohne diesen Wert laeuft keine Analyse`;
  }
  for (const [name, wert] of Object.entries(werte)) {
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      return `${name} ist keine positive Zahl (${JSON.stringify(wert)})`;
    }
  }
  /* Plausibilitaetsgrenzen — fangen Tippfehler und Unfug ab. */
  for (const [name, g] of Object.entries(FELDER)) {
    if (werte[name] === undefined) continue;
    if (werte[name] < g.min || werte[name] > g.max) {
      return `${name} (${werte[name]}) liegt ausserhalb des plausiblen Bereichs ${g.min}–${g.max}`;
    }
  }
  /* Die Sicherung aus config.js: Die erlaubte Ausgabelaenge muss in die
     erlaubte Zeit passen. Sonst toetet die Uhr Laeufe, die das Token-Budget
     ausdruecklich zulaesst (BUG-2026-08-17-01). */
  const brauchtSekunden = werte.singleLargeMaxTokens / MISTRAL_SLOWEST_TOKENS_PER_SECOND;
  if (brauchtSekunden > werte.singleLargeTimeoutMs / 1000) {
    return (
      `singleLargeMaxTokens (${werte.singleLargeMaxTokens}) braucht bei ` +
      `${MISTRAL_SLOWEST_TOKENS_PER_SECOND} Token/s ${Math.round(brauchtSekunden)} s, ` +
      `singleLargeTimeoutMs erlaubt aber nur ${Math.round(werte.singleLargeTimeoutMs / 1000)} s`
    );
  }
  /* Jede Einzelgrenze unter dem Gesamtbudget. */
  for (const name of ["mistralTimeoutMs", "singleLargeTimeoutMs"]) {
    if (werte[name] > werte.requestBudgetMs) {
      return `${name} (${werte[name]} ms) liegt ueber requestBudgetMs (${werte.requestBudgetMs} ms)`;
    }
  }
  /* Das Zustellfenster darf die Aufbewahrung nicht ueberschreiten — sonst
     wartet der Reaper auf ein Fenster, das nach der Loeschung endet. */
  if (werte.zustellfensterMs > werte.jobAufbewahrungMs) {
    return (
      `zustellfensterMs (${werte.zustellfensterMs} ms) liegt ueber ` +
      `jobAufbewahrungMs (${werte.jobAufbewahrungMs} ms) — das Ergebnis waere ` +
      `geloescht, bevor das Wiederholungsfenster endet`
    );
  }
  /* Das Gesamtbudget unter dem, was Google der Function gibt. */
  if (werte.requestBudgetMs > FUNCTION_LIMIT_MS) {
    return `requestBudgetMs (${werte.requestBudgetMs} ms) liegt ueber dem Function-Limit (${FUNCTION_LIMIT_MS} ms)`;
  }
  return null;
}

/**
 * Liest die Felder eines Satzes heraus. Unbekannte Felder werden ignoriert —
 * ein Tippfehler im Dokument darf nichts einschleusen.
 *
 * Fehlende PFLICHTFELDER werden NICHT ersetzt: Seit die Werte ausschliesslich
 * aus Firestore kommen (30.08.2026), gibt es nichts, womit man sie ersetzen
 * koennte. Ein unvollstaendiger Satz wird abgelehnt.
 */
function felderLesen(satz) {
  const werte = {};
  if (!satz || typeof satz !== "object") return werte;
  for (const name of PFLICHTFELDER) {
    if (typeof satz[name] === "number") werte[name] = satz[name];
  }
  return werte;
}

/**
 * Liest die geltenden Betriebswerte.
 *
 * Reihenfolge der Rueckfaelle, jede Stufe fuehrt zu den Code-Werten:
 *   kein Dokument · kein aktives Profil · Profil unbekannt · Pruefung
 *   fehlgeschlagen · Firestore nicht lesbar
 *
 * Der schlechteste Fall ist damit der heutige Zustand, nie ein schlechterer.
 */
/* Eine Kopie herausgeben, nie den zwischengespeicherten Satz selbst.

   BEFUND (Grenzfall-Pruefung 30.08.2026): Ohne das konnte ein Aufrufer die
   Werte veraendern — und traf damit ALLE, die denselben Satz halten. In einem
   Workshop haette ein einziger Fehlgriff die Werte aller laufenden Analysen
   verbogen, ohne Spur im Protokoll. */
function alsKopie(stand) {
  return { ...stand, werte: stand.werte ? { ...stand.werte } : null };
}

async function geltendeWerte() {
  const jetzt = Date.now();
  if (cache.werte && jetzt - cache.zeit < CACHE_MS) return alsKopie(cache);
  /* Ein zweiter Aufrufer waehrend des Lesens haengt sich an, statt selbst zu
     lesen (siehe laufenderLesevorgang). */
  if (laufenderLesevorgang) return laufenderLesevorgang.then(alsKopie);
  laufenderLesevorgang = leseFrisch(jetzt).finally(() => {
    laufenderLesevorgang = null;
  });
  return laufenderLesevorgang;
}

async function leseFrisch(jetzt) {
  let ergebnis = { werte: null, quelle: "fehlt", grund: null, profil: null };
  try {
    const snap = await Promise.race([
      datenbank().doc(DOKUMENT).get(),
      new Promise((_, ab) => setTimeout(() => ab(new Error(`Zeitlimit ${LESE_ZEITLIMIT_MS} ms`)), LESE_ZEITLIMIT_MS)),
    ]);
    if (snap.exists) {
      const daten = snap.data() || {};
      const aktiv = typeof daten.aktiv === "string" ? daten.aktiv : null;
      const profile = daten.profile && typeof daten.profile === "object" ? daten.profile : {};
      if (!aktiv) {
        ergebnis.grund = "kein aktives Profil benannt";
      } else if (!profile[aktiv]) {
        ergebnis.grund = `Profil "${aktiv}" ist nicht hinterlegt`;
      } else {
        const werte = felderLesen(profile[aktiv]);
        const fehler = pruefe(werte);
        if (fehler) {
          ergebnis.grund = `Profil "${aktiv}" abgelehnt: ${fehler}`;
        } else {
          ergebnis = { werte, quelle: "firestore", grund: null, profil: aktiv };
        }
      }
    } else {
      ergebnis.grund = "kein Dokument";
    }
  } catch (fehler) {
    ergebnis.grund = `nicht lesbar: ${String(fehler.message)}`;
  }

  /* PROTOKOLL — nur bei ZUSTANDSWECHSEL.
     Ohne diese Zeilen waere ein abgelehnter Satz unsichtbar: Es liefe einfach
     keine Analyse mehr, und niemand koennte sagen warum. Bei jedem Aufruf zu
     protokollieren waere aber genauso wertlos — bei einem Workshop entstuenden
     tausende gleiche Eintraege, in denen der eine wichtige untergeht.

     DATENSCHUTZ: Hier stehen ausschliesslich der Name des Einstellungssatzes,
     die Herkunft und der Ablehnungsgrund. Keine Nutzerdaten, keine Adressen,
     keine Bildinhalte — der Satz enthaelt nur Zahlen und einen selbstgewaehlten
     Namen. */
  const wechsel = letzterZustand !== `${ergebnis.quelle}|${ergebnis.profil}|${ergebnis.grund}`;
  if (wechsel) {
    letzterZustand = `${ergebnis.quelle}|${ergebnis.profil}|${ergebnis.grund}`;
    const zeile = {
      step: "betriebsprofil",
      quelle: ergebnis.quelle,
      profil: ergebnis.profil || null,
      grund: ergebnis.grund || null,
    };
    if (ergebnis.werte) {
      /* Die geltenden Zahlen mitschreiben — bei einem Vorfall ist die erste
         Frage, mit welchen Werten gearbeitet wurde. */
      zeile.zeitgrenzeMs = ergebnis.werte.singleLargeTimeoutMs;
      zeile.maxTokens = ergebnis.werte.singleLargeMaxTokens;
      console.log(JSON.stringify(zeile));
    } else {
      /* Kein gueltiger Satz = keine Analyse. Das ist ein Betriebsfehler und
         gehoert als solcher ins Protokoll, damit die Alarmierung greift. */
      console.error(JSON.stringify(zeile));
    }
  }

  cache = { zeit: jetzt, ...ergebnis };
  return alsKopie(cache);
}

/* Fuer Tests: Cache leeren, damit jede Pruefung frisch liest. */
function _cacheLeeren() {
  letzterZustand = null;
  cache = { zeit: 0, werte: null, quelle: "code" };
}

module.exports = {
  geltendeWerte,
  PFLICHTFELDER,
  _pruefe: pruefe,
  _felderLesen: felderLesen,
  _cacheLeeren,
  _DOKUMENT: DOKUMENT,
  _FELDER: FELDER,
};
