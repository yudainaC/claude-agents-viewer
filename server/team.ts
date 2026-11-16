// Équipe de sous-agents : définitions (.claude/agents/*.md), installation,
// statistiques d'usage tirées des transcripts, et conseils d'optimisation.

import fs from "node:fs";
import path from "node:path";
import { buildSession, listSessions } from "./parser.ts";
import type {
  AgentDefinition,
  AgentNode,
  AgentUsage,
  DefinitionScope,
  InstallResult,
  MainUsage,
  TeamReport,
  Tip,
} from "./types.ts";

const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "LS", "NotebookRead"]);
const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);
/** Types intégrés à Claude Code qui ne lisent que du code. */
const BUILTIN_READ_ONLY = new Set(["Explore", "Plan"]);

// ------------------------------------------------------------ définitions

/** Lit un fichier d'agent Claude Code : frontmatter YAML simple + consigne. */
export function parseAgentFile(raw: string): Omit<AgentDefinition, "scope" | "file"> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!fm.name) return null;
  return {
    name: fm.name,
    description: fm.description ?? "",
    model: fm.model || "inherit",
    tools: fm.tools ? fm.tools.split(",").map((t) => t.trim()).filter(Boolean) : [],
    color: fm.color,
    prompt: m[2].trim(),
  };
}

function readDefs(dir: string, scope: DefinitionScope): AgentDefinition[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out: AgentDefinition[] = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const d = parseAgentFile(fs.readFileSync(file, "utf8"));
      if (d) out.push({ ...d, scope, file });
    } catch {
      /* fichier illisible */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function teamDir(appRoot: string) {
  return path.join(appRoot, ".claude", "agents");
}

// ------------------------------------------------------------ installation

export function installTeam(appRoot: string, claudeDir: string, overwrite: boolean): InstallResult {
  const src = teamDir(appRoot);
  const dest = path.join(claudeDir, "agents");
  fs.mkdirSync(dest, { recursive: true });
  const res: InstallResult = { dir: dest, installed: [], updated: [], skipped: [] };
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".md"))) {
    const name = f.slice(0, -3);
    const target = path.join(dest, f);
    const content = fs.readFileSync(path.join(src, f), "utf8");
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, "utf8") === content) {
        res.skipped.push(name);
        continue;
      }
      if (!overwrite) {
        res.skipped.push(name);
        continue;
      }
      fs.writeFileSync(target, content);
      res.updated.push(name);
    } else {
      fs.writeFileSync(target, content);
      res.installed.push(name);
    }
  }
  return res;
}

// ------------------------------------------------------------ usage

function modelFamily(m?: string): string {
  if (!m) return "inconnu";
  const f = /(haiku|sonnet|opus|fable)/i.exec(m);
  return f ? f[1].toLowerCase() : m;
}

function emptyUsage(type: string): AgentUsage {
  return { type, runs: 0, running: 0, errors: 0, tokens: 0, toolCalls: 0, durationMs: 0, models: {}, sessions: 0 };
}

function collect(claudeDir: string, limit: number) {
  const byType = new Map<string, AgentUsage>();
  const main: MainUsage = { sessions: 0, sessionsWithSubagents: 0, heavyReaderSessions: 0, readCalls: 0, subagentLaunches: 0 };
  const cwds = new Set<string>();

  for (const s of listSessions(claudeDir, limit)) {
    if (s.cwd) cwds.add(s.cwd);
    const dir = path.join(claudeDir, "projects", s.projectDir);
    const detail = buildSession(dir, s.id);
    if (!detail) continue;
    main.sessions++;
    if (detail.counts.subagents > 0) main.sessionsWithSubagents++;
    main.subagentLaunches += detail.counts.subagents;

    const reads = Object.entries(detail.root.tools)
      .filter(([t]) => EXPLORE_TOOLS.has(t))
      .reduce((a, [, n]) => a + n, 0);
    main.readCalls += reads;
    const delegatedExplore = detail.root.children.some((c) => c.agentType === "Explore" || c.agentType === "eclaireur");
    if (reads >= 25 && !delegatedExplore) main.heavyReaderSessions++;

    const seen = new Set<string>();
    const walk = (n: AgentNode) => {
      if (n.depth > 0) {
        const u = byType.get(n.agentType) ?? emptyUsage(n.agentType);
        u.runs++;
        if (n.status === "running") u.running++;
        if (n.status === "error") u.errors++;
        u.tokens += n.totalTokens ?? 0;
        u.toolCalls += n.toolCalls;
        u.durationMs += n.durationMs ?? 0;
        const fam = modelFamily(n.model);
        u.models[fam] = (u.models[fam] ?? 0) + 1;
        if (!seen.has(n.agentType)) {
          seen.add(n.agentType);
          u.sessions++;
        }
        u.lastUsedAt = !u.lastUsedAt || (n.lastActivityAt ?? "") > u.lastUsedAt ? n.lastActivityAt : u.lastUsedAt;
        byType.set(n.agentType, u);
      }
      n.children.forEach(walk);
    };
    walk(detail.root);
  }
  return { usage: [...byType.values()].sort((a, b) => b.runs - a.runs), main, cwds };
}

