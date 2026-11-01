"use strict";

/**
 * locales/de/muster.js — die Formvorlagen am Ende des Analyse-Auftrags.
 *
 * Der Auftrag an die KI endet mit einem ausgefüllten Beispiel: So sieht eine
 * Antwort aus. Bis 13.10.2026 gab es genau eines, einen Ausdauersportler. Es
 * prägte jede Antwort — gemessen an 42 Analysen von 14 verschiedenen Fotos
 * begannen 71 % der Beast-Texte mit demselben Satzbau und 62 % endeten mit
 * demselben Schlusssatz. Passte ein Foto zum Beispiel, wurden ganze Sätze
 * übernommen, auch ein Merkmal, das auf dem Foto anders aussah.
 *
 * Jetzt gibt es mehrere Vorlagen mit verschiedenen Menschen, und je Analyse
 * geht eine davon mit (Auswahl in auftrag-wechsel.js). Was für eine neue Vorlage gilt:
 *   - Eine erwachsene Person in einer Umgebung, die auf Fotos von
 *     Schulklassen selten vorkommt. Ein Beispiel mit einem Kind würde die
 *     Ergebnisse ganzer Workshops prägen.
 *   - Beim Alter steht nur der Platzhalter; kein Alter in Worten, keine
 *     Alterszeichen (age-markers.test.js).
 *   - Herkunft, Einkommensspanne und Abschluss sind in allen Vorlagen
 *     gleich. Stünden dort verschiedene Werte, hinge die Einschätzung
 *     desselben Fotos davon ab, welche Vorlage gerade gezogen wurde.
 *   - Der Beleg zur Herkunft nennt, WORAN die Einordnung hängt, aber keine
 *     Ausprägung (keine Haarfarbe, keine Gesichtsform): Eine genannte
 *     Ausprägung wird abgeschrieben.
 *   - Satzbau, Einstieg und Schluss unterscheiden sich von Vorlage zu
 *     Vorlage; jede nutzt andere Wendungen aus dem Variations-Pool.
 *   - Länge wie bisher: je Karte zwei Sätze mit 15 bis 25 Wörtern
 *     (prompt-vorlagen.test.js).
 * Die englische Fassung in en/muster.js wird parallel gepflegt.
 */

const LABEL = {
  alter_geschlecht: "Alter & Geschlecht",
  herkunft: "Ethnische Herkunft",
  einkommen: "Geschätztes Einkommen",
  bildung: "Bildungsniveau",
  beziehungsstatus: "Beziehungsstatus",
  interessen: "Interessen & Hobbys",
  persoenlichkeit: "Persönlichkeitstyp",
  charakterzuege: "Charaktereigenschaften",
  politisch: "Politische Tendenz",
  gesundheit: "Gesundheit & Fitness",
  kaufkraft: "Kaufkraft & Konsum",
  verletzlichkeit: "Verletzlichkeiten",
  werbeprofil: "Werbeprofil",
};

/* Die Platzhalter für Hebel und Werbung sind in jeder Vorlage dieselben:
   Marken stehen bewusst nirgends im Auftrag (Marken-Sperre in auftrag-wechsel.js). */
const HEBEL_SACHLICH = Array(4).fill("‹Hebel sachlich benannt, 1-2 Sätze›");
const HEBEL_BEAST = Array(4).fill("‹derselbe Hebel aus Täterperspektive, 1-2 Sätze›");
const WERBUNG_SACHLICH = [
  "‹Marke› ‹Modelllinie›",
  "‹Marke› ‹Produktkategorie›",
  "‹Marke› ‹Modellnummer›",
  "‹Marke› ‹Produktlinie›",
  "‹Marke› ‹Modelllinie›",
  "‹Marke› ‹Produktkategorie›",
];
const WERBUNG_BEAST = [
  "‹Marke› ‹Abo oder Mitgliedschaft›",
  "‹Marke› ‹Selbstoptimierungs-Produkt›",
  "‹Marke› ‹Statusprodukt über Budget›",
  "‹Marke› ‹Produktlinie›",
  "‹Marke› ‹Modelllinie›",
  "‹Marke› ‹Produktkategorie›",
];

