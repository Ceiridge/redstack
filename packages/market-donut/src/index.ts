/**
 * DonutSMP module.
 *
 * As of 2026-11-25:
 * - The official DonutSMP public API has been disabled completely according
 *   to third-party projects (e.g. lootseller.io). There is no live data.
 * - Since the update of 2–3 June 2026 there is no /shop any more; trading
 *   happens via the auction house (/ah) and buy orders (/orders).
 * - Historical prices: when donutflipper shut down (2026-11-23) it published
 *   its price history since August 2026 as plain files. A converter into the
 *   @redstack/market-static format is planned (check the licence first).
 *
 * Until then: maintain prices as JSON and load them via StaticPriceSource.
 * Verify everything here before relying on it – server economies change often.
 */

import type { MarketProfile } from "@redstack/economy";
import { StaticPriceSource } from "@redstack/market-static";

export const donutProfile: MarketProfile = {
  id: "donutsmp",
  name: "DonutSMP",
  currency: "$",
  channels: [
    { id: "auction", name: "Auction house (/ah)", notes: "fees not verified" },
    { id: "orders", name: "Buy orders (/orders)", notes: "fees not verified" },
  ],
  notes: [
    "Public API disabled (as of Nov 2026)",
    "/shop removed in June 2026",
    "Exploits and dupes risk a ban – the discovery track excludes them by default",
  ],
};

/** Loads Donut prices from a locally maintained file in the static format. */
export function donutPricesFromFile(path: string, feeRate = 0): StaticPriceSource {
  return StaticPriceSource.fromPath(path, feeRate);
}
