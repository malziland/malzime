"use strict";

/**
 * mistral.js — Mistral-Anbieter (einziger KI-Anbieter seit v1.6.0).
 *
 *   - describeImage(buffer, mimeType, remainingBudget, lang) → text | null
 *   - generateBothProfiles(description, exif, remainingBudget, lang) → { normal, boost }
 *
 * Architektur:
 *   - Describe: Mistral Large 3 (multimodal, sieht das Bild direkt)
 *   - Normal/Boost: Mistral Small 4 (text-only, schneller + billiger)
 *   - Fallback pro Profil: Large 3, falls Small 4 nicht parsebares JSON liefert
 *
 * API-Key kommt aus process.env.MISTRAL_API_KEY (Firebase Secret).
 */

const {
  MISTRAL_DESCRIBE_MODEL,
  MISTRAL_PROFILE_MODEL,
  MISTRAL_FALLBACK_MODEL,
  MISTRAL_ENDPOINT,
  MISTRAL_DESCRIBE_MAX_TOKENS,
  MISTRAL_PROFILE_MAX_TOKENS,
  MISTRAL_TIMEOUT_MS,
} = require("./config");
const { loadPrompts } = require("./i18n");
const { parseSafely } = require("./json-repair");
const { withMistralSlot } = require("./throttle");

/* Wird beim Modul-Load via env-Variable gelesen. NICHT hartcodiert. */
function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    const e = new Error("MISTRAL_API_KEY environment variable not set");
    e.code = "no_api_key";
    throw e;
  }
  return key;
}

/* Für Tests: erlaubt fetch zu mocken ohne globalThis zu überschreiben. */
let fetchImpl = (...args) => fetch(...args);
function setFetchForTest(impl) {
  fetchImpl = impl || ((...args) => fetch(...args));
}

/* ── Rate-Limit-Detection (für Telemetrie + Fallback-Entscheidung) ── */

function isRateLimitError(err) {
  /* v1.10.6: Throttle-Queue-Timeout wird auch als Rate-Limit-Signal behandelt.
     Wenn unsere eigene Drossel in throttle.js auflaeuft, ist Mistral aus
     Pipeline-Sicht ueberlastet — Caller (handle-analyze) soll das als
     blocked.overloaded melden, damit der Client den Auto-Retry triggert. */
  if (err && err.code === "throttle_timeout") return true;
  const msg = (err.message || "").toLowerCase();
  return err.status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limited");
}

/* ── Low-Level: HTTP-Call mit Timeout + Retry bei 429 ── */

/* REL-01: Jeder Mistral-HTTP-Call läuft durch die Per-Instance-Semaphore aus
   throttle.js. Damit kann eine einzelne Cloud-Function-Instanz bei einem
   Workshop-Burst (viele gleichzeitige Uploads, je 3 Mistral-Calls) nicht mehr
   beliebig viele Requests gleichzeitig gegen Mistrals RPS-Limit feuern —
   überzählige Calls warten geordnet auf einen freien Slot, statt sofort 429 zu
   kassieren. Der Slot wird über die kompletten 429-Retry-Backoffs gehalten,
   was den Burst zusätzlich entzerrt.

   v1.10.8: modelClass ("large"/"small") wird an withMistralSlot durchgereicht,
   damit der modell-bewusste Token-Bucket den richtigen Rate-Bucket waehlt —
   Large darf schneller feuern (6 RPS) als Small (1.67 RPS). */
function modelClassOf(model) {
  return /large/i.test(model || "") ? "large" : "small";
}

async function callMistralRaw(options) {
  /* waitMs misst, wie lange der Call auf einen freien Semaphore-Slot UND einen
     Token-Bucket-Tick gewartet hat — der reine Drossel-Anteil an der Wartezeit.
     httpMs (in callMistralRawUnthrottled gemessen) ist davon getrennt der reine
     Mistral-Roundtrip. Beide zusammen erlauben nach einem Workshop die Frage zu
     beantworten: bremst Mistral oder bremsen wir? */
  const t0 = Date.now();
  let waitMs = 0;
  const result = await withMistralSlot(() => {
    waitMs = Date.now() - t0;
    return callMistralRawUnthrottled(options);
  }, modelClassOf(options.model));
  return { ...result, waitMs };
}

