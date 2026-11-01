"use strict";

/**
 * job-pipelines.js — der Weg, auf dem eine Analyse laeuft.
 *
 * HERAUSGELOEST AUS handle-process-job.js am 31.08.2026.
 *
 * EIN WEG: Ein Aufruf an die KI liefert Bildbeschreibung und beide Profile.
 * Die Antwort kommt als Strom, der Text erscheint waehrend des Schreibens.
 * Danach erzeugt ein zweiter, kleiner Aufruf ohne Bild die Beast-Werbung.
 *
 * AUSGEBAUT 10.09.2026: Hier stand zusaetzlich der aeltere Drei-Aufruf-Weg
 * (beschreiben, Normal-Profil, Beast-Profil), umschaltbar ueber das Merkmal
 * `useSingleLargeCall`. Er lief nur noch als Rueckfall und konnte von selbst
 * anspringen, sobald das Merkmal nicht lesbar war. Ein zweiter Weg, der
 * anders arbeitet als der beschriebene, ist keine Absicherung, sondern eine
 * zweite Wahrheit.
 *
 * WARUM ER HIER STEHT UND NICHT BEI DER ANNAHME: `handleProcessJob` nimmt
 * den Auftrag an, prueft das Ticket, holt das Bild und schreibt das Ergebnis
 * weg. Das ist Ablaufsteuerung. Was DAZWISCHEN passiert — welche Aufrufe an
 * die KI gehen und was mit ihren Antworten geschieht — ist eine andere Frage
 * und aendert sich aus anderen Gruenden.
 */

const { buildPrivacyRisks } = require("./privacy");
const { applyMinorSafety } = require("./minor-safety");
const { classifySubject, buildAnimalProfiles } = require("./animal");
const { setLiveText } = require("./jobs");
const { geltendeWerte } = require("./betriebsprofil");
const { loadImage } = require("./queue-storage");
const { istUeberlast } = require("./ueberlast");

/* Die kleinen Entscheidungen — ausgelagert, damit sie einzeln pruefbar sind. */
const {
  isBeastAdsCallEnabledSafe,
  getMistral,
  buildPseudoDescription,
  loggeMinorSafety,
  hasCategories,
} = require("./job-helfer");

/* Die Kennzahlen eines Laufs: Dauer der KI-Aufrufe (Uhrzeit, samt Warten auf
   einen Platz, Neuversuch, Nachfrage und Werbe-Aufruf), zusaetzliche Versuche
   und Textmenge fuer die dauerhaften Zaehler (statistik.js); seit 21.10.2026
   dazu das Ergebnis des Werbe-Aufrufs ("ok", "leer", "aussetzer", "fehler")
   fuer die Werbe-Wache (werbe-wache.js) — nur, wenn er lief. Keine Kennung,
   kein Inhalt. Sie reisen mit dem Ergebnis in den Auftrag (jobs.completeJob)
   und gehen mit ihm weg. */
function kennzahlenAus(messung, kiMs) {
  return {
    kiMs: Math.max(0, Math.round(kiMs)),
    kiWiederholungen: messung.zusatzversuche || 0,
    tokenEingabe: messung.tokenEingabe || 0,
    tokenZwischenspeicher: messung.tokenZwischenspeicher || 0,
    tokenAusgabe: messung.tokenAusgabe || 0,
    ...(typeof messung.lektor === "string" ? { lektor: messung.lektor } : {}),
    ...(typeof messung.werbeAufruf === "string" ? { werbeAufruf: messung.werbeAufruf } : {}),
  };
}

