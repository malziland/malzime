#!/usr/bin/env node
/**
 * pruefe-abkuendigungen.mjs — liest die Hinweise, die GitHub an die letzten
 * Pipeline-Laeufe auf main heftet, und meldet Abkuendigungen und Fristen.
 *
 * WARUM (Befund OPS-2026-09-30-03, 30.09.2026): GitHub hat monatelang bei jedem
 * Lauf gewarnt, dass ein Baustein der Pipeline (setup-python v5) auf das
 * abgekuendigte Node 20 zielt, und am 23.09.2026 Node 20 entfernt. Ebenso steht
 * seit September bei jedem Lauf, dass "ubuntu-latest" ab 19.10.2026 auf
 * Ubuntu 26 umzieht. Solche Hinweise sieht nur, wer einen Lauf aufklappt — die
 * Laeufe waren gruen, niemand hatte einen Grund dazu.
 *
 * WAS GEMELDET WIRD: Jeder Hinweis (notice, warning oder failure) der jeweils
 * letzten abgeschlossenen Laeufe auf main, dessen Text nach Abkuendigung oder
 * Frist klingt. Andere Fehlermeldungen (rote Tests) sind nicht Sache dieses
 * Skripts — die meldet die Pipeline selbst.
 *
 * AUSWEG: .github/abkuendigungen-ausnahmen.json — Textmuster mit Begruendung
 * und Ablaufdatum, fuer Hinweise, bei denen bewusst nichts zu tun ist. Jede
 * Ausnahme wird bei jedem Lauf mit ausgegeben.
 *
 * Rueckgabewerte: 0 kein offener Hinweis, 1 offene(r) Hinweis(e),
 * 2 Messung nicht durchfuehrbar (kein Lauf gefunden, API-Fehler).
 *
 * Einspeisepunkte fuer Tests (im Betrieb nicht gesetzt):
 *   ABKUENDIGUNG_DATEN      JSON-Datei statt Netzabfrage:
 *                           [{ "lauf": "CI #123", "hinweise": [{ "annotation_level", "message" }] }]
 *   ABKUENDIGUNG_AUSNAHMEN  Ausnahmedatei
 *   ABKUENDIGUNG_HEUTE      Datum JJJJ-MM-TT statt der Systemuhr
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUSNAHMEN_DATEI = resolve(
  process.env.ABKUENDIGUNG_AUSNAHMEN || join(REPO, ".github/abkuendigungen-ausnahmen.json")
);
const HEUTE = process.env.ABKUENDIGUNG_HEUTE || new Date().toISOString().slice(0, 10);

/* Woran ein Abkuendigungs- oder Fristhinweis zu erkennen ist. Absichtlich
   breit: Ein Fehlalarm kostet einen Ausnahme-Eintrag, ein uebersehener
   Hinweis kostet im schlimmsten Fall eine stehende Pipeline. */
export const MUSTER =
  /deprecat|no longer (available|supported)|will (be )?(removed|retired|migrate|stop)|end[- ]of[- ]life|\bEOL\b|sunset|retire|is being removed|will be forced/i;

class Messfehler extends Error {}

/* Einspeisepunkt fuer Tests des ECHTEN Netzwegs (Befund H-12), wie in
   pruefe-fremd-meldungen.mjs: FETCH_ATTRAPPE nennt eine JSON-Datei
   { "<url>": { "status": 200, "body": ... } }. Unbekannte Adressen sind
   Netzfehler. */
if (process.env.FETCH_ATTRAPPE) {
  const karte = JSON.parse(readFileSync(process.env.FETCH_ATTRAPPE, "utf8"));
  globalThis.fetch = async (url) => {
    const eintrag = karte[String(url)];
    if (!eintrag) throw new Error(`Attrappe kennt ${url} nicht`);
    return { ok: (eintrag.status || 200) < 400, status: eintrag.status || 200, json: async () => eintrag.body };
  };
}

function repoName() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  let url;
  try {
    url = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch {
    throw new Messfehler("Repository nicht ermittelbar (weder GITHUB_REPOSITORY noch git remote origin)");
  }
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Messfehler(`Kein GitHub-Repository erkennbar: ${url}`);
  return m[1];
}

async function github(pfad) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const kopf = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) kopf.Authorization = `Bearer ${token}`;
  let antwort;
  try {
    antwort = await fetch(`https://api.github.com${pfad}`, { headers: kopf });
  } catch (fehler) {
    throw new Messfehler(`Netzfehler bei ${pfad}: ${fehler.message}`);
  }
  if (!antwort.ok) throw new Messfehler(`GitHub antwortete ${antwort.status} auf ${pfad}`);
  return antwort.json();
}

