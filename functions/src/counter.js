const { FieldValue } = require("firebase-admin/firestore");
const { datenbank } = require("./db");
const { geltendeWerte } = require("./betriebsprofil");

const CURRENT_DOC = "stats/current";
const TOTALS_DOC = "stats/totals";
const MAINTENANCE_DOC = "config/maintenance";
/* Realitäts-Check (v3.1): anonymes Aggregat der Selbsteinschätzungen —
   nur zwei Zahlen (Anzahl + Prozentsumme), nichts Verknüpfbares. */
const REALITAETS_CHECK_DOC = "stats/realitaetsCheck";

/**
 * Filtert das recentAnalyses-Array: nur Timestamps der letzten windowMs behalten.
 * Behandelt sowohl Firestore-Timestamps (.toMillis()) als auch plain Numbers.
 */
function filterRecent(arr, now, windowMs) {
  return (arr || []).map((ts) => (ts && ts.toMillis ? ts.toMillis() : ts)).filter((ts) => now - ts < windowMs);
}

/**
 * Berechnet die Sekunden bis der nächste Eintrag aus dem Fenster fällt
 * und damit der Count unter das Limit sinkt.
 */
function calcRetrySeconds(recent, limit, now, windowMs) {
  if (recent.length < limit) return 0;
  const sorted = [...recent].sort((a, b) => a - b);
  const pivotIndex = recent.length - limit; // dieser Eintrag muss rausfallen
  return Math.max(1, Math.ceil((windowMs - (now - sorted[pivotIndex])) / 1000));
}

/**
 * Prüft ob das Limit erreicht ist und erhöht den Zähler.
 *
 * Das Limit basiert auf einem echten rollenden Fenster: recentAnalyses
 * enthält die Timestamps aller Analysen der letzten 60 Minuten.
 * Sobald genug alte Einträge herausfallen, ist das System sofort wieder frei.
 *
 * Bei Firestore-Fehler: fail-open (allowed: true).
 */

/* ══════════════════════════════════════════════════════════════════════
   DAS NETZ UNTER DER KOSTENBREMSE (30.08.2026, umgebaut 01.09.2026)
   ══════════════════════════════════════════════════════════════════════

   Warum es das Netz gibt, steht in checkAndIncrement (der Zaehler klemmt bei
   Andrang an EINEM Dokument) und in docs/SECURITY-MODEL.md.

   BIZ-2026-09-01-01 (Audit vom 01.09.): Die erste Fassung zaehlte die
   AUFTRAEGE der letzten Stunde per Aggregat-Abfrage — und uebersah, dass der
   Aufraeumer zugestellte Auftraege 15 Minuten nach der Zustellung loescht
   (PRIV-107b). Unter Andrang sah das Netz nur ein Viertel der Stunde und
   erreichte das Limit nie; dazu rechnete es mit dem Grundlimit statt mit
   einem laufenden Boost. Ein Ersatzweg, der eine andere Menge und eine andere
   Grenze misst als der Hauptweg, ist keiner.

   DIESES NETZ MISST DASSELBE WIE DER ZAEHLER: derselbe Stand (stats/current)
   mit einem einfachen Lesezugriff AUSSERHALB der Transaktion — eine
   Schreibsperre haelt Leser nicht auf —, dasselbe Fenster (filterRecent),
   dasselbe wirksame Limit inklusive Boost (wirksamesLimit). Es schreibt
   nichts und scheitert deshalb nicht an derselben Ursache.

   GRENZE: Der eigene Eintrag fehlt im gelesenen Stand, bis die Transaktion
   ihn doch noch schreibt oder der Worker ihn nachtraegt (GENAU EINMAL IM
   FENSTER, unten). Waehrend einer Andrangswelle sieht das Netz also etwas zu
   wenig; danach stimmt die Zahl (docs/SECURITY-MODEL.md, "Jeder eingelassene
   Auftrag zaehlt genau einmal"). Und weil das Netz nichts schreibt, saehe
   jeder Aufruf denselben Stand: "Limit erreicht" (justReached, daran haengt
   die Push-Nachricht mit dem Boost-Knopf) geht je Instanz hoechstens einmal je
   NETZ_MELDEABSTAND_MS hinaus. Greift NUR, wenn der Zaehler ausgefallen ist.
   ══════════════════════════════════════════════════════════════════════ */
/* BLEIBT IM CODE — Auswertungsregel der Meldung, keine Betriebsgroesse: Wie
   oft eine Instanz im Netz-Fall "Limit erreicht" meldet. Aendert nichts an der
   Bremse, nur an der Zahl der Nachrichten. */
const NETZ_MELDEABSTAND_MS = 5 * 60 * 1000;
let netzZuletztGemeldet = 0;

async function netzUeberZeitstempel(satzwerte) {
  try {
    const snap = await datenbank().doc(CURRENT_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const windowMs = satzwerte.stundenfensterMinuten * 60 * 1000;
    const now = Date.now();
    const recent = filterRecent(data.recentAnalyses, now, windowMs);
    const { limit } = wirksamesLimit(data, recent.length, satzwerte.stundenlimit);
    if (recent.length >= limit) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          alert: "notbremse-gegriffen",
          message: "Der Stundenzaehler ist ausgefallen — die Notbremse hat uebernommen und blockiert.",
          imFenster: recent.length,
          limit,
        })
      );
      return {
        allowed: false,
        count: recent.length,
        limit,
        retryAfterSeconds: calcRetrySeconds(recent, limit, now, windowMs),
        notbremse: true,
      };
    }
    /* Mit diesem Auftrag waere das Limit voll: dieselbe Bedingung wie
       `justReached` im Zaehler-Pfad, nur ohne Schreibvorgang — darum die Frist. */
    let justReached = false;
    if (recent.length + 1 === limit && now - netzZuletztGemeldet >= NETZ_MELDEABSTAND_MS) {
      netzZuletztGemeldet = now;
      justReached = true;
    }
    return { allowed: true, count: recent.length, limit, retryAfterSeconds: 0, notbremse: true, justReached };
  } catch (fehler) {
    /* Auch das Netz kann reissen — dann bleibt nur fail-open, aber laut. */
    console.error(
      JSON.stringify({
        severity: "ERROR",
        alert: "notbremse-fehlgeschlagen",
        message: "Weder Zaehler noch Notbremse verfuegbar — KEINE Kostenbremse aktiv.",
        error: fehler && fehler.message,
      })
    );
    return null;
  }
}

