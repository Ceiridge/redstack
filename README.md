# redstack

**Write Minecraft farms as code. Let the solvers lay the hoppers, wires and layout. Know the real items per hour before you place a single block.**

[![CI](https://github.com/Ceiridge/redstack/actions/workflows/ci.yml/badge.svg)](https://github.com/Ceiridge/redstack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Minecraft 26.3](https://img.shields.io/badge/Minecraft-26.3-5b8731)

<p align="center">
  <img src="docs/images/kelp-twin-3d.png" alt="3D render of two kelp cores facing each other across a gap where the AFK player stands, each with supply chests above single hoppers – positions, rotations and hoppers chosen by the layout search." width="720">
  <br><sub>Two kelp cores, four supply chests – where they go, which way they face and every hopper: chosen by the solver. Measured in-game: <b>34,500 kelp/h</b> for one AFK player.</sub>
</p>

```ts
const bonemeal = { item: "minecraft:bone_meal" };
export default assembly("kelp-twin", (f) => {
  const a = f.add(KelpBonemealCore).at([0, 0, 0]);
  const b = f.add(KelpBonemealCore).free({ within: ground });   // the layout search decides
  const player = f.add(PlayerPickup).free({ rotations: [0] });
  f.connect(a.port("kelp"), player.port("in"));
  f.connect(b.port("kelp"), player.port("in"));
  for (const core of [a, b]) for (const side of ["West", "East"])
    f.route(f.add(SupplyChest, bonemeal).free().port("out"), core.port(`bonemeal${side}`));  // hoppers solved
});
```

```
$ redstack test scenarios.js kelp-twin
PASS kelp-twin (fabric-carpet, 1 run(s))
  measured minecraft:kelp: 34,467/h
  ok   matches-flow-model: Measurement matches the model.
```

## What you get

| | |
|---|---|
| **Solvers instead of hand placement** | `route` lays hopper chains, trees and splits that obey every hopper rule. `wire` lays dust, repeaters and stairs that power nothing they should not and reports the delay in game ticks. `free()` + a branch-and-bound layout search places whole components, minimising size and hoppers. |
| **A model that is checked against reality** | The flow model predicts items/h at every port, bottlenecks and fill times. Scenarios run the same design on a headless Fabric + Carpet server (or in milliseconds in the mc-tick engine) and compare. |
| **A debugger that shows where it breaks** | Static checks (block states, overlaps, kept-clear space, crosstalk) and test findings – backed-up hoppers, lost items – drawn where they happen. |
| **A library of measured parts** | Shulker loaders (18,000 items/h), a crafter for *any* recipe that can never craft the wrong thing, item filters, smelters, clocks with clean on/off switches, kelp and cactus modules. Every one passed an in-game test. [All components](docs/COMPONENTS.md) |
| **Other people's farms, measured** | Import any `.litematic`/`.schem` (contents and crafter slots included), run it, find its limit. |
| **Economy** | A farm as a process: in, out, build cost, break-even; an optimizer picks the most profitable farms per AFK spot. |

## What it has found so far

- A cactus design that passed every static check delivered **15 %** of its predicted yield in-game – items fell beside the collector. Two redesigns later: 5 hoppers per cactus instead of 11. [Story](docs/experiments/cactus.md)
- A popular kelp farm has **two dispensers that never fire**; the rebuild uses 6 hoppers and 2 chests instead of 9 and 6, same output. [Benchmarks](docs/experiments/donut-benchmarks.md)
- A 100-crafter slab factory tops out at **~42,000 slabs/h**, not because of its crafters: hoppers under the shallow end of a water stream trap items, so only the first loaders get any. Put them under deep water and four taps take **41,000/h instead of 18,000/h**. [Water streams](docs/experiments/water-streams.md)

<p align="center">
  <img src="docs/images/debugger-demo.svg" alt="Isometric debug view of a broken farm: flow labels along a hopper belt, red outlines on faulty blocks, an orange outline where a belt is overloaded." width="640">
  <br><sub>The debug view: flows per hour along the belt, faulty blocks in red, an overloaded belt in orange.</sub>
</p>

## Which tool for which job

- **A machine with a fixed shape** (a loader, a crafter core): a `component` with blocks placed by relations (`above`, `inFrontOf`, …), ports for what goes in and out, `keepClear` for space that must stay empty, and a rate (`passes`, `converts`, `crafts`, `produces`).
- **Something repeated**: make the unit a component and chain it – `last = last.to(Slice)` – or give it a parameter.
- **Items from A to B**: `route(out, in)`. Several outputs into one input: `collect`. One output to several inputs: `distribute`.
- **A signal from A to B**: `wire(out, in, { minDelayTicks })`; keep cells free for later hopper routes with `avoid`.
- **Parts whose position does not matter**: `.free({ within, rotations })` and let the layout search place them. Give it a tight box; it tells you if the result is proven optimal.
- **A mirrored copy**: `mirrored(Type)`. **Other blocks**: material slots (`c.material(M.solid)`) instead of fixed ids.
- **Turning things on and off**: every farm gets a switch, saved off – use `TorchClock` (lever, lock input) instead of a raw observer clock.
- **Is it right?** `redstack check` → `flow` → `render` → a scenario on mc-tick for fast iteration → the Fabric server for the real number.

Concepts in depth: [docs/CONCEPTS.md](docs/CONCEPTS.md) · rules for contributors and AIs: [AGENTS.md](AGENTS.md)

## Getting started

Requirements: Node.js ≥ 22.18 and pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/Ceiridge/redstack.git && cd redstack
pnpm install --frozen-lockfile
pnpm test        # build + unit tests
pnpm assets      # optional: Minecraft textures for the 3D view (downloaded, checksum-verified, never committed)
pnpm example     # checks, flow model, .litematic and viewer for the example farm
```

### Commands

```bash
redstack check   <module.js>                  # static checks
redstack flow    <module.js>                  # flow model
redstack build   <module.js> -o farm.litematic [--data-version n]
redstack render  <module.js> -o farm.html     # viewer (3D if assets exist) – or .svg
redstack all     <module.js> -o farm.litematic
redstack inspect farm.litematic [-o farm.html|.svg] [--report r.json]  # analyse any schematic; a test report adds its findings in place
redstack test    <scenarios.js> [name...]      # in-game tests
redstack economy <module.js> [--prices p.json] # in/out per hour, build cost, break-even, profit
redstack optimize <plan.json>                  # which farms how often at which AFK spot
```

`redstack` is `node apps/cli/dist/main.js`. A module's default export is an assembly or a component. See [`examples/src`](examples/src).

### In-game tests

```bash
pnpm server setup ../redstack-server --accept-eula   # pinned, checksum-verified downloads
pnpm server start ../redstack-server
cp ../redstack-server/.env .env
pnpm test:game
```

Four in-game hours take about 25 seconds. Details: [packages/backend-fabric](packages/backend-fabric/README.md).

## Project layout

| Package | Purpose |
|---|---|
| [`core`](packages/core) | components, ports, assemblies, materials, environments, hopper router, layout search, static checks – no dependencies |
| [`flow`](packages/flow) | flow model |
| [`stdlib`](packages/stdlib) | components and environment presets |
| [`nucleation`](packages/nucleation) | adapter for [Nucleation](https://github.com/Schem-at/Nucleation): schematic I/O, block registry, 3D meshes |
| [`viz`](packages/viz) | viewer: 3D, isometric debug view, SVG |
| [`testing`](packages/testing), [`backend-fabric`](packages/backend-fabric), [`backend-mctick`](packages/backend-mctick) | scenarios, reports, model comparison; Fabric + Carpet server over RCON; Nucleation's tick engine |
| [`economy`](packages/economy), [`market-static`](packages/market-static), [`market-donut`](packages/market-donut) | processes, AFK spots, markets, plan evaluation |
| [`planning`](packages/planning) | a farm's flow model as an economic process (inputs, outputs, build cost, break-even) |
| [`apps/cli`](apps/cli) | the `redstack` command |

More: [concepts](docs/CONCEPTS.md) · [components](docs/COMPONENTS.md) · [architecture](docs/ARCHITECTURE.md) · [roadmap](docs/PLAN.md) · [experiments](docs/experiments) · [supply-chain policy](docs/SECURITY.md)

## Contributing

Everything in this repository is verified by code – unit tests, static checks or in-game scenarios – and built from composable components without duplication. Please read [AGENTS.md](AGENTS.md) (it applies to humans too) before opening a pull request.

## Acknowledgements

[Nucleation](https://github.com/Schem-at/Nucleation) for schematic I/O, block data and meshing · [Fabric](https://fabricmc.net) and [Carpet](https://github.com/gnembon/fabric-carpet) for the test server · [three.js](https://threejs.org) for the 3D view · the [Minecraft Wiki](https://minecraft.wiki) community for documenting the mechanics. Textures in the 3D view and its pictures come from Minecraft's resource pack.

## License

[MIT](LICENSE) © 2026 Ceiridge
