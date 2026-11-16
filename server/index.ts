// Serveur local : API JSON + flux temps réel (SSE) + interface React.
// N'écoute que sur 127.0.0.1 : les transcripts restent sur votre machine.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSession, findSessionDir, listSessions, projectsRoot } from "./parser.ts";
import { installTeam, teamReport } from "./team.ts";
import { officeReport } from "./office.ts";
import { activeRuns, answerPermission, conversations, history, startRun, stopRun, streamRun } from "./chat.ts";
import { addProject, listDir, listProjects, removeProject } from "./projects.ts";

const CLAUDE_DIR = path.resolve(process.env.CLAUDE_DIR ?? path.join(os.homedir(), ".claude"));
const PORT = Number(process.env.PORT ?? 4317);
const HOST = "127.0.0.1"; // toujours local : cette appli peut lancer Claude Code sur ta machine
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 200_000) break;
  }
  try {
    return JSON.parse(data || "{}");
  } catch {
    return {};
  }
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
  try {
    const agents = path.join(CLAUDE_DIR, "agents");
    for (const f of fs.readdirSync(agents)) sig += `agents/${f}:${fs.statSync(path.join(agents, f)).mtimeMs};`;
  } catch {
    /* pas d'agents perso */
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

/**
 * Cette appli peut lancer Claude Code sur ta machine : on n'accepte que les
 * requêtes venues de sa propre page (pas d'un autre site ouvert dans le navigateur).
 */
function allowed(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false; // anti DNS rebinding
  if (req.method === "GET") return true;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return String(req.headers["content-type"] ?? "").startsWith("application/json");
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!allowed(req)) return json(res, 403, { error: "requête refusée" });
  const post = req.method === "POST";

  // ---- projets
  if (url.pathname === "/api/projects" && !post) return json(res, 200, listProjects(CLAUDE_DIR));
  if (url.pathname === "/api/projects" && post) {
    const body = await readBody(req);
    try {
      return json(res, 200, body.remove ? (removeProject(String(body.path)), { ok: true }) : addProject(String(body.path ?? "")));
    } catch (e: any) {
      return json(res, 400, { error: e.message });
    }
  }
  if (url.pathname === "/api/fs") return json(res, 200, listDir(url.searchParams.get("path") ?? undefined));

  // ---- discussion avec Claude Code
  if (url.pathname === "/api/conversations") {
    return json(res, 200, await conversations(String(url.searchParams.get("cwd") ?? "")));
  }
  if (url.pathname === "/api/history") {
    try {
      return json(res, 200, await history(String(url.searchParams.get("sessionId")), String(url.searchParams.get("cwd") ?? "")));
    } catch (e: any) {
      return json(res, 500, { error: e.message });
    }
  }
  if (url.pathname === "/api/chat/active") return json(res, 200, activeRuns());
  if (url.pathname === "/api/chat" && post) {
    const b = await readBody(req);
    if (!b.prompt || !b.cwd) return json(res, 400, { error: "message ou dossier manquant" });
    try {
      const run = startRun({ cwd: String(b.cwd), prompt: String(b.prompt), sessionId: b.sessionId || undefined, mode: ["default", "acceptEdits", "plan"].includes(b.mode) ? b.mode : "default", model: b.model, team: b.team !== false });
      return json(res, 200, { runId: run.id });
    } catch (e: any) {
      return json(res, 400, { error: e.message });
    }
  }
  const cm = /^\/api\/chat\/([0-9a-f-]+)\/(stream|permission|stop)$/.exec(url.pathname);
  if (cm) {
    const [, runId, action] = cm;
    if (action === "stream") return streamRun(runId, req, res) || json(res, 404, { error: "discussion introuvable" });
    if (action === "permission" && post) {
      const b = await readBody(req);
      return json(res, answerPermission(runId, String(b.id), !!b.allow, !!b.always) ? 200 : 404, {});
    }
    if (action === "stop" && post) return json(res, (await stopRun(runId)) ? 200 : 404, {});
  }

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
  if (url.pathname === "/api/office") {
    return json(res, 200, officeReport(ROOT, CLAUDE_DIR));
  }
  if (url.pathname === "/api/team" && req.method === "GET") {
    return json(res, 200, teamReport(ROOT, CLAUDE_DIR));
  }
  if (url.pathname === "/api/team/install" && post) {
    const body = await readBody(req);
    return json(res, 200, installTeam(ROOT, CLAUDE_DIR, !!body.overwrite));
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
    const port = (server.address() as import("node:net").AddressInfo).port;
    console.log(`\n  Claude Studio  →  http://${HOST}:${port}`);
    console.log(`  Transcripts lus dans  →  ${projectsRoot(CLAUDE_DIR)}\n`);
  });
}

main();
