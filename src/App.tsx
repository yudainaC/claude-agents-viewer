import { useCallback, useEffect, useMemo, useState } from "react";
import { TeamView } from "./Team.tsx";
import type { AgentNode, AgentStatus, SessionDetail, SessionSummary } from "../server/types.ts";

// ------------------------------------------------------------ utilitaires

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Actif",
  done: "Terminé",
  error: "Erreur",
  interrupted: "Interrompu",
};

function ago(ts?: string) {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return `il y a ${Math.round(s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function duration(ms?: number) {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function compact(n?: number) {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function shortModel(m?: string) {
  return m?.replace(/^claude-/, "") ?? "—";
}

function findNode(n: AgentNode, id: string): AgentNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
}

function descendants(n: AgentNode): number {
  return n.children.reduce((acc, c) => acc + 1 + descendants(c), 0);
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ------------------------------------------------------------ données

function useLive(onChange: () => void) {
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("change", onChange);
    return () => es.close();
  }, [onChange]);
}

// ------------------------------------------------------------ app

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [agentId, setAgentId] = useState<string>("main");
  const [filter, setFilter] = useState("");
  const [onlyWithAgents, setOnlyWithAgents] = useState(false);
  const [info, setInfo] = useState<{ claudeDir: string; exists: boolean } | null>(null);
  const [, setNow] = useState(0);
  const [view, setView] = useState<"sessions" | "team">(() => (location.hash === "#equipe" ? "team" : "sessions"));
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const list = await getJSON<SessionSummary[]>("/api/sessions").catch(() => []);
    setSessions(list);
    setSelected((cur) => cur ?? list[0]?.id ?? null);
    setNow(Date.now());
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    getJSON<{ claudeDir: string; exists: boolean }>("/api/info").then(setInfo).catch(() => {});
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    getJSON<SessionDetail>(`/api/sessions/${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [selected, sessions]);

  useLive(refresh);

  const visible = useMemo(() => {
    const q = filter.toLowerCase();
    return sessions.filter(
      (s) =>
        (!onlyWithAgents || s.counts.subagents > 0) &&
        (!q || `${s.title ?? ""} ${s.project}`.toLowerCase().includes(q)),
    );
  }, [sessions, filter, onlyWithAgents]);

  const totals = useMemo(() => {
    let running = 0;
    for (const s of sessions) running += s.counts.running;
    return { running };
  }, [sessions]);

  const agent = detail ? (findNode(detail.root, agentId) ?? detail.root) : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <Logo />
          <div>
            <div className="brand-name">Agents Viewer</div>
            <div className="brand-sub">pour Claude Code</div>
          </div>
        </header>

        <nav className="tabs">
          <button
            className={view === "sessions" ? "on" : ""}
            onClick={() => {
              setView("sessions");
              history.replaceState(null, "", "#");
            }}
          >
            Sessions
          </button>
          <button
            className={view === "team" ? "on" : ""}
            onClick={() => {
              setView("team");
              history.replaceState(null, "", "#equipe");
            }}
          >
            Équipe
          </button>
        </nav>

        <div className="global">
          <span className={`dot ${totals.running ? "running" : ""}`} />
          {totals.running
            ? `${totals.running} agent${totals.running > 1 ? "s" : ""} actif${totals.running > 1 ? "s" : ""} en ce moment`
            : "Aucun agent actif"}
        </div>

        <div className="search">
          <input placeholder="Filtrer les sessions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={onlyWithAgents} onChange={(e) => setOnlyWithAgents(e.target.checked)} />
            Avec sous-agents seulement
          </label>
        </div>

        <ul className="sessions">
          {visible.map((s) => (
            <li key={s.id}>
              <button
                className={`session ${s.id === selected ? "active" : ""}`}
                onClick={() => {
                  setSelected(s.id);
                  setAgentId("main");
                  setView("sessions");
                }}
              >
                <div className="session-top">
                  <span className={`dot ${s.counts.running ? "running" : ""}`} />
                  <span className="session-title">{s.title ?? s.id.slice(0, 8)}</span>
                </div>
                <div className="session-meta">
                  <span className="mono">{s.project.split("/").filter(Boolean).pop() ?? s.project}</span>
                  <span>{ago(s.lastActivityAt)}</span>
                </div>
                <div className="session-badges">
                  <span className="badge">{s.counts.subagents} sous-agent{s.counts.subagents > 1 ? "s" : ""}</span>
                  {s.counts.running > 0 && <span className="badge running">{s.counts.running} actif{s.counts.running > 1 ? "s" : ""}</span>}
                  {s.counts.error > 0 && <span className="badge error">{s.counts.error} erreur{s.counts.error > 1 ? "s" : ""}</span>}
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="empty">
              {info && !info.exists ? (
                <>
                  Aucun dossier <code>{info.claudeDir}/projects</code>.<br />
                  Lancez Claude Code une fois, ou définissez <code>CLAUDE_DIR</code>.
                </>
              ) : (
                "Aucune session."
              )}
            </li>
          )}
        </ul>
      </aside>

      <main className="main">
        {view === "team" ? (
          <TeamView version={version} />
        ) : detail && agent ? (
          <>
            <header className="head">
              <div>
                <h1>{detail.title ?? "Session sans titre"}</h1>
                <div className="sub mono">
                  {detail.project} · {detail.id.slice(0, 8)} · démarrée {ago(detail.startedAt)}
                </div>
              </div>
            </header>

            <section className="stats">
              <Stat label="Agents au total" value={detail.counts.total} />
              <Stat label="Sous-agents" value={detail.counts.subagents} />
              <Stat label="Actifs" value={detail.counts.running} tone="running" />
              <Stat label="Terminés" value={detail.counts.done} tone="done" />
              <Stat label="Erreurs / interrompus" value={detail.counts.error + detail.counts.interrupted} tone="error" />
              <Stat label="Profondeur max" value={detail.counts.maxDepth} />
              <Stat label="Appels d'outils" value={detail.counts.toolCalls} />
            </section>

            {Object.keys(detail.counts.byType).length > 0 && (
              <section className="types">
                <span className="types-label">Par type</span>
                {Object.entries(detail.counts.byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => (
                    <span key={t} className="chip">
                      {t} <b>{n}</b>
                    </span>
                  ))}
              </section>
            )}

            <div className="split">
              <section className="panel tree-panel">
                <h2>Arbre des agents</h2>
                <ul className="tree">
                  <TreeItem node={detail.root} selected={agent.id} onSelect={setAgentId} />
                </ul>
              </section>
              <AgentPanel node={agent} />
            </div>
          </>
        ) : (
          <div className="placeholder">Sélectionnez une session à gauche.</div>
        )}
      </main>
    </div>
  );
}