async function callMistralRawUnthrottled({ model, messages, maxTokens, temperature, forceJSON, timeoutMs }) {
  const apiKey = getApiKey();

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (forceJSON) body.response_format = { type: "json_object" };

  /* v1.10.6: Von 2 auf 1 Retry reduziert. Hintergrund: Bei Workshop-Bursts
     hat die alte 2-Retry-Strategie den 429-Stau verstaerkt — drei Wellen
     gegen dasselbe Rate-Limit. Jetzt 1 Retry mit 2s Wartezeit; bleibt es
     dabei, wird die Anfrage als Ueberlast nach oben propagiert und der
     Client kann via Auto-Retry sauber zurueckkommen. */
  const backoffs = [2000];
  let lastError;

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const controller = new AbortController();
    /* v1.10.6 Fix: Cap bei MISTRAL_TIMEOUT_MS (90s). Verhindert, dass ein
       grosses REQUEST_BUDGET_MS (480s) den Timeout fuer Einzel-Calls mit
       hochzieht. Das Outer-Budget gilt fuer die GESAMTE Pipeline, nicht fuer
       Einzelaufrufe. Ein einzelner haengender Mistral-Call soll nach 90s
       abbrechen, damit der Client-seitige Auto-Retry greift, statt 8 Minuten
       Spinner zu zeigen. */
    const effectiveTimeout = Math.min(timeoutMs || MISTRAL_TIMEOUT_MS, MISTRAL_TIMEOUT_MS);
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    const httpStart = Date.now();
    let res;
    try {
      res = await fetchImpl(MISTRAL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const e = new Error(`Mistral request timeout after ${effectiveTimeout}ms`);
        e.code = "timeout";
        throw e;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (res.status === 429 && attempt < backoffs.length) {
      lastError = new Error("Mistral 429 rate limited");
      lastError.status = 429;
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
      continue;
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch (_) {
        /* ignore */
      }
      const e = new Error(`Mistral HTTP ${res.status}: ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`);
      e.status = res.status;
      throw e;
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    let text = "";
    const msgContent = choice?.message?.content;
    if (typeof msgContent === "string") {
      text = msgContent;
    } else if (Array.isArray(msgContent)) {
      text = msgContent
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
    const usage = json.usage || {};
    return {
      text: text.trim(),
      finishReason: choice?.finish_reason || "unknown",
      promptTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      httpMs: Date.now() - httpStart,
    };
  }

  /* Wenn wir hier landen, sind alle Retry-Versuche fehlgeschlagen mit 429 */
  throw lastError || new Error("Mistral request failed");
}

/* ── Public: describeImage (multimodal via Large 3) ──────────────── */

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
      maxTokens: MISTRAL_DESCRIBE_MAX_TOKENS,
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

/* ── Footer-Parser (v2.1) ──
   Extrahiert die strukturierten Anker-Blöcke (HARD_FACTS, ADS, TRIGGERS) am Ende
   der Bildbeschreibung. Diese werden vom Describe-Prompt (mistralDescribeAddendum)
   eingeleitet und liefern beide Profile-Calls einen konsistenten Anker:
     - alter_geschlecht + herkunft werden wortgenau übernommen → Normal/Beast-Konsistenz
     - ads + triggers werden zentral am Job-Result gesetzt → identisch in beiden Modi

   Fallback-Verhalten: Wenn ein Block fehlt oder kaputt ist, gibt der Parser leere
   Defaults zurück — handle-process-job.js entscheidet dann, ob die Profile-Calls
   diese Felder ersatzweise selbst füllen müssen (alter Verhalten). */
function parseDescribeFooter(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { description: "", hardFacts: {}, ads: [], triggers: [] };
  }

  /* Wir splitten den Text in Description + Footer. Marker ist das erste
     Auftreten von "HARD_FACTS:" am Zeilenanfang (case-sensitive — Mistral hält
     sich an den exakten Marker). */
  const hardFactsIdx = text.search(/(^|\n)HARD_FACTS:/);
  if (hardFactsIdx < 0) {
    /* Kein Footer gefunden — alter Live-Stil oder Mistral hat sich nicht ans
       Format gehalten. Beschreibung bleibt der ganze Text, Anker leer. */
    return { description: text.trim(), hardFacts: {}, ads: [], triggers: [] };
  }

  const description = text.slice(0, hardFactsIdx).trim();
  const footer = text.slice(hardFactsIdx);

  /* Hard-Facts-Block parsen — nur die zwei fixierten Felder. */
  const hardFacts = {};
  const hfBlock = (footer.match(/HARD_FACTS:\s*([\s\S]*?)(?:\n\s*(?:ADS:|TRIGGERS:)|$)/) || ["", ""])[1];
  for (const line of hfBlock.split(/\n/)) {
    const m = line.match(/^\s*(alter_geschlecht|herkunft)\s*:\s*(.+?)\s*$/i);
    if (m) hardFacts[m[1].toLowerCase()] = m[2].trim();
  }

  /* ADS-Block: jede nicht-leere Zeile nach "ADS:" bis vor "TRIGGERS:" ist ein Eintrag. */
  const ads = [];
  const adsBlock = (footer.match(/ADS:\s*([\s\S]*?)(?:\n\s*TRIGGERS:|$)/) || ["", ""])[1];
  for (const raw of adsBlock.split(/\n/)) {
    const v = raw.trim();
    if (v && !v.startsWith("<") && v.length <= 60) ads.push(v);
  }

  /* TRIGGERS-Block: jede nicht-leere Zeile nach "TRIGGERS:" bis Ende. */
  const triggers = [];
  const trBlock = (footer.match(/TRIGGERS:\s*([\s\S]*)$/) || ["", ""])[1];
  for (const raw of trBlock.split(/\n/)) {
    const v = raw.trim();
    if (v && !v.startsWith("<") && v.length <= 250) triggers.push(v);
  }

  return { description, hardFacts, ads: ads.slice(0, 12), triggers: triggers.slice(0, 8) };
}

/* ── Public: generateBothProfiles ────────────────────────────────── */

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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* v2.1: Vollständigkeits-Check. Mistral hat sich in Live-Tests trotz Schema-
   Pflicht "alle 13 Karten" gelegentlich entschieden, früh aufzuhören —
   `finishReason: "stop"`, aber categories enthielt nur 7 von 13. Wir prüfen
   das clientseitig und triggern einen Retry mit explizitem Hinweis auf die
   fehlenden Karten. */
const REQUIRED_CARDS = [
  "alter_geschlecht",
  "herkunft",
  "einkommen",
  "bildung",
  "beziehungsstatus",
  "interessen",
  "persoenlichkeit",
  "charakterzuege",
  "politisch",
  "gesundheit",
  "kaufkraft",
  "verletzlichkeit",
  "werbeprofil",
];

function findMissingCards(parsed) {
  if (!parsed || !parsed.categories || typeof parsed.categories !== "object") {
    return REQUIRED_CARDS.slice();
  }
  return REQUIRED_CARDS.filter((key) => !parsed.categories[key] || !parsed.categories[key].value);
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
      maxTokens: MISTRAL_PROFILE_MAX_TOKENS,
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
        stages.push(stage + (err ? `:${err.message.slice(0, 60)}` : ""));
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

/* ── v2.2: Single-Large-Call ──
   Macht in EINEM mistral-large-2512-Call:
     Bild sehen + Beschreibung + hard_facts + ads + triggers + Standard + Beast.
   Ersetzt die 3-Call-Pipeline (Describe + 2× Profile) durch einen Aufruf.
   Token-Einsparung in lokalen Tests (3 Bilder): ~70% (21.300 → ~5.700).
   Liefert dasselbe { normal, boost }-Shape wie generateBothProfiles —
   handle-process-job.js braucht nichts anzupassen außer dem Branch.
   Kosten-Hinweis: alle Tokens landen im teureren Large 2512 statt im billigen
   Small 2603 — Mehrkosten ~+6% gegenüber heutiger Pipeline (siehe CHANGELOG). */

const MISTRAL_SINGLE_LARGE_MAX_TOKENS = 8000;

async function runSingleLargeCall(imageBuffer, mimeType, remainingBudget, lang) {
  const prompts = loadPrompts(lang || "de");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompts.singleLargePrompt },
        { type: "image_url", image_url: dataUrl },
      ],
    },
  ];

  /* Erster Versuch */
  let parsed = await callSingleLarge(messages, remainingBudget, "first");
  let missing = parsed
    ? collectMissingForBothModes(parsed)
    : { standard: REQUIRED_CARDS.slice(), beast: REQUIRED_CARDS.slice() };

  /* Retry bei Unvollständigkeit — analog zu runProfile. Nur ein Retry. */
  const stillIncomplete = missing.standard.length > 0 || missing.beast.length > 0;
  if (stillIncomplete && parsed) {
    const hint =
      `\n\nHINWEIS: Im letzten Versuch hast du folgende Karten ausgelassen — bitte liefere ALLE 13 Karten in BEIDEN modes (standard + beast).` +
      (missing.standard.length > 0 ? `\nStandard fehlt: ${missing.standard.join(", ")}.` : "") +
      (missing.beast.length > 0 ? `\nBeast fehlt: ${missing.beast.join(", ")}.` : "");
    console.log(
      JSON.stringify({
        step: "mistral-single-large",
        status: "incomplete-retry",
        missingStandard: missing.standard,
        missingBeast: missing.beast,
      })
    );
    const retryMessages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompts.singleLargePrompt + hint },
          { type: "image_url", image_url: dataUrl },
        ],
      },
    ];
    try {
      const retryParsed = await callSingleLarge(retryMessages, remainingBudget, "retry");
      if (retryParsed) {
        /* Fehlende Karten aus Retry in Originalergebnis mergen (analog runProfile) */
        for (const mode of ["standard", "beast"]) {
          if (!parsed[mode]) parsed[mode] = retryParsed[mode];
          else if (retryParsed[mode]) {
            if (!parsed[mode].categories) parsed[mode].categories = {};
            const retryCats = retryParsed[mode].categories || {};
            for (const key of REQUIRED_CARDS) {
              if (!parsed[mode].categories[key] && retryCats[key]) {
                parsed[mode].categories[key] = retryCats[key];
              }
            }
            if (!parsed[mode].profileText && retryParsed[mode].profileText) {
              parsed[mode].profileText = retryParsed[mode].profileText;
            }
          }
        }
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          step: "mistral-single-large",
          status: "incomplete-retry-failed",
          error: err.message,
        })
      );
    }
  }

  if (!parsed) return { normal: null, boost: null };

  /* Hard-Facts server-seitig in beide Modi überschreiben — exakt wie in
     generateBothProfiles. Mistral kann die Vorgabe ignorieren; hier garantieren
     wir Konsistenz. */
  const hardFacts = parsed.hard_facts || {};
  const ads = Array.isArray(parsed.ad_targeting) ? parsed.ad_targeting : [];
  const triggers = Array.isArray(parsed.manipulation_triggers) ? parsed.manipulation_triggers : [];

  function buildProfile(modeKey) {
    const src = parsed[modeKey];
    if (!src || !src.categories) return null;
    if (hardFacts.alter_geschlecht && src.categories.alter_geschlecht) {
      src.categories.alter_geschlecht.value = hardFacts.alter_geschlecht;
    }
    if (hardFacts.herkunft && src.categories.herkunft) {
      src.categories.herkunft.value = hardFacts.herkunft;
    }
    return {
      categories: src.categories,
      profileText: src.profileText || "",
      ad_targeting: ads,
      manipulation_triggers: triggers,
    };
  }

  return {
    normal: buildProfile("standard"),
    boost: buildProfile("beast"),
  };
}

