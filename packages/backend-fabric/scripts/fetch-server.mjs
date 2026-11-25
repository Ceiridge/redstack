#!/usr/bin/env node
// Lädt Server-Dateien laut server-manifest.json und prüft SHA-256.
// Fail closed: ohne Hash oder bei Abweichung wird nichts gespeichert.
// Nutzung: node packages/backend-fabric/scripts/fetch-server.mjs <zielordner>

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "server-manifest.json"), "utf8"));
const target = resolve(process.argv[2] ?? "servers/fabric");

for (const f of manifest.files) {
  if (!f.url || !f.sha256) {
    console.error(`Abbruch: ${f.name} hat keine URL oder keinen SHA-256 im Manifest. Erst prüfen und eintragen.`);
    process.exit(1);
  }
}

for (const f of manifest.files) {
  const res = await fetch(f.url);
  if (!res.ok) {
    console.error(`Download fehlgeschlagen: ${f.name} (${res.status})`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  if (hash !== f.sha256.toLowerCase()) {
    console.error(`Hash stimmt nicht für ${f.name}: erwartet ${f.sha256}, bekommen ${hash}. Nichts gespeichert.`);
    process.exit(1);
  }
  const out = join(target, f.name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`ok ${f.name}`);
}
