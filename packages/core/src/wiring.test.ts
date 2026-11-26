import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Vec3, add, key } from "./geometry.js";
import { poweredCells } from "./routing.js";
import { type WireWorld, routeWire } from "./wiring.js";

/** A world from "x,y,z": "id[facing=…]" entries; everything below y=0 is free too. */
function world(blocks: Record<string, string>, min: Vec3 = [-6, -3, -6], max: Vec3 = [24, 6, 6]): WireWorld {
  const parsed = new Map<string, { id: string; facing?: string }>();
  for (const [k, v] of Object.entries(blocks)) {
    const m = /^([a-z_]+)(?:\[facing=([a-z]+)\])?$/.exec(v)!;
    parsed.set(k, m[2] ? { id: `minecraft:${m[1]}`, facing: m[2] } : { id: `minecraft:${m[1]}` });
  }
  const list = [...parsed].map(([k, b]) => ({ pos: k.split(",").map(Number) as unknown as Vec3, block: { id: b.id, props: (b.facing ? { facing: b.facing } : {}) as Record<string, string> } }));
  const powered = poweredCells(list);
  return { occupied: (p) => parsed.has(key(p)), blockAt: (p) => parsed.get(key(p)), powered: (p) => powered.has(key(p)), min, max };
}

describe("wire router", () => {
  it("runs dust and puts a repeater in before the signal dies", () => {
    const r = routeWire(world({ "20,0,0": "dropper" }), [0, 0, 0], [20, 0, 0], "east");
    assert.ok(r.ok, !r.ok ? r.message : "");
    const repeaters = r.elements.filter((e) => e.kind === "repeater");
    assert.ok(repeaters.length >= 1, "20 blocks need at least one repeater");
    assert.ok(r.strength >= 1);
    // Strength never drops below 1 along the way
    let s = 15;
    for (const [i, e] of r.elements.entries()) {
      s = e.kind === "repeater" ? 15 : i === 0 ? s : s - 1;
      assert.ok(s >= 1);
    }
    assert.equal(r.delayTicks, repeaters.reduce((t, e) => t + (e.kind === "repeater" ? 2 * e.delay : 0), 0));
  });

  it("keeps away from a hopper it would lock and from foreign dust it would join", () => {
    // A hopper and a foreign dust line right beside the straight way
    const w = world({ "8,0,0": "dropper", "4,0,1": "hopper", "4,-1,1": "stone", "3,0,-1": "redstone_wire", "3,-1,-1": "stone" });
    const r = routeWire(w, [0, 0, 0], [8, 0, 0], "east");
    assert.ok(r.ok, !r.ok ? r.message : "");
    const cells = new Set(r.elements.map((e) => key(e.pos)));
    const supports = new Set(r.supports.map(key));
    for (const e of r.elements) {
      if (e.kind !== "dust") continue;
      // No dust next to the foreign dust, no support next to the hopper
      assert.ok(![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some((d) => key(add(e.pos, d as unknown as Vec3)) === "3,0,-1"), `dust at ${key(e.pos)} joins the foreign line`);
    }
    for (const s of supports) assert.ok(![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some((d) => key(add(s.split(",").map(Number) as unknown as Vec3, d as unknown as Vec3)) === "4,0,1"), `support ${s} powers the hopper`);
    assert.ok(!cells.has("4,0,1"));
  });

  it("climbs with a dust stair and reports the cells that must stay free", () => {
    // A wall across the way, two high: over it
    const wall: Record<string, string> = { "6,1,0": "dropper" };
    for (let z = -6; z <= 6; z++) for (const y of [0, 1]) wall[`3,${y},${z}`] = "stone";
    const r = routeWire(world(wall), [0, 0, 0], [6, 1, 0], "east");
    assert.ok(r.ok, !r.ok ? r.message : "");
    assert.ok(r.elements.some((e) => e.pos[1] >= 2), "goes over the wall");
    assert.ok(r.clear.length > 0);
  });

  it("adds delay with repeaters when asked", () => {
    const r = routeWire(world({ "10,0,0": "dropper" }), [0, 0, 0], [10, 0, 0], "east", { minDelayTicks: 20 });
    assert.ok(r.ok, !r.ok ? r.message : "");
    assert.ok(r.delayTicks >= 20);
    const short = routeWire(world({ "3,0,0": "dropper" }), [0, 0, 0], [3, 0, 0], "east", { minDelayTicks: 40 });
    assert.ok(!short.ok);
  });

  it("does not let a foreign torch feed it", () => {
    const w = world({ "6,0,0": "dropper", "3,0,1": "redstone_torch" });
    const r = routeWire(w, [0, 0, 0], [6, 0, 0], "east");
    assert.ok(r.ok, !r.ok ? r.message : "");
    for (const e of r.elements) if (e.kind === "dust") assert.ok(!["2,0,1", "4,0,1", "3,0,0", "3,0,2", "3,1,1"].includes(key(e.pos)), `dust at ${key(e.pos)} next to the torch`);
  });
});
