# Components

The standard library ([`packages/stdlib`](../packages/stdlib)) and what each component's status rests on.

| Component | Status | Evidence |
|---|---|---|
| `CactusRow` (`CactusSlice`, `CactusRowCap`) | game-tested | survival per breaker, model matches a 16-cell farm |
| `CactusCell` | game-tested | the earlier ring design, kept for comparison |
| `HopperLine` | game-tested | 9,000 items/h measured = model |
| `Chest`, `SupplyChest` | game-tested | storage and test fixture in every scenario |
| `KelpBonemealCore` | game-tested | 18,000 bone meal/h → ≈ 16,800 kelp/h, model matches |
| `PlayerPickup` | game-tested | the AFK player as an item sink, counted in tests |
| `free()` + layout search | game-tested | two kelp cores and four chests placed by the search: 34,500 kelp/h measured, model 33,500 |
| `ShulkerLoader` | game-tested | fires only on a completely full box (subtract comparator against a reference); 3 boxes, nothing lost, 9,000 items/h |
| `FastShulkerLoader` | game-tested | piston on top pushes the full box down, the dispenser places from the side, so two hoppers fill each box: 18,000 items/h, box swap under 10 ticks |
| `ShulkerUnloader` | game-tested | breaks the box only when it just became empty (observer + locked repeater); 8,700 items/h |
| `ItemFilter` | game-tested | classic hopper sorter: took all coal from a mixed line, not one cobblestone |
| `SmelterArray` | game-tested | 4 furnaces: 1,440 stone/h after the warm-up (= model) |
| `Crafter` | game-tested | fires only on a full grid, so the recipe cannot be pre-empted: planks → 1,127 chests/h, zero buttons, plates or sticks |
| `PatternCrafter` | game-tested | any recipe, shaped with several ingredients too, fed from up to four sides. A seeded grid keeps the pattern, and it fires only while every feed is backed up, so a slot never runs empty: pistons 2,000/h, chests 3,600/h, nothing but the result, clean stop and restart when an ingredient runs out |
| `route` / `collect` / `distribute` | game-tested | three chests merged past a wall and a decoy chest: 9,000/h = model, nothing drained from the decoy |

*game-tested* = passes on the Fabric test server with Minecraft 26.3; not yet confirmed on a production server.

