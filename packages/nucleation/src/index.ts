/**
 * Adapter for Nucleation (https://github.com/Schem-at/Nucleation).
 *
 * Nucleation is a third-party library; it is used only in this package so it
 * stays replaceable (see docs/ARCHITECTURE.md). What it provides here:
 *  - schematic export and import (.litematic, .schem)
 *  - a BlockRegistry from its built-in block table (tags, kinds, colours, states)
 *  - 3D meshes (GLB) textured with a Minecraft resource pack
 *
 * Not available in the npm build (0.12.3): the PNG renderer and the redstone
 * simulations. See docs/PLAN.md.
 */

export * from "./schematic.js";
export * from "./registry.js";
export * from "./mesh.js";