/* Nur fuer Tests: die Meldefrist des Netzes zuruecksetzen. */
function _netzMeldungZuruecksetzen() {
  netzZuletztGemeldet = 0;
}

/* ══════════════════════════════════════════════════════════════════════
   GENAU EINMAL IM FENSTER (11.09.2026)
   ══════════════════════════════════════════════════════════════════════

   BELEG (Lasttest 11.09.2026, 30 Auftraege gleichzeitig): Neunmal griff das
   Netz nach dem Zeitlimit. Acht der haengenden Transaktionen schrieben ihren
   Eintrag spaeter doch noch (bis 43 Sekunden danach), eine nie. Die
   Statusseite zeigte 35 in der letzten Stunde bei 36 fertigen Analysen.

   SEITHER hat jeder Einlass eine eigene MARKE (neuerZaehlerStempel), und sein
   Eintrag im Fenster IST diese Marke. Faellt der Zaehler aus und laesst das
   Netz ein, bekommt der Auftrag das Kennzeichen `zaehlerNachtrag`, und der
   Worker traegt die Marke zu Beginn der Analyse nach (zaehlerNachtragen).
   arrayUnion fuegt einen Wert, der schon im Feld steht, nicht ein zweites Mal
   ein: Schreibt die alte Transaktion doch noch, bleibt es bei einem Eintrag.
   Umgekehrt schaut die nachlaufende Transaktion nach, ob die Marke schon
   drinsteht.

   WARUM DER WORKER und nicht der Einlass selbst: Der Einlass antwortet nach
   Sekunden, danach drosselt die Plattform die Instanz — was dann noch laeuft,
   kommt vielleicht nie an (der eine von neun). Der Worker laeuft ohnehin rund
   40 Sekunden; der Nachtrag laeuft neben der Analyse her und kostet keine
   Wartezeit.

   NACHLAUF: Eine Transaktion, deren Zeitlimit abgelaufen ist, traegt nur noch
   ein, wenn ihr Auftrag eingelassen und nicht freigegeben wurde, und
   hoechstens NACHLAUF_HOECHSTENS_MS nach dem Start. Eine gedrosselte Instanz
   kann sie sonst Minuten spaeter fortsetzen — nach einer Freigabe in einem
   anderen Prozess, von der dieser nichts weiss.

   GRENZE: Eine Marke ist die Millisekunde plus ein Zufallsbruchteil; eine Zahl
   dieser Groesse traegt rund 4000 verschiedene Bruchteile je Millisekunde.
   Treffen zwei Netz-Faelle auf dieselbe Millisekunde UND denselben Bruchteil,
   haelt der Nachtrag den zweiten fuer den ersten. Im Normalfall (die
   Transaktion schreibt) spielt das keine Rolle.
   ══════════════════════════════════════════════════════════════════════ */
/* BLEIBT IM CODE — Riegel der Zaehllogik, keine Betriebsgroesse: Er muss
   ueber dem laengsten gemessenen Nachlauf liegen (43 s, 11.09.2026) und klar
   unter der Karenz, nach der ein wartender Auftrag als verlassen gilt
   (livenessGnadenfristMs). Wer ihn verstellt, aendert nicht das Tempo,
   sondern ob ein Auftrag doppelt zaehlen kann. */
const NACHLAUF_HOECHSTENS_MS = 60 * 1000;
/* Einlaesse, deren Zeitlimit abgelaufen ist und deren Transaktion noch nicht
   zurueck ist (Marke → Zustand). Nur so erfaehrt ein spaeter Rueckruf in
   DIESEM Prozess, dass sein Auftrag inzwischen freigegeben wurde. */
const offeneNachlaeufe = new Map();

function neuerZaehlerStempel() {
  return Date.now() + Math.random();
}

function nachlaufMerken(stempel, lauf) {
  /* Eine Transaktion, die nie zurueckkommt, darf die Liste nicht wachsen lassen. */
  const grenze = Date.now() - NACHLAUF_HOECHSTENS_MS;
  for (const [marke, alt] of offeneNachlaeufe) if (alt.start < grenze) offeneNachlaeufe.delete(marke);
  offeneNachlaeufe.set(stempel, lauf);
}

/**
 * Traegt die Marke eines eingelassenen Auftrags ins Stundenfenster nach, wenn
 * der Zaehler beim Einlass ausgewichen war (GENAU EINMAL IM FENSTER, oben).
 * Ohne Transaktion: arrayUnion liest nichts, wartet auf keine Lesesperre und
 * traegt einen schon vorhandenen Wert nicht doppelt ein. Zwei Versuche; gibt
 * `true` zurueck, wenn der Schreibvorgang ankam. Wirft nie.
 */
