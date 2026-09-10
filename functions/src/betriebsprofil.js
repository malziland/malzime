"use strict";

/**
 * betriebsprofil.js — Betriebswerte aus Firestore, als benannte Saetze.
 *
 * Die Werte haengen zusammen (Parallelitaet, Zeitgrenzen, Textmengen); deshalb
 * gibt es VOLLSTAENDIGE Saetze statt einzelner Schalter, und umgestellt wird
 * ein Feld: der Name des aktiven Satzes. Jeder Satz durchlaeuft beim Laden
 * die Kopplungspruefungen unten (pruefe); ein Satz, der sie nicht besteht,
 * wird abgelehnt.
 *
 * KEINE RUECKFALLWERTE IM CODE (Entscheidung des Nutzers, 30.08.2026): Ohne
 * gueltigen Satz laeuft keine Analyse. Der Satz muss in der Datenbank liegen,
 * BEVOR eine Fassung ausgeliefert wird, die ihn braucht. Ein Notanker im Code
 * wurde bewusst wieder entfernt — jeder Auftrag liegt selbst in Firestore;
 * faellt die Datenbank aus, laeuft ohnehin keine Analyse.
 *
 * VIER OBERGRENZEN IN FELDER SIND ZUSAGEN, keine Plausibilitaetsgrenzen:
 * jobAufbewahrungMs (2 h), zustellfensterMs (15 min), adressfensterMs
 * (10 min), stundenfensterMinuten (60) stehen so in der Datenschutzerklaerung.
 * Der Satz kann sie nur verkuerzen; wer sie anheben will, aendert zuerst die
 * Erklaerung.
 *
 * Was bewusst KEINE Einstellung ist (Upload-Grenze, Feldlaengen der
 * Fehlererfassung, Modell, EU-Endpunkt, Function-Zeitlimit, gemessenes
 * Mistral-Tempo) und warum: docs/BETRIEBSPROFILE.md, Abschnitt "Was
 * ausdruecklich nicht einstellbar ist". Die Vorgeschichte (gestrichener
 * Einzelschalter-Vorschlag vom 18.08.2026, HOURLY_LIMIT, Warteschlange bei
 * Google) steht dort ebenfalls — hier nur einmal, nicht zweimal.
 */

const { datenbank } = require("./db");
/* Nur noch das gemessene Schreibtempo — die uebrigen Konstanten sind mit dem
   Umbau in den Einstellungssatz gewandert und existieren in config.js nicht
   mehr. Die Importe liefen ins Leere (undefined) und waren nur noch
   Verwirrung fuer den naechsten Leser. */
const { MISTRAL_SLOWEST_TOKENS_PER_SECOND } = require("./config");

const DOKUMENT = "config/betriebsprofil";
/* Zeitlimit fuer das Lesen. OHNE DAS waere die Rueckfallebene wertlos: Diese
   Funktion sitzt im Analyse-Pfad, und ein haengender Firestore-Aufruf haette
   den Start JEDER Analyse blockiert — statt still auf die Code-Werte
   zurueckzufallen, waere die Anwendung stehengeblieben. Zwei Sekunden sind
   grosszuegig fuer das Lesen EINES kleinen Dokuments und kurz genug, dass
   niemand es merkt. */
const LESE_ZEITLIMIT_MS = 2000;
/* BLEIBT IM CODE — Schutzgrenze wie oben, keine Einstellung.
   Der ERSTE Lesevorgang einer frisch gestarteten Instanz bekommt mehr Zeit:
   Solange die Datenbankverbindung aufgebaut wird, sind 2000 ms zu knapp
   (belegt 01.09.2026, ein Fehlschlag in sieben Tagen, ohne Folge fuer eine
   Analyse — Hergang im CHANGELOG). Im laufenden Betrieb bleibt es bei
   2000 ms; ein zweiter Leseversuch haette stattdessen die Wartezeit im
   Fehlerfall verdoppelt. */