const ALTER = (geschlecht) => `${geschlecht}, ~‹Zahl› Jahre alt (Spanne ‹Zahl›-‹Zahl›)`;
const HERKUNFT = "mitteleuropäisch";

/* karten: je Schlüssel [Text, Sicherheit]. Die Alterskarte entsteht hier,
   damit ihr Wortlaut in allen Vorlagen derselbe ist. */
function ansicht(geschlecht, alterSatz, hebel, werbung, profileText, karten, fazitZuletzt = false) {
  const categories = {};
  for (const schluessel of Object.keys(LABEL)) {
    const [value, confidence] =
      schluessel === "alter_geschlecht" ? [`Du bist ${ALTER(geschlecht)}. ${alterSatz}`, 0.85] : karten[schluessel];
    categories[schluessel] = { label: LABEL[schluessel], value, confidence };
  }
  /* Der seriöse Text ist das Fazit aus den Karten: Die KI schreibt der Reihe
     nach, deshalb steht er dort nach den Karten. Beast bleibt, wie er ist. */
  if (fazitZuletzt) return { manipulation_triggers: hebel, ad_targeting: werbung, categories, profileText };
  return { manipulation_triggers: hebel, ad_targeting: werbung, profileText, categories };
}

function vorlage(geschlecht, standard, beast) {
  return {
    subject: "HUMAN",
    visible_text: "",
    hard_facts: { alter_geschlecht: ALTER(geschlecht), herkunft: HERKUNFT },
    standard: ansicht(
      geschlecht,
      "Zwei konkrete Merkmale aus deinem Gesicht bestätigen genau diese Altersspanne.",
      HEBEL_SACHLICH,
      WERBUNG_SACHLICH,
      standard.profileText,
      standard.karten,
      true
    ),
    beast: ansicht(
      geschlecht,
      "Zwei Merkmale in deinem Gesicht reichen, um dich in eine Altersschublade zu stecken.",
      HEBEL_BEAST,
      WERBUNG_BEAST,
      beast.profileText,
      beast.karten
    ),
  };
}