/* Je Workflow der letzte abgeschlossene Lauf auf main, mit allen Hinweisen
   aller seiner Jobs. Gefragt wird JEDER Workflow einzeln (Befund G-11): Die
   frueher genutzte Liste der 50 juengsten Laeufe enthielt nur die haeufigen
   Workflows, seltene (libheif-Bau) fielen heraus, ohne dass es jemand sah.
   Abgebrochene und uebersprungene Laeufe zaehlen nicht als "letzter Lauf". */
async function laeufeLesen() {
  if (process.env.ABKUENDIGUNG_DATEN) {
    try {
      return { laeufe: JSON.parse(readFileSync(process.env.ABKUENDIGUNG_DATEN, "utf8")), ungesehen: [] };
    } catch (fehler) {
      throw new Messfehler(`${process.env.ABKUENDIGUNG_DATEN} unlesbar: ${fehler.message}`);
    }
  }
  const repo = repoName();
  const workflows = await github(`/repos/${repo}/actions/workflows?per_page=100`);
  const letzte = [];
  const ungesehen = [];
  /* Welche Laeufe zaehlen (Befunde J-02, J-03, 30.09.2026):
     · nur Laeufe dieses Repositorys — `branch=main` liefert auch Laeufe aus
       Forks, deren Zweig zufaellig "main" heisst,
     · nicht uebersprungen, nicht abgebrochen, nicht "Freigabe noetig" (solche
       Laeufe haben keinen einzigen Job, also auch keine Hinweise).
     Geblaettert wird, bis ein zaehlender Lauf gefunden ist, hoechstens
     SEITEN_MAX Seiten: Dependabot Auto-Merge endet bei jedem Pull Request
     eines Menschen als "skipped" — im September lagen 40 solche Laeufe
     zwischen zwei echten. Ein kleines festes Fenster haette jede Nacht einen
     falschen Alarm ausgeloest. */
  const SEITEN_MAX = 5;
  const zaehlt = (l, aufMain) =>
    l.head_repository?.full_name === repo &&
    !["cancelled", "skipped", "action_required"].includes(l.conclusion) &&
    (!aufMain || l.event !== "pull_request");
  async function suche(abfrage, aufMain) {
    for (let seite = 1; seite <= SEITEN_MAX; seite++) {
      const antwort = await github(`${abfrage}&per_page=100&page=${seite}`);
      const liste = antwort.workflow_runs || [];
      const treffer = liste.find((l) => zaehlt(l, aufMain));
      if (treffer) return treffer;
      if (liste.length < 100) return null;
    }
    return null;
  }
  for (const wf of workflows.workflows || []) {
    if (wf.state !== "active") {
      console.log(`Nicht aktiv, uebergangen: ${wf.name} (${wf.state})`);
      continue;
    }
    const basis = `/repos/${repo}/actions/workflows/${wf.id}/runs?status=completed`;
    /* Zuerst main. Manche Workflows laufen nie auf main (Dependabot Auto-Merge
       nur im Pull Request) — dann gilt der juengste zaehlende Lauf auf
       irgendeinem Zweig dieses Repositorys (Befund H-12). */
    const lauf = (await suche(`${basis}&branch=main`, true)) || (await suche(basis, false));
    if (lauf) letzte.push(lauf);
    else ungesehen.push(wf.name);
  }
  const ergebnis = [];
  for (const lauf of letzte) {
    const jobs = await github(`/repos/${repo}/actions/runs/${lauf.id}/jobs?per_page=100`);
    const hinweise = [];
    for (const job of jobs.jobs || []) {
      const liste2 = await github(`/repos/${repo}/check-runs/${job.id}/annotations?per_page=100`);
      for (const h of liste2) hinweise.push({ ...h, job: job.name });
    }
    ergebnis.push({ lauf: `${lauf.name} #${lauf.run_number} (${lauf.head_sha.slice(0, 7)})`, hinweise });
  }
  return { laeufe: ergebnis, ungesehen };
}

function ausnahmenLesen() {
  if (!existsSync(AUSNAHMEN_DATEI)) return [];
  try {
    const daten = JSON.parse(readFileSync(AUSNAHMEN_DATEI, "utf8"));
    return Array.isArray(daten.ausnahmen) ? daten.ausnahmen : [];
  } catch (fehler) {
    throw new Messfehler(`${AUSNAHMEN_DATEI} unlesbar: ${fehler.message}`);
  }
}

/* Zwei Arten von Ausnahmen: "muster" (ein Hinweistext, bei dem bewusst nichts
   zu tun ist) und "ungesehen" (ein Workflow, der absichtlich nie laeuft —
   sonst waere "kein Lauf" ein Befund). Beide mit Begruendung und Ablaufdatum. */