/**
 * Führt die Analyse für einen Job aus.
 * @returns {Promise<{result: object, success: boolean, kennzahlen: object}>}
 *          result hat dieselbe Struktur wie die synchrone /analyze-Antwort;
 *          success=false bei einem blocked-Ergebnis; kennzahlen siehe
 *          kennzahlenAus.
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

  let profiles = { normal: null, boost: null };
  let quotaError = false;
  /* Fehlender oder ungueltiger Einstellungssatz — unser Fehler, nicht der des
     Nutzers, und er besteht fort, bis ihn jemand behebt. */
  let configMissing = false;
  let pipelineError = false;
  let letzterVersuch = 1;
  const messung = {};
  let kiMs = 0;
  const opts = {
    messung,
    /* Seit dem Lektor (01.11.2026) geht kein Rohtext mehr hinaus: Er darf nicht
       vor seiner Bereinigung auf dem Bildschirm stehen, getippt wird der fertige
       Text (live-anzeige.js, schlusstext). Es bleibt die leere Welle eines neuen
       Versuchs nach einem Verbindungsabriss, sie setzt die Anzeige zurueck.
       setLiveText wirft nie. */
    onLiveText: (texte) => {
      const versuch = (texte && texte.versuch) || 1;
      if (versuch === letzterVersuch) return;
      letzterVersuch = versuch;
      setLiveText(job.id, { standard: "", beast: null, versuch });
    },
  };
  const kiStart = Date.now();
  try {
    profiles = await mistral.runSingleLargeCall(buffer, mimeType, remainingBudget, lang, opts);
  } catch (err) {
    if (err && err.code === "config_missing") configMissing = true;
    if (istUeberlast(err)) quotaError = true;
    else pipelineError = true;
  }
  kiMs += Date.now() - kiStart;

  /* Der Analyse-Aufruf liefert subject + visible_text als Felder im JSON. Beide
     werden als FELDER ausgewertet (BUG-2026-10-03-05): Das Motiv entscheidet
     sich am Wert von subject, die Datenschutz-Warnung ("das hast du ungewollt
     verraten") am Wert von visible_text. Der zusammengesetzte Text aus Profil
     und Karten dient nur der Auswahl der Tierart und der Kennzeichen-Suche —
     eine Zeile darin entscheidet nichts. Fehlen die Felder, gilt: Mensch,
     kein sichtbarer Text. */
  const pseudoDescription = buildPseudoDescription(profiles.normal);
  const visibleText = typeof profiles.visibleText === "string" ? profiles.visibleText.trim() : "";
  const beschreibung = [pseudoDescription, visibleText].filter(Boolean).join("\n");
  const { subject, hasPerson, hasAnimal, animalType } = classifySubject(profiles.subject, beschreibung);
  const privacyRisks = buildPrivacyRisks({ visibleText, fullDescription: pseudoDescription });

  /* Tier-Easter-Egg: Nur reines Tier-Bild → vordefinierte Profile.
     Die frueher hier stehende Widerspruchspruefung ist mit dem Audit
     2026-08-10 entfernt — sie pruefte nicht die Bildbeschreibung, sondern
     den erzeugten Profiltext (siehe animal.js). */
  if (!hasPerson && hasAnimal) {
    const { normalProfile, boostProfile } = buildAnimalProfiles(animalType || "generic", lang);
    return {
      result: {
        profiles: { normal: normalProfile, boost: boostProfile },
        privacyRisks,
        exif,
        meta: { mode: "animal" },
      },
      success: true,
      kennzahlen: kennzahlenAus(messung, kiMs),
    };
  }

  const hasAnyProfile = hasCategories(profiles.normal) || hasCategories(profiles.boost);
  if (hasAnyProfile) {
    /* v2.8: Beast-Werbung in einem zweiten, kleinen Aufruf ohne Bild erzeugen.
       Im gemeinsamen Aufruf klebt sie an der Produktwelt des Fotos statt an der
       Schwachstelle (gemessen ueber fuenf A/B-Runden). Faellt der Aufruf aus,
       bleibt die Liste aus dem Hauptaufruf stehen — die Analyse scheitert nie
       daran. */
    const werbeAufruf = async () => {
      if (
        !profiles.boost ||
        !hasCategories(profiles.boost) ||
        typeof mistral.generateBeastAds !== "function" ||
        !(await isBeastAdsCallEnabledSafe())
      ) {
        return;
      }
      try {
        const neueAds = await mistral.generateBeastAds(profiles.boost, profiles.normal?.ad_targeting, lang, messung, {
          alterText: profiles.alterAnker || undefined,
          alterUnlesbar: profiles.alterUnlesbar === true,
        });
        if (neueAds) profiles.boost.ad_targeting = neueAds;
      } catch (err) {
        /* Nie die Analyse daran scheitern lassen — die Liste aus dem
           Hauptaufruf bleibt als Rueckfall stehen. */
        console.log(JSON.stringify({ step: "beast-ads-skip", error: err.message }));
      }
    };
    /* Der Lektor laeuft gleichzeitig mit dem Werbe-Aufruf: So wartet niemand
       zweimal. Scheitert er, bleibt der Text der Analyse stehen. */
    const lektor = async () => {
      if (typeof mistral.textBereinigen !== "function" || !profiles.normal?.profileText) return;
      const neu = await mistral.textBereinigen(profiles.normal.profileText, lang, messung);
      if (neu) profiles.normal.profileText = neu;
    };
    const zweiterSchrittStart = Date.now();
    await Promise.all([werbeAufruf(), lektor()]);
    kiMs += Date.now() - zweiterSchrittStart;

    /* Serverseitiges Netz, bevor irgendetwas ausgeliefert wird: Pornografie,
       Waffen und Extremismus fliegen immer raus, Gluecksspiel/Kredit/Alkohol
       zusaetzlich bei moeglicherweise Minderjaehrigen (Schwelle mit Puffer,
       siehe minor-safety.js). Ein Modell KANN die Prompt-Regel ignorieren —
       im Modellvergleich ist genau das passiert. */
    const safety = applyMinorSafety(profiles, {
      lang,
      alterText: profiles.alterAnker || undefined,
      alterUnlesbar: profiles.alterUnlesbar === true,
    });
    loggeMinorSafety(safety, lang);
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
        /* alterUnlesbar (17.09.2026): Die Alterskarte zeigt dann einen festen
           Satz; der Realitaets-Check fragt das Alter nicht ab. Nur Ja/Nein. */
        meta: {
          mode: "multimodal",
          subject,
          alterUnlesbar: safety.alterUnlesbar === true,
        },
      },
      success: true,
      kennzahlen: kennzahlenAus(messung, kiMs),
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
      meta: { mode: "blocked" },
    },
    success: false,
    kennzahlen: kennzahlenAus(messung, kiMs),
  };
}

module.exports = { runPipeline };
