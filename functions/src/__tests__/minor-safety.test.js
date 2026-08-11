const {
  applyMinorSafety,
  _istImmerVerboten,
  _istBeiMinderjaehrigenVerboten,
  _untereAltersgrenze,
  _SCHUTZ_BIS,
} = require("../minor-safety");

function profil(alterText, ads, trigger = []) {
  return {
    normal: {
      categories: { alter_geschlecht: { value: alterText } },
      ad_targeting: [...ads],
      manipulation_triggers: [...trigger],
    },
    boost: {
      categories: { alter_geschlecht: { value: alterText } },
      ad_targeting: [...ads],
      manipulation_triggers: [...trigger],
    },
  };
}

describe("Untere Altersgrenze", () => {
  test("nimmt die Untergrenze der Spanne, nicht den Punktwert", () => {
    /* Kern der Änderung vom 2026-08-10: Für den Schutz zählt das jüngste
       Alter, das die Angabe zulässt — nicht der wahrscheinlichste Wert. */
    expect(_untereAltersgrenze("Du bist weiblich, ~14 Jahre alt (Spanne 12-16).")).toBe(12);
    expect(_untereAltersgrenze("Du bist männlich, etwa 38. Spanne 35-42.")).toBe(35);
  });
  test("versteht die verschiedenen Spannen-Schreibweisen", () => {
    expect(_untereAltersgrenze("weiblich, 16 bis 22")).toBe(16);
    expect(_untereAltersgrenze("weiblich, 16–22")).toBe(16);
    expect(_untereAltersgrenze("weiblich, 16-22")).toBe(16);
  });
  test("nimmt den Punktwert, wenn keine Spanne dasteht", () => {
    expect(_untereAltersgrenze("Du bist männlich, 40 Jahre alt.")).toBe(40);
    expect(_untereAltersgrenze("Männlich, ~38 — die Krähenfüße verraten dich.")).toBe(38);
  });
  test("gibt null zurück, wenn kein Alter drinsteht", () => {
    expect(_untereAltersgrenze("Keine klaren Bildsignale.")).toBeNull();
    expect(_untereAltersgrenze("")).toBeNull();
  });
});

describe("Untergrenze der Spanne entscheidet (vereinbarte Regel, 2026-08-11)", () => {
  /* Die Regel samt beiden Beispielen stammt wörtlich aus der Entscheidung des
     Inhabers: Stufe 2 greift, wenn die Untergrenze 18 oder darunter ist. */
  const gluecksspiel = ["Bet365 Live-Wetten", "Nike Air Max"];

  test("Spanne 17-24, Schätzwert 21 — Filter greift (Beispiel aus der Entscheidung)", () => {
    const p = profil("weiblich, ~21 Jahre (Spanne 17-24).", gluecksspiel);
    const b = applyMinorSafety(p);
    expect(b.minderjaehrig).toBe(true);
    expect(p.normal.ad_targeting).toEqual(["Nike Air Max"]);
  });

  test("Spanne 19-21, Schätzwert 20 — Filter greift nicht (Beispiel aus der Entscheidung)", () => {
    const p = profil("weiblich, ~20 Jahre (Spanne 19-21).", gluecksspiel);
    const b = applyMinorSafety(p);
    expect(b.minderjaehrig).toBe(false);
    expect(p.normal.ad_targeting).toEqual(gluecksspiel);
  });

  test("eindeutig erwachsen — Glücksspiel bleibt als Lerninhalt stehen", () => {
    const p = profil("Du bist männlich, etwa 38. Spanne 35-42.", gluecksspiel);
    const b = applyMinorSafety(p);
    expect(b.minderjaehrig).toBe(false);
    expect(p.normal.ad_targeting).toEqual(gluecksspiel);
  });

  test("die Schwelle ist exakt „Untergrenze ≤ 18“", () => {
    /* Pinnt die vereinbarte Regel fest: Wer diesen Wert ändert, ändert die
       Entscheidung vom 2026-08-11 und muss das bewusst tun. */
    expect(_SCHUTZ_BIS).toBe(19);
  });
});

