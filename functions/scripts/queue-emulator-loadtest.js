"use strict";

/**
 * queue-emulator-loadtest.js — Mock-Lasttest der Queue im Firebase-Emulator.
 *
 * Feuert N Analyse-Anfragen gegen den lokalen enqueue-Endpoint, wartet bis
 * alle Jobs terminal sind und berichtet: wie viele done / failed / abandoned,
 * ob ein Job verloren ging, Gesamtdauer. Kostet nichts — Mistral ist im
 * Emulator gemockt (MISTRAL_MOCK=1).
 *
 * Voraussetzung: Emulator laeuft (`npm run emulator`).
 *
 * Aufruf:  node functions/scripts/queue-emulator-loadtest.js [N]
 *            N = Anzahl Jobs (Default 50; sinnvoll 50 / 100 / 200).
 *          BASE_URL-env ueberschreibt die Emulator-Adresse.
 */

const N = Number(process.argv[2]) || 50;
const PROJECT = process.env.GCLOUD_PROJECT || "malzime";
const REGION = "europe-west1";
const BASE = process.env.BASE_URL || `http://127.0.0.1:5001/${PROJECT}/${REGION}`;
const ENQUEUE = `${BASE}/enqueue`;
const JOB_STATUS = `${BASE}/jobStatus`;

/* Minimaler gueltiger JPEG-Puffer (>= 12 Byte, JPEG-Magic FF D8). Inhalt
   egal — Mistral ist gemockt, es muss nur die Magic-Byte-Pruefung bestehen. */
const IMAGE_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 150; /* 150 x 2s = 5 min Obergrenze pro Job */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function enqueueOne() {
  try {
    const resp = await fetch(ENQUEUE, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:5000" },
      body: JSON.stringify({ imageBase64: IMAGE_B64, mimeType: "image/jpeg", lang: "de" }),
    });
    if (!resp.ok) return { ok: false, status: resp.status };
    const data = await resp.json();
    return data && data.jobId ? { ok: true, jobId: data.jobId } : { ok: false, status: "no-jobid" };
  } catch (err) {
    return { ok: false, status: err.message };
  }
}

async function pollJob(jobId) {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const resp = await fetch(`${JOB_STATUS}?jobId=${encodeURIComponent(jobId)}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.status === "done" || data.status === "failed" || data.status === "abandoned") {
        return data.status;
      }
    } catch (_) {
      /* transienter Fehler — weiter pollen */
    }
  }
  return "timeout";
}

async function main() {
  console.log(`Queue-Lasttest: ${N} Jobs → ${ENQUEUE}`);
  const start = Date.now();

  const enqueued = await Promise.all(Array.from({ length: N }, () => enqueueOne()));
  const jobIds = enqueued.filter((e) => e.ok).map((e) => e.jobId);
  const enqueueFails = N - jobIds.length;
  console.log(`Eingereiht: ${jobIds.length}/${N}  (Fehlschlaege: ${enqueueFails})`);

  const outcomes = await Promise.all(jobIds.map((id) => pollJob(id)));
  const tally = {};
  for (const s of outcomes) tally[s] = (tally[s] || 0) + 1;

  console.log("─".repeat(44));
  console.log(`Ergebnis nach ${((Date.now() - start) / 1000).toFixed(1)}s:`);
  console.log(`  done:      ${tally.done || 0}`);
  console.log(`  failed:    ${tally.failed || 0}`);
  console.log(`  abandoned: ${tally.abandoned || 0}`);
  console.log(`  timeout:   ${tally.timeout || 0}`);
  console.log(`  Einreih-Fehlschlaege: ${enqueueFails}`);

  const ok = enqueueFails === 0 && (tally.done || 0) === N;
  console.log(ok ? "✓ Alle Jobs sauber durchgelaufen, keiner verloren." : "✗ Nicht alle Jobs erfolgreich.");
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error("Lasttest-Fehler:", err.message);
  process.exitCode = 1;
});