async function zaehlerNachtragen(stempel) {
  if (typeof stempel !== "number" || !Number.isFinite(stempel)) return false;
  let fehler = null;
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      await datenbank()
        .doc(CURRENT_DOC)
        .set({ recentAnalyses: FieldValue.arrayUnion(stempel) }, { merge: true });
      console.log(JSON.stringify({ step: "zaehler-nachtrag", status: "ok", versuch: versuch + 1 }));
      return true;
    } catch (f) {
      fehler = f;
      if (versuch === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  /* Dann fehlt dieser eine Auftrag im Fenster — genau der Fehler, den der
     Nachtrag beheben soll. Darum laut, aber ohne Alarm: Die Kostenbremse haelt
     weiter, nur die Zahl liegt um eins daneben. */
  console.log(JSON.stringify({ step: "zaehler-nachtrag", warning: "fehlgeschlagen", error: fehler && fehler.message }));
  return false;
}

async function checkAndIncrement() {
  /* Bei Andrang kollidieren Transaktionen am selben Dokument (ABORTED; das
     SDK wiederholt intern bis zu 5x). Darueber ZWEI eigene kurze Versuche —
     nicht mehr: Fuenf Versuche mit langen Abstaenden machten den Einlass am
     30.08.2026 unter Andrang so langsam, dass Verbindungen rissen (Messwerte
     in docs/SECURITY-MODEL.md). Alles darueber uebernimmt sofort das Netz
     (netzUeberZeitstempel, oben), das denselben Stand ohne Sperre liest. */
  const ZAEHLER_ZEITLIMIT_MS = 2000;
  const ABORTED_RETRIES = 2;
  let lastErr = null;
  /* Einstellungssatz EINMAL vor der Transaktionsschleife holen — innerhalb
     einer Firestore-Transaktion darf kein weiterer Lesevorgang laufen. */
  const { werte: satzwerte } = await geltendeWerte().catch(() => ({ werte: null }));
  /* BEFUND 01.09.2026 (Runde 7, K-4): Ohne Einstellungssatz lief diese
     Funktion in einen Zugriffsfehler auf `null` — gefangen vom aeusseren
     catch, das fail-open auf `allowed: true` faellt. Die globale Kostenbremse
     war damit aus, und die Meldung dazu sagte nur "Fehler", nicht "kein Satz".
     Elf Zeilen weiter stand bereits `satzwerte?.stundenlimit` mit Fragezeichen
     — der Unterschied war ein Versehen, keine Entscheidung.
     Real ist die Lage entschaerft: Ohne Satz bricht handle-enqueue schon mit
     503 ab, und der Worker liefert `config_missing`; es entstehen also keine
     KI-Kosten, die zu bremsen waeren. Trotzdem gehoert der Zustand benannt,
     statt als unklarer Fehler durchzurutschen. */
  if (!satzwerte) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        step: "counter",
        grund: "kein-einstellungssatz",
        hinweis:
          "Die globale Kostenbremse kann ohne Einstellungssatz nicht rechnen. " +
          "Ohne ihn laeuft ohnehin keine Analyse — aber wer hier landet, hat ein " +
          "Konfigurationsproblem, kein Kostenproblem.",
      })
    );
    return { allowed: true, count: 0, limit: null, grund: "kein-einstellungssatz" };
  }
  /* Die Marke dieses Einlasses und sein Zustand fuer eine Transaktion, die das
     Zeitlimit ueberlebt (GENAU EINMAL IM FENSTER, oben). */
  const stempel = neuerZaehlerStempel();
  const lauf = { start: Date.now(), zeitlimit: false, verzichtet: false };
  for (let attempt = 0; attempt <= ABORTED_RETRIES; attempt++) {
    try {
      const db = datenbank();
      const ref = db.doc(CURRENT_DOC);

      /* EIGENES ZEITLIMIT UM DIE TRANSAKTION (30.08.2026): Ohne das hingen
         75 % der Anfragen 54 Sekunden, weil Firestore selbst lange auf die
         Dokumentsperre wartet. Zwei Sekunden reichen fuer ein kleines
         Dokument; danach uebernimmt das Netz. */
      let uhr = null;
      const zeitlimit = new Promise((_, ab) => {
        uhr = setTimeout(() => {
          /* Ab jetzt entscheidet das Netz. Die Transaktion laeuft als Nachlauf
             weiter und traegt nur noch unter Bedingungen ein. */
          lauf.zeitlimit = true;
          nachlaufMerken(stempel, lauf);
          const f = new Error(`Zeitlimit ${ZAEHLER_ZEITLIMIT_MS} ms fuer den Stundenzaehler`);
          /* KEIN code = 10: die Transaktion schreibt nach dem race weiter — als ABORTED zaehlte sie doppelt. */
          f.zeitlimit = true;
          ab(f);
        }, ZAEHLER_ZEITLIMIT_MS);
        if (typeof uhr.unref === "function") uhr.unref();
      });
      const transaktion = db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : {};

        /* NACHLAUF: Das Zeitlimit ist abgelaufen, das Netz hat entschieden.
             Wurde der Auftrag abgewiesen oder freigegeben, oder liegt der Start
             laenger als NACHLAUF_HOECHSTENS_MS zurueck, traegt diese
             Transaktion nichts mehr ein. Ein eingelassener Auftrag zaehlt dann
             ueber den Nachtrag des Workers. */
        if (lauf.zeitlimit && (lauf.verzichtet || Date.now() - lauf.start > NACHLAUF_HOECHSTENS_MS)) {
          const verzicht = new Error("Nachlauf des Stundenzaehlers traegt nicht mehr ein");
          verzicht.nachlaufVerzichtet = true;
          throw verzicht;
        }

        /* Das Zeitfenster gehoert zum Limit — eine Zahl ohne ihren Bezugsraum
           ist keine Einstellung. Reihenfolge: Einstellungssatz, dann ein
           gesetzter Wert im Dokument, dann die Konstante. */
        /* EINE QUELLE: Das Zeitfenster kommt aus dem Einstellungssatz. Der
           Wert im Dokument stammt nur noch aus einem laufenden Boost. */
        const wm = satzwerte.stundenfensterMinuten;
        const windowMs = wm * 60 * 1000;
        const now = Date.now();

        /* Rollendes Fenster: nur Analysen der letzten Stunde */
        const recent = filterRecent(data.recentAnalyses, now, windowMs);

        /* Hat der Worker die Marke schon nachgetragen, ist der Auftrag
             gezaehlt. Gefragt wird nur im Nachlauf: Im Normalfall kann die
             eigene Marke nicht drinstehen, und ein zufaellig gleicher Wert
             eines anderen Auftrags wuerde diesen sonst verschlucken. */
        if (lauf.zeitlimit && recent.includes(stempel)) {
          return { allowed: true, retryAfterSeconds: 0, count: recent.length, limit: null, hourlyTotal: recent.length };
        }

        /* BIZ-2026-08-20-28: Ein abgelaufener Boost faellt hier zurueck — aber nur,
           wenn er gerade nicht gebraucht wird (siehe wirksamesLimit). Der
           Rueckfall wird gleich mitgeschrieben, damit /stats und der naechste
           Aufruf dasselbe sehen. */
        const { limit, verfallen: boostVerfallen } = wirksamesLimit(data, recent.length, satzwerte?.stundenlimit);

        /* Limit erreicht → blockieren */
        if (recent.length >= limit) {
          const retryAfterSeconds = calcRetrySeconds(recent, limit, now, windowMs);
          return {
            allowed: false,
            retryAfterSeconds,
            count: recent.length,
            limit,
            hourlyTotal: recent.length,
          };
        }

        /* Unter dem Limit → Analyse erlauben */
        /* Der Eintrag ist die Marke des Auftrags, nicht die Uhrzeit dieses
             Durchlaufs — nur so finden Nachtrag und Freigabe genau ihn. */
        recent.push(stempel);
        const justReached = recent.length === limit;

        if (snap.exists) {
          /* BIZ-2026-08-20-28: Ist der Boost verfallen, wird der Deckel in
             derselben Transaktion zurueckgeschrieben — sonst wuerde er bei jedem
             Aufruf neu "verfallen", ohne je im Dokument anzukommen, und /stats
             zeigte weiter den erhoehten Wert. */
          const aenderung = boostVerfallen
            ? { recentAnalyses: recent, limit: satzwerte.stundenlimit, limitBis: null }
            : { recentAnalyses: recent };
          if (boostVerfallen) {
            console.log(
              JSON.stringify({
                step: "boost-verfallen",
                zurueckAuf: satzwerte.stundenlimit,
                imFenster: recent.length,
                hinweis: "Der zeitlich befristete Boost ist abgelaufen und wurde gerade nicht gebraucht.",
              })
            );
          }
          tx.update(ref, aenderung);
        } else {
          tx.set(ref, {
            recentAnalyses: recent,
            limit: satzwerte.stundenlimit,
            windowMinutes: satzwerte.stundenfensterMinuten,
          });
        }

        return {
          allowed: true,
          retryAfterSeconds: 0,
          count: recent.length,
          limit,
          hourlyTotal: recent.length,
          justReached,
        };
      });
      /* Wer das Rennen verliert, laeuft weiter. Ist er zurueck, braucht es die
         Uhr nicht mehr, und der Nachlauf ist erledigt. */
      const erledigt = () => {
        clearTimeout(uhr);
        offeneNachlaeufe.delete(stempel);
      };
      Promise.resolve(transaktion).then(erledigt, erledigt);
      const result = await Promise.race([transaktion, zeitlimit]);

      return { ...result, stempel };
    } catch (err) {
      lastErr = err;
      const isAborted = err.code === 10 || /ABORTED/i.test(err.message || "");
      if (!err.zeitlimit && isAborted && attempt < ABORTED_RETRIES) {
        /* Kurz: 80 und 160 ms, plus bis zu 80 ms Zufall. Genug fuer eine
           zufaellige Kollision, zu kurz, um den Einlass aufzuhalten. Bei
           echtem Andrang uebernimmt das Netz. */
        const backoff = 80 * (attempt + 1) + Math.random() * 80;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      let reason = "firestore-error";
      if (err.zeitlimit) reason = "zeitlimit-kein-retry";
      else if (isAborted) reason = "aborted-retries-exhausted";

      /* ZUERST DAS NETZ, DANN DIE MELDUNG: Der Zaehler ist ausgefallen, die
         Kostenbremse darf es nicht sein. Ein ERROR an dieser Stelle meldete
         frueher 169 Mal je Simulatorlauf einen Ausfall, den das Netz laengst
         aufgefangen hatte — Fehlalarm, der den Ernstfall unauffindbar macht. */
      if (satzwerte) {
        const netz = await netzUeberZeitstempel(satzwerte);
        if (netz) {
          /* Abgewiesen zaehlt nicht — auch nicht ueber einen spaeten Nachlauf. */
          if (!netz.allowed) lauf.verzichtet = true;
          /* HINWEIS, kein Fehler: Die Bremse hat nur den zweiten Weg genommen.
             Die Ernstfaelle meldet netzUeberZeitstempel selbst
             ("notbremse-gegriffen", "notbremse-fehlgeschlagen"). */
          console.log(
            JSON.stringify({
              step: "kostenbremse",
              status: "netz-hat-uebernommen",
              grund: reason,
              imFenster: netz.count,
              limit: netz.limit,
              entscheidung: netz.allowed ? "eingelassen" : "blockiert",
            })
          );
          /* Eingelassen, aber nicht sicher gezaehlt: Der Worker traegt die Marke
             nach (zaehlerNachtragen). */
          return { ...netz, error: err.message, stempel, nachtragNoetig: netz.allowed };
        }
      }

      /* Erst wenn AUCH das Netz reisst: fail-open, damit ein Datenbankproblem
         den Workshop nicht stoppt. `limit: null` sagt ehrlich, dass hier keine
         Grenze bekannt ist — eine erfundene Zahl waere schlechter als keine. */
      return {
        allowed: true,
        retryAfterSeconds: 0,
        count: -1,
        limit: null,
        error: err.message,
        stempel,
        nachtragNoetig: true,
      };
    }
  }
  /* Unerreichbar — der Loop kommt aus jedem Iteration entweder mit return
     oder via continue heraus. Sicherheitshalber fail-open. */
  return {
    allowed: true,
    retryAfterSeconds: 0,
    count: -1,
    limit: null,
    error: lastErr && lastErr.message,
    stempel,
    nachtragNoetig: true,
  };
}

