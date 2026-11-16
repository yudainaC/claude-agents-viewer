// Lecture des transcripts Claude Code (~/.claude/projects) et construction
// de l'arbre agents / sous-agents.
//
// Disposition sur disque (Claude Code récent) :
//   projects/<projet-encodé>/<sessionId>.jsonl                       agent principal
//   projects/<projet-encodé>/<sessionId>/subagents/agent-<id>.jsonl  un sous-agent
//   projects/<projet-encodé>/<sessionId>/subagents/agent-<id>.meta.json
//       { agentType, description, toolUseId, spawnDepth, model, finished }
//
// Le parent d'un sous-agent est le transcript qui contient le tool_use
// (outil "Agent" ou "Task") dont l'id vaut meta.toolUseId.

import fs from "node:fs";
import path from "node:path";
import type { AgentCounts, AgentNode, AgentStatus, SessionDetail, SessionSummary } from "./types.ts";

const SPAWN_TOOLS = new Set(["Agent", "Task"]);
/** Un agent sans fin explicite est considéré actif s'il a écrit récemment. */
const RUNNING_WINDOW_MS = 2 * 60 * 1000;

interface SpawnCall {
  toolUseId: string;
  description?: string;
  subagentType?: string;
  prompt?: string;
  model?: string;
  resultSeen: boolean;
  isError: boolean;
  /** agentId renvoyé dans toolUseResult (permet de relier sans meta.json) */
  agentId?: string;
  totalTokens?: number;
  durationMs?: number;
  resolvedModel?: string;
}

interface Transcript {
  file: string;
  mtimeMs: number;
  agentId?: string;
  cwd?: string;
  title?: string;
  model?: string;
  firstTs?: string;
  lastTs?: string;
  tools: Record<string, number>;
  toolCalls: number;
  messages: number;
  spawns: Map<string, SpawnCall>;
  /** Le dernier message est une réponse finale de l'agent (tour terminé) */
  ended: boolean;
  /** Dernier outil appelé */
  lastTool?: string;
  /** Tokens consommés d'après les champs usage des réponses (dédoublonnés par message) */
  tokens: number;
}

interface Meta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  model?: string;
  finished?: boolean;
}

// ---------------------------------------------------------------- cache

const cache = new Map<string, Transcript>();

function readTranscript(file: string): Transcript | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  const t = parseTranscript(file, stat.mtimeMs);
  cache.set(file, t);
  return t;
}

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const b of content) if (b?.type === "text" && typeof b.text === "string") return b.text;
  }
  return undefined;
}

export function parseTranscript(file: string, mtimeMs = 0): Transcript {
  const t: Transcript = {
    file,
    mtimeMs,
    tools: {},
    toolCalls: 0,
    messages: 0,
    spawns: new Map(),
    tokens: 0,
    ended: false,
  };
  const seenMsg = new Set<string>();
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return t;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // ligne en cours d'écriture
    }
    if (d.agentId && !t.agentId) t.agentId = d.agentId;
    if (d.cwd && !t.cwd) t.cwd = d.cwd;
    if (d.type === "summary" && d.summary && !t.title) t.title = d.summary;
    if (d.timestamp) {
      if (!t.firstTs) t.firstTs = d.timestamp;
      t.lastTs = d.timestamp;
    }
    const msg = d.message;
    if (!msg || (d.type !== "user" && d.type !== "assistant")) continue;
    t.messages++;
    t.ended = d.type === "assistant" && ["end_turn", "stop_sequence", "max_tokens", "refusal"].includes(msg.stop_reason);

    if (d.type === "assistant") {
      if (msg.model && msg.model !== "<synthetic>") t.model = msg.model;
      const u = msg.usage;
      if (u && !(msg.id && seenMsg.has(msg.id))) {
        if (msg.id) seenMsg.add(msg.id);
        t.tokens +=
          (u.input_tokens ?? 0) +
          (u.output_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0);
      }
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b?.type !== "tool_use") continue;
          t.toolCalls++;
          t.tools[b.name] = (t.tools[b.name] ?? 0) + 1;
          t.lastTool = b.name;
          if (SPAWN_TOOLS.has(b.name)) {
            const inp = b.input ?? {};
            t.spawns.set(b.id, {
              toolUseId: b.id,
              description: inp.description,
              subagentType: inp.subagent_type,
              prompt: inp.prompt,
              model: inp.model,
              resultSeen: false,
              isError: false,
            });
          }
        }
      }
    } else {
      // user : premier vrai message = titre, et résultats d'outils
      if (!t.title && !d.isMeta && !d.isSidechain) {
        const txt = textOf(msg.content);
        if (txt && !txt.startsWith("<") && !txt.startsWith("[Request")) t.title = txt.slice(0, 120);
      }
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b?.type !== "tool_result") continue;
          const sp = t.spawns.get(b.tool_use_id);
          if (!sp) continue;
          sp.resultSeen = true;
          sp.isError = !!b.is_error;
          const r = d.toolUseResult;
          if (r && typeof r === "object") {
            if (r.agentId) sp.agentId = r.agentId;
            if (typeof r.totalTokens === "number") sp.totalTokens = r.totalTokens;
            if (typeof r.totalDurationMs === "number") sp.durationMs = r.totalDurationMs;
            if (r.resolvedModel) sp.resolvedModel = r.resolvedModel;
            if (r.status === "error" || r.status === "failed") sp.isError = true;
          }
        }
      }
    }
  }
  return t;
}

