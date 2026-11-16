// Les projets (dossiers) dans lesquels on travaille avec Claude Code.
// Liste = dossiers ajoutés depuis l'interface + dossiers déjà utilisés avec Claude Code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions } from "./parser.ts";
import type { DirListing, ProjectInfo } from "./types.ts";

const STORE = process.env.CAV_STORE ?? path.join(os.homedir(), ".config", "claude-agents-viewer", "projects.json");

function readStore(): string[] {
  try {
    const d = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return Array.isArray(d.projects) ? d.projects.filter((p: unknown) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeStore(list: string[]) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ projects: list }, null, 2));
}

function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function listProjects(claudeDir: string): ProjectInfo[] {
  const map = new Map<string, ProjectInfo>();
  for (const p of readStore()) {
    if (isDir(p)) map.set(p, { path: p, name: path.basename(p) || p, pinned: true });
  }
  for (const s of listSessions(claudeDir, 300)) {
    if (!s.cwd || !isDir(s.cwd)) continue;
    const cur = map.get(s.cwd) ?? { path: s.cwd, name: path.basename(s.cwd) || s.cwd, pinned: false };
    if (!cur.lastActivityAt || (s.lastActivityAt ?? "") > cur.lastActivityAt) cur.lastActivityAt = s.lastActivityAt;
    if (s.counts.running > 0) cur.running = (cur.running ?? 0) + s.counts.running;
    map.set(s.cwd, cur);
  }
  return [...map.values()].sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name));
}

export function addProject(p: string): ProjectInfo {
  const abs = path.resolve(p.replace(/^~(?=$|\/|\\)/, os.homedir()));
  if (!isDir(abs)) throw new Error("Ce dossier n'existe pas.");
  const list = readStore().filter((x) => x !== abs);
  writeStore([abs, ...list]);
  return { path: abs, name: path.basename(abs) || abs, pinned: true };
}

export function removeProject(p: string) {
  writeStore(readStore().filter((x) => x !== p));
}

/** Navigateur de dossiers pour choisir un projet (dossiers seulement). */
export function listDir(p?: string): DirListing {
  const dir = path.resolve(p || os.homedir());
  let dirs: DirListing["dirs"] = [];
  try {
    dirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => {
        const full = path.join(dir, e.name);
        return { name: e.name, path: full, isRepo: fs.existsSync(path.join(full, ".git")) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    /* illisible */
  }
  const parent = path.dirname(dir);
  return { path: dir, parent: parent !== dir ? parent : undefined, home: os.homedir(), dirs, isRepo: fs.existsSync(path.join(dir, ".git")) };
}
