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

1. Force-load and clear the test area, lay a barrier catch floor (lost items stay visible)
2. Put a Carpet fake player on a glass platform above the assembly – without a player nearby there are no random ticks or spawns
3. Place blocks bottom-up, run the preparation actions
4. Keep the game frozen; advance with `tick sprint`; sample storage contents against the actual game time
5. Report events with locations: items on the ground, backed-up hoppers

Speed on 2 CPU cores: ~10,000–20,000 ticks per second for small farms (4 in-game hours ≈ 15–30 s).

## Minecraft 26.3 specifics found while building this
- Game rules are snake_case (`random_tick_speed`, `advance_time`, `spawn_mobs`, …)
- The fill limit is the game rule `max_block_modifications` (Carpet's `fillLimit` is gone)
- With players online, `tick sprint N` runs N+1 ticks; the backend measures the actual game time
- The fake player's login takes a few ticks to complete
