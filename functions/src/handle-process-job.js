"use strict";

/**
 * handle-process-job.js — Worker der Queue-Architektur (v2.0).
 *
 * Wird AUSSCHLIESSLICH von Cloud Tasks aufgerufen (POST mit { jobId }).
 * Der Schutz vor öffentlichem Aufruf liegt auf IAM-Ebene: die processJob-
 * Function wird NICHT public deployt — nur der Service-Account von Cloud
 * Tasks erhält die Invoker-Rolle (siehe index.js + Deploy-Schritt). Cloud
 * Run weist unauthentifizierte Aufrufe damit ab, bevor dieser Code läuft.
 *
 * Ablauf:
 *  1. Job aus Firestore lesen, claimen (idempotent: queued → processing).
 *  2. Bild aus Storage laden.
 *  3. Mistral-Pipeline (Beschreibung → Klassifikation → Privacy → Profile) —
 *     dieselben Module wie der synchrone /analyze-Pfad.
 *  4. Ergebnis ins Job-Dokument schreiben (completeJob).
 *  5. Bild aus Storage löschen (immer — Erfolg ODER Fehler).
 *
 * Idempotenz: Liefert Cloud Tasks denselben Task doppelt, schlägt der
 * zweite claimJob fehl → der Worker bestätigt nur (200) und tut nichts.
 *
 * Fehlerverhalten: Jeder Pipeline-Fehler wird zu einem regulären „blocked"-
 * Ergebnis (completeJob mit blockedReason) — der Client bekommt eine saubere,
 * renderbare Antwort, exakt wie im synchronen Pfad. Der Worker antwortet
 * immer mit 200; ein Job, der den Worker zum Absturz bringt, wird vom
 * Stale-Timeout in jobs.js aufgefangen.
 */

const { REQUEST_BUDGET_MS, isLocalQueueMode, localQueueConcurrency } = require("./config");
const { buildPrivacyRisks, extractVisibleText } = require("./privacy");
const { classifyDescription, buildAnimalProfiles } = require("./animal");
const { incrementTotals, releaseHourlySlot } = require("./counter");
const { getJob, claimJob, completeJob, isAbandoned, abandonJob, countProcessingJobs } = require("./jobs");
const { loadImage, deleteImage } = require("./queue-storage");
const { redispatchJobLocal } = require("./cloud-tasks");
const { isSingleLargeCallEnabled, isPromptCacheEnabled } = require("./feature-flags");

/* Mistral-Provider: im Mock-Modus die kostenlose Attrappe, sonst die echte
   API. Umschaltbar über die Umgebungsvariable MISTRAL_MOCK ("1" = Mock) —
   für Unit-Tests, Emulator-Durchklick und Mock-Lasttests. */
function getMistral() {
  return process.env.MISTRAL_MOCK === "1" ? require("./mistral-mock") : require("./mistral");
}

const hasCategories = (obj) => obj && obj.categories && Object.keys(obj.categories).length > 0;

function isQuotaError(err) {
  return !!(err && (err.code === "rate_limit" || /rate_limit|quota|429/i.test(err.message || "")));
}

/**
 * Führt die Mistral-Pipeline für einen Job aus.
 * @returns {Promise<{result: object, success: boolean}>}  result hat dieselbe
 *          Struktur wie die synchrone /analyze-Antwort; success=false bei einem
 *          blocked-Ergebnis.
 */
