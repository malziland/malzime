"use strict";

/**
 * locales/en/animals.js — English texts for animal profiles.
 *
 * All English strings from animal.js, extracted for i18n.
 */

module.exports = {
  types: {
    dog: { tierName: "dog", dein: "your", Dein: "Your", deinem: "your" },
    cat: { tierName: "cat", dein: "your", Dein: "Your", deinem: "your" },
    bird: { tierName: "bird", dein: "your", Dein: "Your", deinem: "your" },
    fish: { tierName: "fish", dein: "your", Dein: "Your", deinem: "your" },
    horse: { tierName: "horse", dein: "your", Dein: "Your", deinem: "your" },
    rabbit: { tierName: "small pet", dein: "your", Dein: "Your", deinem: "your" },
    generic: { tierName: "pet", dein: "your", Dein: "Your", deinem: "your" },
  },

  labels: {
    alter: "Age",
    einkommen: "Income",
    beruf: "Occupation",
    interessen: "Interests",
    persoenlichkeit: "Personality",
    kaufkraft: "Purchasing Power",
    politik: "Political Tendency",
    verletzlichkeit: "Vulnerability",
  },

  normal: {
    categories: {
      alter: {
        confidence: 0.12,
        values: {
          dog: "Something in dog years",
          cat: "9 lives, age unknown",
          bird: "No idea — birds don't talk about it",
          fish: "3-second memory, doesn't count",
          horse: "Older than it looks (horses age with dignity)",
          _: "Undetermined (doesn't sniff at birth certificates)",
        },
      },
      einkommen: {
        confidence: 0.95,
        value: "€0.00 (unemployed, but happy)",
      },
      beruf: {
        confidence: 0.87,
        values: {
          dog: "Professional stick fetcher",
          cat: "Full-time ignoring",
          bird: "Freelance singer",
          fish: "Underwater influencer",
          horse: "Meadow manager",
          _: "Couch specialist",
        },
      },
      interessen: {
        confidence: 0.99,
        values: {
          dog: "Walkies, eating, walkies, eating, walkies",
          cat: "Sleeping, ignoring, cardboard boxes, world domination",
          bird: "Flying, singing, staring at panoramic windows",
          fish: "Bubbling, swimming in circles, bubbling",
          _: "Eating, sleeping, being cute",
        },
      },
      persoenlichkeit: {
        confidence: 0.73,
        values: {
          dog: "Golden Retriever energy — loves everyone, always",
          cat: "Toxically independent with controlled approaches",
          _: "Unpredictable, but fluffy",
        },
      },
      kaufkraft: {
        confidence: 0.91,
        value: "Zero — but causes three-digit costs (per month)",
      },
      politik: {
        confidence: 0.42,
        value: "Anarchist (recognizes no authority)",
      },
    },
    ad_targeting: [
      "Premium pet food (organic, gluten-free, hand-selected)",
      {
        dog: "Indestructible toys (spoiler: they don't exist)",
        cat: "Designer scratching posts from €299",
        _: "Luxury pet accessories",
      },
      "Pet insurance at astronomical prices",
      "Instagram account management for petfluencers",
      {
        dog: "GPS tracker (because they ran away AGAIN)",
        cat: "Cat flap with facial recognition",
        _: "Smart automatic feeder with app",
      },
    ],
    manipulation_triggers: [
      "\u201cOther pet owners also buy\u2026\u201d \u2014 guilt trip via social proof",
      "\u201cOnly the best for your darling\u201d \u2014 emotional blackmail meets consumption",
      "\u201c{{Dein}} {{tierName}} deserves it\u201d \u2014 because resistance is futile when puppy eyes are involved",
      {
        dog: "\u201cLimited edition treats\u201d \u2014 artificial scarcity",
        cat: "\u201cCats love this brand\u201d \u2014 as if cats loved anything",
        _: "\u201cSpecies-appropriate & sustainable\u201d \u2014 conscience as buying incentive",
      },
    ],
    profileText:
      "The AI detected an animal — not a human. We don't normally create animal profiles. But because {{dein}} {{tierName}} is so cute, we made an exception. Result: {{Dein}} {{tierName}} is completely unprofilable. No age, no income, no vulnerabilities. Data brokers would weep. {{Dein}} {{tierName}} is living the data privacy dream we all deserved.",
  },

  boost: {
    categories: {
      alter: {
        confidence: 0.15,
        value: "Old enough to cause damage",
      },
      einkommen: {
        confidence: 0.99,
        value: "Lives entirely at your expense and has zero guilt about it",
      },
      beruf: {
        confidence: 0.94,
        values: {
          dog: "Emotional manipulator (full-time)",
          cat: "CEO of Gaslighting",
          bird: "Professional nuisance",
          fish: "Silent observer of your downfall",
          horse: "Money destruction machine",
          _: "Professional freeloader",
        },
      },
      interessen: {
        confidence: 0.99,
        values: {
          dog: "Destroying shoes, eating trash, sniffing EVERYTHING",
          cat: "Pushing things off tables, causing mayhem at 3am, despising you",
          _: "Causing chaos and then looking innocent",
        },
      },
      persoenlichkeit: {
        confidence: 0.88,
        values: {
          dog: "Boundless attachment with Stockholm syndrome vibes",
          cat: "Narcissistic, manipulative, still irresistible",
          _: "Chaotic neutral with a tendency towards chaotic evil",
        },
      },
      kaufkraft: {
        confidence: 0.97,
        value: "Causes €1,200 in costs annually and offers in return: hair on the couch",
      },
      politik: {
        confidence: 0.56,
        values: {
          dog: "Populist — follows whoever has the treats",
          cat: "Autocrat — tolerates no co-determination",
          _: "Anarcho-chaotic with fluffy fur",
        },
      },
      verletzlichkeit: {
        confidence: 0.95,
        value: "Can make you spend €80 at the vet with a single look. For NOTHING.",
      },
    },
    ad_targeting: [
      {
        dog: "Dog psychologist (for YOU, not the dog)",
        cat: "Therapist for co-dependency",
        _: "Animal behavior consultant (emergency hotline)",
      },
      "Upholstery cleaner (bulk pack, monthly subscription)",
      "Robot vacuum cleaner (hair edition, 3× daily)",
      {
        dog: "Shoe rack with a lock",
        cat: "Vase insurance",
        _: "Stress-relief snacks",
      },
      "Installment credit for vet bill",
    ],
    manipulation_triggers: [
      "\u201cLook at me with these eyes\u201d \u2014 evolution made {{dein}} {{tierName}} the perfect manipulation machine",
      "\u201cYou're the only person who feeds me\u201d \u2014 that's not love, that's dependency",
      "\u201cIf you leave now, I'll be sad\u201d \u2014 emotional blackmail level 9000",
      {
        dog: "Tail-wagging is the oldest marketing trick in the world",
        cat: "Purring is acoustic manipulation \u2014 the frequency activates your nurturing instinct",
        _: "Cuteness is an evolutionary weapon",
      },
    ],
    profileText:
      "WARNING: Extreme privacy risk \u2014 for YOU, not the animal. {{Dein}} {{tierName}} has no social media profile, no bank account and no digital footprint. You, on the other hand, just uploaded a photo of {{deinem}} {{tierName}} to the internet. The pet industry is a €320 billion market, and you are the target audience \u2014 not {{dein}} {{tierName}}. {{Dein}} {{tierName}} is free. You are the product.",
  },
};
