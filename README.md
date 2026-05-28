# Deutsch Übungen

Camis selbstgebautes C1-Deutsch-Übungstool — generiert Übungen aus den
wöchentlichen Klassen-Notizen.

**Live:** https://iamcamisp.github.io/deutsch-uebungen/

## Funktionen

- 6 Übungstypen: Multiple-Choice, Umformung (Konjunktiv I), Wortstellung,
  Lückentext, Wortschatzkarten, Schreibübung
- Eine Übung pro Bildschirm mit Zurück / Weiter-Navigation
- Sofortiges Feedback mit Erklärungen
- Fortschritt + Streak + Korrekt-Quote in localStorage
- Textabgabe öffnet WhatsApp-Chat mit Cami's Assistant zur Korrektur

## Inhalt aktualisieren

```bash
./update_and_push.sh
```

Was das macht:
1. Liest die letzten 6 Wochen Klassen-Notizen aus dem Google Doc
2. Schickt sie an Claude mit einem Prompt, der frische Übungen rund um
   die Grammatik-Themen erzeugt, die in den Klassen vorkamen
3. Merged mit `exercises.json` (bestehende IDs bleiben erhalten)
4. Committet und pusht — GitHub Pages deployt automatisch

## Struktur

- `index.html` — App-Shell
- `style.css` — Styling
- `script.js` — Navigation, Scoring, Feedback
- `exercises.json` — Inhalte (von Claude generiert)
- `generate_exercises.py` — Generator
- `update_and_push.sh` — Wrapper-Script

## Konfiguration

In `exercises.json`:
- `whatsapp_target` — WhatsApp-Nummer für Textabgaben (aktuell: Camis
  PA-Nummer)
- `source_doc` — Google-Doc-ID der Klassen-Notizen

## Lokal testen

```bash
python3 -m http.server 8765
# → http://localhost:8765
```
