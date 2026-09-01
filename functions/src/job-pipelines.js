"use strict";

/**
 * job-pipelines.js — die beiden Wege, auf denen eine Analyse laeuft.
 *
 * HERAUSGELOEST AUS handle-process-job.js am 31.08.2026.
 *
 * ZWEI WEGE, EIN ZIEL:
 *   runPipelineSingleLarge  Der Normalfall seit v3. EIN Aufruf an die KI,
 *                           die Antwort kommt als Strom, der Text erscheint
 *                           waehrend des Schreibens.
 *   runPipeline             Der Rueckfall. DREI Aufrufe: beschreiben,
 *                           Normal-Profil, Beast-Profil. Er entscheidet auch,
 *                           welcher Weg genommen wird — steht das Merkmal
 *                           `useSingleLargeCall` auf an, reicht er sofort an
 *                           den anderen weiter.
 *
 * WARUM SIE HIER STEHEN UND NICHT BEI DER ANNAHME: `handleProcessJob` nimmt
 * den Auftrag an, prueft das Ticket, holt das Bild und schreibt das Ergebnis
 * weg. Das ist Ablaufsteuerung. Was DAZWISCHEN passiert — welche Aufrufe an
 * die KI gehen und was mit ihren Antworten geschieht — ist eine andere Frage
 * und aendert sich aus anderen Gruenden.
 */

const { buildPrivacyRisks, extractVisibleText } = require("./privacy");
const { applyMinorSafety } = require("./minor-safety");
const { classifyDescription, buildAnimalProfiles } = require("./animal");
const { setLiveText } = require("./jobs");
const { geltendeWerte } = require("./betriebsprofil");
const { loadImage } = require("./queue-storage");

/* Die kleinen Entscheidungen — alle drei Wege brauchen sie. */
const {
  isSingleLargeCallEnabledSafe,
  isBeastAdsCallEnabledSafe,
  isPromptCacheEnabledSafe,
  isLiveTextEnabledSafe,
  getMistral,
  isQuotaError,
  buildPseudoDescription,
  loggeMinorSafety,
  hasCategories,
} = require("./job-helfer");

/**
 * Führt die Mistral-Pipeline für einen Job aus.
 * @returns {Promise<{result: object, success: boolean}>}  result hat dieselbe
 *          Struktur wie die synchrone /analyze-Antwort; success=false bei einem
 *          blocked-Ergebnis.
 */
