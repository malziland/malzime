const { FieldValue } = require("firebase-admin/firestore");
const { datenbank } = require("./db");
const { HOURLY_LIMIT, HOURLY_WINDOW_MINUTES } = require("./config");

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
async function checkAndIncrement() {
  /* v1.10.6: Eigene Retry-Schleife OBEN auf das Firestore-SDK-Retry (default 5).
     Hintergrund: Bei hoher Last (>=20 parallele Anfragen) kollidieren mehrere
     Transactions am selben Counter-Dokument → Firestore wirft ABORTED. Das
     SDK retried intern bis zu 5×, aber unter Workshop-Burst reicht das manchmal
     nicht. Unsere Schleife versucht bei ABORTED noch 2× mit Backoff+Jitter,
     bevor wir fail-open + ERROR eskalieren. Andere Firestore-Fehler (Netz,
     Permission, etc.) gehen sofort in den ERROR-Pfad. */
  const ABORTED_RETRIES = 2;
  let lastErr = null;
  for (let attempt = 0; attempt <= ABORTED_RETRIES; attempt++) {
    try {
      const db = datenbank();
      const ref = db.doc(CURRENT_DOC);

      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : {};

        const limit = data.limit || HOURLY_LIMIT;
        const wm = data.windowMinutes || HOURLY_WINDOW_MINUTES;
        const windowMs = wm * 60 * 1000;
        const now = Date.now();

        /* Rollendes Fenster: nur Analysen der letzten Stunde */
        const recent = filterRecent(data.recentAnalyses, now, windowMs);

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
        recent.push(now);
        const justReached = recent.length === limit;

        if (snap.exists) {
          tx.update(ref, { recentAnalyses: recent });
        } else {
          tx.set(ref, {
            recentAnalyses: recent,
            limit: HOURLY_LIMIT,
            windowMinutes: HOURLY_WINDOW_MINUTES,
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

      return result;
    } catch (err) {
      lastErr = err;
      const isAborted = err.code === 10 || /ABORTED/i.test(err.message || "");
      if (isAborted && attempt < ABORTED_RETRIES) {
        /* Backoff mit Jitter: 80ms beim 1. Retry, 160ms beim 2. — plus 0-80ms
           Zufall, damit nicht alle Caller im gleichen Moment zurueckkommen. */
        const backoff = 80 * (attempt + 1) + Math.random() * 80;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      /* Fail-open: Lieber ein paar Analysen zu viel als alle User blockieren.
         REL-02: Der Stundenzaehler ist die einzige globale Kostenbremse fuer
         Mistral-Calls. Faellt er aus, ist diese Bremse weg — darum als ERROR
         (statt nur log) mit eindeutigem alert-Marker eskalieren, damit ein
         Log-basierter Alert in Cloud Logging anschlagen kann.
         v1.10.6: Routinemaessige ABORTED-Kontention wird VORHER 2× geretried
         und triggert hier nur den ERROR-Pfad, wenn auch das nicht reicht. */
      const reason = isAborted ? "aborted-retries-exhausted" : "firestore-error";
      console.error(
        JSON.stringify({
          severity: "ERROR",
          alert: "counter-fail-open",
          warning: "counter-error",
          reason,
          message: "Stundenlimit-Zaehler fehlgeschlagen — globale Kostenbremse momentan inaktiv",
          error: err.message,
        })
      );
      return { allowed: true, retryAfterSeconds: 0, count: -1, limit: HOURLY_LIMIT, error: err.message };
    }
  }
  /* Unerreichbar — der Loop kommt aus jedem Iteration entweder mit return
     oder via continue heraus. Sicherheitshalber fail-open. */
  return { allowed: true, retryAfterSeconds: 0, count: -1, limit: HOURLY_LIMIT, error: lastErr && lastErr.message };
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
    const db = datenbank();
    const [currentSnap, totalsSnap] = await Promise.all([db.doc(CURRENT_DOC).get(), db.doc(TOTALS_DOC).get()]);

    const current = currentSnap.exists
      ? currentSnap.data()
      : { limit: HOURLY_LIMIT, windowMinutes: HOURLY_WINDOW_MINUTES };
    const totals = totalsSnap.exists ? totalsSnap.data() : { today: 0, week: 0, month: 0, year: 0, allTime: 0 };

    const currentLimit = current.limit || HOURLY_LIMIT;
    const wm = current.windowMinutes || HOURLY_WINDOW_MINUTES;
    const windowMs = wm * 60 * 1000;
    const now = Date.now();

    const recent = filterRecent(current.recentAnalyses, now, windowMs);
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
const BOOST_OBERGRENZE = 2 * HOURLY_LIMIT;

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
  try {
    ergebnis = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const daten = snap && snap.exists ? snap.data() : null;
      const aktuell = Number((daten && daten.limit) || HOURLY_LIMIT);
      const gewuenscht = aktuell + amount;
      if (gewuenscht > BOOST_OBERGRENZE) {
        return { limit: aktuell, aktuell, gewuenscht, abgelehnt: true, grund: "obergrenze" };
      }
      tx.set(ref, { limit: gewuenscht }, { merge: true });
      return { limit: gewuenscht, abgelehnt: false };
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
        obergrenze: BOOST_OBERGRENZE,
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
  await ref.set({ recentAnalyses: [], limit: HOURLY_LIMIT }, { merge: true });
}

/**
 * BIZ-001 (Audit 2026-06): Gibt EINEN belegten Slot im rollenden Stundenfenster
 * wieder frei. Der Stundenzähler wird beim enqueue gezogen; Jobs, die danach
 * abgebrochen werden (abandoned) oder gar nicht in die Queue kamen
 * (enqueue_failed), haben aber NIE eine echte Mistral-Analyse ausgelöst. Ohne
 * Freigabe würden solche „Phantom-Analysen" das globale Budget verbrauchen und
 * echte Nutzer früher als nötig aussperren. Entfernt den jüngsten
 * recentAnalyses-Eintrag in einer Transaktion. Fail-safe: bei Fehler passiert
 * nichts (das Limit bleibt dann konservativ — kostet nur etwas Verfügbarkeit).
 */
async function releaseHourlySlot() {
  try {
    const db = datenbank();
    const ref = db.doc(CURRENT_DOC);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const arr = snap.data().recentAnalyses;
      if (!Array.isArray(arr) || arr.length === 0) return;
      const normalized = arr.map((ts) => (ts && ts.toMillis ? ts.toMillis() : ts));
      let maxIdx = 0;
      for (let i = 1; i < normalized.length; i++) if (normalized[i] > normalized[maxIdx]) maxIdx = i;
      normalized.splice(maxIdx, 1);
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
  getMaintenanceStatus,
  setMaintenanceMode,
  _clearMaintenanceCache,
  filterRecent,
  calcRetrySeconds,
  getDateKeys,
};
