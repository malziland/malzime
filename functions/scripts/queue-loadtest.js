#!/usr/bin/env node
"use strict";

/**
 * queue-loadtest.js — Echter Live-Test des v2.1.0 Queue-Pfads gegen Production.
 *
 * Simuliert N gleichzeitige Uploads gegen https://malzi.me/api/enqueue
 * und pollt https://malzi.me/api/job-status?jobId=xxx alle 2 s, bis jeder
 * Job entweder "done" oder "failed" ist (oder Timeout).
 *
 * Misst clientseitig pro Job:
 *   - enqueueMs       — Zeit von POST bis 200 OK mit jobId
 *   - pollCount       — Anzahl Status-Polls bis Terminal-Status
 *   - totalMs         — Wall-Clock von Upload-Start bis Terminal-Status
 *   - status          — done / failed / timeout / abandoned
 *   - blockedReason   — falls failed: warum
 *
 * Markiert jeden Job mit traceId `loadtest-<runid>-<wave>-<index>` —
 * damit Cloud-Logs hinterher per Filter zugeordnet werden können.
 *
 * Aufruf:
 *   node functions/scripts/queue-loadtest.js                  # Default: 5 parallel
 *   WAVE=10 node functions/scripts/queue-loadtest.js          # 10 parallel
 *   WAVE=5,10,20 node functions/scripts/queue-loadtest.js     # gestaffelt
 *
 * Output:
 *   loadtest-results-<runid>.json   in Repo-Root
 *
 * Kosten: ~1 ct pro Bild. 14 Bilder × 3 Wellen = ~42 ct gesamt.
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");

const BASE_URL = "https://malzi.me";
const ENQUEUE_URL = `${BASE_URL}/api/enqueue`;
const JOB_STATUS_URL = `${BASE_URL}/api/job-status`;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; /* 5 Min Timeout pro Job */
const RUN_ID = Date.now().toString(36);

const WAVE_SIZES = String(process.env.WAVE || "5")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);

/* ─────────────────────────────────────────────────────────────────────────
 * Bilder einlesen
 * ───────────────────────────────────────────────────────────────────────── */

function loadImages() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Eingabe-Ordner nicht gefunden: ${INPUT_DIR}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`Keine Bilder in ${INPUT_DIR}.`);
    process.exit(1);
  }
  return files.map((name) => {
    const buf = fs.readFileSync(path.join(INPUT_DIR, name));
    return { name, base64: buf.toString("base64"), sizeKB: Math.round(buf.length / 1024) };
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Ein Job: enqueue → poll bis Terminal-Status
 * ───────────────────────────────────────────────────────────────────────── */

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runJob({ image, traceId }) {
  const result = {
    traceId,
    imageName: image.name,
    imageSizeKB: image.sizeKB,
    enqueueMs: null,
    jobId: null,
    pollCount: 0,
    totalMs: null,
    status: "unknown",
    blockedReason: null,
    httpStatus: null,
    errorMessage: null,
  };

  const startWall = Date.now();
  let res;
  try {
    const t0 = Date.now();
    res = await fetch(ENQUEUE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: image.base64,
        exif: {},
        mimeType: "image/jpeg",
        filename: image.name,
        lang: "de",
        traceId,
      }),
    });
    result.enqueueMs = Date.now() - t0;
    result.httpStatus = res.status;
  } catch (err) {
    result.status = "enqueue-error";
    result.errorMessage = err.message;
    result.totalMs = Date.now() - startWall;
    return result;
  }

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* kein JSON */
    }
    result.status = "enqueue-failed";
    result.blockedReason = body?.blocked || body?.error || `HTTP ${res.status}`;
    result.errorMessage = body?.message || (await res.text().catch(() => "")).slice(0, 200);
    result.totalMs = Date.now() - startWall;
    return result;
  }

  let enqueueData;
  try {
    enqueueData = await res.json();
  } catch (err) {
    result.status = "enqueue-bad-json";
    result.errorMessage = err.message;
    result.totalMs = Date.now() - startWall;
    return result;
  }
  result.jobId = enqueueData?.jobId;
  if (!result.jobId) {
    result.status = "enqueue-no-jobid";
    result.totalMs = Date.now() - startWall;
    return result;
  }

  /* Polling bis Terminal-Status oder Timeout */
  const pollStart = Date.now();
  while (Date.now() - pollStart < POLL_MAX_DURATION_MS) {
    await sleep(POLL_INTERVAL_MS);
    result.pollCount++;
    try {
      const sres = await fetch(`${JOB_STATUS_URL}?jobId=${encodeURIComponent(result.jobId)}`);
      if (!sres.ok) continue; /* Netz-Wackler tolerieren wie Frontend */
      const data = await sres.json();
      const status = data?.status;
      if (status === "done") {
        result.status = "done";
        result.totalMs = Date.now() - startWall;
        return result;
      }
      if (status === "failed" || status === "blocked") {
        result.status = status;
        result.blockedReason = data?.blockedReason || data?.error || null;
        result.totalMs = Date.now() - startWall;
        return result;
      }
      /* sonst: pending / running — weiter pollen */
    } catch (err) {
      /* Netz-Fehler tolerieren */
    }
  }
  result.status = "timeout";
  result.totalMs = Date.now() - startWall;
  return result;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Welle: N Jobs parallel
 * ───────────────────────────────────────────────────────────────────────── */

