import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedAssembly } from "@redstack/core";
import { MeshConfig, MeshResult, ResourcePack } from "nucleation";
import { toNucleationSchematic } from "./schematic.js";

/**
 * 3D meshes need block models and textures: a resource pack. The vanilla
 * client jar is one; `pnpm assets` downloads it (checksum-verified) into the
 * cache directory. It is never committed (Mojang's assets).
 */
export function defaultResourcePackPath(minecraft = "26.3"): string {
  return join(process.env["REDSTACK_CACHE"] ?? join(homedir(), ".cache", "redstack"), `client-${minecraft}.jar`);
}

const packs = new Map<string, ResourcePack>();

/** Loads (and caches) a resource pack; parsing the vanilla jar takes a few seconds. */
export function loadResourcePack(path = defaultResourcePackPath()): ResourcePack {
  const cached = packs.get(path);
  if (cached) return cached;
  if (!existsSync(path)) throw new Error(`Resource pack not found: ${path}. Run "pnpm assets" first.`);
  const pack = ResourcePack.fromBytes(Array.from(readFileSync(path)));
  packs.set(path, pack);
  return pack;
}

export interface MeshOptions {
  readonly resourcePack?: string;
  /** Biome used for tinting grass, leaves and water */
  readonly biome?: string;
}

/** A textured 3D model of the assembly as binary glTF (GLB). */
export function meshGlb(assembly: ResolvedAssembly, options: MeshOptions = {}): Uint8Array {
  const pack = loadResourcePack(options.resourcePack);
  const s = toNucleationSchematic(assembly);
  try {
    const config = MeshConfig.create();
    if (options.biome) config.setBiome(options.biome);
    const mesh = MeshResult.create(s, pack, config);
    return new Uint8Array(Buffer.from(mesh.glbDataB64(), "base64"));
  } finally {
    s.clearContents();
  }
}
