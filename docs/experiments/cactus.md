# Experiment: cactus cell

Minecraft 26.3, Fabric 0.20.1 + Carpet 26.3+v260915, void world, `random_tick_speed` 3, Carpet fake player 3 blocks above the farm.

## 1. First design: almost everything lost

The first `CactusCell` had one hopper below a single fall path to the right of the cactus.

| Scenario | Model | Measured |
|---|---|---|
| 1 cell, 4 in-game hours | 3.3/h | 0.5/h |

The `no-ground-items` check passed, which was wrong: in a void world, lost items fall out of the world before they can lie anywhere. **Fix in the backend:** every test now gets a barrier catch floor, so lost items stay visible as ground items.

## 2. Is the growth model right?

40 cactus columns on sand (on stone), with an end rod next to the growth cell (does not break the cactus), 43,690 ticks:

- 47 growth steps + 9 flowers = 1.4 growth events per column
- Theory (16 random ticks per step, 3/4096 per tick, capped at height 3): 1.52 per column

Close enough given the cap and flowers. **The growth model holds; items get lost when they fall.**

(A first attempt measured zero growth – the sand had no support and fell into the void. Test setups need the same care as farms.)

## 3. Second design: hopper ring

A ring of 8 hoppers around the sand catches everything that falls off the column and funnels it to one exit hopper. The breaker was compared as the [Minecraft Wiki](https://minecraft.fandom.com/wiki/Tutorials/Cactus_farming) recommends thin-hitbox blocks.

3 runs × 24 cells × 4 in-game hours per variant (~950 growth events each):

| Breaker | Measured | Survival |
|---|---|---|
| Oak fence | 67.5/h ± 1.6 | **0.85 ± 0.03** |
| Glass (full block) | 58.7/h ± 0.4 | **0.74 ± 0.03** |

The thin fence lets more items fall past instead of back onto the cactus, as the wiki says. A repeat on a freshly set-up server gave 66.7 and 58.1/h.

These values are now `CACTUS_SURVIVAL` in `@redstack/stdlib`.

## 4. Independent check

The 16-cell example farm (different size than the calibration runs):

| Model | Measured |
|---|---|
| 44.8/h | 45.0/h (and 45.2/h on the second server) |

## 5. Third design: shared breakers, one hopper bed (CactusRow)

Idea (from review): at a pitch of 2 instead of 3, neighbouring cacti can share the fence between their growth cells, and the hopper rings overlap anyway. The rings merge into one continuous hopper bed whose right column is the belt itself, so the separate belt layer disappears.

| | Ring (CactusCell) | Row (CactusSlice) |
|---|---|---|
| Length per cactus | 3 blocks | 2 blocks |
| Hoppers per cactus | 11 (8 ring + 3 belt) | 5 |
| Blocks for 16 cacti | 239 | 148 |

Static checks first (unit tests): every hopper of the bed leads to the chest, block states valid against the Minecraft block table, 5 hoppers per cactus.

In-game, 3 runs × 24 columns × 4 in-game hours each:

| Design | Breaker | Measured | Survival | Server time per tick |
|---|---|---|---|---|
| Row | fence | 66.7/h ± 2.4 | **0.84** | 0.082 ms |
| Row | glass | 51.1/h ± 1.9 | **0.65** | 0.081 ms |
| Ring | fence (repeat) | 69.6/h ± 1.6 | 0.88 | 0.094 ms |

- The row collects about 4 % less than the ring (1.7 σ – possibly noise, possibly the denser layout), with half the hoppers, a third less length and ~13 % less server time.
- Glass is much worse in the row than in the ring: a full block on *both* sides of the growth cell sends more items back onto the cactus.
- One run of the row lost a single item out of ~800. The backend now reports the position of ground items to find such leaks.

Independent check: the 16-cell row farm, model 44.3/h after calibration (44.8/h with the borrowed ring value) – measured 44.7/h.

`CactusRow` is the recommended design; `CactusCell` stays for comparison. The ring's fence value is now the mean of six runs (0.87).

## Open questions
- Water-based collection instead of a hopper ring (cheaper, less lag)?
- Do Paper's growth modifiers or a server's random tick settings change the result? (`growthModifier`, `randomTickSpeed` parameters exist; not measured yet.)
- ~~Cells sharing ring hoppers to save material.~~ Done: CactusRow.
- Where exactly does the row lose its ~16 %? Ground-item positions are reported now; destroyed items are not visible yet.
