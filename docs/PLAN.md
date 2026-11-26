# Plan

Goal: describe Minecraft farms (later also redstone logic, up to CPUs) as code, check and test them automatically, and export them as schematics – so that an AI can reliably compose, improve and economically evaluate farms.

Guiding idea: **one graph, three resolutions.**

| Level | Question | Tooling |
|---|---|---|
| Economy | What is worth building where? | `economy` + market modules |
| Design | How do items flow through the farm? | `core` + `flow` |
| Measurement | Does it hold in-game? | `testing` + backends |

Each level checks the next: measurements calibrate the components' rate models, calibrated rate models make the economic numbers trustworthy.

## Verification stages

| Stage | What | Time | Package |
|---|---|---|---|
| 0 | Static checks: overlap, reserved cells, port alignment, kinds, crosstalk | ms | `core` |
| 1 | Flow model: rates, bottlenecks, inputs, fill times | ms | `flow` |
| 2 | Component test on a backend | seconds | `testing` + backend |
| 3 | Whole assembly, several runs, statistics | minutes | `testing` + backend |

## Phases

Each phase has an exit criterion. A phase is done when it is met.

### Phase 0 – Evaluate Nucleation ✅
- [x] Write `.litematic` via npm, check block states and rotations by round trip
- [x] Independent cross-check with litemapy (older format, data version 4903): all blocks identical
- [x] Loaded in Litematica's web preview (26.3 format) by the project owner
- Findings on the npm build (0.12.3): block table, schematic I/O and GLB meshing work; the PNG renderer and the simulations (MCHPRS, mc-tick) are not included. The Python wheel has them, but rendering needs a GPU and reading container contents after an mc-tick run did not work in a first attempt.

### Phase 1 – Core ✅ (API v2)
- [x] Geometry with relative directions and rotation
- [x] Block states with semantic helpers and rotation of all direction-dependent properties
- [x] Components placed by relations, typed ports (items, fluid, signal, bus), reserved cells
- [x] Assemblies: docking via ports (`attach`), rows, connections
- [x] Static checks
- [x] One concept: components nest; `to()` docking, `expose`, `line`/`fill`, `keepClear`, callable component types
- [x] Materials with tags (vanilla and `#redstack:*`), overrides per assembly, checked against the block table
- [x] Block-state validation against Minecraft's block data (via Nucleation)
- [x] Environments (version, platform, server settings) with presets
- [x] Importing schematics as components (`schematicComponent`), `redstack inspect`
- [x] Hopper router: `route`, `collect` (Steiner tree, greedy), `distribute` (branches below network hoppers); avoids draining, injection, steady redstone power and reserved space
- [x] `converts` rates (input item → output item), so starved machines show up in the flow model
- [x] Mirroring components: `mirrored(Type)` mirrors geometry and block states (facing, connections, stair/hinge/chest handedness, rails, 16-step rotation), nested and rotated children included; the mirrored kelp farm measures the same as the original

### Phase 1b – Layout solver
The router places transport between fixed components. Choosing the positions and rotations of the components themselves – the compact, nested layouts – is a combinatorial problem for a constraint solver.
- [x] Constraint model: free components with candidate positions/rotations, no overlap, reserved space, touching ports, routable links; objective = weighted bounding-box volume + routed hoppers
- [x] Exact branch and bound (router in the loop) with improvement moves when the budget runs out; reports proven-optimal vs best-found
- [x] Rigid groups: components docked onto a free one (`to`, `attach`, `offsetFrom`) move and turn with it, and the search sees their blocks
- [ ] SAT/CP-SAT backend behind the same model for larger instances (dependency policy applies), and a proof of optimality for more than toy sizes
- [ ] Water streams and dropper elevators as further transport types for the router
- [ ] Optimal Steiner trees for small collectors (exact search) instead of the greedy heuristic

### Phase 2 – Flow model ✅
- [x] Rates per port, bottlenecks, fill times, inputs, lost items, dead ends
- [x] Origin of every number (`game-mechanic` / `measured` / `estimate`)
- [ ] Distributions instead of means (for random mechanics)
- [ ] Fuel/energy as separate flows

