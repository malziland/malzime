"use strict";

/**
 * load-test-malzime.js — Lasttest fuer v1.10.6.
 *
 * Schickt N parallele POST /analyze gegen die LIVE-API (api.malzi.me).
 * Misst clientseitig: status, totalMs, blockedReason. Markiert jede Anfrage
 * mit einer eindeutigen Trace-ID `loadtest-<runid>-<index>`, damit man die
 * serverseitigen Logs nachher per Filter zuordnen kann.
 *
 * Modi:
 *   - Default: One-Shot — eine Anfrage pro Slot, kein Retry. Zeigt rohes
 *     Server-Verhalten unter Last.
 *   - WITH_RETRY=1: Simuliert das Browser-Frontend mit Auto-Retry — bis zu
 *     3 Wiederholungen bei blocked.overloaded / HTTP 429 / HTTP 503, mit
 *     8s ± 2s Jitter zwischen den Versuchen. Zeigt das, was der User
 *     tatsaechlich erlebt.
 *
 * Aufruf:
 *   node functions/scripts/load-test-malzime.js                   # 20 parallel one-shot
 *   CONCURRENT=10 node functions/scripts/load-test-malzime.js     # 10 parallel one-shot
 *   WITH_RETRY=1 node functions/scripts/load-test-malzime.js      # mit Browser-Retry
 *
 * Erwartete Kosten: ~$0.015 pro Analyse via Mistral = ~$0.30 fuer 20 Bilder
 * im One-Shot-Modus; mit Retries entsprechend mehr (im Worst Case ×4 = ~$1.20).
 */

const fs = require("fs");
const path = require("path");

const ANALYZE_URL = "https://api.malzi.me";
const CONCURRENT = Number(process.env.CONCURRENT || 20);
const WITH_RETRY = process.env.WITH_RETRY === "1";
const TEST_IMAGE = path.join(__dirname, "..", "..", "public", "img", "demo", "demo-selfie.jpg");
const RUN_ID = Date.now().toString(36);
const TRACE_PREFIX = `loadtest-${RUN_ID}-`;

/* Diese Werte spiegeln das Frontend (public/js/api.js v1.10.6) wider. */
const MAX_AUTO_RETRIES = 3;
const RETRY_WAIT_BASE_MS = 8000;
const RETRY_WAIT_JITTER_MS = 2000;

/* SPREAD_MS: verteilt die CONCURRENT Anfragen gleichmaessig ueber dieses
   Zeitfenster, statt alle gleichzeitig abzufeuern. Realistischer fuer einen
   echten Workshop (Schueler klicken nicht in derselben Millisekunde).
   SPREAD_MS=0 (Default) = alle parallel. SPREAD_MS=10000 = 20 Anfragen
   ueber 10 s = eine alle ~500 ms. */
const SPREAD_MS = Number(process.env.SPREAD_MS || 0);

function retryWaitMs() {
  return RETRY_WAIT_BASE_MS + (Math.random() * 2 - 1) * RETRY_WAIT_JITTER_MS;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* Einzel-Versuch — entspricht einem "fetch + parse" im Browser. */
async function singleAttempt(traceId, imageBase64) {
  let status = -1;
  let body = null;
  let error = null;
  const start = Date.now();
  try {
    const res = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malzi.me",
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: "image/jpeg",
        filename: "loadtest.jpg",
        lang: "de",
        traceId,
      }),
    });
    status = res.status;
    try {
      body = await res.json();
    } catch (_) {
      /* ignore parse failure */
    }
  } catch (err) {
    error = err.message;
  }
  const durationMs = Date.now() - start;
  const blockedReason = body && body.blockedReason ? body.blockedReason : null;
  const hasProfiles = body && body.profiles && (body.profiles.normal || body.profiles.boost);
  const ok = status === 200 && !blockedReason && hasProfiles;
  /* Retryable-Bedingungen 1:1 wie im Browser-Frontend */
  const isHardLimit = body && body.blocked === "limit";
  const isMaintenance = body && body.maintenance;
  const retryable =
    !ok &&
    !isHardLimit &&
    !isMaintenance &&
    (status === 429 || status === 503 || blockedReason === "blocked.overloaded");
  return { status, durationMs, ok, blockedReason, error, retryable };
}

