/* Nachfrage nach fehlenden Karten: was aus ihrer Antwort ins Ergebnis kommt
   (STRUCT-2026-10-03-55, kurzer Schritt).

   Fehlt in der ersten Antwort der KI eine der 13 Karten, fragt
   `runSingleLargeCall` EINMAL nach und mischt die zweite Antwort in die erste.
   Das Einmischen hat vier Wege — ein ganzer Modus fehlt, ein Modus hat keine
   Karten-Sammlung, einzelne Karten fehlen, der Profiltext fehlt —, und bis
   07.10.2026 betrat kein Test drei davon. Ein Fehler dort heißt: ein
   unvollständiges Profil im Unterricht, obwohl die KI nachgeliefert hat.

   Geprüft wird am Ergebnis, das der Aufrufer bekommt:
   - jeder der vier Wege trägt nach, was fehlte;
   - was die erste Antwort schon hatte, bleibt stehen (die Nachfrage füllt
     Lücken, sie ersetzt nichts);
   - liefert die Nachfrage nichts Verwertbares, bleibt es bei der ersten
     Antwort — ohne Wurf. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { runSingleLargeCall, setFetchForTest } = require("../mistral");
const { REQUIRED_CARDS } = require("../mistral-antwort");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const SCHLUESSEL_VORHER = process.env.MISTRAL_API_KEY;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (SCHLUESSEL_VORHER === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = SCHLUESSEL_VORHER;
  setFetchForTest(null);
  jest.restoreAllMocks();
});

afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

const karten = (herkunft) =>
  Object.fromEntries(REQUIRED_CARDS.map((k) => [k, { label: k, value: `${herkunft} ${k}`, confidence: 0.8 }]));

const antwort = (herkunft) => ({
  hard_facts: { alter_geschlecht: "männlich, ~38 (Spanne 35-42)", herkunft: "mitteleuropäisch" },
  ad_targeting: ["Bio-Kosmetik"],
  manipulation_triggers: ["Trigger A"],
  standard: { profileText: `${herkunft}: sachlich.`, categories: karten(`${herkunft}-Standard`) },
  beast: { profileText: `${herkunft}: zynisch.`, categories: karten(`${herkunft}-Beast`) },
});

/* Stellt die Antworten der KI der Reihe nach bereit und zählt die Aufrufe. */
function kiAntwortet(...inhalte) {
  const anfragen = [];
  setFetchForTest(async (_url, init) => {
    anfragen.push(JSON.parse(init.body));
    const inhalt = inhalte[Math.min(anfragen.length, inhalte.length) - 1];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt) }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 4000, completion_tokens: 2000 },
      }),
    };
  });
  return anfragen;
}

const analysiere = () => runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de");

test("eine vollständige erste Antwort löst keine Nachfrage aus (Erfolgsweg)", async () => {
  const anfragen = kiAntwortet(antwort("Erst"));
  const ergebnis = await analysiere();

  expect(anfragen).toHaveLength(1);
  expect(ergebnis.boost.categories.werbeprofil.value).toBe("Erst-Beast werbeprofil");
});

test("ein ganzer Modus fehlt: Er kommt aus der Nachfrage", async () => {
  const erste = antwort("Erst");
  delete erste.beast;
  const anfragen = kiAntwortet(erste, antwort("Nachfrage"));
  const ergebnis = await analysiere();

  expect(anfragen).toHaveLength(2);
  expect(ergebnis.boost).not.toBeNull();
  expect(ergebnis.boost.profileText).toBe("Nachfrage: zynisch.");
  expect(Object.keys(ergebnis.boost.categories).sort()).toEqual([...REQUIRED_CARDS].sort());
  expect(ergebnis.boost.categories.werbeprofil.value).toBe("Nachfrage-Beast werbeprofil");
  /* Der Modus, der schon da war, bleibt der der ersten Antwort. */
  expect(ergebnis.normal.profileText).toBe("Erst: sachlich.");
  expect(ergebnis.normal.categories.werbeprofil.value).toBe("Erst-Standard werbeprofil");
});

test("ein Modus ohne Karten-Sammlung: Die Karten kommen aus der Nachfrage, sein Profiltext bleibt", async () => {
  const erste = antwort("Erst");
  delete erste.beast.categories;
  kiAntwortet(erste, antwort("Nachfrage"));
  const ergebnis = await analysiere();

  expect(Object.keys(ergebnis.boost.categories).sort()).toEqual([...REQUIRED_CARDS].sort());
  expect(ergebnis.boost.categories.einkommen.value).toBe("Nachfrage-Beast einkommen");
  expect(ergebnis.boost.profileText).toBe("Erst: zynisch.");
});

test("einzelne Karten fehlen: Nur die Lücken werden gefüllt, vorhandene Karten bleiben", async () => {
  const erste = antwort("Erst");
  delete erste.standard.categories.werbeprofil;
  erste.standard.categories.kaufkraft = { label: "kaufkraft", value: "", confidence: 0.8 };
  kiAntwortet(erste, antwort("Nachfrage"));
  const ergebnis = await analysiere();

  expect(ergebnis.normal.categories.werbeprofil.value).toBe("Nachfrage-Standard werbeprofil");
  expect(ergebnis.normal.categories.einkommen.value).toBe("Erst-Standard einkommen");
  expect(ergebnis.normal.profileText).toBe("Erst: sachlich.");
  expect(ergebnis.boost.categories.werbeprofil.value).toBe("Erst-Beast werbeprofil");
});

test("der Profiltext fehlt: Er wird aus der Nachfrage nachgetragen", async () => {
  const erste = antwort("Erst");
  erste.beast.profileText = "";
  delete erste.beast.categories.verletzlichkeit;
  kiAntwortet(erste, antwort("Nachfrage"));
  const ergebnis = await analysiere();

  expect(ergebnis.boost.profileText).toBe("Nachfrage: zynisch.");
  expect(ergebnis.boost.categories.verletzlichkeit.value).toBe("Nachfrage-Beast verletzlichkeit");
  expect(ergebnis.boost.categories.bildung.value).toBe("Erst-Beast bildung");
});

test("nachgefragt wird höchstens einmal — auch wenn die Nachfrage wieder unvollständig ist", async () => {
  const erste = antwort("Erst");
  delete erste.standard.categories.werbeprofil;
  delete erste.standard.categories.gesundheit;
  const zweite = antwort("Nachfrage");
  delete zweite.standard.categories.gesundheit;
  const anfragen = kiAntwortet(erste, zweite, antwort("Dritte"));
  const ergebnis = await analysiere();

  expect(anfragen).toHaveLength(2);
  expect(ergebnis.normal.categories.werbeprofil.value).toBe("Nachfrage-Standard werbeprofil");
  expect(ergebnis.normal.categories.gesundheit).toBeUndefined();
});

test("die Nachfrage liefert nichts Verwertbares: Es bleibt bei der ersten Antwort, ohne Wurf", async () => {
  const erste = antwort("Erst");
  delete erste.beast.categories.werbeprofil;
  const anfragen = kiAntwortet(erste, "das ist keine Antwort in der verlangten Form");
  const ergebnis = await analysiere();

  expect(anfragen.length).toBeGreaterThanOrEqual(2);
  expect(ergebnis.boost.categories.einkommen.value).toBe("Erst-Beast einkommen");
  expect(ergebnis.boost.categories.werbeprofil).toBeUndefined();
  expect(ergebnis.normal.categories.werbeprofil.value).toBe("Erst-Standard werbeprofil");
});
