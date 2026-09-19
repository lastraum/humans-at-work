import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const METRICS_PREFIX = "/__metrics";

type MetricsStore = {
  pageViews: number;
  signups: number;
};

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metricsPath = resolve(rootDir, "data/metrics.json");

let queue: Promise<unknown> = Promise.resolve();

function emptyStore(): MetricsStore {
  return { pageViews: 0, signups: 0 };
}

function loadStore(): MetricsStore {
  try {
    const parsed = JSON.parse(readFileSync(metricsPath, "utf8")) as Partial<MetricsStore>;
    return {
      pageViews: Math.max(0, Number(parsed.pageViews) || 0),
      signups: Math.max(0, Number(parsed.signups) || 0),
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: MetricsStore) {
  mkdirSync(dirname(metricsPath), { recursive: true });
  writeFileSync(metricsPath, `${JSON.stringify(store, null, 2)}\n`);
}

function withStore<T>(fn: (store: MetricsStore) => T): Promise<T> {
  const run = queue.then(() => {
    const store = loadStore();
    const result = fn(store);
    saveStore(store);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function getMetricsSummary(): MetricsStore {
  return loadStore();
}

export function recordPageView(): Promise<MetricsStore> {
  return withStore((store) => {
    store.pageViews += 1;
    return { ...store };
  });
}

export function recordSignup(): Promise<MetricsStore> {
  return withStore((store) => {
    store.signups += 1;
    return { ...store };
  });
}

export function metricsPlugin(): Plugin {
  return {
    name: "haw-metrics",
    configureServer(server) {
      if (!existsSync(dirname(metricsPath))) mkdirSync(dirname(metricsPath), { recursive: true });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/data/metrics.json" || url.pathname === "/metrics.json") {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!url.pathname.startsWith(METRICS_PREFIX)) {
          next();
          return;
        }
        void handleMetrics(req, res, url.pathname).catch((err) => {
          json(res, 500, { ok: false, error: String(err) });
        });
      });
    },
  };
}

async function handleMetrics(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const method = req.method ?? "GET";

  if (pathname === `${METRICS_PREFIX}/pageview` && method === "POST") {
    await recordPageView();
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (pathname === `${METRICS_PREFIX}/summary` && method === "GET") {
    const totals = getMetricsSummary();
    json(res, 200, { ok: true, pageViews: totals.pageViews, signups: totals.signups });
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
}
