# @redstack/backend-fabric

Runs test scenarios on a real Minecraft server (Fabric + Carpet), controlled over RCON.

## Server setup (Linux x64)

```bash
pnpm build
pnpm server setup ../redstack-server --accept-eula   # downloads pinned, checksum-verified files
pnpm server start ../redstack-server
cp ../redstack-server/.env .env                       # RCON settings for the CLI
pnpm test:game                                        # all scenarios in examples/
pnpm test:game hopper-line-throughput                 # a single one
pnpm server stop ../redstack-server
```

`--accept-eula` records that you accept the [Minecraft EULA](https://aka.ms/MinecraftEULA).

The server listens on 127.0.0.1 only, uses a void world, and does not pause when empty. Reports go to `out/reports/*.report.json`.

## How a run works

1. Force-load and clear the test area – at least a fixed 80 × 72 × 80 region around the origin, so leftovers of a larger earlier design (a TNT duper, flowing lava) cannot leak into the run – kill all entities there, lay a barrier catch floor (lost items stay visible) and, for `terrain: "flat"`, a stone ground layer
2. Place blocks bottom-up: with block updates (`placement: "with-updates"`, like a player building) or exactly as given (`"strict"`, for snapshots of working farms whose redstone would fire while half built)
3. Put a Carpet fake player at the AFK spot (on a glass platform unless the design has a floor there) – without a player nearby there are no random ticks or spawns – and run the preparation actions: fill containers, set blocks, or `use` a block like a player (levers: a replaced lever does not update the block it is attached to)
4. Keep the game frozen; advance with `tick sprint`; sample storage contents against the actual game time
   Measured are the storage ports, or the containers and the player's inventory named in the scenario (`measure`); negative rates are consumption
5. Report events with locations: items on the ground (with positions), backed-up hoppers
6. Report server time per tick while fast-forwarding (a lag indicator; meaningful for long runs)

The backend applies the design's environment (random tick speed) and refuses environments it cannot reproduce on Fabric (Spigot/Paper hopper or growth settings, another Minecraft version) instead of measuring the wrong thing.

Speed on 2 CPU cores: ~10,000–20,000 ticks per second for small farms (4 in-game hours ≈ 15–30 s).

## Minecraft 26.3 specifics found while building this
- Game rules are snake_case (`random_tick_speed`, `advance_time`, `spawn_mobs`, …)
- The fill limit is the game rule `max_block_modifications` (Carpet's `fillLimit` is gone)
- With players online, `tick sprint N` runs N+1 ticks; the backend measures the actual game time
- The fake player's login takes a few ticks to complete
- `setblock … strict` and `fill … strict` place without block updates