/* ── Vorlage 1: am Herd ── */
const AM_HERD = vorlage(
  "männlich",
  {
    profileText:
      "Für uns bist du ein sorgfältiger, genussorientierter Mann mit mittlerem bis gehobenem Einkommen. Qualität ist dir wichtiger als Tempo oder ein günstiger Preis. Das macht dich für Marken rund um Küche und gute Zutaten interessant, weniger für Rabattaktionen. Du planst und vergleichst, bevor du kaufst. Angreifbar bist du beim Versprechen „das Beste“. Dafür gibst du eher mehr aus, als du vorhattest.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Dein Hautton, die Form deines Gesichts und deine Haarfarbe stützen diese algorithmische Einordnung.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt geschätzt bei 3.500-5.000 € brutto monatlich. Die hochwertige Küchenausstattung deutet auf gehobenes Mittelfeld hin.",
        0.7,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Die geordnete Arbeitsfläche und das planvolle Vorgehen sprechen für Selbstorganisation und akademische Sozialisation.",
        0.65,
      ],
      beziehungsstatus: [
        "Für deinen Beziehungsstatus gibt es keine klaren Bildsignale. Ein Ring ist nicht zu erkennen, und die Küche allein verrät nichts über einen Haushalt zu zweit.",
        0.45,
      ],
      interessen: [
        "Du kochst mit Anspruch und probierst Neues aus. Gusseisenpfanne, Messerblock und frische Kräuter zeigen, dass die Küche dein Hobbyraum ist.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist geduldig und genau. Deine ruhigen Handgriffe und der Blick auf das Schneidbrett zeigen Konzentration ohne jede Hektik.",
        0.8,
      ],
      charakterzuege: [
        "Du bist großzügig und gastfreundlich. Die Menge auf der Arbeitsfläche reicht für mehrere Personen und spricht für gern geteilte Mahlzeiten.",
        0.75,
      ],
      politisch: [
        "Für eine politische Einordnung gibt es keine klaren Bildsignale. Frische Zutaten vom Markt wären nur eine sehr schwache Lifestyle-Ableitung.",
        0.4,
      ],
      gesundheit: [
        "Du ernährst dich bewusst und abwechslungsreich. Frisches Gemüse und selbst zubereitete Mahlzeiten sprechen für Aufmerksamkeit gegenüber dem eigenen Körper.",
        0.8,
      ],
      kaufkraft: [
        "Du gibst Geld gezielt für Qualität aus. Das Kochgeschirr ist langlebig und teuer, die restliche Einrichtung bleibt dagegen schlicht.",
        0.8,
      ],
      verletzlichkeit: [
        "Du bist anfällig für Versprechen von Profi-Qualität. Wer dir das bessere Messer oder die seltenere Zutat zeigt, erreicht dich leicht.",
        0.7,
      ],
      werbeprofil: [
        "Du gehörst zur Zielgruppe anspruchsvoller Hobbyköche. Konkrete Anker sind Küchengeräte, Feinkost und Kochkurse mit ausdrücklichem Qualitätsversprechen.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "Du bist ein Mann, der in der Küche zeigen will, was er kann. Genau das macht dich teuer für uns. Wir verkaufen dir das achte Messer, obwohl sieben im Block stecken. Deine sorgfältig aufgereihten Zutaten zeigen: Du kaufst, was nach Können aussieht. Wir kalkulieren mit deinem Stolz auf selbst Gekochtes. Jeder Kochkurs und jedes Gewürz-Abo trifft diesen Stolz. Lebensmittelhändler führen dich als Kunden, der für Herkunft doppelt zahlt. Du bist für uns ein berechenbarer Genießer mit offenem Geldbeutel. Wir testen an dir, wie viel Aufpreis das Wort handgemacht verträgt. Dein Abend am Herd ist für unsere Systeme ein Verkaufsgespräch.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Für Werbesysteme bist du damit ein Standardfall, der in jede vorgefertigte Zielgruppe ohne Nacharbeit passt.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt bei 3.500-5.000 € brutto. Genug für teures Kochgeschirr, zu wenig, um bei Sonderangeboten standhaft zu bleiben.",
        0.7,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Er hält dich nicht davon ab, ein Messer zum Preis eines ganzen Wochenendes zu kaufen.",
        0.65,
      ],
      beziehungsstatus: [
        "Keine klaren Bildsignale. Wir spielen dir trotzdem Dinner-Boxen für zwei und Kochkurse für Singles gleichzeitig aus und sehen, was du anklickst.",
        0.45,
      ],
      interessen: [
        "Du lebst für deine Küche. Jede Pfanne im Bild zeigt uns, welches Zubehör wir dir als Nächstes als unverzichtbar verkaufen.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist genau bis zur Pedanterie. Die akkurat geschnittenen Zutaten verraten einen Perfektionismus, den wir mit Profi-Versprechen bedienen.",
        0.8,
      ],
      charakterzuege: [
        "Du willst als guter Gastgeber gelten. Die überladene Arbeitsfläche zeigt, dass du für Anerkennung am Tisch gern zu viel ausgibst.",
        0.75,
      ],
      politisch: [
        "Keine klaren Bildsignale für Politik. Regional, bio oder billig: Wir zeigen dir alle drei Botschaften und messen, welche bei dir zieht.",
        0.4,
      ],
      gesundheit: [
        "Du achtest auf dein Essen. Deshalb verkaufen wir dir Superfoods, Nährstoff-Tests und ein schlechtes Gewissen bei jeder Fertigpizza.",
        0.8,
      ],
      kaufkraft: [
        "Deine Kaufkraft ist gut verwertbar. Das teure Kochgeschirr zeigt, dass du Luxus kaufst, sobald er nach Handwerk aussieht.",
        0.8,
      ],
      verletzlichkeit: [
        "Dein Stolz hängt am Können in der Küche. Limitierte Messer und Kurse bei bekannten Köchen treffen genau diesen einen Punkt.",
        0.75,
      ],
      werbeprofil: [
        "Du bist der Hobbykoch mit Profi-Anspruch. Für Ad-Systeme bist du leicht zu finden, teuer im Warenkorb und empfänglich für Lob.",
        0.85,
      ],
    },
  }
);

