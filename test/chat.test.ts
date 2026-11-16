import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeTool } from "../server/chat.ts";
import { addProject, listDir } from "../server/projects.ts";

test("résume les appels d'outils en français lisible", () => {
  const cwd = "/home/moi/app";
  assert.equal(describeTool("Read", { file_path: "/home/moi/app/src/index.ts" }, cwd), "Lit src/index.ts");
  assert.equal(describeTool("Edit", { file_path: "/ailleurs/x.ts" }, cwd), "Modifie /ailleurs/x.ts");
  assert.equal(describeTool("Bash", { command: "npm test", description: "Lance les tests" }, cwd), "Lance les tests");
  assert.equal(describeTool("Bash", { command: "ls" }, cwd), "Lance ls");
  assert.match(describeTool("Agent", { subagent_type: "eclaireur", description: "Trouver l'auth" }, cwd), /eclaireur/);
});

test("navigue dans les dossiers et ajoute un projet", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cav-proj-"));
  fs.mkdirSync(path.join(tmp, "mon-app", ".git"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".cache"));
  fs.mkdirSync(path.join(tmp, "node_modules"));
  const l = listDir(tmp);
  assert.deepEqual(l.dirs.map((d) => d.name), ["mon-app"], "les dossiers cachés et node_modules sont masqués");
  assert.equal(l.dirs[0].isRepo, true);
  const p = addProject(path.join(tmp, "mon-app"));
  assert.equal(p.name, "mon-app");
  assert.throws(() => addProject(path.join(tmp, "inexistant")));
  fs.rmSync(tmp, { recursive: true });
});