async function runWave({ images, size, waveIndex }) {
  /* Bilder rotieren — wenn weniger Bilder als size, mehrfach nutzen. */
  const jobs = [];
  for (let i = 0; i < size; i++) {
    const image = images[i % images.length];
    const traceId = `loadtest-${RUN_ID}-w${waveIndex}-${String(i).padStart(2, "0")}`;
    jobs.push({ image, traceId, index: i });
  }
  console.log(`\n=== Welle ${waveIndex + 1} — ${size} parallele Uploads ===`);
  console.log(`Start: ${new Date().toLocaleTimeString("de-AT")}`);
  const t0 = Date.now();
  const results = await Promise.all(jobs.map((j) => runJob(j)));
  const elapsed = Date.now() - t0;
  console.log(`Welle ${waveIndex + 1} fertig nach ${(elapsed / 1000).toFixed(1)} s`);

  /* Mini-Auswertung der Welle */
  const byStatus = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`  Status-Verteilung: ${JSON.stringify(byStatus)}`);
  const dones = results.filter((r) => r.status === "done");
  if (dones.length > 0) {
    const sorted = dones.map((r) => r.totalMs).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`  Median totalMs (nur done): ${(median / 1000).toFixed(1)} s, min ${(sorted[0] / 1000).toFixed(1)} s, max ${(sorted[sorted.length - 1] / 1000).toFixed(1)} s`);
  }
  return { size, waveIndex, results, elapsedMs: elapsed };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────────────────── */

async function main() {
  const images = loadImages();
  console.log(`Geladen: ${images.length} Bilder aus ${INPUT_DIR}`);
  console.log(`Run-ID: ${RUN_ID}  (Trace-Präfix: loadtest-${RUN_ID}-...)`);
  console.log(`Wellen-Plan: ${WAVE_SIZES.join(" → ")} parallel`);
  console.log(`Target: ${BASE_URL}`);

  const allWaves = [];
  for (let i = 0; i < WAVE_SIZES.length; i++) {
    const wave = await runWave({ images, size: WAVE_SIZES[i], waveIndex: i });
    allWaves.push(wave);
    /* Pause zwischen Wellen damit Mistral-TPM-Fenster zurücksetzen kann */
    if (i < WAVE_SIZES.length - 1) {
      console.log(`Pause 60 s vor nächster Welle...`);
      await sleep(60_000);
    }
  }

  const outFile = path.join(REPO_ROOT, `loadtest-results-${RUN_ID}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ runId: RUN_ID, waves: allWaves }, null, 2));
  console.log(`\n--- Gesamte Ergebnisse geschrieben: ${outFile} ---`);

  /* Globale Mini-Auswertung */
  const allResults = allWaves.flatMap((w) => w.results);
  const total = allResults.length;
  const done = allResults.filter((r) => r.status === "done").length;
  const failed = allResults.filter((r) => r.status === "failed" || r.status === "blocked" || r.status.startsWith("enqueue-")).length;
  const timeout = allResults.filter((r) => r.status === "timeout").length;
  console.log(`\n=== Gesamt-Bilanz ===`);
  console.log(`  ${total} Jobs · ${done} done · ${failed} failed/blocked · ${timeout} timeout`);
  if (done > 0) {
    const sorted = allResults.filter((r) => r.status === "done").map((r) => r.totalMs).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log(`  Latenz P50: ${(p50 / 1000).toFixed(1)} s, P95: ${(p95 / 1000).toFixed(1)} s`);
  }
  console.log(`\nNächster Schritt: Cloud-Logs auswerten mit Filter:`);
  console.log(`  jsonPayload.traceId =~ "loadtest-${RUN_ID}-"`);
}

main().catch((err) => {
  console.error(`Unerwarteter Fehler: ${err.stack || err.message}`);
  process.exit(1);
});
