// Discuter avec Claude Code depuis l'interface, grâce au Claude Agent SDK.
// Chaque message lance une requête `query()` dans le dossier du projet ; les
// suivants reprennent la même session (`resume`). Les événements sont
// simplifiés pour l'interface et diffusés en direct (SSE).
//
// Claude Code utilise ta connexion habituelle (claude.ai ou clé API) : rien à
// configurer de plus si la commande `claude` marche déjà dans ton terminal.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { getSessionMessages, listSessions as sdkListSessions, query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode, PermissionResult, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition as SdkAgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { parseAgentFile, teamDir } from "./team.ts";
import type { ChatEvent, ConversationInfo } from "./types.ts";
import { noteRateLimit } from "./usage.ts";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Outils interdits à l'agent principal en mode équipe : il dirige, il ne code pas.
 * (Pas via `disallowedTools`, qui s'appliquerait aussi aux sous-agents : on bloque
 * avec un hook PreToolUse seulement quand l'appel vient du fil principal.)
 */
export const CHEF_DISALLOWED = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"];

/** Définitions de l'équipe, lues dans .claude/agents de l'appli (pas besoin de les installer). */
export function teamAgents(appRoot = APP_ROOT): Record<string, SdkAgentDefinition> {
  const out: Record<string, SdkAgentDefinition> = {};
  let files: string[] = [];
  try {
    files = fs.readdirSync(teamDir(appRoot)).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const d = parseAgentFile(fs.readFileSync(path.join(teamDir(appRoot), f), "utf8"));
    if (!d) continue;
    out[d.name] = {
      description: d.description,
      prompt: d.prompt,
      tools: d.tools.length ? d.tools : undefined,
      model: d.model === "inherit" ? undefined : (d.model as any),
    };
  }
  return out;
}

export function chefGuard(input: { tool_name?: string; agent_id?: string }) {
  if (input.agent_id || !input.tool_name || !CHEF_DISALLOWED.includes(input.tool_name)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: `Mode équipe : tu es le chef de projet, tu n'utilises pas ${input.tool_name}. Confie ce travail au sous-agent spécialisé (developpeur pour modifier, testeur pour lancer des commandes).`,
    },
  };
}

export function teamRules(appRoot = APP_ROOT): string {
  try {
    return fs.readFileSync(path.join(appRoot, "team", "orchestration.md"), "utf8");
  } catch {
    return "";
  }
}

export type ChatMode = "default" | "acceptEdits" | "plan";

interface PendingPermission {
  resolve: (r: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: unknown[];
}

interface Run {
  id: string;
  cwd: string;
  prompt: string;
  sessionId?: string;
  events: ChatEvent[];
  listeners: Set<http.ServerResponse>;
  q?: Query;
  done: boolean;
  permissions: Map<string, PendingPermission>;
  createdAt: number;
}

const runs = new Map<string, Run>();

function emit(run: Run, ev: ChatEvent) {
  run.events.push(ev);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const l of run.listeners) l.write(line);
}

// --------------------------------------------------------------- résumés lisibles

