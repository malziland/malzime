const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Wächter für scripts/verify-infrastructure.sh (Codex-Review 2026-08-12).
 *
 * Das Skript verspricht in seinem Kopf: AUSSCHLIESSLICH LESEND. Dieses
 * Versprechen ist sicherheitskritisch — es läuft vor jedem Deploy und mit
 * den vollen Rechten des angemeldeten gcloud-Kontos. Würde jemand später
 * ein `update`/`delete`/`set-iam-policy` hineinbauen, wäre aus dem Prüf-
 * ein Eingriffs-Skript geworden, ohne dass es jemandem auffällt.
 *
 * Darum erzwingt dieser Test statisch: Jede Zeile, die gcloud oder gsutil
 * aufruft, muss ein bekanntes Lese-Kommando sein. Kein Netzwerk, keine
 * Cloud-Aufrufe — reine Textanalyse plus Bash-Syntaxprüfung.
 */

const SCRIPT = path.join(__dirname, "../../../scripts/verify-infrastructure.sh");
const DEPLOY = path.join(__dirname, "../../../scripts/deploy.sh");

/* Lese-Kommandos, die das Prüfskript benutzen darf. Bewusst eng gefasst:
   Wer ein neues braucht, erweitert die Liste hier im selben Commit —
   dann sieht der Review die Erweiterung. */
const ERLAUBTE_LESE_MUSTER = [
  /gcloud (tasks queues|storage buckets|firestore databases|functions|run services|logging sinks) (describe|list|get-iam-policy)\b/,
  /gcloud auth list\b/,
  /command -v gcloud/,
  /* OPS-2026-08-12-09: Waechter ueber den Alarmweg. Beides reine list-Abfragen —
     `policies list` und `channels list` lesen nur, sie schalten nichts. */
  /gcloud alpha monitoring (policies|channels) list\b/,
];

function gcloudZeilen(inhalt) {
  /* Nur echte AUFRUFE zählen (Zeilenanfang, `$(...)` oder `command -v`) —
     nicht jede Erwähnung des Wortes in echo-Meldungen oder Strings. */
  const aufruf = /(^\s*|\$\(\s*|command -v )(gcloud|gsutil)\b/;
  return inhalt
    .split("\n")
    .map((zeile, i) => ({ zeile, nr: i + 1 }))
    .filter(({ zeile }) => {
      const ohneKommentar = zeile.replace(/^\s*#.*/, "");
      return aufruf.test(ohneKommentar);
    });
}

describe("verify-infrastructure.sh", () => {
  const inhalt = fs.readFileSync(SCRIPT, "utf8");

  test("existiert und ist ausführbar", () => {
    const stat = fs.statSync(SCRIPT);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  test("Bash-Syntax ist gültig (bash -n)", () => {
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: "pipe", timeout: 15000 })).not.toThrow();
  });

  test("jede gcloud-/gsutil-Zeile ist ein bekanntes LESE-Kommando", () => {
    const verstoesse = gcloudZeilen(inhalt).filter(
      ({ zeile }) => !ERLAUBTE_LESE_MUSTER.some((muster) => muster.test(zeile))
    );
    expect(verstoesse).toEqual([]);
  });

  test("enthält kein einziges bekanntes Schreib-Verb für gcloud/gsutil", () => {
    /* Doppelter Boden zur Allowlist oben: selbst wenn jemand die Allowlist
       aufweicht, schlagen bekannte Schreib-Verben hier separat an. */
    const schreibVerben =
      /\b(update|create|delete|deploy|patch|import|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|lifecycle set|iam ch|rm|cp|mv|rsync)\b/;
    for (const { zeile, nr } of gcloudZeilen(inhalt)) {
      expect({ nr, schreibt: schreibVerben.test(zeile) }).toEqual({ nr, schreibt: false });
    }
  });

  test("deploy.sh ruft die Infrastruktur-Prüfung mit SKIP_INFRA-Notschalter auf", () => {
    const deploy = fs.readFileSync(DEPLOY, "utf8");
    expect(deploy).toMatch(/SKIP_INFRA/);
    expect(deploy).toMatch(/verify-infrastructure\.sh/);
  });
});
