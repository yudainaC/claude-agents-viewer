import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installTeam, parseAgentFile, teamReport } from "../server/team.ts";
import { CHEF_DISALLOWED, chefGuard, teamAgents, teamRules } from "../server/chat.ts";

const ROOT = path.resolve(".");
const FIXTURES = path.resolve("fixtures");

test("toutes les définitions de l'équipe sont valides", () => {
  const dir = path.join(ROOT, ".claude", "agents");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 6);
  for (const f of files) {
    const d = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(d, f);
    assert.equal(d.name, f.slice(0, -3), "le nom doit correspondre au fichier");
    assert.ok(["haiku", "sonnet", "opus"].includes(d.model), `${f} : modèle ${d.model}`);
    assert.ok(d.description.length > 40, `${f} : description trop courte`);
    assert.ok(d.tools.length > 0, `${f} : outils explicites attendus`);
    assert.ok(d.prompt.length > 100, `${f} : consigne trop courte`);
  }
});

test("les agents de lecture ne peuvent pas modifier de fichiers", () => {
  const dir = path.join(ROOT, ".claude", "agents");
  for (const name of ["eclaireur", "documentaliste", "architecte"]) {
    const d = parseAgentFile(fs.readFileSync(path.join(dir, `${name}.md`), "utf8"))!;
    for (const t of ["Edit", "Write", "Bash"]) assert.ok(!d.tools.includes(t), `${name} ne doit pas avoir ${t}`);
  }
});

test("spécialisation stricte : Haiku lit seulement, un seul codeur, un seul testeur", () => {
  const dir = path.join(ROOT, ".claude", "agents");
  const defs = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"))!);
  const readOnly = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
  for (const d of defs.filter((d) => d.model === "haiku")) {
    for (const t of d.tools) assert.ok(readOnly.has(t), `${d.name} (Haiku) ne doit pas avoir ${t}`);
  }
  assert.deepEqual(defs.filter((d) => d.tools.some((t) => ["Edit", "Write", "MultiEdit"].includes(t))).map((d) => d.name), ["developpeur"]);
  assert.deepEqual(defs.filter((d) => d.tools.includes("Bash")).map((d) => d.name), ["testeur"]);
});

test("mode équipe : le chef ne code pas et connaît son équipe", () => {
  for (const t of ["Edit", "Write", "Bash"]) assert.ok(CHEF_DISALLOWED.includes(t));
  assert.equal((chefGuard({ tool_name: "Edit" }) as any).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(chefGuard({ tool_name: "Edit", agent_id: "a1" }), {}, "le développeur garde Edit");
  assert.deepEqual(chefGuard({ tool_name: "Read" }), {});
  const agents = teamAgents(ROOT);
  assert.equal(Object.keys(agents).length, 6);
  assert.deepEqual(agents.eclaireur.tools, ["Read", "Grep", "Glob"]);
  assert.equal(agents.eclaireur.model, "haiku");
  assert.ok(teamRules(ROOT).includes("chef de projet"));
});

test("installe sans écraser, puis écrase sur demande", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cav-"));
  const r1 = installTeam(ROOT, tmp, false);
  assert.equal(r1.installed.length, 6);
  const f = path.join(tmp, "agents", "eclaireur.md");
  fs.writeFileSync(f, "perso");
  const r2 = installTeam(ROOT, tmp, false);
  assert.deepEqual(r2.installed, []);
  assert.equal(fs.readFileSync(f, "utf8"), "perso");
  const r3 = installTeam(ROOT, tmp, true);
  assert.deepEqual(r3.updated, ["eclaireur"]);
  fs.rmSync(tmp, { recursive: true });
});

test("rapport : usage par type et conseils d'optimisation", () => {
  fs.rmSync(path.join(FIXTURES, "agents"), { recursive: true, force: true });
  const r = teamReport(ROOT, FIXTURES);
  const explore = r.usage.find((u) => u.type === "Explore")!;
  assert.equal(explore.runs, 6);
  assert.ok(explore.models.opus >= 3);
  assert.ok(explore.tokens > 0);
  const ids = r.tips.map((t) => t.id);
  assert.ok(ids.includes("install"), "équipe non installée");
  assert.ok(ids.includes("heavy-reader"), "agent principal qui lit tout");
  assert.ok(ids.includes("model-Explore"), "Explore sur Opus");
  assert.equal(r.main.heavyReaderSessions, 1);
  assert.ok(r.snippet.includes("eclaireur"));
});