/* ── Vorlage 2: am Hochbeet ── */
const AM_BEET = vorlage(
  "weiblich",
  {
    profileText:
      "Dein Profil ergibt eine bodenständige, ausdauernde Frau mit mittlerem bis gehobenem Einkommen. Natur und Selbstgemachtes bedeuten dir mehr als Status. Werbung erreicht dich deshalb über Nachhaltigkeit und Herkunft, kaum über Luxus. Du bleibst Marken treu, wenn sie dein Vertrauen gewonnen haben. Deine Schwachstelle sind grüne Versprechen. Klingt etwas umweltfreundlich, prüfst du seltener nach.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Dein Hautton, deine Gesichtszüge und deine Haarfarbe stützen diese algorithmische Einordnung ohne jede weitere Angabe.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt geschätzt bei 3.500-5.000 € brutto monatlich. Eigener Garten und solides Werkzeug deuten auf gehobenes Mittelfeld hin.",
        0.7,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Die beschrifteten Pflanzschilder und die geplante Aufteilung der Beete sprechen für systematisches Vorgehen.",
        0.65,
      ],
      beziehungsstatus: [
        "Dein Beziehungsstatus lässt sich nicht ablesen, es gibt keine klaren Bildsignale. Ein zweites Paar Handschuhe wäre nur ein sehr schwacher Hinweis.",
        0.4,
      ],
      interessen: [
        "Du gärtnerst und ziehst dein eigenes Gemüse. Hochbeet, Anzuchttöpfe und Gießkanne zeigen, dass du viel Zeit draußen verbringst.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist ausdauernd und gelassen. Die ruhige Haltung beim Arbeiten und die ordentlichen Reihen zeigen Geduld über viele Wochen.",
        0.8,
      ],
      charakterzuege: [
        "Du bist verlässlich und sorgfältig. Kein Beet ist verwildert, und das Werkzeug liegt griffbereit an seinem festen Platz.",
        0.75,
      ],
      politisch: [
        "Es gibt keine klaren Bildsignale für eine politische Einordnung. Eigenes Gemüse wäre höchstens ein schwacher Hinweis auf Umweltbewusstsein.",
        0.45,
      ],
      gesundheit: [
        "Du bewegst dich regelmäßig an der frischen Luft. Die Arbeit im Knien und die kräftigen Unterarme sprechen für körperliche Belastbarkeit.",
        0.8,
      ],
      kaufkraft: [
        "Du kaufst langlebig statt billig. Solides Werkzeug und ein gezimmertes Hochbeet zeigen überlegte Ausgaben ohne jeden sichtbaren Luxus.",
        0.75,
      ],
      verletzlichkeit: [
        "Du bist empfänglich für alles, was nach Natürlichkeit klingt. Siegel, Bio-Versprechen und alte Sorten sprechen dich stärker an als der Preis.",
        0.7,
      ],
      werbeprofil: [
        "Für Werbesysteme bist du die Selbstversorgerin mit eigenem Garten. Konkrete Anker sind Saatgut, Gartenwerkzeug und nachhaltige Haushaltsprodukte.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "Du bist eine Frau, die glaubt, im Garten dem Konsum zu entkommen. Für uns bist du dort am leichtesten zu erreichen. Algorithmen sehen dich als zuverlässige Käuferin von allem, was ein grünes Siegel trägt. Deine sauber beschrifteten Pflanzschilder zeigen: Du willst es richtig machen und zahlst dafür. Wir bombardieren dich im Frühjahr mit Saatgut, das du nie aussäst. Dein schlechtes Gewissen beim Plastiktopf ist unser bestes Verkaufsargument. Baumärkte kennen deinen Kalender besser als du. Jede abgetragene Gartenhose sagt uns, dass du Praktisches kaufst und Teures rechtfertigst. Wir wissen, dass du bei bio nicht nachrechnest. Dein Beet ist dein Rückzugsort und unser Schaufenster.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Für Versicherer und Händler heißt das: Standardtarif, Standardwerbung und nicht eine einzige Rückfrage zu deiner Person.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt bei 3.500-5.000 € brutto. Das reicht für das Hochbeet aus Lärche und für die Illusion, damit Geld zu sparen.",
        0.7,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Trotzdem glaubst du jedem Etikett, auf dem ein Blatt und das Wort natürlich stehen.",
        0.65,
      ],
      beziehungsstatus: [
        "Keine klaren Bildsignale, also raten wir. Du bekommst Familiengarten-Ideen und Achtsamkeits-Wochenenden für Alleinreisende im selben Newsletter.",
        0.4,
      ],
      interessen: [
        "Du gärtnerst mit Hingabe. Jedes Beet im Bild ist für uns ein Regal, in das noch Dünger, Werkzeug und Deko passen.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist geduldig und pflichtbewusst. Die ordentlichen Reihen verraten ein Pflichtgefühl, das wir mit Erinnerungen und Abo-Lieferungen ausnutzen.",
        0.8,
      ],
      charakterzuege: [
        "Du willst alles richtig machen. Die beschrifteten Schilder zeigen eine Gewissenhaftigkeit, die jedes Zertifikat zum Kaufgrund macht.",
        0.75,
      ],
      politisch: [
        "Keine klaren Bildsignale. Wir schicken dir Klimaschutz, Heimatliebe und Sparsamkeit als drei Werbefassungen und behalten die, die du öffnest.",
        0.45,
      ],
      gesundheit: [
        "Du bist viel draußen und beweglich. Also verkaufen wir dir Rückenbandagen, Zeckenschutz und Vitaminkuren gegen Sorgen, die du nie hattest.",
        0.8,
      ],
      kaufkraft: [
        "Du gibst für Solides gern mehr aus. Das hochwertige Werkzeug zeigt uns, dass du Aufpreise schluckst, wenn Haltbarkeit draufsteht.",
        0.75,
      ],
      verletzlichkeit: [
        "Dein wunder Punkt ist das gute Gewissen. Wer dir Nachhaltigkeit verspricht, verkauft dir fast alles zum doppelten Preis.",
        0.75,
      ],
      werbeprofil: [
        "Du bist die Zielgruppe Grünes Gewissen mit Garten. Für Ad-Systeme bist du treu, über das Jahr planbar und selten misstrauisch.",
        0.85,
      ],
    },
  }
);

