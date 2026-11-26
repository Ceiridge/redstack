import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  B,
  DIR_VECTORS,
  type Dir,
  type HopperCell,
  type RoutingWorld,
  type Vec3,
  add,
  assembly,
  component,
  hopperSplit,
  poweredCells,
  hopperTree,
  key,
  routeHoppers,
  runChecks,
} from "./index.js";

/** A small world: given blocks, search box around them. */
function world(blocks: Record<string, string>, min: Vec3 = [-6, -4, -6], max: Vec3 = [10, 6, 10]): RoutingWorld {
  const at = (p: Vec3) => blocks[key(p)];
  return {
    occupied: (p) => at(p) !== undefined,
    blockAt: (p) => (at(p) ? `minecraft:${at(p)!.split("[")[0]}` : undefined),
    pushTarget: (p) => {
      const m = /^(hopper|dropper)\[facing=(\w+)\]$/.exec(at(p) ?? "");
      return m ? add(p, DIR_VECTORS[m[2] as Dir]) : undefined;
    },
    min,
    max,
  };
}

/**
 * Follows the items from `start` the way the game moves them: a hopper pushes
 * into what it faces and is drained by a hopper below it. Returns every cell
 * items can reach.
 */
function reach(hoppers: readonly HopperCell[], start: Vec3): Set<string> {
  const byKey = new Map(hoppers.map((h) => [key(h.pos), h]));
  const seen = new Set<string>();
  const todo = [key(start)];
  while (todo.length) {
    const k = todo.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const h = byKey.get(k);
    if (!h) continue;
    todo.push(key(add(h.pos, DIR_VECTORS[h.facing])));
    const below = key(add(h.pos, [0, -1, 0]));
    if (byKey.has(below)) todo.push(below);
  }
  return seen;
}

describe("routeHoppers", () => {
  it("lays a straight chain into a chest", () => {
    const r = routeHoppers(world({ "5,0,0": "chest" }), [0, 0, 0], [5, 0, 0]);
    assert.ok(r.ok);
    assert.equal(r.hoppers.length, 5);
    assert.ok(r.hoppers.every((h) => h.facing === "east"));
  });

  it("goes down where needed and ends facing the target", () => {
    const r = routeHoppers(world({ "3,-2,0": "chest" }), [0, 0, 0], [3, -2, 0]);
    assert.ok(r.ok);
    assert.ok(reach(r.hoppers, [0, 0, 0]).has("3,-2,0"));
    assert.equal(r.hoppers.length, 5, "start + 3 across + 1 down: the last hopper sits on top of the chest");
  });

  it("refuses to move items upwards", () => {
    const r = routeHoppers(world({ "3,2,0": "chest" }), [0, 0, 0], [3, 2, 0]);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "upward");
  });

  it("routes around a wall", () => {
    const blocks: Record<string, string> = { "4,0,0": "chest" };
    for (let z = -2; z <= 2; z++) for (let y = -4; y <= 0; y++) blocks[`2,${y},${z}`] = "stone";
    const r = routeHoppers(world(blocks), [0, 0, 0], [4, 0, 0]);
    assert.ok(r.ok);
    assert.ok(r.hoppers.every((h) => !blocks[key(h.pos)]));
    assert.ok(reach(r.hoppers, [0, 0, 0]).has("4,0,0"));
  });

  it("does not pass under a foreign chest (it would drain it)", () => {
    // The direct line passes under (2,1,0); the router has to step around it
    const r = routeHoppers(world({ "4,0,0": "chest", "2,1,0": "chest" }), [0, 0, 0], [4, 0, 0]);
    assert.ok(r.ok);
    assert.ok(!r.hoppers.some((h) => key(h.pos) === "2,0,0"));
  });

  it("does not pass above a foreign hopper (it would be drained)", () => {
    const r = routeHoppers(world({ "4,0,0": "chest", "2,-1,0": "hopper[facing=down]" }), [0, 0, 0], [4, 0, 0]);
    assert.ok(r.ok);
    assert.ok(!r.hoppers.some((h) => key(h.pos) === "2,0,0"));
  });

  it("does not pass where a foreign hopper pushes in", () => {
    const r = routeHoppers(world({ "4,0,0": "chest", "2,0,-1": "hopper[facing=south]" }), [0, 0, 0], [4, 0, 0]);
    assert.ok(r.ok);
    assert.ok(!r.hoppers.some((h) => key(h.pos) === "2,0,0"));
  });
});

