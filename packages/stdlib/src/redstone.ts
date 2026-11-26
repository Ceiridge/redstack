/**
 * Redstone building blocks: clocks, edge detection, and a pulse counter for
 * tests. Periods are in game ticks (20 per second); a repeater delay of n is
 * 2n game ticks, a torch switches in 2.
 */

import { B, M, component } from "@redstack/core";

const wire = () => B.of("minecraft:redstone_wire", {});

/** Period a TorchClock really runs at for a requested period: 4 + 4 × (loop delay in repeater ticks), at least 12. */
export function torchClockPeriod(requested: number): number {
  return 4 + 4 * torchClockLoopDelay(requested);
}

function torchClockLoopDelay(requested: number): number {
  return Math.max(2, Math.ceil((requested - 4) / 4));
}

/**
 * Torch clock: a torch on a block, its signal led back into that block
 * through a loop of repeaters. It carries exactly one state, so it can never
 * run with two pulses in it, and stops cleanly when its block is powered.
 *
 * Output: a square wave, high for half the period, through the repeater at
 * `out` (east). Period: 4 + 4 × loop delay game ticks, 12 at the least
 * (shorter would burn the torch out); asked for another period, it takes the
 * next one it can do (`torchClockPeriod`).
 *
 * Switch: a lever on top of the torch's block. On holds the clock (output
 * low); the clock is saved switched off – flip the lever to start it, and it
 * starts with one clean edge. `hold`: power into that block from the west
 * holds it too. `lock`: a repeater or comparator pointing into the side of the
 * output repeater freezes the output where it is (a gate).
 *
 * Measured (Fabric, 26.3): periods 12, 20, 36 and 100 game ticks gave
 * 5,987, 3,600, 1,990 and 720 pulses/h (= 72,000 / period).
 */
export const TorchClock = component(
  {
    name: "TorchClock",
    description: "Torch clock with a lever (saved off) and a lockable output. Output: out (east). Inputs: hold (west), lock (sides of the output repeater).",
    status: "game-tested",
    params: { period: 20, on: false },
  },
  (c, { period, on }) => {
    const solid = () => B.of(c.material(M.solid));
    const delay = torchClockLoopDelay(period);
    const m = Math.max(1, Math.ceil(delay / 8));
    const delays = Array.from({ length: 2 * m }, (_, i) => Math.floor(delay / (2 * m)) + (i < delay % (2 * m) ? 1 : 0)) as Array<1 | 2 | 3 | 4>;
    const actual = 4 + 4 * delay;

    c.block(solid()).at([0, 0, 0]);
    c.block(B.of("minecraft:lever", { face: "floor", facing: "east", powered: !on })).at([0, 1, 0]);
    c.block(B.of("minecraft:redstone_wall_torch", { facing: "east", lit: on })).at([1, 0, 0]);
    // Output repeater, then the loop north and back into the block
    c.block(B.repeater(1).signalTowards("east")).at([2, 0, 0]);
    c.block(solid()).at([2, -1, 0]);
    for (let i = 0; i < m; i++) {
      c.block(B.repeater(delays[i]!).signalTowards("north")).at([1, 0, -1 - i]);
      c.block(solid()).at([1, -1, -1 - i]);
      c.block(B.repeater(delays[m + i]!).signalTowards("south")).at([0, 0, -1 - i]);
      c.block(solid()).at([0, -1, -1 - i]);
    }
    for (const x of [1, 0]) {
      c.block(wire()).at([x, 0, -1 - m]);
      c.block(solid()).at([x, -1, -1 - m]);
    }

    c.output("out", [3, 0, 0], { kind: "signal", description: `square wave, period ${actual} game ticks (${actual / 2} high)` });
    c.input("hold", [-1, 0, 0], { kind: "signal", optional: true, description: "power into the clock's block holds it (output low)" });
    c.input("lock", [[2, 0, 1], [2, 0, -1]], { kind: "signal", optional: true, description: "a diode pointing into the output repeater's side freezes the output" });
    c.note(`Period ${actual} game ticks (${(72_000 / actual).toFixed(0)} pulses/h); saved ${on ? "running" : "off – flip the lever on top to start"}.`);
  },
);

/**
 * Edge detector: an observer watching a note block. Powering or unpowering
 * the note block changes its state, so every edge of the input level becomes
 * a 2-game-tick pulse at the observer's back. (The note block plays a sound
 * on each rising edge; use any block with a "powered" state otherwise.)
 *
 * Input: `in`, the note block (power it from any side but the observer's).
 * Output: `out`, a pulse into the block behind the observer (east).
 */
export const EdgeDetector = component(
  {
    name: "EdgeDetector",
    description: "Observer watching a note block: each edge of the input becomes a 2-tick pulse. Input: in (west). Output: out (east).",
    status: "game-tested",
    params: {},
  },
  (c) => {
    c.block(B.of("minecraft:note_block", { instrument: "harp", note: 0, powered: false })).at([0, 0, 0]);
    // Watching the note block (west), output east
    c.block(B.observer().watching("west")).at([1, 0, 0]);
    c.input("in", [0, 0, 0], { kind: "signal", description: "level into the note block" });
    c.output("out", [2, 0, 0], { kind: "signal", description: "2-game-tick pulse on every edge of the input" });
  },
);

/**
 * Pulse counter for tests: a dropper full of items that drops one into a
 * chest on every rising edge of its input. Items per hour in the chest =
 * pulses per hour. Holds 576 items.
 */
export const PulseCounter = component(
  {
    name: "PulseCounter",
    description: "Test fixture: one item into the chest per rising edge. Input: in (the dropper itself).",
    status: "game-tested",
    params: { item: "minecraft:cobblestone" },
  },
  (c, { item }) => {
    const dropper = c.block(B.of("minecraft:dropper", { facing: "east", triggered: false }).containing([item, 9 * 64])).at([0, 0, 0]);
    c.block(B.chest()).at([1, 0, 0]);
    c.input("in", dropper, { kind: "signal", description: "power into the dropper" });
  },
);