/**
 * Berechnet Datums-Keys in Europe/Vienna (inkl. Sommer-/Winterzeit).
 * Wird von incrementTotals() und getStats() verwendet.
 */
function getDateKeys(now = new Date()) {
  const viennaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m] = viennaDate.split("-");
  const todayDate = viennaDate;
  const monthKey = `${y}-${m}`;
  const yearKey = y;

  /* Wochenstart (Montag) in Wiener Zeit berechnen.
     BUG-2026-08-20-48: Die Rechnung zog `diff` mal 86.400.000 ms ab — also feste
     24-Stunden-Tage. An den beiden Umstellungssonntagen hat der Tag in Wien aber
     23 bzw. 25 Stunden. Am Winterzeit-Sonntag (naechstes Mal 25.10.2026) landete
     der Rueckschritt um sechs "Tage" deshalb im Sonntag der VORwoche, ab 23:00
     Ortszeit sogar im falschen Kalendertag — die Wochenzahl der /stats-Seite
     sprang dann fuer bis zu eine Stunde auf einen falschen Wochenschluessel, und
     Analysen dieser Stunde wurden einer anderen Woche gutgeschrieben.
     Jetzt wird in Wiener KALENDERtagen gerechnet statt in Millisekunden: Der
     Tagesschluessel wird zerlegt und ueber UTC-Mitternacht zurueckgezaehlt, wo
     ein Tag immer 24 Stunden hat. */
  const viennaDay = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", weekday: "short" }).format(now);
  const dayMap = { Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 };
  const diff = dayMap[viennaDay] || 0;
  const [jahr, monat, tag] = todayDate.split("-").map(Number);
  const montagUtc = new Date(Date.UTC(jahr, monat - 1, tag) - diff * 86400000);
  const weekStart = `${montagUtc.getUTCFullYear()}-${String(montagUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(
    montagUtc.getUTCDate()
  ).padStart(2, "0")}`;

  return { todayDate, weekStart, monthKey, yearKey };
}

