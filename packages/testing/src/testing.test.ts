import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembly } from "@redstack/core";
import { evaluateExpectations, ratesFromSamples, reportDiagnostics, scenario, summarize } from "./index.js";

describe("measurement maths", () => {
  it("computes hourly rates after the warm-up", () => {
    const samples = [
      { tick: 0, stored: { a: 0 } },
      { tick: 200, stored: { a: 5 } },
      { tick: 7_400, stored: { a: 905 } },
    ];
    // 900 items in 7,200 ticks = 9,000 per hour (72,000 ticks)
    assert.equal(ratesFromSamples(samples, 200)["a"], 9_000);
  });

  it("uses the actual tick of each sample, not the requested one", () => {
    const samples = [
      { tick: 0, stored: { a: 0 } },
      { tick: 7_201, stored: { a: 900 } },
    ];
    assert.ok(Math.abs(ratesFromSamples(samples, 0)["a"]! - 8_998.75) < 0.01);
  });

  it("summarizes runs with sample standard deviation", () => {
    const run = (x: number) => ({ run: 0, ticks: 1, measuredPerHour: { a: x }, samples: [], events: [], wallClockMs: 0 });
    const s = summarize([run(2), run(4), run(6)]);
    assert.equal(s["a"]!.mean, 4);
    assert.equal(s["a"]!.stdev, 2);
  });
});

describe("expectations", () => {
  const run = (rates: Record<string, number>) => ({ run: 0, ticks: 1, measuredPerHour: rates, samples: [], events: [], wallClockMs: 0 });
  const s = scenario(assembly("empty", () => {}).resolve(), {
    durationTicks: 1,
    expectations: [
      { type: "rate-at-least", item: "a", perHour: 10 },
      { type: "rate-at-most", item: "dirt", perHour: 0 },
    ],
  });

  it("checks lower and upper bounds", () => {
    assert.deepEqual(
      evaluateExpectations(s, [run({ a: 12, dirt: 0 })]).map((e) => e.passed),
      [true, true],
    );
    assert.deepEqual(
      evaluateExpectations(s, [run({ a: 8, dirt: 3 })]).map((e) => e.passed),
      [false, false],
    );
  });

  it("defaults to placement with updates and storage-port measurement", () => {
    assert.equal(s.placement, "with-updates");
    assert.deepEqual(s.measure, {});
  });
});

describe("test findings in place", () => {
  it("turns events and failed expectations into located diagnostics, once per place", () => {
    const report = {
      schemaVersion: 1 as const,
      scenario: "x",
      backend: "fabric-carpet",
      startedAt: "",
      summary: {},
      passed: false,
      expectations: [{ expectation: { type: "no-ground-items" as const }, passed: false, message: "5 items on the ground." }],
      runs: [
        {
          run: 0,
          ticks: 100,
          measuredPerHour: {},
          samples: [],
          wallClockMs: 1,
          events: [
            { tick: 100, type: "stuck-hopper" as const, at: [1, 2, 3] as const, message: "Backed up: 320 items in a hopper of A#1.", data: { items: 320, instance: "A#1" } },
            { tick: 100, type: "stuck-hopper" as const, at: [1, 2, 3] as const, message: "again", data: {} },
            { tick: 100, type: "ground-items" as const, at: [4, 0, 4] as const, message: "5 item(s)", data: { items: 5, positions: [[4, 0, 4], [5, 0, 4]] } },
          ],
        },
      ],
    };
    const d = reportDiagnostics(report);
    assert.deepEqual(d.map((x) => [x.code, x.at?.join(",") ?? ""]), [
      ["test-backed-up", "1,2,3"],
      ["test-ground-items", "4,0,4"],
      ["test-ground-items", "5,0,4"],
      ["test-expectation", ""],
    ]);
    assert.deepEqual(d[0]!.instances, ["A#1"]);
  });
});