async function runPipeline(job) {
  const mistral = getMistral();
  const start = Date.now();
  const remainingBudget = () => Math.max(0, REQUEST_BUDGET_MS - (Date.now() - start));
  const lang = job.lang || "de";
  const exif = job.exif || {};

  const { buffer, mimeType } = await loadImage(job.imagePath);

  /* v2.2: Architektur-Branch über Feature-Flag.
       useSingleLargeCall=true  → 1× Large 2512 macht alles (Beschreibung + beide Profile).
       useSingleLargeCall=false → bewährte 3-Call-Pipeline (Describe Large + 2× Profile Small).
     Lokale Tests + Mocks bleiben auf 3-Call-Pipeline (siehe feature-flags.js
     isLocalQueueMode-Zweig + mistral-mock.js, das kein runSingleLargeCall hat). */
  const singleLargeCall = mistral.runSingleLargeCall ? await isSingleLargeCallEnabledSafe() : false;

  if (singleLargeCall) {
    return runPipelineSingleLarge({ mistral, buffer, mimeType, lang, exif, job, remainingBudget });
  }

  /* Stage 1: Bildbeschreibung */
  let description = null;
  let describeBlocked = false;
  let describeError = false;
  let quotaError = false;
  try {
    description = await mistral.describeImage(buffer, mimeType, remainingBudget, lang);
    if (!description) describeBlocked = true;
  } catch (err) {
    if (isQuotaError(err)) quotaError = true;
    describeError = true;
  }

  /* Stage 2: SUBJECT-Klassifikation + sichtbarer Text */
  const { subject, hasPerson, hasAnimal, animalType } = classifyDescription(description || "");
  const visibleText = extractVisibleText(description || "");
  const privacyRisks = buildPrivacyRisks({ visibleText, fullDescription: description || "" });

  /* Stage 3a: Tier-Easter-Egg-Pfad (nur Tier im Bild) */
  if (description && !hasPerson && hasAnimal) {
    const { normalProfile, boostProfile } = buildAnimalProfiles(animalType || "generic", lang);
    return {
      result: {
        profiles: { normal: normalProfile, boost: boostProfile },
        privacyRisks,
        exif,
        meta: { traceId: job.traceId || null, mode: "animal" },
      },
      success: true,
    };
  }

  /* Stage 3b: Profil-Generierung */
  let profiles = { normal: null, boost: null };
  let profileBlocked = false;
  if (description) {
    try {
      profiles = await mistral.generateBothProfiles(description, exif, remainingBudget, lang);
      profileBlocked = !profiles.normal && !profiles.boost;
    } catch (err) {
      if (isQuotaError(err)) quotaError = true;
      profileBlocked = true;
    }
  }

  const hasAnyProfile = hasCategories(profiles.normal) || hasCategories(profiles.boost);
  if (hasAnyProfile) {
    const n = profiles.normal || {};
    const b = profiles.boost || {};
    return {
      result: {
        profiles: {
          normal: {
            categories: n.categories || {},
            ad_targeting: n.ad_targeting || [],
            manipulation_triggers: n.manipulation_triggers || [],
            profileText: n.profileText || "",
          },
          boost: {
            categories: b.categories || {},
            ad_targeting: b.ad_targeting || [],
            manipulation_triggers: b.manipulation_triggers || [],
            profileText: b.profileText || "",
          },
        },
        privacyRisks,
        exif,
        meta: { traceId: job.traceId || null, mode: "multimodal", subject },
      },
      success: true,
    };
  }

  /* Blocked-Pfad — kein Profil zustande gekommen. Reason-Reihenfolge
     identisch zum synchronen /analyze-Pfad. */
  let blockedReason;
  if (quotaError) blockedReason = "blocked.overloaded";
  else if (describeBlocked) blockedReason = "blocked.safetyFilter";
  else if (describeError) blockedReason = "blocked.apiError";
  else if (profileBlocked) blockedReason = "blocked.profileBlocked";
  else if (!description) blockedReason = "blocked.noContent";
  else blockedReason = "blocked.generic";

  return {
    result: {
      profiles: null,
      blockedReason,
      privacyRisks,
      exif,
      meta: { traceId: job.traceId || null, mode: "blocked" },
    },
    success: false,
  };
}

/* v2.2: Single-Large-Call-Pipeline. Ersetzt Describe + 2× Profile durch
   einen einzigen Large-Aufruf, der das Bild ansieht und beide Profile in
   einer Antwort liefert. Tier-Easter-Egg und Privacy-Risks bleiben unmittelbar
   nutzbar; sie laufen heute über die Beschreibung — die liegt im Single-Call
   aber NICHT mehr als String vor, sondern verteilt im JSON. Wir rekonstruieren
   einen "kompakten Beschreibungs-Text" aus profileText, damit
   classifyDescription/extractVisibleText weiter funktionieren. Pragmatischer
   Workaround, bis der Tier-Pfad bei Bedarf nativ eingebaut wird. */
