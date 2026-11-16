// Claude Studio en appli de bureau : une fenêtre à part, sans navigateur.
// Lance le serveur local (le même que `npm start`) puis l'affiche dans une fenêtre Electron.
//
//   npm run app

const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
let server = null;
let win = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const node = process.env.npm_node_execpath || process.env.NODE || "node";
    server = spawn(node, ["--import", "tsx", "server/index.ts", "--prod"], {
      cwd: ROOT,
      // port 0 : le système choisit un port libre, le serveur nous dit lequel
      env: { ...process.env, PORT: process.env.PORT || "0", ELECTRON_RUN_AS_NODE: "" },
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Le serveur ne répond pas")), 30000);
    server.stdout.on("data", (d) => {
      process.stdout.write(d);
      buf += d.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      if (!win) reject(new Error(`Le serveur s'est arrêté (code ${code})`));
      else app.quit();
    });
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: "Claude Studio",
    backgroundColor: "#161513",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  // les liens externes s'ouvrent dans le navigateur habituel
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://127.0.0.1:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  try {
    const url = await startServer();
    await win.loadURL(url);
    // vérification automatique : CAV_SNAPSHOT=fichier.png enregistre une capture puis quitte
    if (process.env.CAV_SNAPSHOT) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        require("node:fs").writeFileSync(process.env.CAV_SNAPSHOT, img.toPNG());
        app.quit();
      }, Number(process.env.CAV_SNAPSHOT_DELAY || 5000));
    }
  } catch (e) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="font:15px system-ui;background:#161513;color:#ecebe6;padding:40px"><h2>Impossible de démarrer Claude Studio</h2><p>${String(e.message)}</p><p>As-tu lancé <code>npm install</code> puis <code>npm run app</code> dans le dossier du projet ?</p></body>`)}`);
  }
}

if (process.platform !== "darwin") Menu.setApplicationMenu(null);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server && !server.killed) server.kill();
});
