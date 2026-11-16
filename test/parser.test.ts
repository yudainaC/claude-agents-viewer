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
