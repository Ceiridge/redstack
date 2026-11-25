import { B, type Dir, type Placed, defineComponent } from "@redstack/core";

/** Mean game ticks between two growth steps of a cactus column: 16 random ticks, 3/4096 chance per tick per block at speed 3. */
export function cactusTicksPerGrowth(randomTickSpeed = 3, growthModifier = 1): number {
  return (16 * 4096) / randomTickSpeed / growthModifier;
}

/**
 * Share of popped cactus that reaches the hopper ring, per breaker block.
 * Measured on Minecraft 26.3 (Fabric + Carpet test server), 3 runs × 24 cells ×
 * 4 in-game hours each, ~950 growth events per variant:
 *   fence 0.85 ± 0.03, glass 0.74 ± 0.03
 * Thin breakers let more items fall past instead of back onto the cactus.
 */
export const CACTUS_SURVIVAL = { fence: 0.85, glass: 0.74 } as const;

/**
 * Cactus cell: a cactus on sand. When it grows, the new block touches the
 * breaker and pops. A ring of 8 hoppers around the sand catches everything
 * that falls off the column and funnels it to one exit hopper, which outputs
 * downwards (port "drops").
 *
 * Some popped items fall back onto the cactus and are destroyed; the share
 * that survives depends on the breaker (see CACTUS_SURVIVAL and
 * docs/experiments/cactus.md).
 *
 * The breaker also prevents cactus flowers (1.21.5+), which need free
 * neighbours and would stop the column from growing.
 */
export const CactusCell = defineComponent({
  name: "CactusCell",
  description: "Cactus with a breaker; a hopper ring catches the drops and outputs them downwards at the right-hand side.",
  status: "game-tested",
  defaults: {
    breaker: "fence" as "fence" | "glass",
    /** Override the measured survival share (0–1), e.g. for a different server */
    survival: undefined as number | undefined,
    randomTickSpeed: 3,
    growthModifier: 1,
  },
  build(c, { breaker, survival = CACTUS_SURVIVAL[breaker], randomTickSpeed, growthModifier }) {
    const base = c.origin(B.stone());
    const sand = c.place(B.sand()).above(base);
    const cactus = c.place(B.cactus()).above(sand);
    const growth = c.place(B.air()).above(cactus); // the column grows into this cell
    c.place(B.air()).above(growth); // keep space above, so items do not bounce back
    c.place(breaker === "fence" ? B.oakFence() : B.glass()).inFrontOf(growth);

    // Cactus neighbours must stay free, or the cactus breaks itself
    for (const d of ["forward", "back", "left", "right"] as const) c.place(B.air()).nextTo(cactus, d);

    // Hopper ring around the sand, all paths lead to the exit on the right
    const ring = (dx: number, dz: number, out: Dir): Placed =>
      c.place(B.hopper().outputTo(out)).offsetFrom(sand, [dx, 0, dz]);
    const exit = ring(1, 0, "down");
    ring(1, -1, "south"); // front right → exit
    ring(1, 1, "north"); // back right → exit
    ring(0, -1, "east"); // front → front right
    ring(0, 1, "east"); // back → back right
    ring(-1, -1, "east"); // front left → front
    ring(-1, 1, "east"); // back left → back
    ring(-1, 0, "north"); // left → front left

    c.output("drops", "items", exit.neighbor("down"), { item: "minecraft:cactus" });
    const growthsPerHour = 72_000 / cactusTicksPerGrowth(randomTickSpeed, growthModifier);
    c.produces("drops", "minecraft:cactus", growthsPerHour * survival, "measured", `growth ${growthsPerHour.toFixed(2)}/h × survival ${survival}`);
  },
});
