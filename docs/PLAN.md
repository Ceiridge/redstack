# Plan

Ziel: Minecraft-Farmen (später auch Redstone-Logik bis hin zu CPUs) als Code beschreiben, automatisch prüfen und testen, als Schematic exportieren – so, dass eine KI zuverlässig neue Farmen zusammensetzen, verbessern und wirtschaftlich bewerten kann.

Leitidee: **Ein Graph, drei Auflösungen.**

| Ebene | Frage | Werkzeug |
|---|---|---|
| Wirtschaft | Was lohnt sich wo? | `economy` + Markt-Module |
| Bauplan | Wie fließen Items durch die Farm? | `core` + `flow` |
| Messung | Stimmt das im Spiel? | `testing` + Backends |

Jede Ebene kontrolliert die nächste: Messungen prüfen das Ratenmodell der Komponenten, geprüfte Ratenmodelle machen die Wirtschaftsrechnung belastbar.

## Prüfstufen

| Stufe | Was | Dauer | Paket |
|---|---|---|---|
| 0 | Statische Checks: Überlappung, freigehaltene Zellen, Port-Passung, Typen, Übersprechen | ms | `core` |
| 1 | Flussmodell: Raten, Engpässe, Inputs, Füllzeiten | ms | `flow` |
| 2 | Komponententest auf Backend | Sekunden | `testing` + Backend |
| 3 | Ganze Assembly, mehrere Läufe, Statistik | Minuten | `testing` + Backend |

## Phasen

Jede Phase hat ein Abschlusskriterium. Erst wenn es erfüllt ist, gilt die Phase als fertig.

### Phase 0 – Nucleation prüfen ✅ (bis auf Spieltest)
- [x] `.litematic` per npm schreiben, Block-States und Drehungen per Roundtrip prüfen
- [x] Unabhängige Gegenprüfung mit litemapy (älteres Format, Datenversion 4903): alle Blöcke identisch
- [ ] **Offen: im Spiel prüfen.** `out/cactus-farm.litematic` in Litematica (26.3) laden. Nucleation schreibt ab Datenversion 5006 die Palette als `{id, properties}` statt `{Name, Properties}` – laut Nucleation ist das das neue Format von 26.3. Nicht unabhängig bestätigt.

**Ergebnis:** Nucleation wird genutzt, nur hinter `export-nucleation`.

### Phase 1 – Kern ✅ (Grundgerüst)
- [x] Geometrie mit relativen Richtungen und Drehung
- [x] Block-States mit semantischen Helfern (`outputTo`, `signalTowards`, `watching`, `pushing`) und Drehung aller richtungsabhängigen Properties
- [x] Komponenten mit Beziehungen statt Koordinaten, typisierte Ports (items, fluid, signal, bus)
- [x] Assemblies: andocken über Ports (`attach`), Reihen (`row`), Verbindungen
- [x] Statische Checks
- [ ] Spiegeln (mirror) von Komponenten
- [ ] Mehrdeutige Beziehungen ohne Richtung (z. B. „neben“) mit Fehlermeldung
- [ ] Import erprobter Schematics als Komponente (Reader ist vorhanden)

**Abschluss:** Eine Farm aus drei Komponenten wird ohne eine einzige Koordinate (außer dem Anker) beschrieben, geprüft und exportiert. ✅ siehe `examples/`

### Phase 2 – Flussmodell ✅ (Grundgerüst)
- [x] Raten pro Port, Engpässe, Füllzeiten, Inputs, verlorene Items, Sackgassen
- [x] Herkunft jeder Zahl (`game-mechanic` / `measured` / `estimate`)
- [ ] Verteilungen statt Mittelwerte (für Zufallsmechaniken)
- [ ] Brennstoff/Energie als eigene Flüsse