/**
 * Erhöht die Gesamt-Statistiken (today/week/month/year/allTime).
 * Wird nach erfolgreicher Analyse aufgerufen.
 */
async function incrementTotals() {
  try {
    const db = datenbank();
    const ref = db.doc(TOTALS_DOC);

    const { todayDate, weekStart, monthKey, yearKey } = getDateKeys();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};

      const updates = { allTime: (data.allTime || 0) + 1 };

      /* Tages-Zähler */
      if (data.todayDate === todayDate) {
        updates.today = (data.today || 0) + 1;
      } else {
        updates.today = 1;
        updates.todayDate = todayDate;
      }

      /* Wochen-Zähler */
      if (data.weekStart === weekStart) {
        updates.week = (data.week || 0) + 1;
      } else {
        updates.week = 1;
        updates.weekStart = weekStart;
      }

      /* Monats-Zähler */
      if (data.monthKey === monthKey) {
        updates.month = (data.month || 0) + 1;
      } else {
        updates.month = 1;
        updates.monthKey = monthKey;
      }

      /* Jahres-Zähler */
      if (data.yearKey === yearKey) {
        updates.year = (data.year || 0) + 1;
      } else {
        updates.year = 1;
        updates.yearKey = yearKey;
      }

      tx.set(ref, updates, { merge: true });
    });
  } catch (err) {
    /* Totals-Fehler sind nicht kritisch — Analyse geht trotzdem weiter */
    console.log(JSON.stringify({ warning: "totals-error", error: err.message }));
  }
}

/**
 * Liest die aktuellen Stats für den öffentlichen API-Endpunkt.
 * Alles basiert auf dem rollenden Fenster (recentAnalyses).
 */
async function getStats() {
  try {
    const { werte: satzwerte } = await geltendeWerte().catch(() => ({ werte: null }));
    const db = datenbank();
    const [currentSnap, totalsSnap] = await Promise.all([db.doc(CURRENT_DOC).get(), db.doc(TOTALS_DOC).get()]);

    const current = currentSnap.exists
      ? currentSnap.data()
      : { limit: satzwerte?.stundenlimit ?? null, windowMinutes: satzwerte?.stundenfensterMinuten ?? null };
    const totals = totalsSnap.exists ? totalsSnap.data() : { today: 0, week: 0, month: 0, year: 0, allTime: 0 };

    const wm = satzwerte?.stundenfensterMinuten ?? current.windowMinutes;
    const windowMs = wm * 60 * 1000;
    const now = Date.now();

    const recent = filterRecent(current.recentAnalyses, now, windowMs);
    /* BIZ-2026-08-20-28: Dieselbe Quelle wie der Einlass — sonst zeigte /stats
       einen Deckel an, den der naechste Upload gar nicht mehr bekommt. */
    const { limit: currentLimit } = wirksamesLimit(current, recent.length, satzwerte?.stundenlimit);
    const recentCount = recent.length;
    const limitActive = recentCount >= currentLimit;
    const retryAfterSeconds = limitActive ? calcRetrySeconds(recent, currentLimit, now, windowMs) : 0;

    /* BUG-002: Kein Cleanup-Write auf dem Read-Pfad — Cleanup passiert in checkAndIncrement(). */

    /* Live-Reset: Wenn der gespeicherte Datums-Key nicht mehr zum aktuellen
       Wiener Datum passt, zeigen wir 0 statt den gestrigen/letztwöchigen Wert. */
    const keys = getDateKeys();

    return {
      current: {
        count: recentCount,
        limit: currentLimit,
        limitActive,
        retryAfterSeconds,
        hourlyTotal: recentCount,
      },
      totals: {
        today: totals.todayDate === keys.todayDate ? totals.today || 0 : 0,
        week: totals.weekStart === keys.weekStart ? totals.week || 0 : 0,
        month: totals.monthKey === keys.monthKey ? totals.month || 0 : 0,
        year: totals.yearKey === keys.yearKey ? totals.year || 0 : 0,
        allTime: totals.allTime || 0,
      },
    };
  } catch (err) {
    console.log(JSON.stringify({ warning: "stats-read-error", error: err.message }));
    return null;
  }
}

