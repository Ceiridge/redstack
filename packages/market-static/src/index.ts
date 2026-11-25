/**
 * Price source from a local JSON file. Works for any server: maintain prices
 * by hand, convert them from an export, or generate them with a script.
 *
 * Format (example):
 * {
 *   "source": "manual",
 *   "channel": "auction",
 *   "asOf": "2026-11-25T00:00:00Z",
 *   "items": {
 *     "minecraft:cactus": { "sell": 2.5, "buy": 3.1, "maxSellPerHour": 20000 }
 *   }
 * }
 */

import { readFileSync } from "node:fs";
import type { PriceSource, Quote } from "@redstack/economy";

export interface StaticPriceFile {
  readonly source: string;
  readonly channel: string;
  readonly asOf: string;
  readonly items: Readonly<Record<string, { sell?: number; buy?: number; maxSellPerHour?: number }>>;
}

export function parsePriceFile(json: unknown): StaticPriceFile {
  const f = json as Partial<StaticPriceFile>;
  if (typeof f !== "object" || f === null) throw new Error("Price file: not an object.");
  if (typeof f.source !== "string" || typeof f.channel !== "string" || typeof f.asOf !== "string") {
    throw new Error("Price file: source, channel and asOf are required.");
  }
  if (Number.isNaN(Date.parse(f.asOf))) throw new Error("Price file: asOf is not a date.");
  if (typeof f.items !== "object" || f.items === null) throw new Error("Price file: items is missing.");
  for (const [item, q] of Object.entries(f.items)) {
    for (const k of ["sell", "buy", "maxSellPerHour"] as const) {
      const v = q[k];
      if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= 0)) {
        throw new Error(`Price file: ${item}.${k} must be a number >= 0.`);
      }
    }
  }
  return f as StaticPriceFile;
}

export class StaticPriceSource implements PriceSource {
  readonly id: string;
  readonly #file: StaticPriceFile;
  /** Share deducted when selling (channel fees) */
  readonly #feeRate: number;

  constructor(file: StaticPriceFile, feeRate = 0) {
    this.#file = file;
    this.#feeRate = feeRate;
    this.id = `static:${file.source}`;
  }

  static fromPath(path: string, feeRate = 0): StaticPriceSource {
    return new StaticPriceSource(parsePriceFile(JSON.parse(readFileSync(path, "utf8"))), feeRate);
  }

  async quotes(items: readonly string[]): Promise<ReadonlyMap<string, Quote>> {
    const out = new Map<string, Quote>();
    const asOf = new Date(this.#file.asOf);
    for (const item of items) {
      const q = this.#file.items[item];
      if (!q) continue;
      out.set(item, {
        item,
        ...(q.sell !== undefined ? { sellPrice: q.sell * (1 - this.#feeRate) } : {}),
        ...(q.buy !== undefined ? { buyPrice: q.buy } : {}),
        ...(q.maxSellPerHour !== undefined ? { maxSellPerHour: q.maxSellPerHour } : {}),
        channel: this.#file.channel,
        asOf,
        source: this.id,
      });
    }
    return out;
  }
}
