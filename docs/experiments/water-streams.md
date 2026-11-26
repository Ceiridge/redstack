# Item transport in water streams

Measured on the Fabric + Carpet test server, Minecraft 26.3. Scenarios: `examples/src/water-experiments.ts`
(`node --env-file=.env apps/cli/dist/main.js test examples/dist/water-experiments.js <name>`). A channel one block
wide with glass walls, items spawned in its source cell (`feeds` spawn a share every 20 ticks, like a farm's
drops), hoppers in the floor ("taps") empty into chests below.

## Results so far

| Question | Result |
|---|---|
| Speed | 7 cells in 27 ticks (≈ 5 blocks/s) from a burst of 64 at the source |
| Ice under the water | No effect: stone, packed ice and blue ice all 27 ticks. The items float and never touch the floor |
| Taps at the shallow end (30,000/h fed) | 1 tap 9,000/h, 2 taps 18,000/h, **4 taps still 18,000/h** |

Why four taps at the end do no better than two: in shallow water (the last cells of a stream) items sink into the
bowl of the first hoppers they cross. The bowl is below the water, so nothing pushes them on; they wait there for
that hopper, which takes 2.5 items/s. The taps further down never see an item. A row of hoppers under the
**shallow** part of a stream is therefore a trap, not a distributor.

## Joints: a stream longer than 8 blocks

Water runs 7 blocks from its source. A plain source further down the channel pushes the water back towards the
first one and items stall between them. Three designs in proven farms keep a long stream level:

- **A wall sign over packed ice, then a new source** (the TNT duper cobblestone farm from donut.build). Water does
  not flow into the sign, so the new source cannot push back; items fly through signs; the packed ice keeps them
  sliding across the one dry cell.
- **A two-wide lane with the water switching sides every segment** (both designs below). Each segment has its own
  source at its start (in the kelp farm partly waterlogged chests in the corners). The other lane is filled with a
  block water does not flow into but items pass: glow lichen (kelp farm), or glass panes, whose open half the items
  use (slab crafter). The items run along the line between the two lanes and always touch the side that has water.
  Fences work the same way: their post sits in the middle of the cell, the line between the lanes stays free.
- **A one-block drop** every 8 blocks (classic; costs height).

Scenarios for the sign joint, the drop, and fence or pocket sources are in the experiments file; they have not been
run yet.

## Two designs studied

Both downloaded by hand, not part of the repository (`examples/benchmarks/`, git-ignored); block entities
(crafter slots, contents) are now imported too.

Both are fed by throwing items into their water (`feeds` in the benchmarks).

**Kelp farm V2 "4 shulkers of kelp blocks per hour"** by Fsaulpaugh (schemat.io tu7vbz), 17 × 16 × 27, 1,779 blocks,
saved in data version 4671 (1.21.x). Bone blocks from four double chests → a one-slot crafter makes bone meal →
four dispensers around one kelp, an observer clock and a piston harvest it → bubble columns and two-wide lichen lanes
carry the kelp over 2 × 17 hopper pairs into 60 smokers → full-grid crafters press dried kelp blocks → a stream and a
bubble column carry them to storage. Switches: the lever at (12, 3, 18) holds the kelp clock (it powers the
clock's note block through a repeater; saved on = farm off), the levers at (11, 9, 10) and (12, 9, 11) switch the
bone meal crafter. With all three flipped the clock runs and the dispensers fire, but no kelp grows: the cell above
the kelp is air after every harvest – the piston fires before the water from above has flowed back (5 ticks), the
failure the donut.build kelp farm shows with two pulses in its clock. Bone meal backs up and spills. Not solved;
it may depend on the exact start state or on the version (the file is from 1.21.x).

**Mauschu's Tuff and Deepslate Slab Crafter** (shulkr.com; design Mauschu, schematic Shadow), 48 × 9 × 23,
2,791 blocks, data version 5023 (26.3). 100 crafters with only the top row enabled (three blocks → six slabs), fed
from two-wide pane lanes over hopper rows and chests; the slabs drop into a water lane, a bubble column lifts them
into a serpentine stream over 25 shulker loaders. Raw blocks are thrown into the start of the top lanes (next to the
waterlogged chest at (20, 8, 1)); the lever at (32, 5, 4) switches it on (off: the blocks are distributed, nothing is
crafted).

| Fed (cobbled deepslate) | Slabs into boxes and chests | Notes |
|---|---|---|
| 20,000/h, 10 min | 16,600/h | 38 items on the ground |
| 40,000/h, 30 min | 24,400/h | 50 hoppers backed up |
| 80,000/h, 20 min | 41,600/h, falling | 65 hoppers backed up, 1,500 items fall out below |

The limit is the slab stream over the loaders, the same trap as in the experiment above: only the loader
hoppers of the first two rows are full (z = 4 and 8), the three rows after them get almost nothing – items lie in
the bowls of the full hoppers instead of floating on. 100 crafters could press far more (three blocks per craft).