/**
 * Erhöht das Limit um den angegebenen Betrag (Admin-Funktion, für ntfy-Buttons).
 * Wenn der aktuelle Count unter dem neuen Limit liegt, ist das System sofort frei.
 */
/* AUDIT-BEFUND SEC-2026-08-12-17: `FieldValue.increment` ohne Obergrenze. Wer den
   Boost-Link einmal sah (er steht im Klartext in der ntfy-Mitteilung), konnte 30
   Minuten lang beliebig oft anheben und die einzige globale Kostenbremse damit
   praktisch abschalten. Der Deckel begrenzt den Schaden auf das Doppelte des
   regulaeren Stundenlimits — genug fuer den gedachten Zweck (eine Schulklasse
   mehr), zu wenig fuer eine Kostenlawine. */
/* Der Deckel und die Frist kommen aus dem Einstellungssatz (boostFaktor,
   boostFristMs) — frueher standen sie im Code und waren damit eine zweite
   Definition neben dem Stundenlimit. */

/* BIZ-2026-08-20-28 (Entscheidung E2 aus dem Audit, 2026-08-21): Ein Boost hob den
   Deckel DAUERHAFT an. Es gab keinen Rückfall auf das reguläre Stundenlimit, keinen
   Zeitplan, der ihn zurücksetzt, und keinen Alarm, wenn er wochenlang stehen blieb —
   die dokumentierte zentrale Kostenbremse ("Stundenlimit 500/h") war nach einem
   einzigen Klick still verdoppelt. Zurück ging es nur über einen manuellen Reset,
   an den sich jemand erinnern musste.

   BEWUSST SANFT gebaut, weil hier der Workshop-Betrieb hängt: Der Boost verfällt
   NICHT hart nach Ablauf der Frist. Er verfällt, sobald er nicht mehr gebraucht
   wird — also erst, wenn die Frist um ist UND der rollende Zähler wieder unter dem
   regulären Limit liegt. So kann niemand mitten in einer laufenden Klasse
   ausgesperrt werden; der Deckel normalisiert sich von selbst in der ersten
   ruhigen Minute danach. */

/**
 * Das heute gültige Stundenlimit. EINE Quelle für alle Lesestellen — vorher
 * stand `data.limit || HOURLY_LIMIT` an drei Stellen, die getrennt hätten
 * abdriften können.
 *
 * @param {object|null} daten Dokument `stats/current`.
 * @param {number} anzahlImFenster Analysen im rollenden Fenster.
 * @returns {{limit:number, verfallen:boolean}} verfallen=true → der Boost ist
 *   abgelaufen und darf zurückgeschrieben werden.
 */
function wirksamesLimit(daten, anzahlImFenster = 0, grundlimit) {
  /* EINE QUELLE FUER DEN GRUNDWERT (30.08.2026): Das regulaere Stundenlimit
     kommt aus dem Einstellungssatz und wird hereingereicht. Der Boost ist
     KEINE zweite Definition desselben Werts, sondern ein zeitlich begrenzter
     Aufschlag darauf — er hat ein Ablaufdatum und faellt danach auf den
     Grundwert zurueck. */
  /* Der Grundwert ist PFLICHT — es gibt keinen Rueckfall mehr im Code
     (Vorgabe des Nutzers, 30.08.2026: jeder Wert genau einmal, aus der
     Datenbank). Fehlt er, ist das ein Konfigurationsfehler und soll auffallen. */
  if (typeof grundlimit !== "number" || grundlimit <= 0) {
    throw new Error("wirksamesLimit: Grundlimit fehlt — Einstellungssatz nicht geladen");
  }
  const basis = grundlimit;
  const gesetzt = Number((daten && daten.limit) || basis);
  if (gesetzt <= basis) return { limit: basis, verfallen: false };
  const bis = Number((daten && daten.limitBis) || 0);
  /* Ohne Ablaufdatum stammt der Boost aus der Zeit vor diesem Fix — dann gilt er
     weiter, bis ihn ein neuer Boost oder ein Reset ablöst. Bestehendes still zu
     entwerten wäre die schlechtere Überraschung. */
  if (!bis) return { limit: gesetzt, verfallen: false };
  const abgelaufen = Date.now() > bis;
  const wirdNichtGebraucht = anzahlImFenster < basis;
  if (abgelaufen && wirdNichtGebraucht) return { limit: basis, verfallen: true };
  return { limit: gesetzt, verfallen: false };
}

