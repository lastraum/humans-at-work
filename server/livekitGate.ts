import type { IncomingMessage } from "node:http";
import { AccessToken } from "livekit-server-sdk";
import { loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { MAX_ID, MAX_NAME } from "../src/protocol";
import { userIdForToken } from "./auth";

const TOKEN_PATH = "/__livekit/token";

function clampId(value: string) {
  const id = value.slice(0, MAX_ID);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

function bearer(req: IncomingMessage) {
  const header = String(req.headers.authorization ?? "");
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1] ?? "";
}

function attachLivekit(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== TOKEN_PATH) {
      next();
      return;
    }
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }

    const env = loadEnv(server.config.mode, server.config.root, "");
    const apiKey = env.LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY || "";
    const apiSecret = env.LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET || "";
    const livekitUrl = env.LIVEKIT_URL || process.env.LIVEKIT_URL || "";
    if (!apiKey || !apiSecret || !livekitUrl) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "livekit unconfigured" }));
      return;
    }

    const identity = clampId(url.searchParams.get("identity") ?? "");
    const name = String(url.searchParams.get("name") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME);
    const floorId = clampId(url.searchParams.get("room") ?? "floor-1") || "floor-1";
    if (!identity) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "bad identity" }));
      return;
    }
    if (userIdForToken(bearer(req)) !== identity) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: false, error: "signed out" }));
      return;
    }

    const roomName = `haw-${floorId}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: name || identity.slice(0, 8),
      ttl: "6h",
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish: false,
      canPublishData: true,
    });

    void token.toJwt().then((jwt) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: true, url: livekitUrl, token: jwt, room: roomName }));
    }).catch((err) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    });
  });
}

export function livekitGatePlugin(): Plugin {
  return {
    name: "livekit-gate",
    configureServer: attachLivekit,
    configurePreviewServer: attachLivekit,
  };
}