function short(s: unknown, n = 140): string {
  const t = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function rel(cwd: string, p: unknown): string {
  if (typeof p !== "string") return "";
  return p.startsWith(cwd + path.sep) ? p.slice(cwd.length + 1) : p;
}

/** Résume un appel d'outil en une phrase compréhensible. */
export function describeTool(name: string, input: Record<string, any>, cwd: string): string {
  switch (name) {
    case "Read":
      return `Lit ${rel(cwd, input.file_path)}`;
    case "Write":
      return `Écrit ${rel(cwd, input.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Modifie ${rel(cwd, input.file_path)}`;
    case "Bash":
      return input.description ? short(input.description, 120) : `Lance ${short(input.command, 100)}`;
    case "Grep":
      return `Cherche « ${short(input.pattern, 60)} »${input.path ? ` dans ${rel(cwd, input.path)}` : ""}`;
    case "Glob":
      return `Liste les fichiers ${short(input.pattern, 60)}`;
    case "WebSearch":
      return `Cherche sur le web : ${short(input.query, 80)}`;
    case "WebFetch":
      return `Lit la page ${short(input.url, 80)}`;
    case "Agent":
    case "Task":
      return `Confie à ${input.subagent_type ?? "un sous-agent"} : ${short(input.description, 80)}`;
    case "TodoWrite":
      return "Met à jour sa liste de tâches";
    default:
      return name;
  }
}

function resultPreview(content: unknown): string {
  if (typeof content === "string") return short(content, 400);
  if (Array.isArray(content)) {
    const t = content.map((b: any) => (b?.type === "text" ? b.text : "")).join("\n");
    return short(t, 400);
  }
  return "";
}

// --------------------------------------------------------------- traduction des messages

function translate(run: Run, m: SDKMessage) {
  const cwd = run.cwd;
  switch (m.type) {
    case "system":
      if (m.subtype === "init") {
        run.sessionId = m.session_id;
        emit(run, { kind: "session", sessionId: m.session_id, model: m.model, cwd: m.cwd });
      }
      return;
    case "stream_event": {
      if (m.parent_tool_use_id) return;
      const e: any = m.event;
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") emit(run, { kind: "text-delta", text: e.delta.text });
      return;
    }
    case "assistant": {
      const sub = m.parent_tool_use_id;
      for (const b of m.message.content as any[]) {
        if (b.type === "text" && !sub && b.text?.trim()) emit(run, { kind: "text", text: b.text });
        if (b.type === "tool_use") {
          if (sub) {
            emit(run, { kind: "subagent-step", parentToolUseId: sub, summary: describeTool(b.name, b.input ?? {}, cwd), tool: b.name });
          } else {
            emit(run, {
              kind: "tool",
              id: b.id,
              name: b.name,
              summary: describeTool(b.name, b.input ?? {}, cwd),
              detail: b.name === "Bash" ? String(b.input?.command ?? "") : b.name === "Agent" || b.name === "Task" ? String(b.input?.prompt ?? "") : undefined,
            });
          }
        }
      }
      return;
    }
    case "user": {
      if (m.parent_tool_use_id) return;
      const content = (m.message as any).content;
      if (!Array.isArray(content)) return;
      for (const b of content) {
        if (b?.type === "tool_result") {
          emit(run, { kind: "tool-result", id: b.tool_use_id, isError: !!b.is_error, preview: resultPreview(b.content) });
        }
      }
      return;
    }
    case "rate_limit_event":
      noteRateLimit(m.rate_limit_info);
      return;
    case "result":
      emit(run, {
        kind: "result",
        ok: m.subtype === "success" && !m.is_error,
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
        message: m.subtype === "success" ? undefined : "Claude s'est arrêté avant la fin.",
      });
      return;
    default:
      return;
  }
}

// --------------------------------------------------------------- API

export function startRun(opts: { cwd: string; prompt: string; sessionId?: string; mode: ChatMode; model?: string; team?: boolean }): Run {
  if (!fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) throw new Error("Dossier introuvable");
  const run: Run = {
    id: randomUUID(),
    cwd: opts.cwd,
    prompt: opts.prompt,
    sessionId: opts.sessionId,
    events: [],
    listeners: new Set(),
    done: false,
    permissions: new Map(),
    createdAt: Date.now(),
  };
  runs.set(run.id, run);
  emit(run, { kind: "user", text: opts.prompt });

  const mode: PermissionMode = opts.mode;
  const team = opts.team
    ? {
        agents: teamAgents(),
        hooks: { PreToolUse: [{ hooks: [async (input: any) => chefGuard(input)] }] },
        systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: teamRules() },
      }
    : {};
  const q = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      resume: opts.sessionId,
      permissionMode: mode,
      model: opts.model || undefined,
      includePartialMessages: true,
      // mêmes réglages que dans le terminal : CLAUDE.md, agents, permissions…
      settingSources: ["user", "project", "local"],
      ...team,
      canUseTool: async (toolName, input, { signal, suggestions }) => {
        const id = randomUUID();
        emit(run, {
          kind: "permission",
          id,
          tool: toolName,
          summary: describeTool(toolName, input as any, run.cwd),
          detail: toolName === "Bash" ? String((input as any).command ?? "") : undefined,
        });
        return new Promise<PermissionResult>((resolve) => {
          run.permissions.set(id, { resolve, input, suggestions });
          signal.addEventListener("abort", () => {
            run.permissions.delete(id);
            resolve({ behavior: "deny", message: "Annulé" });
          });
        });
      },
    },
  });
  run.q = q;

  (async () => {
    try {
      for await (const m of q) translate(run, m);
    } catch (e: any) {
      emit(run, { kind: "error", message: e?.message ?? String(e) });
    } finally {
      run.done = true;
      emit(run, { kind: "end", sessionId: run.sessionId });
      for (const l of run.listeners) l.end();
      run.listeners.clear();
      // on garde l'historique de la requête quelques minutes pour les reconnexions
      setTimeout(() => runs.delete(run.id), 10 * 60 * 1000);
    }
  })();

  return run;
}

