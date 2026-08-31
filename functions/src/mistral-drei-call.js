"use strict";

/**
 * mistral-drei-call.js — der Rueckfall-Weg mit drei Aufrufen.
 *
 * VIERTER SCHNITT aus mistral.js, 31.08.2026.
 *
 * WAS DAS IST: Der urspruengliche Weg, bevor es den Ein-Aufruf-Weg gab. Er
 * fragt die KI dreimal: Bild beschreiben, Normal-Profil, Beast-Profil. Heute
 * ist er der ROLLBACK — umstellbar ueber den Einstellungssatz `t1-drei-call`,
 * ohne Auslieferung.
 *
 * WARUM ER EINE EIGENE DATEI BEKOMMT: Er lag zwischen dem taeglich genutzten
 * Ein-Aufruf-Weg. Wer dort etwas aenderte, las staendig Code mit, der nur im
 * Notfall laeuft — und umgekehrt bestand die Gefahr, den Rueckfall beim
 * Aendern zu vergessen. Genau das ist am 30.08. passiert: Der Rollback-Pfad
 * lief nach einem Umbau in "timeoutCapMs fehlt".
 *
 * ACHTUNG BEI AENDERUNGEN: Dieser Weg macht DREI Mistral-Aufrufe je Analyse,
 * nicht zwei. Die Warteschlangen-Rate im Satz `t1-drei-call` ist deshalb
 * niedriger (0,083 statt 0,125). Wer hier etwas an der Aufrufzahl aendert,
 * muss sie mitziehen.
 */

const { MISTRAL_DESCRIBE_MODEL, MISTRAL_PROFILE_MODEL, MISTRAL_FALLBACK_MODEL } = require("./config");
const { loadPrompts } = require("./i18n");
const { parseSafely } = require("./json-repair");
const { betriebswerteOderAbbruch, callMistralRaw, isRateLimitError } = require("./mistral-http");
const { parseDescribeFooter, REQUIRED_CARDS, findMissingCards, escapeXml } = require("./mistral-antwort");

async function describeImage(imageBuffer, mimeType, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const addendum = prompts.mistralDescribeAddendum || "";

  let lastError = null;

  /* Versuch 1: regulärer Describe-Prompt */
  try {
    const result = await tryDescribeWithPrompt(
      prompts.describePrompt + addendum,
      imageBuffer,
      mimeType,
      remainingBudget
    );
    if (result && result.text) return result.text;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err; /* Rate-Limit sofort durchreichen */
    lastError = err;
  }

  /* Versuch 2: Fallback-Prompt (weniger triggerig) */
  try {
    const fallback = await tryDescribeWithPrompt(
      prompts.describeFallback + addendum,
      imageBuffer,
      mimeType,
      remainingBudget
    );
    if (fallback && fallback.text) return fallback.text;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    lastError = err;
  }

  /* Beide Versuche durch. Trat ein echter API-/Netzwerk-Fehler auf, werfen wir
     ihn (→ blocked.apiError im Caller). Liefen beide Versuche sauber durch, aber
     mit leerem Text, geben wir null zurück (→ blocked.safetyFilter). */
  if (lastError) throw lastError;
  return null;
}

async function tryDescribeWithPrompt(prompt, imageBuffer, mimeType, remainingBudget) {
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: dataUrl },
      ],
    },
  ];

  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL,
      messages,
      maxTokens: (await betriebswerteOderAbbruch()).werte.describeMaxTokens,
      /* v2.0.4: 0.2 → 0.1. Reduziert Run-to-Run-Schwankungen bei Alter/Geschlecht
         (Memory-Eintrag bestätigt Schwankungen als modellbedingt). Niedrigere
         Temperatur macht das Modell deterministischer ohne Token-Mehrkosten. */
      temperature: 0.1,
      forceJSON: false,
      timeoutMs: budget,
    });
    console.log(
      JSON.stringify({
        step: "mistral-describe",
        model: MISTRAL_DESCRIBE_MODEL,
        status: result.text ? "ok" : "empty",
        finishReason: result.finishReason,
        length: result.text.length,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
      })
    );
    return result;
  } catch (err) {
    console.log(
      JSON.stringify({ step: "mistral-describe", model: MISTRAL_DESCRIBE_MODEL, status: "error", error: err.message })
    );
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    /* Echte API-/Netzwerk-Fehler als api_error markiert weiterwerfen. describeImage
       sammelt den Fehler, versucht noch den Fallback-Prompt und propagiert ihn am
       Ende — damit der Caller blocked.apiError statt blocked.safetyFilter zeigt. */
    const e = new Error(`Mistral describe failed: ${err.message}`);
    e.code = "api_error";
    throw e;
  }
}

