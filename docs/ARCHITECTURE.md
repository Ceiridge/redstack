# Architecture

Modules build on each other. Arrows mean "depends on". No module knows the modules above it.

```
apps/cli ─┬─> nucleation ──> core           (+ nucleation, third-party)
          ├─> flow ────────> core
          ├─> viz ──> core, flow
          ├─> backend-fabric ──> testing, core, flow
          └─> planning ──> core, flow, economy

stdlib ──> core                        (tests also use flow, nucleation)
examples ──> core, stdlib, testing, viz, nucleation

testing ──> core, flow
backend-fabric ──> testing           (later: backend-paper, backend-mc-tick)

economy                               (standalone: knows nothing about blocks)
market-static ──> economy
market-donut ──> economy, market-static   (other SMPs: their own market-* module)
planning ──> core, flow, economy          (assembly → process)

logic (planned) ──> core              (redstone logic, CPUs)
```

## Rules

1. **`core` has no dependencies.** No file format, no server, no economy.
2. **Third-party libraries only in adapters.** Nucleation appears only in `nucleation` (schematic I/O, block registry, meshes). If it goes away, only that adapter is replaced; the core sees it only through `SchematicWriter`, `SchematicReader` and `BlockRegistry`.
3. **Server specifics only in market/backend modules.** Donut is one module among many.
4. **Extension through interfaces:** `SchematicWriter`/`SchematicReader` (export), `BlockRegistry` (block facts), `TestBackend` (tests), `PriceSource`/`MarketProfile` (markets), `Optimizer` (economy).
5. **Every number has an origin** (`game-mechanic`, `measured`, `estimate`), every component a maturity (`draft` → `unverified` → `game-tested` → `server-verified`).
6. **Findings are machine-readable** (`Diagnostic` with code, location and parties; test events with locations), so an AI can repair precisely.

## Concepts

- **Component:** one concept for everything. Blocks in a local frame placed by relations (`above`, `inFrontOf`, …; "forward" is north at rotation 0), ports, a rate model, and child components. Built with `component({ name, params }, (c, params) => …)`; calling the type sets parameters: `HopperLine({ length: 8 })`.
- **Children and ports:** `c.add(Type)` adds a child; `a.to(Next)` docks Next's only matching input onto a's only output; `attach` / `connect` for explicit ports; `c.expose(name, child.port(…))` re-exports a child's port. Connections are resolved to the components that own the cells.
- **Port:** a typed input or output with cells. An output delivers to target cells, an input accepts at cells. A connection is valid if the targets lie on the input cells.
- **Free cells:** `c.keepClear(...)` marks cells where nothing may be placed (growth space, fall paths, cactus neighbours). Not exported, but checked.
- **Materials:** slots with a tag and a default (`M.solid`, `M.cactusBreaker`, …), overridden by role per assembly and verified against block tags.
- **Environment:** game version and server settings (`@redstack/core` type, presets in `stdlib`). Components read `c.env` for rates; backends apply it or refuse.
- **Assembly:** the top-level component; `resolve()` flattens the tree into absolute blocks, free cells, ports and connections (instance ids are paths like `CactusRow#1/CactusSlice#3`).
- **Rate model:** `produces` (or `output(…, { rate })`), `passes`, `stores`, `consumes` per component. `flow` computes from these.
- **Scenario:** an assembly plus test world, duration, repeats, actions and expectations. Backends run it and return a `TestReport`.
- **Process/site:** the economic view. Sites (AFK spots) have limited accounts and a shared mob cap.
