// Mode démo : génère des sessions factices, lance le serveur dessus, puis
// simule une session Claude Code « vivante » (des sous-agents naissent,
// travaillent et se terminent) pour voir l'interface bouger en temps réel.
//
//   npm run demo

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

execFileSync(process.execPath, ["scripts/make-fixtures.mjs"], { stdio: "inherit" });

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: { ...process.env, CLAUDE_DIR: path.resolve("fixtures") },
});
process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});
server.on("exit", (code) => process.exit(code ?? 0));

// ------------------------------------------------------------- simulation

const SESSION = "11111111-demo-4aaa-8000-000000000001";
const DIR = path.resolve("fixtures/projects/-home-demo-mon-app");
const MAIN = path.join(DIR, `${SESSION}.jsonl`);
const SUB = path.join(DIR, SESSION, "subagents");
const TOOLS = ["Read", "Grep", "Glob", "Edit", "Bash", "Write", "WebSearch"];
const TASKS = [
  ["eclaireur", "Cartographier les dépendances", "claude-haiku-5-5"],
  ["documentaliste", "Vérifier l'API OAuth du fournisseur", "claude-haiku-5-5"],
  ["eclaireur", "Chercher les usages de l'ancien token", "claude-haiku-5-5"],
  ["relecteur", "Relire le diff OAuth", "claude-sonnet-5-5"],
  ["testeur", "Relancer les tests", "claude-haiku-5-5"],
  ["developpeur", "Corriger les tests qui échouent", "claude-sonnet-5-5"],
];

let n = 0;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const append = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + "\n");
const base = (agentId) => ({
  sessionId: SESSION,
  cwd: "/home/demo/mon-app",
  isSidechain: !!agentId,
  ...(agentId ? { agentId } : {}),
  timestamp: new Date().toISOString(),
  uuid: `live-${++n}`,
});

const models = { main: "claude-opus-5-5" };
function toolCall(file, agentId, name = pick(TOOLS), input = {}) {
  const id = `toolu_live_${++n}`;
  const model = models[agentId ?? "main"] ?? "claude-sonnet-5-5";
  const usage = { input_tokens: 30, output_tokens: 80 + Math.floor(Math.random() * 400), cache_read_input_tokens: 2000 + Math.floor(Math.random() * 8000) };
  append(file, { ...base(agentId), type: "assistant", message: { id: `msg_live_${n}`, role: "assistant", model, content: [{ type: "tool_use", id, name, input }], usage } });
  return id;
}
function toolResult(file, agentId, id, extra = {}) {
  append(file, { ...base(agentId), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] }, ...extra });
}

/** Sous-agents en cours : { id, file, toolUseId, left } */
const live = [];

// Le sous-agent « Écrire les tests unitaires » (a04) continue de travailler.
live.push({ id: "a04", file: path.join(SUB, "agent-a04.jsonl"), toolUseId: "toolu_D", parentFile: path.join(SUB, "agent-a03.jsonl"), parentId: "a03", left: Infinity, type: "general-purpose", description: "Écrire les tests unitaires" });

function spawnAgent() {
  const [type, description, model] = pick(TASKS);
  const id = `live${++n}`;
  models[id] = model;
  const toolUseId = toolCall(MAIN, undefined, "Agent", { description, subagent_type: type, prompt: `Tâche : ${description}` });
  const file = path.join(SUB, `agent-${id}.jsonl`);
  append(file, { ...base(id), type: "user", message: { role: "user", content: `Tâche : ${description}` } });
  fs.writeFileSync(path.join(SUB, `agent-${id}.meta.json`), JSON.stringify({ agentType: type, description, toolUseId, finished: false }));
  live.push({ id, file, toolUseId, parentFile: MAIN, left: 3 + Math.floor(Math.random() * 6), type, description });
}

function finish(a) {
  const meta = path.join(SUB, `agent-${a.id}.meta.json`);
  fs.writeFileSync(meta, JSON.stringify({ agentType: a.type, description: a.description, toolUseId: a.toolUseId, finished: true }));
  toolResult(a.parentFile, a.parentId, a.toolUseId, { toolUseResult: { agentId: a.id, totalTokens: 5000 + Math.floor(Math.random() * 40000), totalDurationMs: 15000 + Math.floor(Math.random() * 60000) } });
}

let tick = 0;
setInterval(() => {
  tick++;
  for (const a of [...live]) {
    if (Math.random() < 0.6) toolResult(a.file, a.id, toolCall(a.file, a.id));
    if (--a.left <= 0) {
      finish(a);
      live.splice(live.indexOf(a), 1);
    }
  }
  if (tick % 4 === 1 && live.length < 5) spawnAgent();
  // garde la session principale « vivante »
  if (tick % 3 === 0) toolResult(MAIN, undefined, toolCall(MAIN, undefined, pick(["Read", "TodoWrite"])));
}, 2500);

console.log("  Démo en direct : des sous-agents vont apparaître toutes les ~10 s. Ctrl+C pour arrêter.\n");
