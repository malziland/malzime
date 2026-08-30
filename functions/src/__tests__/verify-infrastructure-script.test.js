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
  /* OPS-2026-08-13-33: die zwei Netze unter der Loeschzusage. `ttls list` und
     `scheduler jobs describe` lesen nur. */
  /gcloud firestore fields ttls list\b/,
  /gcloud scheduler jobs describe\b/,
  /* SEC-2026-08-30-13: Waechter ueber die Firestore-Sicherheitsregeln. Der
     gesamte Firestore-Umbau setzt voraus, dass niemand von aussen an
     `config/betriebsprofil` kommt — diese Voraussetzung war ungeprueft.
     `auth print-access-token` gibt nur ein Lese-Token aus und aendert nichts;
     die Regeln selbst werden ueber die REST-Schnittstelle GELESEN (curl ohne
     -X, also GET). */
  /gcloud auth print-access-token\b/,
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

  /* OPS-2026-08-13-40/41: Der Bucket-Riegel konnte vier Wochen lang nicht rot
     werden (PIPESTATUS[0]=printf statt [1]=python3), und niemand hätte es je
     bemerkt, weil dieser Riegel als einziger keine Negativprobe hatte. Diese
     Tests treiben ihn über die Einspeisepunkte INFRA_PROBE_* rot und grün —
     ohne gcloud, ohne Netz. */
  describe("der Bucket-Riegel kann rot werden (OPS-40/41)", () => {
    const os = require("os");
    const { execFileSync } = require("child_process");
    let dir;
    const GUT_BUCKET =
      '{"location":"EUROPE-WEST1","softDeletePolicy":{"retentionDurationSeconds":"0"},"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}}';

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-infra-"));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    function lauf(bucketJson) {
      const bp = path.join(dir, "bucket.json");
      fs.writeFileSync(bp, bucketJson);
      /* Nur der Bucket-Abschnitt wird eingespeist; alle anderen Abschnitte
         fragen echtes gcloud. Ohne Anmeldung enden sie rot — deshalb prüfen
         wir hier NICHT den Gesamt-Exit, sondern die Bucket-Zeilen der Ausgabe. */
      try {
        return execFileSync("bash", [SCRIPT], {
          encoding: "utf8",
          env: { ...process.env, INFRA_PROBE_BUCKET: bp },
        });
      } catch (e) {
        return (e.stdout || "") + (e.stderr || "");
      }
    }

    test("kaputter Bucket (US, Soft-Delete an, kein Lifecycle) → drei ✗", () => {
      const aus = lauf(
        '{"location":"US-CENTRAL1","softDeletePolicy":{"retentionDurationSeconds":"604800"},"lifecycle":{"rule":[]}}'
      );
      expect(aus).toMatch(/Region: SOLL EUROPE-WEST1, IST US-CENTRAL1/);
      expect(aus).toMatch(/Soft-Delete: SOLL 0, IST 604800/);
      expect(aus).toMatch(/Lifecycle: keine Delete-Regel/);
    });

    test("guter Bucket → drei OK, keine Bucket-Abweichung", () => {
      const aus = lauf(GUT_BUCKET);
      expect(aus).toMatch(/Region: EUROPE-WEST1/);
      expect(aus).toMatch(/Soft-Delete: aus/);
      expect(aus).toMatch(/Lifecycle: Delete nach 1 Tag aktiv/);
      expect(aus).not.toMatch(/Region: SOLL EUROPE-WEST1, IST/);
    });
  });
});