async function generateBothProfiles(imageDescription, exifData, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");

  /* v2.1: Footer aus der Beschreibung extrahieren — liefert die strukturierten
     Anker für Konsistenz zwischen Normal- und Beast-Modus. */
  const { description: cleanDescription, hardFacts, ads, triggers } = parseDescribeFooter(imageDescription);

  /* Mistral bekommt nur die (bereinigte) Beschreibung. EXIF-Kameradaten
     (make/model) bleiben sinnvoll und werden mitgegeben. */
  const { dateTimeOriginal: _dateTimeOriginal, ...exifWithoutDate } = exifData || {};
  const exifContext =
    Object.keys(exifWithoutDate).length > 0 ? `\n${prompts.labelExif}: ${JSON.stringify(exifWithoutDate)}` : "";

  const normalPrompt = buildProfilePrompt(
    prompts,
    prompts.systemNormal,
    cleanDescription,
    exifContext,
    prompts.jsonSchemaNormal,
    hardFacts
  );
  const boostPrompt = buildProfilePrompt(
    prompts,
    prompts.systemBoost,
    cleanDescription,
    exifContext,
    prompts.jsonSchemaBoost,
    hardFacts
  );

  const [normal, boost] = await Promise.all([
    runProfile(normalPrompt, 0.7, "normal", remainingBudget),
    /* v2.1 (2026-05-23 nachmittags): Beast-Temperatur 1.0 -> 0.8. Hintergrund:
       Beim ersten v2.1-Live-Test schrieb Beast trotz Längen-Vorgabe (20-30 Wörter)
       jede Karte mit 5-8 Sätzen und schnitt am max_tokens-Limit ab. Niedrigere
       Temperatur macht Mistral disziplinierter beim Schema-Einhalten, der zynische
       Beast-Ton kommt aus dem systemBoost-Prompt (nicht aus der Temperatur). */
    runProfile(boostPrompt, 0.8, "boost", remainingBudget),
  ]);

  /* Konsistenz-Anker durchsetzen: Profile-Calls könnten trotz Prompt-Pflicht
     die Hard-Facts ignorieren. Wir überschreiben alter_geschlecht/herkunft
     server-seitig, damit Normal und Beast garantiert dieselben Werte zeigen. */
  function enforceHardFacts(profile) {
    if (!profile || !profile.categories) return profile;
    if (hardFacts.alter_geschlecht && profile.categories.alter_geschlecht) {
      profile.categories.alter_geschlecht.value = hardFacts.alter_geschlecht;
    }
    if (hardFacts.herkunft && profile.categories.herkunft) {
      profile.categories.herkunft.value = hardFacts.herkunft;
    }
    return profile;
  }
  enforceHardFacts(normal);
  enforceHardFacts(boost);

  /* Marken und Triggers vom Large in BEIDE Modi schreiben — sie sind
     modus-übergreifend identisch. Profile-Calls liefern sie nicht mehr;
     wir setzen sie hier zentral. Falls der Footer leer war (alter Live-Stil
     oder Parse-Fehler), bleiben ad_targeting/manipulation_triggers, die das
     Profil eventuell trotzdem geliefert hat, als Fallback erhalten. */
  function applyTopLevelAdsTriggers(profile) {
    if (!profile) return profile;
    if (ads.length > 0) profile.ad_targeting = ads;
    if (triggers.length > 0) profile.manipulation_triggers = triggers;
    return profile;
  }
  applyTopLevelAdsTriggers(normal);
  applyTopLevelAdsTriggers(boost);

  return { normal, boost };
}

function buildProfilePrompt(prompts, systemContext, imageDescription, exifContext, schema, hardFacts) {
  const safeDesc = escapeXml(imageDescription || "");
  const safeExif = exifContext ? escapeXml(exifContext) : "";
  /* Hard-Facts werden zusätzlich als expliziter, gut sichtbarer Block oberhalb
     der Beschreibung eingefügt — Mistral folgt expliziten Anker-Blöcken besser
     als regex-eingebetteten Anweisungen im Schema. */
  const hardFactsBlock =
    hardFacts && (hardFacts.alter_geschlecht || hardFacts.herkunft)
      ? `\n<hard_facts_anker>\n${[
          hardFacts.alter_geschlecht ? `alter_geschlecht: ${escapeXml(hardFacts.alter_geschlecht)}` : "",
          hardFacts.herkunft ? `herkunft: ${escapeXml(hardFacts.herkunft)}` : "",
        ]
          .filter(Boolean)
          .join("\n")}\n</hard_facts_anker>\n`
      : "";
  return `${systemContext}${hardFactsBlock}
${prompts.injectionWarning}

<bildbeschreibung>
${safeDesc}
</bildbeschreibung>${safeExif ? `\n<exif_daten>${safeExif}</exif_daten>` : ""}

${prompts.workshopNote}
${schema}`;
}

