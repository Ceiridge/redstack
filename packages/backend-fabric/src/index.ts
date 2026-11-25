/**
 * Test-Backend: lokaler Fabric-Server mit Carpet (Phase 3).
 *
 * Geplanter Ablauf pro Szenario:
 *  1. Server-Dateien per scripts/fetch-server.mjs laden (SHA-256-geprüft, siehe server-manifest.json)
 *  2. Server in einem Container mit gesperrtem Netzwerk starten (Mods sind beliebiger Code)
 *  3. Pro Szenario eine leere Dimension (Datapack, Void-Generator)
 *  4. Assembly als Structure/Litematic einfügen, Carpet-Fake-Player an den AFK-Spot
 *  5. Hopper-Counter an Ausgängen, /tick sprint, Ereignisse per RCON abfragen
 *  6. Bericht als TestReport (JSON)
 *
 * Mehrere Serverprozesse laufen parallel; Dimensionen trennen nur, sie
 * beschleunigen nicht (ein Server-Thread für alle Dimensionen).
 */

import type { Capability, Scenario, TestBackend, TestReport } from "@redstack/testing";

export class FabricCarpetBackend implements TestBackend {
  readonly id = "fabric-carpet";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "redstone",
    "block-updates",
    "items",
    "random-ticks",
    "mob-spawning",
    "villagers",
    "chunk-reload",
    "fake-player",
  ]);

  async run(_scenario: Scenario): Promise<TestReport> {
    throw new Error("FabricCarpetBackend ist noch nicht implementiert (Phase 3, siehe docs/PLAN.md).");
  }
}
