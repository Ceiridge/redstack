/**
 * DonutSMP-Modul.
 *
 * Stand 25.11.2026:
 * - Die offizielle DonutSMP Public API ist laut Drittprojekten vollständig
 *   abgeschaltet (z. B. lootseller.io). Es gibt daher keinen Live-Abruf.
 * - Seit dem Update vom 2./3. Juni 2026 gibt es kein /shop mehr; gehandelt
 *   wird über Auktionshaus (/ah) und Kaufaufträge (/orders).
 * - Historische Preisdaten: donutflipper hat zur Abschaltung (23.11.2026)
 *   seine Preis-Historie ab August 2026 als Dateien veröffentlicht. Ein
 *   Konverter in das Format von @redstack/market-static ist geplant.
 *
 * Bis dahin: Preise als JSON pflegen und über StaticPriceSource laden.
 * Alle Angaben hier vor Nutzung prüfen – Server ändern ihre Wirtschaft oft.
 */

import type { MarketProfile } from "@redstack/economy";
import { StaticPriceSource } from "@redstack/market-static";

export const donutProfile: MarketProfile = {
  id: "donutsmp",
  name: "DonutSMP",
  currency: "$",
  channels: [
    { id: "auction", name: "Auktionshaus (/ah)", notes: "Gebühren nicht verifiziert" },
    { id: "orders", name: "Kaufaufträge (/orders)", notes: "Gebühren nicht verifiziert" },
  ],
  notes: [
    "Öffentliche API abgeschaltet (Stand Nov. 2026)",
    "/shop seit Juni 2026 entfernt",
    "Exploits und Dupes sind Bann-Risiko – der Entdeckungs-Zweig schließt sie standardmäßig aus",
  ],
};

/** Lädt Donut-Preise aus einer lokal gepflegten Datei im Static-Format. */
export function donutPricesFromFile(path: string, feeRate = 0): StaticPriceSource {
  return StaticPriceSource.fromPath(path, feeRate);
}
