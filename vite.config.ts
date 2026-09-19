import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { authPlugin } from "./server/auth";
import { metricsPlugin } from "./server/metrics";
import { floorRoomPlugin } from "./server/floorRoom";
import { livekitGatePlugin } from "./server/livekitGate";

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
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? ""));
    });
    req.on("end", () => {
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

  return {
    name: "floor-plate-io",
    configureServer(server) {
      const run = (
        req: Parameters<typeof handle>[0],
        res: Parameters<typeof handle>[1],
        next: () => void,
      ) => handle(req, res, server.config.root, next);
      server.middlewares.use("/__floor-plate", run);
      server.middlewares.use("/__save-floor", run);
    },
  };
}

export default defineConfig({
  plugins: [floorPlatePlugin(), floorRoomPlugin(), livekitGatePlugin(), authPlugin(), metricsPlugin()],
  server: {
    port: 5885,
    host: true,
    allowedHosts: ["humans.lastslice.co", ".lastslice.co"],
    watch: {
      ignored: ["**/data/floor-plate.json", "**/data/accounts.json", "**/data/metrics.json", "**/data/office-ads/**"],
    },
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/accounts.json", "**/data/metrics.json"] },
  },
  publicDir: "public",
});