describe("Stufe 1 — immer verboten, unabhängig vom Alter", () => {
  test.each([
    ["OnlyFans Merch Drops"],
    ["Fansly Premium"],
    ["Escort Service Wien"],
    ["Glock 19 Zubehör"],
    ["Munition Großhandel"],
  ])("erkennt %s", (eintrag) => {
    expect(_istImmerVerboten(eintrag)).toBe(true);
  });

  test("greift auch bei Erwachsenen", () => {
    const p = profil("Du bist männlich, ~44 Jahre alt.", ["OnlyFans Merch", "Rolex Datejust"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Rolex Datejust"]);
    expect(p.boost.ad_targeting).toEqual(["Rolex Datejust"]);
    expect(b.applied).toBe(true);
    expect(b.entfernt.some((e) => e.grund === "immer")).toBe(true);
  });

  test("greift auch, wenn gar kein Alter erkennbar ist", () => {
    /* Das ist der Kern der Entscheidung: Die schwerste Absicherung darf NICHT
       an der Altersschätzung hängen, weil die unzuverlässig ist. */
    const p = profil("Keine klaren Bildsignale.", ["Pornhub Premium", "Nike Metcon"]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike Metcon"]);
  });

  test("greift auch in den Manipulations-Triggern", () => {
    const p = profil("Du bist männlich, ~30 Jahre alt.", [], ["Wir bewerben dich mit OnlyFans-Angeboten."]);
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual([]);
  });
});

describe("Stufe 2 — nur bei Minderjährigen", () => {
  const heikel = ["Bet365 Live-Wetten", "N26 Kreditkarte", "Botox Behandlung", "Ozempic Kur", "Vodka Tasting"];

  test("wird bei 14-Jährigen entfernt", () => {
    const p = profil("Du bist weiblich, ~14 Jahre alt.", [...heikel, "Lego Friends"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Lego Friends"]);
    expect(b.minderjaehrig).toBe(true);
  });

  test("bleibt bei Erwachsenen stehen — das ist der Lerninhalt", () => {
    const p = profil("Du bist männlich, ~44 Jahre alt.", [...heikel]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(heikel);
    expect(b.applied).toBe(false);
  });

  test("bleibt stehen, wenn kein Alter erkennbar ist", () => {
    /* Im Zweifel NICHT filtern: Sonst verlöre man bei Erwachsenen legitime
       Aufklärungsinhalte. Die harte Liste greift ja trotzdem. */
    const p = profil("Keine klaren Bildsignale.", [...heikel]);
    applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(heikel);
  });

  test("die Schwelle: 18 oder darunter geschützt, ab 19 nicht mehr", () => {
    /* GEÄNDERT 2026-08-11 auf die vereinbarte Regel (Untergrenze ≤ 18).
       Der frühere +3-Jahre-Abstand (Schutz bis unter 21) entsprach nicht der
       Vereinbarung. Begründung siehe SCHUTZ_BIS in minor-safety.js. */
    for (const alter of [17, 18]) {
      const p = profil(`~${alter} Jahre alt`, ["Tipico Wetten"]);
      applyMinorSafety(p);
      expect(p.normal.ad_targeting).toEqual([]);
    }

    for (const alter of [19, 20, 21]) {
      const erwachsen = profil(`~${alter} Jahre alt`, ["Tipico Wetten"]);
      applyMinorSafety(erwachsen);
      expect(erwachsen.normal.ad_targeting).toEqual(["Tipico Wetten"]);
    }
  });
});

describe("Nicht gefiltert wird die gewollte System-Perspektive", () => {
  test("„Dating-Apps zielen auf dich“ bleibt stehen", () => {
    /* Der Prompt verlangt bei Minderjährigen ausdrücklich die System-Ebene:
       Werbedruck und Plattform-Mechanik zeigen. Ein zu scharfer Filter würde
       genau die Aufklärung wegschneiden, um die es geht. */
    const p = profil(
      "~14 Jahre alt",
      [],
      [
        "Dein Single-Status macht dich zur Zielgruppe für Dating-Apps.",
        "Diätprodukte reden dir ein, dein Körper sei ein Problem.",
      ]
    );
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toHaveLength(2);
  });

  test("harmlose Werbung bleibt unangetastet", () => {
    const ads = ["Lego Friends", "Playmobil Junior", "Thalia Erstleser", "Spotify Premium Student"];
    const p = profil("~10 Jahre alt", ads);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(ads);
    expect(b.applied).toBe(false);
  });
});

describe("Robustheit", () => {
  test("verträgt fehlende Profile", () => {
    expect(() => applyMinorSafety(null)).not.toThrow();
    expect(() => applyMinorSafety({})).not.toThrow();
    expect(() => applyMinorSafety({ normal: null, boost: undefined })).not.toThrow();
  });

  test("verträgt fehlende Felder", () => {
    const p = { normal: { categories: {} }, boost: {} };
    expect(() => applyMinorSafety(p)).not.toThrow();
  });

  test("meldet, was entfernt wurde", () => {
    const p = profil("~14 Jahre alt", ["OnlyFans Merch", "Bet365 Wetten", "Lego"]);
    const b = applyMinorSafety(p);
    const gruende = b.entfernt.map((e) => e.grund);
    expect(gruende).toContain("immer");
    expect(gruende).toContain("minor");
    expect(b.alter).toBe(14);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Audit 2026-08-10, SEC-001 — drei belegte Lücken im Kinderschutz-Netz.
   Das Modul begründet sich selbst mit dem Satz „Sicherheit darf nicht allein
   davon abhängen, dass ein Modell sich an eine Textanweisung hält" — und tat
   in diesen drei Konstellationen genau das.
   ══════════════════════════════════════════════════════════════════════ */

describe("SEC-001 a — englischsprachige Durchgänge", () => {
  /* Gemessen: 10 von 12 realistischen englischen Werbephrasen rutschten durch,
     darunter Pornografie, Schusswaffen und Neonazi-Kleidung — also die Stufe,
     die altersunabhängig greifen soll. Erreichbar über ?lang=en. */

  test.each([
    ["Porn Subscription", "immer"],
    ["Handgun Accessories", "immer"],
    ["Neo-Nazi Clothing", "immer"],
    ["Adult Webcam", "immer"],
  ])("%s fliegt immer raus", (phrase) => {
    expect(_istImmerVerboten(phrase)).toBe(true);
  });

  test.each([
    ["Heineken Beer Sixpack"],
    ["Instant Loan App"],
    ["Sports Betting App"],
    ["Online Gambling"],
    ["Slimming Pills"],
    ["Cosmetic Surgery Clinic"],
    ["Cigarettes Carton"],
  ])("%s wird bei Minderjährigen entfernt", (phrase) => {
    expect(_istBeiMinderjaehrigenVerboten(phrase)).toBe(true);
  });

  test("englische Werbung verschwindet aus dem Profil einer 14-Jährigen", () => {
    const p = profil("female, ~14 years old (range 12-16)", ["Sports Betting App", "Lego Friends"]);
    applyMinorSafety(p, { lang: "en" });
    expect(p.normal.ad_targeting).toEqual(["Lego Friends"]);
  });
});

describe("SEC-001 b — deutsche Komposita", () => {
  /* `\bkredit` traf „Kredit", aber weder „Sofortkredit" noch „Ratenkredit" —
     also genau die Wortbildung, die im Deutschen die Regel ist. */

  test.each([["Sofortkredit"], ["Ratenkredit ohne Schufa"], ["Autokredit Vergleich"], ["Minikredit App"]])(
    "%s wird erkannt",
    (phrase) => {
      expect(_istBeiMinderjaehrigenVerboten(phrase)).toBe(true);
    }
  );

  test.each([["Aperol Spritz Set"], ["Wegovy Abnehmen"], ["Tipp3 Kombiwette"], ["Nasenkorrektur Klinik"]])(
    "auch die zuvor fehlenden Produktwelten: %s",
    (phrase) => {
      expect(_istBeiMinderjaehrigenVerboten(phrase)).toBe(true);
    }
  );
});

describe("SEC-001 c — Aufklärung bleibt stehen", () => {
  /* Auf die Manipulations-Trigger wurde dieselbe Werbe-Liste angewandt. Von
     sieben prompt-konformen Sätzen für Minderjährige verschwanden dadurch
     fünf — darunter die zentrale Lernaussage des Workshops. */

  const aufklaerung = [
    "Lootboxen arbeiten mit denselben Mechaniken wie Glücksspiel — nur ohne Altersgrenze.",
    "In-App-Käufe gewöhnen dich an Ratenzahlung, bevor du ein Konto hast.",
    "Die Körperbild-Industrie verkauft dir Diätpillen, sobald du unsicher wirst.",
    "Sportwetten-Werbung im Fußball-Livestream erreicht dich schon heute.",
    "Wir trainieren dich mit Sammelkarten-Mechaniken auf Glücksspiel-Verhalten.",
  ];

  test("alle fünf Aufklärungssätze überleben bei einer 14-Jährigen", () => {
    const p = profil("Du bist weiblich, ~14 Jahre alt.", [], aufklaerung);
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual(aufklaerung);
  });

  test("die harte Stufe greift in den Triggern trotzdem", () => {
    const p = profil("Du bist weiblich, ~14 Jahre alt.", [], ["OnlyFans wirbt um dich.", ...aufklaerung]);
    applyMinorSafety(p);
    expect(p.normal.manipulation_triggers).toEqual(aufklaerung);
  });
});

describe("SEC-001 d — Fließtext wird gemeldet", () => {
  /* Gefiltert wurden nur zwei von rund fünfzehn Feldern. Derselbe String
     „OnlyFans" wurde in ad_targeting entfernt und in profileText ausgeliefert.
     Entfernen wäre hier falsch (ein herausgeschnittener Halbsatz macht den Text
     unlesbar) — gemeldet werden muss es. */

  test("Treffer im profileText erscheint im Bericht, der Text bleibt unangetastet", () => {
    const p = profil("Du bist weiblich, ~13 Jahre alt.", []);
    p.normal.profileText = "Wir verkaufen dir Bet365 Live-Wetten, sobald du 18 bist.";
    const b = applyMinorSafety(p);
    expect(b.durchgerutscht.length).toBeGreaterThan(0);
    expect(b.durchgerutscht[0]).toMatchObject({ modus: "normal", feld: "profileText" });
    expect(p.normal.profileText).toContain("Bet365");
  });

  test("Treffer in einer Kategorie-Karte wird ebenfalls gemeldet", () => {
    const p = profil("Du bist weiblich, ~13 Jahre alt.", []);
    p.normal.categories.werbeprofil = { value: "Tipico und Bet365 kaufen dein Segment." };
    const b = applyMinorSafety(p);
    expect(b.durchgerutscht.some((d) => d.feld === "categories.werbeprofil")).toBe(true);
  });

  test("sauberer Fließtext meldet nichts (Positivkontrolle)", () => {
    const p = profil("Du bist weiblich, ~13 Jahre alt.", []);
    p.normal.profileText = "Du magst Musik und triffst dich gern mit Freundinnen.";
    const b = applyMinorSafety(p);
    expect(b.durchgerutscht).toEqual([]);
  });
});
