import {
  B,
  type ComponentBuilder,
  type Environment,
  M,
  type RateBasis,
  component,
  growthFactor,
  hopperItemsPerHour,
  ticksForRandomTicks,
} from "@redstack/core";

/** Cactus blocks per hour from one column: a growth step needs 16 random ticks. */
export function cactusGrowthPerHour(env: Environment): number {
  return (72_000 / ticksForRandomTicks(env, 16)) * growthFactor(env, "cactus");
}

/**
 * Share of popped cactus that reaches the hoppers, measured per design and
 * breaker on Minecraft 26.3 (docs/experiments/cactus.md).
 */
export const CACTUS_SURVIVAL = {
  /** CactusCell: fence 6 runs, glass 3 runs, each 24 columns × 4 h (~950 growth events per run set) */
  ring: { fence: 0.87, glass: 0.74 },
  /** CactusSlice/CactusRow: 3 runs × 24 columns × 4 h per breaker */
  row: { fence: 0.84, glass: 0.65 },
} as const;

const ROW_SURVIVAL_BASIS: RateBasis = "measured";

/** Cactus column on soil on a support block, with its growth space kept free. */
function cactusColumn(c: ComponentBuilder) {
  const support = c.block(B.of(c.material(M.solid)));
  const soil = c.block(B.of(c.material(M.cactusSoil))).above(support);
  const cactus = c.block(B.cactus()).above(soil);
  // The column grows into the cell above; the one above that stays free so items do not bounce back.
  c.keepClear(cactus.up, cactus.neighbor("up", 2));
  // A cactus breaks itself when something solid touches it
  c.keepClear(cactus.neighbors("horizontal"));
  return { soil, cactus, growth: cactus.up };
}

/**
 * One slice of a cactus row, two blocks long: a cactus, the breaker in front
 * of its growth cell (shared with the next slice), and five hoppers that
 * catch everything falling off and pass it to the belt on the right.
 *
 *   top view (forward = up)      y=1 (hoppers)
 *     . F .   ← fence at y=3     ↘ ↘ ↑     front row
 *     . C .   ← cactus           ↑ S ↑     S = soil under the cactus
 *
 * Slices dock onto each other with `to()`; a CactusRowCap closes the back.
 */
export const CactusSlice = component(
  {
    name: "CactusSlice",
    description: "Cactus with shared fence breaker and a hopper bed; the right column is the belt.",
    status: "game-tested",
    params: { breaker: undefined as "fence" | "glass" | undefined, survival: undefined as number | undefined },
  },
  (c, p) => {
    const { soil, growth } = cactusColumn(c);
    const breakerKind = p.breaker ?? "fence";
    c.block(breakerKind === "fence" ? B.fence(c.material(M.cactusBreaker)) : B.of(c.material(M.glass))).at([growth[0], growth[1], growth[2] - 1]);

    const belt = c.block(B.hopper().outputTo("forward")).rightOf(soil);
    const beltFront = c.block(B.hopper().outputTo("forward")).inFrontOf(belt);
    c.block(B.hopper().outputTo("right")).inFrontOf(soil);
    const left = c.block(B.hopper().outputTo("forward")).leftOf(soil);
    c.block(B.hopper().outputTo("right")).inFrontOf(left);

    const survival = p.survival ?? CACTUS_SURVIVAL.row[breakerKind];
    c.input("in", belt, { description: "belt from the slice behind" });
    c.output("out", beltFront.neighbor("forward"), {
      item: "minecraft:cactus",
      rate: {
        perHour: cactusGrowthPerHour(c.env) * survival,
        basis: p.survival === undefined ? ROW_SURVIVAL_BASIS : "estimate",
        note: `growth × survival ${survival}`,
      },
    });
    c.passes("in", "out", hopperItemsPerHour(c.env), "game-mechanic");
  },
);

/** Closes the back of a cactus row: catches items falling behind the first cactus. */
export const CactusRowCap = component({ name: "CactusRowCap", status: "game-tested" }, (c) => {
  const middle = c.block(B.hopper().outputTo("right")).at([0, 1, 0]);
  c.block(B.hopper().outputTo("forward")).leftOf(middle);
  const right = c.block(B.hopper().outputTo("forward")).rightOf(middle);
  c.output("out", right.neighbor("forward"));
});

/**
 * A row of cactus slices behind a cap. Output: the belt's end, in front of the
 * last slice (connect a chest or a storage system).
 */
export const CactusRow = component(
  {
    name: "CactusRow",
    description: "Row of cactus slices: 2 blocks per cactus, 5 hoppers per cactus, one shared belt.",
    status: "game-tested",
    params: { cells: 8, breaker: "fence" as "fence" | "glass" },
  },
  (c, { cells, breaker }) => {
    if (cells < 1) throw new Error("CactusRow: cells must be >= 1.");
    let last = c.add(CactusRowCap);
    for (let i = 0; i < cells; i++) last = last.to(CactusSlice({ breaker }));
    c.expose("out", last.port("out"));
  },
);

/**
 * Cactus cell with its own hopper ring (first design, 3 blocks per cactus,
 * 11 hoppers per cactus including the belt below). Collects ~4 % more than
 * CactusRow, but needs twice the hoppers and 13 % more server time.
 * Prefer CactusRow; see docs/experiments/cactus.md.
 */
export const CactusCell = component(
  {
    name: "CactusCell",
    description: "Cactus with a breaker; a hopper ring catches the drops and outputs them downwards at the right-hand side.",
    status: "game-tested",
    params: { breaker: "fence" as "fence" | "glass", survival: undefined as number | undefined },
  },
  (c, { breaker, survival = CACTUS_SURVIVAL.ring[breaker] }) => {
    const { soil, growth } = cactusColumn(c);
    c.block(breaker === "fence" ? B.fence(c.material(M.cactusBreaker)) : B.of(c.material(M.glass))).at([growth[0], growth[1], growth[2] - 1]);

    const ring = (dx: number, dz: number, out: "forward" | "back" | "right" | "down") =>
      c.block(B.hopper().outputTo(out)).offsetFrom(soil, [dx, 0, dz]);
    const exit = ring(1, 0, "down");
    ring(1, -1, "back");
    ring(1, 1, "forward");
    ring(0, -1, "right");
    ring(0, 1, "right");
    ring(-1, -1, "right");
    ring(-1, 1, "right");
    ring(-1, 0, "forward");

    c.output("drops", exit.down, {
      item: "minecraft:cactus",
      rate: { perHour: cactusGrowthPerHour(c.env) * survival, basis: "measured", note: `growth × survival ${survival}` },
    });
  },
);