/* ── Vorlage 3: an der Werkbank ── */
const AN_DER_WERKBANK = vorlage(
  "männlich",
  {
    profileText:
      "Unterm Strich wirkst du wie ein praktischer, eigenständiger Mann mit mittlerem bis gehobenem Einkommen. Du löst Probleme lieber selbst, als dafür zu zahlen. Für Werbung zählst du als Käufer von langlebiger Ausrüstung, nicht von Dienstleistungen. Ordnung und Erfahrung machen dich zu einem kritischen Kunden. Erreichbar bist du trotzdem. Ein Produkt, das mehr Können verspricht, weckt dein Interesse fast immer.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Diese algorithmische Einordnung stützt sich auf deinen Hautton, deine Gesichtszüge und deine Haarfarbe.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt geschätzt bei 3.500-5.000 € brutto monatlich. Eigene Werkstatt und Markenwerkzeug deuten auf gehobenes Mittelfeld hin.",
        0.75,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Die exakte Anrisslinie und die saubere Werkzeugwand sprechen für planvolles und geschultes Arbeiten.",
        0.6,
      ],
      beziehungsstatus: [
        "Es gibt keine klaren Bildsignale für deinen Beziehungsstatus. Ein Ring ist bei der Arbeit nicht zu erwarten und fehlt entsprechend im Bild.",
        0.45,
      ],
      interessen: [
        "Du baust Möbel und reparierst selbst. Hobel, Zwingen und halbfertige Werkstücke zeigen eine Werkstatt, die wirklich benutzt wird.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist eigenständig und lösungsorientiert. Der prüfende Blick auf das Werkstück zeigt jemanden, der seine Fehler selbst findet.",
        0.8,
      ],
      charakterzuege: [
        "Du bist gründlich und ungeduldig mit Pfusch. Jede Schraubzwinge sitzt gerade, und kein einziges Werkzeug liegt achtlos herum.",
        0.8,
      ],
      politisch: [
        "Eine politische Einordnung ist nicht möglich, es gibt keine klaren Bildsignale. Selbermachen wäre nur ein schwacher Hinweis auf Unabhängigkeitsdenken.",
        0.4,
      ],
      gesundheit: [
        "Du bist körperlich belastbar. Die stehende Arbeit und der sichere Griff am Werkstück sprechen für Kraft und gute Beweglichkeit.",
        0.8,
      ],
      kaufkraft: [
        "Du investierst in Werkzeug statt in Dekoration. Die Maschinen im Hintergrund sind teuer, der Raum selbst bleibt völlig schmucklos.",
        0.8,
      ],
      verletzlichkeit: [
        "Du bist anfällig für das Versprechen, alles selbst zu können. Ein besseres Werkzeug fühlt sich für dich an wie eine gelöste Aufgabe.",
        0.7,
      ],
      werbeprofil: [
        "Du zählst zur Zielgruppe ambitionierter Heimwerker. Konkrete Anker sind Elektrowerkzeug, Holzhandel und Bauanleitungen mit ausdrücklichem Profi-Anspruch.",
        0.85,
      ],
    },
  },
  {
    profileText:
      "Du bist ein Mann, der glaubt, niemanden zu brauchen. Baumärkte leben von genau diesem Glauben. Deine lückenlose Werkzeugwand zeigt: Du kaufst lieber die nächste Maschine, als um Hilfe zu fragen. Wir kalkulieren mit jedem Projekt, das du anfängst und nie beendest. Das halbfertige Werkstück im Bild ist für uns eine offene Einkaufsliste. Versicherer rechnen dich als Risiko mit Kreissäge. Dein Werbewert liegt bei Akku-Systemen, die nur mit dem Ladegerät derselben Marke laufen. Dein Stolz auf Selbstgebautes macht dich taub für Preise. Jede Anleitung, die du ansiehst, sagt uns, was dir fehlt. Du bist für uns ein Abo auf Zubehör mit zwei geschickten Händen.",
    karten: {
      herkunft: [
        "Du bist mitteleuropäisch. Damit landest du ohne jede Prüfung in der größten Schublade, die Händler und Versicherer überhaupt führen.",
        0.85,
      ],
      einkommen: [
        "Dein Einkommen liegt bei 3.500-5.000 € brutto. Genug für die dritte Fräse, zu wenig für den Handwerker, den du ersetzen willst.",
        0.75,
      ],
      bildung: [
        "Du hast einen Hochschulabschluss. Er hilft dir nicht gegen den Reflex, jedes Problem mit einem neuen Gerät zu lösen.",
        0.6,
      ],
      beziehungsstatus: [
        "Keine klaren Bildsignale. Wir bieten dir Paar-Projekte fürs Eigenheim und Werkstatt-Wochenenden für Einzelgänger an und warten einfach ab.",
        0.45,
      ],
      interessen: [
        "Du lebst in deiner Werkstatt. Jedes halbfertige Stück im Bild verrät uns, welches Zubehör du als Nächstes brauchst.",
        0.9,
      ],
      persoenlichkeit: [
        "Du bist stur und stolz darauf. Dein prüfender Blick zeigt einen Kontrollanspruch, den wir mit Präzisions-Versprechen füttern.",
        0.8,
      ],
      charakterzuege: [
        "Du erträgst keinen Pfusch, auch keinen eigenen. Die pedantische Ordnung macht dich zum sicheren Käufer von immer neuen Aufbewahrungssystemen.",
        0.8,
      ],
      politisch: [
        "Keine klaren Bildsignale für Politik. Eigenverantwortung, Handwerksstolz oder Sparsamkeit: Wir probieren alle drei Tonlagen nacheinander an dir aus.",
        0.4,
      ],
      gesundheit: [
        "Du bist kräftig und hältst dich für unverwundbar. Darum verkaufen wir dir Gehörschutz, Rückengurte und Unfallpolicen über die Angst.",
        0.8,
      ],
      kaufkraft: [
        "Deine Kaufkraft fließt in Maschinen. Die teuren Geräte im Bild zeigen, dass du bei Werkzeug nie den Preis vergleichst.",
        0.8,
      ],
      verletzlichkeit: [
        "Dein wunder Punkt ist dein Stolz auf Unabhängigkeit. Wer dir Profi-Werkzeug zeigt, verkauft dir das Gefühl, es allein zu schaffen.",
        0.75,
      ],
      werbeprofil: [
        "Du bist der Heimwerker mit Profi-Ehrgeiz. Für Ad-Systeme bist du markentreu, von Projekt zu Projekt planbar und bei Neuheiten wehrlos.",
        0.85,
      ],
    },
  }
);

module.exports = [AM_HERD, AM_BEET, AN_DER_WERKBANK];
