// Claude Studio en appli de bureau, avec Tauri.
// Lance le serveur local (le même que `npm start`), attend qu'il annonce son
// adresse, puis l'affiche dans une fenêtre native. Le serveur s'arrête avec la fenêtre.
//
//   npm run app

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

struct Server(Mutex<Option<Child>>);

/// Dossier du projet : CAV_ROOT si défini, sinon le dossier cloné (parent de src-tauri).
fn app_root() -> PathBuf {
    std::env::var_os("CAV_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn start_server() -> Result<(Child, String), String> {
    let node = std::env::var("NODE").unwrap_or_else(|_| "node".into());
    let mut cmd = Command::new(node);
    cmd.args(["--import", "tsx", "server/index.ts", "--prod"])
        .current_dir(app_root())
        // port 0 : le système choisit un port libre, le serveur nous dit lequel
        .env("PORT", std::env::var("PORT").unwrap_or_else(|_| "0".into()))
        // l'appli garde ce tuyau ouvert : s'il se ferme, le serveur s'arrête tout seul
        .env("CAV_EXIT_WITH_PARENT", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // pas de fenêtre de console
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer Node.js ({e}). Est-il installé ?"))?;

    let stdout = child.stdout.take().ok_or("pas de sortie du serveur")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut sent = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("{line}");
            if !sent {
                if let Some(i) = line.find("http://127.0.0.1:") {
                    let url: String = line[i..].chars().take_while(|c| !c.is_whitespace()).collect();
                    let _ = tx.send(url);
                    sent = true;
                }
            }
        }
    });
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            Err("Le serveur ne répond pas. As-tu lancé `npm install` dans le dossier du projet ?".into())
        }
    }
}

fn error_page(msg: &str) -> String {
    let esc = msg.replace('&', "&amp;").replace('<', "&lt;");
    format!(
        "document.body.innerHTML = {:?}",
        format!("<div style='padding:40px;font:15px system-ui'><h2>Impossible de démarrer Claude Studio</h2><p>{esc}</p></div>")
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let opener = handle.clone();
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Claude Studio")
                .inner_size(1440.0, 920.0)
                .min_inner_size(900.0, 600.0)
                .background_color(tauri::window::Color(0x16, 0x15, 0x13, 0xff))
                // les liens externes s'ouvrent dans le navigateur habituel
                .on_navigation(move |url| {
                    let local = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost"))
                        || url.scheme() == "tauri";
                    if !local && matches!(url.scheme(), "http" | "https") {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    local
                })
                .build()?;

            std::thread::spawn(move || match start_server() {
                Ok((child, url)) => {
                    *handle.state::<Server>().0.lock().unwrap() = Some(child);
                    if let Ok(u) = Url::parse(&url) {
                        let _ = win.navigate(u);
                    }
                }
                Err(e) => {
                    let _ = win.eval(&error_page(&e));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au lancement de Claude Studio")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