async function runPipeline(job) {
  const mistral = getMistral();
  const start = Date.now();
  const { werte, grund } = await geltendeWerte();
  if (!werte) {
    const fehler = new Error(`Betriebswerte fehlen: ${grund || "unbekannt"}`);
    fehler.code = "config_missing";
    throw fehler;
  }
  const budgetMs = werte.requestBudgetMs;
  /* Das Zeitbudget kommt aus dem Einstellungssatz. Frueher stand hier der
     Code-Wert — wer das Budget umstellte, aenderte damit NICHT, wie lange
     dieser Lauf sich tatsaechlich Zeit liess. */
  const remainingBudget = () => Math.max(0, budgetMs - (Date.now() - start));
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
  /* Fehlender oder ungueltiger Einstellungssatz — unser Fehler, nicht der des
     Nutzers, und er besteht fort, bis ihn jemand behebt. */
  let configMissing = false;
  try {
    description = await mistral.describeImage(buffer, mimeType, remainingBudget, lang);
    if (!description) describeBlocked = true;
  } catch (err) {
    if (err && err.code === "config_missing") configMissing = true;
    if (isQuotaError(err)) quotaError = true;
    describeError = true;
  }

  /* Stage 2: SUBJECT-Klassifikation + sichtbarer Text */
  const { subject, hasPerson, hasAnimal, animalType } = classifyDescription(description || "");
  const visibleText = extractVisibleText(description || "");
  const privacyRisks = buildPrivacyRisks({ visibleText, fullDescription: description || "" });

  /* Stage 3a: Tier-Easter-Egg-Pfad (nur Tier im Bild).
     Hier stand bis zum Audit 2026-08-10 zusaetzlich eine Widerspruchspruefung
     (`pruefeTierWiderspruch`). Sie ist entfernt — Begruendung in animal.js.
     Massgeblich ist wieder allein das `subject`-Feld des Modells. */
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
      /* BEFUND 01.09.2026 (Pruefrunde 8, G-1): Hier stand `!profiles.normal &&
         !profiles.boost` — eine Pruefung auf VORHANDENSEIN, waehrend zwoelf
         Zeilen tiefer `hasAnyProfile` auf KARTEN prueft. Ein Profil-Objekt
         ohne Karten galt damit als vorhanden, aber nicht als brauchbar: Der
         Lauf ging in den blocked-Zweig, `profileBlocked` blieb false, und das
         Kind bekam `blocked.generic` — "irgendein Fehler, versuch es nochmal".
         Versuchen hilft aber nicht, wenn die Antwort keine Karten enthaelt.
         Dieselbe Fehlerform wie die falsche Ueberlastungs-Meldung am Einlass
         (N-P2-2), nur eine Stufe spaeter.
         Beide Zeilen messen jetzt dasselbe.

         NEBENWIRKUNG, gemessen: Dadurch wird die Mutation `&&` -> `||` an
         dieser Zeile WIRKLICH aequivalent — `profileBlocked` wird nur noch
         gelesen, wenn keines der Profile Karten hat, und dann liefern beide
         Fassungen `true`. Vorher war sie es NICHT (die Divergenz zwischen
         Vorhandensein und Karten machte sie sichtbar); genau deshalb hatte
         die Mutationsprobe zu Recht angeschlagen. Die Mutationsprobe wird sie
         weiter als VERDACHT melden — das ist richtig so und kein Grund fuer
         eine Ausnahmeliste im Werkzeug: Ein Verdacht ist kein Befund, und der
         Unterschied steht in ihrer Ausgabe. */
      profileBlocked = !hasCategories(profiles.normal) && !hasCategories(profiles.boost);
    } catch (err) {
      if (err && err.code === "config_missing") configMissing = true;
      if (isQuotaError(err)) quotaError = true;
      profileBlocked = true;
    }
  }

  const hasAnyProfile = hasCategories(profiles.normal) || hasCategories(profiles.boost);
  if (hasAnyProfile) {
    /* v2.8: Beast-Werbung in einem zweiten, kleinen Aufruf ohne Bild erzeugen.
       Im gemeinsamen Aufruf klebt sie an der Produktwelt des Fotos statt an der
       Schwachstelle (gemessen ueber fuenf A/B-Runden). Faellt der Aufruf aus,
       bleibt die Liste aus dem Hauptaufruf stehen — die Analyse scheitert nie
       daran. */
    if (
      profiles.boost &&
      hasCategories(profiles.boost) &&
      typeof mistral.generateBeastAds === "function" &&
      (await isBeastAdsCallEnabledSafe())
    ) {
      try {
        const neueAds = await mistral.generateBeastAds(profiles.boost, profiles.normal?.ad_targeting, lang, {
          usePromptCache: await isPromptCacheEnabledSafe(),
        });
        if (neueAds) profiles.boost.ad_targeting = neueAds;
      } catch (err) {
        /* Nie die Analyse daran scheitern lassen — die Liste aus dem
           Hauptaufruf bleibt als Rueckfall stehen. */
        console.log(JSON.stringify({ step: "beast-ads-skip", error: err.message }));
      }
    }

    /* Serverseitiges Netz, bevor irgendetwas ausgeliefert wird: Pornografie,
       Waffen und Extremismus fliegen immer raus, Gluecksspiel/Kredit/Alkohol
       zusaetzlich bei erkennbar Minderjaehrigen. Ein Modell KANN die
       Prompt-Regel ignorieren — im Modellvergleich ist genau das passiert. */
    const safety = applyMinorSafety(profiles, { lang, alterText: profiles.alterAnker || undefined });
    loggeMinorSafety(safety, job.traceId, lang);
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

  /* Blocked-Pfad — kein Profil zustande gekommen. */
  let blockedReason;
  /* Konfigurationsfehler zuerst: Er sieht aus wie ein Serverfehler, ist aber
     einer, den NUR wir beheben koennen — und er dauert an, bis das jemand tut.
     Wer das nicht unterscheidet, schickt Nutzer in ein sinnloses "gleich
     nochmal versuchen". */
  if (configMissing) blockedReason = "blocked.configMissing";
  else if (quotaError) blockedReason = "blocked.overloaded";
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

async function runPipelineSingleLarge({ mistral, buffer, mimeType, lang, exif, job, remainingBudget }) {
  let profiles = { normal: null, boost: null };
  let quotaError = false;
  /* Fehlender oder ungueltiger Einstellungssatz — unser Fehler, nicht der des
     Nutzers, und er besteht fort, bis ihn jemand behebt. */
  let configMissing = false;
  let pipelineError = false;
  /* v2.5: Prompt-Cache-Flag. Reine Kostenmassnahme, ohne Einfluss auf Modell
     oder Ergebnis — abschaltbar in Firestore ohne Deploy (~30 s Cache). */
  const usePromptCache = await isPromptCacheEnabledSafe();

  /* v3.0 Phase 1 (+Phase 3): Live-Text-Strom. Mit Flag bekommt der
     Mistral-Aufruf einen Callback, der die bereits angekommenen Profiltexte
     ({ standard, beast }) ins Job-Dokument legt — der pollende Client sieht
     dann schon Text, waehrend das Modell noch schreibt. OHNE Flag wird die
     Option gar nicht erst angelegt: Die opts sind dann exakt die heutigen,
     mistral.js setzt kein `stream: true`, nichts am Live-Verhalten aendert
     sich. */
  const liveTextAktiv = await isLiveTextEnabledSafe();
  const opts = { usePromptCache };
  if (liveTextAktiv) {
    /* Zusaetzliche Drossel VOR dem Firestore-Schreiben: mistral.js ruft den
       Callback zwar selbst nur ~alle 2 s, aber dieser Riegel gehoert dem
       Schreiber — er schuetzt das Job-Dokument auch dann noch, wenn sich die
       Aufruf-Frequenz in mistral.js einmal aendert. EIN Schreibvorgang
       traegt beide Felder (Standard + Beast, jobs.js). setLiveText selbst
       schluckt jeden Firestore-Fehler. */
    let letzterSchreibMs = 0;
    opts.onLiveText = (texte) => {
      const jetzt = Date.now();
      if (jetzt - letzterSchreibMs < 2000) return;
      letzterSchreibMs = jetzt;
      setLiveText(job.id, texte);
    };
  }
  try {
    profiles = await mistral.runSingleLargeCall(buffer, mimeType, remainingBudget, lang, opts);
  } catch (err) {
    if (err && err.code === "config_missing") configMissing = true;
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

  /* Tier-Easter-Egg: Nur reines Tier-Bild → vordefinierte Profile.
     Die frueher hier stehende Widerspruchspruefung ist mit dem Audit
     2026-08-10 entfernt — sie pruefte in diesem Pfad nicht die Bild-
     beschreibung, sondern den erzeugten Profiltext (siehe animal.js). */
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
    /* v2.8: Beast-Werbung in einem zweiten, kleinen Aufruf ohne Bild erzeugen.
       Im gemeinsamen Aufruf klebt sie an der Produktwelt des Fotos statt an der
       Schwachstelle (gemessen ueber fuenf A/B-Runden). Faellt der Aufruf aus,
       bleibt die Liste aus dem Hauptaufruf stehen — die Analyse scheitert nie
       daran. */
    if (
      profiles.boost &&
      hasCategories(profiles.boost) &&
      typeof mistral.generateBeastAds === "function" &&
      (await isBeastAdsCallEnabledSafe())
    ) {
      try {
        const neueAds = await mistral.generateBeastAds(profiles.boost, profiles.normal?.ad_targeting, lang, {
          usePromptCache: await isPromptCacheEnabledSafe(),
        });
        if (neueAds) profiles.boost.ad_targeting = neueAds;
      } catch (err) {
        /* Nie die Analyse daran scheitern lassen — die Liste aus dem
           Hauptaufruf bleibt als Rueckfall stehen. */
        console.log(JSON.stringify({ step: "beast-ads-skip", error: err.message }));
      }
    }

    /* Serverseitiges Netz, bevor irgendetwas ausgeliefert wird: Pornografie,
       Waffen und Extremismus fliegen immer raus, Gluecksspiel/Kredit/Alkohol
       zusaetzlich bei erkennbar Minderjaehrigen. Ein Modell KANN die
       Prompt-Regel ignorieren — im Modellvergleich ist genau das passiert. */
    const safety = applyMinorSafety(profiles, { lang, alterText: profiles.alterAnker || undefined });
    loggeMinorSafety(safety, job.traceId, lang);
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
  /* Konfigurationsfehler zuerst: Er sieht aus wie ein Serverfehler, ist aber
     einer, den NUR wir beheben koennen — und er dauert an, bis das jemand tut.
     Wer das nicht unterscheidet, schickt Nutzer in ein sinnloses "gleich
     nochmal versuchen". */
  if (configMissing) blockedReason = "blocked.configMissing";
  else if (quotaError) blockedReason = "blocked.overloaded";
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

module.exports = { runPipeline, runPipelineSingleLarge };
