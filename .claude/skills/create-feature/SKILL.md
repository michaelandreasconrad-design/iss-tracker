---
name: create-feature
description: Creates a new feature spec file under ai_docs/features/NNN_feat_name.md (NNN is next available index). The spec covers context, requirements, definition of done, and design details. Use when the user requests a new feature plan/spec.
---

# Create Feature Spec

Erzeugt genau eine Datei: `ai_docs/features/NNN_<slug>.md`. Kein Code, kein Plan, keine Implementierung.

## Output-Stil: i-have-adhd (Pflicht)

Quelle: Plugin `i-have-adhd@i-have-adhd` (https://github.com/ayghri/i-have-adhd).
Zweck hier: tokensparend arbeiten — die Spec steht in der Datei, nicht im Chat.

- Läuft in der Session bereits ADHD-Modus (`/i-have-adhd`): nichts nachladen, Regeln gelten schon.
- Sonst: die Kurzregeln unten anwenden. Den Volltext (`~/.claude/plugins/cache/i-have-adhd/i-have-adhd/*/skills/i-have-adhd/SKILL.md`) nur lesen, wenn der Nutzer ihn ausdrücklich will — das Lesen kostet mehr Tokens, als es spart.

Kurzregeln für dieses Skill:

1. Antwort zuerst: erste Zeile = Pfad der erzeugten Datei.
2. Kein Preamble ("Ich werde jetzt…"), kein Recap, keine Schlussfloskel.
3. Spec-Inhalt nie im Chat wiederholen oder zusammenfassen — die Datei ist der Inhalt.
4. Listen im Chat max. 5 Einträge. Offene Fragen gehören in die Datei, nicht in die Antwort.
5. Genau eine konkrete nächste Aktion am Schluss (< 2 Minuten), z. B. "Datei öffnen und Anforderungen prüfen."
6. Fehler sachlich: Ort, Ursache, Fix. Kein "Ups".
7. Rückfrage nur bei echter Mehrdeutigkeit — genau eine, kurz. Sonst Annahme treffen und in "Offene Fragen" notieren.

## Ablauf (tokensparend)

1. `ls ai_docs/features` — nur das. Kein Repo-Scan, keine Suche nach ähnlichen Specs, keine bestehenden Specs lesen.
2. NNN = höchster vorhandener Index + 1, dreistellig. Slug = kurz, sprechend, lower_snake_case.
3. Datei in **einem** Write-Call anlegen (Template unten). Kein Entwurf im Chat, keine Iterationsrunde.
4. Antworten: Pfad + eine nächste Aktion.

Codebase nur anfassen, wenn "Betroffene Bereiche" sonst geraten wäre — dann gezielt grep/glob, max. 2 Calls, keine ganzen Dateien lesen.

## Specification Template

Alle Abschnitte sind Pflicht. **"Tests"** darf nie leer bleiben — auch bei kleinen Features oder Bugfixes mindestens ein absichernder Testfall.

```
# <Feature Title>

## Kontext & Problemstellung
<!-- Kurz beschreiben, welchen Bedarf/Problem das Feature adressiert -->

## Anforderungen
- [ ] Liste aller Anforderungen als einzelne Bulletpoints (deutsch)
- [ ] sowohl User Stories ("Als ... möchte ich ...") als auch technische Wünsche

## Definition of Done
- [ ] Kriterien, wann das Feature als "fertig" gilt (funktional, UI, Review etc.)
- [ ] Automatisierte Tests vorhanden und grün (siehe Abschnitt "Tests")

## Betroffene Bereiche & Technik
<!-- Wo im Code, UI, API? Welche Komponenten sind betroffen? -->

## Tests
<!-- IMMER ausfüllen. Konkrete Testfälle benennen, die das Feature absichern:
     - welche Ebene (Unit, Integration, E2E) und welcher Runner
       (Frontend: Vitest unter `frontend/src/**/*.test.ts(x)`;
        Backend: pytest unter `backend/tests/`)
     - die wichtigsten Happy-Path- und Edge-/Fehlerfälle als Bulletpoints
     - bei Bugfixes: ein Regressionstest, der ohne den Fix fehlschlägt -->
- [ ] Liste der konkreten Testfälle (deutsch)

## Umsetzungsideen / Hinweise (optional)
<!-- Lösungsansätze oder Designwünsche -->

## Offene Fragen / Abhängigkeiten (optional)
<!-- Was muss noch geklärt werden? -->
```

## Guardrails

- NNN immer hochzählen, bestehende Specs nie überschreiben.
- Specs nur unter `ai_docs/features/`.
- Dateiinhalt auf Deutsch, außer der Nutzer will es anders.
- Vollständige Vorlage auch bei kleinen Wünschen — aber knapp formuliert, keine Fülltexte.
- "Tests" mit konkreten, überprüfbaren Fällen füllen (nicht "Tests schreiben"). Bei Bugfixes mindestens ein Regressionstest.
- Feature nicht implementieren, keinen Code ändern, keine PRs.