const ERSTES_LESE_ZEITLIMIT_MS = 5000;
let schonGelesen = false;
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
  requestBudgetMs: { min: 5000, max: 540000 },

  /* --- 2. Andrang: wie viele wir gleichzeitig und pro Stunde einlassen --- */
  parallelitaet: { min: 1, max: 100 },
  /* Die Rate, mit der die Warteschlange Auftraege LOSSCHICKT (Auftraege pro
     Sekunde). Sie steht hier, weil sie die eigentliche Bremse gegen das
     Mistral-Limit ist — und weil sie sonst nur per gcloud-Befehl aenderbar
     waere, also nicht im laufenden Betrieb.

     Der Wert wird von der `satzWache` in die echte Cloud-Tasks-Queue
     uebertragen; er beschreibt also nicht bloss, er STELLT.

     Rechnung: Mistral-Limit (Aufrufe/s) geteilt durch 2, weil jede Analyse
     zwei Aufrufe macht (Analyse + Beast-Werbung). Bei Stufe T1 mit 0,25/s
     ergibt das 0,125.

     OBERGRENZE 5: Darueber liegt keine Mistral-Stufe, die wir haben koennten;
     ein Tippfehler wuerde sonst Kosten und Fehler erzeugen, bevor jemand
     hinsieht. */
  queueRatePerSekunde: { min: 0.01, max: 5 },
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
  /* WENN MISTRAL ABLEHNT (429) ODER KURZ WEG IST (502/503/504): Wartezeit vor
     der ersten Wiederholung; jede weitere wartet doppelt so lang. Die Reihe
     10, 20, 40, 80 s ist am Vorfall vom 08.09.2026 nachgerechnet (siehe
     produktiv-satz.js). Die Summe aller Wartezeiten muss zusammen mit dem
     Hauptaufruf ins Gesamtbudget passen — Kopplungsregel in pruefe(). */
  ueberlastWarteMs: { min: 1000, max: 120 * 1000 },
  ueberlastVersuche: { min: 1, max: 10 },

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
  /* Die Wartezeiten bei Ueberlast muessen ins Gesamtbudget passen:
     warte + 2·warte + 4·warte + … = warte·(2^n − 1). Liegt die Summe ueber
     dem Budget, koennten die letzten Wiederholungen NIE stattfinden — der
     Satz verspraeche ein Netz, das es nicht gibt. Was der Hauptaufruf vorher
     verbraucht hat, regelt der Aufruf selbst: Er wiederholt nur, solange das
     Restbudget fuer die naechste Wartezeit reicht (mistral-http.js). Deshalb
     zaehlt hier die Summe allein, nicht Summe plus Aufrufdauer — sonst waere
     der Langsam-Satz (450 s Aufruf) ohne Netz. (08.09.2026) */
  const wartesummeMs = werte.ueberlastWarteMs * (2 ** werte.ueberlastVersuche - 1);
  if (wartesummeMs >= werte.requestBudgetMs) {
    return (
      `ueberlastWarteMs (${werte.ueberlastWarteMs}) × ${werte.ueberlastVersuche} Wiederholungen ergeben ` +
      `${Math.round(wartesummeMs / 1000)} s Wartezeit — mehr als requestBudgetMs ` +
      `(${Math.round(werte.requestBudgetMs / 1000)} s); die letzten Wiederholungen faenden nie statt`
    );
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
  /* Der Zeitlimit-Timer wird nach dem Wettlauf AUFGERAEUMT.
     BEFUND (Pruefstand 30.08.2026): Ohne das lief nach jedem erfolgreichen
     Lesevorgang noch zwei Sekunden ein Timer weiter und feuerte anschliessend
     ins Leere. In der Function ist das ein kleines, aber stetiges Leck — bei
     einem Workshop mit tausend Analysen entsprechend viele offene Timer, die
     die Instanz am Herunterfahren hindern. Im Test brach es die Suite ab,
     weil die Ablehnung nach dem Testende ankam. */
  let zeitgeber = null;
  /* Das Limit wird VOR dem Versuch festgelegt und der Warmlauf sofort
     vermerkt: Ein zweiter Aufrufer, der waehrend dieses Lesevorgangs
     hereinkommt, soll nicht ebenfalls das grosse Limit bekommen. */
  const limit = schonGelesen ? LESE_ZEITLIMIT_MS : ERSTES_LESE_ZEITLIMIT_MS;
  schonGelesen = true;
  try {
    const snap = await Promise.race([
      datenbank().doc(DOKUMENT).get(),
      new Promise((_, ab) => {
        zeitgeber = setTimeout(() => ab(new Error(`Zeitlimit ${limit} ms`)), limit);
        /* unref: Ein wartender Timer darf den Prozess nicht am Ende hindern. */
        if (typeof zeitgeber.unref === "function") zeitgeber.unref();
      }),
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
  } finally {
    if (zeitgeber) clearTimeout(zeitgeber);
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
      /* Kein gueltiger Satz = keine Analyse. Nur GERADE nicht lesbar heilt sich beim
         naechsten Aufruf und ist eine Warnung; alles andere alarmiert (SECURITY-MODEL, 07.09.2026). */
      if (String(ergebnis.grund).startsWith("nicht lesbar"))
        console.warn(JSON.stringify({ ...zeile, severity: "WARNING" }));
      else console.error(JSON.stringify(zeile));
    }
  }

  cache = { zeit: jetzt, ...ergebnis };
  return alsKopie(cache);
}

/* Fuer Tests: Cache leeren, damit jede Pruefung frisch liest. Der Warmlauf
   wird MITZURUECKGESETZT — sonst hiesse "frisch" hier etwas anderes als nach
   einem echten Instanzstart, und der Unterschied zwischen erstem und
   spaeterem Lesevorgang waere nicht pruefbar. */
function _cacheLeeren({ warmBleiben = false } = {}) {
  letzterZustand = null;
  cache = { zeit: 0, werte: null, quelle: "code" };
  /* warmBleiben=true simuliert eine Instanz, die schon einmal gelesen hat:
     Der Cache ist abgelaufen, die Verbindung steht aber. Nur so laesst sich
     pruefen, dass im LAUFENDEN Betrieb weiterhin 2000 ms gelten. */
  if (!warmBleiben) schonGelesen = false;
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