function collectMissingForBothModes(parsed) {
  return {
    standard: parsed.standard ? findMissingCards(parsed.standard) : REQUIRED_CARDS.slice(),
    beast: parsed.beast ? findMissingCards(parsed.beast) : REQUIRED_CARDS.slice(),
  };
}

async function callSingleLarge(messages, remainingBudget, attemptLabel) {
  try {
    const budget = remainingBudget ? remainingBudget() : undefined;
    const result = await callMistralRaw({
      model: MISTRAL_DESCRIBE_MODEL /* Large 2512 — multimodal, 2M TPM */,
      messages,
      maxTokens: MISTRAL_SINGLE_LARGE_MAX_TOKENS,
      temperature: 0.5 /* Kompromiss zwischen Standard (0.3) und Beast (0.8) */,
      forceJSON: true,
      timeoutMs: budget,
    });
    const stages = [];
    const parsed = parseSafely(result.text, {
      requireSchema: false /* unser Schema unterscheidet sich vom Live-Schema (categories sitzt unter standard/beast) */,
      onRepair: (stage, err) => stages.push(stage + (err ? `:${err.message.slice(0, 60)}` : "")),
    });
    console.log(
      JSON.stringify({
        step: "mistral-single-large",
        model: MISTRAL_DESCRIBE_MODEL,
        attempt: attemptLabel,
        status: parsed ? "ok" : "parse-failed",
        finishReason: result.finishReason,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        httpMs: result.httpMs,
        waitMs: result.waitMs,
        repairStages: stages,
      })
    );
    return parsed;
  } catch (err) {
    console.log(
      JSON.stringify({
        step: "mistral-single-large",
        attempt: attemptLabel,
        status: "error",
        error: err.message,
      })
    );
    if (isRateLimitError(err)) {
      const e = new Error("Mistral rate limit exceeded");
      e.code = "rate_limit";
      throw e;
    }
    throw err;
  }
}

module.exports = {
  describeImage,
  generateBothProfiles,
  runSingleLargeCall,
  isRateLimitError,
  /* Für Tests */
  setFetchForTest,
  _callMistralRaw: callMistralRaw,
};