async function runPipelineSingleLarge({ mistral, buffer, mimeType, lang, exif, job, remainingBudget }) {
  let profiles = { normal: null, boost: null };
  let quotaError = false;
  let pipelineError = false;
  /* v2.5: Prompt-Cache-Flag. Reine Kostenmassnahme, ohne Einfluss auf Modell
     oder Ergebnis — abschaltbar in Firestore ohne Deploy (~30 s Cache). */
  const usePromptCache = await isPromptCacheEnabledSafe();
  try {
    profiles = await mistral.runSingleLargeCall(buffer, mimeType, remainingBudget, lang, {
      usePromptCache,
    });
  } catch (err) {
    if (isQuotaError(err)) quotaError = true;
    else pipelineError = true;
  }

  /* v2.2.x (Audit PRIV-002): Der Single-Large-Call liefert subject + visible_text
     jetzt direkt im JSON. Wir bauen daraus eine synthetische Beschreibung mit den
     Markern, die classifyDescription ("SUBJECT:") und extractVisibleText
     ("Sichtbarer Text:") erwarten — so funktionieren das Tier-Easter-Egg UND die
     Datenschutz-Warnung ("das hast du ungewollt verraten") im Single-Large-Pfad
     wieder. Fallback: fehlen die Felder (alter Prompt), bleibt es beim bisherigen
     Pseudo-Description-Verhalten (kein Regress). */
  const pseudoDescription = buildPseudoDescription(profiles.normal);
  const subjectLine = profiles.subject ? `SUBJECT: ${profiles.subject}\n` : "";
  const visibleLine = profiles.visibleText ? `\nSichtbarer Text: ${profiles.visibleText}` : "";
  const enrichedDescription = `${subjectLine}${pseudoDescription}${visibleLine}`;
  const { subject, hasPerson, hasAnimal, animalType } = classifyDescription(enrichedDescription);
  const visibleText = extractVisibleText(enrichedDescription);
  const privacyRisks = buildPrivacyRisks({ visibleText, fullDescription: enrichedDescription });

  /* Tier-Easter-Egg: Nur reines Tier-Bild → vordefinierte Profile. */
  if (enrichedDescription && !hasPerson && hasAnimal) {
    const { normalProfile, boostProfile } = buildAnimalProfiles(animalType || "generic", lang);
    return {
      result: {
        profiles: { normal: normalProfile, boost: boostProfile },
        privacyRisks,
        exif,
        meta: { traceId: job.traceId || null, mode: "animal", pipeline: "single-large" },
      },
      success: true,
    };
  }

  const hasAnyProfile = hasCategories(profiles.normal) || hasCategories(profiles.boost);
  if (hasAnyProfile) {
    const n = profiles.normal || {};
    const b = profiles.boost || {};
    return {
      result: {
        profiles: {
          normal: {
            categories: n.categories || {},
            ad_targeting: n.ad_targeting || [],
            manipulation_triggers: n.manipulation_triggers || [],
            profileText: n.profileText || "",
          },
          boost: {
            categories: b.categories || {},
            ad_targeting: b.ad_targeting || [],
            manipulation_triggers: b.manipulation_triggers || [],
            profileText: b.profileText || "",
          },
        },
        privacyRisks,
        exif,
        meta: { traceId: job.traceId || null, mode: "multimodal", subject, pipeline: "single-large" },
      },
      success: true,
    };
  }

  let blockedReason;
  if (quotaError) blockedReason = "blocked.overloaded";
  else if (pipelineError) blockedReason = "blocked.apiError";
  else blockedReason = "blocked.profileBlocked";

  return {
    result: {
      profiles: null,
      blockedReason,
      privacyRisks,
      exif,
      meta: { traceId: job.traceId || null, mode: "blocked", pipeline: "single-large" },
    },
    success: false,
  };
}

function buildPseudoDescription(normalProfile) {
  if (!normalProfile) return "";
  const parts = [normalProfile.profileText || ""];
  const cats = normalProfile.categories || {};
  for (const key of Object.keys(cats)) {
    if (cats[key] && cats[key].value) parts.push(cats[key].value);
  }
  return parts.filter(Boolean).join(" ").trim();
}

/* Fail-safe Flag-Lesen: jeder Fehler beim Firestore-Read → 3-Call-Pipeline.
   Vermeidet, dass ein vorübergehender Firestore-Fehler die ganze Pipeline
   blockiert. */
async function isSingleLargeCallEnabledSafe() {
  try {
    return await isSingleLargeCallEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "single-large-flag-read-error", error: err.message }));
    return false;
  }
}

/* Analog fail-safe: Kann das Prompt-Cache-Flag nicht gelesen werden, laeuft der
   Call ohne Cache-Key — also exakt wie vor v2.5. Ein Firestore-Wackler darf
   eine reine Kostenoptimierung niemals zum Ausfall eskalieren. */
async function isPromptCacheEnabledSafe() {
  try {
    return await isPromptCacheEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "prompt-cache-flag-read-error", error: err.message }));
    return false;
  }
}

