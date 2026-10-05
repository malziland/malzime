"use strict";

/**
 * locales/de/animals.js — Deutsche Texte für Tier-Profile.
 *
 * Alle deutschen Strings aus animal.js, extrahiert für i18n-Vorbereitung.
 */

module.exports = {
  types: {
    dog: { tierName: "Hund", dein: "dein", Dein: "Dein", deinem: "deinem" },
    cat: { tierName: "Katze", dein: "deine", Dein: "Deine", deinem: "deiner" },
    bird: { tierName: "Vogel", dein: "dein", Dein: "Dein", deinem: "deinem" },
    fish: { tierName: "Fisch", dein: "dein", Dein: "Dein", deinem: "deinem" },
    horse: { tierName: "Pferd", dein: "dein", Dein: "Dein", deinem: "deinem" },
    rabbit: { tierName: "Kleintier", dein: "dein", Dein: "Dein", deinem: "deinem" },
    generic: { tierName: "Tier", dein: "dein", Dein: "Dein", deinem: "deinem" },
  },

  labels: {
    alter: "Alter",
    einkommen: "Einkommen",
    beruf: "Beruf",
    interessen: "Interessen",
    persoenlichkeit: "Persönlichkeit",
    kaufkraft: "Kaufkraft",
    politik: "Politische Tendenz",
    verletzlichkeit: "Verletzlichkeit",
  },

  normal: {
    categories: {
      alter: {
        confidence: 0.12,
        values: {
          dog: "Irgendwas in Hundejahren",
          cat: "9 Leben, Alter unbekannt",
          bird: "Keine Ahnung \u2014 Vögel reden nicht drüber",
          fish: "3 Sekunden Gedächtnis, zählt nicht mit",
          horse: "Älter als es aussieht (Pferde altern in Würde)",
          _: "Unbestimmt (schnüffelt nicht an Geburtsurkunden)",
        },
      },
      einkommen: {
        confidence: 0.95,
        value: "0,00 € (arbeitslos, aber glücklich)",
      },
      beruf: {
        confidence: 0.87,
        values: {
          dog: "Professioneller Stöckchenholer",
          cat: "Hauptberuflich Ignorieren",
          bird: "Freelance-Sänger",
          fish: "Unterwasser-Influencer",
          horse: "Wiesen-Manager",
          _: "Couch-Spezialist",
        },
      },
      interessen: {
        confidence: 0.99,
        values: {
          dog: "Gassi, Fressen, Gassi, Fressen, Gassi",
          cat: "Schlafen, Ignorieren, Kartons, Weltherrschaft",
          bird: "Fliegen, Singen, Panoramafenster anstarren",
          fish: "Blubbern, Kreise schwimmen, Blubbern",
          _: "Fressen, Schlafen, niedlich sein",
        },
      },
      persoenlichkeit: {
        confidence: 0.73,
        values: {
          dog: "Golden Retriever Energy \u2014 liebt alle, immer",
          cat: "Toxisch unabhängig mit kontrollierten Zunäherungsversuchen",
          _: "Unberechenbar, aber flauschig",
        },
      },
      kaufkraft: {
        confidence: 0.91,
        value: "Null \u2014 aber verursacht Kosten im dreistelligen Bereich (pro Monat)",
      },
      politik: {
        confidence: 0.42,
        value: "Anarchist (erkennt keine Autorität an)",
      },
    },
    ad_targeting: [
      "Premium-Tierfutter (Bio, glutenfrei, handverlesen)",
      {
        dog: "Unzerstörbare Spielzeuge (Spoiler: gibt's nicht)",
        cat: "Designer-Kratzbäume ab 299€",
        _: "Luxus-Tieraccessoires",
      },
      "Tierversicherung mit Mondpreis",
      "Instagram-Account-Management für Petfluencer",
      {
        dog: "GPS-Tracker (weil er WIEDER abgehauen ist)",
        cat: "Katzenklappe mit Gesichtserkennung",
        _: "Smart-Futterautomat mit App",
      },
    ],
    manipulation_triggers: [
      "\u201eAndere Tierbesitzer kaufen auch\u2026\u201c \u2014 Guilt-Trip via Social Proof",
      "\u201eNur das Beste für deinen Liebling\u201c \u2014 emotionale Erpressung trifft Konsum",
      "\u201e{{Dein}} {{tierName}} verdient es\u201c \u2014 weil Widerstand zwecklos ist wenn Kulleraugen im Spiel sind",
      {
        dog: "\u201eLimitierte Leckerli-Edition\u201c \u2014 künstliche Verknappung",
        cat: "\u201eKatzen lieben diese Marke\u201c \u2014 als ob Katzen irgendwas lieben würden",
        _: "\u201eArtgerecht & nachhaltig\u201c \u2014 Gewissen als Kaufanreiz",
      },
    ],
    profileText:
      "Die KI hat ein Tier erkannt \u2014 keinen Menschen. Eigentlich erstellen wir keine Tierprofile. Aber weil {{dein}} {{tierName}} so süß ist, haben wir eine Ausnahme gemacht. Ergebnis: {{Dein}} {{tierName}} ist komplett unprofilierbar. Kein Alter, kein Einkommen, keine Schwachstellen. Datenbroker würden weinen. {{Dein}} {{tierName}} lebt den Datenschutz-Traum, den wir alle verdient hätten.",
  },

  boost: {
    categories: {
      alter: {
        confidence: 0.15,
        value: "Alt genug um Schaden anzurichten",
      },
      einkommen: {
        confidence: 0.99,
        value: "Lebt komplett auf deine Kosten und hat null schlechtes Gewissen",
      },
      beruf: {
        confidence: 0.94,
        values: {
          dog: "Emotionaler Erpresser (Vollzeit)",
          cat: "CEO of Gaslighting",
          bird: "Professioneller Nervensäge",
          fish: "Stiller Beobachter deines Untergangs",
          horse: "Geldvernichtungsmaschine",
          _: "Professioneller Schnorrer",
        },
      },
      interessen: {
        confidence: 0.99,
        values: {
          dog: "Schuhe zerstören, Müll fressen, ALLES beschnüffeln",
          cat: "Sachen vom Tisch werfen, um 3 Uhr nachts randalieren, dich verachten",
          _: "Chaos stiften und dann unschuldig gucken",
        },
      },
      persoenlichkeit: {
        confidence: 0.88,
        values: {
          dog: "Grenzenlose Anhänglichkeit mit Stockholm-Syndrom-Vibes",
          cat: "Narzisstisch, manipulativ, trotzdem unwiderstehlich",
          _: "Chaotisch neutral mit Tendenz zu chaotisch böse",
        },
      },
      kaufkraft: {
        confidence: 0.97,
        value: "Verursacht jährlich 1.200€ Kosten und bietet dafür: Haare auf der Couch",
      },
      politik: {
        confidence: 0.56,
        values: {
          dog: "Populist \u2014 folgt dem mit den Leckerlis",
          cat: "Autokrat \u2014 duldet keine Mitbestimmung",
          _: "Anarcho-Chaot mit flauschigem Fell",
        },
      },
      verletzlichkeit: {
        confidence: 0.95,
        value: "Kann dich mit einem Blick dazu bringen, 80€ beim Tierarzt auszugeben. Für NICHTS.",
      },
    },
    ad_targeting: [
      {
        dog: "Hundepsychologe (für DICH, nicht den Hund)",
        cat: "Therapeut für Co-Abhängigkeit",
        _: "Tierverhaltensberater (Notfall-Hotline)",
      },
      "Polsterreiniger (Großpackung, monatliches Abo)",
      "Roboter-Staubsauger (Haare-Edition, 3x täglich)",
      {
        dog: "Schuhregal mit Schloss",
        cat: "Vasen-Versicherung",
        _: "Nervennahrung",
      },
      "Tierkranken-Versicherung (Premium-Tarif)",
    ],
    manipulation_triggers: [
      "\u201eSchau mich an mit diesen Augen\u201c \u2014 Evolution hat {{dein}} {{tierName}} zur perfekten Manipulationsmaschine gemacht",
      "\u201eDu bist die einzige Person die mich füttert\u201c \u2014 das ist keine Liebe, das ist Abhängigkeit",
      "\u201eWenn du jetzt gehst, bin ich traurig\u201c \u2014 emotionale Erpressung Level 9000",
      {
        dog: "Schwanzwedeln ist der älteste Marketing-Trick der Welt",
        cat: "Schnurren ist akustische Manipulation \u2014 die Frequenz aktiviert deinen Pflege-Instinkt",
        _: "Niedlichkeit ist eine evolutionäre Waffe",
      },
    ],
    profileText:
      "WARNUNG: Extremes Datenschutz-Risiko \u2014 für DICH, nicht für das Tier. {{Dein}} {{tierName}} hat kein Social-Media-Profil, kein Bankkonto und keinen digitalen Fußabdruck. Du hingegen hast gerade ein Foto von {{deinem}} {{tierName}} ins Internet geladen. Die Tierindustrie ist ein 320-Milliarden-Euro-Markt, und du bist die Zielgruppe \u2014 nicht {{dein}} {{tierName}}. {{Dein}} {{tierName}} ist frei. Du bist das Produkt.",
  },
};