// ------------------------------------------------------------ conseils

function computeTips(report: Omit<TeamReport, "tips" | "snippet">): Tip[] {
  const tips: Tip[] = [];
  const defsByName = new Map(report.definitions.map((d) => [d.name, d]));
  const teamNames = report.team.map((t) => t.name);
  const installedCount = report.team.filter((t) => t.installed !== "non").length;

  if (installedCount === 0) {
    tips.push({
      id: "install",
      level: "action",
      title: "Installe l'équipe de sous-agents",
      text: "Six sous-agents spécialisés, chacun sur le modèle le moins cher qui suffit à sa tâche. Une fois installés, Claude Code peut les utiliser dans tous tes projets.",
    });
  } else if (installedCount < teamNames.length) {
    tips.push({
      id: "install-partial",
      level: "info",
      title: "L'équipe n'est installée qu'en partie",
      text: `${installedCount} sous-agents sur ${teamNames.length} sont installés. Installe les autres pour que l'enchaînement complet fonctionne.`,
    });
  }

  if (report.team.some((t) => t.installed === "modifié")) {
    tips.push({
      id: "outdated",
      level: "info",
      title: "Certains sous-agents diffèrent de la version de l'équipe",
      text: "Tu les as peut-être personnalisés. Sinon, réinstalle en écrasant pour récupérer la dernière version.",
    });
  }

  const totalRuns = report.usage.reduce((a, u) => a + u.runs, 0);

  // Agents de lecture qui tournent sur un gros modèle
  for (const u of report.usage) {
    const def = defsByName.get(u.type);
    const readOnly = BUILTIN_READ_ONLY.has(u.type) || (def && def.tools.length > 0 && def.tools.every((t) => READ_ONLY_TOOLS.has(t)));
    if (!readOnly || u.type === "architecte" || u.type === "Plan") continue;
    const heavy = (u.models.opus ?? 0) + (u.models.sonnet ?? 0) + (u.models.fable ?? 0);
    if (heavy >= 3 && heavy / u.runs >= 0.5) {
      tips.push({
        id: `model-${u.type}`,
        level: "economie",
        title: `« ${u.type} » ne fait que lire, mais tourne sur un gros modèle`,
        text: BUILTIN_READ_ONLY.has(u.type)
          ? `${heavy} lancements sur ${u.runs} ont utilisé Sonnet ou Opus. Pour de la recherche, Haiku suffit et coûte bien moins cher : l'éclaireur de l'équipe fait le même travail sur Haiku.`
          : `${heavy} lancements sur ${u.runs} ont utilisé Sonnet ou Opus. Mets « model: haiku » dans sa définition : pour de la recherche, Haiku suffit et coûte bien moins cher.`,
      });
    }
  }

  // Trop de general-purpose
  const gp = report.usage.find((u) => u.type === "general-purpose");
  if (gp && gp.runs >= 5 && gp.runs / totalRuns >= 0.5) {
    tips.push({
      id: "general-purpose",
      level: "economie",
      title: "La plupart des sous-agents sont « general-purpose »",
      text: `${gp.runs} lancements sur ${totalRuns}. Ce type hérite du modèle principal et de tous les outils. Des agents spécialisés (eclaireur, testeur, developpeur) coûtent moins cher et se trompent moins.`,
    });
  }

  // L'agent principal lit tout lui-même
  if (report.main.heavyReaderSessions > 0) {
    tips.push({
      id: "heavy-reader",
      level: "economie",
      title: "L'agent principal explore le code lui-même",
      text: `Dans ${report.main.heavyReaderSessions} session${report.main.heavyReaderSessions > 1 ? "s" : ""}, l'agent principal a fait 25 lectures ou recherches ou plus sans déléguer. Chaque fichier lu reste dans son contexte, et c'est le modèle le plus cher. Demande-lui de passer par l'éclaireur, ou colle le guide d'orchestration dans ton CLAUDE.md.`,
    });
  }

  // Taux d'erreur élevé
  for (const u of report.usage) {
    if (u.runs >= 3 && u.errors / u.runs >= 0.3) {
      tips.push({
        id: `errors-${u.type}`,
        level: "alerte",
        title: `« ${u.type} » échoue souvent`,
        text: `${u.errors} échecs sur ${u.runs} lancements. Vérifie que sa description dit clairement quand l'utiliser, et que ses outils lui suffisent.`,
      });
    }
  }

  // Agents définis mais jamais utilisés
  const used = new Set(report.usage.map((u) => u.type));
  const WEEK = 7 * 24 * 3600 * 1000;
  const installedLongAgo = (file: string) => {
    try {
      return Date.now() - fs.statSync(file).mtimeMs > WEEK;
    } catch {
      return false;
    }
  };
  // seulement les agents installés depuis plus d'une semaine, pour leur laisser le temps de servir
  const unused = report.definitions
    .filter((d) => d.scope !== "equipe" && !used.has(d.name) && installedLongAgo(d.file))
    .map((d) => d.name);
  const uniqUnused = [...new Set(unused)];
  if (report.main.sessions >= 5 && uniqUnused.length > 0) {
    tips.push({
      id: "unused",
      level: "info",
      title: "Des sous-agents installés depuis plus d'une semaine n'ont jamais servi",
      text: `${uniqUnused.join(", ")}. Claude choisit un sous-agent d'après sa description : rends-la plus précise (« À utiliser de manière proactive quand… ») ou demande-le explicitement.`,
    });
  }

  if (tips.length === 0) {
    tips.push({ id: "ok", level: "info", title: "Rien à signaler", text: "Ton usage des sous-agents a l'air sain." });
  }
  return tips;
}