// ---------------------------------------------------------------- arbre

function isRecent(ts?: string, now = Date.now()) {
  return !!ts && now - Date.parse(ts) < RUNNING_WINDOW_MS;
}

function baseNode(t: Transcript, id: string, depth: number): AgentNode {
  const start = t.firstTs ? Date.parse(t.firstTs) : undefined;
  const end = t.lastTs ? Date.parse(t.lastTs) : undefined;
  return {
    id,
    label: id,
    agentType: "main",
    model: t.model,
    status: "done",
    depth,
    startedAt: t.firstTs,
    lastActivityAt: t.lastTs,
    durationMs: start && end ? end - start : undefined,
    totalTokens: t.tokens || undefined,
    lastTool: t.lastTool,
    tools: t.tools,
    toolCalls: t.toolCalls,
    messages: t.messages,
    children: [],
  };
}

function readMeta(file: string): Meta {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function buildSession(projectDir: string, sessionId: string): SessionDetail | null {
  const mainFile = path.join(projectDir, `${sessionId}.jsonl`);
  const main = readTranscript(mainFile);
  if (!main) return null;
  const now = Date.now();

  const root = baseNode(main, "main", 0);
  root.label = "Agent principal";
  root.status = isRecent(main.lastTs, now) && !main.ended ? "running" : "done";

  // Tous les transcripts de la session, indexés par id d'agent
  const transcripts = new Map<string, { t: Transcript; node: AgentNode }>();
  transcripts.set("main", { t: main, node: root });

  const subDir = path.join(projectDir, sessionId, "subagents");
  const metas = new Map<string, Meta>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(subDir);
  } catch {
    /* pas de sous-agents */
  }
  for (const f of files) {
    const m = /^agent-(.+)\.jsonl$/.exec(f);
    if (!m) continue;
    const id = m[1];
    const t = readTranscript(path.join(subDir, f));
    if (!t) continue;
    const meta = readMeta(path.join(subDir, `agent-${id}.meta.json`));
    metas.set(id, meta);
    transcripts.set(id, { t, node: baseNode(t, id, 1) });
  }

  // toolUseId -> (transcript parent, appel)
  const spawnIndex = new Map<string, { parentId: string; call: SpawnCall }>();
  for (const [pid, { t }] of transcripts) {
    for (const call of t.spawns.values()) spawnIndex.set(call.toolUseId, { parentId: pid, call });
  }

  const linkedCalls = new Set<string>();
  for (const [id, { node, t }] of transcripts) {
    if (id === "main") continue;
    const meta = metas.get(id) ?? {};
    let toolUseId = meta.toolUseId;
    if (!toolUseId) {
      for (const [tuid, s] of spawnIndex) if (s.call.agentId === id) toolUseId = tuid;
    }
    const spawn = toolUseId ? spawnIndex.get(toolUseId) : undefined;
    if (toolUseId) linkedCalls.add(toolUseId);
    const call = spawn?.call;

    node.label = meta.description ?? call?.description ?? `Sous-agent ${id.slice(0, 7)}`;
    node.agentType = meta.agentType ?? call?.subagentType ?? "general-purpose";
    node.model = call?.resolvedModel ?? t.model ?? meta.model;
    node.prompt = call?.prompt;
    node.totalTokens = call?.totalTokens ?? node.totalTokens;
    if (call?.durationMs) node.durationMs = call.durationMs;
    node.status = subStatus(meta, call, t, now);

    const parent = transcripts.get(spawn?.parentId ?? "main")!.node;
    parent.children.push(node);
  }

  // Appels Agent/Task sans transcript dédié (anciennes versions de Claude Code)
  for (const [tuid, { parentId, call }] of spawnIndex) {
    if (linkedCalls.has(tuid)) continue;
    if (call.agentId && transcripts.has(call.agentId)) continue;
    const parent = transcripts.get(parentId)!.node;
    parent.children.push({
      id: call.agentId ?? tuid,
      label: call.description ?? "Sous-agent",
      agentType: call.subagentType ?? "general-purpose",
      model: call.resolvedModel ?? call.model,
      status: call.resultSeen ? (call.isError ? "error" : "done") : isRecent(main.lastTs, now) ? "running" : "interrupted",
      depth: 0,
      prompt: call.prompt,
      totalTokens: call.totalTokens,
      durationMs: call.durationMs,
      tools: {},
      toolCalls: 0,
      messages: 0,
      children: [],
    });
  }

  fixDepth(root, 0);
  sortTree(root);
  propagateRunning(root);

  const project = main.cwd ?? decodeProjectDir(path.basename(projectDir));
  return {
    id: sessionId,
    project,
    projectDir: path.basename(projectDir),
    cwd: main.cwd,
    title: main.title,
    startedAt: main.firstTs,
    lastActivityAt: latest(root),
    counts: countTree(root),
    root,
  };
}