describe("redstone power", () => {
  it("keeps routes away from cells a torch or a powered block would lock", () => {
    const torch = { pos: [2, 0, 1] as Vec3, block: { id: "minecraft:redstone_torch", props: {} } };
    const p = poweredCells([torch]);
    assert.ok(p.has("2,0,0") && p.has("2,1,1"));
    const w = { ...world({ "4,0,0": "chest", "2,0,1": "redstone_torch" }), powered: (c: Vec3) => p.has(key(c)) };
    const r = routeHoppers(w, [0, 0, 0], [4, 0, 0]);
    assert.ok(r.ok);
    assert.ok(r.hoppers.every((h) => !p.has(key(h.pos))));
  });

  it("powers only the sides a dust points to", () => {
    const at = (pos: Vec3, id: string, props: Record<string, string> = {}) => ({ pos, block: { id: `minecraft:${id}`, props } });
    // A line along z: its sides along x stay unpowered
    let p = poweredCells([at([0, 0, 0], "redstone_wire"), at([0, 0, 1], "redstone_wire"), at([0, 0, 2], "stone")]);
    assert.ok(!p.has("1,0,0") && !p.has("-1,0,0"), "beside a line");
    assert.ok(p.has("0,0,-1") && p.has("0,0,2") && p.has("0,-1,0"), "the line's ends and the block below");
    // An L: points north and east only
    p = poweredCells([at([0, 0, 0], "redstone_wire"), at([0, 0, -1], "redstone_wire"), at([1, 0, 0], "redstone_wire")]);
    assert.ok(!p.has("-1,0,0") && !p.has("0,0,1"));
    // A lone dust is a cross
    p = poweredCells([at([0, 0, 0], "redstone_wire")]);
    assert.ok(["1,0,0", "-1,0,0", "0,0,1", "0,0,-1"].every((k) => p.has(k)));
    // A repeater beside it, not on its axis, does not connect: still a cross
    p = poweredCells([at([0, 0, 0], "redstone_wire"), at([1, 0, 0], "repeater", { facing: "north" })]);
    assert.ok(p.has("-1,0,0") && p.has("0,0,1"));
    // A comparator does: the dust becomes a line towards it
    p = poweredCells([at([0, 0, 0], "redstone_wire"), at([1, 0, 0], "comparator", { facing: "north" })]);
    assert.ok(!p.has("0,0,1") && p.has("-1,0,0"));
    // Dust climbing onto a block connects
    p = poweredCells([at([0, 0, 0], "redstone_wire"), at([1, 0, 0], "stone"), at([1, 1, 0], "redstone_wire")]);
    assert.ok(!p.has("0,0,1"), "the lower dust is a line towards the step");
  });

  it("follows power through a solid block in front of an observer", () => {
    const blocks: Array<{ pos: Vec3; block: { id: string; props: Record<string, string> } }> = [
      { pos: [0, 0, 0] as Vec3, block: { id: "minecraft:observer", props: { facing: "west" } } },
      { pos: [1, 0, 0] as Vec3, block: { id: "minecraft:stone", props: {} } },
      { pos: [0, 0, 3] as Vec3, block: { id: "minecraft:glass", props: {} } },
    ];
    const p = poweredCells(blocks, { pulses: true });
    assert.ok(p.has("2,0,0") && p.has("1,1,0"), "the stone's neighbours are powered");
    assert.ok(!p.has("-1,0,0"), "observers output away from the side they watch");
    assert.equal(poweredCells(blocks).size, 0, "observer pulses are left out by default");
  });
});

describe("hopperTree", () => {
  const sources: Vec3[] = [
    [0, 2, 0],
    [0, 2, 4],
    [0, 2, 8],
  ];

  it("delivers every source into the target", () => {
    const r = hopperTree(world({ "6,0,4": "chest" }), sources, [6, 0, 4]);
    assert.ok(r.ok);
    for (const s of sources) assert.ok(reach(r.hoppers, s).has("6,0,4"), `source ${s.join(",")} reaches the chest`);
  });

  it("shares hoppers: fewer than three separate routes", () => {
    const w = world({ "6,0,4": "chest" });
    const tree = hopperTree(w, sources, [6, 0, 4]);
    const separate = sources.map((s) => routeHoppers(w, s, [6, 0, 4]));
    assert.ok(tree.ok && separate.every((r) => r.ok));
    const sum = separate.reduce((n, r) => n + (r.ok ? r.hoppers.length : 0), 0);
    assert.ok(tree.hoppers.length < sum, `${tree.hoppers.length} < ${sum}`);
  });

  it("never puts a hopper under a tree hopper (pull loops)", () => {
    const r = hopperTree(world({ "6,0,4": "chest" }), sources, [6, 0, 4]);
    assert.ok(r.ok);
    const cells = new Map(r.hoppers.map((h) => [key(h.pos), h]));
    for (const h of r.hoppers) {
      const below = cells.get(key(add(h.pos, [0, -1, 0])));
      // Only allowed when the upper hopper pushes straight down into it
      if (below) assert.equal(h.facing, "down", `${key(h.pos)} sits above ${key(below.pos)} without pushing into it`);
    }
  });
});

