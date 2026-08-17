# ENTWURF — Barrierefreiheitserklärung

> **Nichts davon ist veröffentlicht.** Dieser Entwurf liegt zum Lesen und Freigeben.
> Er geht erst live, wenn Christoph ihn Satz für Satz freigegeben hat. Vorgesehener
> Ort wäre eine eigene Seite `/barrierefreiheit`, verlinkt in der Fußzeile neben
> Impressum, Datenschutz und Nutzungsbedingungen.
>
> **Zwei Stellen sind noch offen** und im Text mit `⟨…⟩` markiert: die
> Konformitätsaussage und das Datum — beide hängen am VoiceOver-Durchgang.

---

## Barrierefreiheit

### Unser Anspruch

malziME ist ein Lern-Tool für Medienkompetenz und richtet sich an Schulen. Wer über
Datenschutz aufklärt, muss auch bei der Bedienbarkeit sauber arbeiten. Wir haben
malziME deshalb gegen den internationalen Standard **WCAG 2.2, Stufe AA** geprüft —
und zwar messend, nicht behauptend.

Wir sind dazu gesetzlich nicht verpflichtet. Das österreichische
Barrierefreiheitsgesetz (BaFG), anwendbar seit 28. Juni 2025, nimmt in **§ 6 Abs. 1**
Kleinstunternehmen aus, die Dienstleistungen anbieten — das sind Unternehmen mit
weniger als 10 Beschäftigten und höchstens 2 Millionen Euro Jahresumsatz oder
Bilanzsumme. malziland ist ein Einpersonenunternehmen und fällt darunter.

Wir tun es trotzdem, weil unsere Zielgruppe Schulen sind — öffentliche Stellen mit
eigener Verpflichtung — und weil ein Werkzeug, das Menschen ausschließt, seinen Zweck
verfehlt.

### Stand der Vereinbarkeit

⟨**Diese Seite ist weitgehend konform mit WCAG 2.2 Stufe AA.** Von 55 Erfolgs-
kriterien sind 40 nachgewiesen erfüllt und 11 nicht anwendbar, weil malziME keine
Video- oder Tonbeiträge, keine Anmeldung, keine Zeitbegrenzung und kein Formular mit
personenbezogenen Daten enthält. Vier weitere Kriterien sind messtechnisch erfüllt und
werden derzeit zusätzlich von Hand mit einem Screenreader geprüft.⟩

⟨*Nach Abschluss der Handprüfung wird dieser Absatz ersetzt durch:* „Diese Seite ist
konform mit WCAG 2.2 Stufe AA."⟩

### Was wir geprüft haben — und wie

Geprüft wurden alle fünf Seiten in allen wesentlichen Zuständen: leere Startseite,
Warteschlange, laufende KI-Ausgabe, fertiges Profil im seriösen und im Beast-Modus,
Fehlermeldungen, geöffnete Hinweise. Am Rechner und bei 320 Pixel
Bildschirmbreite, in Chromium **und in WebKit** — der Maschine hinter Safari, weil
unsere Workshops auf iPhones stattfinden. Das dunkle Erscheinungsbild des
Beast-Modus wurde eigens mitgeprüft.

Eingesetzt wurden das Prüfwerkzeug axe-core, beschränkt auf die verbindlichen
WCAG-Regeln, sowie eigene Messungen für Zielgrößen, Umbruch, Textvergrößerung,
Textabstände und Fokus-Sichtbarkeit. Jede Messung läuft doppelt; übernommen wird nur,
was beide Male auftritt.

**Das vollständige Prüfprotokoll mit allen 55 Kriterien, dem Prüfweg und dem Ergebnis
je Kriterium stellen wir auf Anfrage zur Verfügung.**

### Bekannte Einschränkungen

Wir nennen sie, statt sie zu verschweigen.

**Die Demo-Fotos enthalten Text als Bild.** Die Kennzeichnung „KI erstellt"
beziehungsweise „AI generated" ist in die Bildpunkte gebrannt. Hintergrund:
**Artikel 50 der EU-KI-Verordnung** gilt seit 2. August 2026. Betreiber müssen
offenlegen, dass Bildinhalte künstlich erzeugt oder manipuliert wurden; die Regelung
erfasst dabei ausdrücklich auch Bilder nicht existierender Personen. Eine Ausnahme für
kleine Unternehmen gibt es nicht. Wir setzen die Kennzeichnung in die Bildpunkte, weil
eine Kennzeichnung daneben verschwindet, sobald jemand das Bild speichert und
weiterschickt — und Weiterschicken ist im Workshop der Normalfall.

Für Menschen, die nicht sehen, ist die Information deshalb zusätzlich im
Alternativtext und in den strukturierten Daten hinterlegt und wird von Screenreadern
vorgelesen. WCAG 2.2 lässt Text im Bild zu, wenn er wesentlich ist (Kriterium 1.4.5);
diese Ausnahme greift hier.

**Die höchste Stufe AAA streben wir nicht an.** Das W3C empfiehlt sie ausdrücklich
nicht als Anforderung für ganze Websites. Zehn AAA-Kriterien erfüllen wir dennoch,
sechs nachweislich nicht — darunter das erhöhte Kontrastverhältnis von 7 : 1, das
einen Umbau unserer Markenfarben erfordern würde, und die Lesbarkeitsstufe, die eine
zweite, vereinfachte Fassung aller Rechtstexte verlangt.

