import { useCallback, useEffect, useState } from "react";
import type { ConversationInfo, ProjectInfo } from "../server/types.ts";
import { AgentsPanel } from "./AgentsPanel.tsx";
import { Chat } from "./Chat.tsx";
import { FolderPicker } from "./FolderPicker.tsx";
import { OfficeView } from "./Office.tsx";
import { TeamView } from "./Team.tsx";

type View = "chat" | "office" | "team";

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

function ago(ms?: number | string) {
  if (!ms) return "";
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<string | null>(() => load("cav-project"));
  const [convs, setConvs] = useState<ConversationInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(() => load("cav-session"));
  const [view, setView] = useState<View>(() => (location.hash === "#bureau" ? "office" : location.hash === "#equipe" ? "team" : "chat"));
  const [picker, setPicker] = useState(false);
  const [running, setRunning] = useState(false);
  const [version, setVersion] = useState(0);
  const [showAllProjects, setShowAllProjects] = useState(false);

  const refreshProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  const refreshConvs = useCallback(() => {
    if (!project) return setConvs([]);
    fetch(`/api/conversations?cwd=${encodeURIComponent(project)}`)
      .then((r) => r.json())
      .then(setConvs)
      .catch(() => {});
  }, [project]);

  useEffect(refreshProjects, [refreshProjects]);
  useEffect(refreshConvs, [refreshConvs, running]);
  useEffect(() => save("cav-project", project), [project]);
  useEffect(() => save("cav-session", sessionId), [sessionId]);
  useEffect(() => {
    history.replaceState(null, "", view === "office" ? "#bureau" : view === "team" ? "#equipe" : "#");
  }, [view]);

  // Mises à jour en direct dès qu'un transcript Claude Code change sur le disque
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("change", () => setVersion((v) => v + 1));
    return () => es.close();
  }, []);
  useEffect(() => {
    if (version % 4 === 0) refreshProjects();
  }, [version, refreshProjects]);

  const openProject = (p: string) => {
    setProject(p);
    setSessionId(null);
    setView("chat");
  };

  const addFolder = async (p: string) => {
    setPicker(false);
    const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: p }) });
    const d = await r.json();
    if (r.ok) {
      refreshProjects();
      openProject(d.path);
    }
  };

  const onSession = useCallback((id: string) => setSessionId(id), []);
  const onRunning = useCallback((r: boolean) => setRunning(r), []);

  const current = projects.find((p) => p.path === project);
  const projectName = current?.name ?? project?.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const shownProjects = showAllProjects ? projects : projects.slice(0, 8);
  const conv = convs.find((c) => c.sessionId === sessionId);

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="brand">
          <Logo />
          <div>
            <div className="brand-name">Claude Studio</div>
            <div className="brand-sub">interface pour Claude Code</div>
          </div>
        </header>

        <div className="side-section">
          <div className="side-title">
            Projets
            <button className="link-btn" onClick={() => setPicker(true)}>
              + Ouvrir
            </button>
          </div>
          <ul className="side-list">
            {shownProjects.map((p) => (
              <li key={p.path}>
                <button className={`side-item ${p.path === project ? "active" : ""}`} onClick={() => openProject(p.path)} title={p.path}>
                  <span className="folder">📁</span>
                  <span className="side-label">{p.name}</span>
                  {p.running ? <span className="dot running" title="Claude travaille ici" /> : <span className="side-meta">{ago(p.lastActivityAt)}</span>}
                </button>
              </li>
            ))}
            {projects.length > 8 && (
              <li>
                <button className="link-btn more" onClick={() => setShowAllProjects(!showAllProjects)}>
                  {showAllProjects ? "Voir moins" : `Voir les ${projects.length} projets`}
                </button>
              </li>
            )}
            {projects.length === 0 && <li className="muted small pad">Aucun projet pour l'instant.</li>}
          </ul>
        </div>

        {project && (
          <div className="side-section grow">
            <div className="side-title">Conversations</div>
            <button
              className={`side-item new-conv ${!sessionId && view === "chat" ? "active" : ""}`}
              onClick={() => {
                setSessionId(null);
                setView("chat");
              }}
              disabled={running}
            >
              <span className="folder">＋</span> Nouvelle conversation
            </button>
            <ul className="side-list scroll">
              {convs.map((c) => (
                <li key={c.sessionId}>
                  <button
                    className={`side-item ${c.sessionId === sessionId ? "active" : ""}`}
                    onClick={() => {
                      setSessionId(c.sessionId);
                      setView("chat");
                    }}
                    disabled={running && c.sessionId !== sessionId}
                    title={c.title}
                  >
                    <span className="side-label">{c.title}</span>
                    <span className="side-meta">{ago(c.lastModified)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            {project ? (
              <>
                <span className="crumb-project">{projectName}</span>
                {view === "chat" && <span className="crumb-conv">{conv?.title ?? (sessionId ? "Conversation" : "Nouvelle conversation")}</span>}
              </>
            ) : (
              <span className="crumb-project">Bienvenue</span>
            )}
          </div>
          <nav className="tabs">
            <button className={view === "chat" ? "on" : ""} onClick={() => setView("chat")}>
              Discussion
            </button>
            <button className={view === "office" ? "on" : ""} onClick={() => setView("office")}>
              Bureau
            </button>
            <button className={view === "team" ? "on" : ""} onClick={() => setView("team")}>
              Équipe
            </button>
          </nav>
        </header>

        {view === "office" ? (
          <div className="page">
            <OfficeView
              version={version}
              onOpenSession={(id) => {
                setSessionId(id);
                setView("chat");
              }}
            />
          </div>
        ) : view === "team" ? (
          <div className="page">
            <TeamView version={version} />
          </div>
        ) : project ? (
          <div className="chat-layout">
            <Chat cwd={project} projectName={projectName} sessionId={sessionId} onSession={onSession} onRunning={onRunning} />
            <AgentsPanel sessionId={sessionId} version={version} running={running} />
          </div>
        ) : (
          <div className="welcome">
            <Logo size={56} />
            <h1>Travaille avec Claude Code, sans terminal</h1>
            <p>Choisis le dossier d'un projet : tu pourras discuter avec Claude, le voir lire et modifier tes fichiers, et suivre ses sous-agents en direct.</p>
            <button className="btn primary big" onClick={() => setPicker(true)}>
              Ouvrir un projet
            </button>
            {projects.length > 0 && (
              <div className="recent">
                <div className="muted small">Ou reprends un projet récent :</div>
                <div className="recent-list">
                  {projects.slice(0, 6).map((p) => (
                    <button key={p.path} className="suggestion" onClick={() => openProject(p.path)}>
                      📁 {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {picker && <FolderPicker onPick={addFolder} onClose={() => setPicker(false)} />}
    </div>
  );
}

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <g transform="translate(14 14)">
        {[0, 45, 90, 135].map((a) => (
          <rect key={a} x="-1.6" y="-11" width="3.2" height="22" rx="1.6" fill="var(--accent)" transform={`rotate(${a})`} />
        ))}
      </g>
    </svg>
  );
}
