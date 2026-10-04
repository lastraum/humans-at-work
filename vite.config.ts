import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { authPlugin } from "./server/auth";
import { presencePlugin } from "./server/presence";
import { floorRoomPlugin } from "./server/floorRoom";
import { livekitGatePlugin } from "./server/livekitGate";
import { isDirectLoopback } from "./server/net";

const HOSTS = ["humansat.work", "www.humansat.work", "humans.lastslice.co", "www.humans.lastslice.co"];
const prod = process.env.HAW_PROD === "1";
const FLOOR_POST_MAX = 2_000_000;

function floorPlatePlugin(): Plugin {
  const platePath = (root: string) => resolve(root, "data/floor-plate.json");

  const handle = (
    req: { method?: string; on: (event: string, cb: (chunk?: Buffer | string) => void) => void },
    res: {
      statusCode: number;
      setHeader: (name: string, value: string) => void;
      end: (body?: string) => void;
    },
    root: string,
    next: () => void,
  ) => {
    const out = platePath(root);
    if (req.method === "GET") {
      try {
        const body = readFileSync(out, "utf8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }
    if (req.method !== "POST") {
      next();
      return;
    }
    if (!isDirectLoopback(req as IncomingMessage)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "");
      size += buf.length;
      if (size > FLOOR_POST_MAX) return;
      chunks.push(buf);
    });
    req.on("end", () => {
      if (size > FLOOR_POST_MAX) {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "too large" }));
        return;
      }
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        JSON.parse(body);
        const text = body.endsWith("\n") ? body : `${body}\n`;
        writeFileSync(out, text);
        writeFileSync(resolve(root, "public/floor-plate.json"), text);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ ok: true, path: "data/floor-plate.json" }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
  };

  const attach = (server: ViteDevServer | PreviewServer) => {
    const run = (
      req: Parameters<typeof handle>[0],
      res: Parameters<typeof handle>[1],
      next: () => void,
    ) => handle(req, res, server.config.root, next);
    server.middlewares.use("/__floor-plate", run);
    server.middlewares.use("/__save-floor", run);
  };

  return {
    name: "floor-plate-io",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [floorPlatePlugin(), floorRoomPlugin(), livekitGatePlugin(), authPlugin(), presencePlugin()],
  server: {
    port: 5885,
    host: prod ? "127.0.0.1" : true,
    allowedHosts: HOSTS,
    ...(prod ? { hmr: false as const, watch: null } : { watch: { ignored: ["**/data/**"] } }),
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**"] },
  },
  preview: {
    port: 5885,
    host: "127.0.0.1",
    allowedHosts: HOSTS,
  },
  publicDir: "public",
});