export function streamRun(runId: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const run = runs.get(runId);
  if (!run) return false;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (run.done) {
    res.end();
    return true;
  }
  run.listeners.add(res);
  req.on("close", () => run.listeners.delete(res));
  return true;
}

export function answerPermission(runId: string, id: string, allow: boolean, always: boolean): boolean {
  const run = runs.get(runId);
  const p = run?.permissions.get(id);
  if (!run || !p) return false;
  run.permissions.delete(id);
  emit(run, { kind: "permission-answer", id, allow });
  p.resolve(
    allow
      ? { behavior: "allow", updatedInput: p.input, ...(always && p.suggestions ? { updatedPermissions: p.suggestions as any } : {}) }
      : { behavior: "deny", message: "L'utilisateur a refusé." },
  );
  return true;
}

export async function stopRun(runId: string): Promise<boolean> {
  const run = runs.get(runId);
  if (!run?.q || run.done) return false;
  for (const p of run.permissions.values()) p.resolve({ behavior: "deny", message: "Arrêté", interrupt: true });
  run.permissions.clear();
  try {
    await run.q.interrupt();
  } catch {
    run.q.close();
  }
  return true;
}

/** Requête en cours pour un dossier (pour la retrouver après un rechargement de page). */
export function activeRuns() {
  return [...runs.values()].filter((r) => !r.done).map((r) => ({ runId: r.id, cwd: r.cwd, sessionId: r.sessionId, prompt: r.prompt }));
}

// --------------------------------------------------------------- historique

export async function conversations(cwd: string): Promise<ConversationInfo[]> {
  try {
    const list = await sdkListSessions({ dir: cwd, limit: 50 });
    return list.map((s) => ({ sessionId: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || "Conversation", lastModified: s.lastModified }));
  } catch {
    return [];
  }
}

/** Relit une conversation passée et la convertit en événements pour l'interface. */
export async function history(sessionId: string, cwd: string): Promise<ChatEvent[]> {
  const msgs = await getSessionMessages(sessionId, { dir: cwd });
  const fake: Run = { id: "h", cwd, prompt: "", events: [], listeners: new Set(), done: true, permissions: new Map(), createdAt: 0 };
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const msg: any = m.message;
    if (m.type === "user") {
      if (typeof msg?.content === "string") {
        if (!msg.content.startsWith("<")) emit(fake, { kind: "user", text: msg.content });
        continue;
      }
      const texts = (msg?.content ?? []).filter((b: any) => b.type === "text" && !String(b.text).startsWith("<"));
      if (texts.length) emit(fake, { kind: "user", text: texts.map((b: any) => b.text).join("\n") });
      translate(fake, { type: "user", message: msg, parent_tool_use_id: null } as any);
    } else if (m.type === "assistant") {
      translate(fake, { type: "assistant", message: msg, parent_tool_use_id: null } as any);
    }
  }
  return fake.events;
}
