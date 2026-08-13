/* ── Stats-Seite: Lädt /api/stats und befüllt die Anzeige ── */

import { initI18n, t, getLanguage, applyTranslations } from "./i18n.js";
import { initSprachumschalter, merkmalUebernehmen } from "./sprachumschalter.js";

/* Projekt-Start: 5. Februar 2026 */
const PROJECT_START = new Date("2026-02-05");

function fmt(n) {
  return new Intl.NumberFormat(getLanguage()).format(n);
}

function calcAverages(allTime) {
  const now = new Date();
  const days = Math.max(1, Math.floor((now - PROJECT_START) / 86400000));
  const weeks = Math.max(1, Math.ceil(days / 7));
  const months = Math.max(
    1,
    (now.getFullYear() - PROJECT_START.getFullYear()) * 12 + now.getMonth() - PROJECT_START.getMonth() + 1
  );
  return {
    day: Math.round(allTime / days),
    week: Math.round(allTime / weeks),
    month: Math.round(allTime / months),
  };
}

async function loadStats() {
  const el = {
    liveCount: document.getElementById("liveCount"),
    totalValue: document.getElementById("totalValue"),
    todayValue: document.getElementById("todayValue"),
    weekValue: document.getElementById("weekValue"),
    monthValue: document.getElementById("monthValue"),
    avgDay: document.getElementById("avgDay"),
    avgWeek: document.getElementById("avgWeek"),
    avgMonth: document.getElementById("avgMonth"),
    limitBar: document.getElementById("limitBar"),
    limitLabels: document.getElementById("limitLabels"),
    limitFree: document.getElementById("limitFree"),
    limitBadge: document.getElementById("limitBadge"),
    limitCountdown: document.getElementById("limitCountdownStats"),
    statsError: document.getElementById("statsError"),
  };

  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    /* v3.3: Merkmals-Schloss des Sprachumschalters — dieselbe Antwort, die
       ohnehin geholt wird. Aus oder unlesbar ⇒ kein Bedienelement. */
    merkmalUebernehmen(data.sprachumschalter === true);

    /* Zahlen einsetzen — hourlyTotal ist die echte Anzahl (unabhängig von Resets) */
    el.liveCount.textContent = fmt(data.current.hourlyTotal);
    el.totalValue.textContent = fmt(data.totals.allTime);
    el.todayValue.textContent = fmt(data.totals.today);
    el.weekValue.textContent = fmt(data.totals.week);
    el.monthValue.textContent = fmt(data.totals.month);

    /* Durchschnitte */
    const avg = calcAverages(data.totals.allTime);
    el.avgDay.textContent = t("stats.avgDay", { value: fmt(avg.day) });
    el.avgWeek.textContent = t("stats.avgWeek", { value: fmt(avg.week) });
    el.avgMonth.textContent = t("stats.avgMonth", { value: fmt(avg.month) });

    /* Limit-Balken */
    const pct = Math.min(100, (data.current.count / data.current.limit) * 100);
    el.limitBar.style.width = pct.toFixed(1) + "%";

    const colorClass =
      pct < 60 ? "stats-limit__bar-fill--low" : pct < 85 ? "stats-limit__bar-fill--mid" : "stats-limit__bar-fill--high";
    el.limitBar.className = "stats-limit__bar-fill " + colorClass;

    el.limitLabels.textContent = fmt(data.current.count) + " / " + fmt(data.current.limit);
    el.limitFree.textContent = t("stats.percentFree", { value: (100 - pct).toFixed(1) });

    /* Limit-Status */
    if (data.current.limitActive) {
      el.limitBadge.textContent = t("stats.limitReached");
      el.limitBadge.className = "stats-limit__badge stats-limit__badge--warn";
      if (data.current.retryAfterSeconds > 0) {
        startCountdown(data.current.retryAfterSeconds, el.limitCountdown);
      }
    } else {
      el.limitBadge.textContent = t("stats.available");
      el.limitBadge.className = "stats-limit__badge stats-limit__badge--ok";
    }
  } catch (_err) {
    el.statsError.style.display = "block";
  }
}

function startCountdown(seconds, el) {
  if (!el) return;
  el.style.display = "block";
  let remaining = seconds;

  function update() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent =
      m > 0
        ? t("stats.countdownMinutes", { time: m + ":" + String(s).padStart(2, "0") })
        : t("stats.countdownSeconds", { seconds: s });
  }

  update();
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv);
      el.textContent = t("stats.countdownDone");
      setTimeout(() => location.reload(), 2000);
      return;
    }
    update();
  }, 1000);
}

async function init() {
  await initI18n();
  applyTranslations();

  /* v3.3: Diese Seite ist übersetzt, also bekommt sie den echten Umschalter.
     Ohne Neuanalyse-Rückruf — hier steht nichts auf dem Spiel, ein Wechsel
     zeichnet die Zahlen einfach neu. Gezeigt wird er nach denselben Regeln wie
     auf der Startseite: Merkmals-Schloss aus /api/stats, dazu die beiden
     Erprobungs-Türen (Adresse und Konsole). */
  initSprachumschalter({});

  await loadStats();
}

init();
