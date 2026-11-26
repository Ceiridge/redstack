#!/usr/bin/env node
// Downloads the Minecraft client jar listed in assets-manifest.json into the
// redstack cache (default ~/.cache/redstack, override with REDSTACK_CACHE) and
// verifies SHA-1 and SHA-256. Needed for 3D meshes only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const m = JSON.parse(readFileSync(join(here, "..", "assets-manifest.json"), "utf8"));
const out = join(process.env.REDSTACK_CACHE ?? join(homedir(), ".cache", "redstack"), `client-${m.minecraft}.jar`);
const hash = (alg, buf) => createHash(alg).update(buf).digest("hex");

if (existsSync(out) && hash("sha256", readFileSync(out)) === m.sha256) {
  console.log(`ok (cached) ${out}`);
  process.exit(0);
}
const res = await fetch(m.url);
if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
const buf = Buffer.from(await res.arrayBuffer());
if (hash("sha1", buf) !== m.sha1 || hash("sha256", buf) !== m.sha256) {
  console.error("checksum mismatch – nothing saved");
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`ok ${out}`);