async function boostLimit(amount = 100) {
  const db = datenbank();
  const ref = db.doc(CURRENT_DOC);
  /* SEC-2026-08-13-A: Lesen, Obergrenze prüfen und Schreiben laufen in EINER
     Transaktion — vorher lagen `get()` und `set(increment)` offen nebeneinander,
     sodass N gleichzeitige Boosts die Obergrenze beliebig überschritten (der
     Deckel aus SEC-17 ist genau für den abgeflossenen Boost-Link gebaut). Dazu
     ein ABSOLUTER Wert statt `FieldValue.increment`: increment kann die geprüfte
     Obergrenze bauartbedingt nicht einhalten.
     Fail-closed bleibt (Transaktionsfehler → keine Anhebung); die Entscheidung
     wird aus der Transaktion zurückgegeben und ERST DANACH geloggt, damit ein
     Transaktions-Retry die Logzeile nicht vervielfacht. */
  let ergebnis;
  /* Grundwert VOR der Transaktion holen — innerhalb einer Firestore-Transaktion
     darf kein weiterer Lesevorgang laufen. */
  const { werte: satzwerte, grund: satzgrund } = await geltendeWerte();
  if (!satzwerte) {
    /* Fail-closed: Ohne Einstellungssatz kein Boost. */
    console.error(
      JSON.stringify({
        severity: "ERROR",
        error: "boost-ohne-einstellungssatz",
        grund: satzgrund || null,
        hinweis: "Boost abgelehnt, weil kein gueltiger Einstellungssatz vorliegt.",
      })
    );
    return { limit: null, abgelehnt: true };
  }
  const obergrenze = satzwerte.stundenlimit * satzwerte.boostFaktor;
  const fristMs = satzwerte.boostFristMs;
  try {
    ergebnis = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const daten = snap && snap.exists ? snap.data() : null;
      const aktuell = Number((daten && daten.limit) || satzwerte.stundenlimit);
      const gewuenscht = aktuell + amount;
      if (gewuenscht > obergrenze) {
        return { limit: aktuell, aktuell, gewuenscht, abgelehnt: true, grund: "obergrenze" };
      }
      /* BIZ-2026-08-20-28: mit Ablaufdatum statt fuer immer. */
      tx.set(ref, { limit: gewuenscht, limitBis: Date.now() + fristMs }, { merge: true });
      return { limit: gewuenscht, abgelehnt: false, gueltigBis: Date.now() + fristMs };
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        error: "boost-limit-nicht-lesbar",
        message: err && err.message,
        hinweis: "Boost abgelehnt, weil die Transaktion fehlschlug (Grenze nicht lesbar/schreibbar).",
      })
    );
    return { limit: null, abgelehnt: true };
  }
  if (ergebnis.abgelehnt && ergebnis.grund === "obergrenze") {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        error: "boost-obergrenze-erreicht",
        aktuell: ergebnis.aktuell,
        angefragt: ergebnis.gewuenscht,
        obergrenze,
        hinweis: "Boost abgelehnt. Haeufige Ablehnungen koennen auf einen abgeflossenen Boost-Link hindeuten.",
      })
    );
    return { limit: ergebnis.limit, abgelehnt: true };
  }
  return { limit: ergebnis.limit, abgelehnt: false };
}

/**
 * Setzt alles zurück (Admin-Funktion, für ntfy-Buttons).
 * Leert recentAnalyses → Count sofort 0, System sofort frei.
 */
async function resetCounter() {
  const db = datenbank();
  const ref = db.doc(CURRENT_DOC);
  const { werte: sw } = await geltendeWerte();
  await ref.set({ recentAnalyses: [], limit: sw.stundenlimit, limitBis: null }, { merge: true });
}

/**
 * BIZ-001 (Audit 2026-06): Gibt EINEN belegten Slot im rollenden Stundenfenster
 * wieder frei. Der Stundenzähler wird beim enqueue gezogen; Jobs, die danach
 * abgebrochen werden (abandoned) oder gar nicht in die Queue kamen
 * (enqueue_failed), haben aber NIE eine echte Mistral-Analyse ausgelöst. Ohne
 * Freigabe würden solche „Phantom-Analysen" das globale Budget verbrauchen und
 * echte Nutzer früher als nötig aussperren. Fail-safe: bei Fehler passiert
 * nichts (das Limit bleibt dann konservativ — kostet nur etwas Verfügbarkeit).
 *
 * @param {number} [stempel] die Marke des Auftrags (`zaehlerStempel` im
 *   Auftrag, `stempel` aus checkAndIncrement). Mit Marke fällt GENAU dieser
 *   Eintrag; steht er nicht im Fenster, fällt keiner.
 */
async function releaseHourlySlot(stempel) {
  const mitMarke = typeof stempel === "number" && Number.isFinite(stempel);
  /* Laeuft die Transaktion dieses Einlasses in DIESEM Prozess noch, darf sie
     nach der Freigabe nicht mehr eintragen. */
  if (mitMarke && offeneNachlaeufe.has(stempel)) offeneNachlaeufe.get(stempel).verzichtet = true;
  try {
    const db = datenbank();
    const ref = db.doc(CURRENT_DOC);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const arr = snap.data().recentAnalyses;
      if (!Array.isArray(arr) || arr.length === 0) return;
      const normalized = arr.map((ts) => (ts && ts.toMillis ? ts.toMillis() : ts));
      /* SEIT 11.09.2026 GENAU DER EIGENE EINTRAG (vorher Pruefrunde 8, N-P3c:
         immer der juengste). Die Anzahl stimmte damit nur, solange jeder
         eigene Eintrag da war. Im Netz-Fall ist er das nicht — dann nahm die
         Freigabe einem anderen Auftrag den Platz, und die Stunde zaehlte einen
         zu wenig. Die Kennung, die dafuer "durch die ganze Kette" noetig war,
         gibt es jetzt: die Marke im Auftrag (GENAU EINMAL IM FENSTER).

         Auftraege von vor dem Umbau tragen keine Marke; fuer sie bleibt der
         juengste Eintrag, bis sie nach spaetestens zwei Stunden verschwunden
         sind. */
      let idx;
      if (mitMarke) {
        idx = normalized.indexOf(stempel);
        if (idx === -1) return;
      } else {
        idx = 0;
        for (let i = 1; i < normalized.length; i++) if (normalized[i] > normalized[idx]) idx = i;
      }
      normalized.splice(idx, 1);
      tx.update(ref, { recentAnalyses: normalized });
    });
  } catch (err) {
    console.log(JSON.stringify({ warning: "release-slot-error", error: err.message }));
  }
}