function subStatus(meta: Meta, call: SpawnCall | undefined, t: Transcript, now: number): AgentStatus {
  if (call?.isError) return "error";
  if (meta.finished === true || t.ended) return "done";
  if (meta.finished === false) return isRecent(t.lastTs, now) ? "running" : "interrupted";
  if (call?.resultSeen) return "done";
  return isRecent(t.lastTs, now) ? "running" : "interrupted";
}

/** Un agent qui attend un sous-agent encore actif est lui aussi actif. */
function propagateRunning(n: AgentNode): boolean {
  let childRunning = false;
  for (const c of n.children) if (propagateRunning(c)) childRunning = true;
  if (childRunning && n.status !== "error") n.status = "running";
  return n.status === "running";
}

function fixDepth(n: AgentNode, d: number) {
  n.depth = d;
  for (const c of n.children) fixDepth(c, d + 1);
}

function sortTree(n: AgentNode) {
  n.children.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  n.children.forEach(sortTree);
}

function latest(n: AgentNode): string | undefined {
  let best = n.lastActivityAt;
  for (const c of n.children) {
    const l = latest(c);
    if (l && (!best || l > best)) best = l;
  }
  return best;
}

export function countTree(root: AgentNode): AgentCounts {
  const c: AgentCounts = {
    total: 0,
    subagents: 0,
    running: 0,
    done: 0,
    error: 0,
    interrupted: 0,
    maxDepth: 0,
    toolCalls: 0,
    byType: {},
  };
  const walk = (n: AgentNode) => {
    c.total++;
    if (n.depth > 0) {
      c.subagents++;
      c.byType[n.agentType] = (c.byType[n.agentType] ?? 0) + 1;
    }
    c[n.status]++;
    c.maxDepth = Math.max(c.maxDepth, n.depth);
    c.toolCalls += n.toolCalls;
    n.children.forEach(walk);
  };
  walk(root);
  return c;
}

function decodeProjectDir(name: string) {
  return name.replace(/-/g, "/");
}

// ---------------------------------------------------------------- liste

export function projectsRoot(claudeDir: string) {
  return path.join(claudeDir, "projects");
}

export function listSessions(claudeDir: string, limit = 100): SessionSummary[] {
  const root = projectsRoot(claudeDir);
  const found: { dir: string; id: string; mtime: number }[] = [];
  let projects: string[] = [];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return [];
  }
  for (const p of projects) {
    const dir = path.join(root, p);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const id = e.slice(0, -6);
      let mtime = 0;
      try {
        mtime = fs.statSync(path.join(dir, e)).mtimeMs;
        // l'activité d'un sous-agent compte aussi
        const sub = path.join(dir, id, "subagents");
        if (fs.existsSync(sub)) mtime = Math.max(mtime, fs.statSync(sub).mtimeMs);
      } catch {
        continue;
      }
      found.push({ dir, id, mtime });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  const out: SessionSummary[] = [];
  for (const f of found.slice(0, limit)) {
    const s = buildSession(f.dir, f.id);
    if (!s) continue;
    const { root: _root, ...summary } = s;
    out.push(summary);
  }
  out.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  return out;
}

export function findSessionDir(claudeDir: string, sessionId: string): string | null {
  const root = projectsRoot(claudeDir);
  try {
    for (const p of fs.readdirSync(root)) {
      if (fs.existsSync(path.join(root, p, `${sessionId}.jsonl`))) return path.join(root, p);
    }
  } catch {
    /* ignore */
  }
  return null;
}