describe("hopperSplit", () => {
  const targets: Vec3[] = [
    [4, 0, 0],
    [0, 0, 4],
    [4, 0, 4],
  ];
  const chests = Object.fromEntries(targets.map((t) => [key(t), "dispenser[facing=up]"]));

  it("reaches every target from one start, branching below network hoppers", () => {
    const r = hopperSplit(world(chests), [0, 3, 0], targets);
    assert.ok(r.ok);
    const reached = reach(r.hoppers, [0, 3, 0]);
    for (const t of targets) assert.ok(reached.has(key(t)), `reaches ${key(t)}`);
  });

  it("branches do not merge back: every hopper has exactly one path forward", () => {
    const r = hopperSplit(world(chests), [0, 3, 0], targets);
    assert.ok(r.ok);
    const cells = new Map(r.hoppers.map((h) => [key(h.pos), h]));
    for (const h of r.hoppers) {
      const above = cells.get(key(add(h.pos, [0, 1, 0])));
      const feeders = r.hoppers.filter((x) => key(add(x.pos, DIR_VECTORS[x.facing])) === key(h.pos)).length + (above && above.facing !== "down" ? 1 : 0);
      assert.ok(feeders <= 1 || key(h.pos) === "0,3,0", `${key(h.pos)} is fed from ${feeders} sides`);
    }
  });
});

describe("route in components", () => {
  const Source = component({ name: "Source" }, (c) => {
    const chest = c.block(B.chest());
    c.output("out", chest.down, { item: "minecraft:cobblestone", rate: { perHour: 20_000, basis: "estimate" } });
  });
  const Store = component({ name: "Store" }, (c) => {
    c.input("in", c.block(B.chest()));
    c.stores("in", 27 * 64, "game-mechanic");
  });

  it("places and orients hoppers between two ports, after the children are placed", () => {
    const a = assembly("routed", (f) => {
      const src = f.add(Source).at([0, 3, 0]);
      const dst = f.add(Store).at([6, 0, 3]);
      f.route(src.port("out"), dst.port("in"));
    });
    const r = a.resolve();
    assert.deepEqual(
      runChecks(r).filter((d) => d.severity === "error"),
      [],
    );
    const hoppers = [...r.blocks.values()].filter((b) => b.block.id === "minecraft:hopper");
    assert.ok(hoppers.length >= 6 + 3);
    assert.ok(r.instances.has("HopperRoute#1"));
    assert.ok(
      r.connections.some((c) => c.from.instanceId === "Source#1" && c.to.instanceId === "HopperRoute#1"),
      "the route is part of the flow graph",
    );
  });

  it("reports an impossible route instead of throwing", () => {
    const a = assembly("upward", (f) => {
      const src = f.add(Source).at([0, 0, 0]);
      const dst = f.add(Store).at([4, 5, 0]);
      f.route(src.port("out"), dst.port("in"));
    });
    const errs = runChecks(a.resolve()).filter((d) => d.severity === "error");
    assert.ok(errs.some((d) => d.code === "route-failed" && /up/.test(d.message)));
  });
});

describe("crosstalk heuristic", () => {
  const Obs = component({ name: "Obs" }, (c) => void c.block(B.of("minecraft:observer", { facing: "south", powered: false })).at([0, 0, 0]));
  const Hop = component({ name: "Hop" }, (c) => void c.block(B.hopper()).at([0, 0, 0]));
  const warnings = (hopperAt: Vec3) =>
    runChecks(
      assembly("x", (f) => {
        f.add(Obs).at([0, 0, 0]);
        f.add(Hop).at(hopperAt);
      }).resolve(),
    ).filter((d) => d.code === "possible-crosstalk");

  it("flags a hopper in front of or behind an observer", () => {
    assert.equal(warnings([0, 0, 1]).length, 1, "watched side");
    assert.equal(warnings([0, 0, -1]).length, 1, "output side");
  });

  it("ignores a hopper beside an observer", () => {
    assert.equal(warnings([1, 0, 0]).length, 0);
  });
});