### Phase 2b – Wirtschaft
- [x] Prozesse, Standorte (AFK-Spots), Accounts, Mob-Cap-Konkurrenz, Absatzgrenzen, Plan-Bewertung
- [x] Markt-Schnittstelle, statische Preisquelle (jeder SMP), Donut-Modul
- [ ] Optimierer: gemischt-ganzzahlige lineare Optimierung (Anzahl je Prozess und Standort). Solver-Auswahl nach Sicherheitsprüfung (siehe SECURITY.md)
- [ ] Brücke: Assembly + Flussmodell → `Process` automatisch
- [ ] Donut: Konverter für die veröffentlichte donutflipper-Preishistorie (Lizenz prüfen)
- [ ] Simulationsradius: Prozesse an einem Standort müssen gemeinsam geladen sein

**Abschluss:** Für eine Preisliste schlägt der Optimierer einen Plan vor, der die Account- und Mob-Cap-Grenzen einhält.

### Phase 3 – Testumgebungen (auf deinem PC, Claude Code)
- [ ] Backend „fabric-carpet“: Server-Dateien per Manifest mit SHA-256, Container ohne Netz, RCON-Steuerung
- [ ] Pro Szenario eine Void-Dimension, Fake-Player am AFK-Spot, Hopper-Counter, `/tick sprint`
- [ ] Komponententests über das GameTest-Framework (seit 1.21.5 in Vanilla)
- [ ] Ereignisse mit Ort: verstopfte Hopper, Items am Boden, zerstörte Items
- [ ] Mehrere Serverprozesse parallel
- [ ] Backend „nucleation-redstone“ für reine Logik (Simulation aus dem Submodule bauen)
- [ ] Später: Backend „paper“ mit Server-Profilen

**Abschluss:** Der Test einer Komponente läuft per Befehl automatisch durch, liefert JSON und schlägt fehl, wenn die Messung vom Flussmodell abweicht.

### Phase 4 – Visualisierung
- [x] Datenmodell (`viz`): Blöcke, Instanzen, Flüsse, Auslastung, markierte Stellen
- [ ] 3D-Viewer im Browser (Kandidaten: Nucleation-Renderer, deepslate-basierte Renderer – vorher prüfen)
- [ ] Einblendungen: Flussstärke, Engpässe rot, Ereignisse aus Tests, Vergleich zweier Läufe

**Abschluss:** Bei einer absichtlich kaputten Farm ist die Fehlerstelle im Viewer sofort sichtbar.

### Phase 5 – Standardbibliothek und KI-Schleife
- [ ] 10–20 erprobte Komponenten (aus Archiven nachgebaut, Lizenz und Urheber beachten), jede mit Test und Doku
- [ ] Komponenten-Doku auch für die KI geschrieben: Ports, Raten, Grenzen, bekannte Fallen
- [ ] Schleife: schreiben → Stufe 0 → Stufe 1 → Test → reparieren

**Abschluss:** Die KI setzt aus der Bibliothek eine neue Farm-Variante zusammen, die alle Tests besteht, ohne menschlichen Eingriff.

### Phase 6 – Entdeckung
- [ ] Parametersuche über Varianten (Flussmodell siebt vor, Testserver bewertet)
- [ ] Mechanismen-Katalog: Wege, wie das Spiel Items erzeugt, mit Verweis auf den (seit 26.1 unverschleierten) Quellcode
- [ ] Experiment-Modus: kleine isolierte Tests einzelner Mechaniken
- [ ] Exploit-/Dupe-Kennzeichnung, standardmäßig ausgeschlossen

**Realistische Erwartung:** Verbesserungen und neue Kombinationen ja, grundlegend neue Mechaniken selten.

### Phase 7 – Redstone-Logik (Zukunft)
- [ ] Paket `logic`: Gatter, Register, Busse auf Basis der `signal`/`bus`-Ports
- [ ] Timing-Modell (Redstone-Ticks) als Gegenstück zum Flussmodell
- [ ] Import aus Verilog über Yosys statt eigener Logiksynthese
- [ ] Simulation über Nucleation/Redpiler

## Offene Entscheidungen
- Projektname (Arbeitstitel „redstack“)
- Auf welcher Version läuft der Zielserver? Mechaniken können sich zwischen Versionen unterscheiden.
- Viewer-Technik (Phase 4)
- LP-Solver (Phase 2b)
