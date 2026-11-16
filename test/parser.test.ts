import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildSession, listSessions } from "../server/parser.ts";

const CLAUDE_DIR = path.resolve("fixtures");
const DIR = path.join(CLAUDE_DIR, "projects", "-home-demo-mon-app");

test("liste les cinq sessions de démo, la plus récente en premier", () => {
  const list = listSessions(CLAUDE_DIR);
  assert.equal(list.length, 5);
  assert.equal(list[0].id, "11111111-demo-4aaa-8000-000000000001");
});

test("reconstruit l'arbre agents / sous-agents sur plusieurs niveaux", () => {
  const s = buildSession(DIR, "11111111-demo-4aaa-8000-000000000001")!;
  assert.equal(s.counts.total, 6);
  assert.equal(s.counts.subagents, 5);
  assert.equal(s.counts.maxDepth, 2);
  assert.deepEqual(s.counts.byType, { Explore: 2, "general-purpose": 2, "security-reviewer": 1 });

  const oauth = s.root.children.find((c) => c.label === "Implémenter OAuth")!;
  assert.equal(oauth.children.length, 2);
  const tests = oauth.children.find((c) => c.label === "Écrire les tests unitaires")!;
  assert.equal(tests.status, "running");
  // un agent qui attend un sous-agent actif est actif lui aussi
  assert.equal(oauth.status, "running");
  assert.equal(s.root.status, "running");
  assert.equal(oauth.children.find((c) => c.agentType === "security-reviewer")!.status, "error");
});

test("compte les outils par agent", () => {
  const s = buildSession(DIR, "11111111-demo-4aaa-8000-000000000001")!;
  const explore = s.root.children.find((c) => c.label === "Explorer le code d'authentification")!;
  assert.deepEqual(explore.tools, { Grep: 2, Read: 3 });
  assert.equal(explore.totalTokens, 41200);
});

test("une session sans sous-agent n'a que l'agent principal", () => {
  const s = buildSession(DIR, "33333333-demo-4ccc-8000-000000000003")!;
  assert.equal(s.counts.total, 1);
  assert.equal(s.root.status, "done");
});

test("un sous-agent lancé en arrière-plan reste « au travail » tant qu'il n'a pas fini", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cav-async-"));
  const sid = "aaaaaaaa-0000-4000-8000-000000000001";
  const now = new Date().toISOString();
  const lines = [
    { type: "user", timestamp: now, message: { role: "user", content: "fais-le" } },
    { type: "assistant", timestamp: now, message: { id: "m1", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "Agent", input: { subagent_type: "developpeur", description: "Créer conv.js", prompt: "…" } }] } },
    { type: "user", timestamp: now, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "Async agent launched successfully.\nagentId: a1" }] }] } },
    { type: "assistant", timestamp: now, message: { id: "m2", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "J'attends le développeur." }] } },
  ];
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
  const sub = path.join(dir, sid, "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const subLines = [
    { type: "user", timestamp: now, agentId: "a1", message: { role: "user", content: "Créer conv.js" } },
    { type: "assistant", timestamp: now, agentId: "a1", message: { id: "s1", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "w1", name: "Write", input: {} }] } },
  ];
  fs.writeFileSync(path.join(sub, "agent-a1.jsonl"), subLines.map((l) => JSON.stringify(l)).join("\n"));
  const meta = { agentType: "developpeur", description: "Créer conv.js", toolUseId: "tu1", requestShape: "background" };
  fs.writeFileSync(path.join(sub, "agent-a1.meta.json"), JSON.stringify(meta));

  let s = buildSession(dir, sid)!;
  assert.equal(s.root.children[0].agentType, "developpeur");
  assert.equal(s.root.children[0].status, "running", "le résultat immédiat ne veut pas dire fini");
  assert.equal(s.root.status, "running", "le chef attend son sous-agent");

  fs.writeFileSync(path.join(sub, "agent-a1.meta.json"), JSON.stringify({ ...meta, finished: true }));
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(path.join(sub, "agent-a1.meta.json"), later, later);
  fs.utimesSync(path.join(sub, "agent-a1.jsonl"), later, later);
  s = buildSession(dir, sid)!;
  assert.equal(s.root.children[0].status, "done");
  fs.rmSync(dir, { recursive: true });
});
