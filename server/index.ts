// Serveur local : API JSON + flux temps réel (SSE) + interface React.
// N'écoute que sur 127.0.0.1 : les transcripts restent sur votre machine.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSession, findSessionDir, listSessions, projectsRoot } from "./parser.ts";

const CLAUDE_DIR = path.resolve(process.env.CLAUDE_DIR ?? path.join(os.homedir(), ".claude"));
const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Empreinte des fichiers de transcripts : change dès qu'un agent écrit. */
function signature(): string {
  const root = projectsRoot(CLAUDE_DIR);
  let sig = "";
  try {
    for (const p of fs.readdirSync(root)) {
      const dir = path.join(root, p);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        try {
          if (e.isFile() && e.name.endsWith(".jsonl")) {
            sig += `${e.name}:${fs.statSync(full).mtimeMs};`;
          } else if (e.isDirectory()) {
            const sub = path.join(full, "subagents");
            for (const f of fs.readdirSync(sub)) sig += `${f}:${fs.statSync(path.join(sub, f)).mtimeMs};`;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* dossier absent */
  }
  return sig;
}

const clients = new Set<http.ServerResponse>();
let lastSig = signature();
let tick = 0;
setInterval(() => {
  if (clients.size === 0) return;
  const sig = signature();
  tick++;
  // on renvoie aussi un battement toutes les ~10 s pour faire vieillir les statuts "actif"
  if (sig !== lastSig || tick % 7 === 0) {
    lastSig = sig;
    for (const c of clients) c.write(`event: change\ndata: ${Date.now()}\n\n`);
  }
}, 1500);

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname === "/api/info") {
    return json(res, 200, { claudeDir: CLAUDE_DIR, exists: fs.existsSync(projectsRoot(CLAUDE_DIR)) });
  }
  if (url.pathname === "/api/sessions") {
    return json(res, 200, listSessions(CLAUDE_DIR, Number(url.searchParams.get("limit") ?? 100)));
  }
  const m = /^\/api\/sessions\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (m) {
    const dir = findSessionDir(CLAUDE_DIR, m[1]);
    const s = dir && buildSession(dir, m[1]);
    return s ? json(res, 200, s) : json(res, 404, { error: "session introuvable" });
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(": ok\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  json(res, 404, { error: "route inconnue" });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function serveStatic(res: http.ServerResponse, pathname: string) {
  const dist = path.join(ROOT, "dist");
  let file = path.normalize(path.join(dist, pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(500).end("Lancez d'abord `npm run build`.");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

async function main() {
  let vite: import("vite").ViteDevServer | undefined;
  if (!PROD) {
    const { createServer } = await import("vite");
    vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "spa" });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      api(req, res, url).catch((e) => json(res, 500, { error: String(e) }));
      return;
    }
    if (vite) vite.middlewares(req, res);
    else serveStatic(res, url.pathname);
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  Claude Agents Viewer  →  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    console.log(`  Transcripts lus dans  →  ${projectsRoot(CLAUDE_DIR)}\n`);
  });
}

main();