async function runProfile(prompt, temperature, mode, remainingBudget) {
  const messages = [{ role: "user", content: prompt }];

  /* Versuch 1: Small 4 als Hybrid-Default. v1.10.6: rate_limit/throttle_timeout
     wird hochpropagiert, sonst probieren wir noch Large 3 als Fallback. */
  let small4Result = null;
  try {
    small4Result = await tryProfileCall({
      model: MISTRAL_PROFILE_MODEL,
      messages,
      temperature,
      mode,
      remainingBudget,
      isFallback: false,
    });
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    /* andere Fehler: weiter zum Fallback */
  }

  /* v2.1: Vollständigkeits-Check für den Small-4-Output. Wenn Karten fehlen,
     Retry mit explizitem Hinweis. NUR ein Retry — danach geht's mit dem
     unvollständigen Ergebnis weiter oder über den Large-Fallback. */
  if (small4Result) {
    const missing = findMissingCards(small4Result);
    if (missing.length === 0) return small4Result;
    if (missing.length < REQUIRED_CARDS.length) {
      console.log(
        JSON.stringify({
          step: `mistral-profile-${mode}`,
          status: "incomplete-retry",
          missingCards: missing,
          deliveredCards: REQUIRED_CARDS.length - missing.length,
        })
      );
      const retryPrompt = `${prompt}\n\nHINWEIS: Im letzten Versuch hast du folgende Karten ausgelassen: ${missing.join(", ")}. Liefere bitte ALLE 13 Karten im categories-Objekt — keine darf fehlen.`;
      try {
        const retryResult = await tryProfileCall({
          model: MISTRAL_PROFILE_MODEL,
          messages: [{ role: "user", content: retryPrompt }],
          temperature,
          mode,
          remainingBudget,
          isFallback: false,
        });
        /* Wenn Retry alle 13 hat → nehmen. Sonst: das vollständigere Ergebnis
           der beiden behalten (oder small4Result als Basis, mit den im Retry
           neu gelieferten Karten ergänzt). */
        if (retryResult) {
          const retryMissing = findMissingCards(retryResult);
          if (retryMissing.length < missing.length) {
            /* Retry war besser — mergen: small4Result als Basis,
               fehlende Karten aus Retry ergänzen. So gehen keine Werte
               verloren falls Mistral im Retry andere Karten ausgelassen hat. */
            if (!small4Result.categories) small4Result.categories = {};
            for (const key of REQUIRED_CARDS) {
              if (!small4Result.categories[key] && retryResult.categories && retryResult.categories[key]) {
                small4Result.categories[key] = retryResult.categories[key];
              }
            }
            /* profileText aus Retry übernehmen, falls Original-Versuch keinen hatte */
            if (!small4Result.profileText && retryResult.profileText) {
              small4Result.profileText = retryResult.profileText;
            }
          }
        }
      } catch (err) {
        /* Retry-Fehler nicht propagieren — wir haben ja schon small4Result */
        console.log(
          JSON.stringify({
            step: `mistral-profile-${mode}`,
            status: "incomplete-retry-failed",
            error: err.message,
          })
        );
      }
      return small4Result;
    }
  }

  /* Versuch 2: Large 3 als Fallback wenn Small 4 ausfällt. v1.10.6: bei
     rate_limit jetzt auch hier durchreichen statt schlucken. */
  try {
    const large3 = await tryProfileCall({
      model: MISTRAL_FALLBACK_MODEL,
      messages,
      temperature,
      mode,
      remainingBudget,
      isFallback: true,
    });
    return large3;
  } catch (err) {
    if (err && err.code === "rate_limit") throw err;
    return null;
  }
}

async function tryProfileCall({ model, messages, temperature, mode, remainingBudget, isFallback }) {
  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model,
      messages,
      maxTokens: (await betriebswerteOderAbbruch()).werte.profileMaxTokens,
      temperature,
      forceJSON: true,
      timeoutMs: budget,
    });

    if (!result.text) {
      console.log(
        JSON.stringify({ step: `mistral-profile-${mode}`, model, status: "empty", finishReason: result.finishReason })
      );
      return null;
    }

    const stages = [];
    const parsed = parseSafely(result.text, {
      onRepair: (stage, err) => {
        stages.push(stage + (err ? `:${err.name || "Error"}` : ""));
      },
    });

    if (!parsed) {
      console.log(
        JSON.stringify({
          step: `mistral-profile-${mode}`,
          model,
          status: "parse-failed",
          finishReason: result.finishReason,
          repairStages: stages,
        })
      );
      return null;
    }

    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "ok",
        finishReason: result.finishReason,
        isFallback,
        repairStages: stages,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
      })
    );
    return parsed;
  } catch (err) {
    console.log(
      JSON.stringify({
        step: `mistral-profile-${mode}`,
        model,
        status: "error",
        error: err.message,
        isFallback,
      })
    );
    /* v1.10.6: Rate-Limit/Throttle-Ueberlast nicht schlucken — sonst maskiert
       sich blocked.overloaded als generischer blocked.profileBlocked und der
       Client weiss nicht, dass ein Auto-Retry helfen wuerde. */
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    return null;
  }
}

module.exports = {
  describeImage,
  generateBothProfiles,
  _buildProfilePrompt: buildProfilePrompt,
};