const PFLICHTFELDER = ["grund", "eingetragen", "pruefen_bis"];
const art = (a) => (a.muster ? "muster" : a.ungesehen ? "ungesehen" : null);

/* Befund G-04 (30.09.2026): Ablaufdatum nur in der Form JJJJ-MM-TT, sonst
   liefe es im Zeichenkettenvergleich nie ab (vgl. OSS-2026-08-12-21). */
export function datumGueltig(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ""))) return false;
  const wert = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(wert.getTime()) && wert.toISOString().slice(0, 10) === text;
}

async function main() {
  const { laeufe, ungesehen } = await laeufeLesen();
  /* Kein einziger Lauf gelesen heisst nicht "keine Hinweise", sondern
     "nicht gemessen" (KERN 5c). */
  if (!Array.isArray(laeufe) || laeufe.length === 0) {
    throw new Messfehler("kein abgeschlossener Lauf auf main gefunden");
  }
  const ausnahmen = ausnahmenLesen();
  const befunde = [];
  const hinweise = [];
  const brauchbar = (a) => art(a) && PFLICHTFELDER.every((f) => a[f]) && datumGueltig(a.pruefen_bis);
  for (const a of ausnahmen) {
    const name = a.muster || a.ungesehen || "?";
    const fehlt = PFLICHTFELDER.filter((f) => !a[f]);
    if (!art(a)) befunde.push(`AUSNAHME UNGUELTIG  "${name}": weder "muster" noch "ungesehen" angegeben`);
    else if (fehlt.length) befunde.push(`AUSNAHME UNGUELTIG  "${name}": es fehlt ${fehlt.join(", ")}`);
    else if (!datumGueltig(a.pruefen_bis)) {
      befunde.push(`AUSNAHME UNGUELTIG  "${name}": pruefen_bis "${a.pruefen_bis}" ist kein Datum der Form JJJJ-MM-TT`);
    }
  }
  const gesehen = new Set();
  let gelesen = 0;
  for (const { lauf, hinweise: liste } of laeufe) {
    for (const h of liste || []) {
      gelesen++;
      const text = String(h.message || "");
      if (!MUSTER.test(text)) continue;
      /* Derselbe Hinweis steht oft an jedem Job — einmal melden genuegt. */
      if (gesehen.has(text)) continue;
      gesehen.add(text);
      const ausnahme = ausnahmen.find(
        (a) => brauchbar(a) && art(a) === "muster" && text.includes(a.muster) && a.pruefen_bis >= HEUTE
      );
      const zeile = `${String(h.annotation_level || "?").toUpperCase()}  ${lauf}: ${text.slice(0, 300)}`;
      if (ausnahme) hinweise.push(`${zeile}\n      ausgenommen bis ${ausnahme.pruefen_bis}: ${ausnahme.grund}`);
      else befunde.push(zeile);
    }
  }
  console.log(`Gelesen: ${laeufe.length} Lauf/Laeufe auf main, ${gelesen} Hinweis(e), Stand ${HEUTE}`);
  /* Ein aktiver Workflow ohne einen einzigen abgeschlossenen Lauf wurde nicht
     geprueft — das ist kein "sauber" (KERN 5c). */
  for (const name of ungesehen) {
    const zeile = `UNGESEHEN  Workflow "${name}": kein zaehlender abgeschlossener Lauf — seine Hinweise wurden nicht gelesen`;
    const ausnahme = ausnahmen.find(
      (a) => brauchbar(a) && art(a) === "ungesehen" && a.ungesehen === name && a.pruefen_bis >= HEUTE
    );
    if (ausnahme) hinweise.push(`${zeile}\n      ausgenommen bis ${ausnahme.pruefen_bis}: ${ausnahme.grund}`);
    else befunde.push(zeile);
  }
  for (const h of hinweise) console.log(`  [Ausnahme] ${h}`);
  if (befunde.length === 0) {
    console.log("ERGEBNIS: kein offener Abkuendigungs- oder Fristhinweis.");
    return 0;
  }
  console.log("");
  for (const b of befunde) console.log(`  ${b}`);
  console.log(
    `\nERGEBNIS: ${befunde.length} offene(r) Hinweis(e). Betroffenen Baustein anheben; nur wenn ` +
      "bewusst nichts zu tun ist, begruendeten Eintrag mit Ablaufdatum in " +
      ".github/abkuendigungen-ausnahmen.json."
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (fehler) => {
      if (fehler instanceof Messfehler) {
        console.error(`MESSUNG NICHT DURCHFUEHRBAR: ${fehler.message}`);
        console.error("Das ist kein bestandener Lauf.");
      } else {
        console.error(fehler);
      }
      process.exit(2);
    }
  );
}
