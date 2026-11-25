# Architecture

Modules build on each other. Arrows mean "depends on". No module knows the modules above it.

```
apps/cli ─┬─> export-nucleation ──> core           (+ nucleation, third-party)
          ├─> flow ───────────────> core
          ├─> viz ──> core, flow
          └─> backend-fabric ──> testing, core, flow

stdlib ──> core
examples ──> core, stdlib, testing

testing ──> core, flow
backend-fabric ──> testing           (later: backend-paper, backend-redstone)

economy                               (standalone: knows nothing about blocks)
market-static ──> economy
market-donut ──> economy, market-static   (other SMPs: their own market-* module)

logic (planned) ──> core              (redstone logic, CPUs)
```

## Rules

1. **`core` has no dependencies.** No file format, no server, no economy.
2. **Third-party libraries only in adapters.** Nucleation appears only in `export-nucleation`. If it goes away, only that adapter is replaced.
3. **Server specifics only in market/backend modules.** Donut is one module among many.
4. **Extension through interfaces:** `SchematicWriter`/`SchematicReader` (export), `TestBackend` (tests), `PriceSource`/`MarketProfile` (markets), `Optimizer` (economy).
5. **Every number has an origin** (`game-mechanic`, `measured`, `estimate`), every component a maturity (`draft` → `unverified` → `game-tested` → `server-verified`).
6. **Findings are machine-readable** (`Diagnostic` with code, location and parties; test events with locations), so an AI can repair precisely.

## Concepts

- **Component:** blocks in a local frame, placed by relations (`above`, `inFrontOf`, …). "forward" is north at rotation 0.
- **Port:** a typed input or output with cells. An output delivers to target cells, an input accepts at cells. A connection is valid if the targets lie on the input cells.
- **Reserved cells:** `air` in a component means "nothing may be placed here" (growth space, fall paths). Not exported, but checked.
- **Assembly:** component instances docked through ports. Only one anchor needed.
- **Rate model:** `produces`, `passes`, `stores`, `consumes` per component. `flow` computes from these.
- **Scenario:** an assembly plus environment, duration, repeats, actions and expectations. Backends run it and return a `TestReport`.
- **Process/site:** the economic view. Sites (AFK spots) have limited accounts and a shared mob cap.
