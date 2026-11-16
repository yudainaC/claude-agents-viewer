// Claude Studio dans sa propre fenêtre, avec le moteur de Chrome/Chromium.
// Même rendu fluide que dans le navigateur (carte graphique), mais sans onglets
// ni barre d'adresse. Le serveur s'arrête quand tu fermes la fenêtre.
//
//   npm run fenetre
//
// CAV_BROWSER=/chemin/vers/chrome pour choisir le navigateur.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath : sous Windows, .pathname donnerait « /C:/… »
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

function which(cmd) {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

/** Trouve un navigateur basé sur Chromium : [commande, arguments avant les options]. */
function findBrowser() {
  if (process.env.CAV_BROWSER) return [process.env.CAV_BROWSER, []];
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "vivaldi"];
  for (const n of names) {
    const p = which(n);
    if (p) return [p, []];
  }
  const fixed = {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    win32: [
      path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    ],
  }[process.platform] ?? [];
  for (const p of fixed) if (fs.existsSync(p)) return [p, []];
  // Linux : Chrome ou Chromium installés en Flatpak
  if (which("flatpak")) {
    for (const id of ["com.google.Chrome", "org.chromium.Chromium", "com.brave.Browser", "com.microsoft.Edge"]) {
      try {
        execFileSync("flatpak", ["info", id], { stdio: "ignore" });
        return ["flatpak", ["run", id]];
      } catch {
        /* pas installé */
      }
    }
  }
  return null;
}

if (!fs.existsSync(path.join(ROOT, "dist", "index.html")) || process.argv.includes("--build")) {
  execFileSync(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build"], { stdio: "inherit" });
}

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts", "--prod"], {
  env: { ...process.env, PORT: process.env.PORT ?? "0", CAV_EXIT_WITH_PARENT: "1" },
  stdio: ["pipe", "pipe", "inherit"],
});
const stop = () => {
  server.stdin.end();
  server.kill();
};
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

const url = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("Le serveur ne répond pas")), 30000);
  server.stdout.on("data", (d) => {
    process.stdout.write(d);
    buf += d;
    const m = /http:\/\/127\.0\.0\.1:\d+/.exec(buf);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  });
  server.on("exit", (c) => reject(new Error(`Le serveur s'est arrêté (code ${c})`)));
});

const browser = findBrowser();
if (!browser) {
  console.log(`\nAucun Chrome/Chromium trouvé. Ouvre ${url} dans ton navigateur (Ctrl+C pour arrêter).`);
} else {
  const [cmd, pre] = browser;
  // un profil à part : la fenêtre est un processus séparé, qu'on peut attendre
  const profile = path.join(os.homedir(), ".config", "claude-agents-viewer", "fenetre");
  fs.mkdirSync(profile, { recursive: true });
  const win = spawn(cmd, [...pre, `--app=${url}`, `--user-data-dir=${profile}`, "--window-size=1440,920", "--class=ClaudeStudio", "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"], { stdio: "ignore" });
  console.log("\nFenêtre ouverte. Ferme-la pour tout arrêter.");
  win.on("exit", () => {
    stop();
    process.exit(0);
  });
  win.on("error", (e) => {
    console.log(`Impossible d'ouvrir ${cmd} (${e.message}). Ouvre ${url} dans ton navigateur.`);
  });
}
