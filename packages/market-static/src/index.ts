/**
 * Preisquelle aus einer lokalen JSON-Datei. Funktioniert für jeden Server:
 * Preise selbst pflegen, aus einem Export konvertieren oder per Skript erzeugen.
 *
 * Format (Beispiel):
 * {
 *   "source": "manuell",
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
  if (typeof f !== "object" || f === null) throw new Error("Preisdatei: kein Objekt.");
  if (typeof f.source !== "string" || typeof f.channel !== "string" || typeof f.asOf !== "string") {
    throw new Error("Preisdatei: source, channel und asOf sind Pflicht.");
  }
  if (Number.isNaN(Date.parse(f.asOf))) throw new Error("Preisdatei: asOf ist kein Datum.");
  if (typeof f.items !== "object" || f.items === null) throw new Error("Preisdatei: items fehlt.");
  for (const [item, q] of Object.entries(f.items)) {
    for (const k of ["sell", "buy", "maxSellPerHour"] as const) {
      const v = q[k];
      if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= 0)) {
        throw new Error(`Preisdatei: ${item}.${k} muss eine Zahl >= 0 sein.`);
      }
    }
  }
  return f as StaticPriceFile;
}

export class StaticPriceSource implements PriceSource {
  readonly id: string;
  readonly #file: StaticPriceFile;
  /** Anteil, der beim Verkauf abgezogen wird (Gebühren des Kanals) */
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
