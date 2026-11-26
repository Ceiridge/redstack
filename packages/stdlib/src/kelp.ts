import { B, M, type Vec3, component } from "@redstack/core";

/**
 * Bone-mealed kelp, rebuilt from the "Small Fast Kelp Farm" on donut.build
 * (its sign names ThC0mmand). The redstone core is the original's; the
 * supply hoppers are left to the router (see `kelpFarm` in the examples).
 *
 * How it works: dispensers beside the kelp fire bone meal on an observer
 * clock (period 8 ticks). A piston on the same clock breaks the kelp
 * at the second block; the items float up the water column and the current
 * carries them out through the open fence gate to the player in front.
 * The water source the kelp grows into is deleted by the piston head and
 * refills from above in 5 ticks – just in time for the next shot. More than
 * one pulse in the clock breaks that timing, so build it with the lever on
 * (clock held) and flip it once.
 *
 * Measured on 26.3 (examples/src/benchmarks.ts): 18,000 bone meal/h in,
 * one kelp per bone meal, ~93% of it picked up by the player. The original has four dispensers, but only
 * the west and east ones ever grow kelp; the north and south ones fill up
 * and never fire successfully. This rebuild leaves them out (glass instead).
 */
export const KelpBonemealCore = component(
  {
    name: "KelpBonemealCore",
    description: "Bone meal → kelp converter on an observer clock. Inputs: the four dispensers. Output: kelp, thrown out of the fence gate.",
    status: "game-tested",
    params: { running: false },
  },
  (c, { running }) => {
    const solid = B.of(c.material(M.solid));
    const glass = B.of(c.material(M.glass));
    const at = (spec: Parameters<typeof c.block>[0], ...cells: Vec3[]) => cells.map((p) => c.block(spec).at(p));

    // Kelp on its soil, with the four dispensers around its base
    at(B.of("minecraft:dirt"), [1, 0, 2]);
    at(B.of("minecraft:kelp", { age: 0 }), [1, 1, 2]);
    const dispensers = {
      West: c.block(B.of("minecraft:dispenser", { facing: "east", triggered: false })).at([0, 1, 2]),
      East: c.block(B.of("minecraft:dispenser", { facing: "west", triggered: false })).at([2, 1, 2]),
    };
    // Where the original's idle north and south dispensers were
    at(glass, [1, 1, 1], [1, 1, 3]);

    // Water column in glass; the sign on top stops the items, the gate lets them out
    // Sources in the column; the cell the kelp grows into is falling water,
    // and the top cell flows towards the gate – that current carries the items out
    at(B.water(), [1, 3, 2], [1, 4, 2], [1, 5, 2]);
    at(B.of("minecraft:water", { level: 8 }), [1, 2, 2]);
    at(B.of("minecraft:water", { level: 1 }), [1, 5, 3]);
    at(glass, [0, 2, 2], [0, 3, 2], [1, 3, 3], [1, 4, 1], [0, 4, 2], [2, 4, 2], [1, 4, 3], [1, 5, 1], [0, 5, 2], [2, 5, 2]);
    at(glass, [0, 5, 3], [2, 5, 3], [0, 5, 4], [2, 5, 4], [1, 6, 1], [0, 6, 2], [2, 6, 2], [0, 6, 3], [2, 6, 3], [0, 6, 4], [2, 6, 4]);
    at(B.of("minecraft:oak_wall_sign", { facing: "south", waterlogged: false }), [1, 6, 2]);
    c.block(B.of("minecraft:oak_fence_gate", { facing: "south", open: true, in_wall: false, powered: false })).at([1, 5, 4]);

    // Clock: four observers in a loop through a redstone wire and a note block
    const note = (instrument: string, powered: boolean, p: Vec3) =>
      c.block(B.of("minecraft:note_block", { instrument, note: 0, powered })).at(p);
    const observer = (facing: string, p: Vec3) => c.block(B.of("minecraft:observer", { facing, powered: false })).at(p);
    at(B.of("minecraft:piston", { facing: "south", extended: false }), [1, 2, 1]);
    at(B.of("minecraft:redstone_wire", { north: "side", south: "side", east: "none", west: "none", power: 0 }), [2, 2, 1]);
    at(solid, [2, 1, 1], [0, 3, 1], [0, 2, 3]);
    note("harp", false, [0, 1, 3]);
    note("harp", false, [0, 2, 1]);
    const clockNote = note("basedrum", !running, [2, 3, 3]);
    observer("south", [2, 2, 2]);
    observer("east", [1, 2, 3]);
    observer("up", [2, 2, 3]);
    observer("east", [1, 3, 1]);
    observer("down", [2, 3, 1]);
    observer("north", [2, 3, 2]);
    // On/off: the lever holds the note block powered, which stops the clock
    c.block(B.of("minecraft:lever", { face: "wall", facing: "south", powered: !running })).nextTo(clockNote, "south");

    // One input per dispenser, so each can have its own supply line
    for (const [side, d] of Object.entries(dispensers)) {
      const port = `bonemeal${side}`;
      c.input(port, d, { item: "minecraft:bone_meal", description: `bone meal into the ${side.toLowerCase()} dispenser` });
      // One shot per 8-tick cycle: 9,000/h per dispenser. Each shot grows one
      // kelp, but ~7% of the thrown items land out of reach of a player
      // standing 3 blocks in front (three runs: 17,213, 16,760, 16,067 kelp/h)
      c.converts(
        port,
        "kelp",
        { input: "minecraft:bone_meal", output: "minecraft:kelp", outputPerInput: 0.93, maxPerHour: 9_000 },
        "measured",
        "18,000 bone meal/h → ~16,700 kelp/h picked up for both (26.3)",
      );
    }
    // The items leave through the gate and land 1–3 blocks in front, at ground
    // level (the design's y=0 layer is dug into the ground). Their path stays
    // clear – a hopper there would suck the kelp in.
    c.output("kelp", [1, 1, 5], { item: "minecraft:kelp" });
    for (let y = 1; y <= 4; y++) c.keepClear([1, y, 4]);
    for (let z = 5; z <= 7; z++) for (let y = 1; y <= 2; y++) for (let x = 0; x <= 2; x++) c.keepClear([x, y, z]);
    c.note("Flip the lever once after building; extra clock pulses make the piston delete the water.");
  },
);

/**
 * Where the AFK player stands and picks items up. No blocks; the player's two
 * cells are kept free so nothing (not even the router) builds there. The
 * input covers the pickup range (one block around the player's box).
 */
export const PlayerPickup = component(
  { name: "PlayerPickup", description: "The AFK player as an item sink (inventory 36 stacks).", status: "game-tested", params: {} },
  (c) => {
    c.keepClear([0, 0, 0], [0, 1, 0]);
    const reach: Vec3[] = [];
    for (let y = 0; y <= 2; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) reach.push([x, y, z]);
    c.input("in", reach, { description: "items within pickup range" });
    c.stores("in", 36 * 64, "game-mechanic", "player inventory");
  },
);
