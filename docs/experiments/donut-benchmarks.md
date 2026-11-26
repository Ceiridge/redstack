# Benchmarks of two donut.build farms

Two designs from [donut.build](https://www.donut.build), downloaded by hand (the site forbids scraping) and measured on the Fabric + Carpet test server, Minecraft 26.3. The schematics are not in this repository; `examples/src/benchmarks.ts` says where to put them. Run: `pnpm test:game:benchmarks`.

Both are snapshots of working farms, so they are placed with `placement: "strict"` (no block updates while placing) and switched on by the fake player flipping the lever, like a player would.

## Small Fast Kelp Farm

4 × 7 × 5 blocks, 64 blocks. The sign in the schematic names ThC0mmand.

**Mechanism.** Kelp on dirt, four dispensers around its base, a water column above in glass. An observer clock (four observers in a loop through a redstone wire and a note block, period 8 ticks) fires the dispensers and a piston that breaks the kelp at the second block. The items float up; the top water cell flows towards an open fence gate, and that current throws them out in front of the farm. The lever holds the note block powered, which stops the clock.

| | |
|---|---|
| Bone meal in | **18,000/h** (all four supply hoppers together) |
| Kelp picked up by a player 3 blocks in front | **16,000–17,200/h** (≈ 93 %, the rest lands out of reach) |
| Server time | 0.5–0.8 ms per tick |

Findings:

- **It converts bone meal into kelp 1 : 1.** It is fast, not free: whether it pays depends on the price of kelp against the price of bone meal (or a bone meal source).
- **Only the west and east dispensers ever grow kelp.** The north and south ones fill up and never fire successfully. 18,000/h = 2 shots × 9,000 clock cycles per hour.
- **Bone meal stock**: three double chests, about 10,000 bone meal – roughly 35 minutes of running.
- **It needs exactly one pulse in the clock.** Placing it block by block sets off the observers several times; with two pulses in the loop the piston fires every 4 ticks and deletes the water source the kelp grows into, and the farm produces nothing. The water refills from above in 5 ticks, which fits only the 8-tick period. Any build order that updates the observers can cause this; flipping the lever on and off again resets the clock to one pulse, but water that is already gone has to be replaced by hand.
- **The AFK spot is in front, on the ground.** A player inside the water at the top is pushed out by the same current that carries the items.

**Rebuild:** `KelpBonemealCore` in `@redstack/stdlib` keeps the redstone core, drops the two idle dispensers (glass instead) and declares the item path as space that must stay free. `examples/src/kelp-farm.ts` supplies it with two chests whose hoppers are placed by the router: **6 hoppers and 2 chests instead of 9 hoppers, 3 double chests and 4 dispensers**, measured at 18,000 bone meal/h → 16,840 kelp/h, the same as the original.

## TNT Duper Cobblestone Farm

26 × 30 × 15 blocks, 1,162 blocks.

**Mechanism.** A TNT duper at the top (pistons, observers, a repeater–comparator clock; switched by a lever through a torch tower) blows up a ring of eight cobblestone columns, nine blocks high, built around lava. The drops fall onto a water funnel, through a hole into an item stream over two rows of 11 hoppers, which fill 145 chests via further hopper rows. How exactly the columns regenerate has not been analysed block by block; the measurement shows that they do.

| | |
|---|---|
| Cobblestone into storage | **≈ 208,000/h** (two runs of 20 in-game minutes: 207,000 and 209,000; chests and hoppers counted) |
| Storage | 145 chests ≈ 250,000 items – full after about 1.2 hours |
| Server time | 0.8 ms per tick |

Findings:

- ≈ 2,900 blasts per hour if every blast clears all 72 column blocks (one every ~25 ticks); the clock period was not measured separately.
- About 600 items are always in transit on the funnel and the stream, and the top hopper rows run full (the test reports them as backed up) – the collection runs close to its limit.
- **Placing it with block updates destroys it**: the duper fires while half built and pushes its own TNT away. With strict placement it runs at once.
- TNT duping works in vanilla and on Fabric. Paper disables it by default (`allow-piston-duplication`); the user reports it is allowed on DonutSMP.

## Test-harness lessons

- A kelp run right after the rebuilt kelp farm measured only 6,000/h (and an earlier TNT run 170,000/h, probably for the same reason): ticks still scheduled by the previous run (observers, pistons, fluids) fired on the new blocks after the area had been cleared, injecting extra clock pulses. The backend now lets 40 ticks pass on the empty area before placing anything.
- Leftovers of a larger earlier design outside the current test area leaked items into a smaller one; every run now clears at least a fixed 80 × 72 × 80 region.
