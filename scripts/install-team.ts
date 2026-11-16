// Installe l'équipe de sous-agents dans ~/.claude/agents (ou $CLAUDE_DIR/agents).
//   npm run install-team             n'écrase rien
//   npm run install-team -- --force  remplace les versions modifiées

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installTeam } from "../server/team.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeDir = path.resolve(process.env.CLAUDE_DIR ?? path.join(os.homedir(), ".claude"));
const r = installTeam(root, claudeDir, process.argv.includes("--force"));

console.log(`\n  Dossier : ${r.dir}`);
if (r.installed.length) console.log(`  Installés  : ${r.installed.join(", ")}`);
if (r.updated.length) console.log(`  Mis à jour : ${r.updated.join(", ")}`);
if (r.skipped.length) console.log(`  Inchangés  : ${r.skipped.join(", ")}${process.argv.includes("--force") ? "" : "  (--force pour écraser une version modifiée)"}`);
console.log("\n  Claude Code les utilisera dans les nouvelles sessions. Tape /agents pour les voir.\n");