// ------------------------------------------------------------ composants

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function TreeItem({ node, selected, onSelect }: { node: AgentNode; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const hasKids = node.children.length > 0;
  return (
    <li>
      <div className={`node ${node.id === selected ? "selected" : ""}`}>
        <button className="twisty" onClick={() => setOpen(!open)} disabled={!hasKids} aria-label="Déplier">
          {hasKids ? (open ? "▾" : "▸") : ""}
        </button>
        <button className="node-main" onClick={() => onSelect(node.id)}>
          <span className={`status-dot ${node.status}`} title={STATUS_LABEL[node.status]} />
          <span className="node-label">{node.label}</span>
          <span className="node-type">{node.agentType}</span>
          <span className="node-right">
            {hasKids && <span className="kids">+{descendants(node)}</span>}
            <span className="mono">{node.toolCalls} outil{node.toolCalls > 1 ? "s" : ""}</span>
          </span>
        </button>
      </div>
      {hasKids && open && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AgentPanel({ node }: { node: AgentNode }) {
  const tools = Object.entries(node.tools).sort((a, b) => b[1] - a[1]);
  const max = tools[0]?.[1] ?? 1;
  return (
    <section className="panel detail">
      <h2>{node.label}</h2>
      <div className={`pill ${node.status}`}>{STATUS_LABEL[node.status]}</div>
      <dl className="kv">
        <dt>Type</dt>
        <dd>{node.agentType}</dd>
        <dt>Modèle</dt>
        <dd className="mono">{shortModel(node.model)}</dd>
        <dt>Profondeur</dt>
        <dd>{node.depth}</dd>
        <dt>Durée</dt>
        <dd>{duration(node.durationMs)}</dd>
        <dt>Tokens</dt>
        <dd>{compact(node.totalTokens)}</dd>
        <dt>Messages</dt>
        <dd>{node.messages}</dd>
        <dt>Dernière activité</dt>
        <dd>{ago(node.lastActivityAt)}</dd>
        <dt>Sous-agents directs</dt>
        <dd>{node.children.length}</dd>
      </dl>

      <h3>Outils utilisés</h3>
      {tools.length ? (
        <ul className="bars">
          {tools.map(([name, n]) => (
            <li key={name}>
              <span className="bar-name mono">{name}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="bar-n">{n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucun appel d'outil enregistré.</p>
      )}

      {node.prompt && (
        <>
          <h3>Consigne reçue</h3>
          <pre className="prompt">{node.prompt}</pre>
        </>
      )}
    </section>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <path d="M14 7 L7 20 M14 7 L21 20" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
      <circle cx="14" cy="7" r="4" fill="var(--accent)" />
      <circle cx="7" cy="21" r="3.2" fill="var(--accent)" opacity=".75" />
      <circle cx="21" cy="21" r="3.2" fill="var(--accent)" opacity=".75" />
    </svg>
  );
}
