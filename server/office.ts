// Le « bureau » : qui travaille en ce moment, qui dort.
// Chaque membre de l'équipe a sa chambre ; les autres types de sous-agents
// (Explore, general-purpose, agents perso) apparaissent comme visiteurs
// pendant qu'ils travaillent.

import fs from "node:fs";
import path from "node:path";
import { buildSession, listSessions } from "./parser.ts";
import { parseAgentFile, teamDir } from "./team.ts";
import type { AgentNode, OfficeReport, OfficeResident, OfficeTask } from "./types.ts";

function firstSentence(t: string) {
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t;
}

function readTeam(appRoot: string, claudeDir: string) {
  const dirs = [teamDir(appRoot), path.join(claudeDir, "agents")];
  const out = new Map<string, { model: string; color?: string; role: string; team: boolean }>();
  dirs.forEach((dir, i) => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const d = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"));
        if (!d) continue;
        const prev = out.get(d.name);
        // la version installée (personnalisée) l'emporte, mais reste « équipe » si elle en vient
        out.set(d.name, { model: d.model, color: d.color, role: firstSentence(d.description), team: prev?.team ?? i === 0 });
      } catch {
        /* ignore */
      }
    }
  });
  return out;
}

const BUILTIN_ROLES: Record<string, string> = {
  Explore: "Agent intégré de Claude Code pour explorer le code.",
  Plan: "Agent intégré de Claude Code pour préparer un plan.",
  "general-purpose": "Agent à tout faire, avec tous les outils.",
};

export function officeReport(appRoot: string, claudeDir: string, limit = 40): OfficeReport {
  const defs = readTeam(appRoot, claudeDir);
  const residents = new Map<string, OfficeResident>();

  residents.set("principal", {
    name: "principal",
    model: "inherit",
    role: "L'agent principal, celui à qui tu parles.",
    kind: "principal",
    working: false,
    tasks: [],
  });
  for (const [name, d] of defs) {
    if (!d.team) continue;
    residents.set(name, { name, model: d.model, color: d.color, role: d.role, kind: "equipe", working: false, tasks: [] });
  }

  const touch = (r: OfficeResident, ts?: string) => {
    if (ts && (!r.lastSeenAt || ts > r.lastSeenAt)) r.lastSeenAt = ts;
  };

  for (const s of listSessions(claudeDir, limit)) {
    const detail = buildSession(path.join(claudeDir, "projects", s.projectDir), s.id);
    if (!detail) continue;
    const walk = (n: AgentNode) => {
      const key = n.depth === 0 ? "principal" : n.agentType;
      let r = residents.get(key);
      if (!r && n.status === "running") {
        const d = defs.get(key);
        r = {
          name: key,
          model: d?.model ?? "inherit",
          color: d?.color,
          role: d?.role ?? BUILTIN_ROLES[key] ?? "Sous-agent personnalisé.",
          kind: "visiteur",
          working: false,
          tasks: [],
        };
        residents.set(key, r);
      }
      if (r) {
        touch(r, n.lastActivityAt);
        // l'agent principal qui attend ses sous-agents ne travaille pas lui-même
        const waiting = n.children.some((c) => c.status === "running");
        const selfActive = n.status === "running" && (!waiting || recent(n.lastActivityAt, 20_000));
        if (selfActive) {
          r.working = true;
          const task: OfficeTask = {
            label: n.depth === 0 ? (detail.title ?? "Session sans titre") : n.label,
            sessionId: detail.id,
            sessionTitle: detail.title,
            project: detail.project,
            tool: n.lastTool,
            lastActivityAt: n.lastActivityAt,
          };
          r.tasks.push(task);
        }
      }
      n.children.forEach(walk);
    };
    walk(detail.root);
  }

  const order = { principal: 0, equipe: 1, visiteur: 2 } as const;
  const list = [...residents.values()].sort((a, b) => order[a.kind] - order[b.kind]);
  for (const r of list) r.tasks.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  const working = list.filter((r) => r.working).length;
  return { residents: list, working, sleeping: list.length - working };
}

function recent(ts: string | undefined, ms: number) {
  return !!ts && Date.now() - Date.parse(ts) < ms;
}
