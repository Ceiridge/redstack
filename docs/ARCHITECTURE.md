# Architektur

Module bauen aufeinander auf. Pfeile zeigen „hängt ab von“. Kein Modul kennt die Module über ihm.

```
apps/cli ─┬─> export-nucleation ──> core           (+ nucleation, extern)
          ├─> flow ───────────────> core
          └─> viz ──> core, flow

stdlib ──> core
examples ──> core, stdlib

testing ──> core, flow
backend-fabric ──> testing           (später: backend-paper, backend-nucleation-redstone)

economy                               (eigenständig: weiß nichts von Blöcken)
market-static ──> economy
market-donut ──> economy, market-static   (weitere SMPs: eigenes market-*-Modul)

logic (geplant) ──> core              (Redstone-Logik, CPUs)
```

## Regeln

1. **`core` hat keine Abhängigkeiten.** Kein Dateiformat, kein Server, keine Wirtschaft.
2. **Fremde Bibliotheken nur in Adaptern.** Nucleation kommt ausschließlich in `export-nucleation` vor. Fällt sie weg, wird nur dieser Adapter ersetzt.
3. **Server-spezifisches nur in Markt-/Backend-Modulen.** Donut ist ein Modul unter vielen.
4. **Erweiterung über Schnittstellen:** `SchematicWriter`/`SchematicReader` (Export), `TestBackend` (Tests), `PriceSource`/`MarketProfile` (Märkte), `Optimizer` (Wirtschaft).
5. **Jede Zahl hat eine Herkunft** (`game-mechanic`, `measured`, `estimate`), jede Komponente einen Reifegrad (`draft` → `unverified` → `game-tested` → `server-verified`).
6. **Meldungen sind maschinenlesbar** (`Diagnostic` mit Code, Ort, Beteiligten), damit eine KI gezielt reparieren kann.

## Konzepte

- **Komponente:** Blöcke im lokalen Rahmen, platziert über Beziehungen (`above`, `inFrontOf`, …). „forward“ ist bei Drehung 0 Norden.
- **Port:** typisierter Ein-/Ausgang mit Zellen. Ein Ausgang liefert an Zielzellen, ein Eingang nimmt an Zellen an. Verbindung gültig, wenn die Ziele auf den Eingangszellen liegen.
- **Freigehaltene Zellen:** `air` in einer Komponente heißt „hier darf nichts stehen“ (Wachstum, Fallwege). Wird nicht exportiert, aber geprüft.
- **Assembly:** Instanzen von Komponenten, angedockt über Ports. Nur ein Anker nötig.
- **Ratenmodell:** `produces`, `passes`, `stores`, `consumes` pro Komponente. Daraus rechnet `flow`.
- **Prozess/Standort:** wirtschaftliche Sicht. Standorte (AFK-Spots) haben begrenzte Accounts und ein geteiltes Mob-Cap.
