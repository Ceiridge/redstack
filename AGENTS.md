# AGENTS.md

Guidelines for anyone – human or AI – who develops farms, components or tooling in this repository. Read `docs/ARCHITECTURE.md` first; `docs/PLAN.md` says what is being worked on.

## 1. Verified, not assumed

Nothing counts as working until code has verified it. "Test-driven" here does not mean tests must be written first; it means every claim is backed by an automated check that anyone can re-run.

| Claim | Required evidence |
|---|---|
| A geometry/helper works | unit test (`pnpm test`) |
| A design is consistent | `redstack check` without errors (stage 0) |
| A farm yields X/h | flow model (stage 1) **and** an in-game scenario that matches it (stages 2–3) |
| A component works | `status: "game-tested"` only after a passing in-game scenario |
| A rate is known | `basis: "game-mechanic"` (derived from game rules) or `"measured"` (cite the experiment); otherwise `"estimate"` |

- Every bug fix comes with a test that would have caught it.
- When an in-game test fails, find out **why** before changing the design: run a small, isolated experiment and write it up in `docs/experiments/` (hypothesis, setup, numbers, conclusion – including the wrong turns). `docs/experiments/cactus.md` is the reference example.
- Random mechanics need statistics: several runs, enough events, report mean ± spread. A single lucky run proves nothing.
- Test setups need the same care as farms (sand needs support, items can fall out of a void world, …).

## 2. Modular and composable

- **Build from components.** A farm is an assembly of components connected through ports – not a list of blocks. Components nest: if a design repeats a unit (a slice, a cell, a module), make the unit a component and compose it (`add`, `to`, `row`, `expose`).
- **No duplication.** If a structure appears twice, it becomes a component or a parameter. If several farms use it, it belongs in `@redstack/stdlib`, with a scenario that tests it.
- **Parameters over copies.** Variants (breaker block, length, item) are parameters with defaults, not new components.
- **Relations over coordinates.** Place blocks with `above`, `inFrontOf`, `nextTo` …, repeat with `line`/`fill`; dock components with `to()` (or `attach`/`connect` when there is more than one port). Raw offsets only where geometry is genuinely irregular.
- **Materials over block ids.** Ask for a slot (`c.material(M.cactusBreaker)`, or a new `material(role, tag, default)`) wherever another block of the same kind would do. Hard-code an id only where the exact block matters (hopper, observer, …).
- **Environment-aware rates.** Compute rates from `c.env` (`hopperItemsPerHour`, `ticksForRandomTicks`, `growthFactor`), never from constants that silently assume vanilla.
- **Semantic block helpers.** Use `outputTo`, `signalTowards`, `watching`, `pushing` instead of raw `facing` values – that is where the classic mistakes are.
- **Let the search place what does not need a fixed spot.** `inst.free({ rotations, within })` plus `connect`/`route` links; keep the boxes tight (ground level, height range), it makes the search fast and the result meaningful. Read the `layout` info line: "optimal" or "best within the budget".
- **Iterate on mc-tick, confirm on Fabric.** `--backend mc-tick` runs a scenario in milliseconds and is right for redstone and hoppers; anything with players, crafting, smelting, growth or several filled shulker boxes needs the Fabric server. A component is `game-tested` only after Fabric.
- **Contents and block data are part of the design.** Filter items, reference droppers, crafter disabled slots: `B.hopper().containing(...)`, `.withData({ disabled_slots: "[I;4]" })` – they are exported with the schematic.
- **Let the router lay transport.** Connect ports with `c.route`, `c.collect` or `c.distribute` instead of placing hoppers by hand, unless the exact hopper layout is the point of the component (a collection bed under crops). Declare item paths and player cells with `keepClear` so the router avoids them.
- **Reserve space explicitly.** Cells that must stay free (growth space, fall paths, cactus neighbours) go into `c.keepClear(...)`; the checks then catch anything built into them.
- **Declare rates.** Every component declares `produces`/`passes`/`stores`/`consumes` with a basis, so the flow model and the economy can use it.
- **Respect the layers.** `core` has no dependencies; third-party libraries only in adapter packages; server- or market-specific code only in its own module (see `docs/ARCHITECTURE.md`).

## 3. Workflow for a new farm or component

1. Look in `@redstack/stdlib` for what exists. Extend it if a building block is missing.
2. Write the component or assembly (`examples/src/` for farms).
3. `pnpm build && node apps/cli/dist/main.js all <module> -o out/<name>.litematic` – fix all errors (they include invalid block states and materials, checked against Minecraft's block table), read the warnings.
4. Look at it: `redstack render <module> -o out/<name>.html` – 3D view and debug view with flows and findings.
   To learn from an existing design: `redstack inspect <file.litematic> -o out/x.html`, and `schematicComponent()` to benchmark it in-game (`examples/src/benchmarks.ts`; place snapshots of working farms with `placement: "strict"` and switch them on with a `use` action). Credit its designer; do not commit third-party schematics.
5. Add an in-game scenario (`examples/src/scenarios.ts`) with `matches-flow-model`, `no-ground-items`, `no-stuck-hoppers` as appropriate, and run it (`pnpm test:game <name>`, server setup in `packages/backend-fabric/README.md`).
6. If model and measurement disagree: experiment, explain, then fix the design **or** calibrate the rate model with the measured value – never just widen the tolerance.
7. Unit tests for any new logic; `pnpm test` must pass.
8. Update docs: component table in `README.md`, `docs/PLAN.md` checkboxes, experiment write-up if any.

## 4. Code quality

- TypeScript strict mode; no `any`; no unused code paths "for later" – declare an interface instead and implement it when needed.
- Small, pure functions where possible; side effects (files, network, server) at the edges.
- Findings are machine-readable (`Diagnostic` with code, location and involved instances) so tools and AIs can act on them.
- Errors fail loudly with a message that says what to do; no silent fallbacks that hide problems.
- Everything in English: code, comments, messages, docs.

## 5. Dependencies and security

Follow `docs/SECURITY.md`: exact versions, no install scripts, 7-day cool-down, adapters only, pinned checksums for anything downloaded. Never commit secrets (`.env` is ignored).

## 6. Commits

- One logical change per commit, imperative subject line, body explains the why and the evidence (e.g. measured numbers).
- Author is the repository owner's git identity. No AI co-author trailers or session links.
