# redstack

Minecraft farms as code: components with ports, static checks, a flow model, economic evaluation, in-game tests on a real server, and schematic export.

> Working title. Private project. Status: see [docs/PLAN.md](docs/PLAN.md).

```ts
const farm = new Assembly("cactus-farm");
const row  = farm.row(CactusCell, 16, steps("forward", 3));
const belt = farm.add(HopperLine, { length: 46 }).attach("in", row[0]!.port("drops"));
for (const cell of row.slice(1)) farm.connect(cell.port("drops"), belt.port("in"));
farm.add(Chest).attach("in", belt.port("out"));
```

```
$ pnpm example
cactus-farm-16: 18 instances, 335 cells
No findings.
Yield (into storage):
  minecraft:cactus: 44.8/h
Bottlenecks: none
Storage:
  Chest#1: 44.8/h, full after 38.6 h
Written: out/cactus-farm.litematic

$ pnpm test:game cactus-farm-16
PASS cactus-farm-16 (fabric-carpet, 1 run(s))
  measured minecraft:cactus: 45/h
  ok   matches-flow-model: Measurement matches the model.
  ok   no-ground-items: No items on the ground.
  ok   no-stuck-hoppers: No hoppers backed up.
```

## Getting started

Requirements: Node ≥ 22.18, pnpm 10 (`corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm test        # build + unit tests
pnpm example     # checks, flow model and export for the example farm
```

In-game tests need a local test server: see [packages/backend-fabric/README.md](packages/backend-fabric/README.md).

## Packages

| Package | Purpose |
|---|---|
| `core` | Geometry, blocks, components, ports, assemblies, static checks |
| `flow` | Flow model: rates, bottlenecks, fill times |
| `export-nucleation` | Schematic export (adapter for Nucleation) |
| `stdlib` | Components |
| `economy` | Processes, sites/AFK spots, markets, plan evaluation |
| `market-static` | Prices from a JSON file, for any SMP |
| `market-donut` | DonutSMP profile |
| `testing` | Scenarios, backends, reports, model comparison |
| `backend-fabric` | Fabric + Carpet test server over RCON |
| `viz` | Data model for the viewer (phase 4) |
| `apps/cli` | `redstack check/flow/build/all/test` |

## Component status

| Component | Status | Evidence |
|---|---|---|
| `HopperLine` | game-tested | 9,000 items/h measured = model |
| `Chest` | game-tested | used as storage in all scenarios |
| `SupplyChest` | game-tested | test fixture |
| `CactusCell` | game-tested | survival measured per breaker, see [docs/experiments/cactus.md](docs/experiments/cactus.md) |

"game-tested" means: passes on the Fabric test server (Minecraft 26.3). Not yet confirmed on a production server, and the `.litematic` files have not been loaded in Litematica yet.

More: [ARCHITECTURE](docs/ARCHITECTURE.md), [PLAN](docs/PLAN.md), [SECURITY](docs/SECURITY.md).