/* Browser-aequivalente Anfrage: initial + bis zu MAX_AUTO_RETRIES Retries. */
async function singleRequest(index, imageBase64) {
  const traceId = TRACE_PREFIX + index;
  const start = Date.now();
  const attempts = [];

  for (let n = 0; n <= (WITH_RETRY ? MAX_AUTO_RETRIES : 0); n++) {
    if (n > 0) await sleep(retryWaitMs());
    const attempt = await singleAttempt(traceId, imageBase64);
    attempts.push(attempt);
    if (attempt.ok) break;
    if (!attempt.retryable) break;
    if (!WITH_RETRY) break;
  }

  const lastAttempt = attempts[attempts.length - 1];
  const totalMs = Date.now() - start;
  return {
    index,
    traceId,
    attempts: attempts.length,
    status: lastAttempt.status,
    durationMs: totalMs,
    ok: lastAttempt.ok,
    blockedReason: lastAttempt.blockedReason,
    error: lastAttempt.error,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

async function main() {
  process.stdout.write(`Reading test image: ${TEST_IMAGE}\n`);
  const buffer = fs.readFileSync(TEST_IMAGE);
  const imageBase64 = buffer.toString("base64");
  process.stdout.write(`Image: ${(buffer.length / 1024).toFixed(0)} KB raw, ${(imageBase64.length / 1024).toFixed(0)} KB base64\n`);

  process.stdout.write(`\nRun ID: ${RUN_ID}\n`);
  process.stdout.write(`Trace prefix: ${TRACE_PREFIX}\n`);
  process.stdout.write(`Target: ${ANALYZE_URL}\n`);
  process.stdout.write(`Concurrency: ${CONCURRENT}\n`);
  process.stdout.write(
    `Mode: ${WITH_RETRY ? `Browser-Auto-Retry (max ${MAX_AUTO_RETRIES} Retries, ~${RETRY_WAIT_BASE_MS / 1000}s ± ${RETRY_WAIT_JITTER_MS / 1000}s zwischen Versuchen)` : "One-Shot (kein Retry)"}\n`
  );
  process.stdout.write(
    `Verteilung: ${SPREAD_MS > 0 ? `${CONCURRENT} Anfragen gestaffelt ueber ${SPREAD_MS / 1000}s (alle ~${Math.round(SPREAD_MS / (CONCURRENT - 1))}ms)` : "alle gleichzeitig (Burst)"}\n`
  );

  const startedAt = new Date();
  process.stdout.write(`\nStarted at: ${startedAt.toISOString()}\n`);

  /* Gestaffelter Start: jede Anfrage i startet i × gap Millisekunden spaeter. */
  const gap = SPREAD_MS > 0 && CONCURRENT > 1 ? SPREAD_MS / (CONCURRENT - 1) : 0;
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, async (_, i) => {
      if (gap > 0) await sleep(i * gap);
      return singleRequest(i, imageBase64);
    })
  );
  const totalElapsed = Date.now() - t0;
  const finishedAt = new Date();

  const successful = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const durations = successful.map((r) => r.durationMs).sort((a, b) => a - b);

  process.stdout.write(`\nFinished at: ${finishedAt.toISOString()}\n`);
  process.stdout.write(`\n========== RESULTS ==========\n`);
  process.stdout.write(`Wall-clock elapsed: ${(totalElapsed / 1000).toFixed(1)} s\n`);
  process.stdout.write(`Successful: ${successful.length}/${CONCURRENT}\n`);
  process.stdout.write(`Failed:     ${failed.length}/${CONCURRENT}\n`);

  if (durations.length > 0) {
    process.stdout.write(`\nLatency (successful, client-side):\n`);
    process.stdout.write(`  min: ${(durations[0] / 1000).toFixed(1)} s\n`);
    process.stdout.write(`  p50: ${(percentile(durations, 0.5) / 1000).toFixed(1)} s\n`);
    process.stdout.write(`  p95: ${(percentile(durations, 0.95) / 1000).toFixed(1)} s\n`);
    process.stdout.write(`  max: ${(durations[durations.length - 1] / 1000).toFixed(1)} s\n`);
  }

  if (failed.length > 0) {
    process.stdout.write(`\nFailures:\n`);
    for (const f of failed) {
      const detail = f.error ? `error=${f.error}` : f.blockedReason || `status=${f.status}`;
      process.stdout.write(`  #${f.index} (trace ${f.traceId}): ${detail} after ${(f.durationMs / 1000).toFixed(1)} s\n`);
    }
  }

  process.stdout.write(`\n========== ALL TRACE IDS ==========\n`);
  for (const r of results) {
    const flag = r.ok ? "OK " : "ERR";
    const retryInfo = WITH_RETRY ? `  attempts=${r.attempts}` : "";
    process.stdout.write(
      `  ${flag} ${r.traceId}  status=${r.status}  ${(r.durationMs / 1000).toFixed(1)}s${retryInfo}\n`
    );
  }

  if (WITH_RETRY) {
    const attemptsDistribution = results.reduce((acc, r) => {
      acc[r.attempts] = (acc[r.attempts] || 0) + 1;
      return acc;
    }, {});
    process.stdout.write(`\n========== RETRY-VERTEILUNG ==========\n`);
    for (let i = 1; i <= MAX_AUTO_RETRIES + 1; i++) {
      if (attemptsDistribution[i]) {
        process.stdout.write(`  Erfolg nach ${i} Versuch${i > 1 ? "en" : ""}: ${attemptsDistribution[i]}\n`);
      }
    }
  }

  process.stdout.write(`\nCloud Logging filter (alle Logs dieses Lasttests):\n`);
  process.stdout.write(`  jsonPayload.traceId =~ "^${TRACE_PREFIX}"\n`);
  process.stdout.write(`\nDone.\n`);
}

main().catch((e) => {
  process.stderr.write(String(e.stack || e.message || e) + "\n");
  process.exit(1);
});
