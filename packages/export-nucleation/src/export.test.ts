import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Assembly, B, defineComponent, formatBlock } from "@redstack/core";
import { nucleationReader, nucleationWriter } from "./index.js";

const Probe = defineComponent({
  name: "Probe",
  description: "",
  status: "draft",
  defaults: {},
  build(c) {
    const h = c.origin(B.hopper().outputTo("forward"));
    c.place(B.comparator("subtract").signalTowards("right")).below(h);
    c.place(B.air()).above(h); // freigehalten, darf nicht exportiert werden
  },
});

describe("Export über Nucleation", () => {
  for (const rotation of [0, 1, 2, 3]) {
    it(`Litematic-Roundtrip erhält alle Block-States (Drehung ${rotation})`, () => {
      const a = new Assembly("probe");
      a.add(Probe).at([3, 5, 7]).rotated(rotation);
      const resolved = a.resolve();
      const { bytes } = nucleationWriter.write(resolved, { format: "litematic" });
      const back = nucleationReader.read(bytes, "litematic");
      const expected = [...resolved.blocks.values()]
        .filter((b) => b.block.id !== "minecraft:air")
        .map((b) => `${b.pos.join(",")}=${formatBlock(b.block)}`)
        .sort();
      const got = back.map((b) => `${b.pos.join(",")}=${b.block}`).sort();
      assert.deepEqual(got, expected);
    });
  }
});
