# redstack

Minecraft-Farmen als Code: Komponenten mit Ports, statische Prüfung, Flussmodell, Wirtschaftsbewertung, Tests und Export als Schematic.

> Arbeitstitel. Privates Projekt. Stand: Grundgerüst (siehe `docs/PLAN.md`).

```ts
const farm = new Assembly("Kaktusfarm");
const row  = farm.row(CactusCell, 16, steps("forward", 2));
const belt = farm.add(HopperLine, { length: 31 }).attach("in", row[0]!.port("drops"));
for (const cell of row.slice(1)) farm.connect(cell.port("drops"), belt.port("in"));
farm.add(Chest).attach("in", belt.port("out"));
```

```
$ pnpm example
Kaktusfarm-16: 18 Instanzen, 160 Zellen
Ertrag (in Lagern):
  minecraft:cactus: 52,7 /h
Engpässe: keine
Lager:
  Chest#1: 52,7 /h, voll nach 32,8 h
Geschrieben: out/cactus-farm.litematic
```

## Start

Voraussetzungen: Node ≥ 22.18, pnpm 10 (`corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm example
```

## Module

| Paket | Zweck |
|---|---|
| `core` | Geometrie, Blöcke, Komponenten, Ports, Assemblies, statische Checks |
| `flow` | Flussmodell: Raten, Engpässe, Füllzeiten |
| `export-nucleation` | Schematic-Export (Adapter für Nucleation) |
| `stdlib` | Komponenten (alle noch `unverified`) |
| `economy` | Prozesse, Standorte/AFK-Spots, Märkte, Plan-Bewertung |
| `market-static` | Preise aus JSON-Datei, für jeden SMP |
| `market-donut` | DonutSMP-Profil |
| `testing` | Szenarien, Backends, Berichte, Modellabgleich |
| `backend-fabric` | Fabric + Carpet Testserver (Phase 3, Stub) |
| `viz` | Datenmodell für den Viewer (Phase 4) |
| `apps/cli` | `redstack check/flow/build/all` |

Mehr: `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/SECURITY.md`.

## Wichtig
Keine Komponente ist bisher im Spiel getestet. Ein fehlerfreier `check` heißt: geometrisch konsistent, nicht: funktioniert.
