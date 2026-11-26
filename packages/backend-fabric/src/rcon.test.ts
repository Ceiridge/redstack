import assert from "node:assert/strict";
import { type AddressInfo, type Socket, createServer } from "node:net";
import { describe, it } from "node:test";
import { Rcon } from "./rcon.js";

function packet(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, "utf8");
  const out = Buffer.alloc(14 + b.length);
  out.writeInt32LE(10 + b.length, 0);
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  b.copy(out, 12);
  return out;
}

/**
 * A server as strict as the vanilla one: every socket read must hold exactly
 * one packet, else the connection is closed. It reads slowly, so two packets
 * written back to back arrive in one read, Nagle or not. `reply` maps a command to its
 * reply parts (several packets for long replies).
 */
async function strictServer(reply: (cmd: string) => string[]): Promise<{ port: number; close: () => void; dropped: () => boolean }> {
  let dropped = false;
  const sockets: Socket[] = [];
  const server = createServer((s) => {
    sockets.push(s);
    // Everything that arrives within 100 ms counts as one read (longer than a delayed ACK)
    let pending = Buffer.alloc(0);
    let timer: NodeJS.Timeout | undefined;
    s.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const d = pending;
        pending = Buffer.alloc(0);
        const len = d.readInt32LE(0);
        if (len !== d.length - 4) {
          dropped = true;
          s.destroy();
          return;
        }
        const id = d.readInt32LE(4);
        const type = d.readInt32LE(8);
        const body = d.subarray(12, d.length - 2).toString("utf8");
        if (type === 3) s.write(packet(id, 2, ""));
        else if (type === 2) for (const part of reply(body)) s.write(packet(id, 0, part));
        else s.write(packet(id, 0, `Unknown request ${type.toString(16)}`));
      }, 100);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
    dropped: () => dropped,
  };
}

describe("rcon", () => {
  it("never puts two packets in one read and joins multi-packet replies", async () => {
    const srv = await strictServer((cmd) => (cmd === "long" ? ["a".repeat(4096), "b".repeat(100)] : [`ok ${cmd}`]));
    try {
      const r = await Rcon.connect("127.0.0.1", srv.port, "pw");
      assert.equal(await r.command("one"), "ok one");
      const [x, y] = await Promise.all([r.command("two"), r.command("long")]);
      assert.equal(x, "ok two");
      assert.equal(y, "a".repeat(4096) + "b".repeat(100));
      assert.equal(await r.command("three"), "ok three");
      assert.ok(!srv.dropped());
      r.close();
    } finally {
      srv.close();
    }
  });
});
