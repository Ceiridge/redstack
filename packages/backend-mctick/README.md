# @redstack/backend-mctick

Test backend on [mc-tick](../../vendor/nucleation/crates/mc-tick), Nucleation's headless, vanilla-accurate tick engine. No server, no network, deterministic with a seed – thousands of times faster than the Fabric server for redstone and item logistics (a hopper route: 2,400 ticks in milliseconds).

```bash
git submodule update --init --checkout vendor/nucleation   # pinned commit
pnpm mctick:build                                           # cargo build --release --locked
node apps/cli/dist/main.js test examples/dist/scenarios.js --backend mc-tick
```

The native tool (`native/`, Rust) reads a structure as gametest SNBT plus the scenario's actions and returns samples of the containers' contents, items left on the ground and the time per tick. Its only dependencies besides the engine are `serde`/`serde_json`, pinned in `Cargo.lock`.

What it cannot do: players (no AFK player, no item pickup), mob spawning, chunk behaviour. Blocks the engine does not model (cactus, for instance) are **refused by name** – never simulated as something else. Scenarios that need a player are skipped with the reason.

Known engine differences found so far (verify important results on the Fabric backend):
- Shulker boxes stack in containers in mc-tick and lose the contents of all but the first box; vanilla keeps them apart. Counting full boxes is therefore only reliable on Fabric.
