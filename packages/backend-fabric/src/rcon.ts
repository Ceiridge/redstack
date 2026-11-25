/**
 * Minimal RCON client (Source RCON protocol, as spoken by Minecraft).
 * No dependencies. Commands run strictly one after another.
 */

import { Socket } from "node:net";

const TYPE_AUTH = 3;
const TYPE_COMMAND = 2;

interface Packet {
  id: number;
  type: number;
  body: string;
}

function encode(p: Packet): Buffer {
  const body = Buffer.from(p.body, "utf8");
  const buf = Buffer.alloc(14 + body.length);
  buf.writeInt32LE(10 + body.length, 0);
  buf.writeInt32LE(p.id, 4);
  buf.writeInt32LE(p.type, 8);
  body.copy(buf, 12);
  // the two trailing null bytes are already zero from Buffer.alloc
  return buf;
}

export class Rcon {
  readonly #socket: Socket;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void; parts: string[] }>();
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", (d) => this.#onData(d));
    socket.on("error", (e) => this.#failAll(e));
    socket.on("close", () => this.#failAll(new Error("RCON connection closed.")));
  }

  static async connect(host: string, port: number, password: string, timeoutMs = 10_000): Promise<Rcon> {
    const socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`RCON: could not connect to ${host}:${port}.`)), timeoutMs);
      socket.once("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
      socket.connect(port, host, () => {
        clearTimeout(t);
        resolve();
      });
    });
    const rcon = new Rcon(socket);
    const id = rcon.#nextId++;
    const auth = new Promise<string>((resolve, reject) => rcon.#pending.set(id, { resolve, reject, parts: [] }));
    socket.write(encode({ id, type: TYPE_AUTH, body: password }));
    await auth;
    return rcon;
  }

  /** Runs a command (without leading slash) and returns the reply. */
  command(cmd: string): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const id = this.#nextId++;
        this.#pending.set(id, { resolve, reject, parts: [] });
        this.#socket.write(encode({ id, type: TYPE_COMMAND, body: cmd }));
      });
    const p = this.#queue.then(run, run);
    this.#queue = p.catch(() => undefined);
    return p;
  }

  close(): void {
    this.#socket.end();
  }

  #onData(d: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, d]);
    while (this.#buffer.length >= 4) {
      const len = this.#buffer.readInt32LE(0);
      if (this.#buffer.length < 4 + len) return;
      const id = this.#buffer.readInt32LE(4);
      const body = this.#buffer.subarray(12, 4 + len - 2).toString("utf8");
      this.#buffer = this.#buffer.subarray(4 + len);
      if (id === -1) {
        this.#failAll(new Error("RCON: authentication failed."));
        return;
      }
      const p = this.#pending.get(id);
      if (!p) continue;
      this.#pending.delete(id);
      p.resolve(body);
    }
  }

  #failAll(e: Error): void {
    for (const p of this.#pending.values()) p.reject(e);
    this.#pending.clear();
  }
}