/* ── Realitäts-Check (v3.1): anonymer Gesamtzähler ── */

/**
 * Zählt eine Realitäts-Check-Eingabe ins Aggregat: `eingaben` +1 und
 * `summeProzent` +score — atomar über FieldValue.increment, damit parallele
 * Workshop-Eingaben nichts verlieren. Der Score kommt bereits serverseitig
 * validiert und berechnet aus handle-telemetry (dem Client wird nicht
 * vertraut); hier wird er nur noch defensiv auf 0–100 geklemmt.
 *
 * Fehler werden still geschluckt (nur Log-Warnung) — Telemetrie darf den
 * Antwortweg nie zum Scheitern bringen.
 */
async function zaehleRealitaetsCheck(score) {
  try {
    const s = Math.max(0, Math.min(100, Math.round(score)));
    const db = datenbank();
    await db.doc(REALITAETS_CHECK_DOC).set(
      {
        eingaben: FieldValue.increment(1),
        summeProzent: FieldValue.increment(s),
      },
      { merge: true }
    );
  } catch (err) {
    console.log(JSON.stringify({ warning: "realitaets-check-zaehler-fehler", error: err.message }));
  }
}

/* K-2026-08-13-9: Der Vergleichswert erscheint erst ab dieser Zahl. Die
   Oberfläche sagt „ab 100 Eingaben" zu — die Schwelle wurde vorher nur im
   Frontend gezogen, während /api/stats den Mittelwert schon ab der ersten
   Eingabe herausgab. Jetzt hält die API dieselbe Zusage: unter der Schwelle
   ist `mittelProzent` null. (Ein Mittelwert aus wenigen Eingaben ist zudem
   nicht aussagekräftig.) */
const REALITAETS_CHECK_MINDEST_EINGABEN = 100;

/**
 * Liest das Realitäts-Check-Aggregat für /api/stats: Anzahl der Eingaben und
 * gerundeter Mittelwert. Unter REALITAETS_CHECK_MINDEST_EINGABEN ist
 * `mittelProzent` null — dieselbe Schwelle, die die Oberfläche zusagt. Fehler
 * liefern den leeren Stand, die Stats-Antwort bleibt funktionsfähig.
 */
async function leseRealitaetsCheck() {
  try {
    const db = datenbank();
    const snap = await db.doc(REALITAETS_CHECK_DOC).get();
    const data = snap.exists ? snap.data() : {};
    const eingaben = typeof data.eingaben === "number" ? data.eingaben : 0;
    const summe = typeof data.summeProzent === "number" ? data.summeProzent : 0;
    return {
      eingaben,
      mittelProzent: eingaben >= REALITAETS_CHECK_MINDEST_EINGABEN ? Math.round(summe / eingaben) : null,
    };
  } catch (err) {
    console.log(JSON.stringify({ warning: "realitaets-check-lese-fehler", error: err.message }));
    return { eingaben: 0, mittelProzent: null };
  }
}

/* ── Maintenance-Modus (Kill-Switch) ── */

let maintenanceCache = { data: null, expiresAt: 0 };
const MAINTENANCE_CACHE_TTL_MS = 30000;

/**
 * Liest den Maintenance-Status aus Firestore (30s Cache).
 * Fail-open: Bei Fehler wird der Service NICHT gesperrt.
 */
async function getMaintenanceStatus() {
  const now = Date.now();
  if (maintenanceCache.data && now < maintenanceCache.expiresAt) {
    return maintenanceCache.data;
  }
  try {
    const db = datenbank();
    const snap = await db.doc(MAINTENANCE_DOC).get();
    const result =
      snap.exists && snap.data().enabled
        ? { enabled: true, message: snap.data().message || "" }
        : { enabled: false, message: "" };
    maintenanceCache = { data: result, expiresAt: now + MAINTENANCE_CACHE_TTL_MS };
    return result;
  } catch (err) {
    console.log(JSON.stringify({ warning: "maintenance-read-error", error: err.message }));
    return { enabled: false, message: "" };
  }
}

/**
 * Setzt den Maintenance-Modus (Admin-Funktion).
 */
async function setMaintenanceMode(enabled, message) {
  const db = datenbank();
  await db.doc(MAINTENANCE_DOC).set({
    enabled: !!enabled,
    message: message || "",
    updatedAt: Date.now(),
  });
  maintenanceCache = { data: null, expiresAt: 0 };
}

/* Nur für Tests — Cache zurücksetzen */
function _clearMaintenanceCache() {
  maintenanceCache = { data: null, expiresAt: 0 };
}

module.exports = {
  checkAndIncrement,
  incrementTotals,
  getStats,
  zaehleRealitaetsCheck,
  leseRealitaetsCheck,
  boostLimit,
  resetCounter,
  releaseHourlySlot,
  zaehlerNachtragen,
  getMaintenanceStatus,
  setMaintenanceMode,
  _clearMaintenanceCache,
  _netzMeldungZuruecksetzen,
  filterRecent,
  calcRetrySeconds,
  getDateKeys,
};