**Die eingebettete Landkarte** stammt von OpenStreetMap und wird von uns nicht
gestaltet. Ihre Inhalte sind zusätzlich als Text verfügbar.

### Was wir bewusst nicht einsetzen

**Kein Barrierefreiheits-Overlay.** Werkzeuge wie accessiBe oder UserWay versprechen
Barrierefreiheit per Klick und liefern ein Abzeichen mit. Sie verschlechtern die
Bedienung für Menschen mit Screenreader nachweislich. Wir halten ein solches
Abzeichen für ein Warnsignal, nicht für einen Ausweis.

**Kein gekauftes Siegel.** Wir haben eine externe Zertifizierung geprüft und uns
dagegen entschieden. Ein nachvollziehbares Prüfprotokoll mit offen benannten Lücken
sagt mehr als eine Urkunde ohne Prüfweg.

### Etwas gefunden? Bitte melden.

Wenn Sie auf eine Barriere stoßen, schreiben Sie uns:

**barrierefreiheit@malzi.me**

Wir antworten **innerhalb von zwei Wochen**. Bitte beschreiben Sie, wenn möglich,
welche Seite betroffen ist und mit welchem Gerät oder Hilfsmittel Sie unterwegs
waren. Auch ein knapper Hinweis hilft — wir suchen selbst weiter.

Sollten Sie sich durch eine Barriere benachteiligt fühlen, steht Ihnen unabhängig
von uns das **Schlichtungsverfahren beim Sozialministeriumservice** offen. Es ist
kostenfrei und formlos, wird von ausgebildeten Schlichtungsreferentinnen und
-referenten geführt, und anfallende Dolmetschkosten trägt das Sozialministeriumservice.
Antragstellung online oder in Papierform:
[sozialministeriumservice.gv.at](https://www.sozialministeriumservice.gv.at/Menschen_mit_Behinderung/Gleichstellung/Schlichtung/Schlichtung.de.html)

Der Vollständigkeit halber: Dieses Verfahren gehört zum Behindertengleichstellungsrecht
und betrifft Diskriminierung. Es ist nicht das Beschwerdeverfahren des
Barrierefreiheitsgesetzes — dem unterliegen wir als Kleinstunternehmen nicht (siehe
oben). Wir nennen es, weil wir den Weg nicht verstecken wollen, nicht weil wir dazu
verpflichtet wären.

### Verantwortlich

malziland - learning | training | consulting e.U., Inhaber Christoph Krieger.
Kontaktdaten im [Impressum](/impressum).

### Diese Erklärung

Erstellt am ⟨Datum der Freigabe⟩ auf Grundlage einer Selbstbewertung mit den oben
genannten Werkzeugen. Wir prüfen erneut bei jeder Änderung an Aussehen, Bedienung
oder Seitenaufbau, mindestens aber halbjährlich. Die maschinellen Messungen laufen
bei jeder Auslieferung automatisch mit.

---

## Belegte Grundlagen

| Aussage | Beleg |
|---|---|
| BaFG nimmt Kleinstunternehmen bei Dienstleistungen aus (§ 6 Abs. 1); < 10 Beschäftigte und ≤ 2 Mio. € | [Sozialministeriumservice](https://www.sozialministeriumservice.gv.at/Marktueberwachung_digitale_Barrierefreiheit/Informationen_fuer_Unternehmen/Ausnahme_Kleinstunternehmen/Ausnahmen-fuer-Kleinstunternehmen.de.html), [WKO](https://www.wko.at/ce-kennzeichnung-normen/informationen-zum-barrierefreiheitsgesetz) |
| Schlichtung: durch Schlichtungsreferent:innen des Sozialministeriumservice, kostenfrei und formlos, Dolmetschkosten getragen, vor Gericht verpflichtend. **Betrifft Diskriminierung nach Behindertengleichstellungsrecht, nicht das BaFG-Beschwerdeverfahren** | [Primärquelle Sozialministeriumservice](https://www.sozialministeriumservice.gv.at/Menschen_mit_Behinderung/Gleichstellung/Schlichtung/Schlichtung.de.html), abgerufen 17.08.2026 |
| Artikel 50 EU-KI-Verordnung gilt ab 2. August 2026; Betreiber müssen künstlich erzeugte Bildinhalte offenlegen, auch Bilder nicht existierender Personen; keine Ausnahme für kleine Unternehmen | [Artikeltext AI Act](https://artificialintelligenceact.eu/article/50/), abgerufen 17.08.2026 |
| `malzi.me` nimmt Mail an (MX bei IONOS) | `dig +short MX malzi.me` → `mx00.ionos.de`, `mx01.ionos.de` |

## Was vor der Veröffentlichung noch von Christoph zu entscheiden ist

1. **Die Konformitätsaussage** — hängt am VoiceOver-Durchgang. Ohne ihn bleibt
   „weitgehend konform".
2. **Die Antwortfrist** — zwei Wochen sind vorgeschlagen. Das ist eine Zusage nach
   außen; sie muss haltbar sein.
3. **Der Absatz zur Schlichtung** — er ist jetzt sachlich richtig. Wir sind nicht
   verpflichtet, ihn zu führen; er wirkt aber souverän. Drinlassen oder weg?
4. **Der Ort** — eigene Seite `/barrierefreiheit` mit Verweis in der Fußzeile. Das
   wäre ein vierter Rechtslink; die Fußzeile wird dadurch länger.
