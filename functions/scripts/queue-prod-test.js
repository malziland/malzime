"use strict";

/**
 * queue-prod-test.js — Echter End-to-End-Test der Queue (Phase 4).
 *
 * Reiht N echte Analysen über den DEPLOYTEN enqueue-Endpoint ein, pollt bis
 * alle terminal sind und berichtet: Ergebnis-Verteilung, echte Bearbeitungs-
 * zeiten, Verlust-Kontrolle. Ruft ECHTES Mistral auf — kostet bei N=20 grob
 * ~1 €. Einmalig gedacht.
 *
 * Herkunft: lag bis 2026-08-18 als einzige Datei in einem eigenen Ordner
 * ~/Projekte/malzime-ops/ neben dem Repo — obwohl der Kopf schon immer den
 * Aufruf aus dem Repo-Wurzelverzeichnis beschrieb. Ein Werkzeug, das seinen
 * eigenen Ablageort widerlegt, findet niemand wieder.
 *
 * Aufruf aus dem Repo-Wurzelverzeichnis:
 *   node functions/scripts/queue-prod-test.js [N]
 *     N      Anzahl Jobs (Default 20).
 *     BASE_URL  überschreibt die Function-Basis-URL.
 *     IMAGE     überschreibt das Testbild.
 */

const fs = require("fs");
const path = require("path");

const N = Number(process.argv[2]) || 20;
const BASE = process.env.BASE_URL || "https://europe-west1-malzime.cloudfunctions.net";
const IMAGE = process.env.IMAGE || "public/img/demo/demo-selfie.jpg";
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 400; /* 400 x 3s = 20 min Obergrenze pro Job */

const imageBase64 = fs.readFileSync(path.resolve(IMAGE)).toString("base64");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function enqueueOne() {
  try {
    const resp = await fetch(`${BASE}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://malzi.me" },
      body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", lang: "de" }),
    });
    if (!resp.ok) return { ok: false, status: `HTTP ${resp.status}` };
    const data = await resp.json();
    return data && data.jobId ? { ok: true, jobId: data.jobId, t0: Date.now() } : { ok: false, status: "no-jobid" };
  } catch (err) {
    return { ok: false, status: err.message };
  }
}

async function pollJob(job) {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const resp = await fetch(`${BASE}/jobStatus?jobId=${encodeURIComponent(job.jobId)}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.status === "done") {
        const meta = (data.result && data.result.meta) || {};
        return {
          status: "done",
          durationMs: Date.now() - job.t0,
          mode: meta.mode,
          blocked: (data.result && data.result.blockedReason) || null,
        };
      }
      if (data.status === "failed") return { status: "failed", reason: data.errorReason };
      if (data.status === "abandoned") return { status: "abandoned" };
    } catch (_) {
      /* transient — weiter pollen */
    }
  }
  return { status: "timeout" };
}

function secs(ms) {
  return (ms / 1000).toFixed(0);
}

async function main() {
  console.log(`Echter Queue-Test: ${N} Jobs → ${BASE}/enqueue`);
  console.log(`Testbild: ${IMAGE} (${Math.round(imageBase64.length / 1024)} KB base64) — ECHTES Mistral!`);
  const start = Date.now();

  const enqueued = await Promise.all(Array.from({ length: N }, () => enqueueOne()));
  const jobs = enqueued.filter((e) => e.ok);
  const enqueueFails = enqueued.filter((e) => !e.ok);
  console.log(`Eingereiht: ${jobs.length}/${N}`);
  if (enqueueFails.length) console.log(`  Einreih-Fehler: ${enqueueFails.map((e) => e.status).join(", ")}`);

  const outcomes = await Promise.all(jobs.map((j) => pollJob(j)));

  const done = outcomes.filter((o) => o.status === "done");
  const profiles = done.filter((o) => !o.blocked);
  const blocked = done.filter((o) => o.blocked);
  const failed = outcomes.filter((o) => o.status === "failed");
  const abandoned = outcomes.filter((o) => o.status === "abandoned");
  const timeout = outcomes.filter((o) => o.status === "timeout");

  const durations = done.map((o) => o.durationMs).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;

  console.log("─".repeat(52));
  console.log(`Ergebnis nach ${secs(Date.now() - start)}s:`);
  console.log(`  done (echtes Profil):  ${profiles.length}`);
  console.log(`  done (blocked):        ${blocked.length}` + (blocked.length ? ` — ${blocked.map((o) => o.blocked).join(", ")}` : ""));
  console.log(`  failed:                ${failed.length}` + (failed.length ? ` — ${failed.map((o) => o.reason).join(", ")}` : ""));
  console.log(`  abandoned:             ${abandoned.length}`);
  console.log(`  timeout:               ${timeout.length}`);
  console.log(`  Einreih-Fehler:        ${enqueueFails.length}`);
  if (durations.length) {
    console.log(
      `Bearbeitungszeit (Einreihen→done): min ${secs(durations[0])}s · median ${secs(median)}s · max ${secs(durations[durations.length - 1])}s`
    );
  }
  const lost = N - enqueueFails.length - outcomes.length;
  const ok = enqueueFails.length === 0 && lost === 0 && failed.length === 0 && timeout.length === 0;
  console.log(ok ? "✓ Kein Job verloren, kein harter Fehler." : "✗ Siehe Zahlen oben.");
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error("Test-Fehler:", err.message);
  process.exitCode = 1;
});
