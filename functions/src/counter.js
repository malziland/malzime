const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { HOURLY_LIMIT, HOURLY_WINDOW_MINUTES } = require("./config");

const CURRENT_DOC = "stats/current";
const TOTALS_DOC = "stats/totals";
const MAINTENANCE_DOC = "config/maintenance";

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
  try {
    const db = getFirestore();
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
    /* Fail-open: Lieber ein paar Analysen zu viel als alle User blockieren.
       REL-02: Der Stundenzaehler ist die einzige globale Kostenbremse fuer
       Mistral-Calls. Faellt er aus, ist diese Bremse weg — darum als ERROR
       (statt nur log) mit eindeutigem alert-Marker eskalieren, damit ein
       Log-basierter Alert in Cloud Logging anschlagen kann. */
    console.error(
      JSON.stringify({
        severity: "ERROR",
        alert: "counter-fail-open",
        warning: "counter-error",
        message: "Stundenlimit-Zaehler fehlgeschlagen — globale Kostenbremse momentan inaktiv",
        error: err.message,
      })
    );
    return { allowed: true, retryAfterSeconds: 0, count: -1, limit: HOURLY_LIMIT, error: err.message };
  }
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

  /* Wochenstart (Montag) in Wiener Zeit berechnen */
  const viennaDay = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", weekday: "short" }).format(now);
  const dayMap = { Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 };
  const diff = dayMap[viennaDay] || 0;
  const mondayMs = now.getTime() - diff * 86400000;
  const weekStart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(mondayMs));

  return { todayDate, weekStart, monthKey, yearKey };
}

/**
 * Erhöht die Gesamt-Statistiken (today/week/month/year/allTime).
 * Wird nach erfolgreicher Analyse aufgerufen.
 */
async function incrementTotals() {
  try {
    const db = getFirestore();
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
    const db = getFirestore();
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
async function boostLimit(amount = 100) {
  const db = getFirestore();
  const ref = db.doc(CURRENT_DOC);
  await ref.set({ limit: FieldValue.increment(amount) }, { merge: true });
}

/**
 * Setzt alles zurück (Admin-Funktion, für ntfy-Buttons).
 * Leert recentAnalyses → Count sofort 0, System sofort frei.
 */
async function resetCounter() {
  const db = getFirestore();
  const ref = db.doc(CURRENT_DOC);
  await ref.set({ recentAnalyses: [], limit: HOURLY_LIMIT }, { merge: true });
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
    const db = getFirestore();
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
  const db = getFirestore();
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
  boostLimit,
  resetCounter,
  getMaintenanceStatus,
  setMaintenanceMode,
  _clearMaintenanceCache,
  filterRecent,
  calcRetrySeconds,
  getDateKeys,
};
