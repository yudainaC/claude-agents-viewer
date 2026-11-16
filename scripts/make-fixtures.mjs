// Génère des transcripts factices dans ./fixtures pour essayer l'interface
// sans avoir de vraies sessions Claude Code (npm run demo).
// Le format reproduit celui de Claude Code : <session>.jsonl + <session>/subagents/agent-<id>.{jsonl,meta.json}

import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("fixtures/projects/-home-demo-mon-app");
fs.rmSync(path.resolve("fixtures"), { recursive: true, force: true });

let n = 0;
const uid = () => `u-${++n}`;
const now = Date.now();
const ts = (secAgo) => new Date(now - secAgo * 1000).toISOString();

function transcript({ session, agentId, cwd, prompt, steps, startAgo, model = "claude-opus-5-5" }) {
  const lines = [];
  let t = startAgo;
  const base = { sessionId: session, cwd, isSidechain: !!agentId, ...(agentId ? { agentId } : {}) };
  lines.push({ ...base, type: "user", uuid: uid(), timestamp: ts(t), message: { role: "user", content: prompt } });
  for (const s of steps) {
    t -= s.dt ?? 5;
    const id = s.id ?? `toolu_${uid()}`;
    lines.push({
      ...base,
      type: "assistant",
      uuid: uid(),
      timestamp: ts(t),
      message: {
        id: `msg_${uid()}`,
        role: "assistant",
        model,
        content: [{ type: "tool_use", id, name: s.tool, input: s.input ?? {} }],
        usage: { input_tokens: 40, output_tokens: 120 + (n % 7) * 30, cache_read_input_tokens: 3000 + (n % 5) * 900, cache_creation_input_tokens: 200 },
      },
    });
    if (s.pending) continue;
    t -= 1;
    lines.push({
      ...base,
      type: "user",
      uuid: uid(),
      timestamp: ts(t),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", is_error: !!s.error }] },
      ...(s.result ? { toolUseResult: s.result } : {}),
    });
  }
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function session({ id, cwd, prompt, startAgo, mainSteps, agents }) {
  write(path.join(OUT, `${id}.jsonl`), transcript({ session: id, cwd, prompt, steps: mainSteps, startAgo }));
  for (const a of agents) {
    const dir = path.join(OUT, id, "subagents");
    write(
      path.join(dir, `agent-${a.id}.jsonl`),
      transcript({ session: id, agentId: a.id, cwd, prompt: a.prompt, steps: a.steps, startAgo: a.startAgo, model: a.model }),
    );
    write(
      path.join(dir, `agent-${a.id}.meta.json`),
      JSON.stringify({ agentType: a.type, description: a.description, toolUseId: a.toolUseId, finished: a.finished }),
    );
  }
}

const spawn = (toolUseId, description, type, opts = {}) => ({
  tool: "Agent",
  id: toolUseId,
  input: { description, subagent_type: type, prompt: `Tâche : ${description}` },
  ...opts,
});

// --- Session 1 : une session active avec un arbre sur 3 niveaux
session({
  id: "11111111-demo-4aaa-8000-000000000001",
  cwd: "/home/demo/mon-app",
  prompt: "Ajoute l'authentification OAuth et écris les tests",
  startAgo: 600,
  mainSteps: [
    { tool: "Read" }, { tool: "Grep" }, { tool: "Glob" },
    spawn("toolu_A", "Explorer le code d'authentification", "Explore", { result: { agentId: "a01", totalTokens: 41200, totalDurationMs: 48000 } }),
    spawn("toolu_B", "Explorer les routes API", "Explore", { result: { agentId: "a02", totalTokens: 22800, totalDurationMs: 31000 } }),
    spawn("toolu_C", "Implémenter OAuth", "general-purpose", { pending: true }),
  ],
  agents: [
    { id: "a01", toolUseId: "toolu_A", type: "Explore", description: "Explorer le code d'authentification", startAgo: 560, finished: true, model: "claude-haiku-5-5",
      prompt: "Trouve où l'authentification est gérée.", steps: [{ tool: "Grep" }, { tool: "Grep" }, { tool: "Read" }, { tool: "Read" }, { tool: "Read" }] },
    { id: "a02", toolUseId: "toolu_B", type: "Explore", description: "Explorer les routes API", startAgo: 555, finished: true, model: "claude-haiku-5-5",
      prompt: "Liste les routes API.", steps: [{ tool: "Glob" }, { tool: "Read" }, { tool: "Read" }] },
    { id: "a03", toolUseId: "toolu_C", type: "general-purpose", description: "Implémenter OAuth", startAgo: 300, finished: false,
      prompt: "Implémente le flux OAuth puis délègue les tests.",
      steps: [
        { tool: "Read" }, { tool: "Edit" }, { tool: "Edit" }, { tool: "Write" }, { tool: "Bash" },
        spawn("toolu_D", "Écrire les tests unitaires", "general-purpose", { pending: true, dt: 20 }),
        spawn("toolu_E", "Vérifier la sécurité", "security-reviewer", { result: { agentId: "a05", totalTokens: 18000, totalDurationMs: 40000, status: "error" }, error: true, dt: 2 }),
      ] },
    { id: "a04", toolUseId: "toolu_D", type: "general-purpose", description: "Écrire les tests unitaires", startAgo: 120, finished: false,
      prompt: "Écris les tests pour le module OAuth.", steps: [{ tool: "Read" }, { tool: "Write" }, { tool: "Bash", dt: 30 }, { tool: "Edit", dt: 40 }, { tool: "Bash", pending: true, dt: 30 }] },
    { id: "a05", toolUseId: "toolu_E", type: "security-reviewer", description: "Vérifier la sécurité", startAgo: 200, finished: true,
      prompt: "Relis le code OAuth.", steps: [{ tool: "Read" }, { tool: "Grep" }] },
  ],
});

// --- Session 2 : une ancienne session terminée
session({
  id: "22222222-demo-4bbb-8000-000000000002",
  cwd: "/home/demo/site-vitrine",
  prompt: "Corrige le bug d'affichage sur mobile",
  startAgo: 86400 * 2,
  mainSteps: [
    { tool: "Read" },
    spawn("toolu_F", "Chercher les media queries", "Explore", { result: { agentId: "b01" } }),
    { tool: "Edit" }, { tool: "Bash" },
  ],
  agents: [
    { id: "b01", toolUseId: "toolu_F", type: "Explore", description: "Chercher les media queries", startAgo: 86400 * 2 - 10, finished: true,
      prompt: "Trouve les media queries.", steps: [{ tool: "Grep" }, { tool: "Read" }] },
  ],
});

// --- Session 3 : sans sous-agent
session({
  id: "33333333-demo-4ccc-8000-000000000003",
  cwd: "/home/demo/scripts",
  prompt: "Renomme les fichiers du dossier export",
  startAgo: 3600 * 5,
  mainSteps: [{ tool: "Bash" }, { tool: "Bash" }],
  agents: [],
});

// --- Session 4 : l'agent principal lit tout lui-même (déclenche un conseil)
session({
  id: "44444444-demo-4ddd-8000-000000000004",
  cwd: "/home/demo/api",
  prompt: "Explique-moi comment marche la facturation",
  startAgo: 3600 * 26,
  mainSteps: Array.from({ length: 32 }, (_, i) => ({ tool: ["Read", "Grep", "Read", "Glob"][i % 4], dt: 3 })),
  agents: [],
});

// --- Session 5 : des Explore sur Opus (déclenche un conseil) et l'équipe en action
session({
  id: "55555555-demo-4eee-8000-000000000005",
  cwd: "/home/demo/api",
  prompt: "Ajoute la pagination sur /factures",
  startAgo: 3600 * 8,
  mainSteps: [
    spawn("toolu_G", "Trouver les contrôleurs", "Explore", { result: { agentId: "c01" } }),
    spawn("toolu_H", "Trouver les modèles", "Explore", { result: { agentId: "c02" } }),
    spawn("toolu_I", "Trouver les tests existants", "Explore", { result: { agentId: "c03" } }),
    spawn("toolu_J", "Plan de la pagination", "architecte", { result: { agentId: "c04" } }),
    spawn("toolu_K", "Implémenter la pagination", "developpeur", { result: { agentId: "c05" } }),
    spawn("toolu_L", "Lancer les tests", "testeur", { result: { agentId: "c06" } }),
  ],
  agents: [
    { id: "c01", toolUseId: "toolu_G", type: "Explore", description: "Trouver les contrôleurs", startAgo: 3600 * 8 - 5, finished: true, model: "claude-opus-5-5", prompt: "…", steps: [{ tool: "Grep" }, { tool: "Read" }] },
    { id: "c02", toolUseId: "toolu_H", type: "Explore", description: "Trouver les modèles", startAgo: 3600 * 8 - 6, finished: true, model: "claude-opus-5-5", prompt: "…", steps: [{ tool: "Glob" }, { tool: "Read" }] },
    { id: "c03", toolUseId: "toolu_I", type: "Explore", description: "Trouver les tests existants", startAgo: 3600 * 8 - 7, finished: true, model: "claude-opus-5-5", prompt: "…", steps: [{ tool: "Glob" }] },
    { id: "c04", toolUseId: "toolu_J", type: "architecte", description: "Plan de la pagination", startAgo: 3600 * 8 - 40, finished: true, model: "claude-opus-5-5", prompt: "…", steps: [{ tool: "Read" }, { tool: "Read" }] },
    { id: "c05", toolUseId: "toolu_K", type: "developpeur", description: "Implémenter la pagination", startAgo: 3600 * 8 - 90, finished: true, model: "claude-sonnet-5-5", prompt: "…", steps: [{ tool: "Edit" }, { tool: "Edit" }, { tool: "Bash" }] },
    { id: "c06", toolUseId: "toolu_L", type: "testeur", description: "Lancer les tests", startAgo: 3600 * 8 - 200, finished: true, model: "claude-haiku-5-5", prompt: "…", steps: [{ tool: "Bash" }] },
  ],
});

console.log("Fixtures écrites dans ./fixtures");