### Phase 2b – Economy
- [x] Processes, sites (AFK spots), accounts, mob cap sharing, market limits, plan evaluation
- [x] Market interface, static price source (any SMP), Donut module
- [x] Optimizer: mixed-integer linear program (counts per farm and site, buy/sell per item, AFK sites ≤ accounts, mob cap, load budget, market limits, build cost over a horizon); own two-phase simplex + branch and bound, no dependency; matches brute force on random instances; `redstack optimize`
- [x] Bridge: assembly + flow model → `Process` (`@redstack/planning`): outputs into storage, converter inputs from supply chests (`external`), build cost from the bill of materials, break-even price ratio; `redstack economy`
- [ ] Donut: converter for the published donutflipper price history (check licence)
- [ ] Simulation distance: processes at one site must be loaded together

**Exit:** for a price list the optimizer proposes a plan that respects account and mob cap limits.

### Phase 3 – Test environments ✅ (first backend)
- [x] Fabric + Carpet server, pinned and checksum-verified, set up by script (`pnpm server setup`)
- [x] RCON control, frozen game + `tick sprint`, sampling against actual game time
- [x] Carpet fake player for random ticks, catch floor for lost items, backed-up hopper detection
- [x] `redstack test`, JSON reports, comparison against the flow model
- [x] First components game-tested: HopperLine, Chest, SupplyChest, CactusCell, CactusRow
- [x] Server time per tick (lag) per run; positions of lost items
- [x] Backends declare which environments they cannot reproduce
- [ ] mc-tick (Nucleation) as a fast backend for redstone and item logistics – needs container read-out
- [ ] Use the vanilla GameTest framework for component tests
- [ ] Several server processes in parallel; container without network for the server
- [ ] Chunk reload and server restart as test actions
- [ ] Backend for pure redstone logic (Nucleation simulation built from the submodule)
- [ ] Paper backend with server profiles

**Exit reached:** a component test runs with one command, produces JSON and fails when the measurement deviates from the flow model.

### Phase 4 – Visualisation
- [x] Data model (`viz`): blocks, instances, flows, utilisation, highlighted spots
- [x] Isometric SVG renderer (no dependencies, flat colours), hopper directions, flow labels, findings
- [x] Standalone interactive viewer: rotate, cut away layers, toggle overlays, list of findings (`redstack render -o x.html`)
- [x] Textured 3D view (Nucleation mesh + three.js), findings as boxes, `#figure` mode for pictures
- [x] Colours and shapes from block facts instead of a hard-coded table
- [ ] Events from in-game tests in the viewer, comparison of two runs

**Exit reached:** on a deliberately broken farm (`examples/src/debugger-demo.ts`) every fault is visible immediately.

### Phase 5 – Standard library and AI loop
- [ ] 10–20 proven components (rebuilt from proven designs, respecting licences and credits), each with a test and docs
  - donut.build: its terms forbid scraping and its download endpoint blocks bots, so schematics are downloaded by hand and analysed with `redstack inspect` / `schematicComponent`; originals are not committed
- [ ] Component docs written for AIs too: ports, rates, limits, known traps
- [ ] Loop: write → stage 0 → stage 1 → test → repair

**Exit:** an AI composes a new farm variant from the library that passes all tests without human intervention.

### Phase 6 – Discovery
- [ ] Parameter search over variants (flow model pre-filters, the test server scores)
- [ ] Mechanism catalogue: ways the game produces items, with references to the (unobfuscated since 26.1) source code
- [ ] Experiment mode: small isolated tests of single mechanics (see `docs/experiments/`)
- [ ] Exploit/dupe flagging, excluded by default

**Realistic expectation:** improvements and new combinations yes, fundamentally new mechanics rarely.

### Phase 7 – Redstone logic (future)
- [ ] Package `logic`: gates, registers, buses on top of `signal`/`bus` ports
- [ ] Timing model (redstone ticks) as the counterpart of the flow model
- [ ] Verilog import via Yosys instead of own logic synthesis
- [ ] Simulation via Nucleation/redpiler

## Open decisions
- Which version does the target server run? Mechanics can differ between versions.
- Viewer technology (phase 4)
- LP solver (phase 2b)

## Next steps
1. Real prices: the donutflipper price history converter (phase 2b) – the kelp farm only pays if kelp sells for ≥ 1.075 × bone meal, and the optimizer is only as good as its prices
2. Mirrored variants as options in the layout search (`free({ mirror: true })`)
3. More proven components (phase 5): water-based collection, a TNT-duper module from the benchmark
3. More components with tests (phase 5): water-based collection, a TNT-duper module based on the benchmark
