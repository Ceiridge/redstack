# Hinweise für KI-Assistenten

Lies zuerst `docs/ARCHITECTURE.md` und `docs/PLAN.md`.

## Arbeitsweise
- Bauen und testen: `pnpm test`. Beispiel durchlaufen: `pnpm example`.
- Neue Farm: Komponenten aus `@redstack/stdlib` per `attach`/`connect` verbinden, dann `redstack all <modul> -o out/x.litematic`. Erst wenn `check` keine Fehler meldet, ist der Bauplan geometrisch konsistent – nicht funktionsfähig.
- Nie eine Komponente als `game-tested` markieren ohne grünen Test auf einem Backend.
- Raten immer mit Herkunft angeben. Schätzungen als `estimate` kennzeichnen.
- Block-States nur über die semantischen Helfer setzen (`outputTo`, `signalTowards`, `watching`, `pushing`), nicht über rohe `facing`-Werte – dort liegen die typischen Fehler.
- Fremde Bibliotheken nur in Adapter-Paketen; neue Abhängigkeiten nach `docs/SECURITY.md`.

## Sprache
Code-Bezeichner englisch, Kommentare und Meldungen deutsch.