async function handleProcessJob(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const jobId = req.body && req.body.jobId;
  if (!jobId || typeof jobId !== "string") {
    /* Kein gültiger Task-Body — bestätigen, damit Cloud Tasks nicht endlos
       einen kaputten Task wiederholt. */
    console.log(JSON.stringify({ step: "process-job", status: "missing-jobId" }));
    res.status(200).json({ ok: false, reason: "missing_jobId" });
    return;
  }

  const job = await getJob(jobId);
  if (!job) {
    console.log(JSON.stringify({ step: "process-job", jobId, status: "job-not-found" }));
    res.status(200).json({ ok: false, reason: "job_not_found" });
    return;
  }

  /* Liveness: Hat der Client die Seite verlassen, während der Job wartete?
     Dann gar nicht erst Mistral aufrufen — Job auf `abandoned` setzen, Bild
     löschen, fertig. Backstop für die Lücke, bis der Reaper den Job erwischt. */
  if (isAbandoned(job)) {
    const didAbandon = await abandonJob(jobId);
    if (!didAbandon) {
      /* Übergang verloren: Entweder hat der Reaper parallel abgeräumt (Bild
         dort gelöscht) oder ein zweiter Dispatch hat den Job geclaimt und
         braucht das Bild noch — in beiden Fällen gehört das Aufräumen ihm. */
      console.log(JSON.stringify({ step: "process-job", jobId, status: "abandon-raced" }));
      res.status(200).json({ ok: false, reason: "abandoned" });
      return;
    }
    /* BIZ-001: nur freigeben, wenn DIESER Aufruf den Job wirklich verlassen hat
       (sonst Doppel-Freigabe, falls der Reaper parallel war). */
    releaseHourlySlot().catch(() => {});
    await deleteImage(job.imagePath);
    console.log(JSON.stringify({ step: "process-job", jobId, status: "abandoned" }));
    res.status(200).json({ ok: false, reason: "abandoned" });
    return;
  }

  /* Lokal-Modus-Drosselung: Cloud Tasks gibt es im Emulator nicht. Sind schon
     genug Jobs in Verarbeitung, diesen Job vertagen — er bleibt `queued` und
     wird kurz darauf erneut angestoßen. So staut sich eine echte Warteschlange
     mit sichtbaren Positionen. In Produktion (kein QUEUE_LOCAL) ist dieser
     Block inaktiv — dort drosselt das echte Cloud Tasks. */
  if (isLocalQueueMode() && job.status === "queued") {
    const processing = await countProcessingJobs();
    if (processing >= localQueueConcurrency()) {
      redispatchJobLocal(jobId);
      console.log(JSON.stringify({ step: "process-job", jobId, status: "deferred", processing }));
      res.status(200).json({ ok: false, reason: "deferred" });
      return;
    }
  }

  /* Idempotenter Claim — verhindert Doppelverarbeitung bei Task-Wiederholung. */
  const claimed = await claimJob(jobId);
  if (!claimed) {
    console.log(JSON.stringify({ step: "process-job", jobId, status: "already-claimed", jobStatus: job.status }));
    res.status(200).json({ ok: false, reason: "already_claimed" });
    return;
  }

  const start = Date.now();
  try {
    const { result, success } = await runPipeline(job);
    await completeJob(jobId, result);
    if (success) {
      incrementTotals().catch((err) =>
        console.log(JSON.stringify({ warning: "incrementTotals-error", error: err.message }))
      );
    }
    console.log(
      JSON.stringify({
        step: "process-job",
        jobId,
        traceId: job.traceId || null,
        status: success ? "done" : "blocked",
        mode: result.meta.mode,
        /* Wartezeit in der Warteschlange: erstellt → Verarbeitungsbeginn.
           `start` wird unmittelbar nach dem erfolgreichen Claim gesetzt. */
        queueWaitMs: typeof job.createdAt === "number" ? start - job.createdAt : null,
        totalMs: Date.now() - start,
      })
    );
  } catch (err) {
    /* Unerwarteter Fehler → trotzdem ein sauberes, renderbares blocked-
       Ergebnis liefern (wie der synchrone Pfad). */
    console.log(
      JSON.stringify({
        step: "process-job",
        jobId,
        status: "error",
        error: err.message,
        totalMs: Date.now() - start,
      })
    );
    await completeJob(jobId, {
      profiles: null,
      blockedReason: "blocked.apiError",
      privacyRisks: [],
      exif: job.exif || {},
      meta: { traceId: job.traceId || null, mode: "blocked" },
    }).catch((e) => console.log(JSON.stringify({ warning: "completeJob-error", jobId, error: e.message })));
  } finally {
    /* Bild immer löschen — Erfolg ODER Fehler. Die Storage-Lifecycle-Regel
       ist das zweite Sicherheitsnetz. */
    await deleteImage(job.imagePath);
  }

  res.status(200).json({ ok: true });
}

module.exports = { handleProcessJob, runPipeline };
