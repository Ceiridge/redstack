#!/usr/bin/env node
// Local test server for redstack (Fabric + Carpet), Linux x64.
//
//   node packages/backend-fabric/scripts/server.mjs setup <dir> --accept-eula
//   node packages/backend-fabric/scripts/server.mjs start <dir>
//   node packages/backend-fabric/scripts/server.mjs stop  <dir>
//
// setup downloads the files from server-manifest.json and refuses any file
// whose SHA-256 does not match. It writes <dir>/.env with the RCON settings.
// --accept-eula records that you accept the Minecraft EULA
// (https://aka.ms/MinecraftEULA); the server does not start without it.

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "server-manifest.json"), "utf8"));
const [cmd, dirArg, ...flags] = process.argv.slice(2);
if (!cmd || !dirArg) {
  console.error("usage: server.mjs <setup|start|stop> <dir> [--accept-eula]");
  process.exit(2);
}
const dir = resolve(dirArg);
const RCON_PORT = 25575;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(file) {
  const out = join(dir, "dl", file.name);
  if (existsSync(out) && sha256(readFileSync(out)) === file.sha256) return out;
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`download failed: ${file.name} (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha256(buf);
  if (hash !== file.sha256) throw new Error(`checksum mismatch for ${file.name}: expected ${file.sha256}, got ${hash}. Nothing saved.`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`ok ${file.name}`);
  return out;
}

async function setup() {
  if (!flags.includes("--accept-eula")) {
    throw new Error("Running a Minecraft server requires accepting the Minecraft EULA (https://aka.ms/MinecraftEULA). Re-run with --accept-eula.");
  }
  const server = join(dir, "server");
  mkdirSync(join(server, "mods"), { recursive: true });
  for (const f of manifest.files) {
    const path = await download(f);
    if (f.name === "jre.tar.gz") {
      mkdirSync(join(dir, "jre"), { recursive: true });
      execFileSync("tar", ["-xzf", path, "-C", join(dir, "jre"), "--strip-components=1"]);
    } else {
      writeFileSync(join(server, f.name), readFileSync(path));
    }
  }
  const password = randomBytes(18).toString("base64url");
  writeFileSync(join(server, "eula.txt"), "eula=true\n");
  writeFileSync(join(server, "fabric-server-launcher.properties"), "serverJar=server.jar\n");
  writeFileSync(
    join(server, "server.properties"),
    [
      "server-ip=127.0.0.1",
      "online-mode=false", // only reachable from localhost; fake players need no accounts
      "enable-rcon=true",
      `rcon.port=${RCON_PORT}`,
      `rcon.password=${password}`,
      "broadcast-rcon-to-ops=false",
      "level-type=minecraft\\:flat",
      'generator-settings={"layers"\\:[{"block"\\:"minecraft\\:air","height"\\:1}],"biome"\\:"minecraft\\:the_void"}',
      "generate-structures=false",
      "gamemode=creative",
      "difficulty=peaceful",
      "spawn-protection=0",
      "view-distance=4",
      "simulation-distance=4",
      "pause-when-empty-seconds=-1",
      "sync-chunk-writes=false",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, ".env"),
    `REDSTACK_RCON_HOST=127.0.0.1\nREDSTACK_RCON_PORT=${RCON_PORT}\nREDSTACK_RCON_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  console.log(`Server ready in ${server}. RCON settings: ${join(dir, ".env")}`);
}

async function start() {
  const server = join(dir, "server");
  const log = join(server, "server.log");
  const out = openSync(log, "w");
  const child = spawn(join(dir, "jre", "bin", "java"), ["-Xms1G", "-Xmx3G", "-jar", "fabric-server-launch.jar", "nogui"], {
    cwd: server,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const text = readFileSync(log, "utf8");
    if (/RCON running on/.test(text)) {
      console.log(`Server running (pid ${child.pid}).`);
      return;
    }
    if (/Exception|Failed to start/.test(text) && i > 20) break;
  }
  throw new Error(`Server did not come up; see ${log}`);
}

async function stop() {
  const env = Object.fromEntries(
    readFileSync(join(dir, ".env"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("=", 2)),
  );
  const { Rcon } = await import(join(here, "..", "dist", "rcon.js"));
  const rcon = await Rcon.connect(env.REDSTACK_RCON_HOST, Number(env.REDSTACK_RCON_PORT), env.REDSTACK_RCON_PASSWORD);
  await rcon.command("stop").catch(() => undefined);
  rcon.close();
  console.log("Stop requested.");
}

const commands = { setup, start, stop };
if (!commands[cmd]) {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
commands[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