// ------------------------------------------------------------ rapport

export function teamReport(appRoot: string, claudeDir: string, limit = 200): TeamReport {
  const { usage, main, cwds } = collect(claudeDir, limit);

  const userDefs = readDefs(path.join(claudeDir, "agents"), "utilisateur");
  const projectDefs: AgentDefinition[] = [];
  for (const cwd of cwds) {
    if (path.resolve(cwd) === path.resolve(appRoot)) continue;
    for (const d of readDefs(path.join(cwd, ".claude", "agents"), "projet")) projectDefs.push({ ...d, project: cwd });
  }
  const bundled = readDefs(teamDir(appRoot), "equipe");

  const team = bundled.map((d) => {
    const raw = fs.readFileSync(d.file, "utf8");
    const target = path.join(claudeDir, "agents", path.basename(d.file));
    let installed: "oui" | "modifié" | "non" = "non";
    if (fs.existsSync(target)) installed = fs.readFileSync(target, "utf8") === raw ? "oui" : "modifié";
    else if (projectDefs.some((p) => p.name === d.name)) installed = "oui";
    return { ...d, installed };
  });

  const base = { definitions: [...userDefs, ...projectDefs], team, usage, main, claudeAgentsDir: path.join(claudeDir, "agents") };
  let snippet = "";
  try {
    snippet = fs.readFileSync(path.join(appRoot, "team", "orchestration.md"), "utf8");
  } catch {
    /* pas de guide */
  }
  return { ...base, tips: computeTips(base), snippet };
}
