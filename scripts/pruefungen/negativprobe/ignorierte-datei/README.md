# Beispielprojekt

Hier steht nichts Verbotenes.

## Was diese Probe zeigt — und was nicht

**Zeigt sie:** Läuft die Prüfung in einem Arbeitsverzeichnis, in dem
`notizen-lokal.md` liegt und per `.gitignore` ausgeschlossen ist, wird die Datei
nicht geprüft. Genau das war TEST-2026-08-12-29: Auditberichte zitieren verbotene
Formulierungen naturgemäß, um sie zu melden — der lokale Lauf war deshalb dauerhaft
rot, während die CI grün war.

**Zeigt sie nicht:** In einer frischen Auscheckung existiert `notizen-lokal.md`
gar nicht (sie ist ja ignoriert und damit nie committet). Dort besteht die Probe
aus dem falschen Grund — nicht weil die Datei übersprungen wird, sondern weil es
sie nicht gibt. Die Aussagekraft liegt im lokalen Lauf, und dort lag auch der
Schaden.
